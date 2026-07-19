# Agent Room Runtime State and Observation Pins

## Status

Accepted

## Decision

- 新增只增 migration `0017_agent_room_runtime_state.sql`，Store `userVersion` 从 16 提升到 17；不修改 0014–0016。
- `agent_room_runtime_state` 使用 singleton row 保存全局 `pane_generation`、规范化 Pane snapshot 的 SHA-256 `pane_snapshot_hash` 与 `updated_at`。空 Pane snapshot 也必须推进 generation。
- Pane Sync 在单事务内比较 generation/hash、upsert 当前完整 snapshot、删除已消失 Pane 并更新 singleton。较旧 generation 返回 `stale_generation`；相同 generation + 相同 hash 幂等成功；相同 generation + 不同 hash 返回 `generation_conflict`。
- `agent_room_observation_pins` 以 `session_id` 为主键保存显式 watch 意图和时间。Pin 只接受已有 `bridge_sessions` 的准确 Session；unpin 幂等。Pin 不等于已经观察，也不伪造 `session_observations`。
- Pane snapshot hash 只包含协议字段，按 `paneId` 排序后使用 Go 标准库 JSON 编码和 SHA-256；不包含 token、URL fragment、日志或完整 Session 内容。

## Rationale

- 0016 把 generation 仅保存在 Pane 行上；空 snapshot 删除全部行后无法证明已接受的 generation，旧 Shell snapshot 可回流。
- 同 generation 的 retry 需要区分幂等重试与矛盾 payload，不能依赖更新时间或随机 DB 行顺序。
- SPEC 的全局 observation pin endpoint 没有 roomId，不能等价映射为某个 Room Member；独立 watch intent 是最小且准确的持久化语义。

## Consequences

- DB 当前版本变为 17；旧二进制继续忽略新表，新二进制可从任意既有 0–16 版本顺序升级。
- Pin endpoint 在 Observer 未运行时仍可成功持久化意图，但响应和 capabilities 必须明确 `observerRunning=false`；实际 Observation 仍由 Phase 4 worker 产生。
- Observer 生命周期后续以 Pane effective Sessions、正式 Room Members 和 observation pins 的并集为 watch set。

## Verification

- Fresh DB 与 16→17 fixture 验证表、singleton、外键和 `user_version=17`。
- Pane Sync 测试覆盖空 snapshot generation、stale、same-generation idempotent/conflict、乱序、activeSession 优先、snapshot stale-row deletion。
- Pin/unpin 测试覆盖精确 Session、missing Session、幂等、重启后恢复和 Session 删除级联。
