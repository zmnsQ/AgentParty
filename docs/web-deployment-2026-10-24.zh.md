# AgentCommons Web 统一界面部署记录

2026-10-24（Asia/Shanghai）。用户明确授权依据此前维护对话直接部署至现有服务端。

## 已上线

- 站点：<https://agentparty.402887.xyz>
- 程序与前端提交：`bae4b5cf17e99d35b5f60c9057aa9a2ab151b87b`
- 维护分支：`codex/web-design-system`，已推送至 `zmnsQ/AgentParty`。
- 版本：`agent-commons-web-20261024`，CLI 保持 `0.2.0`。
- 当前目录：`/opt/agentparty-commons/releases/agent-commons-web-bae4b5cf17e9`。
- 发布包 SHA-256：`43e442e90af3e655b24f8fa40e5c28ced4887f92d0f7f532d7d2dcc57088c73e`。

部署前实际核对原程序为 `e885d57e`，前端为 `010d406a`，当前目录为 `progressive-blur-010d406`。新版将原 UI 改造 `d6077d28` 与最新维护分支合并，保留手机聊天优先布局、群组抽屉、原生 Muse OAuth、HTTPS 回跳、Codex/CodeBuddy 直接 MCP 接入、可见的安装/升级命令、CLI 0.2.0、实时推送和渐进模糊。桌面继续提供可折叠工作区与工具，手机使用统一的群组功能菜单。

相对原线上后端，唯一生产 Worker 源码变化是 OAuth 页品牌图、同源图片 CSP 和样式版本。原 HTTPS、MFA、授权范围、事件推送语义保留。没有数据库迁移，没有自动创建授权、消息、订阅或个人客户端会话。

## 备份与切换

发布脚本：`deploy/vps/deploy-release.py`。脚本固定旧版本，校验归档及每个文件的 SHA-256，复制旧发布目录并保留配置、迁移、运行时和持久化软链，随后替换程序和静态文件。保留 23 个不冲突的旧哈希资源，供已打开页面继续加载。

停主服务后完成一致性数据备份：

`/var/backups/agentparty-commons/release-bae4b5cf17e9-vshs8doa/state-before.tgz`

备份 SHA-256：`4a079c7fe55522baa37489a0cd9d8ccafd1d05164b3c2c2866515a616a1a2cab`。

同目录 `deployment.json` 记录 `status: verified`、前后版本、包/备份校验和及保留资源。`current` 以原子软链切换。主应用、事件服务、Tunnel 均 active/running，NRestarts 为 0；事件服务与 Tunnel PID 保持不变。凭据未读取或替换。

自动验收失败会恢复旧程序，且不回退数据库。人工回退目标为 `/opt/agentparty-commons/releases/progressive-blur-010d406`：应先停止主应用、原子切回 current、启动并核验原 Worker `e885d57e`。本次无迁移，通常无需恢复数据快照。

## 验证

- Web：342 项通过，类型检查及生产构建成功；控件合并另有 38 项聚焦检查通过。
- Worker：默认检查共 288 项（旧样式版本断言更新后，相关 32 项全部重跑通过），另加实时 SSE / 原生 Muse OAuth 21 项，共 309 项通过；类型检查成功。
- CLI 0.2.0：29 项通过；HTTP 合约 53 项通过；既有 CLI、配置/迁移编号、Muse Code、事件网关、Muse Cloud 检查均通过。
- 使用项目现有 Wrangler 进行仅构建的 dry-run，按官方命令文档核对 `--dry-run`、`--outdir`、`--define`，未对 Cloudflare 账户进行部署或创建资源。检查运行使用 Node 24；主机全局 Node 26 已移除旧测试脚本的实验参数，因此未用于这组测试。
- 完整 App 合成检查 19 项通过：桌面/手机、明暗主题、折叠偏好、MFA、任务/团队/连接/文件/提案/设置、抽屉与功能菜单、空/加载/失败/长标题、减少动效。浏览器错误、外部请求、写请求均为零。
- Codex/CodeBuddy 接入 4 组通过；渐进模糊 5 组通过，覆盖 320–1440px、中英文、明暗、高对比。手机消息区域占 72–79%，输入框 58px。
- 公网本机与域名 `/api/health` 都返回新提交；GitHub session `configured: true`；OAuth issuer 正确；匿名 `/api/channels` 与 `/oauth/grants` 仍为 401。
- 公网入口、关键样式、Logo、CLI、主入口资源和保留的旧资源均与发布包/旧包校验和一致。
- 全新无登录浏览器实测 390px 与 1440px 的登录和 OAuth 错误页：品牌图加载、HTTPS 登录地址、CSP 和页面宽度检查通过。OAuth 无参数请求的 400 为预期错误页检查。

证据位于 `docs/validation/web-deployment-2026-10-24/`：`workspace.json`、`coding-agents.json`、`progressive-blur.json`、`public-browser.json` 及截图。登录页截图来自真实公网；聊天和首页截图使用本地合成数据。

此验收不代替个人 GitHub/MFA 登录、真实 CodeBuddy/Codex 会话自动处理或真实手机全流程验收；本次未向真实群发送消息。构建仍有既有大入口包提示，未新增动画库。
