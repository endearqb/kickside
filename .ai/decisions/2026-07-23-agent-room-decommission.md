# Agent Room 下线与冻结

## Status

Accepted

## Decision

- Agent Room 实验终止。产品不再提供设置项、标题栏入口、独立窗口、Workspace Grid Pane、Tauri Event Pump 或可启用的 Bridge Admin 路由。
- Shell 与 Bridge 分别 fail closed：历史 `agentRoomEnabled=true`、`KIMI_AGENT_ROOM_ENABLED=true` 和内部 `Options.AgentRoomEnabled=true` 都不能重新启用功能。
- 已持久化的 Agent Room Grid Pane 在 V2 state 和 saved layout 加载时被丢弃；slot、active 与 maximized 引用由既有 sanitizer 修复。V2 key 与输入类型暂留一个发布周期，退出条件是所有支持升级的版本都完成一次加载归一。
- Tauri `agent_room_*`、`set_agent_room_enabled`、`BridgeStatus.agentRoom` 与 Go 内部实现暂留为不可启用的兼容墓碑，避免滚动升级期间出现未定义行为。退出条件是上述 V2 兼容周期结束且 release gate 证明无旧客户端依赖。
- SQLite migration 0014–0019、`user_version=19` 和已有 Profile/Room/Run/Event/Approval/Observation 数据原位惰性保留；不 DROP、不 downgrade、不自动删除，也不纳入 Connector prune。
- 共享的 IM ExecutionService、Session lease、approval link、turn origin、Runtime adapter 与普通 Connector 行为不随 Agent Room 删除。
- 恢复该能力必须建立新的 Accepted ADR、产品 Gate 和数据兼容方案；不得重新打开旧 Feature Flag。

本决策取代 Agent Room persistence、admin-api、shell-contract、observer-checkpoint、runtime-state、member-binding、workflow-contract、workspace-grid-v2、window-contract、app-toggle ADR 中的活跃产品约束，并撤销 Draft `2026-07-22-workspace-grid-v3-agent-room-exit.md`。历史决策正文继续作为审计记录。

## Rationale

完整回滚会破坏已发布的 migration 与用户数据，也会误删普通 IM 已复用的执行基础设施。双端 fail-closed、删除全部产品入口并保留惰性历史数据，是最小且可验证的安全下线路径。

## Consequences

- 旧 Agent Room 数据不再更新，运行中 Run/Queue 状态可能停留在最后一次持久化值，不伪造 terminal 结果。
- 旧 Shell 或手工环境变量无法恢复 HTTP route、Observer、Dispatcher recovery 或窗口。
- 冻结期仍保留部分零调用兼容代码；不得在其中新增功能。达到退出条件后以独立删除变更移除。

## Verification

- Go 负向测试证明环境变量与 `Options.AgentRoomEnabled=true` 均保持 disabled，且 Observer 不启动。
- TypeScript 测试证明标题栏无入口，旧 Agent Room Pane 被移除并修复布局引用。
- `tsc --noEmit`、Shell 定向 Vitest、Go test、Rust check/test 与 capability/command registry gate 覆盖结构和回归。
