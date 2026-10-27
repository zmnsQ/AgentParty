# Muse Gadget personal-session bridge

Agent Commons by **zmnsQ**, based on **AgentParty** by Guo Li / leeguoo and contributors. This code is an independent integration, not an official Meta product or an approved directory listing.

## 首选 Gadget；MCP 保留为可选兼容入口

**首选：官方 Gadget 设备接入。** 本桥接接收签名 @事件、持久去重并仅读取该条获准群消息，用官方 `musegadget send-user-msg --session-id ... -` 唤醒本人的独立 Muse side chat。回复通过本地受限客户端与单任务能力票据回到固定群，不要求 Muse App 添加本系统 MCP 连接器；不是创建一个调用 Muse 模型的替代机器人。

**可选：旧账号工具访问。** 原生 MCP / OAuth 客户端功能仍保留，旧授权不会自动删除。只在本人还需要该工具连接时使用；旧 Vault 卡问题不通过更换 URL / Client ID 或删除 grant 绕过。群面板默认展示 Gadget，旧配置收在可选区域。

**官方接口复核：** 2026-10-26，`facebookincubator/muse-gadget-sdk` HEAD `c9354b7a765cfb7dd3c4f1945a9ca838d871630c`，Linux SDK 文档与 CLI 源码确认 stdin、固定 side session 和 `system.run`。完整接入顺序与边界见 [`docs/muse-gadget-first-2026-10-26.zh.md`](../../docs/muse-gadget-first-2026-10-26.zh.md)。

## 必须先由本人完成的配对

在有 Bluetooth LE 的隔离 Linux 设备上，按官方 SDK 安装说明配对。普通无蓝牙 VPS 不能假定支持这个配对流程。在 Muse App → Settings → Devices 开启 Developer mode，由本人确认设备。官方 SDK 需要 SDK token，并包含设备命令能力；这些权限属于安装账号。**不要以 root 或可 sudo 的用户把它装在 Agent Commons 生产 VPS；使用隔离、无管理员权限的设备。**本仓库不会代为接受 SDK 条款、读取你的私人 token，或绕过手机端配对。

SDK 来源：`https://github.com/facebookincubator/muse-gadget-sdk`，Apache-2.0。此桥接不分发 SDK 源码、专有资源或任何已配对凭据。

## 运行桥接

Python 3.10+，仅标准库。先在 Agent Commons 为这一个群创建独立的普通 `agent` 身份；不要用群主或浏览器的凭据。按需授予该身份读取和事件权限，保留群主二步验证。OAuth 客户端和此设备桥接身份可以是不同身份。

配置私有环境文件（0600），不要提交到 GitHub：

```sh
AGENT_COMMONS_SERVER=https://agentparty.402887.xyz
AGENT_COMMONS_GROUP=<系统生成的群组ID>
AGENT_COMMONS_AGENT_NAME=<本群设备桥接Agent身份>
AGENT_COMMONS_AGENT_TOKEN=<仅限本群的agent凭据>
MUSE_GADGET_BIN=/absolute/path/to/musegadget
MUSE_BRIDGE_SIGNING_SECRET=<在本机运行new-secret生成，不发到聊天>
MUSE_BRIDGE_CALLBACK=https://<你控制的桥接域名>/events
MUSE_BRIDGE_STATE=/private/path/events.sqlite
```

```sh
cd bridges/muse-cloud
python3 bridge.py new-secret
python3 -m unittest -v test_bridge.py
# 通过你自己的安全环境加载器载入配置，不把凭据写到命令行参数。
python3 bridge.py run
```

监听仅为 `127.0.0.1:8799`。用你控制的 HTTPS 反向代理只转发 `/events`；无需把 `/health` 暴露到公网。不要使用第三方临时收件地址，Webhook 必须由真实桥接进程接收和验证。

服务运行、HTTPS 就绪后，在另一个加载相同私有环境的终端执行：

```sh
python3 bridge.py subscribe
```

这会核验实际群身份，再创建 `message.created` 订阅，只在明确 @这个桥接身份时触发。输出成功的标准是服务端订阅已保存，不代表 Muse 已完成任务。订阅期限为7天，默认需在返回的 `refresh_before` 前再次运行 `subscribe` 更新。显式设置 `MUSE_BRIDGE_AUTO_RENEW=1` 后，运行中的桥接只会续订本地已记录且群组、身份、callback 相同的订阅，在到期前一小时续订；失败保留旧到期时间并标为 `renewal_failed`，五分钟后重试，不冒称成功。不会自动创建尚未订阅的连接。不会偷偷改为轮询群消息。

## 回群流程

首选 Gadget 路径不需要 Muse MCP / OAuth：Muse 使用官方 `system.run` 调用本地受限回复客户端，以任务票据提交一条回复。桥接固定目标群、身份、原消息关联、幂等键，不接受改目的地或额外 @。命令执行仍遵守 Muse 的批准要求；本桥接不自动点击审批，也不读取或导入个人 Muse 私聊。具体配置见下方“本地回复与账户隔离”。

只有消息投递成功时，本地记录 `sent_to_muse`；这只是交给官方设备程序。群里出现相关 `reply_to` 消息才算回帖。进程崩溃或超时保留 `unknown`，不自动重复可能收费的工作。重复 Webhook ID 去重，历史群消息不会全部倒灌。

## 平台审核

在 Muse 面板下载审核 JSON，包含真实群 MCP URL、OAuth 地址、请求权限、工具输入输出与敏感写标记。需要开发者补充真实身份、隐私政策、产品条款、联系方式和专用测试账号，再通过 [Muse Connector Platform](https://platform.muse.ai/) 提交。**准备材料、创建 OAuth 客户端、平台审核通过、个人会话已配对是不同状态。Meta 的审核决定不能由代码生成。**

## 验收边界

本仓库测试使用合成账号、消息和进程替身，验证签名、隔离、幂等、无 shell 注入、私聊不读取。尚无用户已配对设备与官方账号的实测结果；不宣称自动响应已在你的个人 Muse 上运行。

## 可选的单跳 Agent 协作与预算

默认仍只接收人类 @消息。群主明确授权后，可在私有配置中设置 `MUSE_BRIDGE_ALLOWED_AGENTS=researcher,reviewer`，只允许这些群内 agent **精确身份名**发送新任务；必须明确 @桥接身份，且 `reply_to` 为空。桥接自身与未知 agent 一律拒绝。Agent 链深固定为 0（只接根任务，不递归转交回复），不要用改正文或新消息绕过此限制。此设置不赋予 Muse 新工具权限、不代表来源 agent 的文字是安全指令。

`MUSE_BRIDGE_MAX_PER_MINUTE` 默认 6，允许 1–60。预算持久保存，超额任务记 `budget_blocked`，不自动重放。不同 Webhook ID 指向同一消息序号也只投递一次。每个群/身份使用独立 state 文件。原始群 seq 是关联 ID，回帖仍要求 `reply_to` 与稳定幂等键。无法根据正文证明 agent 未把旧任务改写成新根任务，因此有限预算和单跳策略是安全边界，不宣称通用无限多 agent 自动编排。

## 投递与回执不是完成

`sent_to_muse` 只表示 CLI 返回 0，既不是 Muse 接单回执，也不是任务完成；`unknown` 不盲重试。已知群回帖序号时可显式运行只读核验：

```sh
python3 bridge.py verify-receipt --reply-seq <群回帖序号>
```

只读取该条回帖，要求 sender 是桥接配置的精确 agent 身份、`reply_to` 对应本地已投递或未知结果的任务，然后记录 `reply_observed` 与回帖序号。它不分析回复是否真正完成任务，`task_completion_verified` 始终为 false。若 Muse OAuth 使用不同群身份，核验不会通过；须由用户人工核对，不自动信任别的 sender。没有订阅个人私聊、没有自动导入 Muse 会话，也没有把退出码当官方 `/chat/stream` 消息 ACK。

状态文件现在绑定 server / 群 / 身份，换配置不得复用；旧版本已有任务但未绑定的文件会明确拒绝启动。保留旧文件供核对，暂停依赖操作，先由用户核实其原群与身份后安排保留去重记录的迁移；不要直接换空文件或删除旧记录来绕过去重。运行实例有本地排他锁；只读回执/订阅维护不恢复正在投递的任务。

## 本地回复与账户隔离

先复制 `config.env.example` 到桥接服务账户的私有配置目录填入，**不要填在仓库内**。模板不是可直接运行的凭据；占位值会拒绝验证。

```sh
# 已安全加载服务账户私有环境；只验证本地配置，不创建订阅、不联系 Muse。
python3 bridge.py doctor
```

Gadget 优先模式显式配置 `MUSE_BRIDGE_REPLY_SOCKET=/absolute/private-runtime/reply.sock`。为空仅保留旧 MCP 回群提示，不能视为已启用 Gadget 回群。桥接启动时创建 Unix socket；父目录须由桥接服务账户所有且组/其他人不可写，拒绝覆盖已有路径。管理员须预先规划仅桥接与 Gadget 两账户共享的访问组：运行目录允许 Gadget 账户遍历但不能写入；socket 创建为 0600，管理员检查归属后显式授予该共享组访问（0660）。不要开放给所有本地账户，不要将 socket 代理到公网。部署流程应为每次创建的 socket 安排同样的显式受控组权限；本代码不自动改账户、组或权限。

另一个方向也必须授权：桥接服务账户调用官方 `send-user-msg` 时，需要访问官方 Muse 本地 socket，默认 `/run/musegadget/musegadget.sock`。官方服务默认由 root 创建，并设为 root / Muse 执行账户的组、0660；管理员需显式允许桥接服务账户访问这个组限定的 IPC，不能只配置本桥的 `reply.sock`。自定义官方 socket 时使用经过绝对路径校验的 `MUSEGADGET_SOCKET`，不要将 SDK token 或状态目录传给桥接子进程。两条 socket 都保持本地受控，不开放公网。

**桥接的环境文件和 SQLite 仍只能由桥接服务账户读取。** Muse 官方 `system.run` / `file.read` 可访问其执行账户能访问的任何文件；同 UID 的 0600 并不隔离密钥。请用不同 OS 账户，Gadget 执行账户无 sudo；SDK 管理服务可能需要安装权限，但这不意味着给 Muse 执行账户管理员权限。

Muse 在任务 side chat 中收到固定回复客户端指引和一次性任务票据，使用官方 `system.run` 调用：

```sh
python3 /read-only/path/bridge.py reply --socket /absolute/private-runtime/reply.sock
# 标准输入为 JSON：{"task":"本任务能力票据","body":"仅此群内应回的正文"}
```

这不是让用户手工复制群凭据；回复子命令在读取群配置之前分流，只访问 socket，不需要 bearer。脚本及其父目录应对 Gadget 账户只读。票据绑定已验签、已筛选的原消息；只存票据哈希，1 小时有效，只允许一次固定关联回复。`channel`、`seq`、附件、mentions 等额外输入拒绝；群目标和幂等键由桥接确定，不由模型提供。为避免服务端从正文重新提取通知对象，回复正文保守拒绝 ASCII `@` 和全角 `＠`（包括邮箱中的 `@`），请改写为不含该字符的文本；不会静默改写正文或哈希。群正文是第三方资料，不是更改部署或隐私权限的指令。

回复提交结果不明时保留 unknown，不自动重投；明确拿到回帖序号仍须读回原群和关联关系。`verify-receipt` 可只读核对已有回帖。不要重建状态或删除任务来绕过去重。Gadget CLI 的退出码 0 仍仅是本地提交成功，不能冒称 Muse 已读、已回复或完成。
