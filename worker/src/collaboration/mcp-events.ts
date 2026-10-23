import {pushEventDefinition} from './mcp-event-stream';
import type { AppEnv } from "../index";
import type { TokenIdentity } from "../auth";
import { sha256Hex } from "../auth";
import { mcpPermission } from "./mcp-security";
import { openCredential, sealCredential } from "./vault";
import {hasPinnedCallbackTransport, validateCallbackTarget, postSignedCallback} from "./event-transport";

const VERSION = "2026-07-28";
const EVENT = "message.created";
const MAX_QUEUE_BATCH = 12;
const RETRIES = 6;
const TIMEOUT_MS = 10_000;
const encoder = new TextEncoder();
type JsonMap = Record<string, unknown>;
interface Subscription {
  id: string; channel_slug: string; owner_account: string; agent_name: string; agent_token_hash: string;
  name: string; filter_json: string; callback_fingerprint: string;
  callback_ciphertext: string; secret_ciphertext: string;
  expires_at: number; revoked_at: number | null;
}
interface Pending {
  id: string; event_id: string; payload_json: string; state: string; attempts: number;
  lease_until: number; lease_token: string | null; subscription_id: string; channel_slug: string;
  callback_ciphertext: string; secret_ciphertext: string; agent_token_hash: string;
  agent_name: string; owner_account: string;
  expires_at: number; revoked_at: number | null;
}
const record = (v: unknown): v is JsonMap => v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(v);
const response = (value: unknown) => value;

function error(code: number, message: string, data?: unknown) {
  return { error: { code, message, ...(data === undefined ? {} : { data }) } };
}
function failReason(msg: string): never { throw new Error(msg); }
function secretBytes(secret: unknown): Uint8Array {
  if (typeof secret !== "string" || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) return failReason("invalid_secret");
  const data = secret.slice(6);
  if (data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) return failReason("invalid_secret");
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(data), ch => ch.charCodeAt(0)); } catch { return failReason("invalid_secret"); }
  if (bytes.byteLength < 24 || bytes.byteLength > 64) return failReason("invalid_secret");
  return bytes;
}
export async function signMcpWebhook(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secretBytes(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const payload = encoder.encode(`${id}.${timestamp}.${body}`);
  return "v1," + btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, payload))));
}
/** Configuration readiness only. Never returns callback URLs, signing secrets or tokens. */
export function mcpEventReadiness(env: AppEnv): {callback_policy_configured:boolean;callback_transport?:string} {
  if(hasPinnedCallbackTransport(env))return {callback_policy_configured:true,callback_transport:"dns-pinned-https"};
  try {
    const items:unknown=JSON.parse(env.COLLABORATION_EVENTS_ALLOWED_ORIGINS ?? "[]");
    const configured=Array.isArray(items)&&items.some(item=>{
      if(typeof item!=="string")return false;
      try { const u=new URL(item);return u.protocol==="https:"&&u.origin===item&&!u.username&&!u.password; }
      catch {return false;}
    });
    return {callback_policy_configured:configured};
  } catch {return {callback_policy_configured:false};}
}
const safeUrl=validateCallbackTarget;

function rootUrl(env: AppEnv) {
  const url = new URL(env.AUTH_PUBLIC_ORIGIN ?? "");
  if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash)
    throw new Error("public_origin_unavailable");
  return url.origin;
}
function encryptedContext(sub: string, field: string) { return `mcp-event:${sub}:${field}`; }
function getDef(slug: string) {
  return [{
    name: EVENT,
    description: "An explicitly mentioned agent receives the group message reference; fetch context with authorized group tools.",
    delivery: ["webhook"],
    inputSchema: { type: "object", properties: { channel_id: { type: "string", const: slug },
      mention_only: { type: "boolean", default: true } }, required: ["channel_id"], additionalProperties: false },
    payloadSchema: { type: "object", properties: {
      channel_id: { type: "string" }, message_seq: { type: "integer" }, sender_name: { type: "string" },
      message_url: { type: "string" },
    }, required: ["channel_id", "message_seq", "sender_name", "message_url"], additionalProperties: false },
  }];
}
function canonicalFilter(params: unknown, slug: string): string {
  if (!record(params) || params.channel_id !== slug ||
    Object.keys(params).some(k => !["channel_id", "mention_only"].includes(k)) ||
    (params.mention_only !== undefined && typeof params.mention_only !== "boolean")) {
    return failReason("invalid_event_arguments");
  }
  return JSON.stringify({ channel_id: slug, mention_only: params.mention_only !== false });
}
async function validIdentity(db: D1Database, subscription: Pick<Subscription,
  "agent_name" | "agent_token_hash" | "channel_slug" | "owner_account">): Promise<boolean> {
  const {agent_name, agent_token_hash, channel_slug, owner_account} = subscription;
  if(!await mcpPermission(db,channel_slug,"group.events"))return false;
  if (agent_name.startsWith("ac-oauth-")) {
    const grant = await db.prepare(
      "SELECT g.scopes_json FROM connector_oauth_grants g JOIN tokens t ON t.name=g.agent_name " +
      "WHERE g.agent_name=? AND g.account=? AND g.channel_slug=? AND g.revoked_at IS NULL " +
      "AND g.refresh_expires_at>? AND t.revoked_at IS NULL AND t.owner=? AND t.channel_scope=? " +
      "AND EXISTS(SELECT 1 FROM channels WHERE slug=g.channel_slug AND owner_account=g.account AND archived_at IS NULL)"
    ).bind(agent_name,owner_account,channel_slug,Date.now(),owner_account,channel_slug).first<{scopes_json:string}>();
    try { return !!grant && (JSON.parse(grant.scopes_json) as string[]).includes("group.events"); }
    catch { return false; }
  }
  const item=await db.prepare(
    "SELECT hash FROM tokens WHERE hash=? AND name=? AND owner=? AND channel_scope=? AND role='agent' " +
    "AND revoked_at IS NULL AND (child_expires_at IS NULL OR child_expires_at>?)"
  ).bind(agent_token_hash,agent_name,owner_account,channel_slug,Date.now()).first();
  return item!==null;
}
async function verifyCallback(url: string, secret: string, subId: string, env:AppEnv): Promise<void> {
  const challenge = crypto.randomUUID();
  const body = JSON.stringify({ type: "verification", challenge });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const webhookId = `msg_verification_${crypto.randomUUID().replaceAll("-","")}`;
  const signature = await signMcpWebhook(secret,webhookId,timestamp,body);
  const abort = new AbortController();
  const timer = setTimeout(()=>abort.abort(),TIMEOUT_MS);
  try {
    const result = await postSignedCallback(env,url,{method:"POST",redirect:"manual",signal:abort.signal,
      headers:{"content-type":"application/json","webhook-id":webhookId,"webhook-timestamp":timestamp,
        "webhook-signature":signature,"X-MCP-Subscription-Id":subId},body});
    if (!result.ok || !result.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return failReason("callback_verification_failed");
    // A remote callback is untrusted: cap its response before allocating/decoding.
    const reader = result.body?.getReader();
    if (!reader) return failReason("callback_verification_failed");
    let size = 0; const parts: Uint8Array[] = [];
    try {
      while (true) {
        const item = await reader.read(); if (item.done) break;
        size += item.value.byteLength;
        if (size > 2048) return failReason("callback_verification_failed");
        parts.push(item.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    const payload = new Uint8Array(size); let offset = 0;
    for (const part of parts) { payload.set(part,offset); offset += part.length; }
    const received: unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true,ignoreBOM:false}).decode(payload));
    if (!record(received) || typeof received.challenge !== "string") return failReason("callback_verification_failed");
    const original = encoder.encode(challenge), returned = encoder.encode(received.challenge);
    if (original.length !== returned.length) return failReason("callback_verification_failed");
    let delta = 0;
    for (let i = 0; i < original.length; i++) delta |= original[i]! ^ returned[i]!;
    if (delta !== 0) return failReason("callback_verification_failed");
  } finally { clearTimeout(timer); }
}
/**
 * MCP 2.0 Events protocol methods. Caller has already established a dedicated
 * group-scoped agent identity. Auth remains separate from protocol support:
 * ChatGPT publishing requires MCP OAuth 2.1, not a pasted static bearer.
 */
export async function mcpEventMethod(name: string, params: unknown, slug: string,
  identity: TokenIdentity, env: AppEnv): Promise<unknown> {
  if (name === "server/discover") return { resultType:"complete",supportedVersions:[VERSION],
    capabilities:{tools:{},events:{}} };
  if (name === "events/list") return { events: [...getDef(slug),pushEventDefinition(slug)] };
  if (!record(params) || params.name !== EVENT) return error(-32602,"Invalid event request");
  try {
    if (name === "events/subscribe") {
      const filter = canonicalFilter(params.arguments,slug);
      const delivery = params.delivery;
      if (!record(delivery) || delivery.mode !== "webhook") return failReason("invalid_delivery");
      const url = safeUrl(delivery.url,env);
      secretBytes(delivery.secret);
      const owner = identity.account ?? identity.owner;
      if (!owner) return failReason("account_required");
      const subId = "sub_" + (await sha256Hex(JSON.stringify([slug,owner,identity.name,EVENT,filter,url]))).slice(0,52);
      // MCP Events permits null (a request for no expiry). We grant a finite
      // default instead of rejecting the subscription or issuing unbounded access.
      const ttlMs = params.ttlMs == null ? 86_400_000 : params.ttlMs;
      if (typeof ttlMs !== "number" || !Number.isSafeInteger(ttlMs) || ttlMs < 60_000) return failReason("invalid_ttl");
      const expires = Date.now()+Math.min(ttlMs,7*86_400_000);
      // Verify before saving. A legitimate callback proves possession of the
      // destination and its signing secret; no private app data is sent first.
      await verifyCallback(url,delivery.secret as string,subId,env);
      const callback = await sealCredential(url,env.COLLABORATION_ENCRYPTION_KEY,encryptedContext(subId,"url"));
      const secret = await sealCredential(delivery.secret as string,env.COLLABORATION_ENCRYPTION_KEY,encryptedContext(subId,"secret"));
      const now = Date.now();
      await env.DB.prepare(`INSERT INTO mcp_event_subscriptions
        (id,channel_slug,owner_account,agent_name,agent_token_hash,name,filter_json,callback_fingerprint,
          callback_ciphertext,secret_ciphertext,expires_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET agent_token_hash=excluded.agent_token_hash,callback_ciphertext=excluded.callback_ciphertext,
          secret_ciphertext=excluded.secret_ciphertext,expires_at=excluded.expires_at,updated_at=excluded.updated_at,revoked_at=NULL`)
        .bind(subId,slug,owner,identity.name,identity.hash,EVENT,filter,await sha256Hex(url),
          callback,secret,expires,now,now).run();
      return { id:subId,refreshBefore:new Date(expires).toISOString(),cursor:null,truncated:false };
    }
    if (name === "events/unsubscribe") {
      const filter = canonicalFilter(params.arguments,slug);
      const delivery = params.delivery;
      if (!record(delivery) || delivery.mode!=="webhook") return failReason("invalid_delivery");
      const url = safeUrl(delivery.url,env);
      const owner=identity.account ?? identity.owner;
      if (!owner) return failReason("account_required");
      const subId="sub_"+(await sha256Hex(JSON.stringify([slug,owner,identity.name,EVENT,filter,url]))).slice(0,52);
      await env.DB.prepare("UPDATE mcp_event_subscriptions SET revoked_at=?,updated_at=? WHERE id=? AND channel_slug=? AND owner_account=? AND agent_name=?")
        .bind(Date.now(),Date.now(),subId,slug,owner,identity.name).run();
      return {};
    }
  } catch(e) {
    // Log categories only: never log callback URLs, signing secrets, nonce,
    // user messages, raw provider errors or access/refresh credentials.
    const localReasons=new Set(["invalid_secret","invalid_callback_url","invalid_event_arguments",
      "invalid_delivery","invalid_ttl","callback_origin_not_approved","account_required",
      "callback_policy_unconfigured","callback_dns_failed","callback_dns_timeout","callback_address_blocked",
      "callback_redirect_blocked","callback_network_failed","callback_timeout","callback_tls_peer_invalid",
      "callback_response_too_large","callback_gateway_failed","callback_gateway_busy"]);
    const known=e instanceof Error&&localReasons.has(e.message);
    const reason=known?(e as Error).message:e instanceof Error&&e.name==="AbortError"?"timeout":"challenge_failed";
    if(name==="events/subscribe")console.warn("mcp_event_subscription_rejected",JSON.stringify({reason,event:EVENT}));
    return error(name==="events/subscribe"&&(!known||reason.startsWith("callback_"))?-32015:-32602,
      known?(e as Error).message:"Callback endpoint could not be verified",{reason});
  }
  return error(-32601,"Method not found");
}
interface EventInput { slug: string; seq: number; sender: string; mentions: string[]; }
export async function enqueueMcpEvent(env: AppEnv, input: EventInput): Promise<number> {
  const now=Date.now();const subscriptions=await env.DB.prepare(`SELECT * FROM mcp_event_subscriptions
    WHERE channel_slug=? AND name=? AND revoked_at IS NULL AND expires_at>? LIMIT 100`)
    .bind(input.slug,EVENT,now).all<Subscription>();
  let count=0;
  for (const sub of subscriptions.results) {
    if (sub.agent_name===input.sender || !(await validIdentity(env.DB,sub))) continue;
    const filter=JSON.parse(sub.filter_json) as {mention_only:boolean};
    if (filter.mention_only && !input.mentions.includes(sub.agent_name)) continue;
    const msgId=`evt_${(await sha256Hex(`${input.slug}:${input.seq}:${sub.id}`)).slice(0,40)}`;
    const payload={eventId:msgId,name:EVENT,timestamp:new Date(now).toISOString(),
      data:{channel_id:input.slug,message_seq:input.seq,sender_name:input.sender,
        message_url:`${rootUrl(env)}/c/${encodeURIComponent(input.slug)}`},cursor:null};
    await env.DB.prepare(`INSERT OR IGNORE INTO mcp_event_outbox
      (id,subscription_id,channel_slug,message_seq,event_id,payload_json,state,next_attempt_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,'pending',?,?,?)`)
      .bind(crypto.randomUUID(),sub.id,input.slug,input.seq,msgId,JSON.stringify(payload),now,now,now).run();
    count++;
  }
  return count;
}
export async function deliverMcpEvents(env: AppEnv, slug: string, batchSize=2): Promise<{attempted:number;delivered:number}> {
  const limit=Number.isSafeInteger(batchSize)?Math.min(MAX_QUEUE_BATCH,Math.max(1,batchSize)):2;
  const now=Date.now();
  const pending=await env.DB.prepare(`SELECT o.*,s.callback_ciphertext,s.secret_ciphertext,s.agent_token_hash,
     s.agent_name,s.owner_account,s.expires_at,s.revoked_at FROM mcp_event_outbox o JOIN mcp_event_subscriptions s ON s.id=o.subscription_id
     WHERE o.channel_slug=? AND o.state='pending' AND o.next_attempt_at<=? AND o.lease_until<=?
     ORDER BY o.created_at LIMIT ?`)
     .bind(slug,now,now,limit).all<Pending>();
  let attempted=0,delivered=0;
  for (const row of pending.results) {
    const token=crypto.randomUUID();
    const locked=await env.DB.prepare("UPDATE mcp_event_outbox SET lease_token=?,lease_until=? WHERE id=? AND lease_until<=? AND state='pending'")
      .bind(token,Date.now()+30_000,row.id,Date.now()).run();
    if (locked.meta.changes!==1) continue;
    attempted++;
    let accepted=false,status=0,terminal=false;
    try {
      if (row.revoked_at !== null || row.expires_at<=Date.now() || !(await validIdentity(env.DB,row))) {
        terminal=true;
      } else {
        const url=await openCredential(row.callback_ciphertext,env.COLLABORATION_ENCRYPTION_KEY,encryptedContext(row.subscription_id,"url"));
        const approved=safeUrl(url,env);
        const secret=await openCredential(row.secret_ciphertext,env.COLLABORATION_ENCRYPTION_KEY,encryptedContext(row.subscription_id,"secret"));
        const timestamp=String(Math.floor(Date.now()/1000));
        const signature=await signMcpWebhook(secret,row.event_id,timestamp,row.payload_json);
        const abort=new AbortController();
        const timer=setTimeout(()=>abort.abort(),TIMEOUT_MS);
        try {
          const response=await postSignedCallback(env,approved,{method:"POST",redirect:"manual",signal:abort.signal,
            headers:{"content-type":"application/json","webhook-id":row.event_id,
              "webhook-timestamp":timestamp,"webhook-signature":signature,
              "X-MCP-Subscription-Id":row.subscription_id},body:row.payload_json});
          status=response.status;
          accepted=response.ok;
          terminal=[410,413].includes(status);
          void response.body?.cancel().catch(()=>undefined);
        } finally {clearTimeout(timer);}
      }
    } catch { /* Bound retries; never expose callback secrets or response data. */ }
    const next=accepted?"delivered":terminal||row.attempts+1>=RETRIES?"failed":"pending";
    const delay=Math.min(3600_000,Math.pow(2,row.attempts)*30_000);
    const updated=await env.DB.prepare(`UPDATE mcp_event_outbox SET state=?,attempts=attempts+1,
      next_attempt_at=?,last_status=?,updated_at=?,lease_token=NULL,lease_until=0 WHERE id=? AND lease_token=?`)
      .bind(next,Date.now()+delay,status||null,Date.now(),row.id,token).run();
    if (updated.meta.changes && accepted) delivered++;
  }
  return {attempted,delivered};
}
