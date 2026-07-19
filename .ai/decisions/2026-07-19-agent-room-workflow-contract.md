# Agent Room Workflow V1 Contract

## Status

Accepted

## Decision

- Workflow V1 复用既有 Agent Room Message、Run、Event、Session Lease、FIFO Queue 与 `ExecutionService`，不建立第二套执行器、Queue、模板数据库或 Prompt DSL。一个 `mode=workflow` 的 source Message 同时是一次 Workflow execution；完整且不可变的 definition snapshot 保存于 Message `metadata_json.workflowDefinition`。
- Bridge DB 只增不改地新增 `0019_agent_room_workflow.sql`：建立 `agent_workflow_runs(run_id PRIMARY KEY, source_message_id, stage_id)` 映射表与 `(source_message_id, stage_id)` 索引；Store `userVersion` 提升到 19。旧 migration 不修改，也不自动 downgrade。独立映射表使 migration 可重复执行，也让旧二进制继续忽略 Workflow 数据。
- Workflow definition version V1 固定为 `"1"`，包含 1–16 个显式 Stage，总 Run 数为 1–32。Stage ID 必须非空且唯一；target Member 必须属于当前 Room；dependency 必须存在、去重、不得自依赖或成环。`aggregation` V1 只接受 `all`，`failurePolicy` 只接受 `continue | stop | require_user`。
- `promptTemplate` 是固定 Stage instruction，不做变量插值。原始用户任务、Room shared brief、角色快照和 dependency summaries 继续由统一 Prompt Assembly 生成；下游只引用同 Room、已 completed 的显式 upstream Run，并遵守既有 summary 总计 64 KiB 上限，不复制完整 Session transcript。
- 创建 Workflow 时一次性创建固定数量的 Run：根 Stage 为 `queued`，其余为 `waiting_dependency`。Stage 仅在全部 dependency 满足后通过状态 CAS 推进；`continue` 允许已完成结果继续，`stop` 将未开始的后继 Run 标记为 `blocked`，`require_user` 将后继 Run标记为 `waiting_user`。人工 resolve 只接受 `continue | stop`，并持久化结果和审计 Event。
- Engine 只响应已存在 Workflow Run 的终态，不响应 Agent reply 或任意 Room Event 生成新 Message/Run。重复、乱序或 ExecutionService/Observer 双重终态通知必须通过 CAS 保持幂等；重启时由 definition snapshot 与非终态 Run 重新推导。
- Admin API 复用 `POST /api/v1/agent-room/rooms/{roomId}/messages`，增量增加 `workflowDefinition`。`mode=workflow` 缺少合法 definition 时 fail closed 为 `workflow_definition_required`；direct/parallel 携带 definition 时拒绝。新增唯一动作端点 `POST /api/v1/agent-room/rooms/{roomId}/workflows/{messageId}/resolve`。
- Rust/Tauri/TypeScript 契约只做对应 additive field 与一个 main-only resolve command。内置 Parallel Review、Architect→Developer→Reviewer、Research→Critic→Synthesizer 模板是前端静态纯数据，必须由用户明确映射每个 Stage 的 Member；Custom 只允许显式 Stage/dependency 编辑。

## Rationale

- Message 与 Run 已具备 Room 归属、精确 Session、Lease、Queue、Abort、重启恢复和 bounded reply projection，复用它们可保持单一执行真相并避免双重调度状态。
- `agent_workflow_runs` 是恢复、索引和 Timeline 推导所需的最小 schema 增量；definition 与 Stage 不需要独立可变实体或可变表。
- 预先创建且限制最多 32 个 Run，加上只由终态 CAS 推进，是防止递归 Bot Loop 与重复派发的结构性边界。

## Consequences

- 在 Workflow Engine 可用前，任何 `mode=workflow` 请求都必须 fail closed，不能再静默退化成 parallel。
- Timeline 可从 Message definition 与 Run stage/status 推导可访问的 Stage 进度，不新增 GET endpoint 或图形依赖。
- `waiting_dependency`、`waiting_user` 与 `blocked` 成为持久 Run 状态；普通 direct/parallel 的既有状态与行为不变。
- migration 19 之后如改变 definition、状态或 resolve 语义，必须新增 migration/ADR，不能回写 0019。

## Verification

- 表驱动验证重复/缺失/self/cyclic dependency、非法 aggregation/policy、未知 Member、16 Stage/32 Run 边界。
- Fake Runtime 覆盖线性、并行、同 Member 跨 Stage、三种 failure policy、显式 summary refs、重复/乱序终态、重启恢复和 no-loop 上界。
- Admin、Rust serde/command、TypeScript template/progress tests 覆盖增量契约；最后运行完整 Go、Rust、pnpm、command registry/capability/bundle Gates。
