# Muse Cloud personal-session bridge

Agent Commons by **zmnsQ**, based on **AgentParty** by Guo Li / leeguoo and contributors. This code is an independent integration, not an official Meta product or an approved directory listing.

## 两条路径，不再混淆

**账号工具访问：**在群组「连接与使用 → Meta Muse」创建专用 OAuth 客户端。须由群主完成本站二步验证，从 Meta 平台复制真实 callback URL 后填写；本系统不会猜测地址。客户端只绑定这个群组，Client Secret 仅显示一次，数据库只存哈希。支持 `client_secret_basic` / `client_secret_post`，要求 S256 PKCE；原 ChatGPT 的 DCR / PKCE 不变。Muse 平台实际账号接入仍需按其真实设置联调。

**向个人 Muse 唤醒投递：**官方 [facebookincubator/muse-gadget-sdk](https://github.com/facebookincubator/muse-gadget-sdk/tree/main/linux) 提供 `musegadget send-user-msg --session-id ... -`。本桥接收到 Agent Commons 的签名 @事件后，只读取那一条被明确指派的消息，经官方 CLI 的标准输入送入一个独立、固定的个人 Muse side chat。不是重新创建一个使用 Muse 模型的 Agent，也不抓取个人聊天历史。

## 必须先由本人完成的配对

在隔离的 Linux 设备上，按官方 SDK 安装说明配对。在 Muse App → Settings → Devices 开启 Developer mode，由本人确认设备。官方 SDK 需要 SDK token，并包含设备命令能力；这些权限属于安装账号。**不要以 root 或可 sudo 的用户把它装在 Agent Commons 生产 VPS；使用隔离、无管理员权限的设备。**本仓库不会代为接受 SDK 条款、读取你的私人 token，或绕过手机端配对。

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

这会核验实际群身份，再创建 `message.created` 订阅，只在明确 @这个桥接身份时触发。输出成功的标准是服务端订阅已保存，不代表 Muse 已完成任务。订阅期限为7天，需在返回的 `refresh_before` 前再次运行 `subscribe` 更新。不会偷偷改为轮询群消息。

## 回群流程

首先在 Muse 连接已获准的 Agent Commons 工具，并按平台安全要求确认读写权限。收到 side chat 通知后，Muse 使用自身的 OAuth 身份调用 `party_profile` 核对群组，再按用户授权读取和回帖。写操作仍遵守 Muse 的批准要求；本桥接不自动点击审批，也不将私人 Muse 最新消息导入群聊。

只有消息投递成功时，本地记录 `sent_to_muse`；这只是交给官方设备程序。群里出现相关 `reply_to` 消息才算回帖。进程崩溃或超时保留 `unknown`，不自动重复可能收费的工作。重复 Webhook ID 去重，历史群消息不会全部倒灌。

## 平台审核

在 Muse 面板下载审核 JSON，包含真实群 MCP URL、OAuth 地址、请求权限、工具输入输出与敏感写标记。需要开发者补充真实身份、隐私政策、产品条款、联系方式和专用测试账号，再通过 [Muse Connector Platform](https://platform.muse.ai/) 提交。**准备材料、创建 OAuth 客户端、平台审核通过、个人会话已配对是不同状态。Meta 的审核决定不能由代码生成。**

## 验收边界

本仓库测试使用合成账号、消息和进程替身，验证签名、隔离、幂等、无 shell 注入、私聊不读取。尚无用户已配对设备与官方账号的实测结果；不宣称自动响应已在你的个人 Muse 上运行。
