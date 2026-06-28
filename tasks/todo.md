# Workspace Grid external WebviewWindow fallback

## Checklist
- [x] 增加外部 URL WebviewWindow service，复用现有 `urlSafety`
- [x] 外部页挂起/blocked fallback 增加“在应用窗口打开”
- [x] 给 main capability 增加 `core:webview:allow-create-webview-window`
- [x] 组件测试覆盖 iframe 超时后调用 WebviewWindow fallback

## Review
- 本轮推进 WG-7 的退路方案：被 iframe 阻止的外部页可在独立应用 WebviewWindow 承载。
- 仍未实现嵌入式子 Webview 按 pane geometry 放置，也未解决 per-pane localStorage namespace。

# Workspace Grid resizable custom tracks

## Checklist
- [x] 增加 `trackSizes` 持久化字段，保存自定义列/行比例
- [x] Grid canvas 增加列/行 seam 拖拽 handle
- [x] preset 切换时清除不匹配的 custom tracks
- [x] 命名布局保存/恢复自动携带 sanitized track sizes
- [x] 单测覆盖 track resize clamp、持久化与 preset 清理
- [x] 组件测试覆盖拖拽 handle 后写入 store

## Review
- 本轮推进 WG-8 的“逐缝拖拽 resize + 持久化 custom template”；custom template 先实现为当前 preset 的列/行 `fr` track sizes。
- 仍未实现 WG-7 子 Webview、per-pane localStorage namespace。

# Workspace Grid named layouts

## Checklist
- [x] 复用现有 sanitized grid state 快照保存命名布局
- [x] 工具栏支持保存当前布局并从下拉框恢复
- [x] 恢复布局时清除 transient 最大化状态
- [x] 单测覆盖 URL fragment 不入保存布局、恢复布局
- [x] 组件测试覆盖保存后切换预设再恢复

## Review
- 本轮推进 WG-8 的“命名布局保存/恢复”；未引入 modal 或新状态库，先用原生 `prompt`/`select`。
- 仍未实现 WG-7 子 Webview、per-pane localStorage namespace、逐缝拖拽 resize。

# Workspace Grid v1 hardening

## Checklist
- [x] 支持方向键切换 active pane
- [x] 外部网页 pane 支持输入自定义 `http/https` URL，并继续剥离 fragment
- [x] mount policy 具备可见挂起/恢复行为，非活跃 on-focus pane 可延迟挂载
- [x] 顶栏状态展示运行中 Code Session 数量
- [x] 增加 jsdom + React Testing Library 组件级测试，覆盖键盘切换、自定义外部 URL、挂起/恢复
- [x] 运行前端、Rust、Go 与 diff gate

## Review
- 本轮补齐 WG-4/WG-5/WG-6 中上一轮仍偏弱的交互证据：键盘切换、custom external URL、mount policy 行为和状态区运行数量。
- `jsdom` 固定为 `24.1.3`，避免把本仓库 README 里的 Node 18+ 要求悄悄抬到 Node 20+。
- 真实已安装应用当前是旧包且窗口为 13x13，不能作为新源码视觉证据；本轮用组件级 jsdom 测试补强 UI 行为证据。

# Workspace Grid renderer and session commands

## Checklist
- [x] 替换 `WorkspaceView` 内部写死双窗渲染，改为 `WorkspaceGridView` + `PaneFrame`
- [x] 接入 1/2/3/4/5/6 预设、空 slot、窗格关闭、最大化和内容切换
- [x] 外部页使用 timeout fallback + 浏览器打开，不依赖 iframe `onError`
- [x] 将旧 titlebar 的单窗/双窗/换位按钮同步到 Grid store
- [x] 新增 `grid_list_sessions` / `grid_create_session` Tauri command 与前端 service
- [x] 空 Code slot 在存在工作目录时通过 server 创建真实 session，并用 `/sessions/{id}` URL 渲染
- [x] 运行 Vitest、TypeScript、Vite build、Rust fmt/check 与 diff check

## Review
- `WorkspaceView` 现在只作为兼容入口，实际渲染由 `features/workspace-grid/WorkspaceGridView.tsx` 与 `PaneFrame.tsx` 承担。
- Grid v1 已覆盖 WG-2，并推进 WG-3/WG-4/WG-5/WG-6 的最小闭环；Tauri 子 Webview 和 v2 per-pane 隔离仍留在 WG-7/WG-8。
- 验证结果：`pnpm --dir apps/kimi-shell test`、`.\node_modules\.bin\tsc.cmd --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo fmt -- --check`、`cargo check`、`git diff --check` 通过。
- 未覆盖项：本轮未启动真实 Tauri 桌面手工创建 3 个 Code session；该项仍需在运行中后端环境验证。

# Workspace Grid v1 foundation

## Checklist
- [x] 读取目标文件，确认 Workspace Grid 先落 WG-0/WG-1 基础切片
- [x] 建立 README First、架构和设计系统上下文
- [x] 确认 DR-A：Workspace Grid v1 采用 `zustand` 作为独立状态切片试点
- [x] 确认 DR-B：v1 外部页承载只承诺可见 fallback + 外部打开，不要求自动子 Webview
- [x] 新增 Vitest 基线、`pnpm test`、workspace-grid 状态/迁移/URL 纯逻辑和单测
- [x] 运行 `pnpm test`、`tsc --noEmit` 与 `git diff --check`

## Review
- 本轮只完成 WG-0/WG-1 的最小可验证基础：`workspace-grid` 新目录包含 Pane/Slot 分离类型、预设、旧双窗 localStorage 迁移、zustand store、selector、`paneUrl` 与 `urlSafety`。
- 已新增 accepted ADR：`.ai/decisions/2026-06-28-workspace-grid-v1.md`。
- 现有 `WorkspaceView` 和 `useShellController` 未接入新 store，双窗 UI 行为保持不变；WG-2 才替换渲染器。
- 验证结果：`pnpm --dir apps/kimi-shell test` 通过；`.\node_modules\.bin\tsc.cmd --noEmit`（`apps/kimi-shell`）通过；`git diff --check` 通过，仅有既有 CRLF 提示。

# kimi-code v3 迁移与 IM Bridge 安全门禁

## Checklist
- [x] 读取粘贴的 v3 整合目标，收敛当前线程目标
- [x] 建立 README First 上下文并记录 `.ai/CONSTITUTION.md` / `.ai/architecture` 缺失风险
- [x] 盘点 Shell backend、workspace session 与 Bridge 启动 token 触点
- [x] 修复 Bridge admin / host-control token 命令行暴露：Shell 改 env，sidecar 支持 env/token-file
- [x] 切换 Shell 后端主路径到 `kimi server run --foreground --port <port>`
- [x] 新增 server token resolver，生成 `/#token=` workspace URL
- [x] 暂停 P1A 默认 workspace proxy 与旧 `/api/sessions` bootstrap
- [x] 补 `.ai/architecture` 当前事实和验证入口
- [x] 新增 Rust `api_v1_client` 薄客户端，统一 Bearer 与 envelope 解包
- [x] 写出 Shell `kimi_runtime_locator.json`，并传给 Bridge sidecar
- [x] Bridge status 暴露 runtime locator 配置/可读/health 状态
- [x] 用 `/api/v1` 替换 Shell workspace/session 调用，并恢复 DirectServer ready 后 session bootstrap
- [x] 新增 Bridge `RuntimeAdapter` 契约与 `KimiCodeServerAdapter` REST 地基，并在 status 暴露 runtime adapter 状态
- [x] Bridge admin `/api/v1/*` 改为 `{ ok, data, error, requestId }` envelope，Shell client 兼容新旧响应
- [x] Bridge stdout/stderr、bridge log tail 与 Go logger 纳入已知 secret redaction
- [x] 运行最小验证并记录结果
- [x] 把 Bridge channel prompt 主路径切到 `KimiCodeServerAdapter`
- [x] 接入 `/api/v1/ws` prompt 事件流的最小内容/状态/approval 映射
- [x] 完成 server pending approval reconcile 与本地持久 projection
- [x] 实现 ACPAdapter 实验性 stdio/JSON-RPC smoke
- [x] 实现 SDKAdapter wrapper
- [x] 通过 Bridge metadata 映射 server prompt controls：model、thinking、permission、plan、swarm、goal
- [x] P3 安装主链路移除 uv/Python：Kimi 安装改官方 install.ps1，升级改 `kimi upgrade`，core ready 不再依赖 uv/Python
- [x] P3 Git Bash 检测与 `KIMI_SHELL_PATH` 配置：Shell 启动 server 时自动注入检测到的 Git Bash 路径
- [x] P3 Bridge sidecar installed-build smoke：重建 bundled `kimi-im-bridge.exe`，token-file 启动、health/status envelope、runtime stop 和输出 redaction 通过
- [x] P4A `kimi doctor`：控制中心运行诊断面板可直接执行 `kimi doctor`，展示 exit code、路径与脱敏输出
- [x] 后续：把 server-only recovered approvals 重新投递成 Telegram/Feishu IM approval card
- [x] 后续：把 ACPAdapter manual approval 从 live auto/cancel 升级为当前进程内异步 resolve
- [x] 收口本地开发门禁与剩余 P5 真凭证手工门禁边界

## Review
- 已先落 v3 明确标为高风险的 Bridge secret transport 门禁，并开始 P1A DirectServer 主路径迁移。
- DirectServer 主路径已推进：Rust lifecycle 现在启动 `kimi server run --foreground --port <port>`，读取 `KIMI_CODE_HOME/server.token`，并把 `/#token=` URL 交给前端。
- P1B 地基已推进：新增 `api_v1_client`，Shell workspace/session 调用已改到 `/api/v1`，Shell 写出不含明文 token 的 runtime locator，Bridge 接收 locator 并在 status 中报告可读性。
- P4C 主路径已推进：Bridge 新增 `RuntimeAdapter` 契约和 `KimiCodeServerAdapter` REST/WS 客户端；Telegram/Feishu/Weixin 通过 bridgecore orchestrator 优先走 server-backed runtime provider，创建新 binding 时使用 server 返回的真实 session id，旧 synthetic binding 会在 server run 后 rebind。
- `/api/v1/ws` 已接入 prompt 事件流的最小映射，覆盖 assistant/thinking delta、status、turn/prompt completion 和 approval requested/resolved。
- Server pending approval reconcile 已接入：Bridge 启动时按本地 pending 与已知 server session/binding 查询 server pending，保留仍 pending 的审批、将 server 确认不存在的本地 pending 标为 `stale_failed`，并为同一 session 下 server-only pending 重建带 chat context 的本地 projection。
- `internal/runtime` 已补 `SDKAdapter` wrapper 与实验性 `ACPAdapter`。ACPAdapter 具备 stdio JSON-RPC transport、initialize/session/new/session/resume/session/prompt/session/cancel 的 smoke 覆盖；manual approval 已在当前进程内支持 live async resolve，但尚无跨 Bridge 重启恢复。
- Server provider 已从 `MetadataJSON` 读取 `runtime_controls` / `controls`，映射 model、thinking、permission mode、plan、swarm 和 goal controls；未新增配置 UI。
- P3 安装链路已推进：Shell quick/core Kimi 安装不再串联 uv/Python，改用 Kimi Code 官方 Windows installer；升级改走 `kimi upgrade`；卸载清理托管 Kimi CLI binary/npm package；旧 `backend_manager/install_compat.rs` uv/Python 安装路径已删除；安装文档同步移除 uv/Python 主路径。
- P3 Git Bash 已接入：Shell 会检测现有 `KIMI_SHELL_PATH`、Git for Windows `bash.exe` 常见路径或 PATH `bash`，启动 `kimi server run` 时写入 `KIMI_SHELL_PATH`，安装面板展示 Git Bash 状态和检测路径。
- P3 Bridge sidecar installed-build smoke 已补：`apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe` 已由当前 Go 源码重建，使用 token files 启动后 `/healthz`、`/api/v1/status` envelope、`/api/v1/runtime/stop` 和 stdout/stderr/log token redaction 检查通过。
- P4A `kimi doctor` 已接入：控制中心运行诊断面板新增手动运行入口，Shell 后端调用本机 `kimi doctor` 并对已知 API key / token / secret 做精确值脱敏后返回 UI。
- Recovered approval redelivery 已接入：Telegram/Feishu adapter 启动后会扫描 pending approvals，用既有 delivery key 幂等重投递 approval card；Feishu 仅在 binding 有 last inbound message id 时重投递以保持线程/回复上下文。
- ACPAdapter manual approval 已从 auto/cancel smoke 升级为 live async：`session/request_permission` 会在 manual mode 下登记 pending approval、发出 approval event，并等待 `ResolveApproval` 返回 ACP selected/cancelled outcome；跨 Bridge 重启恢复仍未实现。
- Admin API 已收紧：sidecar `/api/v1/*` 返回稳定 envelope，Rust `BridgeHttpClient` 已支持 envelope unwrap，并保留旧裸 JSON 兼容。
- Bridge 日志安全门禁已推进：Go logger 会 redaction admin/host-control 与平台密钥；Shell 托管的 sidecar stdout/stderr 通过 redactor 写入 bridge log，UI log tail 与失败摘要也会二次 redaction。
- 本地代码门禁已收口到 P4C：Shell 自有 UI 不新增独立 prompt composer/全局 approval inbox，主交互继续由官方 Kimi Code Web 承载；Bridge approval 由 IM card 与 Bridge runtime panel 承载。
- P5 未在本地自动完成：真实 Telegram/Feishu/Weixin 凭证、NSIS/MSI 安装包环境、OpenAPI/AsyncAPI CI 快照和发布回退仍是发布前手工/专用环境门禁，不阻塞本轮代码合并。
- 验证结果：`go test ./...`（`apps/kimi-im-bridge`）通过；`cargo check` 通过；`cargo test --no-run` 通过；`.\node_modules\.bin\tsc.cmd --noEmit` 通过；`git diff --check` 通过。
- 已知限制：Rust 测试二进制运行在当前 Windows 环境仍报既有 `STATUS_ENTRYPOINT_NOT_FOUND`，未执行到断言阶段。

# 上游 Web 基线与中文化脚手架

## Checklist
- [x] 复查 `tasks/lessons.md`、现有 `sync:kimi-web` / 合规脚本和第三方记录，锁定最小改动面
- [x] 将 `tasks/todo.md` 超长历史归档，并保留最近上下文
- [x] 更新 `apps/kimi-shell/scripts/sync_kimi_cli_web.ps1`，默认同步 `MoonshotAI/kimi-cli` 的最新 `main` HEAD，并落地 `upstream-web/` 快照与来源记录
- [x] 补齐 `third_party/kimi-cli-web/`、`patches/kimi-web/` 与维护文档，明确上游快照只读、所有本地差异走 patch/overlay
- [x] 扩展 enhanced-web 合规检查，验证 `upstream-web/` 快照存在且来源 commit 与记录一致
- [x] 基于同步下来的 `web/` 代码产出中文化入口盘点，区分适合源码 patch 与适合注入兜底的文本类型
- [x] 运行针对性验证，确认同步、脚手架和检查链路可用，且不改动现有增强模式运行时
- [x] 在本节补充 Review，记录本次同步 commit、中文化入口判断和未覆盖风险

## 保留的最近上下文（原 todo 最新 20 行）

### Validation So Far
- `pnpm --dir apps/kimi-shell check:enhanced-web:i18n` 通过。
- `pnpm --dir apps/kimi-shell check:enhanced-web:compliance` 通过。
- `pnpm --dir apps/kimi-shell exec tsc --noEmit` 通过。
- `pnpm --dir apps/kimi-shell build` 通过。
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
- `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check` 通过。
- `pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths` 通过。
- `git diff --check` 通过，仅输出当前工作区 CRLF 提示。
- 已确认本地存在 `0.0.40` / `0.0.41` 的 NSIS 与 MSI 安装包资产。

### Review
- 发布说明：新增 `apps/kimi-shell/docs/release-notes-0.0.40.md` 与 `apps/kimi-shell/docs/release-notes-0.0.41.md`，分别覆盖本地增强版产品化、增强版同源注入/切换修复、后端模块化和桥接/安装/auth 操作流修正。
- 更新说明：新增 `update/updatenote_202604241713.md`，合并说明 2026-04-24 的 `v0.0.40` / `v0.0.41` 更新。
- GitHub：`main` 已推送到 `origin/main`，提交为 `dbb9c6d release: ship v0.0.41`。
- 标签：`v0.0.40` 与 `v0.0.41` 已推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.40` 与 `Kimi Desktop Shell v0.0.41`；`v0.0.41` 为 GitHub latest。
- 资产：每个 release 均已上传对应 NSIS 与 MSI 安装包。
- 已知限制：本轮未完成安装版 UI 点击回归；Rust 测试二进制在当前 Windows 环境仍受既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 影响，未能执行到断言阶段。

### Review
- 上游基线：已通过 `pnpm --dir apps/kimi-shell sync:kimi-web` 将 `MoonshotAI/kimi-cli` 的 `main` HEAD 同步到 `apps/kimi-shell/third_party/kimi-cli-web/upstream-web/`，本次固定 commit 为 `e32568cf2db0e95ad76878a4e6482986c8ecb180`。
- 同步脚本：`apps/kimi-shell/scripts/sync_kimi_cli_web.ps1` 现在默认解析 `refs/heads/main`，并在同步后回写 `SOURCE.md`、`public/enhanced-kimi-web/manifest.json`、`docs/third-party-notices.md` 与 `docs/kimi-web-maintenance.md`。同时补了 UTF-8 无 BOM 写入，避免 Node 侧解析 `manifest.json` 失败。
- 维护边界：已新增 `apps/kimi-shell/docs/kimi-web-maintenance.md` 与 `apps/kimi-shell/patches/kimi-web/README.md`，明确当前运行时仍是 workspace proxy 同源注入，`upstream-web/` 只作为只读上游快照，所有本地差异必须放在 `patches/kimi-web/` 或显式 overlay。
- 中文化盘点：已新增 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md`。本次确认 `sessions.tsx`、`create-session-dialog.tsx`、`message-search-dialog.tsx`、`chat-workspace-header.tsx`、`approval-dialog.tsx`、`error-boundary.tsx` 等文件中存在大量直接写在 JSX/props 里的英文固定文案，适合下一阶段迁到源码 patch；`question-dialog.tsx` 与 approval payload 中来自后端的 question/description/body 仍需单独处理，不能只靠前端 patch 覆盖。
- 合规检查：`apps/kimi-shell/scripts/check_enhanced_web_compliance.mjs` 现在除了检查许可证和免责声明，还会验证 `docs/kimi-web-maintenance.md`、`patches/kimi-web/README.md`、`third_party/kimi-cli-web/upstream-web/` 的存在性，并要求快照目录非空且包含 `src/`。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`git diff --check` 已于 2026-04-24 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 运行时边界：本轮没有切换增强模式的运行时来源，当前仍保持官方 workspace proxy + same-origin 注入；因此本次交付是“源码基线与中文化脚手架”，不是“本地源码版 Web 接管”。
- 未覆盖项：本轮没有在真实桌面应用里点击验证增强模式切换后的 UI 行为，也没有尝试构建或运行同步下来的上游 `web/` 前端；第二阶段开始源码 patch 前，仍需先挑选一小组高频文案做最小迁移验证。

## 全注入版第二阶段

### Checklist
- [x] 复查现有增强注入表与第二阶段计划，确认仅扩大固定 UI 文案覆盖，不触碰动态 payload 文本
- [x] 按页面块重组 `workspace_injection.rs` 注入表，补齐 sessions / create session / message search / workspace header / approval / error boundary 固定文案
- [x] 保持 `MutationObserver + text node / placeholder / aria-label / title` 机制不变，不引入复杂 DOM 特判
- [x] 更新 `kimi-web-i18n-inventory.md`，将第二阶段已由注入覆盖的页面块标记出来
- [x] 更新 `kimi-web-maintenance.md`，明确第二阶段仍为全注入策略，且动态 payload 文本不在本轮范围内
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录新增注入覆盖范围、刻意不处理的动态文本和验证结果

### Review
- 注入表：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仍保持单一增强注入入口，没有新增第二套脚本；现有 `MutationObserver + text node / placeholder / aria-label / title` 机制保持不变，只是把翻译表按 `sessions_sidebar`、`create_session_dialog`、`message_search`、`workspace_header`、`approval_dialog`、`error_boundary` 六个页面块重组并扩容。
- 新增覆盖：本轮补齐了 sessions 主路径文案（关闭侧栏、刷新会话、新建、清除搜索、列表/分组视图、归档/取消归档、删除会话、删除确认文案）、创建会话弹窗（标题、空态、目录不存在确认、分组标题、创建目录按钮）、消息搜索（标题、占位、无结果、跳转）、工作区头部（打开会话侧栏、显示/隐藏工作区文件、搜索消息、折叠/展开全部区块、双击重命名提示）、审批对话框固定按钮文案，以及 `chat.tsx` toast 标题和 `error-boundary.tsx` 错误页按钮文案。
- 动态边界：本轮刻意没有新增对 `question-dialog.tsx` 中 `currentQuestion.*`、`approval.description`、`approval.sender`、服务端错误正文、模型输出正文或用户消息正文的翻译规则；计划中的 `Allow this ...?` 动态句式也没有做中文拼接，避免把注入扩散到 payload 级文本。
- 变量句子策略：`Delete Session` / `The directory ... does not exist ...` 这类包含变量节点的场景，本轮只翻译固定文本节点和按钮，不引入正则组装或复杂 DOM 结构推断，因此路径和会话名仍保持原样嵌入。
- 文档：`apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已新增“当前注入覆盖状态（第二阶段）”章节，标出已覆盖和仍不在注入范围内的部分；`apps/kimi-shell/docs/kimi-web-maintenance.md` 已明确第二阶段仍是全注入策略，且一旦开始依赖大量变量句子或复杂结构特判，就应停止扩注入并改回源码 patch。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-24 通过；`git diff --check` 仅输出当前工作区 CRLF 提示，无新增文本级错误。
- 未覆盖项：本轮未启动桌面应用做手工点击回归，因此第二阶段注入的最终桌面观感仍需人工验证会话侧栏、创建会话弹窗、消息搜索、approval dialog 和 error boundary 五条路径。

## v0.0.42 发版执行

### Checklist
- [x] 复查当前工作区 diff、版本号与本地安装包产物，确认 `0.0.42` 发版边界
- [x] 撰写 `apps/kimi-shell/docs/release-notes-0.0.42.md`
- [x] 撰写 `update/updatenote_202604250034.md`
- [x] 运行本次发版所需验证命令并记录结果
- [x] 提交当前工作区改动并推送 `main`
- [x] 创建并推送 `v0.0.42` tag
- [x] 创建 GitHub release 并上传 `0.0.42` 的 NSIS / MSI 安装包

### Review
- 发版边界：当前版本号已统一到 `0.0.42`，本次发版内容包含两类改动：一是 `kimi-cli/web` 上游源码基线与维护边界落库，二是本地增强版 same-origin 注入的第二阶段中文固定文案扩展；运行时仍保持官方 workspace proxy + 注入模式。
- 发布文档：已新增 `apps/kimi-shell/docs/release-notes-0.0.42.md`，内容覆盖上游 `web/` 基线、第二阶段全注入扩展、保持运行时边界不变，以及 `0.0.42` 的验证和已知限制；已新增 `update/updatenote_202604250034.md`，概括同一批改动及用户影响。
- 安装包产物：已确认本地存在 `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.42_x64-setup.exe` 与 `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.42_x64_en-US.msi`，可用于 GitHub release 上传。
- 自动化验证：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过。
- diff 检查：`git diff --check` 已于 2026-04-25 执行，未发现内容级错误，仅剩当前工作区 CRLF 提示。
- Git 提交：已创建 `f170ddf release: ship v0.0.42`，并已推送到 `origin/main`。
- 标签：`v0.0.42` 已创建并推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.42`，地址为 `https://github.com/endearqb/kimi-app/releases/tag/v0.0.42`；已上传 `0.0.42` 的 NSIS 与 MSI 安装包，且已设置为 latest。
- 已知限制：本轮仍未完成安装版 UI 点击回归；Rust 测试二进制在当前 Windows 环境仍受既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 影响，未能执行到断言阶段。

## 红框区域中文注入扩展

### Checklist
- [x] 复查现有增强注入表、截图定位结果和上游文案来源，锁定仅新增红框区域及相邻固定文案
- [x] 扩展 `workspace_injection.rs` 的翻译分组，补齐 `Thought`、工具标签、活动状态、输入区提示、右键菜单和上下文占用文案
- [x] 在不引入复杂 DOM 特判的前提下，为 `Thought for {n}s`、`{percent}% context`、`{n} selected` 增加轻量动态句式匹配
- [x] 更新 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md`，补充第三阶段注入覆盖范围和仍排除的动态文本
- [x] 更新 `apps/kimi-shell/docs/kimi-web-maintenance.md`，明确第三阶段动态句式边界与停止扩注入条件
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录新增注入命中范围、动态句式策略和验证结果

### Review
- 注入脚本：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仍保持单一 same-origin 注入入口；本轮只新增 `ai_reasoning_and_tools`、`chat_activity_and_composer`、`session_context_menu_and_multiselect`、`toolbar_context_usage` 四组翻译，不改观察器和属性覆盖机制。
- 新增覆盖：本轮补齐了 `Thought` / `Thinking...` / `Thought for {n}s`、`Copy`、工具标签 `Edit` / `Read` / `Search` 及同源工具名、`Awaiting input`、批准等待、上传/连接/启动环境状态、输入框提示、`Collapse input` / `Expand input`、`Stop generation` / `Queue message`、会话右键菜单 `Rename` / `Archive` / `Unarchive` / `Select Multiple`、多选条 `Select all` / `Deselect all` / `{n} selected`、以及右下角 `{percent}% context` 和 token 用量说明。
- 动态句式：仅新增三类轻量模式匹配：`Thought for {n}s`、`{percent}% context`、`{n} selected`；没有引入通用正则翻译器，也没有加任何 DOM 结构特判。
- 排除边界：本轮继续排除了 `approval.description`、`approval.sender`、`currentQuestion.*`、模型输出正文、用户消息正文、文件路径、URL 和工具参数本体；例如 `Edit (D:\...)` 只翻译 `Edit`，路径保持原样。
- 文档：`apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已补充“第三阶段”注入覆盖状态；`apps/kimi-shell/docs/kimi-web-maintenance.md` 已明确第三阶段只允许三类变量句式，并重申超过该边界就应停止扩注入、转源码 patch。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 未覆盖项：本轮未启动桌面应用做手工点击回归，因此截图里的 `Thought` 折叠头、工具调用行、输入区状态、右键菜单、多选条和 `% context` 仍需你在真实界面点一遍确认最终命中效果。

## 快速设置安装区调整

### Checklist
- [x] 在安装主操作区增加第二行 `安装 Git` / `安装 Node.js` 快捷按钮
- [x] 移除详细选项中的重复“可选增强”入口
- [x] 官方源 tab 下隐藏镜像策略卡
- [x] 镜像源 tab 切换不自动检测，改为手动点击检测按钮触发
- [x] 运行 `tsc --noEmit`、`build`、`cargo check` 并记录结果

### Review
- 主操作区：`InstallFlowTaskContent` 现在将 `install_git` 与 `install_nodejs` 放在安装 / 升级按钮下方第二行，沿用现有探测状态禁用逻辑和任务执行路径。
- 详细选项：已移除原“可选增强”重复卡；官方源只保留来源切换，镜像策略仅在镜像源下显示。
- 镜像检测：点击镜像源 tab 只切换来源；只有点击“检测镜像源”才调用镜像健康检测，并固定以 `preferredSource: "mirror"` 检测。
- 验证结果：`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已通过。

## 左上角品牌名注入

### Checklist
- [x] 复查品牌标题来源，确认左上角 `Kimi Code` 是独立文本节点而非图片资源
- [x] 在 `workspace_injection.rs` 中新增精确品牌映射 `Kimi Code` → `Kimi 小助手`，且不引入更宽的 `Kimi` 匹配
- [x] 更新维护文档与盘点文档，明确当前仅替换可见标题，不改 logo、版本号、链接和可访问属性
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录品牌注入边界、验证结果和仍需手工确认的点

### Review
- 标题来源：已确认上游 `apps/kimi-shell/third_party/kimi-cli-web/upstream-web/src/components/kimi-cli-brand.tsx` 中左上角品牌由 `/logo.png` 图片、独立文本 `Kimi Code` 和独立版本文本 `v{kimiCliVersion}` 组成；红框内文字不是图片。
- 注入范围：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仅新增 `brand_identity` 分组，并加入精确映射 `Kimi Code` → `Kimi 小助手`；没有新增 `Kimi` 这类宽匹配，也没有改动现有观察器、属性覆盖逻辑或 logo/版本/链接逻辑。
- 文档：`apps/kimi-shell/docs/kimi-web-maintenance.md` 与 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已补充品牌注入边界，明确当前只替换可见标题，不改 `/logo.png`、版本号、外链和 `alt`/`title`/`aria-label`。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 手工确认：本轮未启动桌面应用做点击回归，因此仍需在真实界面确认左上角已显示 `Kimi 小助手 v1.39.0`，且黑底 `K` logo、品牌链接和版本号展示保持不变。

## v0.0.43 发版执行

### Checklist
- [x] 复查当前工作区 diff、版本号与本地 `0.0.43` 安装包产物，确认发版边界
- [x] 撰写 `apps/kimi-shell/docs/release-notes-0.0.43.md`
- [x] 撰写 `update/updatenote_202604251248.md`
- [x] 运行本次发版所需验证命令并记录结果
- [x] 提交当前工作区改动并推送 `main`
- [x] 创建并推送 `v0.0.43` tag
- [x] 创建 GitHub release 并上传 `0.0.43` 的 NSIS / MSI 安装包

### Review
- 发版边界：当前版本号已统一到 `0.0.43`。本次发版内容集中在两块：一是增强版官方 Web 的第三阶段中文注入扩展与左上角品牌标题 `Kimi 小助手` 注入；二是控制中心安装流程区的快捷操作与镜像检测交互调整。
- 发布文档：已新增 `apps/kimi-shell/docs/release-notes-0.0.43.md`，覆盖第三阶段注入扩展、品牌标题本地化、安装流程区调整与 `0.0.43` 验证结果；已新增 `update/updatenote_202604251248.md`，概括同一批改动及用户影响。
- 安装包产物：已确认本地存在 `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.43_x64-setup.exe` 与 `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.43_x64_en-US.msi`，可用于 GitHub release 上传。
- 自动化验证：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过。
- diff 检查：`git diff --check` 已于 2026-04-25 执行，未发现内容级错误，仅剩当前工作区 CRLF 提示。
- Git 提交：已创建 `261a3e6 release: ship v0.0.43`，并已推送到 `origin/main`。
- 标签：`v0.0.43` 已创建并推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.43`，地址为 `https://github.com/endearqb/kimi-app/releases/tag/v0.0.43`；已上传 `0.0.43` 的 NSIS 与 MSI 安装包，且已设置为 latest。
