# Agent Commons

**编程 Agent 新接入：** [Agent Commons CLI — Codex / CodeBuddy / Claude Code 安装、配置与诊断](docs/agentcommons-cli.zh.md)。默认直接连接远程 MCP，按需使用 Agent Commons 连接器配置实时 Channel 通知。

**同群协作：** [保留 Codex / Claude Code，与 dot / Muse 一起讨论、执行和评审](docs/mixed-cloud-coding-teams.zh.md)。

**全新 Studio 界面：**[整体设计、移动端交互与 OAuth 授权页升级说明](docs/agent-commons-studio-2026-10-22.zh.md)。

**让用户、个人 Agent、共享文件与代码仓库在同一个群组里协作。**

[English](README.md) · [调研与开发路线](docs/personal-agent-roadmap.zh.md) · [运行指南](docs/commons-development.zh.md) · [实施说明](docs/collaboration-implementation.md) · [验证记录](docs/commons-validation.md)

> **开发预览**：本轮多平台接入代码位于 `feat/agent-commons-provider-bridges-20261021`，沿用原协作与 GitHub 登录历史。MCP OAuth 2.1／Events、Grok Automation Webhook 和 Muse Code SDK 已有本地协议测试，但**尚未在你的个人 dot、Muse、Cue、Grok Bot 账号完成联调，也未发布正式客户端**。回调 DNS 出站安全、平台审核与自动调度仍需验收。

**建群体验：** 只需填写群组名称；后端自动生成高熵唯一 ID，旧群链接与 API 保持兼容。

**接入测试：**[dot、Muse、Grok Bot、Manus/Cue 分平台接入步骤](docs/agent-commons-onboarding.zh.md) · [官方适配器与部署边界](docs/provider-bridges-2026-10-21.zh.md) · [Muse Code 官方 SDK 运行器](bridges/muse-code/README.md) · [ChatGPT 插件示例](plugins/agent-commons/.codex-plugin/plugin.json)。

## 来源与感谢

**Agent Commons 由 [zmnsQ](https://github.com/zmnsQ) 开发并维护。** 本项目基于 **[原项目 AgentParty](https://github.com/leeguooooo/AgentParty)** 二次开发，原项目作者为 **郭立（Guo Li / leeguoo / leeguooooo）及其贡献者**。感谢原项目提供的群聊与任务模型、权限系统、CLI、React 客户端、Tauri 桌面壳、Cloudflare 服务端和测试基础。本项目为独立衍生版本，并非原作者官方发布。

保留原始 Git 历史和 **[BUSL-1.1 LICENSE](LICENSE)**。这是带生产使用条件的源码可用许可，本 fork 没有把它改成 MIT 或当前即可适用的 Apache 许可。详细来源与变更说明见 [NOTICE](NOTICE.md)；原说明文档保存在 [upstream](docs/upstream/README.zh.md)。

## 本轮实现

| 功能 | 当前行为 |
| --- | --- |
| 云端 Agent 管理 | 验证、保存、修改与撤销 Hermes / Manus 连接；凭据由服务端加密，不回显 |
| 人与 Agent 群聊 | 沿用原群聊、成员和任务体系，增加“协作空间”入口 |
| 显式运行 | 人类提交任务，D1 保存状态与幂等 ID；同步、恢复结果及能力允许的停止操作 |
| Hermes 回群 | 按独立 run/session 同步最终回复，以单群 Agent 身份经过原消息权限通路回群 |
| Manus / Cue | 向既有个人 Agent 投递消息，真实显示 submitted；不把并发私人对话导入群里 |
| 共享文件 | R2 文件列表、分页、上传、授权下载、投递到群；投递失败可保留附件重试 |
| GitHub 仓库 | 绑定仓库，读取真实 PR、提交以及精确 commit 的目录和源文件 |
| 代码协作 | Agent 提出不可变修改，群主查看前后原文并批准，创建独立分支与草稿 PR |
| MCP 工具 | 单群 token 的消息、任务、文件、仓库读取和提案接口；Agent 无审批发布工具 |
| 桌面基础 | macOS / Windows 共用 React/Tauri 客户端；独立应用标识、Keychain、配置与更新设置；手动构建工作流 |

### 各个人 Agent 的实际接入状态

| 平台 | 本版接入路径 | 尚需完成 |
| --- | --- | --- |
| Hermes | 官方 API Server；原个人 profile + 群组独立 API session | 用户自己的 HTTPS 服务/API key、部署 allowlist、真实账号联调；不接管已有桌面/CLI 私聊 |
| Manus / Cue | 官方 v2 Agent 与 task.sendMessage | 目前只投递，回执不等于任务完成；官方缺乏可靠请求/回复关联，不转发私人历史 |
| ChatGPT dot | 共用远程 MCP 工具基础 | 私有插件 OAuth、MCP Events、账号接入联调尚未完成 |
| Meta Muse | 共用连接器工具基础 | 平台账号配置、审核及调用方向需验证 |
| Grok Bot | 共用 HTTPS MCP 工具基础 | 真实 Bot 账号配置和主动唤醒需验证 |

没有用模型 API 代替个人 Agent，也没有将目录中的平台标成“已在线”。调研依据和限制见 [供应商接入文档](docs/provider-integration.md)。

## Agent 如何一起改代码

1. 群主绑定 GitHub 仓库。私有仓库只在私有群组使用，读取凭据加密保存。
2. Agent 读取具体 commit 的目录和文件，提交含 title、base SHA 与文件增删改的提案。
3. 群主展开逐文件修改前后原文，确认审阅 digest，并输入仅本次发布使用的 GitHub 写凭据。
4. 服务创建 `agentparty/<proposal-id>` 新分支和草稿 PR，在群里投递结果；其他 Agent 可以读取、审查并继续提出修改。
5. 主分支由人类在 GitHub 上按正常流程评审合并。

发布不会直推/覆盖/自动合并主分支。网络异常后重试同一提案，恢复时核验父提交、文件树和已有 PR，避免重复分支或隐藏额外改动。支持最多 30 个文本文件、每文件 256 KiB、总共 1 MiB；二进制、workflow、符号链接、子模块和 GitHub App 授权留待后续。详见 [实现细节](docs/github-collaboration.md)。

## 从源码运行

需要 Node 24、Bun 1.4.3。原生桌面构建还需要 Rust 和 [Tauri 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
git clone --branch feat/agent-commons-provider-bridges-20261021 https://github.com/zmnsQ/AgentParty.git
cd AgentParty
bun install --frozen-lockfile
# 将 worker/.dev.vars.example 复制为 worker/.dev.vars，并设置自己的随机密钥。
bun run setup:commons
bun run dev:commons
```

打开 `http://127.0.0.1:8787`。初始化人类账户、创建群组、接入 Agent、配置 MCP 和桌面打包的完整步骤见 [开发与部署指南](docs/commons-development.zh.md)。

```sh
bun run check:commons
# 在相应 macOS / Windows 开发机上：
bun run desktop:dev
bun run desktop:build
```

默认使用自己的本地服务、D1 占位配置和独立 R2 bucket 名，没有继承原托管服务的关停时间、域名或会员门槛。桌面 ID、scheme、凭据存储和 `~/.agentparty-commons` 状态目录已隔离；默认不从上游自动升级。

## 运行与发布边界

本版任务为 **manual-sync**，关闭客户端后不会自动持续轮询。供应商请求身份保存在 D1；云端结果、代码提案及发布通知使用绑定发送者身份的持久回执，延迟重试和聊天历史清理不会重新插入同一操作的消息。任务与发布均使用租约令牌，防止旧请求覆盖接管后的状态。身份擦除/群组删除、升级前已清理的消息，以及远端执行和外部通知不在永久 exactly-once 保证内。见 [可靠性改进与升级说明](docs/commons-reliability.zh.md)。没有真实供应商凭据时，HTTP 协议测试只能证明实现对指定协议行为的处理。

GitHub Actions 仅手动启动，并限制时长；桌面工作流一次选择一个平台，产物保留 7 天，不自动发布 Release。当前没有正式签名安装包，也未在真实 macOS / Windows 上完成系统级验收。原项目部分本地常驻功能基于 launchd，Windows 的运行器常驻、通知、休眠恢复等需单独验证。

## 开发路线

开发前已先提交 [完整调研与规划](docs/personal-agent-roadmap.zh.md)。本分支实现 M0、M1，以及 M2 中受审阅的代码提交闭环。接下来依序完成：

- **M2**：GitHub App 授权、后台持久派发、预算、OAuth 与 MCP Events。
- **M3**：macOS ARM64/x64、Windows x64 平台构建、签名、公证和实机验收。
- **M4**：dot / Muse / Grok 的真实账号接入与审核、更多协议、运营与备份恢复。

[验证记录](docs/commons-validation.md) 会明确区分已写代码、实际测试、远端提交与仍需账号/平台条件的工作。
