# MCP HTTP response regression

Run `bun run --cwd worker test:protocol`. Tests use Node, the actual MCP handler,
synthetic identities, a policy database stub, and an injected in-process fetch.
They never call a provider or use production credentials. Workerd tests separately
cover the real authentication/router/database path.

The JSON Schema fixture is byte-for-byte upstream
[`schema/2026-07-28/schema.json`](https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/git/blobs/213c58f6d9a1c2ce6ad055afe90bbdb095a29ee8),
Git blob `213c58f6d9a1c2ce6ad055afe90bbdb095a29ee8`, SHA-256
`ef70b61f99b6d2e5e3b46863822eab08dff6a45bedc7a08914e0e5b133f40203`.
Its upstream license is preserved in `fixtures/MCP-LICENSE.txt` (Git blob
`4a93985763241755401a10678395303de4e720ba`). This does not change this project's license.

Modern tests validate JSON-RPC result envelopes, discovery, all tool definitions,
tool success/execution errors and ping against that fixed official schema.
Cache hints use `ttlMs: 0` and `cacheScope: private` because tool visibility depends
on current group policy and OAuth scope. HTTP responses remain `no-store`.
Discovery identifies the server through the specified `_meta` field.

SDK 1.31.0 supports protocols through 2025-11-25; it is used only for the separate
legacy initialize → initialized → tools/list → read-only tools/call regression.
It is not evidence of 2026-07-28 client compatibility. These tests do not certify
every modern protocol feature (such as multi-round-trip input or subscriptions),
and do not reproduce Today or identify its internal validation rules.
