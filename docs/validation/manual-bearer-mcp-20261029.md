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

Secrets are view-local. Leaving the method, changing verified account/group/server or
closing the guide removes the displayed secret. A same-account access-token renewal
while this guide remains open preserves the current secret in memory; unknown
authentication identity changes are still treated conservatively. This does not revoke the server
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

## Follow-up: same-account refresh and complete JSON (2026-10-29)

A reported production defect was traced to the manual wizard key and credential
scope including the human access-token string. Browser session refresh and OIDC
renewal legitimately change that string while the human remains the same. The
wizard consequently unmounted/cleared the one-time Agent credential even though
the user had not left setup. The creation-attempt safety lock correctly remained,
which made the lost reveal particularly confusing.

The production AgentJoin → CodingAgentSetup → DirectMcpSetup → ManualMcpSetup
chain now carries the verified account key. Secret lifetime is bound to server,
group and verified account, not the human token's rotating bytes. If no verified
account key is available, token changes still invalidate the view conservatively.
Explicit Back/Close, real group/server/account changes, and stale ABA requests
remain invalidating boundaries. Secrets remain only in mounted React memory:
no storage, URL, logs or restore endpoint is added. A full browser reload still
cannot recover a lost one-time secret; this fixes background refresh, not reload.

Generation now also offers a complete JSON configuration using JSON.stringify:
`mcpServers` → group-specific key → HTTP URL and Authorization header. The real
fixture token is included only in that private view and in the clipboard on an
explicit click. Copy rejection preserves the view and reports failure, without
any late DOM fallback. Users must merge the server entry in a client that supports
this JSON schema; not every client uses identical configuration fields.

The upstream `/me` refresh also no longer converts a transient network/server
failure into a logout-like unmount of AgentJoin. A token+origin verification
marker is explicitly carried only by authenticated renewal. Unknown new
credentials clear the old identity before the new `/me` request finishes; 401
and 403 clear it as well. `fetchMe` now classifies 403 as ForbiddenError. This is
UI continuity, not authorization caching: API calls still send the current
credential and the server remains the permission authority.

Follow-up regression covers the actual AgentJoin component chain, changed
presence/charter snapshots, same-owner token renewal including pending creation,
unknown-account and real group/server/ABA changes, explicit close, JSON parsing
and escaping, clipboard rejection, and App identity-refresh failures. No real
production token was read, recovered, generated, revoked or copied. The previously
reported browser sandbox startup limitation remains; component regressions and
builds are not a new visual or third-party client end-to-end acceptance.

Final follow-up validation: Web 204 isolated test files, 1745 tests passed, zero
failed files; Web TypeScript and production build passed. No Worker source or
database schema changed in this follow-up; previous Worker coverage is not
presented as a new backend test run.
