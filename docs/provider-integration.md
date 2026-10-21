# Personal agent provider integration

Research and contract baseline: **2026-10-21**. Implementation:
`worker/src/collaboration/transport.ts`.

The provider adapters connect an existing agent runtime. A model API is not a
replacement for a personal agent's identity, tools, memories or conversation.
Protocol tests do not establish access to an actual user account.

## Implemented contract

The module exports `verify`, `discover`, `start`, `poll`, and `cancel` (also
available as `verifyProvider`, `discoverProviderAgents`, `startProviderRun`,
`pollProviderRun`, and `cancelProviderRun`). Each accepts a `ProviderConfig` and
optional `ProviderOptions`. `start` also accepts `{ prompt, requestId, sessionId }`;
`poll` and `cancel` accept the persisted `ProviderRunReference`.

| Operation | Hermes | Manus / Cue |
| --- | --- | --- |
| Verify | Authenticated native capabilities | `agent.detail`, canonical agent and main task |
| Discover | Configured Hermes profile | `agent.list`, including Cue agents |
| Start | Native runs API | `task.sendMessage` to the existing main task |
| Poll | Exact run status; only completed output is returned | Local delivery receipt only; no private responses are read |
| Cancel | Requests stop; polls until cancellation is confirmed | Disabled: stopping the whole main task can stop unrelated personal work |
| Delivery | `correlated` | `delivery_only` |

`ProviderRunUpdate` contains a normalized state, remote identity, optional session
and cursor, optional final `text`, and an optional fixed local `note`.

Discovery is an adapter-level interface. This preview's REST/UI connection
flow requires a supplied Agent ID and verifies it; an interactive discovery
picker is not wired into the client yet.

The backend owns durable request claims, connection and channel authorization,
per-connection concurrency, encrypted credential storage, and posting a result
through the existing channel message pipeline. Persist the claim **before**
calling `start`. Supply a globally unique server-generated request ID, rather
than using a user-controlled identifier shared across connections.

Persist the returned reference before acknowledging a successful submission.
If a `ProviderError` has `outcomeUnknown: true`, the remote write may already have
executed. Keep the local run in `unknown`, retain its claim, and do not issue
another creation with a new ID. The adapters never retry a write automatically.
An HTTP 404 during status recovery does not establish that a run never executed.

## Hermes

Official reference:
[Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server).

Verification uses `GET /v1/capabilities` and requires the Hermes platform,
authenticated bearer access, and native submission/status features. Discovery
returns the configured profile, not a provider model list.

Run submission uses `POST /v1/runs` with `input`, a room-scoped `session_id`, and
an `Idempotency-Key`. `X-Hermes-Session-Key` carries that same stable scope.
`GET /v1/runs/{run_id}` retrieves its status. Only a `completed` response with
the matching run/session identity and a string `output` can become a room reply.
The adapter does not forward reasoning, tool payloads, diagnostics, or partial
output. Known credential strings are redacted from final output.

`POST /v1/runs/{run_id}/stop` initially returns `stopping`, which remains a
running state in Commons. The UI must sync again to obtain `cancelled`.
Approval/clarification waits become `needs_input`; resolve them in Hermes and
sync again. Interrupted runs become `failed`; an unknown execution remains
`unknown` and needs resolution in Hermes.

Use a server-generated session per group connection. Existing CLI, Desktop,
ACP and messaging sessions cannot be attached through these APIs. Supporting
those existing conversations would require the separate Gateway WebSocket
protocol. A dedicated API session does not erase personal memories the agent's
profile already has; share only work appropriate for that group.

## Manus / Cue: intentionally delivery only

Official references:

- [Agents overview](https://open.manus.ai/docs/v2/agents-overview)
- [agent.list](https://open.manus.ai/docs/v2/agent.list)
- [agent.detail](https://open.manus.ai/docs/v2/agent.detail)
- [task.sendMessage](https://open.manus.ai/docs/v2/task.sendMessage)
- [task.listMessages](https://open.manus.ai/docs/v2/task.listMessages)
- [task.stop](https://open.manus.ai/docs/v2/task.stop)
- [Open App](https://open.manus.ai/docs/v2/open-app)

The adapter uses an API key in `x-manus-api-key`. Agent discovery needs an API
key or a Trusted OAuth client; this release does not implement OAuth.
Verification resolves a canonical agent ID and its existing persistent main
task. The backend must not bind that personal task to two different groups.

Before sending, the adapter verifies that the personal task has not changed and
reads only the newest event's opaque ID as an audit baseline. It immediately
discards the message body. It makes one send attempt for each durable local
request claim. An ambiguous network result remains unknown; this is not a
provider-side exactly-once execution guarantee.
Manus returns a request receipt ID and task ID, which are persisted with the
baseline; the run state is **`submitted`**, not `completed`.

The documented response has no user-message ID or run ID that can reliably
associate later assistant replies with this specific API request. Another
private conversation or autonomous task can produce newer messages in the same
main task. A timestamp, cursor, prompt marker or model-generated request tag is
not a trustworthy boundary. Consequently, `poll` never calls `listMessages` or
imports responses into the group. Read the result in Manus/Cue. A separately
configured and validated MCP client may explicitly share selected results
through the group tools; this release does not install or verify that connection
in Manus/Cue.

Cancellation is disabled because `task.stop` stops the whole personal main
task. The integration cannot safely cancel only this group request.
There is no invented idempotency field in the Manus request; duplicate
prevention is the backend's durable claim. An ambiguous network failure remains
unknown and must not be retried blindly.

## Other personal-agent platforms

The shared group endpoint currently implements Bearer-authenticated MCP tools
with protocol version `2025-06-18`. The same authenticated channel scope and
normal REST authorization apply to every tool. This establishes the group tool
surface, not an installed personal-agent connection for a particular brand.

ChatGPT dot private-plugin OAuth and MCP Events subscriptions/dispatch are not
implemented. Muse connector account setup/approval and Grok Bot account setup
and wake behavior have not been validated. These entries remain unconnected in
the product catalog. A model completion API is not substituted for a personal
Agent. See the official platform references and sequencing in the
[research roadmap](personal-agent-roadmap.zh.md).

## Network and credential boundary

- Manus is fixed to `https://api.manus.ai` (`/v2` is accepted in configuration).
- Hermes requires an exact, deployment-controlled public HTTPS origin in
  `COLLABORATION_HERMES_ALLOWED_ORIGINS`, encoded as a JSON array. For example:
  `["https://hermes.example.com"]`. Do not derive this allowlist from a request.
- Hermes roots may end in `/v1`, or `/p/<profile>` with optional `/v1`. Arbitrary
  paths, embedded credentials, query strings, fragments and encoded separators
  are rejected.
- IP literals, localhost and internal host suffixes are rejected even when
  listed. The deployment administrator must ensure an allowed DNS name resolves
  to the intended public gateway; the Workers fetch API does not expose DNS
  pinning. Egress restrictions belong at the deployment boundary as well.
- Requests use `redirect: "manual"` and explicitly reject every 3xx response;
  credentials never follow redirects. (`workerd` does not accept the Fetch
  `"error"` redirect mode.) A
  timeout covers headers and response body. JSON responses are bounded to 1 MiB
  and successful final text to 60,000 characters.
- Credentials stay in server-only `ProviderConfig`; they must not be stored
  in run references. Provider errors contain only local codes and fixed text.
  Raw provider bodies and exception causes are discarded.

## Run leases and durable group-result receipts

Each D1 run claim carries a random `lease_token` in addition to its deadline.
Every outcome/error/receipt update and lease release compares that token. A
request returning after another request takes over cannot downgrade the newer
state or release its lease. Revocation invalidates the outstanding token; a
persisted completed result is not downgraded because storing its group receipt
failed. Sync reuses the saved result rather than rerunning a paid operation.

Group sends use `cloud-run:<UUID>`. The group DO atomically records a
principal-scoped, payload-free receipt with the message. A retry can acknowledge
the original sequence even after the body is pruned, without reinserting or
rebroadcasting it. This is not an atomic transaction with the provider or D1,
nor an exactly-once guarantee for external notification side effects. Identity
erasure/group deletion end the receipt guarantee; pre-upgrade messages already
pruned cannot be reconstructed. See [upgrade and retention notes](commons-reliability.zh.md).

## Repeatable validation

The contract fixtures follow the official JSON schemas above. Tests start a
loopback HTTP server with synthetic keys; an injected fetch maps validated test
HTTPS origins to this server. The production endpoint validator is still used.
No test contacts Hermes, Manus, Cue or a user's personal agent.

Run on Node 24:

```sh
node --experimental-transform-types --test worker/test/provider-transport.contract.mjs
```

The suite covers native lifecycle, idempotency headers, profile paths, uncertain
writes, timeouts, cancellation acknowledgement, identity mismatches, private
Manus history and interleaved replies, malformed/oversized responses, redirects,
endpoint allowlists and credential redaction. The `.contract.mjs` filename is
intentional: this real TCP server test is separate from workerd tests, where a
TCP listener is not available.

Actual-account verification and macOS/Windows runtime testing remain separate
release gates; passing these tests does not claim those gates have passed.
