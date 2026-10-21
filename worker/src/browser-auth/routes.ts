import type { Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppContext, AppEnv } from '../index';
import { openCredential, sealCredential } from '../collaboration/vault';
import { digest, equal, newRecoveryCodes, newTotpSeed, pkceChallenge, randomHex, recoveryHash, recoveryValue, validTotpStep } from './crypto';
import { BROWSER_COOKIE, SESSION_MS, cookieValue, mintBrowserAccess, readBrowserSession, setCookie, type BrowserSession } from './session';

type Ctx = Context<AppContext>;
interface GithubConfig { clientId: string; clientSecret: string; kind: 'github-app' | 'oauth-app'; ownerId?: string; }
interface OAuthState { verifier_ciphertext: string | null; return_path: string; }
const PREFIX = '/api/auth/github';
const OAUTH_COOKIE = '__Host-ap_oauth';
const SETUP_COOKIE = '__Host-ap_setup';
const MFA_LIMIT_WINDOW = 5 * 60_000;
class AuthFailure extends Error {
  constructor(public code: string, public status: ContentfulStatusCode = 400) { super(code); }
}
function fail(code: string, status: ContentfulStatusCode = 400): never { throw new AuthFailure(code, status); }
function origin(env: AppEnv): string {
  try {
    const u = new URL(env.AUTH_PUBLIC_ORIGIN ?? '');
    if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash) return fail('authentication_not_configured', 503);
    return u.origin;
  } catch { return fail('authentication_not_configured', 503); }
}
function csrf(c: Ctx): void {
  if (c.req.header('origin') !== origin(c.env) || c.req.header('x-agentparty-browser') !== '1') fail('origin_not_allowed', 403);
  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') fail('origin_not_allowed', 403);
}
function returnPath(value: string | undefined): string {
  if (!value || value.length > 1000 || !/^\/(?!\/)/.test(value) || /[\\\x00-\x20\x7f]/.test(value) || value.startsWith('/api/')) return '/';
  return value;
}
function wrap(fn: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx): Promise<Response> => {
    c.header('cache-control', 'no-store'); c.header('pragma', 'no-cache'); c.header('referrer-policy', 'no-referrer');
    try { return await fn(c); }
    catch (e) {
      // Never return GitHub response bodies, SQL errors, codes, secrets or exception causes.
      return c.json({ error: { code: e instanceof AuthFailure ? e.code : 'authentication_unavailable' } }, e instanceof AuthFailure ? e.status : 503);
    }
  };
}
async function body(c: Ctx): Promise<Record<string, unknown>> {
  if (c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return fail('invalid_request');
  const reader = c.req.raw.body?.getReader(); if (!reader) return fail('invalid_request');
  let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    while (true) {
      const v = await reader.read(); if (v.done) break;
      size += v.value.byteLength; if (size > 4096) return fail('invalid_request', 413);
      text += decoder.decode(v.value, { stream: true });
    }
    const parsed: unknown = JSON.parse(text + decoder.decode());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('invalid_request');
    return parsed as Record<string, unknown>;
  } catch (e) { if (e instanceof AuthFailure) throw e; return fail('invalid_request'); }
  finally { await reader.cancel().catch(() => {}); }
}
async function limit(db: D1Database, key: string, maximum: number, window = MFA_LIMIT_WINDOW): Promise<void> {
  const now = Date.now();
  const row = await db.prepare(`INSERT INTO browser_auth_limits(key,window_at,attempts) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_at<=? THEN 1 ELSE attempts+1 END,
      window_at=CASE WHEN window_at<=? THEN excluded.window_at ELSE window_at END RETURNING attempts`)
    .bind(key, now, now - window, now - window).first<{ attempts: number }>();
  if (!row || row.attempts > maximum) return fail('too_many_attempts', 429);
}
async function ipLimit(c: Ctx): Promise<void> {
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  await limit(c.env.DB, `oauth:${await digest(ip)}`, 30, 10 * 60_000);
}
async function githubJson(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const timer = new AbortController(); const deadline = setTimeout(() => timer.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal: timer.signal,
      headers: { accept: 'application/json', 'user-agent': 'AgentParty-Commons-Login', 'x-github-api-version': '2022-11-28', ...init.headers } });
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return fail('github_request_failed', 502);
    const reader = response.body?.getReader(); if (!reader) return fail('github_request_failed', 502);
    let size = 0, text = ''; const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 256 * 1024) return fail('github_request_failed', 502);
        text += decoder.decode(part.value, { stream: true });
      }
      const data: unknown = JSON.parse(text + decoder.decode());
      if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('github_request_failed', 502);
      return data as Record<string, unknown>;
    } finally { await reader.cancel().catch(() => {}); }
  } catch (e) { if (e instanceof AuthFailure) throw e; return fail('github_request_failed', 502); }
  finally { clearTimeout(deadline); }
}
export async function githubConfiguration(env: AppEnv): Promise<GithubConfig | null> {
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) return { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET, kind: env.GITHUB_AUTH_KIND === 'github-app' ? 'github-app' : 'oauth-app', ownerId: env.AUTH_GITHUB_APP_OWNER_ID };
  const row = await env.DB.prepare("SELECT ciphertext FROM browser_auth_settings WHERE id='github'").first<{ ciphertext: string }>();
  if (!row) return null;
  return JSON.parse(await openCredential(row.ciphertext, env.COLLABORATION_ENCRYPTION_KEY, 'browser-auth:github-config')) as GithubConfig;
}
function permitted(env: AppEnv, config: GithubConfig, id: string): boolean {
  const ids = (env.AUTH_GITHUB_ALLOWED_IDS ?? env.AUTH_GITHUB_APP_OWNER_ID ?? config.ownerId ?? '').split(',').map(v => v.trim());
  return ids.includes(id);
}
async function createState(c: Ctx, kind: 'login' | 'registration', path = '/') {
  const state = randomHex(), browser = randomHex(), verifier = randomHex();
  const ttl = kind === 'login' ? 600 : 3600;
  const encrypted = kind === 'login' ? await sealCredential(verifier, c.env.COLLABORATION_ENCRYPTION_KEY, `oauth:${await digest(state)}`) : null;
  await c.env.DB.prepare('INSERT INTO browser_oauth_states(state_hash,browser_hash,kind,verifier_ciphertext,return_path,expires_at) VALUES(?,?,?,?,?,?)')
    .bind(await digest(state), await digest(browser), kind, encrypted, path, Date.now() + ttl * 1000).run();
  c.header('set-cookie', setCookie(kind === 'login' ? OAUTH_COOKIE : SETUP_COOKIE, browser, ttl));
  // Bounded maintenance, only expired ephemeral records.
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM browser_oauth_states WHERE state_hash IN (SELECT state_hash FROM browser_oauth_states WHERE expires_at<? LIMIT 100)').bind(Date.now()),
    c.env.DB.prepare('DELETE FROM browser_access_tokens WHERE hash IN (SELECT hash FROM browser_access_tokens WHERE expires_at<? LIMIT 100)').bind(Date.now()),
    c.env.DB.prepare('DELETE FROM browser_auth_limits WHERE key IN (SELECT key FROM browser_auth_limits WHERE window_at<? LIMIT 100)').bind(Date.now() - 86_400_000),
  ]);
  return { state, verifier };
}
async function consumeState(c: Ctx, kind: 'login' | 'registration'): Promise<OAuthState> {
  const state = c.req.query('state') ?? ''; const cookie = cookieValue(c.req.raw, kind === 'login' ? OAUTH_COOKIE : SETUP_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(state) || !cookie) return fail('invalid_oauth_state');
  const row = await c.env.DB.prepare('DELETE FROM browser_oauth_states WHERE state_hash=? AND browser_hash=? AND kind=? AND expires_at>? RETURNING verifier_ciphertext,return_path')
    .bind(await digest(state), await digest(cookie), kind, Date.now()).first<OAuthState>();
  if (!row) return fail('invalid_oauth_state');
  c.header('set-cookie', setCookie(kind === 'login' ? OAUTH_COOKIE : SETUP_COOKIE, '', 0));
  return row;
}
async function session(c: Ctx, ready = true, recent = false): Promise<BrowserSession> {
  const current = await readBrowserSession(c.env.DB, c.req.raw);
  if (!current) return fail('login_required', 401);
  if (ready && current.stage !== 'ready') return fail('second_factor_required', 403);
  if (recent && Date.now() - current.created_at > 10 * 60_000) return fail('recent_login_required', 403);
  return current;
}
async function consumeProof(c: Ctx, current: BrowserSession, input: Record<string, unknown>): Promise<void> {
  await limit(c.env.DB, `mfa:${current.account}`, 8);
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  if (input.recovery === true) {
    const normalized = recoveryValue(code); if (!normalized) return fail('invalid_verification_code', 401);
    const row = await c.env.DB.prepare(`DELETE FROM browser_recovery_codes WHERE account=? AND hash=?
      AND EXISTS(SELECT 1 FROM browser_account_security WHERE account=? AND version=? AND enabled=1) RETURNING hash`)
      .bind(current.account, await recoveryHash(current.account, normalized), current.account, current.version).first();
    if (!row) return fail('invalid_verification_code', 401);
    return;
  }
  if (!current.enabled || !current.totp_ciphertext) return fail('second_factor_not_enabled', 409);
  const seed = await openCredential(current.totp_ciphertext, c.env.COLLABORATION_ENCRYPTION_KEY, `totp:${current.account}`);
  const step = await validTotpStep(seed, code, current.last_step);
  if (step === null) return fail('invalid_verification_code', 401);
  const changed = await c.env.DB.prepare('UPDATE browser_account_security SET last_step=? WHERE account=? AND version=? AND enabled=1 AND last_step<?')
    .bind(step, current.account, current.version, step).run();
  if (changed.meta.changes !== 1) return fail('invalid_verification_code', 401);
}
function mutationTail(c: Ctx, current: BrowserSession, changeId: string) {
  const exists = 'EXISTS(SELECT 1 FROM browser_account_security WHERE account=? AND change_id=?)';
  return [
    c.env.DB.prepare(`UPDATE browser_sessions SET auth_version=auth_version+1,pending_totp=NULL,pending_expires_at=NULL WHERE id=? AND auth_version=? AND ${exists}`)
      .bind(current.id, current.version, current.account, changeId),
    c.env.DB.prepare(`UPDATE browser_sessions SET revoked_at=? WHERE account=? AND id<>? AND revoked_at IS NULL AND ${exists}`)
      .bind(Date.now(), current.account, current.id, current.account, changeId),
    c.env.DB.prepare(`UPDATE desktop_sessions SET revoked_at=? WHERE account=? AND revoked_at IS NULL AND ${exists}`)
      .bind(Date.now(), current.account, current.account, changeId),
  ];
}
export function registerBrowserAuth(app: Hono<AppContext>, deps: { enroll(db: D1Database, account: string, by: string): Promise<unknown> }) {
  app.get(`${PREFIX}/session`, wrap(async c => {
    const configured = (await githubConfiguration(c.env)) !== null;
    const current = await readBrowserSession(c.env.DB, c.req.raw);
    if (!current) return c.json({ configured, status: 'signed_out' });
    if (current.stage !== 'ready') return c.json({ configured, status: 'mfa_required' });
    const access = await mintBrowserAccess(c.env.DB, current);
    return c.json({ configured, status: 'authenticated', ...access, account: current.account, login: current.login, mfa_enabled: current.enabled === 1 });
  }));
  app.get(`${PREFIX}/start`, wrap(async c => {
    const config = await githubConfiguration(c.env); if (!config) return fail('authentication_not_configured', 503);
    const publicOrigin = origin(c.env); await ipLimit(c);
    const state = await createState(c, 'login', returnPath(c.req.query('return_to')));
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${publicOrigin}${PREFIX}/callback`,
      state: state.state, code_challenge: await pkceChallenge(state.verifier), code_challenge_method: 'S256', allow_signup: 'false' }).toString();
    if (config.kind === 'oauth-app') url.searchParams.set('scope', 'read:user');
    return c.redirect(url.toString(), 302);
  }));
  app.get(`${PREFIX}/callback`, wrap(async c => {
    const state = await consumeState(c, 'login');
    const code = c.req.query('code') ?? ''; if (!/^[a-zA-Z0-9_\-]{10,256}$/.test(code)) return fail('github_authorization_cancelled');
    const config = await githubConfiguration(c.env); if (!config || !state.verifier_ciphertext) return fail('authentication_not_configured', 503);
    const verifier = await openCredential(state.verifier_ciphertext, c.env.COLLABORATION_ENCRYPTION_KEY, `oauth:${await digest(c.req.query('state')!)}`);
    const response = await githubJson('https://github.com/login/oauth/access_token', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, code_verifier: verifier, redirect_uri: `${origin(c.env)}${PREFIX}/callback` }) });
    if (typeof response.access_token !== 'string' || response.token_type !== 'bearer' || response.access_token.length > 4096) return fail('github_request_failed', 502);
    const user = await githubJson('https://api.github.com/user', { headers: { authorization: `Bearer ${response.access_token}` } });
    // Drop the GitHub bearer as soon as identity has been verified. Never store it.
    response.access_token = undefined; response.refresh_token = undefined;
    if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.login !== 'string' || !/^[a-zA-Z0-9-]{1,39}$/.test(user.login)) return fail('github_request_failed', 502);
    const githubId = String(user.id); if (!permitted(c.env, config, githubId)) return fail('account_not_allowed', 403);
    const account = `github:${githubId}`; const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO browser_account_security(account,github_id,login,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(account) DO UPDATE SET login=excluded.login,updated_at=excluded.updated_at`).bind(account, githubId, user.login, now),
      c.env.DB.prepare(`INSERT INTO account_profiles(account,handle,created_at,updated_at,display_name,provider,provider_user_id,tenant_key)
        VALUES(?,?,?,?,?,'github',?,'github.com') ON CONFLICT(account) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`)
        .bind(account, `gh-${githubId}`, now, now, user.login, githubId),
    ]);
    await deps.enroll(c.env.DB, account, 'github-login-allowlist');
    const old = await readBrowserSession(c.env.DB, c.req.raw);
    if (old) await c.env.DB.prepare('UPDATE browser_sessions SET revoked_at=? WHERE id=?').bind(now, old.id).run();
    const cookie = randomHex(); const id = crypto.randomUUID();
    // Bind new session to the *current* MFA version within the INSERT statement.
    await c.env.DB.prepare(`INSERT INTO browser_sessions(id,cookie_hash,account,stage,auth_version,created_at,expires_at)
      SELECT ?,?,account,CASE WHEN enabled=1 THEN 'mfa' ELSE 'ready' END,version,?,
        CASE WHEN enabled=1 THEN ? ELSE ? END FROM browser_account_security WHERE account=?`)
      .bind(id, await digest(cookie), now, now + 10 * 60_000, now + SESSION_MS, account).run();
    c.header('set-cookie', setCookie(BROWSER_COOKIE, cookie, SESSION_MS / 1000), { append: true });
    // The return path contains no credentials; the browser restores via its HttpOnly cookie.
    return c.redirect(state.return_path, 303);
  }));
  app.post(`${PREFIX}/logout`, wrap(async c => {
    csrf(c); const current = await readBrowserSession(c.env.DB, c.req.raw);
    if (current) await c.env.DB.prepare('UPDATE browser_sessions SET revoked_at=? WHERE id=?').bind(Date.now(), current.id).run();
    c.header('set-cookie', setCookie(BROWSER_COOKIE, '', 0)); return c.json({ ok: true });
  }));
  app.post(`${PREFIX}/verify`, wrap(async c => {
    csrf(c); const current = await session(c, false); if (current.stage !== 'mfa') return fail('verification_not_pending', 409);
    await consumeProof(c, current, await body(c));
    const result = await c.env.DB.prepare(`UPDATE browser_sessions SET stage='ready',expires_at=? WHERE id=? AND stage='mfa'
      AND revoked_at IS NULL AND expires_at>? AND auth_version=(SELECT version FROM browser_account_security WHERE account=?)`)
      .bind(Date.now() + SESSION_MS, current.id, Date.now(), current.account).run();
    if (result.meta.changes !== 1) return fail('login_required', 401);
    return c.json({ ok: true });
  }));
  app.get(`${PREFIX}/security`, wrap(async c => {
    const current = await session(c);
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM browser_recovery_codes WHERE account=?').bind(current.account).first<{ n: number }>();
    return c.json({ enabled: current.enabled === 1, recovery_remaining: count?.n ?? 0, recent_login: Date.now() - current.created_at <= 10 * 60_000, login: current.login });
  }));
  app.post(`${PREFIX}/security/setup`, wrap(async c => {
    csrf(c); const current = await session(c, true, true);
    if (current.enabled) return fail('second_factor_already_enabled', 409);
    await limit(c.env.DB, `setup:${current.account}`, 5);
    const seed = newTotpSeed();
    const encrypted = await sealCredential(seed, c.env.COLLABORATION_ENCRYPTION_KEY, `totp:${current.account}`);
    await c.env.DB.prepare('UPDATE browser_sessions SET pending_totp=?,pending_expires_at=? WHERE id=? AND revoked_at IS NULL')
      .bind(encrypted, Date.now() + 10 * 60_000, current.id).run();
    return c.json({ secret: seed, otpauth_uri: `otpauth://totp/${encodeURIComponent(`AgentParty Commons:${current.login}`)}?${new URLSearchParams({ secret: seed, issuer: 'AgentParty Commons', algorithm: 'SHA1', digits: '6', period: '30' })}` });
  }));
  app.post(`${PREFIX}/security/confirm`, wrap(async c => {
    csrf(c); const current = await session(c, true, true); const input = await body(c);
    if (current.enabled || !current.pending_totp || !current.pending_expires_at || current.pending_expires_at <= Date.now()) return fail('setup_expired', 409);
    await limit(c.env.DB, `mfa:${current.account}`, 8);
    const seed = await openCredential(current.pending_totp, c.env.COLLABORATION_ENCRYPTION_KEY, `totp:${current.account}`);
    const step = await validTotpStep(seed, typeof input.code === 'string' ? input.code.trim() : '', -1);
    if (step === null) return fail('invalid_verification_code', 401);
    const recovery = await newRecoveryCodes(current.account); const changeId = crypto.randomUUID();
    const changed = await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE browser_account_security SET enabled=1,totp_ciphertext=?,version=version+1,last_step=?,change_id=?,updated_at=?
        WHERE account=? AND enabled=0 AND version=? AND EXISTS(SELECT 1 FROM browser_sessions WHERE id=? AND revoked_at IS NULL AND stage='ready' AND pending_totp=? AND pending_expires_at>?)`)
        .bind(current.pending_totp, step, changeId, Date.now(), current.account, current.version, current.id, current.pending_totp, Date.now()),
      ...recovery.hashes.map(hash => c.env.DB.prepare('INSERT INTO browser_recovery_codes(account,hash) SELECT account,? FROM browser_account_security WHERE account=? AND change_id=?').bind(hash, current.account, changeId)),
      ...mutationTail(c, current, changeId),
    ]);
    if (changed[0]!.meta.changes !== 1) return fail('security_state_changed', 409);
    return c.json({ enabled: true, recovery_codes: recovery.codes });
  }));
  for (const action of ['disable', 'recovery-codes'] as const) {
    app.post(`${PREFIX}/security/${action}`, wrap(async c => {
      csrf(c); const current = await session(c); if (!current.enabled) return fail('second_factor_not_enabled', 409);
      await consumeProof(c, current, await body(c));
      const recovery = action === 'recovery-codes' ? await newRecoveryCodes(current.account) : { codes: [], hashes: [] };
      const changeId = crypto.randomUUID();
      const changed = await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE browser_account_security SET version=version+1,change_id=?,updated_at=?,
          enabled=CASE WHEN ?=1 THEN 0 ELSE enabled END,totp_ciphertext=CASE WHEN ?=1 THEN NULL ELSE totp_ciphertext END
          WHERE account=? AND version=? AND enabled=1 AND EXISTS(SELECT 1 FROM browser_sessions WHERE id=? AND stage='ready' AND revoked_at IS NULL AND expires_at>?)`)
          .bind(changeId, Date.now(), action === 'disable' ? 1 : 0, action === 'disable' ? 1 : 0, current.account, current.version, current.id, Date.now()),
        c.env.DB.prepare('DELETE FROM browser_recovery_codes WHERE account=? AND EXISTS(SELECT 1 FROM browser_account_security WHERE account=? AND change_id=?)').bind(current.account, current.account, changeId),
        ...recovery.hashes.map(hash => c.env.DB.prepare('INSERT INTO browser_recovery_codes(account,hash) SELECT account,? FROM browser_account_security WHERE account=? AND change_id=?').bind(hash, current.account, changeId)),
        ...mutationTail(c, current, changeId),
      ]);
      if (changed[0]!.meta.changes !== 1) return fail('security_state_changed', 409);
      return c.json({ enabled: action !== 'disable', ...(action === 'disable' ? {} : { recovery_codes: recovery.codes }) });
    }));
  }
  app.post(`${PREFIX}/registration/start`, wrap(async c => {
    csrf(c); if (await githubConfiguration(c.env)) return fail('already_configured', 409);
    await ipLimit(c); const input = await body(c);
    const key = typeof input.setup_key === 'string' ? input.setup_key : '';
    if (!/^[a-f0-9]{64}$/.test(key) || !c.env.AUTH_SETUP_TOKEN_HASH || !equal(await digest(key), c.env.AUTH_SETUP_TOKEN_HASH)
      || !c.env.AUTH_SETUP_EXPIRES_AT || Number(c.env.AUTH_SETUP_EXPIRES_AT) <= Date.now()
      || !/^[1-9][0-9]{0,15}$/.test(c.env.AUTH_GITHUB_APP_OWNER_ID ?? '')) return fail('setup_not_authorized', 403);
    const root = origin(c.env); const state = await createState(c, 'registration');
    return c.json({ action: `https://github.com/settings/apps/new?state=${state.state}`, manifest: {
      name: `Commons Login ${c.env.AUTH_GITHUB_APP_OWNER_ID}`,
      url: root, redirect_url: `${root}${PREFIX}/registration/callback`, callback_urls: [`${root}${PREFIX}/callback`],
      hook_attributes: { url: `${root}/api/auth/github/webhook-disabled`, active: false },
      public: false, default_permissions: {}, default_events: [], request_oauth_on_install: false,
      description: 'Private GitHub sign-in for AgentParty Commons, derived from AgentParty. No repository permissions requested.',
    } });
  }));
  app.get(`${PREFIX}/registration/callback`, wrap(async c => {
    await consumeState(c, 'registration');
    if (await githubConfiguration(c.env)) return fail('already_configured', 409);
    const code = c.req.query('code') ?? ''; if (!/^[a-zA-Z0-9_\-]{10,256}$/.test(code)) return fail('invalid_registration_code');
    const config = await githubJson(`https://api.github.com/app-manifests/${code}/conversions`, { method: 'POST' });
    const owner = config.owner as { id?: unknown } | undefined;
    if (!owner || typeof owner.id !== 'number' || String(owner.id) !== c.env.AUTH_GITHUB_APP_OWNER_ID
      || typeof config.client_id !== 'string' || config.client_id.length > 100
      || typeof config.client_secret !== 'string' || config.client_secret.length > 256) return fail('registration_owner_mismatch', 403);
    const saved: GithubConfig = { clientId: config.client_id, clientSecret: config.client_secret, kind: 'github-app', ownerId: String(owner.id) };
    const ciphertext = await sealCredential(JSON.stringify(saved), c.env.COLLABORATION_ENCRYPTION_KEY, 'browser-auth:github-config');
    // First successful registration wins; never overwrite a configured application.
    const result = await c.env.DB.prepare("INSERT OR IGNORE INTO browser_auth_settings(id,ciphertext,created_at) VALUES('github',?,?)").bind(ciphertext, Date.now()).run();
    if (result.meta.changes !== 1) return fail('already_configured', 409);
    return c.redirect(`${origin(c.env)}${PREFIX}/start`, 303);
  }));
}
