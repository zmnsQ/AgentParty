# 消息状态链审计 — 2026-10-28

基线：`5f9400ba`。范围：网页收发、REST 历史补拉、WS 重连、消息去重、阅读位置，以及本次指定的 3 个既有测试失败。不访问真实账号、不做浏览器/服务器部署；本报告不是全仓无缺陷声明。

## 实际调用链

- `Channel.loadInitialPage` → `fetchMessagesWithRetry` → reducer；seed `initialCursorRef` 后创建 `ChannelSocket`，`welcome` → `hello(since,since_rev)`。
- WS `msg/status/message_update` → Channel 过滤窗口下界及历史提醒 → 通知/角标 → `channelReducer/applyFrame`。
- `Channel.send` → `ChannelSocket.send`；只有成功交给 transport 才记录 pending；`sent`/server rejection 驱动既有 pending 草稿处理。发送不是业务完成回执，本次不更改此边界。
- 上翻 `loadOlder` → REST before oldest seq → reducer；dispatch 前采样阅读位置，layout effect + `conversationScroll` 恢复锚点。图片/窗口变化由 geometry observer 更新；未做真实浏览器实拍。
- WS 断线使用 jitter/backoff；心跳超时主动关闭；401 探测及 fatal 保持原协议，不新增轮询服务。

## 可复现缺陷与修复

| 缺陷 | 原证据 | 修复与回归 |
|---|---|---|
| 已 dispose/旧 WS 迟到 callback 仍可更新界面或重启 heartbeat | `ws.onopen/onmessage/onclose` 没有当前实例/生命周期检查 | 三类回调检查 disposed/current socket；dispose 摘回调；重复 connect 不生成竞争 socket。保存旧 callback 后调用的测试确保无 frame/status/hello 副作用，新 socket 正常接收。 |
| 重复同 seq 的消息使桌面未读角标递增，聚焦已读后还能被重复帧恢复 | toast/系统通知有独立 seq Set，badge 无去重 | `nextMentionBadgeCountOnce` 使用频道级独立 Set；读数清零不清已消费记忆；新频道独立 Set。重复、不同 sender 新 seq、已读和前后台切换均覆盖。 |
| 历史 REST/迟到 revision 回滚较新编辑甚至撤回正文 | reducer same seq 只判断是否修订，无 rev_seq 顺序检查 | 已加载版本的 rev_seq 更高则忽略整个旧消息事件；原始消息按 rev 0，保留无版本旧协议行为。旧 REST/live 更新、新 revision 和单条去重测试。 |
| 旧 token 的分页成功/401 在 token 变化/重试后仍可写状态、滚动或触发登出 | loadOlder 无 generation guard，finally 也会清新 loading | 独立 older generation；token/slug cleanup 与 initial retry 失效旧请求；success/error/finally 同一守卫；旧 rAF 不清新锚。deferred 旧成功和 401 测试，正常当前成功/失败保留。 |

## 指定既有失败分类（没有删掉语义断言）

1. TeamBoard：期望文字 `★ 主持`，实际已用 `StudioIcon name=star`。改为在真实 active-host badge 中同时断言星形组件和“主持”文字，仍核所有泳道/角色/任务/仓库内容。
2. Channel loading：空状态已抽到 `ChannelWelcome`，原断言在 Channel 找退休文案。保留 skeleton、bootstrap/无消息条件和恢复控制；补真实 welcome 挂载、提示及连接按钮断言。
3. Channel i18n：退休 `Channel.empty.partyWatch` 已被欢迎区取代。保留旧词典可用性，另验证真实 welcome 三个新键在中英文不空/不相同且被组件调用；其余原审计键不变。

## 验证

134 tests / 887 assertions / 19 files 通过：ws、notify、latestRequest、state、conversationScroll、scrollPin、historyRecovery、api.history、Channel source guards、TeamBoard、Channel loading/i18n。

TypeScript `tsc --noEmit`、`git diff --check` 通过。日志：`/tmp/audit-message-suite.log`、`/tmp/audit-message-tsc.log`。以上是局部可重复验证；没有声称浏览器、生产消息或整仓全量测试全部通过。

## 后续：CloudBridges 接入操作竞态

仅修改 `CloudBridges.tsx` 和专门回归测试，未改 MuseCloudPanel。

- 修前新增测试实际复现 3/3 失败：同一个 render handler 同步提交两次会发两个 POST；仅切服务器地址仍保留旧草稿/忙状态；权限撤销后旧 handler 仍可发送。
- `task` 改用同步 ref 互斥；React busy 仍负责呈现。只有用户显式提交才调用远程操作，无自动测试消息。
- 对未明结果按本 scope + 相同 prompt 保留 request_id；HTTP 超时及返回 `unknown/submitting` 均不清草稿/幂等 ID。用户主动再次提交复用 ID，不自动重投。
- 捕获 token/slug/base/管理及执行权限的 generation；切换时清敏感输入、Cue 查询结果、配置快照、busy/提示/未决 ID。旧完成/error/finally 与旧 handler 均不得修改新 scope。reload 开始前也核 scope，防旧操作完成后拿旧 token 向新 base 发查询。
- 增补 token+群切换后旧 Cue 结果不得出现测试；服务器切换后新请求只发新地址、旧完成不清新草稿；权限恢复后无旧草稿。
- 44 tests / 201 assertions（CloudBridges race+guide、CollaborationHub）通过；tsc/diff 通过。日志 `/tmp/cloud-race-before.log`、`/tmp/cloud-race-suite.log`、`/tmp/cloud-race-tsc.log`。均为mock网络，不是真实连接验收。

### Review follow-up: credential refresh must not reset dispatch dedup

独立复核发现前述 UI scope 清理同时删除 request ID，静默续 token 会破坏未知提交幂等性。现已将提交安全 scope 与 UI generation 分离：

- UI scope仍覆盖token/群/base/权限，敏感输入和旧响应不跨scope。
- 提交scope仅绑定本组件生命周期内的base+群；保存随机盐SHA-256(prompt)→request ID及在途锁，不保存旧明文prompt、API Key、secret或token。
- 续token/权限变化不能解除在途提交锁；未知结果后重新手动输入相同prompt复用ID。旧请求返回不发布notice/error/草稿，仅释放同提交scope锁。换base/群或卸载不保留该缓存，不声称跨页面持久化去重。
- 两个新增回归覆盖unknown→token refresh→同prompt同ID、pending→refresh/权限变更→不双发且保持disabled。46 tests /210 assertions（Hub+CloudBridges）及TS/diff通过；日志`/tmp/cloud-refresh-suite.log`、`/tmp/cloud-refresh-tsc.log`。

### Parent-chain review follow-up: Hub token-key remount

前一轮直接CloudBridges update测试未覆盖真实 `CollaborationHub` token变化后key重挂，组件ref因此仍会丢未知提交ID。本轮将store提升至Channel，并保持原Hub清敏感数据的token key：

- `ownedGrokSubmissionSafety` 单槽内存按已知account+base+群管理；不同已知账号换store，绝不跨账号复用ID；account暂null不清原store，也不允许该未确定身份发送，恢复同account继续沿用。
- Channel透传store，CloudBridges订阅锁释放。旧组件卸载后，请求settle可以释放同store锁供新组件继续，但旧response/notice/草稿仍不可写新组件。
- Store本身仅随机盐、prompt摘要→ID与锁，不存凭据/明文；UI generation也包含store盐以隔离同token但不同owner store。没有全局registry或持久化，Channel本身彻底卸载后不承诺保留。
- 实际CollaborationHub集成回归（不是仅子组件update）：unknown→token刷新key重挂+account null过渡→同ID；在途→重挂→仍阻止重复并接收到释放；不同账号→新ID。49 tests /218 assertions通过，TS/diff通过，日志`/tmp/cloud-hub-suite.log`。
