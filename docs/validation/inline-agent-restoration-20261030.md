# Recovery at the credential error

Creation and rotation errors with `participant_removed` now resolve the exact requested identity and display the existing narrow recovery control beside the error. The flow covers manual HTTP MCP creation, local connector setup, the legacy join guide, and My Agents rotation. It does not silently restore, mint, rotate, launch a client, or change MCP policy.

A human moderator confirms the identity's stable name, owner and channel. Readback checks the current removal epoch before submitting. The UI also sends the confirmed owner; the server rejects an owner change. After restoration, a separate explicit Create/Rotate click is required. A still-active credential can produce the normal name-conflict response; the UI does not overwrite it.

`GET /api/channels/:slug/agents/:name/access` returns only allowlisted access metadata for the owning human or a channel moderator with channel access. It includes revoked ordinary identities, allowing readback even when a restored revoked row disappears from the active-agent list. Other owners, agents, child identities, other groups and OAuth identities are restricted. This read endpoint does not change membership or credentials.

An uncertain restore response is always followed by readback. If readback fails, the next action only rechecks status; it cannot blindly resubmit. Duplicate clicks, changed owner, changed group/service and late callbacks are guarded. Nonmoderators receive moderator guidance and no restore action.

Validation: five affected Worker suites passed all38 tests, including the new access readback/ACL suite, unchanged credential and membership fields, revoked-token behavior, and rejection of a stale confirmed owner. Eight isolated affected Web test files passed152 tests; the subsequent new rotation recovery assertion increased the affected total to153. The updated manual/restoration pair passed29 tests, and the updated AgentTokens rules suite passed25. Web/Worker TypeScript and diff checks passed. Existing whole-suite results are baseline evidence, not a claim of a new whole-suite run.

Real browser with synthetic responses: at390px, the error displayed a restore button, the confirmation named the identity/owner/group, readback confirmed restoration, and Create became enabled. Mock counts stayed mint=1/restore=1 until a separate creation click; there was no automatic second issuance. Body width matched viewport390. The browser fixture supplied a controlled confirmation response; no unknown production identity was restored for acceptance.

CodeBuddy/Kimi CLI, applications and models were not invoked. Tests only render components and use synthetic HTTP/Worker fixtures. No real credential was used to exercise MCP.

Today remains a separate unresolved diagnosis. Public production was62749a2e and the previously restored identity had no renewed name/account removal or ban. The requested03:03UTC existing-journal extraction failed first because SSH closed, then because journalctl exceeded a20-second limit. This does not establish whether Today reached the server, its method/status/auth-header presence, or the cause of `mcp.upstream_unavailable`. The minimum missing evidence is the client's underlying HTTP status and sanitized error code/message. No authentication, Origin or transport policy was relaxed based on that wrapper error.

No schema migration is required; no experimental Muse migration or events/tunnel restart is part of deployment.
