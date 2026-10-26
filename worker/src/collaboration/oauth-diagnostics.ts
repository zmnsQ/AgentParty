import {sha256Hex} from "../auth";
/** Fixed categories only. Never pass credentials, identities, URLs or exceptions to logs. */
const REASONS = ["internal_error", "request_rejected", "duplicate_parameter", "client_auth_rejected",
  "client_unknown_or_disabled", "client_secret_rejected", "public_client_auth_rejected", "resource_rejected",
  "refresh_format_rejected", "refresh_unknown_or_rotated", "refresh_expired", "refresh_revoked",
  "refresh_resource_mismatch", "refresh_lookup_rejected", "diagnostic_unavailable", "code_rejected",
  "policy_denied", "ownership_denied", "refresh_cas_not_applied", "identity_update_not_applied",
  "grant_write_not_applied", "unsupported_grant_type", "issued", "refreshed"] as const;
export type OAuthReason = typeof REASONS[number];
type ClientKind = "unknown" | "public" | "confidential" | "muse_native" | "muse_confidential" | "native_cli";
type GrantKind = "unknown" | "authorization_code" | "refresh_token" | "other";

export class OAuthDiagnosticError extends Error {
  constructor(readonly reason: OAuthReason) { super("invalid_grant"); }
}

export class OAuthTokenDiagnostic {
  clientKind: ClientKind = "unknown";
  private grantKind: GrantKind = "unknown";
  private reason: OAuthReason = "internal_error";
  private status = 500;
  private parsed = false;
  private clientPresent = false;
  private resourcePresent = false;
  private refreshPresent = false;
  private secretPresent = false;
  constructor(private readonly authorizationPresent: boolean) {}
  form(params: URLSearchParams): void {
    this.parsed = true;
    const kind = params.get("grant_type");
    this.grantKind = kind === "authorization_code" || kind === "refresh_token" ? kind : "other";
    this.clientPresent = params.has("client_id"); this.resourcePresent = params.has("resource");
    this.refreshPresent = params.has("refresh_token"); this.secretPresent = params.has("client_secret");
  }
  finish(response: Response, reason: OAuthReason): Response {
    this.status = response.status; this.reason = reason; return response;
  }
  log(): void {
    try {
      console.warn("oauth_token_completed", JSON.stringify({
        reason: (REASONS as readonly string[]).includes(this.reason) ? this.reason : "internal_error",
        client_kind: ["unknown", "public", "confidential", "muse_native", "muse_confidential", "native_cli"].includes(this.clientKind) ? this.clientKind : "unknown",
        grant_kind: this.grantKind, parsed_form: this.parsed,
        client_id_present: this.clientPresent, resource_present: this.resourcePresent,
        refresh_token_present: this.refreshPresent, client_secret_present: this.secretPresent,
        authorization_present: this.authorizationPresent, http_status: this.status,
      }));
    } catch { /* Logging must never turn a successful exchange into a failure. */ }
  }
}

/** A failed lookup is inspected only for diagnostics, never to grant access.
 * A rotated-away hash cannot be distinguished from an unknown hash without history. */
export async function diagnoseRefreshFailure(db: D1Database, refresh: string, clientId: string | null,
  resource: string | null = null): Promise<OAuthReason> {
  try {
    const row = await db.prepare(`SELECT revoked_at IS NOT NULL AS revoked,
      refresh_expires_at <= ? AS expired, (? IS NULL OR resource = ?) AS resource_matches
      FROM connector_oauth_grants WHERE refresh_hash=? AND (? IS NULL OR client_id=?)`)
      .bind(Date.now(), resource, resource, await sha256Hex(refresh), clientId, clientId)
      .first<{revoked:number;expired:number;resource_matches:number}>();
    if (!row) return "refresh_unknown_or_rotated";
    if (row.revoked) return "refresh_revoked";
    if (row.expired) return "refresh_expired";
    if (!row.resource_matches) return "refresh_resource_mismatch";
    return "refresh_lookup_rejected";
  } catch { return "diagnostic_unavailable"; }
}
