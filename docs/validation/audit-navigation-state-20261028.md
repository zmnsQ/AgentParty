# Navigation / state audit — 2026-10-28

Scope: Channel navigation functions, TaskLedger, CollaborationHub, SectionedDialog.
No production access, real credentials, new external messages, deployment, or browser-validation claim.

## Evidence and fixes

1. **Sidebar action lost during loading.** Channel marked a workspace action ID consumed before checking whether account permissions or the requested member were available. `openTeamMember` could return without opening anything, with that request never retried. The ID now advances only after `workspaceActionReady` permits execution; authoritative member changes retrigger the effect. This does not grant a permission or fabricate a member.
2. **Repeated exact task entry stopped working.** TaskLedger closed its local detail but left the parent's `selectedTaskId` intact. Selecting the same task again did not change the effect dependency, and its temporary filter bypass remained active. Closing detail now clears the external request through an optional callback; a subsequent same-ID entry works.
3. **Nested Escape handling / detached focus.** SectionedDialog's window handler ignored `defaultPrevented`, so a child-handled Escape could also close its enclosing dialog. It now respects handled events and composition; unmount does not focus a detached original trigger.
4. **Remembered tab overrode an explicit destination.** CollaborationHub prioritized saved `viewMemory.tab` over `initialTab`. Explicit entry now wins; memory applies only when no specific entry was requested. A stale configure view never recreates secret inputs from memory.
5. **Pending scroll could survive same-panel navigation.** A delayed restoration from a previous collaboration view could survive an explicit files entry because only the panel key was compared. Every explicit navigation now cancels that pending restoration. The controlled AgentJoin `onActive(true)` echo is distinguished from navigation and does not cancel its own delayed mount restoration.

## Existing boundaries reviewed

- Channel is keyed by server origin and group in App; unmount clears local drafts, panel stack, task memory, and active scroll observers. Parent audit confirmed browser-account change, explicit sign-out, pasted login, server switch and share fallback clear `channels`, unmounting Channel. Same-identity refresh intentionally preserves drafts. No concrete cross-account survival path has been established; the absence of account ID in the key alone is not a defect. Desktop restore with a different identity remains unverified, not asserted broken. Do not equate normal token refresh with a new account.
- CollaborationHub scopes its private subtree by token, group, client and server. Changed scope unmounts forms and aborts/ignores old reads. `viewMemory` contains only tab, platform and setup/manage navigation; credential fields, prompts and submitted-operation state are not serialized there.
- AgentTokens tests confirm temporary departure keeps tab/search, clears unsaved form and reveal state, while actual Close resets tab/search. Reopening a saved credential remasks it rather than retaining a revealed input.
- Scroll restoration is one target-bound, bounded operation: waits for mount and sufficient content, aborts on target change, explicit navigation, Close, user input, unmount or 10-second timeout. Mutation/resize observers and input listeners are disposed. No document/window scroll and no perpetual RAF polling.
- Back pops a bounded in-memory source stack; Close clears the stack and returns to chat. Browser Back remains route-level; this work does not claim URL/history integration for each modal.
- Chat reading DOM stays mounted while navigation panels replace each other. Task filters/query/selected detail are in-memory UI state, not credentials. Unsubmitted sensitive collaboration form contents intentionally do not survive switching panels.

## Validation

- `bun test web/src/lib/workspaceActionReadiness.test.ts web/src/components/SectionedDialog.test.tsx web/src/pages/TaskLedgerPanel.test.tsx`: 36 passed, 149 assertions.
- `bun test web/src/components/CollaborationHub.test.tsx`: 38 passed, 175 assertions.
- Existing delayed scroll helper tests cover late mount, insufficient height then resize, wrong target, Close/user cancellation, timeout and observer cleanup.
- `web/node_modules/.bin/tsc --noEmit`: passed.

These are local renderer / mocked observer tests, not a successful live-browser or production acceptance run. No tests were deleted to hide failures.
