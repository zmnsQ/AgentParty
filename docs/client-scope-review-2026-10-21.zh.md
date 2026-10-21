# 客户端范围隔离复核（2026-10-21）

基于原开发分支的 `b215c4ba0522412cf2cfb70f4d844617519e6418`。保留其并发、撤销、GitHub 不确定结果处理以及全部既有测试，不覆盖并行开发历史。补丁独立保存，目标为 `feat/personal-agent-collaboration`，不直接合并主分支。

## 本补丁的改进

- **服务器也属于工作区边界**：群组、账号、服务器或客户端实例变化，重建整个协作工作区，清空旧列表、未发送提示词和凭据表单。React key 为不包含 token 的随机值。
- **失去权限即撤下旧界面**：兼容 `AuthError`、`ForbiddenError` 和 `CollaborationApiError` 的 401/403，清除缓存数据及操作控件。旧群请求的迟到鉴权错误不会登出新群/新账号。
- **阻止上传后的跨服务器请求**：文件上传完成后重新检查当前服务器与组件有效性，避免旧 token 被后续自动投递请求带向新服务器；文件队列不继续运行。即使服务器已改变但 React 尚未重渲染，也会拦截后续请求。
- **尊重上传权限变化**：上传期间权限被收回，不再自动投递，也不上传下一个文件。独立文件面板切换群组时同样立即清空旧列表。

已经在途的上传无法保证取消，已完成的文件可能仍在原群空间；本改动不声称撤回外部 HTTP 请求、删除已共享文件或永久 exactly-once。

## 执行验证

macOS ARM64，Node 24.11.1，Bun 1.4.3，现有锁文件依赖。实际运行 `bun run check:commons`，最终退出码 **0**：

| 层 | 通过 |
| --- | --- |
| 供应商 / GitHub loopback HTTP 契约 | 49 |
| Worker、D1、DO、R2 与权限 | 121 |
| Web / 桌面共用界面 | 178 |
| CLI 配置与进程隔离 | 101 |
| fork 配置 | 4 |
| **总计** | **453 / 453，27 个文件，无跳过** |

本补丁新增 11 项 UI 回归；相对最初 400 项预览检查，整合后累计新增 53 项。Shared / Worker / Web / CLI TypeScript、Vite 生产构建、迁移编号和 diff 检查通过。原 LICENSE、NOTICE、锁文件、生产后端和 workflow 均未被本补丁修改。

本次最终整合运行通过，但不代表测试稳定性问题消失：此前审查曾遇到已有 Hermes loopback 用例超出原有 1000 ms 限时，根因未确认；相关失败与重跑记录保留在前面的验证报告。本补丁没有增加生产超时、降低断言或跳过测试。Vite 原主包仍有超过 500 kB 的警告。

## 仍然不是正式交付

原开发分支需要数据库迁移 `0048_collaboration_lease_fencing.sql`；升级前应暂停新任务/发布并排空旧处理器，不能让不识别持有者令牌的旧版本继续写入。本补丁没有操作生产数据库。

完整后台调度与预算、OAuth / MCP Events、真实 Hermes / Manus / dot / Muse / Grok 账号联调、GitHub App 授权和产品内真实发布验收仍未完成。此次运行的是 Web / Worker / CLI 测试，没有进行 Tauri Rust 编译、macOS / Windows 原生安装包验收、签名公证或生产部署，也没有触发 GitHub Actions。

机器可读结果：[client-scope-2026-10-21.json](validation/client-scope-2026-10-21.json)。此前完整改进记录见 [第二轮审查](commons-hardening-2026-10-21.zh.md) 与 [验证记录](commons-validation.md)。
