# AgentCommons / CCCC shared identity

The checked-in assets are derived from the CCCC mobile brand master reviewed on 2026-10-23:

- `mark.png`: the four linked C mark, resized to 256 px from `cccc-app-icon-v2.png`.
- `workspace.png`: the same onboarding still life as the native welcome screen, resized to 960 px.

These files are owned by this repository. There are no runtime references to the mobile checkout. `Brand.tsx`, the favicon, Apple touch icon and server-rendered OAuth pages use `mark.png`. The compatibility `favicon.svg` embeds exactly those PNG bytes.

Use the existing artwork when exporting other sizes; do not draw an approximate second logo. Keep AgentCommons as the product name. The inherited AgentParty license and author notices remain in place.
