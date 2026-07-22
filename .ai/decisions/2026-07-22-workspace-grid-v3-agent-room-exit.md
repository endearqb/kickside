# Workspace Grid V3 Agent Room Pane Exit

## Status

Draft — blocked by the 7-day Agent Room Redesign Product Gate.

## Proposed Decision

- 只有 `.ai/plans/agent-room-redesign-prd-spec-plan.md` §13.2 Product Gate 通过，且独立窗口完成 Workflow、Agent、Connector 能力等价后，才实施 Grid V3。
- 新状态 key 为 `kimi-workspace-grid-state-v3`，新 Saved Layout key 为 `kimi-workspace-grid-saved-layouts-v3`；V2/V1/legacy key 永不回写或删除。
- 加载顺序为有效 V3 → 迁移 V2 → 迁移 V1/legacy → default。
- V2→V3 迁移是纯函数：删除 `kind="agent_room"` / `carrier="local"` Pane，将对应 Slot 置空，修复 active/maximized 引用，并逐字段保留所有其他 Pane、track 与时间戳。
- 从稳定顺序中的第一个有效旧 Agent Room Pane 提取 `roomId`，仅作为后续版本化 Window Preference 的候选；Room 不存在时不得伪造恢复成功。
- V3 当前类型移除 `agent_room`、`local` 与 `roomId`；V2 输入类型继续保留用于迁移和回滚。

## Gate To Accept

- 7 天内满足 PRD §13.2 至少两项使用条件；
- 没有 Session、Workspace 或 Approval 身份错配；
- 独立窗口 Phase 3 能力等价完成；
- V2 state 与 Saved Layout 迁移 fixtures 完成；
- G1 通过并完成真实旧 V2 布局的 G3 回滚验证。

## Rejected For Current Phase

- 不在 Phase 0–2 删除空窗格 Room 入口、`AgentRoomPane`、Grid kind/carrier 或 V2 key。
- 不以技术纵切通过代替 Product Gate。
