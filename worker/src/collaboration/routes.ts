import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  PERSONAL_AGENT_PROVIDERS,
  type ChannelFile, type ChannelRepository, type CloudAgentConnection,
  type CloudAgentRun, type CloudAgentRunState, type DirectAgentProvider,
} from "@agentparty/shared/collaboration";
import type { AppContext, AppEnv, LoadedChannel } from "../index";
import { isHumanChannelOwner } from "../acl";
import { randomToken, sha256Hex, type TokenIdentity } from "../auth";
import { handleChannelMcp } from "./mcp";
import { registerProposalRoutes } from "./proposals";
import { GitHubReadError, inspectRepository, listPullRequests, listRepositoryCommits, validCredential, validRepositoryName, validBranch } from "./github";
import { openCredential, sealCredential, VaultError } from "./vault";
import {
  ProviderError, verifyProvider, startProviderRun, pollProviderRun, cancelProviderRun,
  type ProviderConfig, type ProviderOptions, type ProviderRunReference, type ProviderRunUpdate,
} from "./transport";

type Ctx = Context<AppContext>;
interface Dependencies {
  loadChannel(db: D1Database, slug: string): Promise<LoadedChannel | null>;
  canAccessLoadedChannel(db: D1Database, identity: TokenIdentity, channel: LoadedChannel): Promise<boolean>;
  canParticipateInChannel(db: D1Database, identity: TokenIdentity, channel: LoadedChannel): Promise<boolean>;
  forward(request: Request, env: AppEnv, context: Ctx["executionCtx"]): Response | Promise<Response>;
}
interface ConnectionRow {
  id: string; channel_slug: string; owner_account: string; provider: DirectAgentProvider;
  name: string; agent_name: string; endpoint: string; remote_agent_id: string | null;
  remote_conversation_id: string | null; remote_binding: string | null; session_id: string | null;
  credential_ciphertext: string; agent_token_ciphertext: string; agent_token_hash: string;
  personal_context_acknowledged: number; supports_cancel: number; verified_at: number;
  created_at: number; updated_at: number; revoked_at: number | null;
}
interface RunRow {
  id: string; channel_slug: string; connection_id: string; request_id: string; requested_by: string;
  state: CloudAgentRunState; prompt: string; remote_run_id: string | null; reference_json: string | null;
  result: string | null; error: string | null; reply_message_seq: number | null;
  lease_until: number; lease_token: string | null; created_at: number; updated_at: number;
}
export interface RepositoryRow {
  id: string; channel_slug: string; full_name: string; base_branch: string; is_private: number;
  credential_ciphertext: string | null; created_by: string; created_at: number;
}
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const ACTIVE_SQL = "'starting','running','needs_input','unknown'";
const LEASE_MS = 60_000;
// Fence every outcome and receipt write by its owner, in the same SQL statement
// as the live-connection check. A preflight SELECT alone races with revocation.
const OWNED_RUN_SQL = `id = ? AND lease_token = ? AND EXISTS (
  SELECT 1 FROM cloud_agent_connections AS connection
  WHERE connection.channel_slug = cloud_agent_runs.channel_slug
    AND connection.id = cloud_agent_runs.connection_id AND connection.revoked_at IS NULL
)`;
const MAX_PROMPT = 20_000;
const encoder = new TextEncoder();

function fail(c: Ctx, status: ContentfulStatusCode, message: string, code = "bad_request"): Response {
  return c.json({ error: { code, message } }, status);
}
function safeFailure(c: Ctx, error: unknown): Response {
  if (error instanceof VaultError) return fail(c, 503, error.message, "unavailable");
  if (error instanceof GitHubReadError) return fail(c, error.status as ContentfulStatusCode, error.message, "github_read_failed");
  if (error instanceof ProviderError) {
    const status = error.code === "authentication_failed" ? 403 : error.code === "rate_limited" ? 429
      : ["invalid_configuration", "endpoint_not_allowed", "unsupported"].includes(error.code) ? 400
      : error.code === "conflict" ? 409 : 502;
    return fail(c, status, error.message, error.code);
  }
  // Never include SQL errors, provider bodies, URLs or credential-bearing error causes.
  return fail(c, 503, "The collaboration service could not complete the request. Try again after checking its status.", "unavailable");
}
function route(handler: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx): Promise<Response> => {
    c.header("cache-control", "no-store");
    try { return await handler(c); } catch (error) { return safeFailure(c, error); }
  };
}
async function jsonObject(c: Ctx): Promise<Record<string, unknown> | null> {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return null;
  let text = ""; let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 100_000) return null;
      text += decoder.decode(part.value, { stream: true });
    }
    const value = JSON.parse(text + decoder.decode());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
  finally { void reader.cancel().catch(() => undefined); }
}
function uniqueViolation(error: unknown): boolean {
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/.test(error instanceof Error ? error.message : "");
}
function connectionView(row: ConnectionRow): CloudAgentConnection {
  return {
    id: row.id, channel: row.channel_slug, provider: row.provider, name: row.name, agent_name: row.agent_name,
    endpoint: row.endpoint, remote_agent_id: row.remote_agent_id, status: "verified", credential_configured: true,
    mode: "manual", supports_cancel: row.supports_cancel === 1,
    personal_context_acknowledged: row.personal_context_acknowledged === 1,
    verified_at: row.verified_at, created_at: row.created_at, updated_at: row.updated_at,
  };
}
function runView(row: RunRow): CloudAgentRun {
  return { id: row.id, connection_id: row.connection_id, channel: row.channel_slug, request_id: row.request_id,
    state: row.state, prompt: row.prompt, result: row.result, error: row.error,
    reply_message_seq: row.reply_message_seq, created_at: row.created_at, updated_at: row.updated_at };
}
function repositoryView(row: RepositoryRow): ChannelRepository {
  return { id: row.id, channel: row.channel_slug, full_name: row.full_name,
    html_url: `https://github.com/${row.full_name}`, base_branch: row.base_branch, private: row.is_private === 1,
    credential_configured: row.credential_ciphertext !== null, created_at: row.created_at };
}
function connectionContext(row: Pick<ConnectionRow, "channel_slug" | "id">, kind = "credential"): string {
  return `cloud:${row.channel_slug}:${row.id}:${kind}`;
}
function options(env: AppEnv): ProviderOptions {
  let allowedOrigins: string[] = [];
  try {
    const parsed = JSON.parse(env.COLLABORATION_HERMES_ALLOWED_ORIGINS ?? "[]");
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) allowedOrigins = parsed;
  } catch { /* Missing/malformed deployment allowlists fail closed in the transport. */ }
  return { allowedOrigins };
}
async function providerConfig(row: ConnectionRow, env: AppEnv): Promise<ProviderConfig> {
  return {
    provider: row.provider, endpoint: row.endpoint,
    credential: await openCredential(row.credential_ciphertext, env.COLLABORATION_ENCRYPTION_KEY, connectionContext(row)),
    remoteAgentId: row.remote_agent_id ?? undefined, remoteConversationId: row.remote_conversation_id ?? undefined,
    sessionId: row.session_id ?? undefined,
  };
}
function loadConnection(db: D1Database, slug: string, id: string): Promise<ConnectionRow | null> {
  return db.prepare("SELECT * FROM cloud_agent_connections WHERE channel_slug = ? AND id = ? AND revoked_at IS NULL")
    .bind(slug, id).first<ConnectionRow>();
}
async function listConnections(db: D1Database, slug: string): Promise<CloudAgentConnection[]> {
  const rows = await db.prepare("SELECT * FROM cloud_agent_connections WHERE channel_slug = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 100")
    .bind(slug).all<ConnectionRow>();
  return rows.results.map(connectionView);
}
async function listRepositories(db: D1Database, slug: string, includePrivate = true): Promise<ChannelRepository[]> {
  const rows = await db.prepare("SELECT * FROM channel_repositories WHERE channel_slug = ? AND (is_private = 0 OR ? = 1) ORDER BY created_at DESC LIMIT 100")
    .bind(slug, includePrivate ? 1 : 0).all<RepositoryRow>();
  return rows.results.map(repositoryView);
}
function loadRun(db: D1Database, slug: string, connectionId: string, id: string): Promise<RunRow | null> {
  return db.prepare("SELECT * FROM cloud_agent_runs WHERE channel_slug = ? AND connection_id = ? AND id = ?")
    .bind(slug, connectionId, id).first<RunRow>();
}
async function repositoryCredential(row: RepositoryRow, env: AppEnv): Promise<string | undefined> {
  return row.credential_ciphertext === null ? undefined
    : openCredential(row.credential_ciphertext, env.COLLABORATION_ENCRYPTION_KEY, `github:${row.channel_slug}:${row.id}`);
}

export function registerCollaborationRoutes(app: Hono<AppContext>, deps: Dependencies): void {
  async function access(c: Ctx, mode: "read" | "manage" | "run" = "read") {
    const slug = c.req.param("slug") ?? "";
    const channel = await deps.loadChannel(c.env.DB, slug);
    if (!channel) return fail(c, 404, "Channel not found.", "not_found");
    const identity = c.get("identity");
    if (identity.channel_scope != null && identity.channel_scope !== slug) return fail(c, 403, "This token is scoped to another channel.", "forbidden");
    if (!(await deps.canAccessLoadedChannel(c.env.DB, identity, channel))) return fail(c, 403, "Not allowed in this channel.", "forbidden");
    if (mode === "manage" && !isHumanChannelOwner(identity, channel)) return fail(c, 403, "Only the human channel owner can manage connections.", "forbidden");
    if (mode === "run" && (identity.kind !== "human" || identity.role === "readonly" || !(await deps.canParticipateInChannel(c.env.DB, identity, channel)))) {
      return fail(c, 403, "Only participating human members can start or control paid agent work.", "forbidden");
    }
    if (mode !== "read" && channel.archived_at !== null) return fail(c, 410, "Channel is archived.", "archived");
    return { channel, identity, slug };
  }
  const forward = (c: Ctx, path: string, init: RequestInit = {}, bearer?: string) => deps.forward(new Request(new URL(path, c.req.url), {
    ...init, headers: { "content-type": "application/json", authorization: bearer ? `Bearer ${bearer}` : (c.req.header("authorization") ?? ""), ...(init.headers ?? {}) },
  }), c.env, c.executionCtx);

  /** Persist the final answer first, then use the real scoped agent's normal message API. */
  async function publishResult(c: Ctx, connection: ConnectionRow, run: RunRow, leaseToken: string): Promise<RunRow> {
    if (connection.provider !== "hermes" || run.state !== "completed" || !run.result || run.reply_message_seq !== null) return run;
    // Refresh ownership before the message side effect; a stale provider response
    // must not publish even if another request has already completed the run.
    const held = await c.env.DB.prepare(`UPDATE cloud_agent_runs SET lease_until = ?
      WHERE ${OWNED_RUN_SQL} AND state = 'completed' AND reply_message_seq IS NULL`)
      .bind(Date.now() + LEASE_MS, run.id, leaseToken).run();
    if (held.meta.changes < 1) return (await loadRun(c.env.DB, run.channel_slug, run.connection_id, run.id))!;
    let sequence: number | null = null;
    try {
      const token = await openCredential(connection.agent_token_ciphertext, c.env.COLLABORATION_ENCRYPTION_KEY, connectionContext(connection, "token"));
      const response = await forward(c, `/api/channels/${encodeURIComponent(connection.channel_slug)}/messages`, {
        method: "POST", body: JSON.stringify({ kind: "message", body: `[${connection.name}]\n\n${run.result}`,
          mentions: [], reply_to: null, idempotency_key: `cloud-run:${run.id}` }),
      }, token);
      if (response.ok) {
        const receipt = await response.json() as { seq?: unknown };
        if (typeof receipt.seq === "number" && Number.isSafeInteger(receipt.seq) && receipt.seq > 0) sequence = receipt.seq;
      }
    } catch { /* A delivery/key/receipt error must not erase a completed remote outcome. */ }
    if (sequence === null) {
      await c.env.DB.prepare(`UPDATE cloud_agent_runs SET error = ?, updated_at = ?
        WHERE ${OWNED_RUN_SQL} AND state = 'completed' AND reply_message_seq IS NULL`)
        .bind("The answer is saved, but posting to the group could not be confirmed. Check the server key and agent's channel permission, then sync again.", Date.now(), run.id, leaseToken).run();
    } else {
      await c.env.DB.prepare(`UPDATE cloud_agent_runs SET reply_message_seq = ?, error = NULL, updated_at = ?
        WHERE ${OWNED_RUN_SQL} AND state = 'completed' AND reply_message_seq IS NULL`)
        .bind(sequence, Date.now(), run.id, leaseToken).run();
    }
    return (await loadRun(c.env.DB, run.channel_slug, run.connection_id, run.id))!;
  }
  async function persistUpdate(c: Ctx, connection: ConnectionRow, run: RunRow, update: ProviderRunUpdate, leaseToken: string): Promise<RunRow> {
    // Provider adapters deliberately never return Manus personal conversation bodies.
    const output = connection.provider === "hermes" && update.state === "completed" ? update.text ?? null : null;
    if (output && encoder.encode(output).byteLength > 90_000) {
      update = { ...update, state: "failed", text: undefined, note: "The final answer exceeds the group message size. Review it in Hermes." };
    }
    const result = update.state === "completed" ? output : null;
    const reference: ProviderRunReference = { remoteRunId: update.remoteRunId,
      ...(update.sessionId === undefined ? {} : { sessionId: update.sessionId }),
      ...(update.cursor === undefined ? {} : { cursor: update.cursor }),
      ...(update.deliveryMode === undefined ? {} : { deliveryMode: update.deliveryMode }) };
    const saved = await c.env.DB.prepare(`UPDATE cloud_agent_runs SET state = ?, remote_run_id = ?, reference_json = ?, result = ?, error = ?, updated_at = ?
      WHERE ${OWNED_RUN_SQL} AND state IN (${ACTIVE_SQL})`)
      .bind(update.state, update.remoteRunId, JSON.stringify(reference), result, update.note ?? null, Date.now(), run.id, leaseToken).run();
    const current = (await loadRun(c.env.DB, run.channel_slug, run.connection_id, run.id))!;
    return saved.meta.changes > 0 ? publishResult(c, connection, current, leaseToken) : current;
  }

  app.get("/api/channels/:slug/collaboration", route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const { slug, identity, channel } = granted;
    const [connections, repositories, participates] = await Promise.all([
      listConnections(c.env.DB, slug), listRepositories(c.env.DB, slug, channel.visibility === "private"), deps.canParticipateInChannel(c.env.DB, identity, channel),
    ]);
    return c.json({ providers: PERSONAL_AGENT_PROVIDERS, connections, repositories,
      permissions: { manage: channel.archived_at === null && isHumanChannelOwner(identity, channel),
        run: channel.archived_at === null && identity.kind === "human" && identity.role !== "readonly" && participates,
        upload: channel.archived_at === null && identity.role !== "readonly" && participates },
      mcp_endpoint: new URL(`/api/channels/${encodeURIComponent(slug)}/mcp`, c.req.url).toString(), execution: "manual-sync" });
  }));
  app.get("/api/channels/:slug/cloud-agents", route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    return c.json({ connections: await listConnections(c.env.DB, granted.slug) });
  }));
  app.put("/api/channels/:slug/cloud-agents/:id", route(async (c) => {
    const granted = await access(c, "manage"); if (granted instanceof Response) return granted;
    const { slug, identity } = granted; const id = c.req.param("id") ?? "";
    const body = await jsonObject(c);
    if (!ID_RE.test(id) || !body || !["hermes", "manus"].includes(String(body.provider))
      || typeof body.name !== "string" || !body.name.trim() || body.name.length > 64 || /[\x00-\x1f\x7f]/.test(body.name)) {
      return fail(c, 400, "A valid id, provider (hermes or manus), and name (up to 64 characters) are required.");
    }
    const existing = await loadConnection(c.env.DB, slug, id);
    // IDs are stable audit identities. Revoked IDs cannot be silently recycled.
    if (!existing && await c.env.DB.prepare("SELECT 1 FROM cloud_agent_connections WHERE channel_slug = ? AND id = ?").bind(slug, id).first()) {
      return fail(c, 409, "This connection id was revoked. Create a new connection id.", "conflict");
    }
    const provider = body.provider as DirectAgentProvider;
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : provider === "manus" ? "https://api.manus.ai" : "";
    const remoteAgentId = typeof body.remote_agent_id === "string" ? body.remote_agent_id : undefined;
    const acknowledged = body.allow_personal_context === true || existing?.personal_context_acknowledged === 1;
    if (provider === "manus" && !acknowledged) return fail(c, 400, "Acknowledge that this group will send work to the agent's existing personal conversation. Replies will remain in Manus/Cue.");
    let credential: string;
    if (body.credential === undefined && existing) credential = await openCredential(existing.credential_ciphertext, c.env.COLLABORATION_ENCRYPTION_KEY, connectionContext(existing));
    else if (validCredential(body.credential)) credential = body.credential;
    else return fail(c, 400, "A credential is required. It is encrypted on the server and never returned.");
    // Check encryption availability before making a provider call.
    const encrypted = await sealCredential(credential, c.env.COLLABORATION_ENCRYPTION_KEY, `cloud:${slug}:${id}:credential`);
    const verified = await verifyProvider({ provider, endpoint, credential, remoteAgentId }, options(c.env));
    const stableIdentity = !existing || (existing.provider === provider && existing.endpoint === verified.endpoint
      && existing.remote_agent_id === (verified.remoteAgentId ?? null) && existing.remote_conversation_id === (verified.remoteConversationId ?? null));
    if (existing && !stableIdentity) return fail(c, 409, "Provider, endpoint, and remote agent identity are immutable. Create a new connection to avoid mixing conversations.", "conflict");
    const now = Date.now();
    const binding = provider === "manus" ? `manus:${verified.remoteConversationId}` : null;
    if (!existing) {
      const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM cloud_agent_connections WHERE channel_slug = ? AND revoked_at IS NULL").bind(slug).first<{ n: number }>();
      if ((count?.n ?? 0) >= 30) return fail(c, 429, "This group has reached its limit of 30 cloud connections.", "rate_limited");
      const token = randomToken(); const tokenHash = await sha256Hex(token);
      const agentName = `cloud-${provider}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const encryptedToken = await sealCredential(token, c.env.COLLABORATION_ENCRYPTION_KEY, `cloud:${slug}:${id}:token`);
      const sessionId = provider === "hermes" ? `commons-${crypto.randomUUID()}` : null;
      try {
        await c.env.DB.batch([
          ...(binding === null ? [] : [c.env.DB.prepare("INSERT OR IGNORE INTO personal_agent_conversation_channels(remote_binding,channel_slug,created_at) VALUES(?,?,?)").bind(binding, slug, now)]),
          c.env.DB.prepare("INSERT INTO tokens(hash,name,role,owner,channel_scope,created_at) VALUES(?,?,'agent',?,?,?)").bind(tokenHash, agentName, identity.account!, slug, now),
          c.env.DB.prepare(`INSERT INTO cloud_agent_connections
            (id,channel_slug,owner_account,provider,name,agent_name,endpoint,remote_agent_id,remote_conversation_id,remote_binding,session_id,
             credential_ciphertext,agent_token_ciphertext,agent_token_hash,personal_context_acknowledged,supports_cancel,verified_at,created_at,updated_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .bind(id, slug, identity.account!, provider, body.name.trim(), agentName, verified.endpoint, verified.remoteAgentId ?? null,
              verified.remoteConversationId ?? null, binding, sessionId, encrypted, encryptedToken, tokenHash, acknowledged ? 1 : 0,
              verified.supportsCancel ? 1 : 0, now, now, now),
        ]);
      } catch (error) {
        if (uniqueViolation(error) || /FOREIGN KEY constraint/.test(error instanceof Error ? error.message : "")) return fail(c, 409, "The connection name, id, or personal conversation is already bound. A personal conversation cannot be shared silently across groups, including after reconnecting.", "conflict");
        throw error;
      }
    } else {
      try {
        await c.env.DB.prepare(`UPDATE cloud_agent_connections SET name = ?, credential_ciphertext = ?, personal_context_acknowledged = ?,
          supports_cancel = ?, verified_at = ?, updated_at = ? WHERE channel_slug = ? AND id = ? AND revoked_at IS NULL`)
          .bind(body.name.trim(), encrypted, acknowledged ? 1 : 0, verified.supportsCancel ? 1 : 0, now, now, slug, id).run();
      } catch (error) { if (uniqueViolation(error)) return fail(c, 409, "Another connection already uses this name.", "conflict"); throw error; }
    }
    const saved = await loadConnection(c.env.DB, slug, id);
    if (!saved) return fail(c, 409, "The connection was revoked while it was being verified.", "conflict");
    return c.json({ connection: connectionView(saved) }, existing ? 200 : 201);
  }));
  app.delete("/api/channels/:slug/cloud-agents/:id", route(async (c) => {
    const granted = await access(c, "manage"); if (granted instanceof Response) return granted;
    const connection = await loadConnection(c.env.DB, granted.slug, c.req.param("id") ?? "");
    if (!connection) return fail(c, 404, "Connection not found.", "not_found");
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE cloud_agent_connections SET revoked_at = ?, updated_at = ?, credential_ciphertext = '', agent_token_ciphertext = '' WHERE channel_slug = ? AND id = ?").bind(now, now, granted.slug, connection.id),
      c.env.DB.prepare("UPDATE cloud_agent_runs SET lease_token = NULL, lease_until = 0 WHERE channel_slug = ? AND connection_id = ?").bind(granted.slug, connection.id),
      c.env.DB.prepare("UPDATE tokens SET revoked_at = ? WHERE hash = ?").bind(now, connection.agent_token_hash),
      c.env.DB.prepare(`UPDATE cloud_agent_runs SET state = 'unknown', result = NULL, error = ?, updated_at = ? WHERE channel_slug = ? AND connection_id = ? AND state IN (${ACTIVE_SQL})`)
        .bind("Connection revoked. Any already-started remote work must be checked in the provider; no further results will be imported.", now, granted.slug, connection.id),
    ]);
    return c.json({ revoked: true, remote_work_cancelled: false });
  }));

  app.get("/api/channels/:slug/cloud-agents/:id/runs", route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const id = c.req.param("id") ?? "";
    const rows = await c.env.DB.prepare("SELECT * FROM cloud_agent_runs WHERE channel_slug = ? AND connection_id = ? ORDER BY created_at DESC LIMIT 50")
      .bind(granted.slug, id).all<RunRow>();
    return c.json({ runs: rows.results.map(runView) });
  }));
  app.post("/api/channels/:slug/cloud-agents/:id/runs", route(async (c) => {
    const granted = await access(c, "run"); if (granted instanceof Response) return granted;
    const connection = await loadConnection(c.env.DB, granted.slug, c.req.param("id") ?? "");
    if (!connection) return fail(c, 404, "Connection not found.", "not_found");
    const body = await jsonObject(c);
    if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > MAX_PROMPT
      || typeof body.request_id !== "string" || !ID_RE.test(body.request_id)) return fail(c, 400, "A non-empty prompt (up to 20,000 characters) and stable request_id are required.");
    const prior = await c.env.DB.prepare("SELECT * FROM cloud_agent_runs WHERE channel_slug = ? AND connection_id = ? AND request_id = ?")
      .bind(granted.slug, connection.id, body.request_id).first<RunRow>();
    if (prior) {
      if (prior.prompt !== body.prompt) return fail(c, 409, "This request_id is already bound to a different prompt.", "conflict");
      return c.json({ run: runView(prior), reused: true });
    }
    const config = await providerConfig(connection, c.env);
    const id = crypto.randomUUID(); const now = Date.now(); const leaseToken = crypto.randomUUID();
    try {
      const inserted = await c.env.DB.prepare(`INSERT INTO cloud_agent_runs
        (id,channel_slug,connection_id,request_id,requested_by,state,prompt,lease_until,lease_token,created_at,updated_at)
        SELECT ?,?,?,?,?, 'starting',?,?,?,?,? FROM cloud_agent_connections WHERE channel_slug = ? AND id = ? AND revoked_at IS NULL`)
        .bind(id, granted.slug, connection.id, body.request_id, granted.identity.name, body.prompt, now + LEASE_MS, leaseToken, now, now, granted.slug, connection.id).run();
      if (inserted.meta.changes < 1) return fail(c, 409, "The connection was revoked.", "conflict");
    } catch (error) {
      if (uniqueViolation(error)) {
        const duplicate = await c.env.DB.prepare("SELECT * FROM cloud_agent_runs WHERE channel_slug = ? AND connection_id = ? AND request_id = ?")
          .bind(granted.slug, connection.id, body.request_id).first<RunRow>();
        if (duplicate && duplicate.prompt === body.prompt) return c.json({ run: runView(duplicate), reused: true });
        return fail(c, 409, "This connection already has an active or uncertain run. Sync or resolve that run before creating another.", "conflict");
      }
      throw error;
    }
    let run = (await loadRun(c.env.DB, granted.slug, connection.id, id))!;
    try {
      const update = await startProviderRun(config, { prompt: body.prompt, requestId: id, sessionId: connection.session_id ?? undefined }, options(c.env));
      run = await persistUpdate(c, connection, run, update, leaseToken);
    } catch (error) {
      const unknown = !(error instanceof ProviderError) || error.outcomeUnknown;
      const message = error instanceof ProviderError ? error.message : "The remote outcome could not be confirmed. Check this run in the provider before submitting any duplicate work.";
      // Delivery/storage errors after completion do not undo the saved provider
      // outcome. A superseded or revoked request cannot mutate its successor.
      await c.env.DB.prepare(`UPDATE cloud_agent_runs SET state = ?, error = ?, updated_at = ?
        WHERE ${OWNED_RUN_SQL} AND state IN (${ACTIVE_SQL})`)
        .bind(unknown ? "unknown" : "failed", message, Date.now(), id, leaseToken).run();
      run = (await loadRun(c.env.DB, granted.slug, connection.id, id))!;
    } finally {
      await c.env.DB.prepare("UPDATE cloud_agent_runs SET lease_until = 0, lease_token = NULL WHERE id = ? AND lease_token = ?").bind(id, leaseToken).run();
    }
    return c.json({ run: runView(run), reused: false }, 201);
  }));

  async function controlRun(c: Ctx, action: "sync" | "cancel"): Promise<Response> {
    const granted = await access(c, "run"); if (granted instanceof Response) return granted;
    const connection = await loadConnection(c.env.DB, granted.slug, c.req.param("id") ?? "");
    if (!connection) return fail(c, 404, "Connection not found.", "not_found");
    const initial = await loadRun(c.env.DB, granted.slug, connection.id, c.req.param("runId") ?? "");
    if (!initial) return fail(c, 404, "Run not found.", "not_found");
    const now = Date.now(); const leaseToken = crypto.randomUUID();
    const lock = await c.env.DB.prepare(`UPDATE cloud_agent_runs SET lease_until = ?, lease_token = ?
      WHERE id = ? AND lease_until <= ? AND EXISTS (SELECT 1 FROM cloud_agent_connections AS connection
        WHERE connection.channel_slug = cloud_agent_runs.channel_slug
          AND connection.id = cloud_agent_runs.connection_id AND connection.revoked_at IS NULL)`)
      .bind(now + LEASE_MS, leaseToken, initial.id, now).run();
    if (lock.meta.changes < 1) return c.json({ run: runView((await loadRun(c.env.DB, granted.slug, connection.id, initial.id))!), reused: true });
    try {
      // Another request may have completed between the first SELECT and acquiring
      // the lease. Decisions must use the post-acquisition row, not that snapshot.
      const run = (await loadRun(c.env.DB, granted.slug, connection.id, initial.id))!;
      if (run.lease_token !== leaseToken) return c.json({ run: runView(run), reused: true });
      if (["completed", "failed", "cancelled", "submitted"].includes(run.state)) return c.json({ run: runView(await publishResult(c, connection, run, leaseToken)) });
      if (!run.remote_run_id || !run.reference_json) {
        await c.env.DB.prepare(`UPDATE cloud_agent_runs SET state = 'unknown', error = ?, updated_at = ?
          WHERE ${OWNED_RUN_SQL} AND state IN (${ACTIVE_SQL})`)
          .bind("No remote receipt was saved. Check the provider before creating another request; this integration will not blindly retry a paid operation.", now, run.id, leaseToken).run();
        return c.json({ run: runView((await loadRun(c.env.DB, granted.slug, connection.id, run.id))!) });
      }
      if (action === "cancel" && !connection.supports_cancel) return fail(c, 400, "This connection cannot cancel a single group request. Check the task in the provider.", "unsupported");
      const config = await providerConfig(connection, c.env);
      const ready = await c.env.DB.prepare(`UPDATE cloud_agent_runs SET lease_until = ?
        WHERE ${OWNED_RUN_SQL} AND state IN (${ACTIVE_SQL})`).bind(Date.now() + LEASE_MS, run.id, leaseToken).run();
      if (ready.meta.changes < 1) return c.json({ run: runView((await loadRun(c.env.DB, granted.slug, connection.id, run.id))!), reused: true });
      const reference = JSON.parse(run.reference_json) as ProviderRunReference;
      const update = action === "cancel" ? await cancelProviderRun(config, reference, options(c.env)) : await pollProviderRun(config, reference, options(c.env));
      return c.json({ run: runView(await persistUpdate(c, connection, run, update, leaseToken)) });
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      // A failed status GET never proves the run failed; retain its state and receipt for recovery.
      await c.env.DB.prepare(`UPDATE cloud_agent_runs SET error = ?, updated_at = ?
        WHERE ${OWNED_RUN_SQL} AND state IN (${ACTIVE_SQL})`).bind(error.message, Date.now(), initial.id, leaseToken).run();
      return c.json({ run: runView((await loadRun(c.env.DB, granted.slug, connection.id, initial.id))!) });
    } finally {
      await c.env.DB.prepare("UPDATE cloud_agent_runs SET lease_until = 0, lease_token = NULL WHERE id = ? AND lease_token = ?").bind(initial.id, leaseToken).run();
    }
  }
  app.post("/api/channels/:slug/cloud-agents/:id/runs/:runId/sync", route((c) => controlRun(c, "sync")));
  app.post("/api/channels/:slug/cloud-agents/:id/runs/:runId/cancel", route((c) => controlRun(c, "cancel")));

  app.get("/api/channels/:slug/files", route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    const limit = Number(c.req.query("limit") ?? "50"); const cursor = c.req.query("cursor");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor && cursor.length > 2048)) return fail(c, 400, "limit must be 1–100 and cursor must be an opaque page cursor.");
    const prefix = `${granted.slug}/`;
    const listed = await c.env.ATTACHMENTS.list({ prefix, limit, cursor, include: ["httpMetadata", "customMetadata"] });
    const files: ChannelFile[] = listed.objects.filter((object) => object.key.startsWith(prefix)).map((object) => {
      const path = object.key.slice(prefix.length);
      return { key: object.key, filename: object.customMetadata?.filename ?? path.split("/").at(-1) ?? "download",
        content_type: object.httpMetadata?.contentType ?? "application/octet-stream", size: object.size,
        url: `/api/channels/${granted.slug}/attachments/${path.split("/").map(encodeURIComponent).join("/")}`,
        uploaded_by: object.customMetadata?.uploaded_by, uploaded_at: object.uploaded.toISOString() };
    });
    return c.json({ files, cursor: listed.truncated ? listed.cursor : null });
  }));
  app.get("/api/channels/:slug/repositories", route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    return c.json({ repositories: await listRepositories(c.env.DB, granted.slug, granted.channel.visibility === "private") });
  }));
  app.post("/api/channels/:slug/repositories", route(async (c) => {
    const granted = await access(c, "manage"); if (granted instanceof Response) return granted;
    const body = await jsonObject(c);
    if (!body || !validRepositoryName(body.full_name) || (body.base_branch !== undefined && !validBranch(body.base_branch))
      || (body.credential !== undefined && !validCredential(body.credential))) return fail(c, 400, "Use owner/repo, an optional valid base branch, and an optional read credential.");
    const id = crypto.randomUUID(); const credential = body.credential as string | undefined;
    // Public groups always read GitHub anonymously. If the repository later turns
    // private, a previously saved token must not expose its new private contents.
    const encrypted = credential && granted.channel.visibility === "private"
      ? await sealCredential(credential, c.env.COLLABORATION_ENCRYPTION_KEY, `github:${granted.slug}:${id}`) : null;
    const inspected = await inspectRepository(body.full_name, body.base_branch as string | undefined, credential);
    if (inspected.isPrivate && granted.channel.visibility !== "private") return fail(c, 403, "Private repositories can only be bound to private groups. Change this group's visibility before binding the repository.", "forbidden");
    const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM channel_repositories WHERE channel_slug = ?").bind(granted.slug).first<{ n: number }>();
    if ((count?.n ?? 0) >= 30) return fail(c, 429, "This group has reached its limit of 30 repositories.", "rate_limited");
    try {
      await c.env.DB.prepare("INSERT INTO channel_repositories (id,channel_slug,full_name,base_branch,is_private,credential_ciphertext,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id, granted.slug, inspected.fullName, inspected.baseBranch, inspected.isPrivate ? 1 : 0, encrypted, granted.identity.account!, Date.now()).run();
    } catch (error) { if (uniqueViolation(error)) return fail(c, 409, "This repository is already bound to the group.", "conflict"); throw error; }
    const saved = await c.env.DB.prepare("SELECT * FROM channel_repositories WHERE id = ?").bind(id).first<RepositoryRow>();
    return c.json({ repository: repositoryView(saved!) }, 201);
  }));
  app.delete("/api/channels/:slug/repositories/:id", route(async (c) => {
    const granted = await access(c, "manage"); if (granted instanceof Response) return granted;
    const id = c.req.param("id") ?? "";
    // Check inside the deletion statement so a concurrent approval cannot enter
    // publication between a separate check and delete. Unknown/expired work must
    // retain its immutable proposal ID for safe recovery on GitHub.
    const removed = await c.env.DB.prepare(`DELETE FROM channel_repositories WHERE channel_slug = ? AND id = ?
      AND NOT EXISTS (SELECT 1 FROM code_change_proposals WHERE repository_id = channel_repositories.id
        AND state IN ('publishing','unknown'))`)
      .bind(granted.slug, id).run();
    if (!removed.meta.changes) {
      const exists = await c.env.DB.prepare("SELECT 1 FROM channel_repositories WHERE channel_slug = ? AND id = ?").bind(granted.slug, id).first();
      return exists ? fail(c, 409, "A code proposal is publishing or has an unknown remote outcome. Resolve that same proposal before removing this binding.", "conflict")
        : fail(c, 404, "Repository binding not found.", "not_found");
    }
    return c.json({ removed: true });
  }));
  for (const kind of ["pulls", "commits"] as const) {
    app.get(`/api/channels/:slug/repositories/:id/${kind}`, route(async (c) => {
      const granted = await access(c); if (granted instanceof Response) return granted;
      const row = await c.env.DB.prepare("SELECT * FROM channel_repositories WHERE channel_slug = ? AND id = ?")
        .bind(granted.slug, c.req.param("id") ?? "").first<RepositoryRow>();
      if (!row) return fail(c, 404, "Repository binding not found.", "not_found");
      if (row.is_private === 1 && granted.channel.visibility !== "private") return fail(c, 403, "Private repository data requires a private group.", "forbidden");
      const credential = granted.channel.visibility === "private" ? await repositoryCredential(row, c.env) : undefined;
      const data = kind === "pulls" ? await listPullRequests(row.full_name, credential) : await listRepositoryCommits(row.full_name, row.base_branch, credential);
      return c.json({ repository: repositoryView(row), [kind]: data });
    }));
  }

  app.post("/api/channels/:slug/mcp", route(async (c) => {
    const granted = await access(c); if (granted instanceof Response) return granted;
    return handleChannelMcp(c.req.raw, granted.slug, granted.identity, async (path, init) => forward(c, path, init));
  }));
  app.get("/api/channels/:slug/mcp", (c) => c.json({ error: "Use POST for this stateless MCP tools endpoint." }, 405));
  app.delete("/api/channels/:slug/mcp", (c) => c.json({ error: "This MCP endpoint has no server session to delete." }, 405));
  registerProposalRoutes(app, { access, forward, repositoryCredential, canParticipateInChannel: deps.canParticipateInChannel });
}
