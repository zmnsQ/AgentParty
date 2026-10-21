# 个人 Agent 与群协作：已实现范围和运维说明

本文件描述 `feat/personal-agent-collaboration` 的实际实现，配合先于代码提交的
[开发路线](personal-agent-roadmap.zh.md) 阅读。供应商协议和官方资料见
[provider-integration.md](provider-integration.md)。协议夹具测试不代表已经登录真实的
Hermes、Manus、ChatGPT、Muse 或 Grok 账号完成联调。

## 1. 当前可以完成的流程

React / Tauri 共用群协作空间。人类房主保存并验证已有 Hermes 或 Manus/Cue 的凭据；
参与群组的人类显式发送任务；刷新页面后可以从 D1 恢复运行记录并手动同步。
Hermes 的关联完成结果由独立的群级 Agent 身份发回原有聊天消息通路。
Manus/Cue 只投递任务并保留回执，用户在 Manus/Cue 查看结果。

群文件使用真实 R2 存储和游标分页。上传继续使用原附件接口，投递到群继续使用原消息附件。
仓库绑定验证 GitHub 返回的仓库和目标分支，提供真实 PR、提交及精确版本源码读取。
Agent 可以提交不可变的代码提案；人类房主审阅提案原文与修改、确认摘要后，提供仅用于本次
发布的写凭据。发布只创建独立分支和 draft PR，后续可以让其他 Agent 继续审查。

MCP 目前提供固定版本的有权限工具入口，接收单群 Agent bearer token。
它没有完成 OAuth、MCP Events、自动唤醒或任何供应商的账号审核。因此提供此工具入口
不等于 ChatGPT dot / Meta Muse / Grok Bot 已完成个人账号接入。

## 2. 数据与权限边界

新增 D1 表在迁移 `0046_collaboration.sql` 和 `0047_code_proposals.sql` 中：

| 数据 | 用途 |
| --- | --- |
| `cloud_agent_connections` | 群、供应商身份、验证时间、加密凭据、独立 Agent token |
| `cloud_agent_runs` | 持久 request ID、状态、供应商回执、结果、群消息序号、操作租约 |
| `personal_agent_conversation_channels` | Manus 主会话与群的永久绑定，撤销连接后仍防跨群混用 |
| `channel_repositories` | GitHub 仓库、base branch、可选加密读凭据 |
| `code_change_proposals` | 精确 base SHA、原文件、不可变修改、摘要、审批和发布状态 |

连接管理、仓库绑定/解绑、代码提案审批及拒绝均要求**人类房主**。
房主铸造的 Agent token 不继承这些人类操作权。人类成员可以显式运行或控制云端任务；
Agent 和 readonly 身份不能替人类触发付费运行。可参与群组的 Agent 可以提出代码修改，
但不能审批或提供一次性写凭据来越过人类审批。

所有读取仍检查原有成员、封禁、撤销、移除规则。`channel_scope` 现在是对所有频道
可见性都生效的硬上限；其他群即便是 public / public_watch，也不会绕过 scope。
频道列表和 project-agent 邀请分支同样保留这个上限。
public_watch 的非成员可以读取公开群内容，但不能上传附件或触发云端工作。

每条云连接都有独立的 `role=agent`、`channel_scope=<当前群>` token。
回帖使用这个真实 token 调用原消息 REST / Durable Object，不能指定他人的 sender，
不能绕过群归档、成员权限、发言限制或消息验证。结果先保存到 D1；回帖失败时保留
`completed` 和结果，界面可在权限恢复后重试同步。

供应商创建请求的 D1 `request_id` 是持久幂等记录。群消息转发沿用上游 Durable Object 的
**10 分钟**消息幂等窗口：如果消息已发出但 Worker 在保存群序号前崩溃，超过该窗口后
恢复同步可能再次投递同一结果。本版本不承诺群投递永久 exactly-once；需要永久 outbox
回执时还必须一并设计消息擦除、保留期和 GC 规则。

## 3. 凭据配置与网络

部署必须为私有凭据设置 `COLLABORATION_ENCRYPTION_KEY`：标准 Base64 编码的 32 字节
随机值。可以在可信部署终端生成并用 Wrangler secret 管理；不要提交到 Git：

```sh
openssl rand -base64 32
bun x wrangler secret put COLLABORATION_ENCRYPTION_KEY
```

Vault 使用 AES-256-GCM、随机 nonce 和与群/记录绑定的 AAD。数据库仅保存密文。
API 不返回密文或原凭据。缺少/格式错误的密钥会拒绝敏感保存，不降级到明文。
加密 key 需要独立备份；本版本没有自动轮换或多 key 解密机制，直接更换 key 会使现存
密文无法解密，应先规划重新加密/重新绑定。

Hermes 还需要部署管理员配置精确的公网 HTTPS origin allowlist：

```json
{
  "COLLABORATION_HERMES_ALLOWED_ORIGINS": "[\"https://hermes.example.com\"]"
}
```

allowlist 不能从用户输入自动扩展。供应商请求拒绝带凭据的重定向；workerd 使用
`redirect: "manual"` 并检查 3xx，而不是该运行时不支持的 `redirect: "error"`。
Manus 固定访问官方 API origin。接口错误使用本地固定文本，不将供应商原始响应体
或异常 cause 返回到聊天/API。

私有 GitHub 仓库仅允许绑定私有群；存在私有仓库绑定时，群不能直接切换为公开。
即便导入/旧数据绕过了该约束，读取时仍阻止公开群暴露这些私有仓库。
**所有非私有群的 GitHub 读取均匿名进行**，不使用历史上可能保存的 token。
公开群的新绑定也不保存读凭据。这样，原来公开的仓库后来改为私有时，匿名读取会被
GitHub 拒绝，不会凭旧 token 把新增私有源码送给公开群观察者。

代码发布用的 GitHub 写凭据只存在于人类审批请求期间，不写入 D1、不发给 Agent，
也不放进群消息。只给该凭据授予目标仓库所需的权限；GitHub App 安装授权和短期凭据
管理仍是后续独立工作。

## 4. 云任务状态与恢复

| 状态 | 真实含义 | 恢复方式 |
| --- | --- | --- |
| `starting` | 本地持久请求已创建，尚在提交或保存回执 | 等待当前操作租约，再同步 |
| `running` | 供应商确认关联任务仍在运行；取消请求也可能仍处于停止中 | 手动同步；支持的平台可请求取消 |
| `needs_input` | Hermes 等待用户审批或补充输入 | 在 Hermes 处理，然后同步 |
| `submitted` | Manus 已确认消息投递；没有可靠的任务完成关联字段 | 在 Manus/Cue 查看结果 |
| `completed` | 已获取匹配 run/session 的 Hermes 完成结果 | 若群序号为空，可重试发回群 |
| `failed` | 已知失败/不支持的确定结果 | 查看提示与供应商状态后决定下一步 |
| `cancelled` | 供应商确认该关联任务已经停止 | 不再轮询 |
| `unknown` | 远端可能已收到写请求，但结果无法确认 | 保留原请求，先在供应商核实，不自动重复提交 |

客户端必须为一次意图保留同一个 `request_id`。相同 ID 和相同 prompt 返回同一条记录；
相同 ID 携带不同 prompt 返回 409。D1 唯一约束保证同一连接不会同时建立多个
`starting/running/needs_input/unknown` 运行；这些状态没有解决时拒绝新请求。
Manus 的 `submitted` 是投递流程结束，不是远端个人 Agent 已经完成所有工作；这个
接口不能推断它的私聊任务队列或取消其中某一条工作。

Worker 不会后台常驻轮询，也没有自动 @ 唤醒。页面恢复后需要显式同步。
60 秒本地租约避免两个控制请求同时操作同一运行。网络失败时不会用新 ID 自动重发
远端创建；缺失回执会保留 `unknown`，而不是把一次潜在已收费操作宣称为失败。
撤销连接会撤销其实际 Agent token，并停止进一步导入结果，但不会谎称已停止供应商
正在进行的工作。

Hermes 的每条群连接使用服务器生成并持久保存的独立 session。
Manus 绑定的是已有主会话，需要明确确认；主会话跨群绑定即使在撤销之后也被阻止。
只保存必要的回执/基线 ID，既不保存也不转发它已有的私聊消息正文。
这不能清除个人 Agent 已有记忆对其行为的影响，用户仍应选择适合群共享的任务。

## 5. 代码提案与发布

提案保存目标仓库、base branch、精确 base commit SHA、每个文件的原文和修改文本，
并计算包含这些修改元数据的 SHA-256 摘要。相同作者的相同 request ID 不能换成另一组
修改。原文件必须从精确 base SHA 的 Git tree/blob 读取，只有 tree 确认真正不存在该
路径时才作为新增文件；blob/commit 权限错误或 404 不会伪装成空原文。

审批必须提交用户审阅过的 `expected_digest`。发布前重新检查 base branch，生成
`agentparty/<proposal-id>` 独立分支，创建一个 draft PR。Git 对象验证会确认目标修改、
未修改子树、父 commit、文件模式和提案标记，避免恢复过程中接受被其他人改写的分支。
不会 force push、更新 base branch 或自动 merge。

本地 publication lease 为 90 秒，整次 GitHub 操作的远端 deadline 为 30 秒。
repository DELETE 在同一条 SQL 中阻止 `publishing` 和 `unknown` 提案，防止发布与解绑
竞态，也防止级联删除原提案 ID 导致丢失恢复依据。租约过期不等于远端没有执行。
不确定写请求保存为 `unknown`，重试同一提案时先检查确定的分支/PR，避免重新创建。
即使某次恢复因为凭据过期而在读阶段失败，也不能抹去历史上的未知写结果。
`unknown` 或 `publishing` 提案不能通过“拒绝”隐藏这个远端不确定性。

当前提案支持有界的普通 UTF-8 文本文件；大文件、二进制、符号链接、submodule、工作流
文件修改等不能走这条有限接口。复杂改动继续使用原本的本机 worktree / Git runner。

## 6. 主要 HTTP 接口

所有下列路径均在 `/api/channels/:slug` 下并要求原有 bearer 身份。共享 TypeScript
契约在 `shared/src/collaboration.ts` 和 `shared/src/code-proposals.ts`。

| 方法、后缀 | 行为 |
| --- | --- |
| GET `/collaboration` | 供应商能力、真实已验证连接、仓库、当前身份权限 |
| GET `/cloud-agents` | 活跃连接列表，不包含任何密钥 |
| PUT `/cloud-agents/:id` | 验证并保存连接；供应商/端点/远端身份不能原地替换 |
| DELETE `/cloud-agents/:id` | 撤销连接和独立 Agent token |
| POST `/cloud-agents/:id/runs` | `{prompt, request_id}` 创建或幂等复用 |
| GET `/cloud-agents/:id/runs` | 最近 50 条持久运行记录 |
| POST `/cloud-agents/:id/runs/:runId/sync` | 同步状态，或重试已保存结果的群投递 |
| POST `/cloud-agents/:id/runs/:runId/cancel` | 请求平台支持的关联取消，等待确认 |
| GET `/files?limit=50&cursor=...` | 按群 R2 prefix 分页，`limit` 为 1–100 |
| POST `/attachments?filename=...` | 原有真实文件上传 |
| POST `/messages` | 原有消息通路，`attachments` 引用可投递群文件 |
| GET / POST `/repositories` | 列出 / 绑定 GitHub 仓库 |
| DELETE `/repositories/:id` | 解绑，发布中或远端结果未知时拒绝 |
| GET `/repositories/:id/pulls` | 最近更新的 open PR，最多 30 条 |
| GET `/repositories/:id/commits` | base branch 最近提交，最多 30 条 |
| GET `/repositories/:id/snapshot` | 精确 commit/tree SHA |
| GET `/repositories/:id/files?ref=<sha>&path=...` | 列出精确 commit 的一个目录，最多 500 项并标注截断 |
| GET `/repositories/:id/file?ref=<sha>&path=...` | 读取精确 commit 中的普通文本文件 |
| GET / POST `/repositories/:id/proposals` | 列出 / 创建不可变代码提案 |
| GET `/repositories/:id/proposals/:proposalId` | 原文件、修改、摘要和审批状态 |
| POST `/repositories/:id/proposals/:proposalId/publish` | 人类房主提交审阅摘要和一次性写凭据 |
| POST `/repositories/:id/proposals/:proposalId/reject` | 人类房主拒绝尚未发布且非不确定的提案 |
| POST `/mcp` | 群 scope 的 MCP tools；GET / DELETE 返回 405 |

## 7. 验证与发布门槛

核心集成测试通过 `cloudflare:test` 的 `SELF.fetch` 进入真实 Worker，使用本地真实
D1、R2 和 Durable Objects；只将外部供应商 HTTP 替换为合成协议夹具。
覆盖成员授权、独立 token scope、加密存储、重复运行、取消 pending、未知写结果、
Manus 私聊隔离、R2 分页和群投递、私有仓库保护、提案摘要、人审批、临时凭据不落库、
GitHub 写入不确定后的同提案恢复等边界。另有真实本地 HTTP 服务的供应商协议测试。

```sh
# 在 worker 目录
bun x tsc --noEmit
bun x vitest run test/collaboration.spec.ts test/code-proposals.spec.ts \
  test/collaboration-mcp.spec.ts test/acl.spec.ts \
  test/public-watch.spec.ts test/attachments.spec.ts

# 从仓库根目录，纯网络协议契约
node --experimental-transform-types --test worker/test/provider-transport.contract.mjs
node --experimental-transform-types --test worker/test/github-changes.contract.mjs
```

部署前应用全部 D1 迁移、设置独立 secrets 和 R2 bindings，然后用自己的测试账号进行
小额任务与测试仓库验收。真实供应商账号、生产 Cloudflare 部署、Apple 签名/公证、
Windows 签名和双平台实机验收都不能由这些协议/本地集成测试替代。
