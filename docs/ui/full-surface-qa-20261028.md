# Full-surface UI correction — 2026-10-28

## Changes
- Application fills the viewport. Removed the presentation frame and separate left rail; account/tools live in the conversation sidebar and mobile drawer.
- Default, missing-theme fallback and explicit dark theme now share the same root palette; explicit light choice remains supported. Portaled dialogs use root tokens instead of inheriting workspace-only colors. No account/security preferences are reset.
- Unified cloud connections as platform → instructions → configuration, with existing configurations and grants together. No credential is created merely by opening a guide.
- Fixed the header invitation control: controlled activation now opens the picker while retaining existing guide/recovery state. Fixed embedded human-invitation forms accidentally becoming fixed-position popovers.
- Status renders preserve reading position. Bottom followers stay pinned across content/receipt changes; readers above bottom retain a visible message anchor. Both viewport and inner content geometry are observed; stable team-thread identities survive prepends.
- Independent server-rendered OAuth consent stylesheet refreshed, without changing authorization semantics. Its stylesheet version is advanced.
- Clarified Agent Commons as zmnsQ's independently maintained derivative; retained upstream attribution and licensing.

## Verification performed
- TypeScript and production web build pass.
- Serial web suite: 195 files, 1592 passed, 32 failed. Failure names exactly equal the pre-existing baseline (no new failures). This is not an all-green suite.
- AgentJoin: 54 tests/210 assertions; scrolling helper/observer regression: 19 tests/52 assertions. Consent stylesheet: 5 tests/47 assertions including text/focus contrast and existing server HTML authorization controls.
- Actual production App/Channel and **main.tsx bootstrap** rendered using test-only isolated API/WebSocket fixtures. Unlike the previous preview, it no longer seeds the DOM theme or bypasses startup. Fixtures explicitly deny external fetches and mutations and are not production content.
- Actual browser checked main workspace, group details, account/preferences, platform selection, Hermes configuration/cancel, shared files, repositories, task creation/cancel, team/member details/back, management access/member/security sections, invitation picker close/reopen, announcement/search/My Agents empty states and attachment menu, both dark and explicit light theme. Management error state and normal empty state checked separately.
- Native browser window resized to 500×757 and 847×393 content viewports: no extra rail/frame, no horizontal document overflow; sidebar/account remained reachable. This is responsive desktop-window testing, **not** an actual iPhone keyboard/safe-area/touch test.
- Dynamic browser: while reading above bottom, first visible msg-195 top remained -8.875 px and scrollTop 6606 across status, new-message and streaming updates. Bottom gap remained 0 after status and new-message updates. Unit coverage additionally covers prepend identity/observer cleanup; all historical pagination combinations were not manually exercised.

## Evidence and remaining limits
Local screenshots are in `deliverables/ui-qa-v2/` in the engineering workspace. Use files suffixed `-final.jpg` where available: early same-call captures could precede paint and are not valid evidence for their filenames. The screenshot TEST FIXTURE label distinguishes simulated data from real account activity.

The inventory `secondary-surfaces-matrix-20261028.md` is a code coverage inventory, not a claim that every conditional feature was manually exercised. Browser-security/MFA, desktop-only controls, external provider pages, real OAuth consent transactions, real credentials and production account writes were deliberately not exercised. Shared CSS and automated contracts cover those local surfaces where applicable; provider-owned pages cannot be restyled here.

Muse experimental bridge remains disabled and unpaired. No production deployment, credential import, real message or destructive account operation was performed. This patch adds no schema migration. Existing migration 0055 is not automatically authorized by this UI release.
