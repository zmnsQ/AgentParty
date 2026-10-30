import type { MiddlewareHandler } from "hono";

// This is a temporary, build-opted-in diagnostic, not a request/body logger.
declare const __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__: string | undefined;
const ROUTE = /^\/api\/channels\/[a-z0-9][a-z0-9-]{0,63}\/mcp$/;
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

const MINUTE = 60_000;
const MAX_WINDOW = 3 * 60 * MINUTE;
const MAX_RECORD_BYTES = 512; // Includes our fixed prefix and newline; all fields are ASCII.

class Bucket {
  private tokens: number;
  private last: number;
  constructor(private capacity: number, private perMinute: number, now: number) {
    this.tokens = capacity; this.last = now;
  }
  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.last) * this.perMinute / MINUTE);
    this.last = Math.max(this.last, now);
    if (this.tokens < 1) return false;
    this.tokens--; return true;
  }
}

/** Independent success/arrival sampling and failure budgets.
 * Normal traffic cannot spend failure tokens or the reserved failure log space.
 * At most 384 normal + 768 failure records, each <=512 bytes (576 KiB/isolate).
 * These hard caps cover the maximum token refill over the entire three-hour window.
 * A failure may have no sampled start. Completion means headers ready, never body read.
 */
export function mcpRequestDiagnostics(options: {
  until?: () => string | undefined; now?: () => number;
} = {}): MiddlewareHandler {
  const clock = options.now ?? (() => Date.now());
  const activated = clock();
  const normal = new Bucket(1, 1, activated);
  const failure = new Bucket(8, 4, activated);
  let normalRecords = 384, failureRecords = 768;
  const until = options.until ?? (() => typeof __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__ === "string"
    ? __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__ : undefined);
  const deadline = () => Math.min(Date.parse(until() ?? ""), activated + MAX_WINDOW);
  return async (c, next) => {
    const started = clock(), end = deadline();
    if (!ROUTE.test(c.req.path) || !Number.isFinite(end) || started >= end) {
      await next(); return;
    }
    const request = c.req.raw;
    const state: { code?: McpDiagnosticCode } = {};
    pending.set(request, state);
    const sampled = normalRecords >= 2 && normal.take(started);
    // Reserve a pair before logging the sampled arrival. No later success can
    // consume the space reserved for failures, even with many in-flight requests.
    if (sampled) normalRecords -= 2;
    let requestId: string | undefined;
    const emit = (status: number | null, code: McpDiagnosticCode | null) => {
      try {
        if (clock() >= deadline()) return;
        const serialized = JSON.stringify({
          request_time: new Date(started).toISOString(), request_id: requestId ??= crypto.randomUUID(),
          method: METHODS.has(request.method) ? request.method : "OTHER",
          route: "/api/channels/:slug/mcp", authorization_present: request.headers.has("authorization"),
          http_status: status, duration_ms: status === null ? null : Math.max(0, clock() - started),
          error_code: code,
        });
        if ("mcp_request_diagnostic ".length + serialized.length + 1 > MAX_RECORD_BYTES) return;
        console.warn("mcp_request_diagnostic", serialized);
      } catch { /* Diagnostics must never change authentication or request results. */ }
    };
    if (sampled) emit(null, null);
    let threw = false;
    try { await next(); }
    catch (error) { threw = true; throw error; }
    finally {
      const status = threw ? 500 : c.res.status;
      const code = threw ? "internal_error" : state.code ?? statusCode(status);
      const failed = status < 200 || status >= 300 || code !== null;
      if (clock() < deadline()) {
        if (failed) {
          if (failureRecords > 0 && failure.take(clock())) {
            failureRecords--; emit(status, code);
          }
        } else if (sampled) emit(status, null);
      }
      pending.delete(request);
    }
  };
}
