# Supported cloud-browser acceptance — 2026-10-28

User expressly approved switching the assistant's own cloud Chromium to this
project's isolated test page and resizing the window. No real account,
authorization, external message, or production data was used.

## Source and recovery

Production source: local `49bbab840e44716ce203d38288b9049e0d21431a`, plus
**test-only** fixture enrichment: a typed, assigned TEST FIXTURE task, explicit
mock connector metadata, and an option to hide the QA action bar. The entry
imports real `main.tsx`/App, routes and components; API data is simulated.

The old fixture renderer showed Chromium error 9. A normal restart of our own
Vite and replacement of that broken fixture tab restored rendering and DOM
inspection. No browser-wide restart, policy change, or access-control workaround
was used. Successful tab: 1337, local port 4173.

## Executed user journeys

- Desktop chat and actual authorized roster render in the unified theme.
- Save the deliberately opaque-looking valid agent nickname `oidc-测试` through
  Agent Management: sidebar, historical message bylines and @ candidates all
  show it; identity/routing remains `fixture-muse`.
- Group details → management → Agent filter + `Muse` search → member detail →
  assigned task → Back to management restores that member → member Back restores
  the Agent filter and search → group-details Back → Close returns to chat.
- Chat reading anchor remained `msg-189`. Initial native-scroll sample was
  -25.4375px; settled sample before and after the subsequent updates was
  **-24.4375px**, scrollTop 5659. Presence and new-message refresh retained it.
  The initial 1px settling difference is recorded, not claimed as exact zero.
- At the bottom, status refresh + streaming growth + append retained **0px bottom
  gap**, ending at `msg-204`; no forced jump while reading above.
- Platform picker → Muse connection steps → Back to platform picker → Close to
  chat, with the actual MCP/Gadget/experimental boundaries visible. Choosing
  these navigation controls creates no credentials or subscriptions.
- Ordinary Chromium window resizing: 1179×757 desktop, 500×673 narrow, and
  1006×343 low-height. Document width matched viewport; management members and
  detail were reachable by normal scrolling, with Back/Close visible. This is
  **not** real-phone keyboard/safe-area/touch testing or device emulation.
- Trusted mock ChatGPT metadata renders the OpenAI mark in roster/participants.
  Muse remains a neutral icon because its official App artwork is unverified.

## Evidence

Screenshots are stored outside production in
`deliverables/ui-audit-final/` in this task workspace. Final narrow screenshots
`chat-narrow-500.png`, `picker-narrow-500.png`, `picker-narrow-bottom.png`,
`muse-paths-narrow.png` have the test action bar disabled (small TEST FIXTURE
watermark retained). Do not use earlier occluded screenshots as evidence of
controls beneath that bar. Other evidence includes `admin-return-filter.png`,
`member-task-detail.png`, `admin-narrow-500.png`, `admin-low-height.png`,
`member-low-height.png`, `chat-low-height.png`, `nickname-mentions.png`.

## Remaining limitations

No production authentication, real mobile device, desktop Keychain, external
provider protocol, or exhaustive permission/account combination is claimed.
Cross-client nickname updates use focus/visibility and 60-second refresh, not
instant push. Unknown delivery guards remain in-memory rather than durable
cross-reload exactly-once guarantees. These bounds remain in the module audit.

Final narrow management Close check: visible `display:flex`, opacity 1,
rect x425.984/y14/54.016×44 at viewport500×673. Actual click on the header
Close (not the backdrop) returned dialog count to zero. The narrow screenshot
was recaptured after layout settled to avoid an earlier transition-time capture.
