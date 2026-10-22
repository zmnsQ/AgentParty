// Test-only setup. No production endpoint can create verified browser sessions this way.
import { env } from "cloudflare:test";
import { sha256Hex } from "../src/auth";
import { uniq } from "./helpers";
export async function enableMcpFixture(slug:string,account:string,write=true,events=true) {
  await env.DB.prepare(`INSERT INTO browser_account_security(account,github_id,login,enabled,version,last_step,updated_at)
    VALUES(?,?,?,1,0,-1,?) ON CONFLICT(account) DO UPDATE SET enabled=1`)
    .bind(account,uniq("mfa-github"),"test-only",Date.now()).run();
  await env.DB.prepare(`INSERT INTO channel_mcp_security(channel_slug,enabled,allow_write,allow_events,updated_by,updated_at)
    VALUES(?,1,?,?,?,?) ON CONFLICT(channel_slug) DO UPDATE SET enabled=1,allow_write=excluded.allow_write,allow_events=excluded.allow_events`)
    .bind(slug,write?1:0,events?1:0,account,Date.now()).run();
}
export async function browserOwnerFixture(account:string,mfa:boolean) {
  await env.DB.prepare(`INSERT INTO browser_account_security(account,github_id,login,enabled,version,last_step,updated_at)
    VALUES(?,?,?,?,0,-1,?) ON CONFLICT(account) DO UPDATE SET enabled=excluded.enabled`)
    .bind(account,uniq("github-owner"),"owner",mfa?1:0,Date.now()).run();
  const id=crypto.randomUUID(),secret=crypto.randomUUID().replaceAll("-","").repeat(2),token="apb_"+secret;
  await env.DB.prepare(`INSERT INTO browser_sessions(id,cookie_hash,account,stage,auth_version,created_at,expires_at)
    VALUES(?,?,?,'ready',0,?,?)`).bind(id,await sha256Hex(secret+"cookie"),account,Date.now(),Date.now()+60_000).run();
  await env.DB.prepare(`INSERT INTO browser_access_tokens(hash,session_id,auth_version,expires_at) VALUES(?,?,0,?)`)
    .bind(await sha256Hex(token),id,Date.now()+60_000).run();
  return token;
}
