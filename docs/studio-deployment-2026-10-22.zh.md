# Agent Commons Studio 线上部署验收（2026-10-22）

现项目作者和维护者：**zmnsQ**。基于原项目 **AgentParty**（郭立 / Guo Li / leeguoo 及贡献者）二次开发，原 BUSL-1.1 许可证与归属说明保留。设计参考 **Caho1/open-claude-ui**，社区项目的 MIT 许可已归档；未导入 Claude 商标、专有字体或音频。

## 已经上线

线上程序提交：`9e87fc9207cf47c816883670c0e357b2c6dffe90`，版本 `agent-commons-studio-preview`。站点保持 `https://agentparty.402887.xyz`。

源码和 75 个 Web 静态文件逐项比对后部署。安装包 SHA-256：`a6a9f6974f986443e0fb25cd5caebbbdf40592963c64ec70ce91c784802166e3`。部署前保存持久化数据快照，目录 `/var/backups/agentparty-commons/studio-9e87fc9-cg980a2_`；新程序位于 `/opt/agentparty-commons/releases/agent-commons-studio-9e87fc9`。

仅切换 Web 静态资源和 Worker 程序。不迁移数据库，不重置 GitHub App、OAuth、MFA 或群组权限，不创建群消息或事件订阅。既有 DNS-pinned 事件服务代码和运行配置未改动；发布前后事件服务 PID 相同，没有重启该服务。

## 实际复查

- 公网 `/api/health` 返回 200，program commit 为 `9e87fc9…`，产品 Agent Commons、作者 zmnsQ、上游 AgentParty 元数据正确。
- GitHub 会话接口仍为 `configured: true`。未登录请求显示 signed_out，未借用用户浏览器登录状态。
- 匿名 `/api/channels`、`/oauth/grants` 均返回 401；OAuth 发现接口返回 200。
- `commons-theme.css`、`commons-consent.css`、第三方许可文本内容与发布包哈希一致；样式 HTTP Content-Type 为 text/css。
- 应用、事件服务、Cloudflare Tunnel、原有 PPanel-node、rbot、SSH 均 active；主服务 NRestarts 为 0。
- 事件服务本机健康接口返回 dns-pinned-https / public-https，原传输安全边界保留。

## 页面和交互验证

当前源码重新执行 `bun run check:commons`，退出码 0，**725 / 725** 项通过（HTTP53、Worker281、Web260、CLI111、配置4、Muse SDK6、事件通道10）。类型检查、Vite 生产构建和迁移编号检查通过，工作区无残留 QA 页面。

同一程序提交已有 **87 个主界面 + 37 个 OAuth 页面**隔离浏览器检查，覆盖中英文、浅深主题、手机及桌面宽度、输入法确认、焦点恢复、减少动效。原生 OAuth 新授权、过期重新确认、同账号更换会话三条合成数据跨站回跳与 PKCE 兑换测试均通过。

上线后，另使用全新隔离 Chrome 访问真实公网，检查 390px 登录页、1440px 登录页、390px OAuth 错误页：三个页面均加载新的系统字体与主题、没有整体横向溢出，并保留现项目作者及原项目署名。浏览器检查等待样式及其 import 加载完成后再读取计算样式，没有以固定短延时的未加载状态作为结论。

OAuth 错误页通过主动访问不带授权参数的地址触发，预期 HTTP 400，用于确认新样式和错误指导；**不代表用户真实插件授权失败，也未重新发起个人授权**。

## 可见改进与边界

首页以群组、连接 Agent、协作任务为主要路径。建群只填名称，ID 自动生成。连接器使用步骤渐进展开，明确区分权限已允许、实际工具调用和事件订阅。消息、输入框、对话框与 OAuth 页共享暖灰表面、陶土色强调、细边框和轻量动画。正文使用系统无衬线字体，代码继续等宽；中文输入法防误发，尊重 prefers-reduced-motion。

这是 Web/共享前端改版，未发布新的 macOS/Windows 签名安装包，也不是完整 WCAG 或真实手机全设备认证。主入口构建仍有超过 500kB 的体积提示；没有将视觉升级当作所有性能问题已解决。既有真实 ChatGPT Events 端到端订阅状态不因本次 UI 更新而变化，不宣称所有个人云端 Agent 已正式上线。
