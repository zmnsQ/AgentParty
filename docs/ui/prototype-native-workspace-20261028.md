# Prototype-native workspace repair (2026-10-28)

## Evidence / reason for repair
The publicly served `/api/version` identified `e22a4a0c889e94ebe7fadcd0986237cb03b797f4`.
The served `index-0Ht5hY4E.css` SHA256 was `7a621aae92be466a3e51ec9a96ade62daf181cfa5c5c9858132697113b954197`, identical to the prior local build.
This was not evidence of a deployment/cache problem. The previous implementation retained Home/dashboard, stacked group bars, and failed to supply real agents to ChannelList. The old manually assembled preview hid this integration gap.

## Source and production mapping
Reference: user-supplied Vercel ZIP `vxbtUuG2dmU.zip`, SHA256 `4a3b1dddfadc50535a14d4cfe4be1445a4360922cd149452584798ac9f4bb0f0`.
`components/muse-workspace.tsx`, `components/muse-conversation.tsx`, `app/globals.css` are the visual source, not a new design brief.

| Prototype | Production implementation / real behavior |
|---|---|
| desktop/workspace, 22px inset, 15px corners | App + prototype-native-frame.css; 38/54px inset at >=1450px |
| 62px icon rail / 225px sidebar | App real route/search/files/charter/team actions; 74/240px large layout |
| 49px mobile rail + sliding sidebar | ResponsiveSidebar real groups; safe-area and short-height scroll additions |
| sidebar-top, search, group-list, agent-list | ChannelList; actual authorized groups, authoritative identities and assigned responsibilities; existing category/archive filters retained in disclosure |
| single chat-header, 73px, 12px regular title | ConversationHeader; real member stack, actual AddAgent invitation action, title opens details |
| transcript / conversation-inner, 690px | Channel actual history and scroll anchor; 720px on large screens |
| user/agent turns and muted bubbles | MessageCard retains markdown, attachments, receipts, permissions, editing, quoting and actions; prototype 12px body and warm own bubble |
| composer-wrap / capsule / caption | Composer real send and attachment/mention handlers; 53px capsule, 33px arrow button, secondary real tools in disclosure |
| prototype modal actions | Existing group tools, Agent connection, admin, files and account surfaces remain functional; group tools move into details instead of permanently occupying transcript space |

No demo conversations, agents, roles, connection status, AI results or uploads become production data. No nonfunctional audio/AI-mode button is introduced merely to copy a shape. Font stack uses Arial/Noto Sans SC/system fallback, without new remote font requests. App brand remains Agent Commons.

## Deliberate compatibility and safety
- Touch input stays 16px to prevent iOS focus zoom; touch targets have enlarged hit areas. These are explicit deviations from prototype's tiny 10/11px mobile inputs.
- Connection errors and real mention count remain visible; no fake “online”.
- One-time `prototype-native-v1` presentation migration starts the new UI in prototype dark. Prior valid theme is backed up in `ap_theme_before_prototype_native_v1`; future explicit light selection persists. No authentication or account settings change.
- Root selects first already-authorized active group, not an invented channel. Channel-list refresh lifecycle now keys on pairing state rather than arbitrary route so navigation cannot cancel an in-flight renewal.
- Agent roster and rail commands are scoped to instance and group. Navigation clears commands; agent clicks route to authoritative member details. Connect action rechecks existing permissions.
- Muse experimental feature flags and all server/database behavior remain unchanged.

## Actual App preview (not a substitute UI)
Run in an environment with the project's normal dependencies:
```
bun run --cwd web dev --host 127.0.0.1 --port 4173
```
Open `http://127.0.0.1:4173/test/app-workspace-preview.html`.
The page imports **real App**, installs isolated in-memory synthetic API/auth/storage/WS before import, and cannot submit writes or connect externally. Production build does not include this test entry.
Use `?theme=doodle` for the explicit light variant. The default is reference dark. Fixture root redirects through actual App to actual Channel; identities reach the sidebar via actual callback.
Optional standard Playwright script `web/test/app-workspace.browser.mjs` targets localhost only, with no sandbox-disabling flags. Run only in a supported testing environment with Playwright already available.

## Validation and remaining limits (2026-10-28 06:13 UTC)
TypeScript and production build passed. Isolated web tests: **1576 passed / 32 failed** across 194 files. All 32 failure names match the prior baseline exactly; this is not a green-suite claim. Focused composer/header tests: 8 passed / 46 assertions.

The previous preview-network blocker was resolved without changing network/security: the normal visible cloud host terminal could read this same repository and run its installed Vite via Node on `127.0.0.1:4173`. The browser opened the **real App** test entry, with isolated synthetic backend/auth data. This is neither the old production page nor the earlier hand-assembled component fixture.

Observed real rendering and interactions:
- Desktop 1180×757: prototype frame/rail/sidebar/header/transcript, full dark palette; computed composer 53px after correcting textarea rows and inherited button min-height.
- Ordinary browser-window resize to 500×757: retained 49px rail, drawer group switch, mentions and attachment menu, no document horizontal overflow; composer 51px.
- Ordinary resize to 846×393: scrollable transcript ~165px high, composer 53px within viewport, sidebar collapse/expand operational, no horizontal overflow.
- Member sidebar opens authoritative Agent detail; closing it and changing group does not replay the previous action. Draft @ suggestions use actual fixture identities. No test messages were sent.
- Explicit light-theme fixture rendered; first-use prototype dark remains independent of preserved legacy preference.
- Independent screenshot review caught legacy bright suggestion selection and excessive message metadata. Suggestions now use muted legible colors. Type is available in identity details; byline is compact; delivery/read detail remains expandable below the bubble, with failure/held states retained. The invitation button explicitly says “Invite Agent”, matching its action; existing human invitations remain in group details.

Screenshots saved outside production source/build in `deliverables/ui-qa/` under the engineering scratch workspace: `desktop-final.jpg`, `narrow-final.jpg`, `narrow-mention-final.jpg`, `narrow-drawer.jpg`, `landscape-final.jpg`, `agent-detail.jpg`, `light-final.jpg`. Earlier non-final screenshots are diagnostic, not final acceptance evidence.

**Limits:** Browser DevTools device emulation was denied by organization policy and was not retried or bypassed. Narrow/landscape evidence is normal window resizing, not physical iOS/Android or software-keyboard testing. The 390px phone width, touch keyboard, and exact original-prototype side-by-side pixel comparison were not verified. This validates the real frontend with mocked APIs, not authenticated production integration or Muse connectivity. No production deployment was performed. Public health/version at 06:12 UTC remained healthy e22a4a0c889e94ebe7fadcd0986237cb03b797f4.
