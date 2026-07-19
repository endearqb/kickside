# Agent Room Persistence Schema

## Status

Accepted

## Decision

- Bridge DB 只增不改地增加 `0014_agent_room_core.sql`、`0015_agent_room_events.sql`、`0016_agent_room_observation_and_queue.sql`，并把 Store `userVersion` 从 13 提升到 16。旧 migration 不修改，也不提供自动 downgrade。
- `0014` 持久化 Agent Profile、Room、Member 与 Message。`agent_profiles` 增加 `revision INTEGER NOT NULL DEFAULT 1`，由 Store 使用 `agent_id + revision` 做乐观锁；Member 保存 Profile 的角色、控制项和自动审批快照，删除 Profile 时仅把 Member `agent_id` 置空。
- `0015` 持久化 Run、Room Event、event compaction watermark 与 `agent_room_approval_links`。Approval Link 以既有 `approval_requests.approval_id` 为主键，保存可空的 Room、Member、Agent、Run、Session 与 `origin_kind` 关联；这样不改旧 Approval 表，重复执行 migration 仍安全。Room Event 不声明 Room 外键，删除 Room 后保留事件审计投影；Message、Member 与 Run 仍随 Room 级联删除。
- `0016` 持久化 Session Watch Cursor、Session Observation、Pane Session Observation 与 Session Prompt Queue。Cursor 与 Observation 都保存 Runtime `epoch`，以支持 journal 重建后的 `resync_required(epoch_changed)`。Lease 继续复用 `bridge_sessions.lease_owner/lease_expires_at`，不新增第二套所有权表。
- 每个 migration 在独立 SQLite 事务中应用。migration SQL 与其中的 `PRAGMA user_version` 必须共同提交；任何语句失败都回滚该 migration，不影响此前已完成版本。
- Store 将 SQLite 连接池限制为单连接，确保 `foreign_keys`、`busy_timeout` 等 connection-local PRAGMA 对所有 Store 操作一致生效。
- Store 对 JSON 列只接受有效 JSON，并写入规范的空对象/数组默认值；未知 Runtime Control 字段在 Service 校验层拒绝。所有时间使用既有 RFC3339 UTC 字符串约定。
- Agent Room 不复制 Runtime Session transcript。Message 保存用户协作输入，Event 保存增量投影和引用，Run 保存 Session/Turn/Prompt 归属。
- Connector prune 白名单不增加任何 `agent_*`、Observation、Queue 或 Approval Link 表。删除 Room 不删除 `bridge_sessions` 或 Runtime Session。
- 新表和索引使用 `IF NOT EXISTS`。版本 16 DB 可被旧二进制打开并忽略新表；Feature Flag 关闭时不产生 Agent Room 行为。

## Rationale

- Profile revision 是 PLAN AR-301 的明确验收条件，必须在首次 schema 中落定，避免随后追加补丁 migration。
- Approval 的 Room/Run/Session 归属需要跨重启恢复；独立映射表比修改已有 Approval 表更易幂等，也不改变既有 IM Approval 查询和序列化契约。
- Cursor 只表示消费位置，不能表达 Runtime 当前状态；独立 Session Observation 表使 Observer 恢复与 Pane Projection 职责分离。
- 单 migration 事务是 migration 失败回滚测试和升级安全的最低保证。

## Consequences

- Profile 更新方必须携带期望 revision；成功更新后 revision 加一，冲突返回稳定的 optimistic-lock 错误。
- 删除 Room 后，其 Message、Member、Run、Queue 与 Approval Link 关系按外键规则清理，但 Room Event 仍可按 sequence/session 查询；UI 不再把已删除 Room 的事件显示为活动 Room。
- Approval Store 创建带 Agent Room 关联的 Ticket 时必须在同一事务中写入 Ticket 与 Link；没有 Room 关联的既有 IM Approval 不创建 Link。Link 不对旧 Approval 表声明外键，避免 Connector prune 通过级联间接修改 Agent Room 表；读取时以 Approval 为主表联接，孤立 Link 仅保留到 Room 删除或 Doctor 清理。
- Observation、Queue 和 Lease 的运行机制仍按 PLAN 顺序在 AR-201/202 与 AR-400 之后实现；本决策只冻结持久化契约。
- migration 16 之后若改变字段语义或索引契约，必须新增 migration 与 Accepted ADR，不能回写 0014–0016。

## Verification

- Fresh DB 验证 `user_version=16`、全部表/索引与外键行为。
- 由版本 13 fixture（包含 Connector、Binding、Approval、Turn、Event 与 Session）升级到 16，并验证原数据和新 CRUD。
- 注入失败 migration，验证该 migration 的 schema 与 `user_version` 均回滚。
- 重复执行 0014–0016 SQL，验证无错误且不重复数据。
- Connector prune、Room/Profile 删除、Approval Link、Profile revision 冲突和 Session metadata 保留均有 Store 测试。
