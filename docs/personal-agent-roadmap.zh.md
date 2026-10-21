# AgentParty Commons：个人 Agent 协作开发路线

研究日期：2026-10-21（Asia/Shanghai）  
研究基线：`leeguooooo/AgentParty@25384eca99b24ed823ab54b4e850a0c9079a3b24`  
工作分支：`feat/personal-agent-collaboration`  
状态：先完成本路线和接口约定，再实施。本文的“目标”不表示已经实现或通过真实账号验证。

## 1. 产品目标

在同一 macOS / Windows 客户端中管理本地与个人云端 Agent，创建多人和多 Agent 群组，共享文件，并围绕 GitHub 分支、提交和 PR 协同。接入保留各平台真实能力边界：基础模型 API 不等于用户已培养的个人 Agent，也不等于可读取其全部私聊。

项目暂用名 **AgentParty Commons**。这是基于 AgentParty 的独立衍生开发，并非原作者维护的官方版本。保留原作者郭立（leeguoo / leeguooooo）及贡献者的署名和原始 LICENSE。

## 2. 已验证的上游现状

- 上游 README 宣布原托管服务于 **2026-10-31** 关闭；`worker/wrangler.jsonc` 同时配置了实际停服日期。fork 必须使用独立服务配置，不依赖即将关闭的托管地址。
- 原项目已有 Tauri 2 / Rust 桌面壳、React UI、Bun CLI、Cloudflare Workers / Durable Objects / D1 / R2，群组、权限、任务、消息历史、附件和本机 Agent 桥接可以复用。
- Windows 已有部分代码与 sidecar target，但上游桌面发布矩阵只覆盖 macOS；不能据此宣布 Windows 安装包已经通过验收。
- README 与代码对新群 loop guard 默认值的描述不一致；云端执行必须有自己的显式人类触发、并发和幂等边界，不能假定现有默认值足够。
- 上游许可证为 **BUSL-1.1**，并非 MIT 或当前的 Apache-2.0。附加授权允许个人，以及同时少于 100 人、年收入少于 100 万美元的组织免费生产使用；其他生产使用依原许可证处理。Change Date 为 2030-07-08。衍生分发保留完整许可证及醒目来源说明。

源码依据：[README](https://github.com/leeguooooo/AgentParty/blob/25384eca99b24ed823ab54b4e850a0c9079a3b24/README.md)、[LICENSE](https://github.com/leeguooooo/AgentParty/blob/25384eca99b24ed823ab54b4e850a0c9079a3b24/LICENSE)、[desktop](https://github.com/leeguooooo/AgentParty/tree/25384eca99b24ed823ab54b4e850a0c9079a3b24/desktop)、[worker 配置](https://github.com/leeguooooo/AgentParty/blob/25384eca99b24ed823ab54b4e850a0c9079a3b24/worker/wrangler.jsonc)。

## 3. 个人 Agent 接入矩阵

| 平台 | 已确认的官方能力 | 实施路径 | 需要如实展示的边界 |
| --- | --- | --- | --- |
| Hermes Agent | 原生 runs API、SSE、取消、审批；使用配置好的 profile 工具与记忆 | 原生 HTTP adapter，每群独立 API session | API session 无法直接接管 CLI / Desktop 等其他 surface 的 session；共享已有会话另需 Gateway WebSocket |
| Manus / Cue | v2 agent.list / agent.detail 包含 Cue 创建的 Agent；主 task_id 是持久会话 | 发现 Agent、绑定主 task、sendMessage、增量 listMessages | 需 API key 或 Trusted OAuth；不可把原私聊历史整体转发到群；同一持久主会话不可静默绑定不同群 |
| ChatGPT dot | 插件和 MCP Events 支持 dot | 先做授权范围内 MCP 工具，再独立实现并验收 MCP 2.0 Events | MCP 工具可用不代表自动唤醒已经可用；Workspace Agents API 不是 dot API |
| Meta Muse | 官方 API / MCP Connector Platform | AgentParty 作为 Muse 的 Connector 提供群组工具 | 接入方向是 Muse 调用群组服务；公开分发可能需要平台审核；未证实个人对话直调 API |
| Grok Bot | Remote HTTPS MCP、自定义插件、Team Bot | AgentParty MCP 工具连接 | xAI 模型 API 不等于个人 Bot API；未确认通用外部唤醒 API |
| 其他 Agent / A2A | Agent Card、任务、产物、认证协议 | 后续按确定版本提供适配器 | A2A 1.0 与 0.3 的字段和方法不同，不能宣传半套兼容 |

官方资料（截至研究日）：

1. [Hermes API Server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
2. [Hermes Programmatic Integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration)
3. [Manus Agents](https://open.manus.ai/docs/v2/agents-overview)
4. [Manus agent.list](https://open.manus.ai/docs/v2/agent.list) / [agent.detail](https://open.manus.ai/docs/v2/agent.detail)
5. [Manus task.sendMessage](https://open.manus.ai/docs/v2/task.sendMessage) / [task.listMessages](https://open.manus.ai/docs/v2/task.listMessages)
6. [ChatGPT dots](https://learn.chatgpt.com/docs/dots) / [MCP Events](https://developers.openai.com/plugins/build/mcp-events)
7. [Meta Muse Connector guidelines](https://platform.muse.ai/docs)
8. [Grok Team Bots](https://docs.x.ai/grok-bot/team-bots)
9. [A2A specification](https://a2a-protocol.org/latest/specification/)

## 4. 架构决策

### 沿用 Tauri，扩展现有协作控制面

React web 与 Tauri 共用协作空间 UI。Worker 管理频道、授权、云连接、运行记录和仓库绑定；D1 存结构化状态，R2 存文件，现有 Durable Object 保持聊天消息顺序。新增云适配器不强塞为本机 shell runner，也不改变原有本机 Claude / Codex 会话。

所有新增消息仍经原有消息 REST / DO 路径，保留身份、频道 scope、禁止发言规则和消息幂等。远程 MCP 通过同样的 REST 入口执行，不允许调用者指定任意 sender 冒充他人。

凭据仅服务端加密保存，API 只返回是否已配置。初版要求部署者提供独立的加密密钥；缺少密钥时拒绝保存敏感连接，不退化成明文。供应商密钥不出现在聊天、浏览器持久存储、日志和 API 返回中。

### 群组与个人记忆边界

每条 connection 绑定频道、所有者、平台和远端标识。Hermes 默认创建群级 session；Manus 必须通过明确说明将已有主会话用于当前群，禁止一个主会话重复绑定不同群。只转发本次请求对应的新增 Agent 结果，不能导出其历史私聊。个人 Agent 自身拥有的工具和记忆可能影响答案，这不是频道 ACL 能抹去的事实，需在连接说明中提醒。

初版采用**显式人类发送任务**，不默认让所有 Agent 看见任何消息就付费运行。运行持久化，重复请求复用同一记录；每个连接只允许一个进行中的任务。网络超时造成“远端是否启动未知”时不盲目重试创建。后续自动 @ 唤醒要同时完成预算、因果链和反馈环测试。

### GitHub 协同方式

频道可绑定真实 GitHub 仓库并读取 PR / 分支 / 提交。编码 Agent 在自己的 `agents/<agent>/<task>` 分支或 worktree 开发，经独立授权推送，再把 PR 放回群中供其他 Agent 读取和评审。远端代码写入应通过受限 GitHub App 或每仓最小权限凭据，要求 base SHA、不 force push、不自动合并。

首版提供仓库绑定与真实协作信息，并保留现有本机 worktree 工作流。Worker 代理代码写入列为独立里程碑；没有完成授权和冲突测试前，不能在 UI 中显示假的“已推送”按钮。

### 群文件

复用现有附件上传和鉴权下载，通过 R2 频道 prefix 列出所有文件，不只扫描当前聊天窗口。支持分页、搜索当前已加载文件、上传及投递到群。目录、版本、置顶与保留期后续按真实索引表实现。删除单个引用不等于删除底层去重文件。

## 5. 首版接口约定

所有频道路由继承原有 bearer、成员、撤销和封禁检查。敏感配置仅限人类房主；普通成员可读取群协作信息，显式运行由人类成员发起。

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/channels/:slug/collaboration` | provider 能力、连接、仓库和当前权限 |
| PUT `/api/channels/:slug/cloud-agents/:id` | 创建 / 更新连接，write-only credential |
| DELETE `/api/channels/:slug/cloud-agents/:id` | 撤销连接 |
| POST `/api/channels/:slug/cloud-agents/:id/runs` | `{prompt, request_id}` 显式创建 / 复用运行 |
| GET `/api/channels/:slug/cloud-agents/:id/runs` | 历史运行与状态 |
| POST `/api/channels/:slug/cloud-agents/:id/runs/:runId/sync` | 有限轮询与增量结果同步，支持刷新后恢复 |
| POST `/api/channels/:slug/cloud-agents/:id/runs/:runId/cancel` | 仅当平台支持时请求取消 |
| GET `/api/channels/:slug/files` | 频道文件分页，复用现有上传 / 下载 / 发送 |
| POST / GET `/api/channels/:slug/repositories` | 绑定 / 列仓库 |
| DELETE `/api/channels/:slug/repositories/:id` | 解绑 |
| GET `/api/channels/:slug/repositories/:id/pulls` | 真实 PR 信息 |
| POST `/api/channels/:slug/mcp` | 按固定已实现协议版本的 MCP 工具桥；不冒充 Events |

首版同步机制是客户端显式 sync，长运行状态落库；桌面关闭后的无人值守同步、MCP Events、自动 @ 调度需后续独立验收。通过 UI 提示这个运行条件，避免把开发版当全天候托管服务。

## 6. 开发顺序与验收

### M0：fork 与独立运行基础

记录来源 commit，保留 LICENSE，补充 NOTICE / 致谢。使用独立桌面标识与 URL scheme。移除默认上游停服时间、部署资源 ID、上游自动更新配置。新 CI 仅手动低成本验证，原发布工作流隔离保存，不继承自动部署。

验收：fork 不会在上游停服日自停；不自动更新回官方客户端；不默认使用原作者云资源。

### M1：协作空间与真实连接实现

固定 shared 类型；实现加密配置、Hermes / Manus adapter、运行状态及幂等；新增协作空间 UI、群文件、GitHub 绑定和 PR 信息、授权 MCP 工具。以可重复的 HTTP provider fixture 测试协议，真实账号联调单独记录。

验收：频道权限/撤销/只读策略有效；凭据不回显；跨群文件和会话不串；重复请求不重复启动；运行结果能进入现有群聊。没有供应商凭据时只能称协议测试通过。

### M2：主动唤醒与代码协作写入

实现 durable dispatcher、超时恢复、预算、MCP 2.0 Events 签名订阅；再加入 GitHub App 按仓库授权、独立任务分支、多文件 commit、draft PR、diff 阅读、review 和冲突检查。

验收：Agent A 提交分支，Agent B 读取评审，人类查看 PR；断线和重复 webhook 不重复付费运行或写入；无自动 main 覆盖。

### M3：macOS / Windows 发行候选

支持 macOS ARM64 / x64、Windows x64 手动构建。逐个平台验证安装、sidecar 生命周期、凭据存储、群聊、文件选择/上传、通知、退出与升级。缺少本机环境、Apple/Windows 签名时如实标记“未签名预览 / 未实机验收”，不声称已发布正式安装包。

### M4：更多平台及生产运维

Muse Connector 审核、Grok Bot / dot 真账号联调、A2A 确定版本适配、团队授权、用量面板、备份恢复与文件保留策略。正式云部署需要用户选择服务账号和域名；不自动创建付费资源。

## 7. 验证与成本约束

优先本地类型检查、单元与 Worker 集成测试。重点验证权限、加密、端点校验、密钥脱敏、幂等、并发、跨群隔离、失败状态和文件投递，不用只有界面快照的测试冒充端到端联调。

GitHub Actions 默认不自动启动大矩阵；手动选择单个平台打包，配置 timeout、concurrency 和短 artifact 保留期。不得定时重试、提交循环触发发布或默认运行 macOS 全矩阵。

参考：[Tauri architecture](https://v2.tauri.app/concept/architecture/)、[Windows installer](https://v2.tauri.app/distribute/windows-installer/)、[GitHub App installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)、[GitHub concurrency](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)。

## 8. 交付记录原则

交付时分别列出：已写代码、实际运行的测试、真实账号验证、真实平台构建、远端 fork/commit/PR、尚未完成的里程碑。功能 catalog 仅表示平台能力研究，不能作为接入成功证据。所有发布步骤以 GitHub 返回结果为准。

## 9. 实施后的更新（2026-10-21）

以上是开发前保存的计划，保留原始决策以便审阅。实施中根据接口实证作出以下收敛与提前实现：

- **M0、M1 已形成开发预览代码并完成本地验证**：独立 fork 配置、来源感谢、云连接、运行记录、群文件、仓库读取、群级 MCP 与协作空间 UI。验证结果见 [commons-validation.md](commons-validation.md)，不等同于真实供应商账号或桌面发行验收。
- **Manus 比初始计划更严格**：实际官方消息结构不能可靠关联某次群任务与并发私人回复，因此没有实施 `listMessages` 正文回流；成功只表示 `submitted` 消息投递。个人主会话与群组的绑定即使连接撤销后仍保留，避免复用会话造成跨群泄露。
- **M2 的代码提案闭环提前完成**：Agent 可以读取精确 commit 的目录/文件，提交不可变文件修改；人类房主审阅原文、目标内容和摘要后，以一次性写凭据发布独立 `agentparty/<proposal-id>` 分支与草稿 PR。已覆盖冲突、未知结果恢复和重复发布；没有加入自动合并。GitHub App 安装授权仍是后续工作。
- **跨品牌完整接入仍有明确工作量**：通用单群 Bearer MCP 是基础；dot 的 OAuth 与 MCP Events、Muse/Grok 账号侧设置、审核和真实调用尚未完成。目录与 UI 保持该状态，不宣称已经接通个人账号。
- **M3 目前只有可审查的构建配置**：macOS ARM64/x64、Windows x64 的单平台手动工作流已写入，未触发远端构建，尚无正式签名安装包或实机验收。
- **下一步顺序**：先完成拥有真实账号的 Hermes/Manus 与 GitHub 验收，再实现 OAuth/持久派发/预算与 Events，随后完成逐平台原生构建和系统集成，最后进行多品牌账户审核与生产运维。每步均以实际返回结果和可复现检查记录推进。
