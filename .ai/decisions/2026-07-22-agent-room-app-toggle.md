# Agent Room App Toggle

## Status

Accepted

## Decision

- Agent Room 的用户可配置 Feature Flag 以 `settings.json` 中的 `AppSettings.agentRoomEnabled` 为唯一真值，默认值为 `false`。
- 开关位于“小助手设置”的独立 `Agent Room` 项，放在“默认工作目录”和“外部 IM 通道”之间。
- Shell 启动 Bridge 子进程时必须把持久化值显式映射为 `KIMI_AGENT_ROOM_ENABLED=1/0`。该环境变量是 Shell 到 Go sidecar 的内部传输契约，不再是用户配置入口，外部进程环境不得覆盖应用内设置。
- 切换开关时，正在 `running` 或 `degraded` 的 Bridge 自动重启以应用路由能力；已停止或崩溃的 Bridge 保持原状态。关闭时同时停止 Agent Room Event Pump 并隐藏独立窗口。
- 主窗口标题栏入口仅在开关开启、当前页面为 Workspace 且至少存在一个 `kind === "code"` 的 Kimi Code Pane 时显示。
- `set_agent_room_enabled` 只允许 `main` capability 调用；独立 Agent Room 窗口不得修改自身 Feature Flag。

本决策取代 `2026-07-18-agent-room-shell-contract.md` 和 `2026-07-22-agent-room-window-contract.md` 中把 Feature Flag 视为外部环境配置的部分；其余默认关闭、安全、窗口与 Product Gate 约束继续有效。

## Rationale

应用内开关让安装版用户无需配置启动进程环境，同时保持默认关闭和现有 Go 路由门禁。复用 `AppSettings` 与现有 Control Center Toggle 避免引入第二套偏好存储或新组件。

## Consequences

- Settings schema 从 10 升至 11；旧设置缺少字段时按 `false` 迁移。
- 运行中切换会短暂重启本地 Bridge；设置项必须明确提示该行为。
- Bridge 停止时，本地 `BridgeStatus.agentRoom.enabled` 仍反映持久化值，保证标题栏和设置页状态一致。
- 命令注册表、build manifest、main capability allow-list、README 与架构事实必须同步。

## Verification

- Rust 验证旧设置默认关闭、显式开启可序列化回读，并验证 Bridge 生命周期测试。
- TypeScript 验证设置页类型与标题栏“开关 + Kimi Code Pane”双条件。
- `pnpm check:nfr:security` 验证新命令只进入 main allow-list 且所有注册表同步。
