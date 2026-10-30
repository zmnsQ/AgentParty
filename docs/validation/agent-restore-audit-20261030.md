# Single-agent restoration audit compatibility

Production restoration of the explicitly authorized ordinary Agent succeeded through the narrow human-moderator UI/API. The target name tombstone was removed; the owner, group scope, credential creation/revocation fields and account-level membership/ban/removal remained unchanged. No credential was read, issued or rotated by this operation.

Post-operation verification exposed an audit bug: `channel.agent.restore` was added only to the TypeScript union, but not to the deployed SQLite `management_audit.action` CHECK. The best-effort audit insert consequently failed after the successful restoration. The existing fixture checked restoration and MCP but did not assert the audit row.

The fix records this membership restoration as the existing schema-compatible `channel.member.add` action, keeping the exact `/agents/:name` resource and allowlisted metadata `{participant_kind:"agent",restored:true}`. It does not add a human membership. The unsupported action is removed from the TypeScript union. No migration or historical audit backfill is performed.

The actual-route MCP restoration fixture now requires a successful persisted audit row with the human actor, compatible action and restoration metadata. It failed against the previous code and passes after the fix. All 52 tests in the credential-removal, participant-tombstone, agents and management-audit suites passed; Worker TypeScript and diff checks passed. The same fixture still verifies removed initialize403 → strict restore → initialize/tools/list/profile success, unchanged membership/credential fields, and revoked old credentials remaining401 after restore and explicit remint.

Web source is unchanged from `7c64b2afdc01735adcfd8cb33c75787592169b25`; reuse its verified Web artifact. Existing Web tests and the prior full Worker1279 run are retained as baseline evidence, rather than represented as fresh whole-suite runs for this small audit fix.

Production MCP coverage: the existing connector's read-only profile succeeds for a different OAuth Agent in the same group. No safe, unexposed credential path for the restored ordinary Agent is available to the executor. Its production initialize/tool calls and actual Muse/Today reconnection are therefore not claimed. Exposed screenshot/browser credentials must not be reused for testing.
