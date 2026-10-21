import type { CloudAgentRunState, DirectAgentProvider } from "@agentparty/shared/collaboration";

/** These adapters talk to personal agent runtimes, never to a substitute model API. */
export interface ProviderConfig {
  provider: DirectAgentProvider;
  endpoint: string;
  credential: string;
  remoteAgentId?: string;
  remoteConversationId?: string;
  sessionId?: string;
}

export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>;
export interface ProviderOptions {
  /** Deployment-controlled, exact HTTPS origins. Never populate this from a user request. */
  allowedOrigins?: readonly string[];
  fetch?: ProviderFetch;
  timeoutMs?: number;
}
export interface ProviderStartInput {
  prompt: string;
  requestId: string;
  /** A server-generated, room-scoped Hermes API session; never a personal desktop session. */
  sessionId?: string;
}
export interface ProviderRunReference {
  remoteRunId: string;
  sessionId?: string;
  cursor?: string | null;
  deliveryMode?: "correlated" | "delivery_only";
}
export interface ProviderRunUpdate extends ProviderRunReference {
  state: CloudAgentRunState;
  /** Only a successful, run-correlated Hermes final answer can populate this field. */
  text?: string;
  /** Fixed local messages only; provider error payloads must never be surfaced. */
  note?: string;
}
export interface ProviderVerification {
  endpoint: string;
  remoteAgentId?: string;
  remoteConversationId?: string;
  supportsCancel: boolean;
  deliveryMode: "correlated" | "delivery_only";
}
export interface DiscoveredProviderAgent {
  id: string;
  name: string;
  remoteConversationId?: string;
}

export type ProviderErrorCode =
  | "invalid_configuration" | "endpoint_not_allowed" | "authentication_failed"
  | "provider_unavailable" | "rate_limited" | "invalid_response" | "conflict"
  | "not_found" | "unsupported" | "timeout" | "transport_failed";

/** Safe to expose `message`/`code`. No cause, response body, URL or credential is retained. */
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    /** A write may already have reached the provider. Never retry it under a fresh ID. */
    public readonly outcomeUnknown = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_OUTPUT_CHARS = 60_000;
const DELIVERY_NOTE = "Delivered to the personal Manus/Cue agent. Review the result in Manus/Cue; private conversation replies are not imported.";
const RUN_STATES: Readonly<Record<string, CloudAgentRunState>> = {
  started: "running", queued: "running", pending: "running", running: "running",
  stopping: "running", waiting_for_approval: "needs_input", waiting_for_input: "needs_input",
  waiting_for_clarification: "needs_input", completed: "completed", failed: "failed",
  cancelled: "cancelled", interrupted: "failed", unknown: "unknown",
};

function invalidConfiguration(): never {
  throw new ProviderError("invalid_configuration", "Invalid personal agent configuration.");
}
function invalidResponse(write = false): never {
  throw new ProviderError("invalid_response", "The provider returned an invalid response.", write);
}
function record(value: unknown, write = false): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalidResponse(write);
  return value as Record<string, unknown>;
}
function identifier(value: unknown, write = false): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value)) invalidResponse(write);
  return value;
}
function configIdentifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value)) invalidConfiguration();
  return value;
}

function publicHostname(host: string): boolean {
  // Block IP literals (including URL-normalized decimal/hex IPv4), local names and metadata.
  // DNS names remain a deployment trust decision: allowlist entries must resolve publicly.
  if (!host.includes(".") || host.includes(":") || /^[0-9.]+$/.test(host)) return false;
  if (host.endsWith(".") || host === "metadata.google.internal") return false;
  return ![".localhost", ".local", ".internal", ".lan", ".home", ".arpa"].some((suffix) => host.endsWith(suffix));
}

/** Returns the provider root, allowing Hermes profile roots but no arbitrary path/query. */
export function normalizeProviderEndpoint(config: Pick<ProviderConfig, "provider" | "endpoint">, options: ProviderOptions = {}): string {
  let url: URL;
  if (typeof config.endpoint !== "string" || config.endpoint.length > 2_048 || /[\\%\s]/.test(config.endpoint)) invalidConfiguration();
  try { url = new URL(config.endpoint); } catch { return invalidConfiguration(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !publicHostname(url.hostname)) {
    throw new ProviderError("endpoint_not_allowed", "The agent endpoint must be an approved public HTTPS endpoint.");
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (config.provider === "manus") {
    if (url.origin !== "https://api.manus.ai" || (path !== "" && path !== "/v2")) {
      throw new ProviderError("endpoint_not_allowed", "Manus connections must use the official Manus API endpoint.");
    }
    return "https://api.manus.ai";
  }
  if (config.provider !== "hermes") invalidConfiguration();
  if (!options.allowedOrigins?.includes(url.origin)) {
    throw new ProviderError("endpoint_not_allowed", "The deployment has not allowed this Hermes origin.");
  }
  if (path !== "" && path !== "/v1" && !/^\/p\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}(?:\/v1)?$/.test(path)) invalidConfiguration();
  return url.origin + path.replace(/\/v1$/, "");
}

function credential(config: ProviderConfig): string {
  if (typeof config.credential !== "string" || config.credential.length < 1 || config.credential.length > 8_192 || /[^\x21-\x7e]/.test(config.credential)) invalidConfiguration();
  return config.credential;
}

function redact(text: string, secret: string): string {
  return text.split(secret).join("[REDACTED]");
}

async function responseJson(response: Response, write: boolean): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().match(/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/)) invalidResponse(write);
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) invalidResponse(write);
  if (!response.body) invalidResponse(write);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let total = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) invalidResponse(write);
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    return invalidResponse(write);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

async function requestJson(
  config: ProviderConfig, options: ProviderOptions, path: string,
  { method = "GET", body, headers: extraHeaders }: { method?: "GET" | "POST"; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  const root = normalizeProviderEndpoint(config, options);
  const secret = credential(config);
  const write = method === "POST";
  const timeout = options.timeoutMs ?? 15_000;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60_000) invalidConfiguration();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderError("timeout", "The provider request timed out. Check the existing run before retrying.", write));
    }, timeout);
  });
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(config.provider === "hermes" ? { Authorization: `Bearer ${secret}` } : { "x-manus-api-key": secret }),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...extraHeaders,
  };
  const operation = async (): Promise<Record<string, unknown>> => {
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(root + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        // workerd supports manual/follow, not error. Reject 3xx below without following Location.
        redirect: "manual", signal: controller.signal,
      });
    } catch {
      throw new ProviderError("transport_failed", "Could not reach the provider. Check the existing run before retrying.", write);
    }
    if (response.status >= 300 && response.status < 400) {
      void response.body?.cancel().catch(() => undefined);
      throw new ProviderError("transport_failed", "Provider redirects are not allowed. Check the configured endpoint.", write);
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new ProviderError("authentication_failed", "The provider rejected the connection credentials or permissions.");
      if (response.status === 404) throw new ProviderError("not_found", "The provider resource was not found. A missing run is not proof that it never executed.", write);
      if (response.status === 409) throw new ProviderError("conflict", "The provider reported a session or execution conflict. Inspect the existing run.", write);
      if (response.status === 429) throw new ProviderError("rate_limited", "The provider rate limit was reached. Retry status checks later.", write);
      throw new ProviderError("provider_unavailable", "The provider did not accept the request. Check its status before retrying.", write);
    }
    const result = record(await responseJson(response, write), write);
    if (config.provider === "manus" && result.ok !== true) {
      throw new ProviderError("provider_unavailable", "Manus did not confirm the request.", write);
    }
    return result;
  };
  try { return await Promise.race([operation(), timedOut]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}

async function hermesCapabilities(config: ProviderConfig, options: ProviderOptions) {
  const value = await requestJson(config, options, "/v1/capabilities");
  if (value.object !== "hermes.api_server.capabilities" || value.platform !== "hermes-agent") invalidResponse();
  const auth = record(value.auth);
  const features = record(value.features);
  if (auth.type !== "bearer" || auth.required !== true || features.run_submission !== true || features.run_status !== true) {
    throw new ProviderError("unsupported", "This Hermes server does not expose the authenticated native runs API.");
  }
  return { id: identifier(value.model), supportsCancel: features.run_stop === true };
}

export async function discover(config: ProviderConfig, options: ProviderOptions = {}): Promise<DiscoveredProviderAgent[]> {
  if (config.provider === "hermes") {
    const result = await hermesCapabilities(config, options);
    return [{ id: result.id, name: result.id }];
  }
  const result = await requestJson(config, options, "/v2/agent.list");
  if (!Array.isArray(result.data) || result.data.length > 1_000) invalidResponse();
  return result.data.map((item) => {
    const agent = record(item);
    const id = identifier(agent.id);
    const remoteConversationId = identifier(agent.task_id);
    if (typeof agent.nickname !== "string" || agent.nickname.length > 256) invalidResponse();
    return { id, remoteConversationId, name: redact(agent.nickname, config.credential) };
  });
}

export async function verify(config: ProviderConfig, options: ProviderOptions = {}): Promise<ProviderVerification> {
  const endpoint = normalizeProviderEndpoint(config, options);
  if (config.provider === "hermes") {
    const result = await hermesCapabilities(config, options);
    return { endpoint, remoteAgentId: result.id, supportsCancel: result.supportsCancel, deliveryMode: "correlated" };
  }
  const agentId = configIdentifier(config.remoteAgentId);
  const result = await requestJson(config, options, `/v2/agent.detail?agent_id=${encodeURIComponent(agentId)}`);
  const agent = record(result.agent);
  const remoteAgentId = identifier(agent.id);
  const remoteConversationId = identifier(agent.task_id);
  if (remoteAgentId !== agentId && agentId !== "agent-default") invalidResponse();
  if (config.remoteConversationId && config.remoteConversationId !== remoteConversationId) {
    throw new ProviderError("conflict", "The personal agent's conversation changed. Reconnect it before sending work.");
  }
  return { endpoint, remoteAgentId, remoteConversationId, supportsCancel: false, deliveryMode: "delivery_only" };
}

function parseHermesRun(value: Record<string, unknown>, config: ProviderConfig, reference: ProviderRunReference, write = false): ProviderRunUpdate {
  const remoteRunId = identifier(value.run_id, write);
  if (reference.remoteRunId && remoteRunId !== reference.remoteRunId) invalidResponse(write);
  const status = value.status;
  if (typeof status !== "string" || !Object.hasOwn(RUN_STATES, status)) invalidResponse(write);
  const sessionId = value.session_id === undefined ? reference.sessionId : identifier(value.session_id, write);
  if (reference.sessionId && sessionId !== reference.sessionId) invalidResponse(write);
  const state = RUN_STATES[status];
  const update: ProviderRunUpdate = { remoteRunId, state, sessionId, deliveryMode: "correlated" };
  if (state === "completed") {
    if (typeof value.output !== "string" || value.output.length > MAX_OUTPUT_CHARS) invalidResponse(write);
    update.text = redact(value.output, config.credential);
  }
  if (state === "needs_input") update.note = "This run needs human input. Review the approval or clarification in Hermes, then sync again.";
  if (state === "failed") update.note = "The Hermes run failed or was interrupted. Review its status in Hermes.";
  if (state === "unknown") update.note = "Hermes cannot confirm the execution outcome. Resolve the existing run in Hermes; do not start a duplicate.";
  if (status === "stopping") update.note = "Cancellation was requested. Sync again until Hermes confirms the run has stopped.";
  return update;
}

/** One write only. The caller must persist its request claim before invoking this function. */
export async function start(config: ProviderConfig, input: ProviderStartInput, options: ProviderOptions = {}): Promise<ProviderRunUpdate> {
  if (typeof input.prompt !== "string" || !input.prompt.trim() || input.prompt.length > 20_000) invalidConfiguration();
  const requestId = configIdentifier(input.requestId);
  if (requestId.length > 255) invalidConfiguration();
  if (config.provider === "hermes") {
    const sessionId = configIdentifier(input.sessionId ?? config.sessionId);
    const value = await requestJson(config, options, "/v1/runs", {
      method: "POST", body: { input: input.prompt, session_id: sessionId },
      headers: { "Idempotency-Key": requestId, "X-Hermes-Session-Key": sessionId },
    });
    return parseHermesRun(value, config, { remoteRunId: "", sessionId }, true);
  }

  // A personal Cue agent has one shared main task, not one run per API request. Neither
  // timestamp order nor a prompt marker is a trustworthy response-correlation mechanism.
  // Capture only an opaque baseline event ID, then discard every message body forever.
  const taskId = configIdentifier(config.remoteConversationId);
  await verify(config, options);
  const baseline = await requestJson(config, options, `/v2/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=1&verbose=false`);
  if (baseline.task_id !== taskId || !Array.isArray(baseline.messages) || baseline.messages.length > 1) invalidResponse();
  const cursor = baseline.messages.length ? identifier(record(baseline.messages[0]).id) : null;
  const receipt = await requestJson(config, options, "/v2/task.sendMessage", {
    method: "POST", body: { task_id: taskId, message: { content: input.prompt } },
  });
  if (receipt.task_id !== taskId) invalidResponse(true);
  return {
    remoteRunId: identifier(receipt.request_id, true), sessionId: taskId, cursor,
    state: "submitted", deliveryMode: "delivery_only", note: DELIVERY_NOTE,
  };
}

export async function poll(config: ProviderConfig, run: ProviderRunReference, options: ProviderOptions = {}): Promise<ProviderRunUpdate> {
  const remoteRunId = configIdentifier(run.remoteRunId);
  normalizeProviderEndpoint(config, options);
  if (config.provider === "manus") {
    const taskId = configIdentifier(config.remoteConversationId);
    if (run.sessionId !== taskId) invalidConfiguration();
    // No listMessages here: no supported field links private assistant replies to the receipt.
    return { remoteRunId, sessionId: taskId, cursor: run.cursor ?? null, state: "submitted", deliveryMode: "delivery_only", note: DELIVERY_NOTE };
  }
  const value = await requestJson(config, options, `/v1/runs/${encodeURIComponent(remoteRunId)}`);
  return parseHermesRun(value, config, run);
}

export async function cancel(config: ProviderConfig, run: ProviderRunReference, options: ProviderOptions = {}): Promise<ProviderRunUpdate> {
  const remoteRunId = configIdentifier(run.remoteRunId);
  if (config.provider === "manus") {
    // task.stop stops the entire personal main task and could affect unrelated private work.
    throw new ProviderError("unsupported", "Cancel this task in Manus/Cue. This integration cannot safely cancel only the group request.");
  }
  const capabilities = await hermesCapabilities(config, options);
  if (!capabilities.supportsCancel) throw new ProviderError("unsupported", "This Hermes server does not support cancelling a run.");
  const value = await requestJson(config, options, `/v1/runs/${encodeURIComponent(remoteRunId)}/stop`, { method: "POST", body: {} });
  if (value.status !== "stopping" && value.status !== "cancelled") invalidResponse(true);
  // The official stop receipt need not include run_id. A stop request is not completion.
  return parseHermesRun({ ...value, run_id: value.run_id ?? remoteRunId }, config, run, true);
}

export { verify as verifyProvider, discover as discoverProviderAgents, start as startProviderRun, poll as pollProviderRun, cancel as cancelProviderRun };
