# Current State

## Shell Runtime
- `apps/kimi-shell` 是 Tauri v2 + React 桌面壳。
- 后端主路径使用 `kimi web --no-open --port <port>`；若同一 `KIMI_CODE_HOME` 已有通过本机地址、健康端点和 server token 验证的实例，Shell 复用其 lock 中的端口并标记为 `reused_external`，退出、普通停止和重新连接只解除连接、不终止外部进程；用户明确确认的升级/卸载任务可停止该实例，避免 Windows 可执行文件被锁定。
- Shell 从 `KIMI_CODE_HOME/server.token` 读取 server token；若未设置 `KIMI_CODE_HOME`，默认使用用户目录下 `.kimi-code/server.token`。
- workspace URL 由 Shell 组装为 `http://127.0.0.1:<port>/#token=<token>`；对外状态只展示脱敏 token。
- iframe/embed 导航通过专用 `get_workspace_embed_url` 获取 tokenized URL；`get_app_status` 与 `get_diagnostics` 只返回 redacted `workspaceUrl` 展示面。
- Tauri capability 已按窗口分层：`main` 保留 webview 创建权限和完整自定义 command 注册表；`prefill` 只允许 6 个启动监控/恢复 commands；`workspace-import-picker` 只允许 4 个导入 commands，并额外持有目录选择所需的 `dialog:allow-open`。外部 iframe 只允许内置 Kimi origin 与 `VITE_KIMI_EXTERNAL_FRAME_ALLOWLIST` 中的精确 origin。
- Tauri command 注册表已从 `lib.rs` 移到 `src-tauri/src/commands.rs`，按运行域分组；bridge、install、skills、workspace grid、context menu 和 workspace import 域 command 实现已迁到 `src-tauri/src/commands/` 子模块；`scripts/check_command_registry.mjs` 校验每个注册 command 有 domain owner、窗口 capability、用途说明，并同步检查 build manifest、分组 permission、capability 与 install compat commands 的退出登记。
- `api_v1_client.rs` 已提供 `/api/v1` Bearer + envelope `{code,msg,data,request_id}` 解包薄客户端，workspace/session 调用已复用它。
- `workspace_session.rs` 使用 `GET /api/v1/sessions?page_size=100`、`POST /api/v1/workspaces { root }` 和 `POST /api/v1/sessions` 的最小映射；session 主键兼容官方 `id`，工作目录优先从 `metadata.cwd` 提取。
- Workspace Grid 前端已引入 `zustand` 切片，使用 Pane/Slot 分离模型、1/2/3/4/5/6 窗预设、标题栏布局 popover、逐缝拖拽 resize + 持久化自定义 track、键盘切换、pane header 拖拽交换、iframe 内跨站 http(s) 链接系统浏览器打开、外部页 timeout fallback、嵌入式 Tauri 子 Webview 承载、独立应用 WebviewWindow fallback、native Webview per-pane `dataDirectory` namespace、mount policy 挂起/恢复和 6 窗上限；旧双窗 localStorage 键保留为迁移兼容层，Grid 内不再渲染自定义布局保存/恢复工具栏。
- Workspace Grid 的三窗预设是左侧主 pane + 右侧上下两 pane；空 pane 和 pane header 不再提供 Kimi.com 新建/切换入口，external pane carrier 仅保留兼容、fallback 与已保存布局渲染能力。
- Shell 已暴露 `grid_list_sessions` / `grid_get_session` / `grid_create_session` Tauri command，薄封装既有 `/api/v1` session 查单、列表与创建逻辑；当前 Grid UI 新建 Code pane 或把现有 pane 切换为 Code 时不再自动创建 session，而是打开 Kimi Code Web 根页面，旧持久化 pane 若已有 `sessionId` 仍会构造 `/sessions/{id}` URL。
- Workspace Grid 持久化 state 在加载/恢复时会归一化未知 preset、超限或重复 pane、幽灵 slot 引用和失效 active/maximized pane；Code pane 可保存历史 `workDir` 元数据，但 header “打开当前会话目录”以 pane iframe 当前路由为权威，按 session id 精确查询且失败时不回退缓存；pane 可保存独立 `light` / `dark` 主题，未设置独立主题的 pane 跟随全局主题；Code session pane URL 会从运行时 workspace URL 保留 `#token=` bootstrap，但 token 不写入 persisted state。
- Shell 前端已从 `useShellController.ts` 拆出安装流、轮询、Bridge 运行态刷新、Skill Center 状态/刷新、workspace embed URL 和 workspace import picker 控制器；Bridge 写操作与 Skill 动作 handler 仍在主 controller 中编排。
- Shell 在配置目录写入 `kimi_runtime_locator.json`，包含 origin、token path、redacted token、generation、ownership 和 health，不包含明文 token。
- P1A/P1B 当前不再默认启动 workspace proxy；后端 ready 后的 session bootstrap 已恢复，但走 `/api/v1`。
- 安装主链路已从旧 uv/Python `kimi-cli` 切到 Kimi Code：quick/core 和应用内首次安装走 npm 全局包 `@moonshot-ai/kimi-code`；升级会在修改 PATH 前捕获当前实际命中的 `kimi`，Windows 原生 `%USERPROFILE%\.kimi-code\bin\kimi.exe` 走官方安装脚本，npm/pnpm shim 按对应全局 bin 选择同源包管理器并精确验证，其他或歧义来源明确拒绝。npm 路径执行前要求 Node.js 22.19+，所有运行路径要求 Git for Windows/Git Bash 就绪。旧 `backend_manager/install_compat.rs` 路径已删除，uv/Python 任务仅在新 install catalog 中保留为 legacy repair。
- 安装兼容 Tauri commands `install_kimi_dependencies`、`install_kimi_code`、`upgrade_kimi_code`、`uninstall_kimi_code`、`install_nodejs` 仍在 `commands/install.rs` 注册为旧前端兼容层；主路径是 `start_install_task` + install catalog。退出条件：前端与已发布版本不再调用这些 compat commands 满一个发布周期后，移除 compat command 注册并通过 Shell G1 gate。
- Shell 会自动检测 Git Bash：优先复用有效的 `KIMI_SHELL_PATH`，再检查 PATH 中非 Windows 系统启动器的 `bash`、从 PATH `git.exe` 推导 Git 安装根目录，最后检查 Program Files 与 LocalAppData 常见 `bash.exe` 路径；启动 `kimi web --no-open` 时会向子进程注入 `KIMI_SHELL_PATH`，安装面板展示检测状态与路径。
- Explorer 右键菜单 label 可通过控制中心编辑，启用意图持久化在 `AppSettings` schema 10；禁用后启动自愈不会重新启用。注册表只保留 `Directory\\Background`、`Directory` 和 `*` 入口，旧 `AllFilesystemObjects` 键会清理，写删后通知 Explorer 刷新。
- Explorer 打开目录/文件使用有界、按 backend generation 归属的单消费者队列复用 `/api/v1` 创建独立 session；请求在确定完成前保留队首，运行中的后端不重启、不切全局 cwd。前端按 `new_pane` 路由，最多六个可见 pane、十二个总 pane，第七个换入 active slot，被替换 pane 进入 Pane Shelf。
- 控制中心的“小助手设置”以互斥折叠 bar 承载 Kimi Doctor；Doctor 返回 exit code、Kimi 路径、Shell 路径与脱敏 stdout/stderr，旧 `runtime_center` 路由兼容映射到自动展开的 Doctor bar。
- Kimi 后端 stdout/stderr 通过 Shell 管道在写入 `backend.log` 前脱敏，诊断读取再次脱敏；启动前会清理既有日志中的结构化 token 并写入带时间和 cycle 的启动边界。启动失败会验证 `web --help` 命令契约并区分单实例复用失败与一般配置问题，不使用 `--version` 文本推断 CLI 身份。
- Kimi API 配置 command 在异步阻塞任务中读写 `config.toml`；加载视图携带可选 opaque revision，保存会在写入前和原子替换前拒绝过期 revision，冲突时不覆盖外部文件。
- 控制中心的 Skill Center 与 WorkspaceHub 使用卡片目录进入只读文件详情；已注册工作区通过 `workspace_list_file_entries` / `workspace_read_file` 按 workspace id 解析根目录，并复用 Skill 文件预览的目录穿越、符号链接、隐藏目录、数量、大小和二进制保护。
- Bundled Bridge sidecar 已按当前 Go 源码重建到 `apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe`；本机 smoke 覆盖 token-file 启动、health/status envelope、runtime stop 和 stdout/stderr/log token redaction。
- Shell 已接入 Tauri v2 Updater：每个应用进程启动后后台检测一次，设置页支持手动重检和用户确认后的签名下载/安装；安装开始前走退出协调并停止 Kimi 后端与 IM Bridge，检查或下载失败不停止现有服务。
- GitHub `v*` tag 发布 workflow 校验 tag 与 `apps/kimi-shell/package.json` 版本一致，复用 Tauri `beforeBuildCommand` 构建 Bridge sidecar，并发布 NSIS/MSI、签名与 `latest.json`。installer-specific manifest 保留原安装器类型，legacy Windows 项优先 NSIS。

## IM Bridge
- `apps/kimi-im-bridge` 仍是 Shell 托管的 Go sidecar。
- Shell 控制中心只提供微信和飞书机器人；初始化时会幂等删除 Shell 管理的 Telegram connector 与对应 secrets。Go Bridge 的 Telegram adapter 仍保留，不属于本次 UI 支持面。
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
- Telegram/Feishu/Weixin Adapter 已统一使用 Connector 自身 `defaultWorkDir`，未配置 override 时回退 Bridge 全局值；Go/Rust `defaultWorkDir` 与 `resetBindingSessionOnStart` JSON 契约已对齐。
- Server Runtime Adapter 已按 Accepted ADR 提供 `if_missing | always | resume_exact | reuse_latest`：强制新建不再查询/复用 Workspace 现有 Session，精确恢复不回退且校验显式 Workspace，只有兼容/显式复用模式可选择列表首项；新 IM Binding 使用 `always`，既有 Binding 恢复才使用 `if_missing`。
- IM `channel_bindings` 的“一 Session 一机器人 Binding”已由 Store Create/Rebind 的单条原子 DML 统一执行；跨 Connector 共享同一 Session 被拒绝。
- `bridgecore.ExecutionService` 与 `SessionExecutionGuard` 继续服务普通 IM Turn/Runtime/Event/Approval/Session 主链；Agent Room 下线不删除这组共享执行与 lease 保护。
- Bridge DB 当前 `user_version=19`。migration 0014–0019 和历史 Agent Room 数据作为惰性 legacy 永久保留，不自动 downgrade、DROP 或进入 Connector prune；其中 approval link、turn origin 与 agent connector binding 仍有普通 IM 共享调用方。
- Agent Room 已按 `2026-07-23-agent-room-decommission.md` 完整下线并冻结：Shell 无设置、标题栏、独立窗口、Grid Pane 或可用 Event Pump；Bridge 忽略历史设置、环境变量和启用 Options，不挂 Admin routes、不恢复 Dispatcher Queue、不启动 Observer。
- 旧 V2 state/saved layout 中的 `agent_room` Pane 在加载时由 sanitizer 丢弃并修复 slot、active 与 maximized 引用；V2 兼容输入保留一个发布周期，冻结实现不得新增功能。
- `/api/v1/ws` 已接入 prompt 事件流的最小映射，覆盖 assistant/thinking delta、status、turn/prompt completion 和 approval requested/resolved。
- Server provider 可从 inbound `MetadataJSON` 的 `runtime_controls` / `controls` 映射 model、thinking、permission mode、plan、swarm 和 goal controls；未新增前端配置 UI。
- Server provider 提交 Prompt 时以显式 `runtime_controls.model` 为最高优先级；普通 Connector 未指定模型时读取 Runtime `/api/v1/config` 的 `default_model`，避免 Web UI 已配置默认模型但 Bridge 请求仍以空 model 中断。旧 Runtime 不支持该只读配置端点时保持原有服务端错误语义。
- Server provider 已实现 pending approval reconcile：启动时按本地 pending、已知 server session 和 binding 查询 server pending，保留仍 pending 的审批、将 server 确认不存在的本地 pending 标为 `stale_failed`，并为同一 session 下 server-only pending 重建带 chat context 的本地 projection。
- Telegram 和 Feishu adapter 启动成功后会按 pending approval + delivery key 幂等重投递 approval card；Feishu 需要 binding 上存在 last inbound message id 来保持回复/线程上下文，Weixin 仍不提供 in-chat approval UI。
- Bridge admin `/api/v1/*` 当前返回 `{ ok, data, error, requestId }` envelope；Shell `bridge_http_client` 会解 envelope，并兼容旧裸 JSON。
- 开发期 `runtime-probe` 与 loopback `fake-runtime` 作为历史测试工具保留，不进入产品 UI；不得作为恢复 Agent Room 的入口。

## Known Gaps
- Agent Room 冻结兼容墓碑仍保留 Tauri command/type、Go 内部实现和 V2 输入类型；退出条件是支持升级的版本完成一个发布周期的布局归一，并由 release gate 证明无旧客户端依赖。
- 历史 Agent Room Run/Queue 在冻结时不伪造 terminal 状态，数据库可能保留最后一次持久化状态；如需导出或删除数据，必须走独立的破坏性数据决策。
- `agent_connector_bindings`、approval link、turn origin 和 session lease 存在普通 IM 共享调用方，不能按 Agent Room 名称直接删除；后续瘦身需先拆分共享依赖。
- ACPAdapter manual approval 仍无跨重启恢复，只能在当前 prompt/Bridge 进程存活期间异步 resolve；跨重启 approval 以 ServerAdapter 为主路径。
- P5 发布门禁仍需要真实 Telegram/Feishu/Weixin 凭证和安装包环境做手工验证。
- `0.1.12` 及更早安装版没有 Updater，必须手动安装首个支持版本；签名密钥 Secrets 未配置或 NSIS/MSI 更新矩阵未通过 G3 时，不得声明自动更新可发布。
