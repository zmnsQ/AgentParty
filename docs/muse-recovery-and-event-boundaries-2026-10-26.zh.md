# Muse 凭证恢复与事件桥边界（2026-10-26）

本次基于 `codex/web-design-system` 的 `0d0fbce0`（包含已部署 OAuth 修补 `a5874b4e`）。仅代码改动与本地验证，不代表生产部署或真实 Muse 端到端验收。

## 已有事实与未确认部分

- MCP access token 有效期 600 秒；refresh token 有效期 7 天。此前省略 `client_id` 的原生客户端 refresh 兼容修补已存在，本次保留。
- 用户报告 Muse 安全凭证库在过期后仍显示「已添加凭证」，授权卡不能再次打开。这是客户端现象；没有生产请求日志就不能断言原因，也不能在本仓库修复 Muse App。
- 不把长期延长 access TTL、新建 Client ID、修改 MCP URL 或删除原授权当作恢复办法。不把短期 access token 写入轮询任务。

## 本次服务端可控修复

刷新在同一个 D1 batch 内轮换 grant 和 agent token。此前 agent token 缺失、被撤销或不匹配时，第二个 UPDATE 影响零行并不触发事务回滚，可能先消耗 refresh，再因身份更新失败返回错误，使新凭证未交付。现在首个 CAS 同时验证关联身份，拒绝时保持 grant 不变；并发 refresh 仍仅允许一个成功，不接受旧 refresh 重放，不扩张 scope。

连接面板区分有效服务端凭证、需要客户端续期、需要重新授权及未授权；有效期以外也检查关联 token 身份。服务端状态始终不等于 Muse 已保存凭证、客户端可用或事件实时唤醒已经验证。原 `native_authorized` 字段保留兼容，新界面使用 `native_oauth`。

## 事件唤醒不等于最终完成

桥接仍由 Agent Commons 签名 webhook 驱动，只读取指定消息后投递官方 Gadget CLI；不靠定时拉群消息触发。显式 opt-in 才允许指定 agent 来源，默认不扩大 human-only 行为。防重复、回复链过滤、发送预算及状态持久化是有界保护，并非证明任何 agent 系统不会产生新根任务循环。

自动续订是显式启用选项，失败必须保留错误和原到期时间，不能伪报持续连接。CLI 接受/发送成功不是 Muse 完成任务；匹配群内回复仅表示观察到回复，业务成功仍需检查内容及真实结果。不自动配对、不注册真实订阅、不发送测试消息。

## 验证边界

回归覆盖凭证过期、成功轮换、并发只允许一个成功、关联身份异常不消耗 refresh、权限不扩张以及状态转换；Python 使用隔离临时 SQLite 和模拟 HTTP/CLI，网页测试使用模拟响应。生产日志、Muse Vault 恢复和真实 Gadget 投递需用户后续在真实环境验收，不能用单元测试代替。

### 本次本地执行结果

- `python3 -m unittest -v test_bridge.py`：19 项通过。
- `python3 worker/test/oauth-refresh-sql.test.py`：一个参数化测试的 6 类 SQL 场景和 replay 检查通过。
- `bun test src/components/MuseCloudPanel.test.tsx`：7 项通过。
- Web 和 Worker 的 `tsc --noEmit`、Web `vite build` 通过；构建存在既有大 chunk 提示。
- Cloudflare Vitest 在输出 RUN 后、实际用例开始前退出 137。可写日志目录、单 worker 和限制 Node heap 的重试仍未完成；原因未确认，不能声称集成回归通过。新增 Vitest 用例待正常 workerd 环境执行。没有运行真实 Muse 端到端测试。
