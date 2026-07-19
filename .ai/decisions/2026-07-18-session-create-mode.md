# Explicit Session Create Mode

## Status

Accepted

## Decision

- `runtime.EnsureSessionRequest` 增量增加 `createMode`，取值为 `if_missing | always | resume_exact | reuse_latest`；字段缺省时按 `if_missing` 处理，保持既有调用方兼容。
- `always` 忽略 Workspace 中已有 Session 并创建新 Session；不得同时传入 Session ID。
- `resume_exact` 必须传入 Session ID，只执行准确查询；不存在或查询失败时返回错误，不创建替代 Session。
- `reuse_latest` 必须显式调用；它保留既有 Workspace Session 列表首项复用语义，并在 Workspace 没有 Session 时创建一个。
- `if_missing` 仅供既有 IM Binding 恢复兼容：有 Session ID 时先准确恢复；没有 ID 时保留既有“复用 Workspace 首项，否则创建”的行为。Runtime Provider 只有在该模式下才允许清除失效的旧 ID 后重试；新 IM Binding 使用 `always`，不进入该兼容路径。
- Agent Room 的 `per_room` 首次解析与 `new_per_task` 使用 `always`；`persistent` 与 `resume_selected` 使用 `resume_exact`。Agent Room 不使用 `if_missing` 或隐式 Workspace 首项复用。
- Server Adapter 返回实际 Session ID、Workspace ID、可得的 Workspace Root、Session Source 与 Runtime Adapter；创建响应缺失 Workspace 字段时使用已经验证的请求 Workspace 作为返回回退，不猜测其他 Workspace。

## Rationale

- 既有 Server Adapter 在只提供 Workspace 时直接选择 `sessions[0]`，会让独立 Agent 或任务共享同一执行上下文。
- 单一布尔值无法同时表达兼容恢复、强制新建、精确恢复与显式复用；四个有限模式让调用方意图可测试且拒绝矛盾输入。
- 保留缺省 `if_missing` 避免现有 IM Binding 在滚动升级中改变 Session 行为，同时把 Agent Room 的严格策略与兼容路径隔离。

## Consequences

- `createMode` 是只增不改的 camelCase JSON 字段；旧调用方和旧 settings 不需要迁移。
- `always` 与 `resume_exact` 的失败不会回退到其他 Session；调用方必须显式处理错误。
- `reuse_latest`/`if_missing` 仍依赖 Runtime Session 列表顺序，只允许用于兼容或用户明确选择的复用路径，不作为 Agent Room 默认策略。
- ACP/SDK Adapter 不是 Agent Room 的严格 Session 隔离路径；Agent Room 在 Server capability 不可用时明确降级，不静默切换 Provider。

## Verification

- Server Adapter 表驱动测试覆盖未知模式、矛盾输入、`always` 连续创建、`resume_exact` 成功/不存在、`reuse_latest` 与缺省 `if_missing` 的多 Session 行为。
- Runtime Provider 测试覆盖现有 IM 显式使用 `if_missing`，并证明 `resume_exact` 失败时不会执行旧的清 ID 重绑。
- Phase 1 Gate 运行 `go test -count=1 ./...`、`go vet ./...`，并在可用环境执行 race、Rust 与 Shell 回归。
