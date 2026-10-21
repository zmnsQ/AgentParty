# GitHub 登录与二步验证

## 设计与验收计划（2026-10-21）

目标：网页不再要求用户复制登录 token；以 GitHub 授权码 + PKCE 验证身份，另提供本站可选 TOTP 二步验证和一次性恢复码。保留机器 Agent 的授权凭据，登录不授予 GitHub 仓库读写权限。

- 账号锚点使用不可变 GitHub numeric ID，不按昵称或邮箱自动合并既有账号。
- 默认仅允许部署者配置的 GitHub ID；不开放任意 GitHub 账号注册。
- GitHub token 只用于本次身份确认，不保存、不发到浏览器。
- 浏览器持久登录使用 Secure / HttpOnly / SameSite cookie；API access token 短时有效，仅在内存中，不写 localStorage、URL 或日志。
- 二步验证前只创建待验证会话，不允许读取群组数据或领取 API access token。
- TOTP 秘钥使用已有 AES-GCM vault 加密；验证窗口、计次限制、验证码防重放、恢复码单次消费都由数据库强制执行。
- 开启或关闭二步验证、重置恢复码时作废其他会话与已配对桌面会话。
- 首次配置可使用 GitHub App manifest；一次性初始化凭证经 SSH 在服务器生成，限时、绑定预定 GitHub owner。应用 secret 只在服务端接收并加密。
- 已部署的群组、文件、Agent 连接和许可证不改变。独立分支、本地测试，不触发付费 Actions。

官方协议依据：
https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
https://datatracker.ietf.org/doc/html/rfc6238

验收：OAuth state / 浏览器绑定 / PKCE / 一次性回调；错误或不同账号拒绝；短时凭证到期与撤销；TOTP RFC 向量、防重放、猜测限流；恢复码单次使用；MFA 未完成不得访问群组；上线后公开端点与无凭据保护检查。真实 GitHub 的最终创建/授权确认和用户验证器绑定必须由用户本人完成，不以模拟响应替代。

## 本轮实际检查

- `bun run check:commons`：退出码 0；现有 533 项全部通过（HTTP 53、Worker 179、Web 186、CLI 111、配置 4）。
- `cd worker && bunx tsc --noEmit && bunx vitest run test/browser-github-auth.spec.ts`：新增认证回归 24/24 通过，包含 RFC 6238 向量、state/PKCE、账号白名单、会话到期/撤销、群消息写入、TOTP 防重放、恢复码单次消费与限流。
- Shared / Worker / Web / CLI 类型检查及生产网页构建通过。原有前端大包警告仍然存在。
- 拟追加的前端交互测试文件写入被工具安全检查拦截，未写入、未执行，不计入验证结果。新增认证回归目前单独运行，尚未纳入 `check:commons` 脚本。
- 没有进行真实用户的 GitHub 创建/授权或个人验证器绑定；不得以模拟响应代替这两项人工验收。

## 部署配置

需先备份并应用新增迁移 `0049_browser_github_auth.sql`。这是附加表迁移，不重写现有群组或文件。

```text
AUTH_PUBLIC_ORIGIN=https://your-own-server.example
AUTH_GITHUB_APP_OWNER_ID=<GitHub numeric user ID>
AUTH_GITHUB_ALLOWED_IDS=<comma-separated numeric user IDs>
AUTH_REQUIRE_GITHUB_LOGIN=true
```

手工配置 OAuth App 时设置 `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`，回调为 `/api/auth/github/callback`；`GITHUB_AUTH_KIND=github-app` 用于 GitHub App。环境配置与 manifest 注册二选一。

Manifest 初始化由部署管理员生成一次性随机密钥，只将 SHA-256 摘要写入 `AUTH_SETUP_TOKEN_HASH`，并设置毫秒时间戳 `AUTH_SETUP_EXPIRES_AT`。初始化页 `/auth/setup#key=...` 读取后立即清除 URL fragment；密钥不发送给 GitHub。注册回调校验预先指定的 GitHub owner 后保存加密配置，不保存 GitHub App 私钥或 webhook secret。已配置时拒绝重复注册。

初始化完成后，用户从登录页选择 GitHub；账号安全入口 `/auth/security` 提供验证器绑定、一次性恢复码下载、恢复码轮换和关闭二步验证。绑定时的二维码由本地打包的 `qrcode` 生成，不调用第三方二维码网站。不要把二维码、seed 或恢复码发到群聊。

## 边界

本站 TOTP 不等同于 GitHub 自身的 2FA；不宣称证明某次 GitHub 会话完成了 GitHub MFA。本站第二因素由用户自愿启用，必须由其本人扫码验证，不能由部署者代绑。

GitHub 登录与仓库授权分离；未申请仓库写入权限。现有 Agent/API 凭据仍用于机器访问。启用严格网页登录配置后，旧人类 bearer 登录不再可用；分享用只读凭据和 Agent 凭据保持原有权限约束。已有账号不按邮箱或昵称自动关联到 GitHub ID。

桌面应用继续使用已有的浏览器配对流程；本轮没有编译原生安装包。dot/Muse 的 OAuth 连接器、事件订阅仍是另一项接入工作，本次 GitHub 登录不是它们的接入完成证明。
