import type { TokenIdentity } from "../auth";

export interface McpSecurity {
  enabled:boolean; allow_write:boolean; allow_events:boolean;
  owner_mfa_enabled:boolean; require_mfa:true; updated_at:number|null;
}
interface PolicyRow {
  enabled:number|null; allow_write:number|null; allow_events:number|null;
  owner_mfa_enabled:number|null; updated_at:number|null;
}
/** Absent policy or owner account => deny. Read the actual owner on every call. */
export async function mcpSecurity(db:D1Database,slug:string):Promise<McpSecurity> {
  const row=await db.prepare(`SELECT p.enabled,p.allow_write,p.allow_events,p.updated_at,
    a.enabled AS owner_mfa_enabled FROM channels c
    LEFT JOIN channel_mcp_security p ON p.channel_slug=c.slug
    LEFT JOIN browser_account_security a ON a.account=c.owner_account
    WHERE c.slug=? AND c.archived_at IS NULL`).bind(slug).first<PolicyRow>();
  return {enabled:row?.enabled===1,allow_write:row?.allow_write===1,
    allow_events:row?.allow_events===1,owner_mfa_enabled:row?.owner_mfa_enabled===1,
    require_mfa:true,updated_at:row?.updated_at??null};
}
export async function mcpPermission(db:D1Database,slug:string,scope:string):Promise<boolean> {
  const policy=await mcpSecurity(db,slug);
  if(!policy.enabled||!policy.owner_mfa_enabled)return false;
  return scope==="group.read" || (scope==="group.write"&&policy.allow_write)
    || (scope==="group.events"&&policy.allow_events);
}
/** Permission increases require a ready, version-current browser session that
 * completed this application's TOTP/recovery-code login; a GitHub OAuth token
 * or a legacy human API key alone is not sufficient. */
export async function verifiedMfaOwner(db:D1Database,identity:TokenIdentity):Promise<boolean> {
  if(identity.kind!=="human"||identity.role!=="human"||!identity.browserSessionId||!identity.account)return false;
  const row=await db.prepare(`SELECT s.id FROM browser_sessions s
    JOIN browser_account_security a ON a.account=s.account
    WHERE s.id=? AND s.account=? AND s.stage='ready' AND s.revoked_at IS NULL
    AND s.expires_at>? AND s.auth_version=a.version AND a.enabled=1`)
    .bind(identity.browserSessionId,identity.account,Date.now()).first();
  return row!==null;
}
/** Stable per-credential bucket, not a new database key for every request. */
export async function takeMcpRateLimit(db:D1Database,hash:string):Promise<boolean> {
  const now=Date.now();
  const rate=await db.prepare(`INSERT INTO browser_auth_limits(key,window_at,attempts) VALUES(?,?,1)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_at<? THEN 1 ELSE attempts+1 END,
    window_at=CASE WHEN window_at<? THEN excluded.window_at ELSE window_at END RETURNING attempts`)
    .bind("mcp:"+hash,now,now-60_000,now-60_000).first<{attempts:number}>();
  return rate!==null&&rate.attempts<=120;
}
