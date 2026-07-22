# Agent Room Window

> 类型：contract
> Canonical sources：`.ai/plans/agent-room-redesign-prd-spec-plan.md`、`DESIGN.md`、`src/services/agentRoomService.ts`

## 职责与非职责

- 负责独立 `agent-room` 窗口的房间切换、执行成员、任务动态、派发与内嵌审批。
- 只消费 Tauri command/event 暴露的脱敏投影，不读取主窗口 Store、DOM、Token 或完整 Session Transcript。
- 不负责 Agent/Connector 全局管理、Workspace Grid 持久化或窗口生命周期的 Rust 实现。

## 稳定契约

- Message 是任务动态一级对象，Run 是其子项；Event 只用于合并回复和状态投影。
- Session 打开必须携带明确 `sessionId`；发送成功前不清空输入。
- 独立窗口重获焦点时重新读取快照，Tauri Event 只提供低延迟更新。

## 依赖边界

- 允许依赖 `app/types`、`services/agentRoomService`、通用 UI/图标和 Tauri 当前窗口 API。
- 禁止依赖 `workspace-grid` Store 或旧 `AgentRoomPane` 组件。

## 验证

```powershell
pnpm -C apps/kimi-shell exec vitest run src/features/agent-room
pnpm -C apps/kimi-shell exec tsc --noEmit
```
