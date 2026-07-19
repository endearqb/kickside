# Agent Room Member Binding 与 Follow Pane 原子更新

## Status

Accepted

## Decision

- `AgentRoomMemberPatchInput` 以可选 `binding` 增量扩展；不新增 endpoint 或 Tauri command。`binding.followMode` 只接受 `pin_session | follow_pane`：前者必须同时给出准确 `pinnedSessionId + workspaceRoot`，后者必须给出准确 `followedPaneId`。
- Binding 更新必须在 Store 单事务内重新读取 Room、Member、Pane 与 Session，验证 Room 未归档、目标 Session 存在且 Workspace 精确匹配后，一次写入 `follow_mode/followed_pane_id/pinned_session_id/effective_session_id/workspace_root/session_policy/status` 以及同 PATCH 的显示名、AutoApprove、Runtime Controls。任一校验失败不改变旧 Member。
- Rebind 保留 `member_kind`、`agent_id`、Role Prompt snapshot 与创建时间；它修复 Member 的执行绑定，不改变 Member 来源。显式 rebind 后 `session_policy=resume_selected`。
- 完整 Pane snapshot 与 `pane_session_observations`、所有 `follow_mode=follow_pane` Member projection 在同一 SQLite 事务更新。Pane 指向已知且 Workspace 一致的 Session 时，Member 使用 Session 表的权威 Workspace 与 effective Session；Session 不存在、Workspace 不匹配或 Pane 从快照消失时，清空 effective Session 并分别标记 `session_unresolved`、`workspace_mismatch`、`pane_unavailable`，不得继续保留旧 Session 冒充跟随成功。
- `agent_room_members` 现有表结构与 status 文本列足以承载该状态，不新增 migration。Admin/Tauri/TS 仅做 additive optional field；旧调用方和旧 payload 行为不变。

## Rationale

- 前端 delete+create 会产生丢 Member 窗口，并可能撞上 `(room_id, agent_id)` 唯一约束，不能满足原子修复。
- 创建时只解析一次 Pane 会让 `follow_pane` 在 Pane 切换 Session 后静默指向旧 Session，违反准确 Session 与单一事实来源约束。
- 复用现有 PATCH 比新增 repair endpoint/command 更小；把校验与写入集中在 Store 事务可避免 Service 多次查询之间的竞态。

## Consequences

- React 可为 Workspace mismatch、Pane unavailable 和 Session unresolved 显示明确修复入口，但必须要求用户选择准确 Pane 或 Session/Workspace，不得隐式选择第一条 Session。
- Followed Member 在 Pane 关闭后不再作为旧 Session 的观察来源；用户若要继续固定旧 Session，必须显式切换为 `pin_session`。
- Forward resolver 必须只使用 Member 当前的 `effectiveSessionId/workspaceRoot`；状态非 `idle` 或 effective Session 为空时 fail closed。

## Verification

- Store 测试覆盖同一 snapshot 内 Pane A→Session B 后 Member 原子更新、Pane 删除、未知 Session、Workspace mismatch，以及失败后旧绑定不被部分修改。
- Service/Admin/Rust/TS 契约测试覆盖 pin/follow rebind payload、归档拒绝与 structured error。
- React 测试覆盖从 Agent/Pane/固定 Session 添加、观察状态派生、Remove、显式 repair，并断言不调用 Message/Forward API。
