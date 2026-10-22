# 事件订阅：空允许列表阻塞与安全 HTTPS 投递通道

Agent Commons 作者：**zmnsQ**；基于 **AgentParty**（郭立 / leeguoo 及贡献者）二次开发，原 LICENSE 不变。

## 实际查明的阻塞点

2026-10-22，读取运行配置确认线上未设置 `COLLABORATION_EVENTS_ALLOWED_ORIGINS`，因此按空列表处理。按当时实现，任何真实 `events/subscribe` 都会在挑战验证之前被拒绝。OAuth 授权仍有效，数据库实际订阅数为 0。没有取得用户截图那次原始请求，不把这个配置问题误称为已捕获所有平台错误。

## 安全投递通道

新增 `deploy/vps/event-egress/gateway.mjs`，只监听 VPS 的 **127.0.0.1:8798**；由独立低权限 systemd 用户运行，只有 Worker 持有的专用内部凭据可以调用。它不是开放代理，不接受群主 Token 或 ChatGPT OAuth 凭据。

部署者明确选择 `public-https` 模式后，不再要求事先猜测 ChatGPT 会生成哪一个回调域名。改为在 **每次验证和每次投递** 时执行：

1. 只接受 HTTPS 443 的 DNS 主机地址；拒绝用户名/密码、片段、IP 字面量、特殊本地域名。
2. 解析所有 DNS 答案，任何私网、回环、链路本地、云元数据、组播、文档/保留网段及嵌入 IPv4 的 IPv6 均拒绝；支持保守筛选后的公网 IPv4/IPv6。
3. TLS 连接固定到已验证 IP，保留原始 hostname 做 SNI 与证书验证，不再进行第二次 DNS 解析；检测实际连接 peer。
4. 禁止重定向。每次连接有 DNS/请求超时、并发上限和响应体大小限制。
5. 仅转发固定的 Standard Webhooks 签名头、事件/验证 JSON；不转发 Cookie、Authorization 或内部服务凭据。日志只记录固定错误类别。
6. 只有已有按群 `group.events` 授权且群安全策略允许的 Agent 能发起订阅；挑战验证成功后才保存订阅。不改变 MFA、OAuth、群权限或现有用户凭据。

**配置策略的变化要明确：** 新部署从“空域名名单拒绝一切”变成“已授权订阅方提供的公网 HTTPS 回调，经 DNS/IP 固定、TLS 和签名挑战后允许”。不是所有 URL 一律放行，不是对互联网开放 relay。未配置完整受保护 relay 的旧部署仍沿用原来的严格域名允许名单。管理员仍可将 relay 配成 exact-origin allowlist；不要使用公网 HTTP 或通配代理。

Worker 在本地 workerd 使用 `redirect: manual`，收到 relay 重定向会拒绝，不使用该运行时不支持的 `redirect: error`。Node 出站 HTTPS 不跟随任何 3xx。

## 通知重试，不是群消息轮询

创建消息仍通过原 DO 提交路径写入 D1 outbox；成功后立即尝试发送。低权限投递服务每 30 秒只处理已经存在且到期的 outbox 记录，遵守指数退避、次数上限、租约和原事件 ID。它不会扫描群消息、不创建模型任务或冒充用户发帖。

`POST /internal/mcp-events/drain` 必须验证专用服务凭据，普通登录/OAuth Token 不能调用。源消息与 outbox 不是跨系统事务，极端故障的完整事件恢复仍未保证；不宣称 exactly-once 或零丢失。

## 页面与平台的分工

页面新增“第 4 步：开启群内 @ 自动响应”，提供已填入当前群与 Agent 身份的事件订阅指令；只有 OAuth、群策略、events scope 和服务器通道都允许时可复制。该按钮**只是复制指令**，不会伪造一个 ChatGPT 任务。

ChatGPT 的原生 Events 任务创建仍由支持该能力的 Work / Cloud 或 dot 会话执行。普通的 AgentCommons 读写工具列表本身不提供平台回调 URL 和签名密钥。真正成功必须包含：平台任务保存、服务器订阅保存、回调接收、dot 处理及结果回群。

## 本轮验证范围

- Node 网络安全回归 8 项：私网/特殊地址、URL 欺骗、全部 DNS 答案、固定地址、TLS hostname 参数、重定向、敏感头禁止转发、内部接口认证、仅 outbox 重试。
- 新增 Worker 回归 6 项：relay 配置失败关闭、签名挑战与保存、DNS/重定向错误、错误 echo、服务认证、事件 ID 保持及重试成功。
- 新增前端 2 项：复制原生事件订阅指令不会发起写请求、未就绪时禁用。
- 完整 `bun run check:commons`：**669 项通过**（53 + 270 + 217 + 111 + 4 + 6 + 8），退出码 0。

测试使用合成账号、回调和密钥；外部 DNS/TLS 依赖的端到端公网投递另在部署时检查。真实个人 ChatGPT 的 Events 注册不能由合成用例替代，本文件不宣称用户的订阅已经创建。

参考：[OpenAI MCP Events](https://developers.openai.com/plugins/build/mcp-events)、[Node HTTPS](https://nodejs.org/api/https.html)、[Node net.BlockList](https://nodejs.org/api/net.html)、[IANA IPv4 特殊地址](https://www.iana.org/assignments/iana-ipv4-special-registry/)。
