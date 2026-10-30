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

/** At most 64 admissions / 128 small records per isolate, with no counter reset.
 * Start records distinguish a reached-but-unfinished request from no arrival.
 * Completion means response headers are ready; response streams are never read.
 * The absolute build deadline stops new admissions even after process restarts.
 */
export function mcpRequestDiagnostics(options: { until?: () => string | undefined } = {}): MiddlewareHandler {
  let admitted = 0;
  const until = options.until ?? (() => typeof __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__ === "string"
    ? __AGENTPARTY_MCP_DIAGNOSTICS_UNTIL__ : undefined);
  return async (c, next) => {
    const started = Date.now();
    const deadline = Date.parse(until() ?? "");
    if (!ROUTE.test(c.req.path) || !Number.isFinite(deadline) || started >= deadline || admitted >= 64) {
      await next(); return;
    }
    admitted++;
    const request = c.req.raw;
    const state: { code?: McpDiagnosticCode } = {};
    pending.set(request, state);
    const fields = {
      request_time: new Date(started).toISOString(), request_id: crypto.randomUUID(),
      method: METHODS.has(request.method) ? request.method : "OTHER",
      route: "/api/channels/:slug/mcp", authorization_present: request.headers.has("authorization"),
    };
    const emit = (status: number | null, code: McpDiagnosticCode | null) => {
      try {
        console.warn("mcp_request_diagnostic", JSON.stringify({ ...fields,
          http_status: status, duration_ms: status === null ? null : Math.max(0, Date.now() - started),
          error_code: code,
        }));
      } catch { /* Diagnostics must never change authentication or request results. */ }
    };
    emit(null, null);
    let threw = false;
    try { await next(); }
    catch (error) { threw = true; throw error; }
    finally {
      const status = threw ? 500 : c.res.status;
      emit(status, threw ? "internal_error" : state.code ?? statusCode(status));
      pending.delete(request);
    }
  };
}
