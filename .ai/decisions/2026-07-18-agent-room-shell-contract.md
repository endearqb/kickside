# Agent Room Shell Contract

## Status

Accepted

## Decision

- Bridge Admin API 的 camelCase JSON 是 Agent Room 跨进程契约的事实来源。Rust 与 TypeScript 只做等价映射，不维护另一套业务模型或对话事实。
- 新增命令统一使用 `agent_room_*` 前缀，注册到 Tauri command registry，并只加入 `main-command-access`。prefill 与 workspace-import 窗口不得获得 Agent Room 权限。
- Observer 阶段冻结以下最小命令：`agent_room_list_agents`、`agent_room_create_agent`、`agent_room_list_rooms`、`agent_room_get_room`、`agent_room_post_message`、`agent_room_abort_run`、`agent_room_resolve_approval`、`agent_room_sync_pane_sessions`、`agent_room_get_capabilities`、`agent_room_list_observations`、`agent_room_poll_events`、`agent_room_open_session`。后续 CRUD 命令只能以同前缀增量加入。
- Shell 只向主窗口发出 `agent-room-events` 和 `agent-room-pump-status`。事件批次包含 Bridge 返回的 `items`、`nextSeq`、`hasMore` 与服务端时间；状态事件只包含可展示状态、Cursor、generation/重试信息和脱敏错误。
- Event Pump 的 Cursor 由 Rust 进程内单调推进；Bridge 重启后继续使用当前 Cursor，Shell 重启从 0 重放并由稳定 Event ID/Sequence 去重。若 Bridge 返回 `cursor_too_old`，Pump 明确进入需要重新同步的降级状态，不猜测或静默跳过。
- Rust Client 的普通请求超时保持短时；事件长轮询使用独立且严格大于 `waitMs=25000` 的超时。错误必须保留 HTTP status、Bridge `code`、`details` 与 `requestId`，但不得包含 Admin token、请求头或未脱敏响应体。
- React 不持有 Bridge Client、Runtime Client、locator 或任何 token。Admin token 只存在于 Rust Bridge 生命周期状态并用于 loopback 请求。
- Agent Room 复用现有 Bridge sidecar 与数据库。确保 Agent Room 可用可以启动已有 sidecar，但不得自动启用、创建或修改任何 Connector。
- Feature Flag 默认关闭。Observer MVP Gate 通过前，`post_message`、`abort_run` 等 Forward 命令即使已注册，也必须返回明确的 capability/feature 降级，不得主动调度。
- Phase 9 增量接受 `BridgeApprovalRecord.platform` 使用独立加法枚举并新增 `agent_room`，不扩张 Connector 专用 `BridgePlatform`；既有 main-only `list_bridge_approvals` 因而可读取 Room Approval。`agent_room_resolve_approval` 在调用既有 resolve 链前必须确认 Approval 的 platform 为 `agent_room`。不新增前端 token/API 入口。
- Phase 9 诊断只对既有 `BridgeStatus.agentRoom` 加法增加 `databaseVersion`、`activeLeases`、`pendingApprovals` 与 `paneGeneration`；旧 Shell 忽略新字段，新 Shell 对旧 Bridge 使用 serde/TypeScript 默认值。字段不得包含路径、prompt、request payload、token 或 Runtime 原始错误。

## Rationale

- 命令名、事件名和序列化字段一旦被 React 使用就成为单向门；先冻结可防止 Rust、TypeScript 与 Go 漂移。
- Token 留在 Rust 内可维持现有安全边界；把 Bridge 作为唯一持久化入口可避免 Shell 复制协作状态。
- 独立长轮询超时和单调 Cursor 是断线、重启和批次分页时不漏事件的最小可靠实现。

## Consequences

- `commands/agent_room.rs`、`bridge_http_client.rs`、Rust/TS types、command registry 与 main permission 必须同步变更并由 registry 检查验证。
- `agent_room_open_session` 只负责解析并聚焦/打开现有 Workspace Session Pane；它不得隐式选择 `sessions[0]` 或创建不精确 Session。
- Forward 命令的注册不等于产品开放；Gate 与 capability 检查仍是强制条件。
- Event Pump 不新增依赖，不在磁盘持久化 Admin token 或前端 Cursor。

## Verification

- Rust mock HTTP 测试覆盖 envelope、legacy bare JSON、分页、长轮询超时、typed error/details/requestId 和 token 脱敏。
- 命令测试与 `check_command_registry.mjs` 验证注册、main-only 权限及受限窗口拒绝。
- Pump 测试覆盖分页、重复批次、Cursor 单调、Bridge stop/restart、取消、退避和 `cursor_too_old` 降级。
- React 测试验证所有 Agent Room 调用只经过 Tauri command/event，源码与构建产物 token scan 不出现 Admin token。
