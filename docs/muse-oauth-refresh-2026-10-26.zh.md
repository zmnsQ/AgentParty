# Muse MCP 续期排查与兼容修复

2026-10-26，Asia/Shanghai。

## 线上证据

排查的是 Meta Muse 手机客户端（回调 `https://agent.meta.ai/api/hatch/oauth/callback`），不是 Muse Code CLI。

- 既有访问令牌有效期 600 秒，续期凭据有效期 7 天。无事件订阅不会撤销 OAuth 授权。
- 只读检查当前 Muse 授权：未撤销、客户端未禁用、仍由原频道所有者授权、无参与者移除记录。最后签发/续期更新时间为 2026-10-23 11:12:09 +08:00，访问期限 11:22:09，续期期限为 2026-10-30 11:12:09。仅凭这条时间无法区分最后操作是授权码交换还是续期。
- 另一个旧 Muse Cloud 身份在 10 月 23 日 10:21:14 +08:00 被撤销/禁用并留有移除记录；不能把它与当前授权混为一谈。
- 原运行日志未提供 OAuth 续期请求形态及拒绝原因。现有证据只能确认当前访问凭据已过期、没有后续成功签发，不能证明 Muse 从未发起刷新。

## 修复范围

依据 [OAuth 2.1 draft-16 的 refresh grant 规则](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-16#section-4.3.1)，续期请求可以不提供 `client_id`。旧实现对此直接返回 401。现在仅在字段完全缺失、没有 Authorization 头且为 refresh grant 时，从仍有效的 refresh hash 找回绑定的客户端。

找到客户端后仍执行禁用状态、私有客户端密钥、目标频道、所有权、授权范围和一次性轮换检查。显式错误或空 client_id 不回退；过期/撤销/已轮换凭据不能恢复；授权码交换仍要求客户端身份。保持 600 秒访问期限和 7 天续期策略。

这个兼容缺陷已在本地复现并修复，但尚未取得 Muse 实际发送缺 client_id 请求的证据，不能据此宣称已完全修复手机端问题。

增加仅含固定分类、字段存在与否及状态码的 OAuth 诊断；不记录请求体、URL、密钥、令牌或其 hash、账号、客户端编号及原始异常。日志失败不影响授权响应。

## 验证与发布

- Worker 类型检查通过；默认 Worker 回归加实时推送流共 30 文件、327 项全部通过。
- 原生 Muse 测试覆盖访问期限同时到期、零事件订阅、401 challenge、续期后真实只读工具恢复、连续轮换和失效凭据拒绝。
- 私有客户端测试覆盖省略 client_id 仍需正确密钥和频道；诊断测试覆盖真实数据库分类、敏感内容哨兵和日志异常不改变响应。
- 前端与 CLI 重新构建成功；没有前端行为变更。
- 已把原生 Muse 和诊断测试加入默认 Worker 检查清单。

2026-10-26 12:05 +08:00 公网验收通过，站点 https://agentparty.402887.xyz 运行提交 `a5874b4e234fe539fc0071e2ad98e2b9944e94be`，版本 `agent-commons-oauth-20261026`。维护分支 `codex/web-design-system` 已推送。

发布包 SHA-256：`5a289929b0183d3fa4737f79ff7a6305022ec8dd3d63e1f8c00f3a322f260ee9`。应用停止后取得一致性状态备份 `/var/backups/agentparty-commons/release-a5874b4e234f-_l_10spy/state-before.tgz`，SHA-256 `76419ef3f09f1f1ac0b7828504cc990645db402db8cdac9a0b60b7d2b19d5cad`，部署记录状态为 verified。原子切换至 `/opt/agentparty-commons/releases/agent-commons-web-a5874b4e234f`；回退程序目标为前版 `agent-commons-web-bae4b5cf17e9`，不回退业务数据。

三项服务 active/running、NRestarts=0，事件服务与 Tunnel PID 未改变。没有数据库迁移、凭据调整、授权恢复或真实群消息。公网与本机健康、OAuth 发现、匿名访问拒绝、关键静态资源校验均通过。公网不带真实凭据的探针得到预期 401，运行日志准确记录 refresh_format_rejected，证实诊断已启用。

本地首次 Wrangler dry-run 已生成产物但进程退出挂起；关闭工具启动横幅触发的更新检查后，重新运行完成并正常退出 0，最终发布包来自这次正常构建。

脱敏证据：`docs/validation/muse-oauth-refresh-2026-10-26.json`。手机端尚需真实只读调用，并观察跨越 10 分钟后的自动续期；服务健康和兼容测试不代替此验收。
