# Personal Muse gateway — offline experiment only

## What is implemented and tested

`flow.py` is an independently written, in-memory workflow model. It accepts only
`FakeTransport`; it has no networking, browser access, Cookie reader, credential
storage, third-party imports, Noise implementation or Agent Commons posting code.
Run its synthetic tests with Python's standard-library unittest. Passing means
workflow guards work, **not** that Muse login, encryption, delivery or refresh work.

Source reviewed (never executed): nikships/muse-cli commit
`dbc7624368fd3aec20258c545f50654dbc92cc5f`, `src/muse_cli/gateway.py`,
`src/muse_cli/cli.py`, `docs/PROTOCOL.md`.

## Proposed group-management wizard

1. **Experimental personal-account bridge** — explain that this is a third-party
   implementation of an internal protocol, not Meta OAuth or a supported login
   integration. No Gadget/BLE requirement for this particular route.
2. **Choose the isolated connector host** — credentials remain under the user's
   control on that host, not in group messages or shared application logs. A
   hosted website cannot simply obtain another origin's login Cookie. A popup
   without a documented callback is not an implemented login flow.
3. **Approve narrowly scoped read-only verification** — separately approve which
   existing Muse account/session may be used and where the credential will be
   accessed. Initially verify account identity and the chosen dedicated side
   chat only. Do not read main chat, feed, goals or unrelated conversations.
4. **Bind the current group to an existing dedicated side chat** — user confirms
   account/group/session together. No implicit main-chat fallback. Creating a
   new Muse side chat would be a separate account change and needs confirmation.
5. **Optional one-message test** — present exact outbound text and destination;
   get explicit approval. Obtain a complete baseline first. If acceptance is
   unknown, inspect history instead of retrying. No periodic test messages.
6. **Preview the candidate reply** — sequence/time proximity alone cannot prove
   causality. Until real protocol request/message correlation is established,
   require user confirmation; never auto-forward unrelated private replies.
   A later group reply also needs exact destination/text approval.
7. **Disconnect** — stop connector and discard local active state. Say explicitly
   that this does not revoke the user's Meta web session. Provider logout/revoke
   is a separate action, not silently performed.

For the user: no Cookie should be pasted into chat, a group form, a GitHub issue
or a prompt. No steps involving browser debug/cookie export have been performed.

## Real protocol findings and unresolved gates

- The upstream uses an existing web Cookie to obtain fresh access and gateway
  tokens for each connection. That is NOT proof of long-lived refresh support.
  Cookie expiry needs user reauthentication; don't repeatedly reuse denied auth.
- The Noise gateway is real, but this experiment has not exercised encryption,
  TLS, account login or private RPCs. A future adapter must use a reviewed
  implementation, verify TLS, redact token-bearing URLs/errors, bound buffers,
  and have exactly one receive dispatcher per connection.
- `chat.subscribe` exists, but upstream documents incomplete side-chat events;
  `send --wait` polls history. No promise of zero-polling complete replies.
- Upstream `cmd_send` continues after baseline failures and associates the first
  later assistant event heuristically. This prototype refuses the former and
  only offers completed, scoped events as unverified candidates for the latter.
- Reconnection must reauthenticate and inspect the same scoped session; never
  resend an unknown submission. The offline model tests this state invariant,
  not a working reconnect scheduler or durable restart recovery.
- Test ledgers are in memory. A real service needs durable atomic dedup and
  crash recovery BEFORE any production write is enabled.

## Exact approvals needed for a live trial (not granted by this experiment)

A. To run third-party code: fixed repository/commit, reviewed files/commands,
   isolated environment, dependencies and network destinations must be disclosed
   at action time. Approval to research does not permit executing its installer.
B. To use login material: specify the user's Muse account, credential owner,
   source, destination process/host, whether retained (prefer ephemeral), and
   read-only selected-session purpose. Broader personal-account access is a risk
   even if our adapter voluntarily limits calls. Do not ask for secrets in chat.
C. To send/create/reply: separately show exact service, session, group, text and
   account changes. Stop on login denial, CAPTCHA, protocol drift or ambiguous
   identity. Do not bypass anti-bot or permission restrictions.

Until these gates are approved and verified, the correct UI status is
“Offline flow tested; live account connection not tested”, not “Connected”.

## Pinned evidence

- Official SDK confirms the domain and its Gadget use, but not third-party web
  OAuth: [AGENTS.md lines 151–157 and 374–379](https://github.com/facebookincubator/muse-gadget-sdk/blob/729d0c8b3113c0cdbd7efb3b8aad8a313839a1bd/linux/AGENTS.md#L151-L157).
- Authentication and Noise connection:
  [gateway.py lines 100–117](https://github.com/nikships/muse-cli/blob/dbc7624368fd3aec20258c545f50654dbc92cc5f/src/muse_cli/gateway.py#L100-L117),
  [lines 172–193](https://github.com/nikships/muse-cli/blob/dbc7624368fd3aec20258c545f50654dbc92cc5f/src/muse_cli/gateway.py#L172-L193).
- Polling and heuristic response association:
  [cli.py lines 519–569](https://github.com/nikships/muse-cli/blob/dbc7624368fd3aec20258c545f50654dbc92cc5f/src/muse_cli/cli.py#L519-L569).
- Main-chat vs side-chat streaming limitation:
  [PROTOCOL.md lines 57–62](https://github.com/nikships/muse-cli/blob/dbc7624368fd3aec20258c545f50654dbc92cc5f/docs/PROTOCOL.md#L57-L62).

## Offline validation

`python3 -m unittest discover -s experiments/muse-personal-gateway -v`
passes 21 synthetic tests (2026-10-27). Includes wrong account, explicit consent,
failed baseline, expired auth, ambiguous delivery, duplicate request, wrong
session, incomplete/background events, large sequence integers, changed status
on the same message, reauthentication with a pending candidate, and payload
limits. Limits are character/record counts for this model, not proof of a bounded
network byte parser. Independent review found and corrected two state bugs before
handoff. The model intentionally stops at a single-message confirmation preview;
no actual posting loop, durable service or production UI is installed.

## Current handoff limitation (tool check)

No available connector was identified that securely hands an arbitrary Muse web
session to this non-OAuth client. The unrelated phone/password-vault login tool
is not such a mechanism. The upstream `auth export` is Chrome cookie extraction
via agent-browser, not QR/device-code OAuth and not a group-webpage callback.
Therefore do not request a blanket “authorize” click from the user as if it would
unblock this environment. The smallest feasible next step is to choose a
user-controlled test machine and decide whether to approve running the pinned
third-party client there. The user can perform official sign-in and local session
import themselves; credentials must not be relayed to this assistant or hosted
server. A dedicated test browser profile reduces unrelated-session exposure.
Even that trial must not bypass login or anti-bot restrictions.
