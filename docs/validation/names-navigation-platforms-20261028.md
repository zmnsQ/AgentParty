# Nicknames, navigation and channel management — 2026-10-28

## Scope

This patch changes the web UI **and the authenticated channel identities read endpoint**. It does not run a migration, change authorization, deploy a bridge, create credentials or connect a Muse account.

- Current channel agent nicknames are projected from `agent_nicknames` onto identities already visible through the existing channel ACL. Explicit nicknames are authoritative even if they resemble an identifier. Human display prefers an existing readable saved handle; old automatically generated display-derived handles do not have complete provenance, so this is not proof of a manual rename.
- Saving an agent nickname updates this client immediately. Other visible clients re-fetch at most every 60 seconds and on focus/visibility return. This is **not instantaneous cross-client push**. Failed refresh preserves the last verified identity names.
- Channel management groups channel/invitations, members/agents, operating rules and danger actions. Existing capability gates and destructive confirmations remain.
- The Agent platform selector uses compact platform choices and one subsequent step, rather than nine simultaneous instructions. Selecting a platform is not authorization or connection success.
- Back restores a previous application surface; Close exits the surface to the channel. Non-sensitive view state is retained across temporary transitions; credential reveal and incomplete secret forms are cleared.
- Platform marks use server-projected connector metadata, never names or nicknames. OpenAI and Anthropic SVG assets have recorded sources and license. Muse and other unverified brand assets currently use a neutral Agent symbol; this patch does **not** claim all brand logos have been obtained. See `web/public/brand/platforms/README.md`.

## Checks so far

- Web TypeScript and production build pass.
- Isolated web suite at 08:59 UTC: 1,636 pass / 32 fail. Exact failed test names match the recorded pre-patch baseline; no new failures in this run.
- Channel identities API: 34 tests passed, including missing optional connector tables and propagation of non-missing-table errors. Optional metadata depends on existing migrations 0046/0052/0054, not experimental 0055; a missing optional table omits platform metadata rather than failing the identity read.
- Agent manager controlled view-state and secret-clearing tests: 8 pass / 46 assertions.
- Browser real-App fixture showed local nickname mutation flowing through sidebar, participants, old message bylines, focus bar, member list and mention choices; compact picker and management overview were inspected. Fixture requests are synthetic and do not establish production authentication or real-account operation.

## Outstanding validation (do not represent as passed)

At 08:48 UTC the existing cloud fixture tab's DOM operations started timing out. Cloud native screenshots still worked, but switching to the fixture tab was rejected by the action reviewer; one retry after explicit cloud-device evidence was rejected again. No alternative input route was used. Consequently the **latest** full multi-level return/read-position and narrow-window checks remain pending. Earlier screenshots do not validate later code changes. Real mobile keyboard, safe areas and touch have not been tested.

Asynchronous panel-scroll restoration now binds target + selector + offset, waits for mount/content height, and cancels on navigation, Close, user input or a bounded 10-second timeout. Eight helper tests / 24 assertions and 35 navigation/task regression tests pass; this is not browser evidence. The patch is held locally pending this remaining browser verification. No new main commit has been published by this patch.

Preview recovery: own cloud terminal `50331651` runs `sh /workspace/scratch/27cd6ad46c39/ap-preview.sh`, serving this repo on `http://127.0.0.1:4173/test/app-workspace-preview.html?scroll=1`; existing fixture tab is `1326`. HMR is intentionally blocked by the fixture WebSocket adapter: perform a full fixture URL navigation when permitted before testing new code. Do not touch unrelated browser tabs or stop unknown processes. Native cleanup is also held after the device-identification denial; do not bypass it from another task.
