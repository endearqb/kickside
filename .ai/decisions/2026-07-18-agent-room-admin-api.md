# Agent Room Admin API

## Status

Accepted

## Decision

- Agent Room Admin API 使用既有 loopback Bridge Admin server、`X-Bridge-Admin-Token` 常量时间校验和 `{ok,data,error,requestId}` envelope；固定命名空间为 `/api/v1/agent-room/*`。React 不访问该 API 或 token，后续仅由 Rust thin client 调用。
- 路由只在显式 `KIMI_AGENT_ROOM_ENABLED=true` 时挂载，缺省关闭；关闭时保持 404，不改变既有 Bridge、Connector 或发布行为。开启 flag 不自动启用任何外部 Connector。
- 本版本冻结 SPEC §19 的 Agents、Rooms、Members、Timeline、Messages、Runs、Pane Sync、Observations、Events 与 Capabilities 路径。资源创建返回 201，读取/更新/动作成功返回 200，删除成功返回 200 的 `{status:"deleted"}`；未知资源返回 404。
- 请求体沿用 Admin 1 MiB 上限并拒绝尾随 JSON；Event long poll 限制 `limit=1..500`、`waitMs=0..30000`，服务端 HTTP write timeout 必须大于最大 wait。所有 path/query 数值严格解析，未知或矛盾输入返回稳定 400 code。
- 错误码是增量序列化契约。Service validation 映射到 400；`*_not_found` 映射到 404；`revision_conflict`、`session_busy`、`lease_conflict`、`queue_full`、`abort_unconfirmed` 映射到 409；`cursor_too_old` 映射到 410；`server_provider_required` 与明确 capability degradation 映射到 503；未知内部错误返回通用 `internal_error`，不得把数据库、文件路径、token 或 Runtime 原始响应暴露给客户端。
- Phase 3 的 Message endpoint 只原子保存用户 Message 与每 target Run，不提交 Runtime Prompt；Forward Dispatch 必须在 Observer MVP Gate 后另行接线。Run abort 只调用 `MarkAbortRequested`，未确认 Runtime Abort 时不得宣称 aborted 或提交替代 Run；retry 只创建新 Run，不自动执行。
- Pane Sync 以单调 `generation` 接受完整 Pane snapshot；旧 generation 返回 `stale_generation`，同 generation 幂等，较新 generation upsert 当前 Pane 并删除旧 snapshot 中已消失的 Pane。`effectiveSessionId = activeSessionId ?? persistedSessionId` 必须由服务端复核，不能信任矛盾客户端字段。
- Observations GET 返回按 Session 去重的 projection。pin/unpin 通过 Accepted runtime-state ADR 的 `agent_room_observation_pins` 持久化 watch 意图；Observer worker 尚未运行时仍返回 `observerRunning=false`，不伪造 Observation 已产生。
- Capabilities 和 Bridge Status 必须报告实际状态。非 Server Runtime 或 locator 未 ready 时写型/Observer 能力为 false，并给出 `server_provider_required` degradation；不得因 SDK fallback 冒充 Agent Room 可执行。Status 增量增加 `agentRoom` summary：enabled/core/observer、activeRuns、queueDepth、observedSessions 和 degradation。
- Phase 9 接受对 `agentRoom` summary 的纯加法诊断字段：DB `user_version`、有效 Lease 数、Room pending Approval 数与 Pane snapshot generation。读取失败只加入稳定 degradation，不暴露 SQL、路径或原始 Runtime 错误；既有字段语义不变。

## Rationale

- 复用既有 Admin server 和 envelope 可保持鉴权、脱敏、rolling upgrade 与 Rust thin-client 范式一致。
- 将 persistence-only Dispatch 与 Runtime execution 分开，才能维持 Observer-before-Forward Gate，并让 Phase 3 curl Gate 在无真实 Runtime 写操作时可验证。
- 显式 feature flag 和 truthful capability degradation 防止半成品 UI/API 在用户现有工作流中被误用。
- Pane generation 与服务端 effective-session 复核避免乱序 Shell snapshot 把 Room Member 重新绑定到旧 Session。

## Consequences

- `admin.NewHandler` 保持既有调用兼容；新增可选 Agent Room routes 参数/构造入口，未提供时不挂路由。
- Bridge CLI 新增非秘密环境变量 `KIMI_AGENT_ROOM_ENABLED`；只有规范布尔值启用，缺省/空值为 false，非法值启动失败。
- Phase 3 Gate 可以完整 CRUD、创建 Message/Run、查询 Timeline 和 long poll Event，但不能据此声明 Observer MVP 或 Forward MVP 完成。
- 全局 Pane generation 与持久 watch/pin 由后续 Accepted `.ai/decisions/2026-07-18-agent-room-runtime-state.md` 和只增 migration 0017 承载，不修改 0014–0016。

## Verification

- Handler tests 覆盖 flag off 404、Admin auth、method/path/body limit、CRUD、revision conflict、delete confirm、partial targets、abort/retry、pane generation/effective Session、observations degradation、event long poll/cursor/page limit、capabilities 和错误脱敏。
- App/CLI tests 覆盖 flag 缺省关闭、true 开启、非法值拒绝、Status summary 与非 Server `server_provider_required`。
- Phase 3 Gate 运行 `go test -count=1 ./...`、`go vet ./...`；race 在具备 CGO/GCC 的 CI 或开发环境补跑。
