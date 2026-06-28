# Current State

## Shell Runtime
- `apps/kimi-shell` 是 Tauri v2 + React 桌面壳。
- 后端主路径已切到 `kimi server run --foreground --port <port>`。
- Shell 从 `KIMI_CODE_HOME/server.token` 读取 server token；若未设置 `KIMI_CODE_HOME`，默认使用用户目录下 `.kimi-code/server.token`。
- workspace URL 由 Shell 组装为 `http://127.0.0.1:<port>/#token=<token>`；对外状态只展示脱敏 token。
- `api_v1_client.rs` 已提供 `/api/v1` Bearer + envelope `{code,msg,data,request_id}` 解包薄客户端，workspace/session 调用已复用它。
- `workspace_session.rs` 使用 `GET /api/v1/sessions?page_size=100`、`POST /api/v1/workspaces { root }` 和 `POST /api/v1/sessions` 的最小映射；session 主键兼容官方 `id`，工作目录优先从 `metadata.cwd` 提取。
- Workspace Grid 前端已引入 `zustand` 切片，使用 Pane/Slot 分离模型、1/2/3/4/5/6 窗预设、逐缝拖拽 resize + 持久化自定义 track、命名布局保存/恢复、键盘切换、外部页自定义 URL + timeout fallback、嵌入式 Tauri 子 Webview 承载、独立应用 WebviewWindow fallback、native Webview per-pane `dataDirectory` namespace、mount policy 挂起/恢复和 6 窗上限；旧双窗 localStorage 键保留为迁移兼容层。
- Shell 已暴露 `grid_list_sessions` / `grid_create_session` Tauri command，薄封装既有 `/api/v1` session 建/查逻辑，Grid code pane 使用 server 返回的真实 session id 构造 `/sessions/{id}` URL。
- Workspace Grid 持久化 state 在加载/恢复时会归一化未知 preset、超限或重复 pane、幽灵 slot 引用和失效 active/maximized pane；Code session pane URL 会从运行时 workspace URL 保留 `#token=` bootstrap，但 token 不写入 persisted state。
- Shell 在配置目录写入 `kimi_runtime_locator.json`，包含 origin、token path、redacted token、generation、ownership 和 health，不包含明文 token。
- P1A/P1B 当前不再默认启动 workspace proxy；后端 ready 后的 session bootstrap 已恢复，但走 `/api/v1`。
- 安装主链路已从旧 uv/Python `kimi-cli` 切到 Kimi Code：quick/core 和 Kimi install 调官方 Windows installer，upgrade 调 `kimi upgrade`，core ready 只要求 Kimi CLI ready；旧 `backend_manager/install_compat.rs` 路径已删除，uv/Python 任务仅在新 install catalog 中保留为 legacy repair。
- Shell 会自动检测 Git Bash：优先复用现有 `KIMI_SHELL_PATH`，其次检查 Git for Windows 常见 `bash.exe` 路径，再回退 PATH `bash`；启动 `kimi server run` 时会向子进程注入 `KIMI_SHELL_PATH`，安装面板展示检测状态与路径。
- 控制中心运行诊断面板可手动执行 `kimi doctor`，返回 exit code、Kimi 路径、Shell 路径与脱敏 stdout/stderr；后端会注入检测到的 `KIMI_SHELL_PATH`。
- Bundled Bridge sidecar 已按当前 Go 源码重建到 `apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe`；本机 smoke 覆盖 token-file 启动、health/status envelope、runtime stop 和 stdout/stderr/log token redaction。

## IM Bridge
- `apps/kimi-im-bridge` 仍是 Shell 托管的 Go sidecar。
- Shell 启动 sidecar 时通过环境变量传 admin / host-control token，不再通过进程命令行传 secret。
- Go sidecar 支持 env、token-file 和旧 flag fallback。
- Go sidecar logger 注册 admin token、host-control token 和平台密钥并在写入前脱敏；Shell 侧托管的 sidecar stdout/stderr 通过 redactor 写入 bridge log，Bridge log tail 与启动失败摘要也会二次脱敏。
- Shell 通过 `--kimi-runtime-locator` 和 `KIMI_APP_RUNTIME_LOCATOR_FILE` 把 runtime locator 文件路径传给 sidecar；Bridge status 会报告 locator 是否配置、可读和 health。
- Bridge status 会报告 `runtimeAdapter`，当前根据 locator 推导 server adapter 的 `ready` / `degraded` / `unavailable` 状态。
- `internal/runtime` 已新增 `RuntimeAdapter` 契约和 `KimiCodeServerAdapter`，可通过 locator/token file 调 `/api/v1` workspace、session、prompt submit、prompt WS stream、pending approvals、resolve approval、abort prompt。
- `internal/runtime` 已新增 `SDKAdapter` wrapper，复用现有 SDK driver、session registry、turn runner 和 live approval coordinator。
- `internal/runtime` 已新增实验性 `ACPAdapter`，具备 stdio JSON-RPC transport 和 `initialize`、`session/new`、`session/resume`、`session/prompt`、`session/cancel` smoke；ACP manual approval 在当前 Bridge 进程内会等待 `ResolveApproval` 异步决策，但仍不具备跨重启恢复。
- `internal/providers/runtimeadapter` 已新增 server-backed bridgecore provider；Shell 提供可读 runtime locator 时，Bridge app wiring 优先选择该 provider，否则保留既有 SDK-backed provider fallback。
- Telegram/Feishu/Weixin channel adapters 的 orchestrator 主路径已避免预创建 synthetic session binding；新 binding 会先通过 server adapter ensure session，旧 synthetic binding 可在 server prompt run 后 rebind 到真实 server session id。
- `/api/v1/ws` 已接入 prompt 事件流的最小映射，覆盖 assistant/thinking delta、status、turn/prompt completion 和 approval requested/resolved。
- Server provider 可从 inbound `MetadataJSON` 的 `runtime_controls` / `controls` 映射 model、thinking、permission mode、plan、swarm 和 goal controls；未新增前端配置 UI。
- Server provider 已实现 pending approval reconcile：启动时按本地 pending、已知 server session 和 binding 查询 server pending，保留仍 pending 的审批、将 server 确认不存在的本地 pending 标为 `stale_failed`，并为同一 session 下 server-only pending 重建带 chat context 的本地 projection。
- Telegram 和 Feishu adapter 启动成功后会按 pending approval + delivery key 幂等重投递 approval card；Feishu 需要 binding 上存在 last inbound message id 来保持回复/线程上下文，Weixin 仍不提供 in-chat approval UI。
- Bridge admin `/api/v1/*` 当前返回 `{ ok, data, error, requestId }` envelope；Shell `bridge_http_client` 会解 envelope，并兼容旧裸 JSON。

## Known Gaps
- Shell 自有 UI 仍不提供独立 prompt composer 或全局 approval inbox；桌面主交互依赖官方 Kimi Code Web，Bridge approval 由 IM card 与 Bridge runtime panel 承载。
- ACPAdapter manual approval 仍无跨重启恢复，只能在当前 prompt/Bridge 进程存活期间异步 resolve；跨重启 approval 以 ServerAdapter 为主路径。
- P5 发布门禁仍需要真实 Telegram/Feishu/Weixin 凭证和安装包环境做手工验证。
