# Agent Room Dedicated Window Contract

## Status

Accepted

## Decision

- Agent Room 使用单例 Tauri Webview Window，稳定 label 为 `agent-room`，路由为 `index.html#/agent-room`。窗口默认隐藏、非置顶；用户关闭时只隐藏，不停止 Room、Run、Bridge 或 Runtime。
- `agent-room` 使用独立 capability `agent-room-command-access`。它只获得 Room/Member/Run/Approval/Observation 的必要命令与窗口控制权限；Agent、Connector、Pane Session 同步、安装、Secrets、Workspace 文件读写继续只允许 `main`。
- Agent Room Event Pump 只定向投递到已存在的 `main` 与 `agent-room`。不得使用全应用广播；`prefill` 与 `workspace-import-picker` 不接收 Agent Room payload。
- Event 投递是低延迟通道，不是事实来源。窗口显示或重新获得焦点时必须重新读取 Room、Timeline、Observation、Approval 与 Capability 快照。
- Event Cursor 只有在至少一个已存在目标成功接收后推进。单个目标失败不得阻塞另一个目标；所有失败诊断继续脱敏。
- 主窗口 Pane Session Publisher 由 Agent Room capability 可用性驱动，不再依赖 Grid 中存在 `agent_room` Pane。`agent_room_sync_pane_sessions` 仍只允许 `main`。
- 既有 `GET /api/v1/agent-room/observations` envelope 加法返回 `panes: PaneSessionObservation[]`，复用已持久化的 Pane Projection；旧客户端忽略该字段。独立窗口据此识别 active/visible/shelved Session，不读取或猜测主窗口 Store。
- `agent_room_toggle_window`、`agent_room_show_window`、`agent_room_hide_window` 是窗口生命周期薄命令，不承载 Room 业务逻辑。
- MVP 不持久化窗口几何或 `lastRoomId`。窗口存活期间保留当前 Room；应用重启后选择最近更新的活动 Room。只有真实 Dogfood 证明跨重启恢复有价值时，才另行接受版本化 preference ADR。
- 本决策只增量扩展窗口、command、event 与 Observation page 契约，不修改 Go 数据库 Schema、Room wire model 或 Runtime 协议。

本决策取代 `2026-07-18-agent-room-shell-contract.md` 中“Agent Room 命令只加入 `main-command-access`”和“事件只向主窗口发送”两条；其余 Token、命名、Cursor、错误与 Feature Flag 约束继续有效。

## Rationale

- 独立窗口只有在权限和事件边界同步拆分时才成立；复用 `main` 全权限会扩大攻击面。
- 快照恢复使窗口隐藏、事件漏投和 Sidecar 重启不依赖脆弱的前端常驻状态。
- 不建立通用多窗口框架、不新增依赖，也不提前创建持久化 preference，可保持 Phase 1–2 的最小可回滚实现。

## Consequences

- `tauri.conf.json`、capability、permission、build manifest、command registry 与 Rust/TypeScript service 必须同步。
- 旧 Grid Agent Room Pane 在 Product Gate 前继续保留，作为回滚与能力兼容入口。
- `main` 可调用全部既有 Agent Room commands；`agent-room` 只能调用显式 allow-list。
- Feature Flag 默认关闭；关闭时不会持续同步 Pane Session，也不会改变 Code、Chat 或 External Pane 行为。

## Verification

- command registry 校验 `agent-room-command-access` 的精确 allow-list，并证明受限窗口没有 `main-command-access`。
- Rust 测试覆盖稳定 window label、show/hide/toggle 状态规则、定向目标集合与 Cursor 推进条件。
- React 测试覆盖独立 route 不启动 Shell controller、窗口快照恢复、Room 创建/切换、归档只读、Composer 发送和精确 Session 打开。
- G3 手工验证关闭等于隐藏、置顶为临时状态、主窗口隐藏时准确打开 Session，以及事件漏投后的快照恢复。
