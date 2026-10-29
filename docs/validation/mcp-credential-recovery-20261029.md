# MCP credential creation and explicit agent restoration

Reviewed against remote main `1003c0bf2277a9efc6b449926196e25dcc87b9a0` (tree `aaad0cf7ad9d52994923861139d8383ec78047df`). The cloud handoff patch was verified before applying (SHA256 `bfb7c2c8c24901bc4be863770420f11e6e57498b4289a6f966b205c906875e6d`).

## Behavior verified

- A known name conflict does not leave manual MCP naming/create controls disabled. Invalid edits remain editable; deliberate renamed retries are supported.
- Manual, local connector and legacy issuance use a 30-second deadline. Uncertain network outcomes are identified and block blind repeat issuance. Synchronous locks prevent duplicate clicks. Late creation responses cannot save or reveal credentials after leaving their identity/service scope or unmounting. Verified same-account auth renewal preserves manual one-time reveal.
- Credential creation and rotation reject name/account removals and account bans, with SQL guards against a removal racing the write. Creating credentials does not restore membership.
- The owned-agent list reports removed state and exposes no plaintext credentials or hashes. Removed revoked ordinary identities remain available for explicit restoration review. OAuth credential management remains separate.
- `POST /api/channels/:slug/agents/:name/restore` requires an existing human moderator and current removal epoch. It validates the ordinary non-child, non-OAuth token identity and group. It removes only the matching name tombstone; account removals and bans still block it. It adds no human membership and does not mint, rotate or revive credentials.
- Fixture integration proves removed MCP initialize returns `participant_removed` 403, strict restore allows the same live fixture to initialize/list tools/call `commons_profile`, and an old revoked fixture remains 401 after restoration and after explicit remint.

## Validation

- All 206 isolated Web test files passed (1762 tests at the full-suite checkpoint); two subsequent legacy issuance regressions also passed (58 AgentJoin tests). Updated local connector suite: 19 tests. Manual and restoration UI suite: 24 tests. Web and Worker TypeScript passed.
- Credential/removal route tests: 41 tests passed. Related MCP/OAuth/ACL suite: 165 tests, with an OAuth public-field whitelist assertion updated to include the new nonsecret access fields; the affected OAuth file passed all 33 tests. No secret-field whitelist was relaxed.
- Real browser, synthetic data: platform selection → generic remote MCP → manual → known 409 → edited name → successful fixture creation → complete JSON copy (parsed) → back clears reveal. At 390px, body scroll width equalled viewport width (390). Native confirmation-dialog automation stalled, so browser acceptance of confirm/cancel is not claimed; isolated component tests cover cancel, duplicate clicks, failure, role gating and stale-group results.
- Full Worker suite and the production build are recorded separately by the release executor when complete.

## Limits and production boundary

No real tokens, user MFA, third-party personal OAuth account, Muse/Today session or real-phone end-to-end flow was exercised. No group messages were sent. No claim is made that all defects or Today's upstream error are resolved. The independently observed HTTP challenge metadata discrepancy remains a runtime diagnostic item, not the cause of the confirmed no-Origin `participant_removed` response.

No schema migration is required. Deployment must not run Muse experimental migration 0055, enable Muse bridges, modify MCP/Origin policy, or restart event/tunnel services. Production restoration needs separate confirmation for the exact removed identity. Never substitute the broader account-level `PUT members/:account` API.
