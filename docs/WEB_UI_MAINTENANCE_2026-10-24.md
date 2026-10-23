# AgentCommons Web 界面维护 · 2026-10-24

> 后续部署整合：已合并维护分支的移动端聊天布局、原生 MCP、CLI 0.2.0、实时推送与渐进模糊；手机导航采用群组抽屉和右上角功能菜单。更新验证见 `docs/validation/web-deployment-2026-10-24/`。本文截图为最初独立 UI 预览。

独立维护目录：`/Users/zmns/Downloads/AgentCommons`。分支：`codex/web-design-system`。基于自有功能分支 `fix/mcp-connection-status-20261023` 的 `4938ff4da5b589cdc47fe4e1ac768af00199d2f2`，已经重新 fetch 核对。未使用旧 main 作为功能基线。

## 界面与结构

- 统一暖白、暖灰、陶土色与炭灰文字。`web/src/styles/tokens.css` 是颜色、尺度、圆角和动效的公共来源；浅色/深色继续沿用原有主题标识，保留已有偏好。
- `Brand.tsx`、登录/MFA、设备配对、邀请页、应用头部、favicon、Apple 图标与服务端 OAuth 确认页共用四 C 母版。欢迎插画已经复制进本仓库并缩放，无移动端目录的运行依赖。
- 工作区新增 `WorkspaceShell`：桌面侧栏可收起为窄栏，折叠偏好保存在设备本地；手机默认收起，展开后可滚动，切换群组自动收起。群组加载错误在侧栏收起时仍会显示。
- 群聊有清楚的群组标题；工具区默认折叠，保留已有用户的展开偏好。`AnimatedDisclosure` 用网格高度过渡保留子组件，收起时通过 inert 与 aria-hidden 排除隐藏控件。草稿不会因工具切换丢失。
- 输入框初始两行、继续按内容增高；唤醒帮助合并到操作栏，给消息阅读更多空间。自己的消息采用陶土色浅底；任务筛选、卡片、设置、连接、文件与仓库操作统一控件尺度和主色。
- 版权、项目来源、技术详情和高级凭据使用渐进展开；主操作与错误仍清楚可见。原作者和许可证说明没有删除。
- 动效覆盖导航宽度、工具展开收起、页面与管理面板进入、消息与列表出现、Tab 内容、按钮反馈与输入焦点。统一 160/300ms 与缓动，无新增动画库。减少动态效果偏好会关闭这些过渡。
- 修复连接页在 StrictMode 取消旧请求时误报 AbortError 的问题，保留真正失败的显示。

## 业务边界

本次只调整显示与交互布局，没有变更登录、MFA、设备配对、权限判断、MCP 授权、事件订阅、WebSocket presence、账号/群组隔离、云 Agent 执行和仓库审批语义。群 ID 仍由服务端分配。授权、订阅和在线状态分别展示，按轮响应不被表述成持续在线。OAuth 页面仅增加同源图像显示权限，表单目标、缓存与防嵌入策略继续保留。

## 本地预览

需要 Bun。运行两个终端：

```sh
bun scripts/web-ui-fixture.ts
```

```sh
cd web
COMMONS_API_PROXY=http://127.0.0.1:18951 bun run dev --host 127.0.0.1 --port 18950
```

访问 `http://127.0.0.1:18950/`。登录页的高级凭据输入 `local-synthetic-review` 可进入合成工作区。这个字符串仅用于 loopback 夹具，不是远端凭据。夹具不验证真实身份、不读取账号、不代理上游，所有非 GET 操作都返回 403。不要把夹具当成服务端鉴权实现，也不要向公网暴露。

浏览器回归脚本：`scripts/web-ui-review.mjs`。使用本机 Playwright，可通过 `PLAYWRIGHT_MODULE` 与 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定已安装位置。生产包不依赖 Playwright，也不包含夹具启动入口。

## 验证与证据

- `bun run check:commons:web`：TypeScript、326 项回归和正式前端构建通过。
- 工具折叠、中文输入法、Escape、公共弹窗：24 项通过。
- 邀请、服务配置、配对、引导：31 项通过。
- Worker TypeScript 检查通过。
- 服务端 OAuth 页面：11 项通过，包含输入转义、范围显示、CSP、表单与同意确认。
- 浏览器使用本地合成数据检查 1440×1000 与 390×844、浅色/深色；没有向真实服务发送内容。结果见 [浏览器检查](ui-review/2026-10-24/browser-results.json)。
- 导航实际计算到 300ms 宽度过渡；工具区使用 300ms 高度过渡；减少动态效果时过渡为 0s、动画为 none。浏览器录像：[实际交互录像](ui-review/2026-10-24/walkthrough.webm)。
- 构建仍有原有主包超过 500 kB 的提示。本次没有引入动画依赖；更大范围的代码分包未包含在此次视觉调整内。

| 页面 | 实际截图 |
| --- | --- |
| 登录 / MFA | [桌面登录](ui-review/2026-10-24/login-desktop.png) · [手机登录](ui-review/2026-10-24/login-mobile.png) · [MFA](ui-review/2026-10-24/mfa-mobile.png) |
| 工作区 | [桌面](ui-review/2026-10-24/home-desktop.png) · [收起导航](ui-review/2026-10-24/home-collapsed.png) · [深色](ui-review/2026-10-24/home-dark-desktop.png) |
| 对话 | [桌面](ui-review/2026-10-24/chat-desktop.png) · [手机深色](ui-review/2026-10-24/chat-dark-mobile.png) |
| 任务 / 成员 | [任务桌面](ui-review/2026-10-24/tasks-desktop.png) · [任务手机](ui-review/2026-10-24/tasks-mobile.png) · [团队](ui-review/2026-10-24/team-desktop.png) |
| 连接 / 文件 / 仓库 | [连接](ui-review/2026-10-24/connections-desktop.png) · [手机连接](ui-review/2026-10-24/connections-mobile.png) · [文件](ui-review/2026-10-24/files-desktop.png) · [仓库](ui-review/2026-10-24/repository-desktop.png) · [提案](ui-review/2026-10-24/proposal-desktop.png) |
| 设置 | [桌面](ui-review/2026-10-24/settings-desktop.png) · [手机深色](ui-review/2026-10-24/settings-dark-mobile.png) |
| 边界状态 | [空工作区](ui-review/2026-10-24/home-empty.png) · [加载](ui-review/2026-10-24/home-loading.png) · [收起导航时加载失败](ui-review/2026-10-24/groups-error-collapsed.png) · [长标题](ui-review/2026-10-24/home-long-title-mobile.png) · [引导](ui-review/2026-10-24/onboarding-mobile.png) |

这些是本地 Chromium 的截图和交互证据，不替代真实 GitHub/MFA 授权、设备配对、外部 Agent 回帖、实际文件上传下载、代码发布或生产验收。本次未部署、未向真实群组发送消息，也未触发仓库提案发布。Safari、Firefox、真实手机与屏幕阅读器仍需后续实机验收。
