# Agent Commons：独立衍生项目定位与发布边界

## 对外身份

- 产品名称：**Agent Commons**。
- 独立开发维护者：**zmnsQ**。
- 当前代码仓库：`https://github.com/zmnsQ/AgentParty`。仓库技术名称尚为 AgentParty，不代表产品继续使用上游品牌，也不要求为了改品牌立即迁移仓库。
- 本项目基于 **Guo Li（郭立 / leeguoo / leeguooooo）及贡献者的 AgentParty**。保留上游源码历史、版权、[许可证](../LICENSE)、[NOTICE](../NOTICE.md)及[上游 README 存档](upstream/README.md)。不宣称全部代码原创，不暗示上游官方发布或背书。
- 继承的 BUSL-1.1 条款保持原样。本次定位调整不是重新许可，也不修改许可证中的原作者或 Licensed Work。

## 自己的 main，而不是上游发布通道

本项目以 **zmnsQ/AgentParty 的 main** 作为经过审核的发布集成分支。功能分支用于开发与验收，不再把某个历史 `feat/*` 或 `codex/*` 分支永久当成产品身份。

这是发布策略，不是“已经推送或部署”的声明。进入 main 前仍需：

1. 检查远端最新引用及待合入提交关系，保留其他工作；不得 force push 覆盖他人更新。
2. 记录完整目标提交 SHA、测试范围、已知未验项、迁移需求与回滚版本。
3. 集成代码、构建产物发布、生产部署分别按用户授权执行；main 更新不自动等于生产上线。
4. 部署提示词引用本项目实际可获取的分支和不可变提交；确认脚本没有硬编码旧分支/旧 SHA，保留生产数据和必要迁移。
5. 协议/API 测试通过不等于个人账号端到端接通；桌面安装、密钥链、平台授权等需实际环境验收。

### 本轮只读分支观察（2026-10-28）

以下是**本机已存在的 refs**，本轮没有 fetch，因此不保证等于当前 GitHub 状态：

- `origin/main`：`25384eca99b24ed823ab54b4e850a0c9079a3b24`。
- 当前工作树 HEAD：`65cdfca08a2454ebfbc5bff3474f221f691120a8`。
- 本地 merge-base 等于上述 main；`origin/main...HEAD` 左右提交数为 `0 / 63`，即本地已知 main 是 HEAD 的祖先。
- 本地 `origin/codex/web-design-system`：`3589d6a8fc144e6d09cfc718f986fedce297e21c`，同样可能陈旧。

因此不能把新的 README main 用法当成“新代码已在远端 main”的证据；发布执行者必须核验实时远端后再决定正常快进或合并。本文没有执行任何引用更新。

## 不得因品牌统一而盲目改名的兼容标识

| 标识类别 | 保留原因 / 正确迁移前提 |
|---|---|
| `zmnsQ/AgentParty` 仓库名、已有 Git URL 和发布链接 | 影响 clone、issue、安装器、引用及用户书签；仓库重命名须独立确认与重定向验证 |
| npm/workspace 包名 `agentparty-commons`、`@agentparty/*`、代码 import | 是构建及依赖标识，不是 UI 品牌；全局替换会破坏解析和现有工具 |
| `party`/`agentcommons` CLI 命令、旧配置目录与身份存储 | 涉及已安装客户端、账户凭据及驻留会话；应做显式兼容/迁移，不能删改用户身份 |
| HTTP API 路径、MCP tool 名称、OAuth issuer/client/scope/redirect URI | 属于已授权客户端协议契约；改名可能使现有授权和会话失效 |
| 数据库表/字段、迁移编号、事件类型、任务和群组稳定 ID | 历史数据与幂等协议依赖；需版本化迁移而非品牌替换 |
| Tauri bundle ID、deep link、keychain namespace、desktop updater/安装器路径 | 关系到系统识别和安全凭据；需平台升级与旧版兼容验收 |
| 服务器域名、服务名、systemd/目录/部署脚本、环境变量 | 属于真实运行配置；文案修改不授权切换网络、凭据或生产部署 |
| LICENSE/NOTICE/上游作者、历史版权头和 Git 历史 | 必须保留真实来源与法律声明，不是“漏改品牌” |

README 和新产品说明可以统一 Agent Commons 名称，但旧的技术 namespace 不应被误判为未完成二次开发。历史发布/部署文档应保留时间和版本上下文，执行时以当前获批发布记录为准，不直接运行其中固定旧 SHA 的命令。
