# MCP response contracts, 2026-10-30

Base: `83dd8e163bcb457ca98da9cdead72e3a43e481fc`.

Pinned upstream 2026-07-28 JSON Schema reproduced four response failures:
discovery lacked `ttlMs/cacheScope`; tool listing, invocation and ping lacked
`resultType`. Discovery now supplies server identity in the specified `_meta`.
Modern synchronous successes use `resultType: complete`; discovery and tool
listing use `ttlMs: 0, cacheScope: private`, with HTTP `no-store` retained.
Tool execution errors remain complete results with `isError: true`; protocol
errors stay JSON-RPC errors. Authentication, authorization, revocation, Origin,
rate limits and event transport policies are unchanged.

Validation:

- Before the implementation change: four official-schema regression failures;
  the separate legacy SDK handshake already passed.
- After: six Node protocol tests passed, including complete official schemas,
  all 16 tool definitions/input schemas, live policy visibility changes, legacy
  absent/2025-06-18/2025-11-25 headers, and SDK 1.31 initialize → initialized →
  tools/list → read-only profile invocation using an in-process synthetic Bearer.
- 95 workerd tests passed across collaboration-mcp, manual-mcp-diagnostic,
  mcp-security, mcp-events, mcp-push-stream, connector-oauth and request-diagnostics.
  These include authenticated router/database coverage, disabled/write-denied
  policy and revoked-token rejection. Worker TypeScript passed.
- SDK/Ajv dependencies are test-only. Node validation runs separately from
  workerd, and the normal package test command runs both suites. The fixture
  README records immutable upstream schema/license blobs and fixture SHA-256.

Production release uses one Worker build, reuses verified unchanged Web assets,
omits diagnostic-window build defines, and follows the pinned VPS backup/atomic
switch/health/rollback procedure. No migration, credential/member operation,
events/tunnel restart, provider/model call or new capture window is required.

Limits: HTTP 200 from the closed capture does not prove valid JSON-RPC. The
time-correlated request candidates cannot be assigned to Today from the eight
approved fields. These real schema defects are not a confirmed Today root cause;
this is not a certification of every 2026 feature or a real Today client test.

Official references: [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover),
[Caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching),
[legacy lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle).
