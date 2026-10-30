import type { MiddlewareHandler } from "hono";

// This is a temporary, build-opted-in diagnostic, not a request/body logger.
declare const __AGENTPARTY_MCP_DIAGNOSTICS_FROM__: string | undefined;
declare const __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__: string | undefined;
// Capture the MCP path shape, including a trailing slash or malformed channel
// segment that the real router may reject. Never retain or emit that segment.
const ROUTE = /^\/api\/channels\/[^/]+\/mcp\/?$/;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const CODES = ["unauthorized", "participant_removed", "origin_rejected", "permission_denied",
  "mcp_disabled", "rate_limited", "method_not_allowed", "unsupported_media_type",
  "protocol_version_unsupported", "invalid_json", "body_too_large", "invalid_request",
  "invalid_params", "method_not_found", "tool_error", "internal_error", "not_found",
  "request_rejected", "client_too_old", "invite_required"] as const;
export type McpDiagnosticCode = typeof CODES[number];
const pending = new WeakMap<Request, { code?: McpDiagnosticCode }>();

/** Call only with a fixed category. Never derive a diagnostic from messages or bodies. */
export function markMcpDiagnostic(request: Request, code: McpDiagnosticCode): void {
  const state = pending.get(request);
  if (state && (CODES as readonly string[]).includes(code)) state.code = code;
}

function statusCode(status: number): McpDiagnosticCode | null {
  if (status >= 500) return "internal_error";
  return ({ 400: "invalid_request", 401: "unauthorized", 403: "permission_denied", 404: "not_found",
    405: "method_not_allowed", 413: "body_too_large", 415: "unsupported_media_type",
    426: "client_too_old", 429: "rate_limited" } as Record<number, McpDiagnosticCode>)[status]
    ?? (status >= 400 ? "request_rejected" : null);
}

export const MCP_CAPTURE_LIMITS = Object.freeze({
  maxWindowMs: 10 * 60_000,
  maxRequests: 1024,
  maxRecordBytes: 512,
  maxControlRecords: 3,
  maxRecords: 2051,
  maxApplicationBytes: 2051 * 512,
});
const PREFIX = "mcp_request_diagnostic";
type ControlCode = "diagnostic_window_opened" | "diagnostic_limit_reached" | "diagnostic_window_closed";
type CaptureCode = McpDiagnosticCode | ControlCode | "diagnostic_pending_at_cutoff";
type Entry = {
  id: string; started: number; method: string; authorization: boolean;
  code?: McpDiagnosticCode; done: boolean; timer?: ReturnType<typeof setTimeout>;
};
type Window = {
  from: number; until: number; id?: string; opened: boolean; closed: boolean;
  limitMarked: boolean; admitted: number; pending: Map<string, Entry>;
};

/** Every admitted request reserves two records before dispatch. No sampling.
 * The three control records have separate space, so saturation is observable.
 * A cutoff snapshot is explicitly not an HTTP result; no body or stream is read.
 */
export function mcpRequestDiagnostics(options: {
  from?: () => string | undefined; until?: () => string | undefined; now?: () => number;
} = {}): MiddlewareHandler {
  const clock = options.now ?? (() => Date.now());
  const from = options.from ?? (() => typeof __AGENTPARTY_MCP_DIAGNOSTICS_FROM__ === "string"
    ? __AGENTPARTY_MCP_DIAGNOSTICS_FROM__ : undefined);
  const until = options.until ?? (() => typeof __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__ === "string"
    ? __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__ : undefined);
  let window: Window | undefined;
  function configured(): Window | undefined {
    if (window) return window;
    // Evaluate clocks/configuration only in the request's I/O context. Missing,
    // invalid, reversed or overly long windows remain disabled, including old
    // builds that provide UNTIL without the new explicit FROM opt-in.
    const start = Date.parse(from() ?? ""), end = Date.parse(until() ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MCP_CAPTURE_LIMITS.maxWindowMs) return;
    return window = { from: start, until: end, opened: false, closed: false,
      limitMarked: false, admitted: 0, pending: new Map() };
  }
  function emit(at: number, id: string, method: string, authorization: boolean,
    status: number | null, duration: number | null, code: CaptureCode | null): boolean {
    try {
      const serialized = JSON.stringify({request_time: new Date(at).toISOString(), request_id: id,
        method, route: "/api/channels/:slug/mcp", authorization_present: authorization,
        http_status: status, duration_ms: duration, error_code: code});
      // All values are generated ASCII, fixed enums or bounded numbers.
      if (PREFIX.length + serialized.length + 2 > MCP_CAPTURE_LIMITS.maxRecordBytes) return false;
      console.warn(PREFIX, serialized);
      return true;
    } catch { return false; /* Log failures must never change authentication or results. */ }
  }
  function control(w: Window, at: number, code: ControlCode): boolean {
    return emit(at, w.id ??= crypto.randomUUID(), "OTHER", false, null, null, code);
  }
  function limit(w: Window, at: number): void {
    w.admitted = MCP_CAPTURE_LIMITS.maxRequests;
    if (!w.limitMarked) {
      w.limitMarked = true;
      control(w, at, "diagnostic_limit_reached");
    }
  }
  function finish(w: Window, entry: Entry, at: number, status: number | null, code: CaptureCode | null): void {
    if (entry.done) return;
    entry.done = true;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    w.pending.delete(entry.id);
    if (!emit(entry.started, entry.id, entry.method, entry.authorization, status,
      Math.max(0, at - entry.started), code)) limit(w, at);
  }
  function close(w: Window, observedAt: number): void {
    if (w.closed) return;
    w.closed = true;
    // An in-flight request gets one explicit unknown-status cutoff snapshot,
    // never a fabricated HTTP response and never a second completion later.
    for (const entry of w.pending.values())
      finish(w, entry, w.until, null, "diagnostic_pending_at_cutoff");
    control(w, observedAt, "diagnostic_window_closed");
  }
  return async (c, next) => {
    const w = configured(), started = clock();
    if (!w || started < w.from || w.closed) { await next(); return; }
    // This hook also runs on existing /api/health. A coordinator can observe
    // OPEN/CLOSED without sending an MCP request or changing any configuration.
    if (started >= w.until) { close(w, started); await next(); return; }
    if (!w.opened) {
      w.opened = true;
      if (!control(w, started, "diagnostic_window_opened")) limit(w, started);
    }
    if (!ROUTE.test(c.req.path)) { await next(); return; }
    if (w.admitted >= MCP_CAPTURE_LIMITS.maxRequests) {
      limit(w, started);
      await next(); return;
    }
    w.admitted++;
    const request = c.req.raw;
    const entry: Entry = { id: crypto.randomUUID(), started,
      method: METHODS.has(request.method) ? request.method : "OTHER",
      authorization: request.headers.has("authorization"), done: false };
    pending.set(request, entry);
    w.pending.set(entry.id, entry);
    if (!emit(started, entry.id, entry.method, entry.authorization, null, null, null)) limit(w, started);
    // Only active requests own timers. Completed requests cancel their timer.
    // If the window is idle at cutoff, the next health/API request emits CLOSED.
    entry.timer = setTimeout(() => close(w, Math.max(clock(), w.until)), Math.max(0, w.until - started));
    let threw = false;
    try { await next(); }
    catch (error) { threw = true; throw error; }
    finally {
      const ended = clock();
      if (ended >= w.until) close(w, ended);
      if (!entry.done) {
        const status = threw ? 500 : c.res.status;
        finish(w, entry, ended, status, threw ? "internal_error" : entry.code ?? statusCode(status));
      }
      pending.delete(request);
    }
  };
}
