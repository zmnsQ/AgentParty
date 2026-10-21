import type { TokenIdentity } from '../auth';
import { digest, randomHex } from './crypto';
export const BROWSER_COOKIE = '__Host-ap_session';
export const ACCESS_MS = 10 * 60_000;
export const SESSION_MS = 7 * 24 * 60 * 60_000;
export interface BrowserSession {
  id: string; account: string; stage: 'ready' | 'mfa'; auth_version: number;
  created_at: number; expires_at: number; pending_totp: string | null; pending_expires_at: number | null;
  github_id: string; login: string; enabled: number; version: number; last_step: number; totp_ciphertext: string | null;
}
export function cookieValue(request: Request, name: string): string | null {
  const parts = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${name}=`));
  if (parts.length !== 1) return null;
  const value = parts[0]!.slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function setCookie(name: string, value: string, seconds: number): string {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;
}
export async function readBrowserSession(db: D1Database, request: Request): Promise<BrowserSession | null> {
  const raw = cookieValue(request, BROWSER_COOKIE); if (!raw) return null;
  return db.prepare(`SELECT s.*, a.github_id,a.login,a.enabled,a.version,a.last_step,a.totp_ciphertext
    FROM browser_sessions s JOIN browser_account_security a ON a.account=s.account
    WHERE s.cookie_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=a.version`)
    .bind(await digest(raw), Date.now()).first<BrowserSession>();
}
export async function lookupBrowserAccess(db: D1Database, hash: string): Promise<TokenIdentity | null> {
  const row = await db.prepare(`SELECT s.id,s.account,a.github_id,a.login FROM browser_access_tokens t
    JOIN browser_sessions s ON s.id=t.session_id JOIN browser_account_security a ON a.account=s.account
    WHERE t.hash=? AND t.expires_at>? AND s.expires_at>? AND s.revoked_at IS NULL AND s.stage='ready'
      AND t.auth_version=s.auth_version AND s.auth_version=a.version`)
    .bind(hash, Date.now(), Date.now()).first<{ id: string; account: string; github_id: string; login: string }>();
  return row ? { name: `github-${row.github_id}`, role: 'human', kind: 'human', hash: `browser:${hash}`,
    owner: row.account, account: row.account, displayName: row.login, browserSessionId: row.id } : null;
}
export async function mintBrowserAccess(db: D1Database, session: BrowserSession): Promise<{ access_token: string; expires_at: number }> {
  const token = `apb_${randomHex()}`; const expires = Math.min(Date.now() + ACCESS_MS, session.expires_at);
  const result = await db.prepare(`INSERT INTO browser_access_tokens(hash,session_id,auth_version,expires_at)
    SELECT ?,s.id,s.auth_version,? FROM browser_sessions s JOIN browser_account_security a ON a.account=s.account
    WHERE s.id=? AND s.stage='ready' AND s.revoked_at IS NULL AND s.expires_at>? AND s.auth_version=a.version`)
    .bind(await digest(token), expires, session.id, Date.now()).run();
  if (result.meta.changes !== 1) throw new Error('Session changed');
  return { access_token: token, expires_at: expires };
}
