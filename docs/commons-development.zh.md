# AgentParty Commons 开发与部署指南

这是独立 fork 的开发预览，使用自己的服务地址与数据。当前没有正式签名的 macOS / Windows 安装包；不要把仓库里的构建配置当成已经完成的平台验收。

## 1. 获取代码与运行环境

```sh
git clone --branch feat/personal-agent-collaboration https://github.com/zmnsQ/AgentParty.git
cd AgentParty
bun install --frozen-lockfile
```

本轮验证使用 Node 24 与 Bun 1.4.3。原生桌面构建另外需要 Rust 和 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)：macOS 需要 Xcode Command Line Tools；Windows 需要 C++ Build Tools 和 WebView2。

`bun run check:commons` 是本 fork 的当前验证入口：供应商 HTTP 契约、Worker/D1/DO/R2 集成、权限回归、前端交互、类型检查和生产网页构建。`check:upstream` 保留原项目完整检查脚本，包含原项目的发布工作流、安装器和文案约束，需随 fork 后续逐步迁移；它不代表本轮已经全部通过。

## 2. 启动自己的本地协作服务

将 `worker/.dev.vars.example` 复制为 `worker/.dev.vars`，填入自己生成的值。该文件被 Git 忽略。

| 变量 | 用途 |
| --- | --- |
| `ADMIN_SECRET` | 仅用于服务管理员初始化账户，不交给 Agent |
| `COLLABORATION_ENCRYPTION_KEY` | 32 个随机字节的 base64 编码，用于加密供应商和仓库读取凭据 |
| `ATTACHMENT_SIGNING_SECRET` | 短期文件下载链接签名 |
| `DESKTOP_PAIRING_SECRET` | 桌面与服务配对 |
| `COLLABORATION_HERMES_ALLOWED_ORIGINS` | 受部署者控制的 Hermes 公共 HTTPS origin 的 JSON 数组；默认 `[]` |

可在自己的终端中生成加密密钥：

```sh
openssl rand -base64 32
```

其他 secret 使用独立的随机值。保留加密密钥的安全备份；替换它会使既有加密凭据无法解密，需要重新连接。不要把真实密钥放进提交、截图或 Issue。

先构建页面并应用本地迁移，再启动服务：

```sh
bun run setup:commons
bun run dev:commons
```

本轮并发修复新增 `0048_collaboration_lease_fencing.sql`。已有部署应暂停新任务/发布并让旧请求结束，先备份、应用迁移，再启用新代码；不要长期混跑不检查租约所有权的旧写入者。迁移也会清除已撤销连接保存的凭据密文，历史审计记录保留。详见 [第二轮审查与升级说明](commons-hardening-2026-10-21.zh.md)。

服务只监听 `http://127.0.0.1:8787`。Wrangler 在本地模拟并持久化 D1、Durable Objects 和 R2；这不需要把用户数据发到原项目服务。更改数据库结构后重新运行 `bun run --cwd worker migrate:local`。

另开终端初始化一个本地人类账户：

```sh
bun --env-file=worker/.dev.vars cli/src/index.ts token create --server http://127.0.0.1:8787 --name local-owner --role human --owner you@example.com
```

输出中的人类 token 用于本地网页登录。打开本地页面，粘贴 token，创建私有群组。正式多人部署应配置自己的 OIDC 登录；不要分发管理员 secret。生成的普通 Agent token 与管理员 secret、人类 token 是不同的凭证。

### 从首轮预览升级：迁移 0048

本轮为任务与代码提案增加请求所有权字段，并清理已撤销连接的凭据密文。
先停止旧服务、备份数据，再执行 `bun run --cwd worker migrate:local`，最后启动新服务。
生产环境需先停止新的协作写入并排空旧版本请求，再按自己的环境执行迁移和部署；
不能让旧版（不检查所有权）与新版持续并行处理任务。
详见 [第二轮审查与升级记录](commons-hardening-2026-10-21.zh.md)。本轮没有代用户执行生产迁移。

本次沿用前序迁移 0048，另在每个群组的 DO SQLite 中幂等创建持久投递回执表，无需再增加 D1 迁移。
回执仅保存发送者身份、操作键、消息序号及时间，不复制消息正文或附件。普通历史清理不会删除回执，身份硬擦除会同时删除。
回滚到旧版会失去本轮防重保护；不要随意删除已写入的列和回执。详见 [持久投递与导出改进](commons-reliability.zh.md)。

## 3. 在群组内使用协作空间

打开群组中的“协作空间”，可切换“云端 Agent / GitHub 仓库 / 共享文件”。各项管理权限由服务端确认，界面隐藏按钮并不替代权限检查。

### Hermes

1. 在自己已有的 Hermes profile 上启用官方 API Server，并通过自己控制的 HTTPS 域名提供服务。
2. 将它的 origin 加入部署变量，如 `["https://hermes.example.com"]`。URL 中不能带密码、查询参数或任意内部地址。
3. 群主在连接表单选择 Hermes，填写名称、API endpoint、API key。
4. 人类成员显式提交一次任务，查看保存的 run 状态，点击同步；成功的最终结果会以专用单群 Agent 身份投递到原群聊。

这复用个人 Hermes profile 的能力，但为群组建立独立 API session，不接管已经存在的 CLI/Desktop 私聊。停止按钮表示请求停止，只有供应商确认取消后才显示已取消。`needs_input` 表示需在供应商处处理交互；本版尚无远程审批/clarification UI。

首版是 **manual-sync**：关闭客户端后不会由后台调度器持续轮询；重新打开后可以同步已经保存的任务。网络超时后的 `unknown` 不能被当成失败重新提交付费任务，应先在供应商处确认。

撤销连接现在会同时使旧请求的保存权限失效、撤销专用群 token，并清除当前连接记录中的凭据密文。
这不会取消已经开始的供应商任务，也不会撤销供应商 API key；需要时在供应商端处理。
客户端切换群组或账号时会清空旧协作面板、草稿和未保存凭据；上传中离开面板不会再自动开始后续群聊投递。

### Manus / Cue

使用 Manus v2 Agent ID 和 API key（或供应商提供的可信授权凭据），连接既有个人 Agent。界面要求确认个人上下文可能被用于回复。

本版仅保证**消息投递**，成功状态为 `submitted`。官方消息列表无法可靠区分“这个群组请求的回复”和同时发生的私人消息，因此不读取个人历史回流，也不停止整个个人主任务。请在 Cue 内查看结果；需要通过 MCP 回群时，另行配置并验证专门的单群工具连接。本版不会替 Manus/Cue 自动安装或验证该连接。

### ChatGPT dot / Muse / Grok Bot 与通用 MCP

服务提供 `POST /api/channels/<slug>/mcp`，使用 MCP `2025-06-18` 的无状态 Streamable HTTP JSON 响应。它要求一个专用、只作用于该群组的 `role=agent` token。

可由人类在现有 Agent 邀请流程创建 token，或由部署管理员在本地创建：

```sh
bun --env-file=worker/.dev.vars cli/src/index.ts token create --server http://127.0.0.1:8787 --name group-reviewer --role agent --owner you@example.com --channel-scope your-group
```

仅将这个受限 token 放入支持 Bearer 的 MCP 客户端配置；不要使用群主或管理员凭据。生产连接需要实际可访问的 HTTPS 地址。工具涵盖群消息、任务、文件、仓库快照/目录/文件、代码提案与 PR 状态。

**这还不是三个品牌的完整接入。** dot 的私有插件需要 OAuth；主动唤醒还需要 MCP Events 的订阅、回调签名及持久化派发。Muse、Grok 还需要账号侧连接设置/审核与真实账户验证。因此它们在目录中明确标为尚未完成，不显示虚假的在线状态。见 [平台接入研究](provider-integration.md)。

### 共享文件

网页/桌面沿用现有上传通道，单文件上限 25 MiB；群文件面板支持分页、下载和“投递到群聊”。上传成功但投递失败时保留附件，可重试投递，不必重复上传。MCP 的 base64 上传限制为 1 MiB，较大文件用客户端。

文件路径和签名下载链接受群组权限约束。群组内的文件与聊天内容是协作资料，不构成修改连接凭据、扩大权限或批准代码发布的授权。

### GitHub 代码协作

群主绑定 `owner/repo`。公开仓库可匿名读取；私有仓库只允许绑定私有群组，读取 token 经过服务端加密。私有仓库内容将提供给该私有群组有读取权限的参与者。

完整流程：Agent 读取当前快照及文件 → 提交不可变修改提案 → 群主展开逐文件修改前后内容并确认 → 输入仅供此次发布使用的写 token → 创建 `agentparty/<proposal-id>` 分支和草稿 PR → 其他成员/Agent 阅读真实提交和 PR。群里会出现提案和发布结果的消息。

读取 token 建议只授予目标仓库 Contents 读取权限及所需 PR 读取权限；批准发布时使用的 token 需具有目标仓库 **Contents 读写、Pull requests 读写**权限。发布 token 不持久化、不回显、不交给 Agent；更便捷的 GitHub App 授权列入后续里程碑。

提案每次最多 30 个 UTF-8 文件、单文件 256 KiB、总内容 1 MiB。只支持文本增删改；不编辑 GitHub Actions workflow、符号链接、子模块或二进制。原始文件从精确 base commit 获取并保存，不能把请求失败当成空文件。若 base 已变，准备新提案；不覆盖或合并主分支。

发布超时后应重试**同一提案**。恢复过程核对固定分支、父提交、完整树差异和已有 PR；不会用 force push 覆盖同名分支。`unknown` 状态在确认远端结果前不能拒绝提案或删除仓库绑定，恢复读取失败也不会把它降为普通失败。若基线或提案分支已经改变，可能需要维护者调查；本版尚无“确认未发布”的人工重置接口。详见 [GitHub 协作实现](github-collaboration.md)。

## 4. 运行 macOS / Windows 桌面端

保持协作服务运行，在满足 Tauri 依赖的相应平台上执行：

```sh
bun run desktop:dev
# 构建当前本机平台安装包
bun run desktop:build
```

桌面客户端连接明确选择的服务地址。本 fork 使用独立应用 ID `com.zmns.agentpartycommons`、`agentparty-commons://` scheme、凭据存储与 `~/.agentparty-commons` CLI 状态目录。上游应用的更新 feed 已禁用；CLI 自动升级默认关闭。旧 MCP 注册自动迁移也默认关闭，避免启动新 fork 时改写原来的注册。

云连接、群聊和共享文件采用公共 API，可复用同一界面。原项目的部分本地 Agent 常驻管理基于 macOS launchd；Windows 本地常驻/休眠恢复、各平台通知与 keyring、原项目 Claude Marketplace 插件兼容仍需实机验收，不能仅凭 Tauri 支持 Windows 就认定所有本地运行器能力相同。

### 手动构建与成本

`.github/workflows/commons-desktop.yml` 一次手动选择一个平台：macOS Apple Silicon、macOS Intel、Windows x64。超时 35 分钟，产物保留 7 天；不会发布正式 Release 或更新 feed。macOS 产物为 ad hoc 签名预览，Windows 产物未签名。本轮未触发这些远端构建。

`.github/workflows/commons-check.yml` 是 15 分钟上限的手动 Linux 验证。旧工作流移至 `docs/upstream-workflows`，不会自动部署或调用自动评论器。新工作流需出现在仓库默认分支后才方便从 Actions 页面手动启动。

## 5. 部署到自己的 Cloudflare 账户

部署前完成自己的账户选择、D1 数据库、R2 桶和域名配置。仓库中的 D1 ID 是本地占位符，不是可部署的云数据库。

```sh
# 在 worker 目录，登录自己的 Cloudflare 账户后
bunx wrangler d1 create agentparty-commons
bunx wrangler r2 bucket create agentparty-commons-attachments
```

将返回的数据库 ID 填入自己的配置，设置所需 secret（`wrangler secret put <NAME>`），配置 OIDC 和 Hermes allowlist，再应用远端迁移及部署。正式托管前还需要域名/TLS、备份恢复、文件保留、用量预算和平台账号联调。当前工作没有替用户创建云资源、付费服务、域名或平台授权。

### 升级到任务与发布租约加固版本

新迁移 `0048_collaboration_lease_fencing.sql` 为任务和代码提案添加请求所有权标识，并清空已撤销连接保存的凭据密文。升级已有实例前先暂停写入并排空旧 Worker 请求，再应用迁移、切换全部实例并恢复服务；旧代码不检查新字段，不应与新代码混跑。数据库字段清空不代表备份或供应商端凭据已销毁。

详见 [2026-10-21 加固与验证记录](commons-hardening-2026-10-21.md)。本轮完整检查在 macOS arm64 上通过 423 项，但这不是 Tauri 原生安装包或平台账号验收。

## 6. 验证记录与剩余工作

最新合并检查为 **463 / 463 项、28 个测试文件、退出码 0**。此前 408 / 423 / 429 / 442 项为历史记录；详见 [工作区隔离与最终验证](commons-workspace-isolation-2026-10-21.zh.md)。

[开发路线](personal-agent-roadmap.zh.md) 是开发前提交的研究与决策记录；[实施记录](collaboration-implementation.md) 和 [验证记录](commons-validation.md) 区分已实现、已运行测试与待真实账户/操作系统验证的内容。

本 fork 基于郭立 / leeguooooo 与贡献者开发的 AgentParty。原项目的 Git 历史及 BUSL-1.1 [LICENSE](../LICENSE) 保留，来源与感谢见 [NOTICE](../NOTICE.md)。
