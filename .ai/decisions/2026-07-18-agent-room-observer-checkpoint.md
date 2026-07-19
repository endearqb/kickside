# Agent Room Observer Checkpoint

## Status

Accepted

## Decision

- 新增只增 migration `0018_agent_room_observer_checkpoint.sql`；不修改 0014–0017。
- `session_observer_runtime_state` 按准确 `session_id` 持久化已采用的 Runtime `generation`。Sequence 与 epoch 继续由 `session_watch_cursors` 保存，Session 展示投影继续由 `session_observations` 保存，避免重复事实列。
- Observer 只能通过 Store 的单事务批次入口推进状态。一个批次在同一事务内校验 generation/epoch/sequence，幂等插入 Room Event，更新已归属 Run 和 Session Observation，最后推进 Cursor 与 generation checkpoint。
- 同 generation/epoch 的 sequence 必须严格单调且连续；重复批次幂等返回，回退或缺口拒绝。generation 回退拒绝。epoch 改变必须标记为 REST reconcile 后才能采用。
- watch set 是 Pane effective Session、非归档 Room 正式 Member、非终态 Run、pending Approval link 和显式 pin 的去重并集。
- 无法准确归属的 Runtime 事件只形成 roomless Session Observation/runless Event，不伪造 Room Message、Member 或 AgentRun 来满足外键。

## Rationale

- Cursor、Observation、Event 和 Run 分事务写入会留下崩溃窗口：Cursor 可能越过未投影事件，或 reply delta 在重放时重复。
- generation 只存在于进程内时，Bridge 重启后无法拒绝旧 WebSocket 的延迟 Frame。
- Kimi Code Session 是唯一对话事实来源；为未知外部 Prompt 伪造 Room 数据会制造第二事实源。

## Consequences

- DB 当前版本变为 18；旧二进制忽略新表，新二进制可从任意既有 0–17 版本顺序升级。
- 旧的细粒度 Cursor/Observation 写入口保留给迁移测试与非 Observer 管理操作，但生产 Observer 不得调用它们。
- REST reconcile 在事务外获取准确 Session snapshot，再以 `reconciled=true` 的小批次原子采用；事务内不得执行网络 I/O。

## Verification

- Fresh DB 与 17→18 fixture 验证表、外键、级联删除和 `user_version=18`。
- Store 测试覆盖 duplicate、sequence regression/gap、generation regression、epoch conflict、reconcile、事件幂等和重启恢复。
- watch-set 测试分别覆盖 Pane、Member、Run、Approval、Pin 来源及去重。
