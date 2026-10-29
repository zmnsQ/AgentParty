# Manual Bearer MCP tool metadata — 2026-10-29

## Change

The same group MCP endpoint already accepts an authenticated, dedicated Agent
Bearer scoped to that group. Its `tools/list` formerly advertised the OAuth-only
`securitySchemes` extension for every caller, including clients configured with
a manual Bearer header. For those authenticated manual callers, the response now
omits that extension. OAuth-issued identities retain the existing OAuth scopes.
The shared tool catalog is not mutated between requests.

This is **not** an anonymous/noauth mode, nor a claim that all MCP clients support
manual Bearer configuration. No invented `apiKey` or `http` securitySchemes value
is advertised. Clients that require OAuth should continue using the existing
OAuth flow. The endpoint, authentication, OAuth identity classification, group
scope checks, MFA/policy gate, read/write filtering, event permissions, rate
limits, revocation, and unauthenticated 401 challenge are unchanged.

## Protocol basis

- Core [MCP tool definition](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
  describes schemas/annotations; per-tool `securitySchemes` is not required by
  that tool schema.
- [OpenAI authentication extension](https://developers.openai.com/plugins/build/auth)
  uses per-tool schemes to convey OAuth vs anonymous access. Consequently the
  manual path must not be mislabeled `noauth` merely because transport Bearer
  authentication has already succeeded.
- [Official MCP Ruby client authorization](https://ruby.sdk.modelcontextprotocol.io/client/authorization/)
  documents custom Bearer headers separately from its OAuth provider flow.

## Validation scope

Added regression in `worker/test/connector-oauth.spec.ts`: obtain a real local
fixture OAuth grant, list tools with OAuth, list with a normal scoped Agent
Bearer, then list again with OAuth. Verify only manual response lacks the
extension, OAuth read/write scopes and names remain correct, and no shared
catalog mutation occurs.

Run with `worker/test/mcp-security.spec.ts` for existing manual Bearer boundaries:
human/unscoped/foreign/revoked tokens rejected; disabled/MFA gate retained;
read-only policy hides writes and denies their execution; cross-group reads and
query-string credentials fail. Tests use synthetic local fixtures only. No real
credential minting, account connection or deployment is part of this change.

Local verification: **41 tests passed across the two Worker integration suites**
(`/tmp/manual-bearer-mcp-tests.log`); Worker TypeScript `--noEmit` passed
(`/tmp/manual-bearer-mcp-typecheck.log`). No real client end-to-end connection
was performed; compatibility still depends on the client supporting a manually
configured Authorization header.

## Group UI and credential lifecycle

Group details → connect Agent → Other MCP platforms exposes two separate paths:
OAuth remains the default; Manual Token/header is available for clients that
support remote HTTP MCP and a custom Authorization header. The group URL is
copyable before creating any credential. Creation is explicit and uses the
existing human-authorized `POST /api/agents` with this group's `channel_scope`.
URL, token and the full header are separate; credentials never enter URLs.

The token is a normal group-scoped Agent credential, **not MCP-only**: existing
permitted group REST actions remain possible. It is not the OAuth access token
and no OAuth TTL or refresh mechanism is changed. MCP enabled/read/write/event
policy and existing approvals still apply. Successful setup does not establish
a live subscription, resident agent or automatic response capability.

Secrets are view-local. Leaving the method, changing credentials/group/server or
closing the guide removes the displayed secret, but does not revoke the server
credential or clear an already copied clipboard. My Agents provides management,
revocation and regeneration (which invalidates the old token without recreating
the identity). Unknown creation results stay locked for this guide and across
human-token refresh; inspect the existing identity before retrying. This is not
a persistent cross-browser transaction ledger. Refreshing/reopening the entire
application still requires the user to follow the unknown-result guidance.

Synchronous duplicate clicks, stale/ABA create results, scope changes, unmount,
late clipboard rejection and OAuth/manual return are covered by component tests.
The secret-copy path deliberately does not use delayed DOM fallback after a
clipboard rejection; a late failure cannot reinsert a cleared token in the DOM.

## Observed production baseline and release boundary

On 2026-10-29 at 12:29:54 and 12:29:59 UTC, public `/api/version` and
`/api/health` both returned HTTP 200 and commit
`997f9496890e3d9f980e616f34e5318852fa1cd9`, deployed_at
`2026-10-28T08:09:55Z`; health had `ok:true`. GitHub main at inspection was
`63b182023af5b593888e863276f3ee0b4f95d10a`. Publication and deployment are
therefore distinct; deployment must re-read the actual baseline onsite.

No schema/migration, real token, account connection, MCP permission setting,
external message, production deployment or Muse experimental flag is changed.

## Browser validation limitation

This round's normal installed Chromium/Playwright launch against the local,
isolated real-App fixture failed at process startup with socket EPERM. A normal
approved escalated attempt failed before browser startup with a sandbox bwrap
read-only filesystem error. No restricted path was read, sandbox disabled or
permission bypass attempted. The temporary preview server was stopped normally.
Thus this round has **no new browser screenshot or real third-party-client
acceptance**. Component lifecycle tests, static review, TypeScript and build
results must not be represented as those missing checks. Older screenshots do
not verify this new manual credential panel.

## Correction of the supplied third-party diagnostic

- A missing/invalid Bearer returns 401 with OAuth discovery metadata before the
  endpoint's method handling. This does not prove that manual Bearer is rejected.
  After valid auth, GET/DELETE are 405 on this stateless endpoint.
- `initialize` returns finite JSON even when Accept includes text/event-stream;
  only the distinct authorized `events/stream` method opens a stream. A hanging
  initialize request is not proof of normal SSE behavior. Regression added.
- `/api/config` reports separately configured OIDC/provider entries. Empty values
  do not prove that the site's GitHub/browser-session/MFA-backed connector OAuth
  is unavailable. `/oauth/authorize` uses that separate path. Real deployment
  OAuth availability must be checked independently, not inferred from this list.
- `/api/tokens` is an admin-secret bootstrap endpoint. The group UI uses the
  authenticated human `/api/agents` API instead. Never share admin/human login
  credentials to make a client work, or disable authentication as a workaround.
- Client JSON `url` must contain a plain HTTPS URL, not a Markdown link. A custom
  header's name is `Authorization`; its value is `Bearer <agent-token>`. A
  dedicated Bearer-token input usually takes just the token. Client-specific
  configuration formats still need its own documentation.

## Final local checks

- Web full isolated run: 204 files, 1,735 tests passed, no failed file
  (`/tmp/manual-mcp-web-full.json`, `.log`). Final affected three-file rerun:
  36 tests / 196 assertions passed (includes later lifecycle refinements).
- Worker full run: 148 files, 1,270 tests passed, no failures
  (`/tmp/manual-mcp-worker-full.log`). The additional initialize/SSE diagnostic
  regression was added afterward; the complete affected 12-test file passed
  (`/tmp/manual-mcp-initialize-final.log`). Do not describe the earlier full run
  as including the subsequently added test.
- Web and Worker TypeScript passed; final Web production build passed with the
  existing large-chunk warning. No dependency or lockfile change.
- Independent read-only review passed backend auth preservation and UI lifecycle
  boundaries; focused tests independently executed. No actual third-party
  authorization or real-account tests were performed.
