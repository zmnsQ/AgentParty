# 云端与编程 Agent 共存：部署核验

日期：2026-10-23（新加坡时间）。现项目作者 zmnsQ；基于原项目 AgentParty（郭立 / leeguoo 及贡献者）二次开发，保留原许可证。

## 已发布

线上程序为 `985ab76ce2d9b68756264efdd7d456fd6abd5657`，版本 `agent-commons-mixed-team-preview`。在原域名 `https://agentparty.402887.xyz` 发布完成。

本次直接展示 Codex、Claude Code、其他编程执行端，与 dot、Muse、Cue、Grok、Hermes 并列。原来不是删除了编程工具，而是接入入口被错误地降级为折叠菜单。本次修正入口与引导，保留交互接入、常驻运行器、重连、会话恢复、各自的身份与权限；选择卡片不会启动真实模型。

发布包也包含上一轮已提交的基础控件/图标重构和 Muse OAuth 配置实现，补上唯一的新增迁移 `0054_muse_connector_clients.sql`。部署脚本核对只允许这条新增迁移；没有修改或删除既有群记录、消息或授权。没有安装 Muse Gadget 设备程序，没有创建个人 Muse 配对，也没有提交或冒称通过 Meta 平台审核。

更新前保存一致性数据快照：`/var/backups/agentparty-commons/mixed-985ab76-9ggseo5f/state-before.tgz`。原事件服务代码与配置保持不变，进程未重启。程序切换目标：`/opt/agentparty-commons/releases/agent-commons-mixed-985ab76`。

## 实际检查

- 公网健康接口 HTTP 200，commit 为 `985ab76…`；产品 Agent Commons、作者 zmnsQ、原项目署名正确。
- GitHub 登录配置仍为 `configured: true`。
- 真实公网主 JS 与发布包逐字节哈希一致，包含 Codex、Claude Code 及 `data-coding-provider` 选择入口。
- 原有 AgentCommons 插件实际调用 `party_profile` 成功，仍识别原授权群的 OAuth 身份；未重新授权、没有发送群消息。
- 匿名访问 `/api/channels`、`/oauth/grants`、Muse 配置接口仍为 401。
- 主应用、事件服务、隧道、PPanel-node、rbot 和 SSH 均 active；主服务 NRestarts 为 0。
- 新版 OAuth 浏览器错误页与主题样式可访问；OAuth API 的错误状态码契约保留。

## 回归与验收边界

完整检查 **802/802** 通过，另有12个真实 React 组件的隔离浏览器组合，覆盖中英/浅深主题/320、390、1280px，以及两类入口同时可见、正确预选工具、返回再选择云端、无隐式写请求。

新增 Worker 测试通过真实 D1/DO/MCP 路径验证云端身份明确 @执行身份、任务消息关联、重复发送去重和结果回群。CLI 测试用模拟 WebSocket 和执行器分别验证 Codex / Claude Code 身份可以接收另一个 Agent 的明确指派，不被无指派讨论、自身回复或重复消息误触发。

以上不表示已经替用户运行过真实 dot/Muse → Codex 编码任务，也不表示所有云端平台的自动唤醒已经联通。实际使用前仍要在目标机器接好编程工具及工作区，完成供应商登录和必要授权；云端 Events、Muse 设备配对及平台审核独立验收。任务示例与使用步骤见 `docs/mixed-cloud-coding-teams.zh.md`。
