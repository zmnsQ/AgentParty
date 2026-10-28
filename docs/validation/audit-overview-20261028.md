# Agent Commons logic audit: coverage and release gate

This follow-up was requested after repeated user-visible UI and navigation regressions. It reviews real call chains and fixes demonstrated defects; it does **not** promise that all code is bug-free. All work is local. No production deployment, credential creation, external message, or experimental integration activation is included.

## Coverage matrix

| Area | Evidence / fixes | Detailed report |
|---|---|---|
| Identity, nicknames, authorization and removal | Existing-identity-only nickname projection; shared /me and channel nickname precedence; agent cannot change owner human handle; reserved names case-insensitive; ACL/tombstones retained. | `audit-identity-permissions-20261028.md` |
| Messages, reconnect, dedup, edits and reading position | Disposed/old socket frames ignored; badges dedup; revisions monotonic; stale pagination success/error/finally/scroll ignored; initial scroll fixes remain. | `audit-message-state-20261028.md` |
| Navigation, modal source, drafts, focus | Ready-before-consume actions; typed Back sources and view memory; bounded asynchronous scroll restore; explicit tab wins; nested Escape respected; detached focus avoided; pairing lifecycle cancellation. | `audit-navigation-state-20261028.md` |
| Management forms | Synchronous mutation guards; close/scope/cancel epochs; late response isolation; failure keeps input; authoritative reopen; first-time onboarding Back closes without marking complete. | `audit-management-forms-20261028.md` |
| Agent setup/status/authorization boundaries | Separate setup/grant/subscription/runtime status; scopes and provider metadata; no nickname-based brand guessing; manual action + request-ID dedup; stale provider-query and secret isolation. | `audit-app-and-connections-20261028.md` and message-state report |
| Shared UI/theme/responsiveness | New management hierarchy, compact platform picker, prior dark/light surface fixes and actual earlier screenshots. Current interaction changes still require final actual viewport checks. | `names-navigation-platforms-20261028.md` |
| Deployment and migration compatibility | No new migration; optional old-schema metadata handling; independent fork config/workflow guards; historical deployment scripts explicitly excluded. | `audit-deployment-compatibility-20261028.md` |

## Baseline failures were investigated, not waived

All 32 previously recorded web failures were classified and repaired without deleting tests or removing business protections. Twenty-five stopped in setup because an old upstream origin was no longer registered; explicit test registration restored execution. Subsequent stale icon, registered URI scheme, disabled upstream updater, component-moved loading text, and visible navigation assertions were updated to actual supported behavior. New regressions demonstrate genuine bugs before their fixes. The final isolated 203-file web run reached **1,721 passed / 0 failed** (09:45 UTC), including the account display parity and actual Hub remount regressions.

Backend full run after the final `/me` addition: **148 files / 1,268 passed, 1 failed** (09:43 UTC). The single failure was the OIDC exact-response contract missing the newly added `preferred_display` field; the expected object was extended without removing any existing assertion, and the entire affected 16-test file then passed (09:44 UTC). Thus all 1,269 backend tests are covered by that full run plus the corrected-file rerun; this is not represented as a second all-green full invocation. The earlier 09:26 full run passed 1,268/1,268 before the additional test. Selected migration/release/config guards: **55 passed**. Web and Worker TypeScript checks and the production web build pass. These are local automated results, not a production or browser acceptance claim.

The old Worker TypeScript `TextDecoderOptions.ignoreBOM` error is also fixed by explicitly specifying the existing default, with BOM/original-signature/fatal-UTF8 parity tests. No cast or type suppression was used.

## Browser gate recovery and remaining limits

- The earlier browser gate was blocked and not bypassed. After the user expressly approved the exact cloud-browser action, normal fixture recovery enabled actual multilevel Back/filter/read-offset and narrow/low-height checks. See `browser-audit-acceptance-20261028.md` for precise scope, measurements and remaining limits.
- Earlier real-App screenshots and nickname demonstrations are useful partial evidence, not a replacement for testing the later patch.
- Muse App logo and several other platform brand assets are unverified: neutral fallback remains. Only verified OpenAI/Anthropic SVG marks are included.
- Cross-client names refresh on visibility/focus and at most every 60 seconds, not realtime server push.
- Real phone keyboard/safe-area/touch, real desktop Keychain, external provider authorization, production schema/state and full deployment rollback are not established by local fixtures.
- Publication still requires final independent review of the accurate screenshots and normal remote-head reconciliation; unit-test counts alone are not acceptance.

Offline bridge regression suites also passed: Muse cloud 31 and personal gateway/codec/runner 79. These use mock/fixture transports and do not demonstrate real account pairing, remote protocol compatibility or delivery.

Final independent code review also closed the account-editor owner/name mix-up and Hub-remount idempotency defect. It independently ran 28 account/App tests and 9 CloudBridges race tests; no remaining code-level blocker was reported in those reviewed increments. Subsequent actual-browser evidence and final visual review are tracked separately in the browser acceptance report.
