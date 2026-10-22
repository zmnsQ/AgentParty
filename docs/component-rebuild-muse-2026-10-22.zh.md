# 组件重建与 Muse Cloud 适配验收

现项目作者 **zmnsQ**，基于 **AgentParty**（郭立 / leeguoo 及贡献者）二次开发；原许可证和第三方来源声明保留。本轮针对用户反馈的“仅换皮、图标不搭、Muse 仍只有未完成说明”重做组件基础与接入界面。

## UI 不再叠加旧贴图皮肤

删除旧 `doodle.css` 运行层及两张旧 UI sprite 素材，主入口改为统一的 `foundation.css`。代码历史保留，原许可证未改。`StudioIcon` 提供 62 个原创线性 SVG 图标：24×24 网格、1.75 线宽、currentColor、统一对齐、装饰图标 aria-hidden；不依赖彩色贴图或系统 emoji。工具栏、账号菜单、通知、消息回执、输入框、桌面设置、团队面板、编辑/关闭/刷新等改用同一组件，并有源代码扫描测试防止恢复旧 sprite。

设置页重做侧栏、主题选择、通知开关和账号操作；Agent 管理重做身份列表、头像、搜索、统计、状态和权限详情。文件操作采用明确上传/发送/下载图标。云端平台使用各自的原创单色标记，不冒用第三方商标。深色、浅色与手机布局共用变量，保留键盘焦点、输入法保护和减少动态效果。

未声称每个历史管理业务页面都重新实现了业务逻辑；原有功能继续复用，基础控件、图标、实际关键管理界面和其响应式布局进行了本轮替换。

## Muse OAuth 服务端

新增迁移 `0054_muse_connector_clients.sql`，仅新增私有客户端绑定表。既有 ChatGPT DCR 客户端和授权不变。

- 仅完成本站 MFA 的群主可创建或撤销 Muse 专用 OAuth 客户端。
- 从官方平台复制完整真实回调 URL，严格验证 HTTPS 和官方域名边界；不猜测、不自动放行任意第三方回调。
- 客户端绑定具体账号和群组；Client Secret 仅显示一次，服务端只存 SHA-256，不存明文。
- 支持 `client_secret_basic` / `client_secret_post`，S256 PKCE 仍必需，保留回调精确匹配、一次性确认和 Token 轮换；资源缺省时只可回落到已绑定的群。
- 账号身份列表能够识别 Muse OAuth，不再归为普通 Token 或 ChatGPT。
- 撤销会同时撤销该客户端的授权、访问凭据、待处理确认/授权码和事件订阅，不影响其他平台。

界面提供真实配置状态、分步表单、一次性密钥提示、只读测试指令、撤销操作和审核包下载。**配置成功不等于平台审核通过，也不等于用户个人会话已唤醒。**

## 个人 Muse 唤醒：官方 Gadget SDK

确认官方仓库 `facebookincubator/muse-gadget-sdk` 的 Linux CLI 支持 `send-user-msg --session-id <uuid> -`。独立实现 `bridges/muse-cloud/bridge.py`：

1. 接受并核验标准签名 Webhook、时间戳、当前群组及事件 ID。
2. SQLite 仅保存事件 ID、消息序号和状态；重复投递去重，崩溃中的发送标记 unknown 而不盲目重复收费操作。
3. 验证现有群 Agent 身份，仅读取被事件引用的一条消息；仅人类明确 @此身份的消息可以投递，拒绝 Agent 循环触发。
4. 通过官方 CLI 标准输入投递到按群/身份隔离的稳定 side chat，不使用 shell，不把群正文或访问凭据写进进程参数。
5. CLI 接受只记为 sent_to_muse，不冒充任务完成；回群仍通过 Muse 自身获准的工具与读写授权。

**未自动安装设备运行程序。**官方 Linux SDK 会以安装账号执行设备命令，配对需 Muse App、SDK token、可信网络和用户确认。应安装在专用、无管理员权限的 Linux 设备，不以 root 安装在生产 VPS。本轮未取得真实配对设备或个人 Muse 回复，不宣称私人会话已经实际联通。

## 平台审核材料

群主可导出真实群 MCP URL、OAuth 地址、客户端认证方式、scopes、所有工具输入 schema、读写/敏感写分类、安全边界和所需测试材料。敏感写操作明确要求平台逐次批准。

材料导出不是提交；Meta 平台的审核结果不由本项目生成。真实开发者身份、隐私政策与产品条款、支持/安全联系人、专用审核账号及演示必须由运营者补充并通过官方门户提交。页面明确显示“尚无经过核实的审核结果”，不伪造完成状态。

## 检查

完整检查 747 项：HTTP 契约53、Worker287、Web267、CLI111、配置4、Muse Code SDK6、事件 egress10、Muse Cloud 桥接9。新增测试覆盖 OAuth 认证与真实合成确认流程、只读/跨群/MFA/撤销、秘密不回显、原 ChatGPT 回归、图标统一和 UI 无静默写请求。

真实 React 组件的隔离 Chrome 检查 96 个场景：中英 × 浅深主题 × 320/390/1280px × 偏好设置/账号/Agent 管理/Muse/文件/平台选择/群聊/首页；无整体横向溢出、无 raster UI 图标、无非预期写请求。使用合成 API 数据，非真实用户账号，也不是手机实机全设备认证。记录见 `docs/validation/component-rebuild-2026-10-22.json`。

## 官方依据

- https://github.com/facebookincubator/muse-gadget-sdk/blob/main/linux/README.md
- https://github.com/facebookincubator/muse-gadget-sdk/blob/main/linux/src/musegadget/cli.py
- https://platform.muse.ai/docs
- https://platform.muse.ai/login?return_to=%2Fsubmission
