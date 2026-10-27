# Muse Gadget 优先接入（本地实现，尚未配对）

本轮基于移动界面提交 `d9a45e4`，在 `feat/muse-gadget-20261026` 开发。未推送、未部署、未安装 SDK、未创建凭据、未执行个人设备配对，也没有发送外部测试消息。旧 Muse OAuth / MCP 授权不删除，改为可选兼容入口。

## 官方接口依据

2026-10-26 复核官方 `facebookincubator/muse-gadget-sdk` HEAD `c9354b7a765cfb7dd3c4f1945a9ca838d871630c`：

- [Linux README](https://github.com/facebookincubator/muse-gadget-sdk/blob/c9354b7a765cfb7dd3c4f1945a9ca838d871630c/linux/README.md)：设备支持 `system.run`、`file.read`、`file.write`；由安装账户权限决定可访问范围。
- [CLI](https://github.com/facebookincubator/muse-gadget-sdk/blob/c9354b7a765cfb7dd3c4f1945a9ca838d871630c/linux/src/musegadget/cli.py)：`musegadget send-user-msg --session-id <固定UUID> -` 从标准输入读取消息，固定 session 用于独立 side chat。
- 这不是 Muse Code SDK，也不是自建一个调用 Muse 模型的机器人。Gadget 是本人 Muse 的设备入口；SDK 服务保持连接不代表每个消息已获模型接单或完成。

## 新路径与权限边界

群内明确 @ → 已签名事件 → 本地持久队列与身份筛选 → 官方 Gadget side chat → Muse 经 `system.run` 调本地受限回复客户端 → 固定群、固定原消息回帖 → 读回确认。

本地桥接继续使用 Agent Commons 自己的群 API / 事件协议；**Muse App 不需要添加 Agent Commons MCP 连接器**。没有定时轮询群消息；本地工作队列等待与订阅续期不是消息轮询。

回复客户端只获得短期、单任务能力票据，不获得群访问凭据。票据不得分享或粘贴公共频道；只在被授权任务 side chat 与受限本地接口中使用。投递成功、回复提交未知、群内回帖已观察到与任务语义完成是不同状态。

## 明天接入顺序

1. 准备独立 Linux 设备。官方当前流程要求 Bluetooth LE、支持的 Linux、SDK token，以及本人 Muse App 的 Developer mode / Add Device。无蓝牙的普通云 VPS 不能直接假定可走该配对流程。先阅读 SDK 条款与安装脚本。
2. 由本人在官方界面获取 SDK token、确认设备配对。不要把 token 发给助手或群聊。SDK 安装可能需要管理员安装权限，但 **Muse 的 `run_as` 执行账户必须无 sudo**；不要使用 Agent Commons 生产 root 账户。
3. 分离两个 OS 账户：桥接服务持有单群普通 agent 凭据、签名 secret、SQLite 状态；Gadget 命令账户只能执行只读的回复客户端并访问回复 socket。它不能读取桥接环境文件、SQLite、源配置或其它账户文件。
4. 管理员自行建立仅这两个账户使用的 socket 共享组与受限目录，核对权限；代码不会自动创建账户、添加组或扩大系统权限。同 UID 运行不提供凭据隔离，不可把这种开发配置宣称为安全生产配置。
5. 依照 `bridges/muse-cloud/README.md` 配置并先运行本地测试。启动 bridge 与受控 HTTPS `/events` 入口后，由本人明确执行订阅；不要公开回复 socket 或整个本地 health 端口。
6. 默认只接人类明确 @。只有本人批准的同群 agent 才能加入精确 allowlist；自身、未知 agent、带 reply_to 的 agent 接力默认拒绝。回复不产生新 @，有单跳与频率预算，但不声称能识别 agent 把旧任务改写成新根任务。
7. 本人发送一个真实且无敏感内容的任务，核对同群回帖、原消息关联、无重复、重启后去重，再决定正式使用。首次实际测试应由本人发起，本轮未代发测试。

## 不做的事情

不自动删除旧授权；不绕 Muse Vault；不读私人聊天；不安装后台服务、不配对、不创建凭据；不自动批准设备命令；不以 CLI 退出码冒充 Muse ACK 或任务完成；不把失败转为无限重试或加长 OAuth TTL。

## 验证

- Python 桥接 31 项测试通过：签名、隔离、去重、默认拒绝 agent、预算/续订、任务票据期限与固定路由、未知结果只读核对、固定身份/正文读回、子进程环境去密钥、socket 清理不删替换路径、SIGTERM 正常退出、已验证回帖终态不降级。
- UI 13 项测试、Web TypeScript、生产构建通过；构建保留既有大 bundle 告警。
- 全量 Web：1510 pass / 32 fail。此前移动 UI 基线 1509 pass / 32 fail；失败名称集合完全一致，没有新增失败，不将遗留失败说成全绿。
- `doctor` 使用合成配置离线验证通过，输出 `pairing_verified:false`、`account_isolation_verified:false`。
- 当前沙箱禁止创建 AF_UNIX socket（PermissionError），未绕过；socket 协议和清理用替身测试，**未完成真实 IPC 联调**。
- 真实 Muse 设备配对、跨 OS 账户 socket 权限、个人会话触发、群 API 端到端和生产回帖仍需本人接入后验收。未声称实时接通。
- 独立最终代码审查批准本地提交；复跑 31 项 Python 测试通过，不包含发布或实机验收。
