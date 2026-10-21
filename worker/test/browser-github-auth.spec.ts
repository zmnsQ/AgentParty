import { createExecutionContext, env, waitOnExecutionContext, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker, { type AppEnv } from '../src/index';
import { lookupToken } from '../src/auth';
import { fetchMock } from './fetch-mock';
import { base32, digest, newTotpSeed, pkceChallenge, totp, validTotpStep } from '../src/browser-auth/crypto';
import { openCredential } from '../src/collaboration/vault';
import type { ChannelDO } from '../src/do';

const ROOT = 'https://ap.test';
const P = '/api/auth/github';
const SECRET = 'synthetic-client-secret-not-for-browser';
let nextId = 30_000_000 + Math.floor(Math.random() * 1_000_000);
const config = () => {
  const id = ++nextId;
  return { ...env, AUTH_PUBLIC_ORIGIN: ROOT, GITHUB_CLIENT_ID: 'synthetic_client_id', GITHUB_CLIENT_SECRET: SECRET,
    AUTH_GITHUB_ALLOWED_IDS: String(id), AUTH_GITHUB_APP_OWNER_ID: String(id), INSTANCE_INVITE_ONLY: 'true' } as AppEnv;
};
beforeEach(() => { fetchMock.activate(); fetchMock.disableNetConnect(); });
afterEach(() => { try { fetchMock.assertNoPendingInterceptors(); } finally { fetchMock.deactivate(); } });
async function call(e: AppEnv, path: string, cookie = '', data?: Record<string, unknown>, other: RequestInit = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(ROOT + path, { method: data ? 'POST' : 'GET',
    ...(data ? { body: JSON.stringify(data) } : {}), ...other,
    headers: { origin: ROOT, 'x-agentparty-browser': '1', 'content-type': 'application/json', cookie,
      'cf-connecting-ip': e.AUTH_GITHUB_APP_OWNER_ID!, ...other.headers } }), e, ctx);
  await waitOnExecutionContext(ctx); return response;
}
function cookieOf(r: Response, name = '__Host-ap_oauth'): string {
  const values = r.headers.getSetCookie(); const v = values.find(x => x.startsWith(name + '='));
  expect(v).toBeDefined(); return v!.split(';')[0]!;
}
async function begin(e: AppEnv, returnPath = '/') {
  const r = await call(e, `${P}/start?return_to=${encodeURIComponent(returnPath)}`); expect(r.status).toBe(302);
  const url = new URL(r.headers.get('location')!); return { url, cookie: cookieOf(r), state: url.searchParams.get('state')! };
}
function userFixtures(e: AppEnv, id = Number(e.AUTH_GITHUB_APP_OWNER_ID), inspect?: (body: Record<string, unknown>) => void) {
  fetchMock.get('https://github.com').intercept({ path: '/login/oauth/access_token', method: 'POST' }).reply(200, r => {
    const b = JSON.parse(r.body); inspect?.(b); expect(b.client_secret).toBe(SECRET);
    return { access_token: 'synthetic-github-bearer-never-persist', token_type: 'bearer' };
  });
  fetchMock.get('https://api.github.com').intercept({ path: '/user', method: 'GET' }).reply(200, r => {
    expect(r.headers.authorization).toBe('Bearer synthetic-github-bearer-never-persist');
    return { id, login: `test-user-${id}` };
  });
}
async function login(e = config()) {
  const started = await begin(e); userFixtures(e);
  const result = await call(e, `${P}/callback?state=${started.state}&code=synthetic_oauth_code_123`, started.cookie);
  expect(result.status).toBe(303); const cookie = cookieOf(result, '__Host-ap_session');
  return { e, cookie, account: `github:${e.AUTH_GITHUB_APP_OWNER_ID}`, result };
}
async function access(c: Awaited<ReturnType<typeof login>>) {
  const r = await call(c.e, `${P}/session`, c.cookie); expect(r.status).toBe(200);
  return await r.json() as { status: string; access_token?: string; expires_at?: number; account?: string };
}
async function enable(c: Awaited<ReturnType<typeof login>>) {
  const setup = await call(c.e, `${P}/security/setup`, c.cookie, {}); expect(setup.status).toBe(200);
  const { secret } = await setup.json() as { secret: string };
  const confirmation = await call(c.e, `${P}/security/confirm`, c.cookie, { code: await totp(secret, Math.floor(Date.now()/30000)) });
  expect(confirmation.status).toBe(200);
  const result = await confirmation.json() as { recovery_codes: string[] };
  return { secret, codes: result.recovery_codes };
}

describe('HTTPS tunnel origin preservation', () => {
  it('recognizes the exact local-HTTP projection of the configured public HTTPS host', async () => {
    const e = config();
    const ctx = createExecutionContext();
    const request = new Request('http://ap.test/api/auth/github/registration/start', {
      method: 'POST',
      headers: {
        origin: 'http://ap.test', 'x-agentparty-browser': '1',
        'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
      },
      body: JSON.stringify({ setup_key: 'not-a-valid-initialization-key' }),
    });
    const response = await worker.fetch(request, e, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'already_configured' } });
  });

  it('rejects the local-HTTP projection for any other host', async () => {
    const e = config();
    const ctx = createExecutionContext();
    const request = new Request('http://other.test/api/auth/github/registration/start', {
      method: 'POST',
      headers: {
        origin: 'http://other.test', 'x-agentparty-browser': '1',
        'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
      },
      body: JSON.stringify({ setup_key: 'not-a-valid-initialization-key' }),
    });
    const response = await worker.fetch(request, e, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'origin_not_allowed' } });
  });
});

describe('GitHub browser login and second-factor boundaries', () => {
  it('matches RFC 6238 SHA1 vectors and prevents consumed-step replay', async () => {
    const seed = base32(new TextEncoder().encode('12345678901234567890'));
    for (const [time, code] of [[59,'94287082'], [1111111109,'07081804'], [1111111111,'14050471'], [1234567890,'89005924'], [2000000000,'69279037'], [20000000000,'65353130']] as const) {
      expect(await totp(seed, Math.floor(time/30), 8)).toBe(code);
    }
    const step = Math.floor(Date.now()/30000); const code = await totp(seed, step);
    expect(await validTotpStep(seed, code, -1)).toBe(step);
    expect(await validTotpStep(seed, code, step)).toBeNull();
    expect(await validTotpStep(seed, '00000', -1)).toBeNull();
  });
  it('uses state plus a distinct HttpOnly browser binding and S256 PKCE, without repo permissions', async () => {
    const e = config(); const r = await call(e, `${P}/start`); expect(r.status).toBe(302);
    const location = new URL(r.headers.get('location')!);
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('scope')).toBe('read:user');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(`${ROOT}${P}/callback`);
    const state = location.searchParams.get('state')!; const cookie = cookieOf(r);
    expect(cookie).not.toContain(state); expect(r.headers.get('set-cookie')).toContain('Secure; HttpOnly; SameSite=Lax');
    const row = await env.DB.prepare('SELECT verifier_ciphertext FROM browser_oauth_states WHERE state_hash=?').bind(await digest(state)).first<{ verifier_ciphertext: string }>();
    const verifier = await openCredential(row!.verifier_ciphertext, e.COLLABORATION_ENCRYPTION_KEY, `oauth:${await digest(state)}`);
    expect(await pkceChallenge(verifier)).toBe(location.searchParams.get('code_challenge'));
    userFixtures(e, undefined, b => expect(b.code_verifier).toBe(verifier));
    const finished = await call(e, `${P}/callback?state=${state}&code=synthetic_oauth_code_123`, cookie);
    expect(finished.status).toBe(303);
    expect((await finished.text())).not.toContain(SECRET);
  });
  it('rejects callback from a different browser before contacting GitHub', async () => {
    const e = config(), a = await begin(e), b = await begin(e);
    expect((await call(e, `${P}/callback?state=${a.state}&code=synthetic_oauth_code_123`, b.cookie)).status).toBe(400);
  });
  it('consumes callback state once and refuses replay', async () => {
    const e = config(), s = await begin(e); userFixtures(e);
    expect((await call(e, `${P}/callback?state=${s.state}&code=synthetic_oauth_code_123`, s.cookie)).status).toBe(303);
    expect((await call(e, `${P}/callback?state=${s.state}&code=synthetic_oauth_code_123`, s.cookie)).status).toBe(400);
  });
  it('rejects expired state and unsafe redirect targets', async () => {
    const e = config(), s = await begin(e, '//attacker.example');
    const row = await env.DB.prepare('SELECT return_path FROM browser_oauth_states WHERE state_hash=?').bind(await digest(s.state)).first();
    expect(row!.return_path).toBe('/');
    await env.DB.prepare('UPDATE browser_oauth_states SET expires_at=0 WHERE state_hash=?').bind(await digest(s.state)).run();
    expect((await call(e, `${P}/callback?state=${s.state}&code=synthetic_oauth_code_123`, s.cookie)).status).toBe(400);
  });
  it('refuses a GitHub account outside the explicit allowlist', async () => {
    const e = config(), s = await begin(e); userFixtures(e, Number(e.AUTH_GITHUB_APP_OWNER_ID)+1);
    const r = await call(e, `${P}/callback?state=${s.state}&code=synthetic_oauth_code_123`, s.cookie);
    expect(r.status).toBe(403); expect(r.headers.getSetCookie().some(v => v.startsWith('__Host-ap_session='))).toBe(false);
  });
  it('anchors the account to GitHub ID and never stores the provider bearer or plaintext session cookie', async () => {
    const c = await login(); const a = await access(c); expect(a.status).toBe('authenticated');
    expect(a.account).toBe(c.account); expect(a.access_token).toMatch(/^apb_/);
    expect(await lookupToken(env.DB, a.access_token!)).toMatchObject({ account: c.account, kind: 'human', role: 'human' });
    const rows = await env.DB.prepare('SELECT * FROM browser_sessions WHERE account=?').bind(c.account).all();
    expect(JSON.stringify(rows)).not.toContain(c.cookie.split('=')[1]);
    expect(JSON.stringify(rows)).not.toContain('synthetic-github-bearer');
    expect(JSON.stringify(rows)).not.toContain(a.access_token);
  });
  it('allows normal authenticated API calls, scoped agent creation and DO messages', async () => {
    const c = await login(), a = await access(c); const headers = { authorization: `Bearer ${a.access_token}` };
    expect((await call(c.e, '/api/me', '', undefined, { headers })).status).toBe(200);
    const slug = `gh-test-${c.e.AUTH_GITHUB_APP_OWNER_ID}`;
    expect((await call(c.e, '/api/channels', '', { slug }, { headers })).status).toBe(201);
    expect((await call(c.e, `/api/channels/${slug}/messages`, '', { kind:'message', body:'GitHub signed-in user', mentions:[], reply_to:null }, { headers })).status).toBe(200);
    const stub = env.CHANNELS.get(env.CHANNELS.idFromName(slug));
    await runInDurableObject(stub, async (instance: ChannelDO) => {
      const runtime = instance as unknown as { tokenActivity(hash: string): Promise<boolean>; isTokenActive(hash: string): Promise<boolean> };
      const hash = `browser:${await digest(a.access_token!)}`;
      expect(await runtime.tokenActivity(hash)).toBe(true); expect(await runtime.isTokenActive(hash)).toBe(true);
    });
  });
  it('revokes REST and DO access when the browser signs out', async () => {
    const c = await login(), a = await access(c);
    expect((await call(c.e, `${P}/logout`, c.cookie, {})).status).toBe(200);
    expect(await lookupToken(env.DB, a.access_token!)).toBeNull();
    expect((await access(c)).status).toBe('signed_out');
  });
  it('expires access tokens and preserves independent tokens for concurrent tabs', async () => {
    const c = await login(), first = await access(c), second = await access(c);
    expect(first.access_token).not.toBe(second.access_token);
    expect(await lookupToken(env.DB, first.access_token!)).not.toBeNull();
    await env.DB.prepare('UPDATE browser_access_tokens SET expires_at=0 WHERE hash=?').bind(await digest(first.access_token!)).run();
    expect(await lookupToken(env.DB, first.access_token!)).toBeNull(); expect(await lookupToken(env.DB, second.access_token!)).not.toBeNull();
  });
  it('rejects cross-origin and missing browser headers for security mutations', async () => {
    const c = await login();
    expect((await call(c.e, `${P}/security/setup`, c.cookie, {}, { headers: { origin: 'https://attacker.example' } })).status).toBe(403);
    expect((await call(c.e, `${P}/logout`, c.cookie, {}, { headers: { 'x-agentparty-browser': '' } })).status).toBe(403);
  });
  it('keeps enrollment optional and encrypted until a correct code confirms it', async () => {
    const c = await login();
    const setup = await call(c.e, `${P}/security/setup`, c.cookie, {}); const { secret } = await setup.json() as { secret: string };
    expect(secret).toHaveLength(32);
    const row = await env.DB.prepare('SELECT pending_totp FROM browser_sessions WHERE account=?').bind(c.account).first<{ pending_totp: string }>();
    expect(row!.pending_totp).not.toContain(secret);
    expect((await call(c.e, `${P}/security/confirm`, c.cookie, { code:'invalid' })).status).toBe(401);
    expect(await (await call(c.e, `${P}/security`, c.cookie)).json()).toMatchObject({ enabled:false });
  });
  it('does not permit stale-login enrollment or expired setup', async () => {
    const c = await login(); await call(c.e, `${P}/security/setup`, c.cookie, {});
    await env.DB.prepare('UPDATE browser_sessions SET pending_expires_at=0 WHERE account=?').bind(c.account).run();
    expect((await call(c.e, `${P}/security/confirm`, c.cookie, { code:'123456' })).status).toBe(409);
    await env.DB.prepare('UPDATE browser_sessions SET created_at=? WHERE account=?').bind(Date.now()-601000,c.account).run();
    expect((await call(c.e, `${P}/security/setup`, c.cookie, {})).status).toBe(403);
  });
  it('enables TOTP, returns ten one-time recovery codes and revokes other browser sessions', async () => {
    const c = await login(), other = await login(c.e), oldAccess = await access(other), initial = await access(c);
    const enabled = await enable(c); expect(enabled.codes).toHaveLength(10);
    const stored = await env.DB.prepare('SELECT * FROM browser_recovery_codes WHERE account=?').bind(c.account).all();
    expect(stored.results).toHaveLength(10); expect(JSON.stringify(stored)).not.toContain(enabled.codes[0]!.replace(/-/g,''));
    expect(await lookupToken(env.DB, oldAccess.access_token!)).toBeNull();
    expect(await lookupToken(env.DB, initial.access_token!)).toBeNull();
    expect((await access(c)).status).toBe('authenticated');
  });
  it('gives no API bearer until the second factor is verified', async () => {
    const c = await login(), enabled = await enable(c), next = await login(c.e);
    expect(await access(next)).toMatchObject({ status:'mfa_required' }); expect((await access(next)).access_token).toBeUndefined();
    expect((await call(next.e, `${P}/security`, next.cookie)).status).toBe(403);
    expect((await call(next.e, `${P}/verify`, next.cookie, { code:enabled.codes[0], recovery:true })).status).toBe(200);
    expect((await access(next)).status).toBe('authenticated');
  });
  it('rejects replayed TOTP and accepts a new time step', async () => {
    const c = await login(), enabled = await enable(c), next = await login(c.e); const step = Math.floor(Date.now()/30000);
    expect((await call(next.e, `${P}/verify`, next.cookie, { code:await totp(enabled.secret,step) })).status).toBe(401);
    expect((await call(next.e, `${P}/verify`, next.cookie, { code:await totp(enabled.secret,step+1) })).status).toBe(200);
  });
  it('cannot reuse a recovery code after a new GitHub login', async () => {
    const c = await login(), enabled = await enable(c), next = await login(c.e);
    expect((await call(next.e, `${P}/verify`, next.cookie, { code:enabled.codes[0], recovery:true })).status).toBe(200);
    const again = await login(c.e);
    expect((await call(again.e, `${P}/verify`, again.cookie, { code:enabled.codes[0], recovery:true })).status).toBe(401);
  });
  it('limits guessing across independently issued login challenges', async () => {
    const c = await login(); await enable(c);
    const a = await login(c.e), b = await login(c.e);
    // Enabling consumed one account-level attempt; six more leave one available.
    for (let i=0;i<7;i++) expect((await call(a.e, `${P}/verify`, a.cookie, { code:'bad' })).status).toBe(401);
    expect((await call(b.e, `${P}/verify`, b.cookie, { code:'bad' })).status).toBe(429);
  });
  it('requires a factor proof to disable and invalidates old access after disabling', async () => {
    const c = await login(), enabled = await enable(c), a = await access(c);
    expect((await call(c.e, `${P}/security/disable`, c.cookie, { code:'bad' })).status).toBe(401);
    expect((await call(c.e, `${P}/security/disable`, c.cookie, { code:enabled.codes[0],recovery:true })).status).toBe(200);
    expect(await lookupToken(env.DB,a.access_token!)).toBeNull();
    expect(await (await call(c.e, `${P}/security`, c.cookie)).json()).toMatchObject({ enabled:false,recovery_remaining:0 });
    expect((await access(await login(c.e))).status).toBe('authenticated');
  });
  it('recovery-code rotation atomically replaces the previous set', async () => {
    const c = await login(), enabled = await enable(c);
    const rotated = await call(c.e, `${P}/security/recovery-codes`, c.cookie, { code:enabled.codes[0],recovery:true }); expect(rotated.status).toBe(200);
    const { recovery_codes: codes } = await rotated.json() as { recovery_codes: string[] }; expect(codes).toHaveLength(10);
    const next = await login(c.e);
    expect((await call(next.e, `${P}/verify`, next.cookie, { code:enabled.codes[1],recovery:true })).status).toBe(401);
    expect((await call(next.e, `${P}/verify`, next.cookie, { code:codes[0],recovery:true })).status).toBe(200);
  });
  it('never accepts a legacy human token for protected browser security actions', async () => {
    const e = config();
    expect((await call(e, `${P}/security/setup`, '', {}, { headers:{ authorization:'Bearer ap_not_a_browser_session' } })).status).toBe(401);
  });
  it('fails closed without GitHub configuration', async () => {
    const e = config(); e.GITHUB_CLIENT_ID=undefined; e.GITHUB_CLIENT_SECRET=undefined;
    expect((await call(e, `${P}/start`)).status).toBe(503);
    expect(await (await call(e, `${P}/session`)).json()).toMatchObject({configured:false,status:'signed_out'});
  });
  it('rejects missing or expired bootstrap credentials', async () => {
    const e=config(); e.GITHUB_CLIENT_ID=undefined;e.GITHUB_CLIENT_SECRET=undefined;
    e.AUTH_SETUP_TOKEN_HASH=await digest('a'.repeat(64));e.AUTH_SETUP_EXPIRES_AT=String(Date.now()-1);
    expect((await call(e,`${P}/registration/start`,'',{setup_key:'a'.repeat(64)})).status).toBe(403);
  });
  it('registration manifest asks for no repository permissions and binds a secure browser state', async () => {
    const e=config();e.GITHUB_CLIENT_ID=undefined;e.GITHUB_CLIENT_SECRET=undefined;
    e.AUTH_SETUP_TOKEN_HASH=await digest('a'.repeat(64));e.AUTH_SETUP_EXPIRES_AT=String(Date.now()+60000);
    const r=await call(e,`${P}/registration/start`,'',{setup_key:'a'.repeat(64)});expect(r.status).toBe(200);
    const data=await r.json() as {manifest:Record<string,unknown>;action:string};
    expect(data.manifest).toMatchObject({public:false,default_permissions:{},default_events:[],hook_attributes:{active:false}});
    expect(data.action).toMatch(/^https:\/\/github.com\/settings\/apps\/new\?state=/);
    expect(r.headers.get('set-cookie')).toContain('__Host-ap_setup=');
  });
});
