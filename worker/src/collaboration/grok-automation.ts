import type { Context, Hono } from "hono";
import type { AppContext, AppEnv, LoadedChannel } from "../index";
import type { TokenIdentity } from "../auth";
import { openCredential, sealCredential } from "./vault";

type Ctx = Context<AppContext>;
interface Granted { slug: string; channel: LoadedChannel; identity: TokenIdentity }
interface Dependencies {
  access(c: Ctx, mode?: "read" | "manage" | "run"): Promise<Response | Granted>;
}
interface ConnectionRow {
  channel_slug: string; display_name: string; endpoint_ciphertext: string; secret_ciphertext: string;
  configured_by: string; configured_at: number; updated_at: number;
}
interface DeliveryRow {
  id: string; channel_slug: string; request_id: string; requested_by: string; prompt: string;
  webhook_id: string; state: "submitting" | "submitted" | "rejected" | "unknown";
  error: string | null; created_at: number; updated_at: number;
}
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const MAX_PROMPT = 12_000;

function error(code: string, status = 400): Response {
  return Response.json({ error: { code, message: code } }, { status, headers: { "cache-control": "no-store" } });
}
function endpoint(value: unknown, env: AppEnv): string {
  if (typeof value !== "string" || value.length > 2048 || /[\\%\s]/.test(value)) throw new Error("invalid_trigger_url");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
    !url.hostname.includes(".") || url.hostname.includes(":") || /^[\d.]+$/.test(url.hostname) ||
    /\.(?:localhost|local|internal|lan|home|arpa)$/.test(url.hostname) || url.hostname.endsWith(".")) {
    throw new Error("invalid_trigger_url");
  }
  let allowlist: unknown;
  try { allowlist = JSON.parse(env.COLLABORATION_GROK_TRIGGER_ORIGINS ?? "[]"); } catch { /* fail closed */ }
  if (!Array.isArray(allowlist) || !allowlist.includes(url.origin)) throw new Error("trigger_origin_not_approved");
  return url.href;
}
function keyBytes(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^whsec_(?:[A-Za-z0-9+/]{4})+(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new Error("invalid_signing_secret");
  let raw: Uint8Array;
  try { raw = Uint8Array.from(atob(value.slice(6)), c => c.charCodeAt(0)); }
  catch { throw new Error("invalid_signing_secret"); }
  if (raw.length < 24 || raw.length > 64) throw new Error("invalid_signing_secret");
  return raw;
}
export async function grokSignature(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", keyBytes(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return "v1," + btoa(String.fromCharCode(...signature));
}
function view(row: DeliveryRow) {
  return { id: row.id, request_id: row.request_id, state: row.state, error: row.error,
    created_at: row.created_at, updated_at: row.updated_at };
}
async function json(c: Ctx): Promise<Record<string, unknown> | null> {
  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") return null;
  if (Number(c.req.header("content-length") ?? 0) > 24_000) return null;
  const text = await c.req.text();
  if (text.length > 24_000) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function ctx(row: ConnectionRow, kind: string): string { return `grok:${row.channel_slug}:${kind}`; }
async function sendHook(url: string, secret: string, delivery: DeliveryRow, publicOrigin: string): Promise<"submitted" | "rejected" | "unknown"> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({
    event: "agentcommons.task_assigned", request_id: delivery.request_id,
    delivery_id: delivery.id, channel_id: delivery.channel_slug,
    prompt: delivery.prompt,
    task_url: `${publicOrigin}/c/${encodeURIComponent(delivery.channel_slug)}`,
    note: "Use your authorized Agent Commons MCP tools to read context and return the response. Do not forward private conversation history.",
  });
  const signature = await grokSignature(secret, delivery.webhook_id, timestamp, body);
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { "content-type": "application/json", "webhook-id": delivery.webhook_id,
        "webhook-timestamp": timestamp, "webhook-signature": signature }, body,
    });
    void response.body?.cancel().catch(() => undefined);
    return response.status === 202 ? "submitted" :
      [400, 401, 403, 404, 413].includes(response.status) ? "rejected" : "unknown";
  } catch { return "unknown"; }
  finally { clearTimeout(deadline); }
}

export function registerGrokAutomationRoutes(app: Hono<AppContext>, deps: Dependencies): void {
  const path = "/api/channels/:slug/bridges/grok-automation";
  const locked = async (c: Ctx, mode: "read" | "manage" | "run" = "read") => deps.access(c, mode);
  app.get(path, async c => {
    const allowed = await locked(c); if (allowed instanceof Response) return allowed;
    const row = await c.env.DB.prepare("SELECT * FROM grok_automation_connections WHERE channel_slug=?")
      .bind(allowed.slug).first<ConnectionRow>();
    const deliveries = await c.env.DB.prepare("SELECT * FROM grok_automation_deliveries WHERE channel_slug=? ORDER BY created_at DESC LIMIT 25")
      .bind(allowed.slug).all<DeliveryRow>();
    return c.json({ connection: row ? { name: row.display_name, configured: true, configured_at: row.configured_at } : null,
      deliveries: deliveries.results.map(view), mode: "grok-automation-webhook",
      personal_bot_direct_api: false, automatic_result_import: false });
  });
  app.put(path, async c => {
    const allowed = await locked(c, "manage"); if (allowed instanceof Response) return allowed;
    const input = await json(c); if (!input || typeof input.name !== "string" || !input.name.trim() ||
      input.name.length > 80 || typeof input.signing_secret !== "string") return error("invalid_configuration");
    let target: string;
    try { target = endpoint(input.endpoint, c.env); keyBytes(input.signing_secret); }
    catch (e) { return error(e instanceof Error ? e.message : "invalid_configuration"); }
    const pseudo = { channel_slug: allowed.slug } as ConnectionRow;
    const urlCipher = await sealCredential(target, c.env.COLLABORATION_ENCRYPTION_KEY, ctx(pseudo, "endpoint"));
    const secretCipher = await sealCredential(input.signing_secret, c.env.COLLABORATION_ENCRYPTION_KEY, ctx(pseudo, "secret"));
    const now = Date.now();
    await c.env.DB.prepare(`INSERT INTO grok_automation_connections(channel_slug,display_name,endpoint_ciphertext,
      secret_ciphertext,configured_by,configured_at,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(channel_slug) DO UPDATE SET display_name=excluded.display_name,
      endpoint_ciphertext=excluded.endpoint_ciphertext,secret_ciphertext=excluded.secret_ciphertext,updated_at=excluded.updated_at`)
      .bind(allowed.slug, input.name.trim(), urlCipher, secretCipher, allowed.identity.name, now, now).run();
    return c.json({ configured: true, name: input.name.trim(), delivery: "explicit-human-trigger" }, 201);
  });
  app.delete(path, async c => {
    const allowed = await locked(c, "manage"); if (allowed instanceof Response) return allowed;
    await c.env.DB.prepare("DELETE FROM grok_automation_connections WHERE channel_slug=?")
      .bind(allowed.slug).run();
    return c.json({ removed: true, remote_automation_not_cancelled: true });
  });
  app.post(`${path}/dispatch`, async c => {
    const allowed = await locked(c, "run"); if (allowed instanceof Response) return allowed;
    const input = await json(c);
    if (!input || typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > MAX_PROMPT ||
      typeof input.request_id !== "string" || !ID.test(input.request_id)) return error("invalid_prompt_or_request_id");
    const previous = await c.env.DB.prepare("SELECT * FROM grok_automation_deliveries WHERE channel_slug=? AND request_id=?")
      .bind(allowed.slug, input.request_id).first<DeliveryRow>();
    if (previous) {
      if (previous.prompt !== input.prompt) return error("request_id_conflict", 409);
      return c.json({ delivery: view(previous), reused: true });
    }
    const row = await c.env.DB.prepare("SELECT * FROM grok_automation_connections WHERE channel_slug=?")
      .bind(allowed.slug).first<ConnectionRow>();
    if (!row) return error("automation_not_configured", 409);
    const id = crypto.randomUUID(), now = Date.now();
    try {
      await c.env.DB.prepare(`INSERT INTO grok_automation_deliveries
        (id,channel_slug,request_id,requested_by,prompt,webhook_id,state,created_at,updated_at)
        SELECT ?,?,?,?,?,?,'submitting',?,? FROM grok_automation_connections WHERE channel_slug=?`)
        .bind(id,allowed.slug,input.request_id,allowed.identity.name,input.prompt.trim(),
          `msg_${id.replaceAll("-", "")}`,now,now,allowed.slug).run();
    } catch {
      const duplicate = await c.env.DB.prepare("SELECT * FROM grok_automation_deliveries WHERE channel_slug=? AND request_id=?")
        .bind(allowed.slug,input.request_id).first<DeliveryRow>();
      if (duplicate && duplicate.prompt === input.prompt) return c.json({ delivery: view(duplicate), reused: true });
      return error("active_delivery_conflict",409);
    }
    const saved = (await c.env.DB.prepare("SELECT * FROM grok_automation_deliveries WHERE id=?").bind(id).first<DeliveryRow>())!;
    let outcome: DeliveryRow["state"] = "unknown";
    try {
      const target = await openCredential(row.endpoint_ciphertext,c.env.COLLABORATION_ENCRYPTION_KEY,ctx(row,"endpoint"));
      const validated = endpoint(target,c.env); // recheck operator policy at send time
      const secret = await openCredential(row.secret_ciphertext,c.env.COLLABORATION_ENCRYPTION_KEY,ctx(row,"secret"));
      const publicOrigin = c.env.AUTH_PUBLIC_ORIGIN;
      if (publicOrigin && new URL(publicOrigin).protocol === "https:") {
        outcome = await sendHook(validated,secret,saved,new URL(publicOrigin).origin);
      }
    } catch { /* uncertain remote outcome, never blindly auto-retry */ }
    await c.env.DB.prepare("UPDATE grok_automation_deliveries SET state=?,updated_at=? WHERE id=? AND state='submitting'")
      .bind(outcome,Date.now(),id).run();
    const updated = await c.env.DB.prepare("SELECT * FROM grok_automation_deliveries WHERE id=?").bind(id).first<DeliveryRow>();
    return c.json({ delivery: view(updated!), reused: false, completion_confirmed: false }, 202);
  });
}
