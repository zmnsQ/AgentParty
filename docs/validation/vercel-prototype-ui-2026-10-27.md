# User-provided Vercel prototype → Agent Commons

Input: `vxbtUuG2dmU.zip`, SHA256
`4a3b1dddfadc50535a14d4cfe4be1445a4360922cd149452584798ac9f4bb0f0`.
The user supplied this prototype and requested adaptation. The archive contains
no LICENSE file; existing project authorship/BUSL notices remain unchanged.
No archive scripts were run. No Next.js, analytics, external font, generated demo
identity, fake delivery, or backend was imported into production.

## Implementation mapping

- Prototype icon rail → desktop workspace/home, tools, account and settings entry.
- Prototype sidebar → real searchable ChannelList with existing ownership,
  archive, presence, retry and routing behavior.
- Prototype conversation → existing MessageCard, real identity/content/receipts,
  charcoal agent bubbles, warm brown own messages and name avatars.
- Prototype capsule → existing Composer with IME, mentions, attachments, upload,
  error handling, draft and authorization behavior retained; tools disclosed.
- Existing group tools/members/connection guides remain real secondary surfaces.
- New default charcoal theme; explicitly saved light theme remains respected.
- Phones remove the permanent rail, use existing drawer and safe-area viewport;
  16px text inputs and 44px controls avoid reproducing the prototype's tiny inputs.

No API permissions, real agent membership, credentials, deployment, or transport
behavior changed. Personal Muse experimental work stays in the parent commits.

## Preview (explicit synthetic fixture, never a production route)

From `web`, run the existing `dev` command with `--host 127.0.0.1 --port 4178`,
then open `http://127.0.0.1:4178/test/prototype-preview.html` on the same host.
This fixture reuses real React components and styles, visibly says TEST FIXTURE,
blocks business network requests, and never submits a message. It is not included
in the standard production build. Use desktop, 390×844 portrait, 844×390
landscape, focused input, expanded tools and both themes for manual acceptance.

A separately compiled static fixture was produced at
`/tmp/agentparty-prototype-preview` during verification. A standard server bound
to `0.0.0.0:4180` returned HTTP 200 in the execution environment. The assistant
cloud browser's localhost is a different network namespace and returned
ERR_CONNECTION_REFUSED. No screenshot, actual keyboard or visual pixel-level
acceptance is claimed; no security bypass or user device was used.

## Verification

See the sibling JSON report for exact test results. Existing baseline failures
are compared by test name, not dismissed merely by equal counts. Independent
review identified and fixed legacy sidebar minimum-width clipping, native
`details` content clipping, light-theme contrast and mobile secondary entries.
