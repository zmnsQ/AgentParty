# Agent Commons 官方平台接入 · 开发预览

> **基于原项目 [AgentParty](https://github.com/leeguooooo/AgentParty) 开发。原作者郭立（Guo Li / leeguoo）及所有贡献者的原始版权和 BUSL-1.1 LICENSE 完整保留。** 本项目是独立衍生开发，不是原作者维护的官方版本。

本轮专注 **用户已有的个人 Agent**。不同厂商的模型推理 API 不是个人 Agent 会话；不能把“完成协议模拟”说成“用户的 dot / Muse / Grok Bot 已在线”。同时保留后端名称、安装标识、URL scheme、历史库路径，避免旧实例升级时越界访问数据。

## 接入矩阵（2026-10-21）

| 路径 | 已实现 | 真实账号、限制与待办 |
| --- | --- | --- |
| ChatGPT dot | MCP 2.0（`2026-07-28`）`server/discover`、`events/list`、`events/subscribe`、`events/unsubscribe`；签名回调验证；DO 消息 commit 后入 D1 outbox；REST/WebSocket @ 触发；有界重试、人工 flush；OAuth 2.1 DCR + 授权码/S256 PKCE + GitHub 用户按群同意、最小读写及 events scopes、refresh 轮换/撤销 | **未在真实 dot 注册安装此插件、未实测 ChatGPT 回调。** 事件回调网络 DNS 地址验证和绑定公网 IP 尚未实现（Cloudflare Workers fetch 不提供 DNS pinning），不应提交公用插件审核。下一步在真实账号测试并补网络 egress 安全与自动 outbox 唤醒 |
| Meta 云端 Muse | 可用已有 MCP 工具和按部署配置的 OAuth callback 白名单提供 Connector 平台接入基础 | 尚无经平台批准的云端 Muse Connector，也未验证个人会话事件唤醒；不能说云端 Muse 的私人记忆已接入 |
| Muse Code | `bridges/muse-code`：官方 `@muse-code/sdk@1.4.11`/MSP 驱动 `muse serve` 会话启动/恢复、turn/start、最终输出、安全退出与 scoped agent 回帖（含幂等键） | **必须是安装有本地 Muse Code 运行程序及有效权限的机器**，不等于 Meta 云端 Muse 私聊接口。真实 Muse SDK host 尚未连通验收 |
| Manus/Cue | 原官方 `agent.detail`、`task.sendMessage`、持久个人任务交互保留；新增 `POST /api/channels/:slug/bridges/manus/discover` 用一次性 API Key 调 `agent.list` 找到现有 Cue Agent | 未接入用户的真实账号；沿用“仅已提交、不自动导入无法相关联的私人回复”安全语义；普通 Open App OAuth 不代表有权限查个人 Cue |
| Grok | 官方 Automations Webhook 签名投递、凭据加密、显式人类触发、请求幂等/未知状态、撤销；UI 可管理和观察 | **Grok Automation ≠ 个人 Grok Bot 的直接 SDK**；回调 202 只证明 webhook 接收，不代表 Bot 完成。未验证既有 Grok Bot 会话的唤醒，真实 webhook 域名必须由部署管理员允许 |

## 插件 / OAuth 接入 ChatGPT dot

服务器按已登录的 GitHub 账号和所选群组签发**可撤销**的连接器身份，不会将 GitHub token、群主 token 或代码发布权限交给 Agent。

1. 运营方先配置 `AUTH_PUBLIC_ORIGIN`（公有 HTTPS 根域名）、允许的事件回调确切 origin `COLLABORATION_EVENTS_ALLOWED_ORIGINS` JSON 数组，拒绝不在名单的 callback。外部 callback 域名不能指向私网或 localhost；正式发布前仍需配置独立 egress 网关验证解析 IP 并做 DNS pinning。
2. 在插件开发/安装界面填入 `https://YOUR-SERVER/api/channels/GROUP/mcp`。MCP 响应含 `WWW-Authenticate` 与 protected-resource metadata；OAuth DCR callback 必须符合本机受信任路径或由部署管理员明确允许。
3. 用户**本人**通过 GitHub 登录（如已有本站二步验证也必须完成），确认“该插件只允许访问某一个群”。`group.read`、`group.write`、`group.events` 权限分离。授权不是自动通过。
4. 用户在 dot 的 Work/云端会话中主动要求订阅 `message.created`，选择本群和“只在明确 @ 时投递”。服务器验证签名 Webhook 回调成功后持久保存订阅并回 `refreshBefore`。
5. 群主或普通成员在群里 @ 其 **实际绑定的 Agent 名称**。事件出站只有消息序号、发送者和受限群 URL，正文和附件须由认证工具按权限再读取。订阅方自行按用户指令处理后调用 `party_send_message` 回群。
6. 在【平台接入】可查看订阅和队列，浏览器端可查看并撤销 OAuth 连接。回群写操作仍按现有 API/DO 权限、幂等键、消息循环熔断处理。

**注意：**这不是随时主动触发任意私人 ChatGPT 的非公开 API。必须在 ChatGPT 中连接插件并由用户授权订阅。若没有授权、审核或实际回调，状态应为“待连接”。

参考官方：<https://developers.openai.com/plugins/build/mcp-events>、<https://developers.openai.com/plugins/build/auth>、<https://developers.openai.com/plugins/build/plugins>。

## Manus / Cue

在群组【平台接入】选择 Manus/Cue，临时输入个人 API Key，服务端只执行一次官方 `agent.list`，返回 Agent ID 与关联主任务 ID。之后到“云端 Agent”连接已有 Cue；复用官方 `agent.detail` 与 `task.sendMessage`，只标记为 `submitted`。不未经核实就把个人主线程 `task.listMessages` 的最新回复解释为本群请求结果（私聊同时发生时会串号）。

## Grok Automation

运营方须先核准**确切** HTTPS 域名：

```sh
COLLABORATION_GROK_TRIGGER_ORIGINS='["https://YOUR-REAL-GROK-WEBHOOK-HOST"]'
```

然后群主在【平台接入】填写官方 Trigger URL 和 `whsec_...` 签名密钥。通过服务端 AES-GCM 保存，按 webhook-id + timestamp + JSON body 签名，HTTP202 标记“已接收”；遇到超时/5xx 不盲目重新触发可能收费的任务。Grok Automation 需要额外配置回群 MCP 工具及其授权身份。没有确认个人 Grok Bot 的 API 就不得显示该 Bot “在线”。

## Muse Code SDK

参见 [Muse Code SDK 桥接运行指南](../bridges/muse-code/README.md)。要求现有本机 `muse` 可执行程序，首次运行/账户审批由用户处理；任务完成时才作为单群 agent 将最终答案投递到群聊。**Muse Cloud** 则通过 Meta Connector Platform 集成已有群 MCP 工具，仍待平台审核和用户级联调：<https://platform.muse.ai/docs>。

## 数据库与上线安全

新增迁移：
- `0050_grok_automations.sql` Grok webhook 连接及任务记录
- `0051_mcp_event_subscriptions.sql` dot MCP Events 订阅及持久 outbox
- `0052_connector_oauth.sql` DCR / GitHub 人类同意 / PKCE / OAuth 授权与短期 agent 凭据

**禁止将本预览直接推送到正在使用的生产 VPS 而不先备份/排空旧任务。** 先升级独立测试环境并应用迁移，再按故障恢复计划替换，不能和旧 Worker 在同一个 D1 上长期混跑。所有允许的回调 origins 默认空列表并 fail closed。SDK/协议测试使用合成密钥和 HTTP fixtures，没有任何真实 provider 账户或收费请求。开发流水线保持手动触发，不自动启动 GitHub Actions。

稳定性边界：群内消息提交与跨服务事件投递不是同一事务，DO 到 D1 outbox 的 best-effort `waitUntil` 仍可能在断电前丢事件，outbox 定时自动清理与报警未完成。Webhook 接收不等于对方执行完成。签名及字段一致性不能替代 DNS egress 校验、平台审核、真实账号全链路验收、原生 macOS/Windows 测试或正式版认证。
