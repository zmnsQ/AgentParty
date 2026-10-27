# 群内连接指引整理

基线为已发布 Git 提交 `3589d6a8fc144e6d09cfc718f986fedce297e21c`。本轮只整理连接引导，不新增设备服务、授权协议、凭据或数据库迁移，不改变现有 API/权限。未推送、未部署。

## 用户路径

1. **选择 Agent**：每张卡说明用途、前提和“连接未检查”，不能从卡片存在推断账号在线。
2. **选择方式**：Muse 先选 MCP 工具访问或 Gadget 设备桥接，选定前不展示授权字段或开发链接。
3. **逐步完成**：MCP 是 Muse 访问本群工具，授权从 Muse 发起；Gadget 需要隔离设备、桥接服务和本人 Muse App 配对，不是群内网页登录。
4. **证据分层**：授权已保存、设备配对、事件订阅、实际投递/回帖分别说明；缺证据不标在线。
5. **高级说明折叠**：仓库、平台审核、本地安装和团队分工不是首屏连接按钮。

现有客户端注册、权限设置、只读验证、回帖测试与平台选择保留。ChatGPT 发帖/任务测试明确为可选写入；复制提示词不执行动作。编程 Agent 的 MCP 三步优先，本地连接器安装后置折叠；Hermes/Cue 表单说明字段来源和保存不启动任务。

## 官方能力依据

- [Meta Newsroom：Muse for Small Business](https://about.fb.com/news/2026/09/introducing-muse-small-business/) 直接链接 `muse.ai/platform`，重定向 `platform.muse.ai`。不是仅凭同名或页脚认定官方域名。
- [Connector Guidelines](https://platform.muse.ai/docs)：第三方提供自身服务的 endpoint/auth/scopes 供 Muse 访问；不是向本站发放控制个人 Muse 的令牌。
- [Meta 帮助：How Muse works with Connectors](https://www.meta.com/en-gb/help/superintelligence/1687253048996149/)：部分连接器可主动更新，不等于所有自定义 MCP 都支持事件唤醒。自定义接入引导为请 Muse 创建/配置连接器，不假设固定粘贴地址设置栏。
- [官方 Gadget Linux 指南](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/linux) 和 [pair.py](https://github.com/facebookincubator/muse-gadget-sdk/blob/main/linux/src/musegadget/pair.py)：初次设备配对通过 BLE 与 Muse App 本人确认，不是网页 OAuth。

未找到第三方群网页登录后即可无设备实时控制现有个人 Muse 的公开官方接口依据；标为未证实，不声称官方永久不支持。模型 API / Muse Code 不是同一产品能力。

## 未完成扩建已隔离

设备登记/配对管理 WIP 已停止，保存在本地 stash `d48ec53282fac79209cbdc8089639c6e5a60386e`，未验证、不可发布。其后端接口、migration 0055、宿主心跳和配对 helper 不包含在本次 UX 修复，不能描述为配对闭环已完成。

## 验证

16 项选择器/Muse测试、50 项编程/云端指引测试通过；Web TS 和生产构建通过（保留既有大 bundle 告警）。全量 Web 1513 pass / 32 fail，对比基线 1510 pass / 32 fail，失败名称集合完全一致，无新增失败。没有真实账号授权、消息发送、配对或部署；本轮未重新做浏览器视觉及真机流程验证，不把组件测试当作实机验证。

独立静态审查批准本地提交：仅Web指引与文档，原生折叠可键盘操作，未混入设备WIP；审查者环境未找到bun，因此未宣称独立复测。
