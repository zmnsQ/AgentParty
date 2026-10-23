# 手机交互与 Muse 原生 MCP 修复

Agent Commons 作者与维护者：zmnsQ。基于郭立 / leeguoo 的 AgentParty 二次开发，保留原许可证。

## 修复

手机群组导航改为可关闭的抽屉，聊天占用完整宽度；加入 Agent 与管理按钮不再藏在横向工具条内部。Agent 接入、频道面板与设置面板通过 ModalPortal 挂载到 body，避免祖先滚动/变换容器裁切，并保留焦点、键盘导航与关闭操作。单独的 mobile-shell.css 取代此前两轮未验证的 CSS 补丁。

手机桌面视口模式也使用单列布局与可点击尺寸；浏览器缩放未被禁止。使用 visualViewport 同步可用高度，输入消息时压缩非必要区域；实际 iOS 键盘仍需真机复核。

Muse 优先展示本群 MCP 地址。动态注册仅新增精确 Meta 原生回调，不扩大成任意 HTTPS 地址白名单。需要预先 Client ID 的版本可由已完成 MFA 的群主显式准备公共 PKCE 客户端；Client ID 不是访问令牌，不会自动授权。旧的私有客户端和高级接入方式继续保留。

原生客户端不发送 resource 时：已绑定群组的客户端只使用该群；未绑定的动态客户端先要求用户明确选择本人拥有且已启用 MCP 的群，再展示权限确认。令牌交换只从服务端签发、绑定客户端和回调的授权码或刷新授权恢复 audience。PKCE、MFA、CSRF、所有权、权限范围、撤销与刷新轮换仍受原检查约束。没有数据库迁移。

仅输入 MCP 地址后应由 Muse 发起授权，不需要手工复制生成的 OAuth 链接。授权状态取决于实际有效授权，不把客户端配置、通知订阅或目录审核混为“已连接”。

## 验证

76 项前端相关单元测试、69 项 Worker OAuth/MCP/安全测试通过；6 组 Chromium 真实 React 交互覆盖 320/390/430px、桌面视口手机、中英文、浅深主题和桌面，另有 3 组原生选群与授权表单点击测试。详细数据见 `validation/mobile-native-mcp-2026-10-23.json`。

测试包括在工具栏人为添加 transform 与 paint containment 后打开弹窗、关闭并再次打开、Codex 名称输入与接入按钮、Muse 端点及 Client ID 入口、设置 Tab 切换、小高度下输入区触达，以及打开页面不产生授权或创建凭据的写请求。OAuth 表单测试实际点击选群和允许，检查 native same-origin POST；测试请求被隔离拦截，不操作用户真实授权。

这不是用户真实 iPhone/Muse 账号联调。真实连接的最终回跳与 Muse 内工具调用仍须由用户在自己的客户端确认。

## 运行

在 web 目录启动 Vite（仅绑定 localhost，端口 4173）。在独立 QA 环境提供 Playwright 浏览器后运行：

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs QA_OUTPUT_DIR=/tmp/commons-mobile-qa node web/test/mobile-interaction.browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs QA_OUTPUT_DIR=/tmp/commons-mobile-qa node web/test/oauth-consent.browser.mjs
cd worker && bun x vitest run test/muse-native-oauth.spec.ts test/connector-oauth.spec.ts test/muse-connector.spec.ts test/oauth-pages.spec.ts test/mcp-security.spec.ts
```

服务器发布应先备份状态和配置，保持 Tunnel、DNS 和其他服务不变。新版本只替换应用代码与前端资源，保留持久化状态和回退版本；健康验证失败时回退符号链接，不覆盖用户数据库。
