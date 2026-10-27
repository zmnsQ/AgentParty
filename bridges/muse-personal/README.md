# Experimental personal Muse bridge — engineering adapter, not an enabled service

This is **not official Muse OAuth**. It does not replace the MCP or Gadget paths.
Default configuration is disabled. No real credentials were created, imported,
read or tested while implementing this directory. No third-party program was run.

## Implemented pieces

- `gateway.py`: a fixed-origin HTTPS bootstrap client with normal TLS verification,
  no redirects/proxies/fingerprint impersonation, injected in-memory login source,
  safe error codes and exact approved-account/dedicated-session checks. The real `noise_channel.py` uses fixed-origin WSS and Noise XX; `codec.py`
  independently encodes/decodes the reviewed bounded protobuf envelope. Factories
  remain injectable for offline tests. Missing configured account resolver or
  channel factory fails **before** reading login material. `identity.py` verifies
  an explicitly approved account field from `/identity` before history/send.
- `runner.py`: one group/account/sidechat per SQLite ledger. Binding initialization
  is transactional. Every operation requires an injected current-binding guard;
  removal or inability to verify that binding disables operations. Only explicitly
  approved human tasks are accepted; agent-origin chaining is denied. Reservations
  are durable before send, so crash/unknown outcome does not cause a resend.
- Side-chat replies are read using bounded history polling (minimum five seconds,
  default ten, fifteen-minute observation limit), **not claimed to be fully pushed**.
  Incomplete history stops processing. Sequence integers remain integers, stored
  as decimal strings in SQLite. Candidates are not causal proof: manual approval
  is required before any group reply. Plain message text is not persisted.
- One operation can claim one group result, using a stable canonical idempotency
  key. A posting callback must verify the group and key in the receipt. Unknown
  posting remains blocked; it must not be retried as a new post. No automatic
  group-message client is installed in this package.
- `health.py`: bounded HMAC report payload builder. No network or secret lookup.
- `check_config.py`: offline config check, rejects secret fields and reports both
  `noise_adapter_ready:false` and `account_tested:false`.

## Group management API/UI

Migration `worker/migrations/0055_muse_personal_bridge.sql` is **not applied** to
any real database. `MUSE_PERSONAL_BRIDGE_ENABLED` must equal `true` to enable
mutations. With it absent, the UI reports disabled and cannot save a binding.

- Group-owner GET returns minimal status, not a login secret or raw session ID.
- Owner + existing MFA PUT explicitly saves labels and an existing dedicated
  sidechat ID. Labels are not verified account identity. It does not create a Muse
  conversation, authenticate Muse or send anything. A new binding ID invalidates
  old health reports. Same owner/session cannot silently span multiple groups.
- Owner + MFA DELETE removes local binding only, not the Muse login session.
- Reports require **both** a preconfigured named, group-scoped Agent credential
  belonging to the current group owner and a per-group HMAC key. No anonymous
  endpoint, auto-created credential or arbitrary callback URL is introduced.
  Configure keys only later via the deployment secret mechanism, never source,
  screenshots, group messages or this example file.
- Signed report binds group, timestamp, nonce, binding ID and exact JSON. Timestamp
  window is 60 seconds; replay records expire after 120 seconds. SQL update and
  nonce insertion are atomic. Heartbeats older than 120 seconds show reconnect
  required. `evidence` remains `bridge_reported`, `end_to_end_verified` is false.
- The UI offers this experimental option independently of MCP and Gadget. It
  displays states without raw error payloads, Cookies or token fields.

## Not yet implemented / not yet demonstrated

**This cannot connect a real Muse account out of the box.** Noise/protobuf wire code is implemented and mock-tested, but not exercised with
a real server or real cryptographic peer. The optional pinned Noise dependency
was not installed in this implementation session. The public source establishes
`GET /identity` but not its trustworthy account field: a reviewed JSON pointer
and exact account ID must be supplied; no VM ID or label is accepted as identity.
The public source also establishes no reliable send ACK schema. The real channel
therefore writes once and reports `UnknownDelivery`, not an accepted/pending
success. The runner does not automatically advance such an operation or resend.
This is an explicit remaining protocol-verification gate, not a working
automatic round trip.
There is no secure browser-session import UI, background service/daemon, automatic
current-binding network guard, group posting adapter, or provider OAuth refresh
implementation in this delivery. Those must be reviewed and wired before live
work is enabled. The present HTTP/auth contract uses mocks, not verified personal
account responses. A login-cookie expiry still requires user reauthentication.

The upstream `nikships/muse-cli` commit
`dbc7624368fd3aec20258c545f50654dbc92cc5f` was read as protocol evidence only. It
uses internal/unversioned APIs; its live session and first-new-reply heuristics
are not imported as reliable account or causal verification. Wire execution optionally requires the pinned packages in `requirements-wire.txt`
(Noise protocol MIT; websockets BSD-3-Clause). No upstream program is imported or
executed. Descriptor-derived schema attribution is in `THIRD_PARTY_NOTICES.md`.
No attempt is made to defeat login challenges, anti-bot checks or access controls.

## Later live-test checklist (requires separate approval)

1. Pick a user-controlled isolated host, review and approve the wire implementation/dependencies and deployment changes. Do not use production root
   as a personal-account execution host. Apply migration only in an approved test
   environment with backup/rollback; do not run remote migrations from this note.
2. Implement a safe local session handoff. The user signs into official Muse; do
   not request Cookie text in chat or the group webpage. Account material stays
   on that host. Group infrastructure only receives scoped bridge credentials.
3. Verify exact account identity and one already-existing dedicated side chat
   read-only. Bind it explicitly to the intended group. Creating a side chat or
   changing credentials is a separate user-approved action.
4. Wire a current-binding guard and bounded health reporting. Validate disabled,
   stale, revoked, wrong-owner and replay behavior before any message test.
5. With exact text/destination approved, submit a single test. Verify actual ACK
   and history shape; ambiguous sends must be inspected rather than resent.
6. Preview one completed candidate; verify causal association. Only then approve
   a group reply with a read-back receipt. Do not enable automatic reply loops.
7. Test disconnect and restart; local disconnect must never claim Meta logout.

## Safe local checks

```sh
python3 bridges/muse-personal/check_config.py bridges/muse-personal/config.example.json
python3 -m unittest discover -s bridges/muse-personal -v
bun test tests/muse-personal-worker.test.ts
```

All tests use synthetic values, in-memory/fresh temporary SQLite and injected
transports. They do not access browsers, credentials, private RPCs or accounts.

## Wire assembly contract (for a later approved local host)

Construct `ConfiguredIdentityResolver(expected_account, approved_json_pointer=...)`
only after an approved read-only identity response establishes the field. Inject
`noise_factory=lambda bootstrap: NoiseChannel(bootstrap, session_id=approved_session,
node_id=approved_node, codec=codec)` into `Gateway`. `codec` is this directory's
module. No node/session/account identifier is generated or discovered by this
assembly. Login material must come from a future approved local secret provider;
there is intentionally no Cookie-import command or browser-credential reader.

Protocol checks reject multi-chunk transport envelopes rather than silently
truncating them, bound response bodies/frames/time, serialize one consumer, and
close on ambiguity. Ordinary TLS/access-control failure is terminal; there is no
proxy, fingerprint impersonation, redirect following or retry around it.
Sidechat delivery remains history polling, not full event push. A real ACK and
causal-response schema must be reviewed before enabling automatic completion.
