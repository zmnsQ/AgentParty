# Agent Commons：项目作者、双语界面与手机适配验收

日期：2026-10-22（Asia/Singapore）。功能分支：`feat/agent-commons-provider-bridges-20261021`。此文件记录实际完成的内容以及尚未完成的真实账号与设备验收，供后续代码审阅及部署。

## 项目归属的统一口径

**现项目名称：Agent Commons。作者、维护者：zmnsQ。**
**来源：基于 AgentParty 二次开发；原项目作者郭立（Guo Li / leeguoo / leeguooooo）和上游贡献者。**
**原许可证：BUSL-1.1。** 原 LICENSE 不改动；原项目 Git 历史与独立来源链接保留。

此口径已覆盖：登录页作者链接、群组页署名、设置帮助页、GitHub 初始化与验证器页面、OAuth 群组许可页、服务端 /api/health 与 /api/config 元数据、HTML meta author、README 中英版、NOTICE 与 Tauri Cargo authors 字段。特别避免把原作者姓名写成现项目作者。

所有新增署名词条位于 `web/src/i18n/strings/Attribution.ts`，提供 `en` / `zh` 对照，跟随用户语言切换。登录及验证器页面可独立切换语言，并把页面 html lang 改成 zh-CN/en。OAuth 群组授权页根据 Accept-Language 选择中英，不回显任何个人 secret 或代码批准权限。

## 手机端

重点针对横向空间与文字对齐进行了：
- 登录 / GitHub 初始化 / TOTP 认证页 600px 断点、合理的垂直滚动、iOS safe-area 与 16px 输入框（防自动缩放）、至少 44px 的主要交互目标；
- 协作空间 720px 断点，四标签栏局部横向滚动，不撑宽整个页面；群组标题、署名卡按单列排列；
- 连接器 / Grok Webhook / Cue API 表单单列、按钮全宽、长地址/授权键安全换行、撤销操作单独排列；
- 430px 以下 Agent 卡片、代码提案及文件操作按钮按单列或双等宽重新排版，代码 diff 为局部滚动；
- 深色/浅色共用原主题变量，避免新表单白底覆盖暗色主题。

### 真实渲染测量

通过独立、无登录信息的 **Chrome Headless DevTools Protocol** 模拟手机视口、运行生产构建的页面。屏幕尺寸：`320x844`、`375x844`、`390x844`、`768x844`；均观测到 `documentElement.scrollWidth===window.innerWidth`，即页面整体无横向溢出。浏览器登录面板 DOM 的标题、署名、登录卡片均在 320/375/390px 范围内。另用本地非生产、无用户数据的静态合成“平台接入”页面对四张接入卡做同样的断点测量，并检查中文表单与输入对齐；320px 标签栏局部横向滚动是预期行为。

以上是本机 Chrome 模拟视口验收，不宣称已在真实 iPhone Safari 和各 Android WebView 版本做完实机测试。移动端真实软键盘、安全区、屏幕旋转、系统放大字体仍建议在真实设备中检查。

## 本轮验证

执行 `bun run check:commons`，退出码 0，**587 项全部通过，46 个测试文件，无跳过**，分层：

| 契约 | Worker | Web | CLI | 配置 | Muse SDK | 总数 |
|---:|---:|---:|---:|---:|---:|---:|
| 53 | 224 | 189 | 111 | 4 | 6 | **587** |

包括 Shared / Worker / Web / CLI / Muse TypeScript，Vite 生产构建、迁移编号、数据隔离、OAuth/Events、平台适配器以及 `git diff --check`。新增 en/zh 作者身份回归、OAuth consent 中英测试、GitHub 登录 App 名称与作者校验，以及手机 CSS 宽度规则验证。原 `LICENSE` 和 GitHub Actions 工作流未改变。

## 后续真实接入与部署界限

[五个平台的实际接入步骤](agent-commons-onboarding.zh.md) 已归档。ChatGPT dot 插件需真实账号安装并确认 MCP Events 回调；Muse Cloud 需 Connector 平台审批；Muse Code SDK 需用户本机 muse host；Grok Automation Webhook 不等于指定 Grok Bot 完成任务；Cue 的私聊回复不能未经关联直接导入群组。

公网事件回调仍需部署者提供严格的 DNS/IP 出站保护；自动后台 outbox 刷新、真实个人 Agent 验收、App 原生签名仍未完成。不要把本轮测试通过视为这些能力已正式认证。
