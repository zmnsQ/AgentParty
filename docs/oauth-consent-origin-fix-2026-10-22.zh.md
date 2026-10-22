# ChatGPT 插件授权 invalid_origin 修复

Agent Commons 作者：zmnsQ；基于郭立 / leeguoo 及贡献者的 AgentParty 二次开发。原许可证与上游署名未变。

## 根因及修复范围

2026-10-22，实际 OAuth consent HTML 同时使用 `Referrer-Policy: no-referrer` 和 `<meta name="referrer" content="no-referrer">`。用户点击同意按钮后，原生 HTML 表单 POST 在 Chrome/Chromium 中发送 `Origin: null`，被正确的严格来源校验拒绝。

修复只将 **授权同意页文档**的两处策略改成 `same-origin`。同源表单 POST 因而保留真实来源，跨站导航不发送 Referer。OAuth 重定向回 ChatGPT 的响应仍保留 `no-referrer`，避免把授权参数放进下一跳的 Referer。

**未更改 `isExpectedOrigin`，未允许 null/缺失来源，未放开跨站提交或 callback 白名单。** 本站 MFA、逐群授权、一次性 session-bound nonce、code challenge / S256 PKCE、权限及授权撤销检查全部保留。无数据库迁移、无凭据轮换、无需重新建立 GitHub 登录应用。

## 验证

- 用隔离 Chrome / CDP 加载实际 `consentPage` 渲染器生成的 HTML；所有账号、表单参数为合成数据，没有访问用户真实会话或点击用户同意。
- 修复前测得 `Origin: null`；修复后为真实本站 origin、`Sec-Fetch-Site: same-origin`。
- 新增 7 个回归用例：原生表单策略及授权码交换链路、空/缺失来源、外国域名、伪造 forwarded headers、cross-site metadata 和近似域名；攻击请求被拒绝后合法一次性表单仍可提交，重放仍失败。
- 相关 OAuth 测试 17/17 通过。旧生产实现运行新策略回归测试时按预期失败。
- 完整 `bun run check:commons` 退出码 0：**622/622** 通过（契约53、Worker246、Web202、CLI111、配置4、Muse SDK6），未跳过；类型检查、Web生产构建和迁移编号检查通过。

浏览器实测记录位于 `docs/validation/oauth-consent-origin-2026-10-22.json`。

## 用户重试

不要刷新已经返回 JSON 错误的 POST 页面。关闭该授权页，从 ChatGPT 中该自定义 MCP 插件重新点击连接/授权，生成新的同意页再确认。无需删群、重新创建 GitHub App 或提供任何密钥/验证码给助手。

本次没有代替用户确认真实 ChatGPT 授权；是否最终完成绑定要由用户重试后的平台回执确认。

参考：[MDN Referrer-Policy 对 Origin 的影响](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy#effect_on_the_origin_header)、[OpenAI MCP OAuth](https://developers.openai.com/plugins/build/auth)。
