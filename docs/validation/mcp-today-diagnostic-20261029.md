# Today MCP diagnostic and reachable permissions — 2026-10-29

## Verified, not inferred from the generic client error

- Public version and health at 15:07 UTC reported deployed commit `532dd6d7d48ea4433ba1a2a65c83d563b70db4ed`, healthy, deployment 14:21:58Z.
- An anonymous MCP request returns 401 before protocol handling. It cannot verify a real credential, its group scope, or initialize/tools behavior.
- HTTPS anonymous challenges still advertise an HTTP resource_metadata URL, while HTTPS discovery JSON contains HTTPS resource/issuer/endpoints. Source only constructs the challenge from HTTPS AUTH_PUBLIC_ORIGIN. Runtime/proxy/actual artifact comparison is required; do not trust arbitrary forwarded headers as a patch.
- Two anonymous curl probes from this cloud executor returned 401; time to completed TLS was 10.83/7.72 seconds, first byte 11.27/7.94 seconds. These are end-to-end path observations, not proof that the application spent that time processing or that Today's network sees the same delays. No 20-second zero-byte timeout was reproduced in these two probes.
- Existing managed OAuth connector's read-only profile succeeded for the exact target group. This proves that particular existing connector/request worked, not that Today's separately configured Bearer is valid or its network/transport is equivalent.
- The cloud browser showed the target group's GitHub sign-in page. No new sign-in, token extraction or permission change was attempted. No leaked screenshot credential was read, used or recovered.
- `mcp.upstream_unavailable` is not generated anywhere in this repository. The precise Today failure still needs its sanitized underlying HTTP status/request stage/version/request ID; a generic wrapper error and zero discovered tools do not identify the cause.

## Authenticated local evidence

`worker/test/manual-mcp-diagnostic.spec.ts` creates a synthetic ordinary Agent credential through the real /api/agents route. Default-closed MCP rejects initialize with 403. After the test fixture explicitly establishes owner MFA and read-only MCP policy, initialize returns finite JSON, initialized notification returns empty 202, tools/list returns valid read-only tools without OAuth-only metadata, and commons_profile returns the correct identity/group. Disabling fixture MFA rejects again. No production credentials are involved.

The already installed official TypeScript MCP SDK 1.31.0 was also exercised against an injected local transport using the actual handler: initialize 200, initialized 202, optional GET 405, tools/list 200 (16 tools), profile 200. Its strict result/schema parsing passed. This SDK check uses a synthetic identity and is not full route authentication or a Today end-to-end test.

## Actual UI defect and fix

The existing permissions panel was reachable only through the `dot` or `muse` selection in CloudBridges. The Other MCP/manual Bearer guide did not show it or the prerequisites. A user in that flow could create a valid ordinary Agent token without being shown that group MCP/MFA still blocks initialization.

McpReadiness is now embedded directly in the manual guide. It reads group MCP and owner-MFA status, distinguishes blocked/unknown/ready prerequisites, and exposes the existing permissions panel in place. Only an authorized owner can explicitly save changes; opening the guide, reading status, generating a token, or refreshing does not enable MCP. Read/write/events remain separately controlled. Saving settings does not erase the open one-time credential; recheck updates the status. Network failures are unknown, not success, and stale group requests cannot replace current status.

This fixes a missing status/settings entry, **not a proven fix for Today's upstream error**. Existing successful same-group OAuth means the shared gate was passed for that request; do not tell the user that MCP is definitely disabled.

## Validation and release boundaries

Component tests cover status, failure, stale requests, owner access to actual checkbox/save controls and non-owner read-only display. The real AgentJoin chain and one-time credential lifecycle regressions remain. Web production build and TypeScript pass. Full isolated Web suite and authenticated Worker diagnostic are recorded in the engineering result. No schema/backend implementation/permission defaults change. No production deployment or real account connection is performed.

Final local results: **205 isolated Web files / 1751 tests passed**, Web TypeScript and production build passed; **3 Worker suites / 21 tests passed** including the new full authenticated fixture chain. Owner settings expansion/save and non-owner display were tested through actual existing McpSecurityPanel, not a placeholder. The cloud browser checked only the production sign-in screen; there is no new rendered acceptance of this local component or real Today authenticated test.
