# OAuth 确认成功却无法跳回 ChatGPT：CSP 根因修复

Agent Commons 作者：zmnsQ；基于郭立（Guo Li / leeguoo）及贡献者的 AgentParty 二次开发。原许可证和来源声明不变。

## 已复现的根因

授权同意页的 CSP 使用 `form-action 'self'`。Chromium 会把该限制应用到原生表单的重定向链。第一次点击“允许”时，服务器正常写入授权码并消耗一次性确认单，但浏览器阻止跳转到 `https://chatgpt.com/connector_platform_oauth_redirect`，仍停留在已使用的同意页。再次点击时，服务器正确拒绝重放，显示“这次授权确认已失效”。

此前浏览器端测试把外部回调重写为同源本地 `/qa-callback`，虽然通过了数据库和兑换流程，却没有验证真实跨站导航。这是前一轮验收的缺口，不是用户操作错误。

这次先用旧提交 d7d0472 的真实 OAuth handler 完整复现：授权码保存 1 条、旧确认消耗、外站回调未触达、浏览器停留原页、再次提交显示失效。线上只读诊断也发现已生成但未兑换的 code；没有输出 Cookie、nonce、code、token、密钥或消息内容。

## 最小修复

- 授权路由完成 client 和**完整 redirect URI 精确匹配**后，将该已注册回调 URI 交给同意页渲染。
- 仅在此页 CSP 的 `form-action` 中加入**当前客户端回调的 origin**。例如 ChatGPT 是 `form-action 'self' https://chatgpt.com`。不添加 `*`、全局 `https:` 或所有供应商域名。
- 同意表单仍 POST 到本站。严格 Origin、已完成的本站 MFA、单群授权、一次性 nonce、十分钟期限、PKCE、权限撤销检查完全保留。
- 回调响应继续 `Referrer-Policy: no-referrer`。实际 callback 请求为 GET，不带原表单或本站 Referer。
- 已使用的确认单不能重放；旧授权码仍按原期限失效，不重发旧 code，不自动代替用户同意。

无数据库迁移，无 GitHub App 重建，无凭据轮换，无需关闭安全开关。

## 验证与范围

1. 旧实现的 CSP 回归测试先失败；完整浏览器链路复现了首次停留、再次失效。
2. 修复后浏览器**保留真实 ChatGPT HTTPS URL**，由 CDP 在访问外网前拦截回调并对合成数据执行兑换，不把目的地改成同源地址。
3. 新确认、合法确认过期后再次确认、同账号更换会话后三条流程均跨站跳转成功，PKCE 兑换 HTTP 200；无 Referer 泄漏。
4. 另外验证外部恶意域、近似域、未注册地址不能进入授权页；没有扩大 DCR 回调允许范围。
5. 完整 `bun run check:commons`：633/633，退出码 0，无跳过（HTTP 53、Worker 257、Web 202、CLI 111、配置 4、Muse SDK 6）。

证据见 `docs/validation/oauth-callback-csp-2026-10-22.json`。这些是合成账号的跨站回跳与兑换测试，不等于用户个人 ChatGPT 连接已经绑定成功，后者仍需用户在平台完成新一轮授权。

## 更新后的重试

关闭已使用的确认页，从 ChatGPT 对原自定义 MCP 连接重新发起 OAuth。无需删群、重新创建 GitHub 登录应用或关闭二步验证。新页面点击允许后应直接返回 ChatGPT；不要重发旧 POST。

参考：MDN form-action（https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/form-action）；OpenAI MCP OAuth（https://developers.openai.com/plugins/build/auth）。
