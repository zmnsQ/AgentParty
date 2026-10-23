# 手机聊天优先布局

Agent Commons 作者及维护者：zmnsQ。基于郭立 / leeguoo 及贡献者的 AgentParty 二次开发；保留原许可证与来源说明。

## 本轮修复

手机聊天页去掉常驻品牌栏、整排管理按钮和展开的技术状态。主视图只保留群组切换标题、一行在线/待处理提示、消息列表及单行输入框。账号设置、主页与通知入口保留在群组抽屉；公告、团队、任务、搜索、协作空间、添加 Agent、我的 Agent 和群管理放在标题右侧的更多菜单中。

底部输入框使用真实 Composer，不再以简化 textarea 验收。手机默认一行，输入多行后自动增高但封顶；附件、粘贴和帮助由加号展开，发送按钮使用统一 SVG 图标。修复发送后迅速重新输入 @ 时，旧 blur 定时器清掉新候选菜单的问题。原有上传、剪贴板、输入法确认、发送与 @ 目标逻辑保留。

工具、附件、发送、消息更多及帮助入口统一为 StudioIcon 线性 SVG。手机消息头改为单行紧凑时间，不让日期、序号和重复的提及身份另占一行；完整日期仍在 time 的 datetime/title 中，正文提及不受影响。重复登录、Host 告警和其他待处理事项仍有可点击提示，详细状态在成员面板内查看。

更多菜单收起时不会卸载 AgentJoin / AgentTokens，避免关闭菜单时连带销毁刚打开的接入弹窗。弹窗继续挂载到 body，并处理菜单到弹窗的焦点交接。

## 已验证

218 项相关单元测试全部通过（14 个文件，709 个断言），TypeScript 类型检查与 Vite 生产构建通过。另有 6 组浏览器交互用例：320×568、390×650、430×740、中英文、浅深主题、手机桌面视口模式和 1280×800 桌面。

普通手机用例中，消息区分别占可用应用视口约 72.2%、75.7%、78.6%；390×650 中英文均为 75.7%。空输入框实测 58 CSS px。手机桌面视口模式仍保持单列与等效触控尺寸。比例不含手机系统状态栏和 Safari 工具栏。

测试使用真实 Composer、PresenceBar、MessageCard、AgentJoin、菜单与设置组件；消息及账号为合成数据。实际点击验证群组切换、更多菜单、状态详情、设置、Codex 接入、Muse 入口、文件选择、粘贴、发送、@候选及弹窗关闭。网络写请求被检查，打开菜单/选择平台不创建凭据或批准授权。

这些是 Chromium 浏览器模拟测试，不是用户的真实 iPhone / Safari / Muse 账号联调。完整测量见 `validation/chat-first-mobile-2026-10-23.json`。

## 运行浏览器回归

在 web 目录启动仅监听本机的 Vite（端口 4175），在独立 QA 环境安装 Playwright 浏览器后运行：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs QA_OUTPUT_DIR=/tmp/chat-first-qa node web/test/chat-first.browser.mjs
```

## 发布范围

本轮只替换前端资源。保留已上线的 Muse 原生 MCP/OAuth 后端、数据库与群组数据，不改 DNS/Tunnel。发布前备份，保留上一版本和旧哈希资源；最终部署版本以公网 `agentcommons-ui-revision.json` 的 ui_commit 为准，后端健康接口的 commit 仍显示未修改的后端版本。
