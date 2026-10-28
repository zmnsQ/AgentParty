# Management forms logic audit · 2026-10-28

Base: local `5f9400ba` (names/navigation/management fix). This audit does not run account changes, desktop pairing, credentials, deployment or browser automation. Browser verification is blocked in the current task and was not retried.

## Call paths and ownership

- Channel management → `ChannelAdminView`: parent supplies ACL capabilities, authoritative member labels, visibility/invitation/safety modules and mutation callbacks. The component preserves only same-channel section/query/type filter in a caller-owned memory ref. Access confirmation is active only while both Access and its disclosure are open. Archive/remove/restore retain parent-side authorization and confirmation.
- My agents → `AgentTokens` → nickname API, profile create/upsert API: the parent retains permission checks and identity refresh. Stable identity names remain routing keys; the form changes only nickname.
- Personal settings → `OnboardingGuide`: Back restores settings Help; Close dismisses. Separate callbacks are tested. No onboarding action connects a platform.
- Desktop settings/pairing/login gate: existing runtime and login boundaries remain. This worker only corrected stale expectations in these tests; production desktop pairing lifecycle changes are owned by the parent task.

## Confirmed bug fixed

`AgentTokens` relied only on React busy state. Two calls in the same render turn could issue two writes. A pending nickname/profile response could also arrive after Close, a changed account/channel or editor cancellation and reset a later draft or surface an error belonging to the old context.

Fix:

- Synchronous per-operation locks for nickname, profile creation and rule upsert.
- In-memory lifecycle generation tied to token/channel/open state, explicit close and editor cancel; cleanup invalidates the generation. Late success/error cannot clear the new draft or invoke the old authentication-failure callback.
- Closed managers invalidate their outstanding data loads and drop cached records. Reopening reads current authority rather than treating a prior request as a fresh success.
- Locks release after the request settles; failures keep input and expose the existing error. No retry or duplicate write is automatically issued. An operation already submitted is **not** claimed to have been cancelled on the server.

Regression evidence includes same-turn double nickname save, Close → reopen → new draft → old response, failure/input retention and retry, and double rules submission. Existing upsert test still verifies preservation of repo/workdir/base-branch/runner fields.

## Baseline failure classification

Four failures in the previous 32-failure web baseline were in this owned area. All four were stale test assumptions, not a reason to weaken runtime checks:

| Test | Old assumption | Revised verification |
| --- | --- | --- |
| DesktopSettings accessible trigger | Old sprite class and prohibition on SVG | Shared settings vector identity, accessible button state/control target and decorative aria-hidden icon |
| DesktopPairingGate entry | Old author's alias must appear on the login screen | Current AgentCommons branding and explicit no-Muse-connection boundary; pairing-only restrictions retained |
| TokenGate locale switch | Retired English/Chinese slogans | Current exact independent-project strings in both locales; provider labels still checked |
| AgentTokens Escape/backdrop | Tab name is a direct text child; project create is reachable without selecting its tab after reset | Recursive visible button text, real Projects navigation, draft clearing, Escape listener cleanup and backdrop dismissal |

The remaining baseline failures are outside this worker's ownership; this report does not classify them as harmless or passed.

## Executed checks

All tests run serially with the existing Bun installation, no dependency install:

- AgentTokens.rules: 23 pass / 65 assertions.
- AgentTokens.guide: 8 pass.
- AgentTokens.copypack: 7 pass.
- AgentTokens.harness: 7 pass.
- ChannelAdminView: 24 pass (same-channel remount/filter restoration, cross-channel isolation, permissions/archived state, disclosure confirmation activation).
- OnboardingGuide: 12 pass. First-visit Back now also clears internal visibility without marking onboarding completed, preventing the help overlay from surviving the parent’s return navigation.
- VisibilityToggle: 4 pass (confirmation cancellation and late-response isolation).
- DesktopSettings: 15 pass; DesktopPairingGate: 5 pass at this worker's check; TokenGate: 2 pass. Parent may add further pairing tests afterward.
- Web TypeScript: pass after these edits.

## Explicit unverified boundaries

No actual mobile keyboard/safe-area, current screenshot layout, operating-system desktop autostart, real pairing success/error, network cancellation or production authorization test was executed by this worker. No claim of full application regression or production readiness follows from these focused tests. Full suite, integration review and release remain the parent task's responsibility.

## Account-label follow-up (09:34 UTC)

- Added optional `MeInfo.preferred_display` and `SettingsMe.preferred_display`; `web/src/lib/meDisplay.ts::preferredMeDisplay` consumes the server-resolved label without inferring manual provenance from handle spelling.
- Settings account panel now uses this resolver. Older human responses retain display-name/handle/name fallback. Older agent responses fall back to identity name because historical `/me` can populate both handle and display name from owner metadata; neither is safe evidence of the agent's own nickname.
- App integration and server policy are owned by the parent/identity worker. Saving a human handle must refresh/update `preferred_display` as well as `handle`, otherwise the previous authoritative label remains visible.
- Validation: `bun test web/src/lib/meDisplay.test.ts web/src/components/SettingsPanel.test.tsx`: **21 pass, 0 fail, 58 assertions**. `bun run --cwd web typecheck`: passed. Includes actual SettingsPanel label assertions for distinct chosen nickname/SSO label, agent nickname/owner metadata and old-server fallback. No browser/production-account verification performed.
