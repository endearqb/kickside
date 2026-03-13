# Todo

## Archive Note

- Full pre-trim history copied to `tasks/history/todo_backup_0312.md`.
- This file keeps the latest 20 plan blocks in full.
- Older plan content is condensed below for faster scanning.

## Older Plan Summary

- Release and packaging work:
  - Covered multiple version bumps, installer rebuilds, release-note updates, GitHub release publishing, and icon/logo refreshes from early `0.0.x` builds through `v0.0.17`.
- Startup and window reliability:
  - Covered about:blank recovery, white-screen fixes, startup watchdog changes, prefill/main handoff redesigns, startup monitor pages, hidden-window deadlocks, and installed-build launch issues.
- Control Center, onboarding, and install UX:
  - Covered onboarding card consolidation, install command dialog redesigns, config-center entry points, install probe timing, shutdown tips, and control-center layout refinements.
- Workspace shell and visual refactors:
  - Covered classic UI/Kimi Web visual alignment, no-system-titlebar work, split view and drag divider, titlebar/path polish, theme-sync changes, and pane-specific external-link behavior.
- Explorer integration and session bootstrap:
  - Covered context-menu registration and repair, open-request routing, request dedupe, session auto-create policy changes, and related runtime diagnostics.
- Backend restart and download handling:
  - Covered runtime-only backend restart paths, rollback/fix cycles for restart deadlocks, native save-as download handling, and related diagnostics/logging work.
- Repository and documentation:
  - Covered root README/LICENSE/README_zh additions, bilingual README refreshes, repo About updates, release docs, and install-flow/spec research documents.
- Detailed historical checklists, acceptance criteria, and review notes remain in `tasks/history/todo_backup_0312.md`.

## Recent 20 Plans

## Current Plan (Kimi IM Bridge phase 0-1)

### Checklist

- [x] 安装并验证 Go 1.26 工具链可用于本仓库
- [x] 新增 `apps/kimi-im-bridge` Go sidecar 脚手架、配置解析、日志与基础 admin API
- [x] 实现 bridge SQLite schema、store 与 binding router
- [x] 在 `apps/kimi-shell` 中实现 bridge 配置持久化、sidecar 托管与 Tauri commands
- [x] 在 Control Center 的 `runtime_center` 下新增 bridge panel、状态轮询与 bindings 列表
- [ ] 运行 Go / Rust / 前端验证命令并完成手工 smoke

### Acceptance Criteria

- [x] `bridge.db` 的 schema、store、binding router 可稳定读写 bindings / offsets / approvals / delivery events / sessions
- [x] `kimi-shell` 已具备启动、停止、重启空壳 `kimi-im-bridge` 的命令、运行态隔离与 UI 面板，不混入现有 `BackendState`
- [ ] sidecar 重启后可恢复持久化数据，Control Center 可显示 bridge 状态与 bindings 列表

### Review

- Actual changes:
  - 新增 `apps/kimi-im-bridge` nested Go module
    - 落地 CLI 入口、配置/secret 默认文件创建、文件日志、`/healthz` / `/api/v1/status` / `/api/v1/bindings` / `DELETE /api/v1/bindings/{id}` admin API。
    - 新增 SQLite migration、store、binding router，并覆盖 offsets、approval 去重、delivery 去重、binding 恢复与 reopen 测试。
  - 扩展 `apps/kimi-shell/src-tauri`
    - 新增 `bridge_settings_store.rs`、`bridge_http_client.rs`、`bridge_manager.rs`。
    - `AppState` 增加独立 bridge 运行态、`bridge_settings.json` / `bridge_secrets.json` / `bridge.db` / `logs/bridge.log` 路径和内存态 admin token。
    - 新增 Tauri commands：`get_bridge_settings`、`save_bridge_settings`、`get_bridge_status`、`start_bridge`、`stop_bridge`、`restart_bridge`、`list_bridge_bindings`、`clear_bridge_binding`。
    - `settings.json` 镜像 `bridge_enabled`、`bridge_auto_start`、`bridge_admin_port_override`，并在 setup 后异步执行 bridge auto-start。
  - 扩展 `apps/kimi-shell` 前端
    - `useShellController` 新增 bridge settings/status/bindings/busy 状态、保存/启停/重启/clear binding handlers，以及 1.5s 轮询。
    - `runtime_center` 新增 `Bridge sidecar` panel，支持 bridge 配置保存、状态查看、bindings 列表与清理。
    - `App.css` 增加 bridge panel 所需样式。
- Verification:
  - `cmd.exe /c "set PATH=C:\\Users\\Qian\\AppData\\Local\\Programs\\GoPortable\\go1.26.1\\go\\bin;%PATH% && go -C apps\\kimi-im-bridge mod tidy"`
  - `cmd.exe /c "set PATH=C:\\Users\\Qian\\AppData\\Local\\Programs\\GoPortable\\go1.26.1\\go\\bin;%PATH% && go -C apps\\kimi-im-bridge fmt ./..."`
  - `cmd.exe /c "set PATH=C:\\Users\\Qian\\AppData\\Local\\Programs\\GoPortable\\go1.26.1\\go\\bin;%PATH% && go -C apps\\kimi-im-bridge test ./..."`
  - `cmd.exe /c "set PATH=C:\\Users\\Qian\\AppData\\Local\\Programs\\GoPortable\\go1.26.1\\go\\bin;%PATH% && go -C apps\\kimi-im-bridge build -o bin\\kimi-im-bridge.exe ./cmd\\kimi-im-bridge"`
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
  - `pnpm -C apps/kimi-shell build`
- Remaining note:
  - Control Center 的手工 UI smoke 尚未执行；尝试补跑非 UI sidecar smoke 时被本地命令策略拦截，因此当前验收主要依赖 Go / Rust 单测和前端生产构建。

## Current Plan (Kimi IM Bridge 三文档定稿)

### Checklist

- [x] 完成 GitHub / 社区一手资料复核，补齐 Kimi IM bridge 方案论证依据
- [x] 撰写 `docs/kimi-im-bridge-prd.md`
- [x] 撰写 `docs/kimi-im-bridge-design.md`
- [x] 撰写 `docs/kimi-im-bridge-implementation-plan.md`
- [x] 校对三份文档的术语、阶段划分、接口命名和引用一致性

### Acceptance Criteria

- [x] 三份文档均为中文 Markdown，且可直接指导后续实现
- [x] 文档明确采用 `apps/kimi-shell` 控制中心 + `apps/kimi-im-bridge` Go sidecar 的主方案
- [x] 文档明确 `kimi-agent-sdk` 为主接入层，`kimi acp` 仅作备选比较
- [x] 文档将 MVP 范围锁定为 `Telegram + 飞书`
- [x] 每份文档末尾均包含调研依据 / 参考链接

### Review

- Actual changes:
  - 更新 `.gitignore`
    - 将 `docs` 目录规则收窄为“默认忽略、白名单放行”，确保本次三份正式文档可进入版本控制，同时不影响其他本地文档保持忽略。
  - 新增 `docs/kimi-im-bridge-prd.md`
    - 形成完整 PRD，覆盖背景、问题、目标 / 非目标、MVP 范围、FR/NFR、成功指标、风险与依赖。
    - 单列调研依据与方案选择，明确 sidecar 架构和 `kimi-agent-sdk` 主接入层结论。
  - 新增 `docs/kimi-im-bridge-design.md`
    - 形成完整设计方案，定义总体架构、仓库落位、公开接口、内部消息模型、SQLite schema、渠道边界和安全设计。
    - 明确 bridge 与现有 `kimi web` / `BackendState` 的职责解耦。
  - 新增 `docs/kimi-im-bridge-implementation-plan.md`
    - 形成按阶段拆分的实施计划，覆盖 Phase 0-6、出口条件、验证命令、测试矩阵和风险缓解。
- Verification:
  - `Get-ChildItem docs\\kimi-im-bridge-*.md | Select-Object Name,Length`
    - 确认三份文档已创建。
  - `Select-String -Path docs\\kimi-im-bridge-*.md -Pattern 'kimi-agent-sdk|kimi acp|Telegram + 飞书|channel_bindings|channel_offsets|approval_requests|delivery_events|BindingKey|BridgeSettings|BridgeStatus|Phase 0|Phase 1|Phase 2|Phase 3|Phase 4|Phase 5|Phase 6'`
    - 校对关键术语、表名、阶段名和主方案表述一致。
  - `Get-Content docs\\kimi-im-bridge-prd.md -TotalCount 80`
  - `Get-Content docs\\kimi-im-bridge-design.md -TotalCount 80`
  - `Get-Content docs\\kimi-im-bridge-implementation-plan.md -TotalCount 80`
    - 人工抽查文档开头结构、交叉引用和中文内容完整性。
- Remaining note:
  - 本次交付为文档定稿，不包含 `apps/kimi-im-bridge` 或 `apps/kimi-shell` 的实际代码实现。

## Current Plan (compact PowerShell preflight badges in install modal)

### Checklist

- [x] Replace raw PowerShell preflight detail text with compact badge-style summary chips
- [x] Keep only high-signal preflight fields in the modal, without rendering raw stderr/stdout
- [x] Run `pnpm -C apps/kimi-shell build`

### Acceptance Criteria

- [x] The install modal no longer renders `detail` / raw preflight log text
- [x] PowerShell preflight status is shown as compact tags for diagnosis, smoke test, and language mode
- [x] Suggested fix, when present, is shown as a compact badge-style item instead of a log paragraph

### Review

- Actual changes:
  - `apps/kimi-shell/src/features/control-center/InstallFlowModal.tsx`
    - Replaced the raw PowerShell preflight detail paragraph with compact summary badges.
    - Added Chinese badge labels for diagnostic kind, smoke-test result, `LanguageMode`, execution-policy scopes, and suggested fix.
  - `apps/kimi-shell/src/App.css`
    - Added badge-row and badge-tone styles for the compact preflight summary.
- Verification:
  - `pnpm -C apps/kimi-shell build` passed.
- Remaining note:
  - This change is presentation-only; the underlying preflight payload and backend diagnostics remain unchanged.

## Current Plan (bump version to v0.0.19, write release notes, build installers)

### Checklist

- [x] Bump `apps/kimi-shell` version from `0.0.18` to `0.0.19`
- [x] Add `apps/kimi-shell/docs/release-notes-0.0.19.md`
- [x] Run `pnpm -C apps/kimi-shell tauri build`
- [x] Confirm fresh `0.0.19` MSI and NSIS artifacts exist

### Acceptance Criteria

- [x] `apps/kimi-shell/package.json` version is `0.0.19`
- [x] Synced Tauri version files are `0.0.19`
- [x] Release notes for `v0.0.19` exist and describe this install-flow hardening release
- [x] Fresh `0.0.19` installer artifacts exist under `apps/kimi-shell/src-tauri/target/release/bundle`

### Review

- Actual changes:
  - `apps/kimi-shell/package.json`
    - Bumped the app version from `0.0.18` to `0.0.19`.
  - `apps/kimi-shell/docs/release-notes-0.0.19.md`
    - Added release notes covering the Windows install-flow hardening, mirror configuration, and PowerShell preflight improvements.
  - Version sync during build updated:
    - `apps/kimi-shell/src-tauri/Cargo.toml`
    - `apps/kimi-shell/src-tauri/tauri.conf.json`
    - `apps/kimi-shell/src-tauri/Cargo.lock`
  - Built fresh Windows installer artifacts for `0.0.19`.
- Verification:
  - `pnpm -C apps/kimi-shell tauri build` passed.
  - Confirmed `apps/kimi-shell/package.json` is `0.0.19`.
  - Confirmed `apps/kimi-shell/src-tauri/Cargo.toml` is `0.0.19`.
  - Confirmed `apps/kimi-shell/src-tauri/tauri.conf.json` is `0.0.19`.
  - Confirmed fresh artifacts exist:
    - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.19_x64_en-US.msi`
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.19_x64-setup.exe`
- Remaining note:
  - The worktree still includes the earlier install-flow hardening changes from this session; this release build was produced on top of those modifications.

## Current Plan (harden Windows install flow: PATH fallback, mirror config, PowerShell preflight)

### Checklist

- [x] Add install-flow settings and task record for mirror source persistence and PowerShell diagnostics
- [x] Unify Windows command/path probing for Git, Node.js, uv, Python 3.13, and Kimi CLI
- [x] Harden managed install scripts with resolved-path verification and PowerShell `-File` fallback
- [x] Add auto re-probe completion for external Git / Node.js install tasks
- [x] Add mirror preset/custom configuration UI in the install flow and persist it to `settings.json`
- [x] Update install docs for mirror config and restricted PowerShell environments
- [x] Run `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests`
- [x] Run `pnpm -C apps/kimi-shell build`

### Acceptance Criteria

- [x] Git / Node.js installs can be detected without requiring the user to reopen the terminal session
- [x] `uv` / `kimi` / Python checks use the same Windows candidate-path rules as probe status
- [x] Install flow shows PowerShell preflight findings instead of generic script-launch failures
- [x] Execution-policy fixes are suggested only for confirmed execution-policy failures, using `CurrentUser + RemoteSigned`
- [x] Mirror mode supports preset and custom URL groups persisted in app settings
- [x] Copied mirror commands and executed mirror commands are generated from the same config

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/types.rs`
    - Added persisted install-source settings, mirror preset/custom URL groups, and PowerShell preflight data shapes.
    - Extended install session snapshots with an optional PowerShell diagnostic summary.
  - `apps/kimi-shell/src-tauri/src/install_manager.rs`
    - Rebuilt install catalog generation so mirror tasks are generated from saved settings instead of hard-coded URLs.
    - Unified Windows install probing with explicit candidate paths for Git, Node.js, uv, Python 3.13, and Kimi CLI.
    - Added PowerShell preflight collection/classification, `CurrentUser + RemoteSigned` suggestion gating, and inline-command retry when `.ps1` execution is blocked.
    - Added automatic post-launch re-probe completion for external Git / Node.js installs.
    - Added targeted regression tests covering custom mirrors, path probing helpers, execution-policy classification, and inline retry heuristics.
  - `apps/kimi-shell/src-tauri/src/lib.rs`
    - Added Tauri commands to get/save install settings and fetch PowerShell preflight output.
    - Switched install catalog retrieval to build from the current app settings.
  - `apps/kimi-shell/src/app/types.ts`, `apps/kimi-shell/src/app/useShellController.ts`
    - Added frontend types/state for install settings and PowerShell preflight.
    - Persisted preferred install source, refreshed mirror config from Tauri, and synchronized session diagnostics into UI state.
  - `apps/kimi-shell/src/features/control-center/InstallFlowModal.tsx`, `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`, `apps/kimi-shell/src/App.tsx`, `apps/kimi-shell/src/App.css`
    - Added a PowerShell preflight section to the install modal.
    - Added mirror preset/custom URL editing with save action inside the install modal.
    - Wired the new state/handlers through the control center and added styling for the new controls.
  - `apps/kimi-shell/docs/install_kimi.md`
    - Documented PowerShell-restricted environment behavior, the manual `CurrentUser` execution-policy suggestion, and the new mirror configuration model.
    - Replaced stale `kimi -v` examples with `kimi --version`.
- Verification:
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed with 16 tests.
  - `pnpm -C apps/kimi-shell build` passed.
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` completed.
- Remaining note:
  - Manual Windows confirmation is still recommended on a policy-restricted machine to verify both branches: `.ps1` blocked but inline fallback succeeds, and environments where preflight surfaces a suggestion instead of a generic failure.

## Current Plan (release v0.0.18)

### Checklist

- [ ] Draft `apps/kimi-shell/docs/release-notes-0.0.18.md`
- [ ] Build fresh `v0.0.18` installers
- [ ] Commit the release-ready tree on `main`
- [ ] Push the commit to `origin/main`
- [ ] Publish GitHub release `v0.0.18` with installer assets

## Current Plan (fix Kimi version probe and preserve install UI during backend stop)

### Checklist

- [x] Replace `kimi -v` verification with the CLI-supported `kimi --version` in install and upgrade tasks
- [x] Keep the control center reachable while `upgrade_kimi` intentionally stops the backend
- [x] Run `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests`
- [x] Run `pnpm -C apps/kimi-shell build`

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/install_manager.rs`
    - Replaced `kimi -v` with `kimi --version` across install and upgrade verification steps.
    - Added regression coverage so install/upgrade scripts keep using the supported version flag.
  - `apps/kimi-shell/src/app/useShellController.ts`
    - Added a dedicated `keepControlCenterForUpgrade` path so `upgrade_kimi` keeps the shell on Control Center instead of falling back to the loading screen while the backend is intentionally stopped.
    - Prevented the screen-change cleanup effect from auto-closing the install flow in that upgrade-stop window.
- Verification:
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed with 11 tests.
  - `pnpm -C apps/kimi-shell build` passed.
- Remaining note:
  - Manual Windows confirmation is still needed for the exact UX: after upgrade reports success or failure, the Control Center should remain visible and the restart button should still be available.

## Current Plan (stop backend before Kimi upgrade and expose restart action)

### Checklist

- [x] Stop the app backend inside the managed `upgrade_kimi` task before `uv tool upgrade kimi-cli`
- [x] Keep upgrade success messaging explicit that the backend stays stopped until the user restarts it
- [x] Expose a restart-backend action in the install modal after a Kimi upgrade attempt finishes
- [x] Run `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests`
- [x] Run `pnpm -C apps/kimi-shell build`

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/install_manager.rs`
    - `upgrade_kimi` now stops the app backend during the managed-task prepare stage before invoking `uv tool upgrade kimi-cli`.
    - Successful upgrade sessions now end with an explicit message that the backend remains stopped until the user restarts it.
    - Added system log lines around backend shutdown and helper coverage for restart-oriented success messaging.
  - `apps/kimi-shell/src/features/control-center/InstallFlowModal.tsx`
    - Rewrote the install modal strings into a clean UTF-8 version.
    - Added a `重启后端` action and contextual hint after a finished Kimi upgrade attempt while the backend is still down.
  - `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`
    - Passes runtime state and the existing runtime-only restart handler into the install modal.
- Verification:
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed with 10 tests.
  - `pnpm -C apps/kimi-shell build` passed.
- Remaining note:
  - The actual Windows click-through path still needs one manual confirmation: run `Upgrade Kimi CLI`, verify the backend is stopped before the `uv` call, then click `重启后端` after the task finishes.

## Current Plan (Windows shortcut + taskbar icon refresh)

### Checklist

- [x] Confirm the stale icon source is shortcut metadata / shell refresh, not the packaged exe icon itself
- [x] Add a Windows runtime shortcut repair helper for installer-managed Start Menu and Desktop shortcuts
- [x] Wire shortcut repair into app startup without launching visible terminals
- [x] Add installer-level shortcut fixes for WiX and NSIS
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] Run `pnpm -C apps/kimi-shell tauri build`

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/shortcut_manager.rs`
    - Added a Windows-only Shell COM shortcut repair path that updates target path, icon, working directory, description, and AppUserModelID.
    - Added a process-level `SetCurrentProcessExplicitAppUserModelID` call so the running app groups under the current app identity.
  - `apps/kimi-shell/src-tauri/src/lib.rs`
    - Runs shortcut repair during startup setup.
  - `apps/kimi-shell/src-tauri/windows/main.wxs`
    - The Desktop shortcut now explicitly sets `Icon="ProductIcon"` and `System.AppUserModel.ID`.
  - `apps/kimi-shell/src-tauri/windows/nsis-hooks.nsh`
    - Rebuilds the current-app Start Menu shortcut after install, rebuilds the Desktop shortcut only if it already exists, and asks Windows Shell to refresh icons.
  - `apps/kimi-shell/src-tauri/tauri.conf.json`
    - Registers the custom WiX template and NSIS installer hooks.
  - `apps/kimi-shell/src-tauri/Cargo.toml`
    - Adds the Windows crate features required for native shortcut repair.
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - `pnpm -C apps/kimi-shell tauri build` passed and produced both MSI and NSIS bundles.
  - Generated WiX output contains Desktop shortcut `Icon="ProductIcon"` and `System.AppUserModel.ID`.
  - Generated NSIS output includes the repo `nsis-hooks.nsh` file.
- Remaining note:
  - Historical pinned items that target other executables, such as old `Kimi 鏅鸿兘鍔╂墜` installs, remain untouched by design.
## Current Plan (installed app hidden window startup fix)

### Checklist

- [x] Reproduce the installed build startup failure and verify whether the process stays alive without a visible window
- [x] Trace the prefill-to-shell handoff and identify the hidden-window deadlock point
- [x] Replace hidden-window `requestAnimationFrame` startup reporting with a timer-based handoff trigger
- [x] Rebuild the frontend and verify the installed exe now creates a visible main window

### Review

- Actual changes:
  - `apps/kimi-shell/src/app/useShellController.ts`
    - Added a dedicated startup-report timer ref/cleanup path.
    - Replaced the hidden-window `requestAnimationFrame(reportVisibleRender)` call after `notify_frontend_ready` with `setTimeout(..., 0)` so the Rust-side `report_loading_rendered -> complete_pending_prefill_handoff -> show()` chain can run even while the shell window is hidden.
- Verification:
  - Reproduced the issue with the installed exe at `C:\Users\Qian\AppData\Local\Kimi Desktop Shell\appskimi-shell.exe`: the process stayed alive with `MainWindowHandle=0`, which confirmed a hidden-window handoff deadlock rather than an install-path failure.
  - `pnpm -C apps/kimi-shell build` passed after the change.
  - Launching the installed exe after the change produced a visible main window handle instead of leaving the process headless.
- Remaining note:
  - The previous hidden background process needed to be terminated before retesting, otherwise the single-instance forward path could mask the fix.
## Current Plan (rollback windows icon refresh chain to restore installer/startup stability)

### Checklist

- [x] Remove custom Windows packager overrides from `tauri.conf.json`
- [x] Remove `src-tauri/windows/main.wxs` and `src-tauri/windows/nsis-hooks.nsh`
- [x] Remove runtime shortcut repair call from app setup
- [x] Roll back `shortcut_manager.rs` to hotkey-only implementation
- [x] Remove direct `windows` crate dependency added for shortcut COM operations
- [x] Keep hidden-window startup handoff fix (`setTimeout` startup report path)
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] Run `pnpm -C apps/kimi-shell tauri build`

### Review

- Actual changes:
  - Removed custom packager wiring from `apps/kimi-shell/src-tauri/tauri.conf.json`.
  - Deleted `apps/kimi-shell/src-tauri/windows/main.wxs`.
  - Deleted `apps/kimi-shell/src-tauri/windows/nsis-hooks.nsh`.
  - Removed `shortcut_manager::repair_managed_shortcuts(app.handle())` from `apps/kimi-shell/src-tauri/src/lib.rs`.
  - Replaced `apps/kimi-shell/src-tauri/src/shortcut_manager.rs` with a hotkey-only implementation.
  - Removed direct `windows` dependency block from `apps/kimi-shell/src-tauri/Cargo.toml` (kept `winreg`).
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - `pnpm -C apps/kimi-shell tauri build` passed.
  - Generated NSIS script no longer includes the custom hooks file.
  - New artifacts:
    - `D:\MyProject\kimi-app\apps\kimi-shell\src-tauri\target\release\bundle\msi\Kimi Desktop Shell_0.0.12_x64_en-US.msi`
    - `D:\MyProject\kimi-app\apps\kimi-shell\src-tauri\target\release\bundle\nsis\Kimi Desktop Shell_0.0.12_x64-setup.exe`
- Remaining note:
  - Existing dead_code warnings in `backend_manager.rs` remain unrelated to this rollback.
## Current Plan (optimize single dead_code warning)

### Checklist

- [x] Remove unused `MAX_INSTALL_OUTPUT_CHARS` constant in `backend_manager.rs`
- [x] Keep truncate behavior unchanged by inlining the same limit value
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/backend_manager.rs`
    - Removed `MAX_INSTALL_OUTPUT_CHARS`.
    - Replaced its two usages in `truncate_install_output` with the same numeric limit (`1500`), preserving behavior.
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - The specific warning `constant MAX_INSTALL_OUTPUT_CHARS is never used` no longer appears.
- Remaining note:
  - Other pre-existing `dead_code` warnings in `backend_manager.rs` still remain.
## 鏈疆璁″垝锛堟竻鐞嗗墿浣?dead_code 璀﹀憡锛?
### 璁″垝娓呭崟

- [ ] 淇 `apps/kimi-shell/src-tauri/src/backend_manager.rs` 褰撳墠璇硶鎹熷潖锛屾仮澶嶅彲缂栬瘧鐘舵€?
- [ ] 杩愯 `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 鑾峰彇鏈€鏂?dead_code 娓呭崟
- [ ] 閫愭潯鍒犻櫎鍓╀綑 dead_code锛?3 鏉★級瀵瑰簲鐨勫簾寮冨父閲忓拰 helper
- [ ] 澶嶈窇 `cargo check` 楠岃瘉 dead_code 璀﹀憡宸叉竻鐞?
- [ ] 鍥炲～鏈妭鈥滃洖椤锯€濅笌楠岃瘉缁撴灉

### 楠屾敹鏍囧噯

- [ ] `cargo check` 鍙€氳繃锛堣嚦灏戞棤璇硶閿欒锛?
- [ ] 鏈疆瀹氫綅鐨?dead_code 璀﹀憡鍏ㄩ儴娑堝け
- [ ] 浠呭仛鏈€灏忔敼鍔紝涓嶅紩鍏ヨ涓哄洖褰?
## Current Plan (clear remaining dead_code warnings)

### Checklist

- [x] Repair syntax breakage in `apps/kimi-shell/src-tauri/src/backend_manager.rs`
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` to refresh warnings
- [x] Remove remaining dead_code entries with minimal edits
- [x] Run `cargo check --all-targets --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/backend_manager.rs`
    - Fixed broken string literals in install action success messages.
    - Replaced corrupted install-command-catalog labels/descriptions with stable text.
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - `cargo check --all-targets --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - No dead_code warnings are currently emitted by cargo in this workspace target.
## Current Plan (prefill layout + context-menu session bootstrap polish)

### Checklist

- [x] Push a baseline checkpoint commit to `origin/main` before polishing
- [x] Increase prefill window height and remove waiting-stage vertical scrollbar
- [x] Update context-menu labels so folder-related entry removes `(Copy to Workspace)`
- [x] Add `MUIVerb` validation into context-menu health check for startup self-heal
- [x] Force new session creation for all open-request routes (non-double-click launch)
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] Run `pnpm -C apps/kimi-shell build`

### Review

- Actual changes:
  - Prefill geometry/style:
    - Raised prefill surface size to `720x520` (`min 660x460`) in Tauri runtime sizing and static config.
    - Updated `prefill-stage` to centered symmetric padding and hidden vertical overflow in waiting state.
  - Context menu:
    - Folder-related label now uses `Open in Kimi Web Shell` (without copy suffix).
    - File label keeps `Open in Kimi Web Shell (Copy to Workspace)`.
    - Added `MUIVerb` checks to context-menu status inspection to trigger auto-repair on legacy labels.
  - Session bootstrap policy:
    - Replaced `pending_workspace_bootstrap: Option<PathBuf>` with structured request:
      `work_dir + force_create_new + source`.
    - Open-request flows (`open_dir`, `open_files`) now enqueue bootstrap with `force_create_new=true`.
    - Bootstrap now skips same-dir resume when forced and always creates a new session.
    - Added visible open-request error emission when forced session creation fails.
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - `pnpm -C apps/kimi-shell build` passed.

## Current Plan (rollback force-create session on open request)

### Checklist

- [x] Revert open-request bootstrap calls to stop forcing `force_create_new=true`
- [x] Keep non-open-request startup behavior unchanged
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] Fill this section with final review notes

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/open_request.rs`
    - `open_dir_request` bootstrap enqueue now passes `force_create_new=false`.
    - `open_files_request` bootstrap enqueue now passes `force_create_new=false`.
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
- Remaining note:
  - The `force_create_new` field and branch logic remain in `workspace_session` as dormant capability; this rollback only disables the behavior for non-double-click launch paths.

## Current Plan (remove auto-session from explorer open requests)

### Checklist

- [x] Add explicit `auto_session` control to pending workspace bootstrap state
- [x] Disable auto session bootstrap for directory background / file / folder open requests
- [x] Add short-window open-request dedupe across startup and forwarded paths
- [x] Keep prefill-to-shell flicker change out of scope and document the confirmed root cause
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] Run `pnpm -C apps/kimi-shell build`

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/app_state.rs`
    - `PendingWorkspaceBootstrap` 鏂板 `auto_session`锛屾妸鈥滄槸鍚﹁嚜鍔?bootstrap session鈥濅粠 `force_create_new` 涓媶寮€銆?
  - `apps/kimi-shell/src-tauri/src/workspace_session.rs`
    - `queue_workspace_bootstrap(...)` 鎺ュ叆 `auto_session`銆?
    - `handle_backend_ready()` 閬囧埌 `auto_session=false` 鏃朵笉鍐?`fetch/create session`锛屼篃涓嶅啀鍙戦€?`navigate_session` bridge銆?
    - 璺宠繃 bootstrap 鏃朵細娓呯┖褰撳墠 active session runtime锛岄伩鍏嶆部鐢ㄦ棫 session 鐘舵€併€?
  - `apps/kimi-shell/src-tauri/src/open_request.rs`
    - 鏂囦欢/鏂囦欢澶?鐩綍绌虹櫧澶勫搴旂殑 open request 缁熶竴鏀逛负 `auto_session=false`銆?
    - 鏂板鍩轰簬 `璇锋眰绫诲瀷 + 瑙勮寖鍖栬矾寰刞 鐨勭煭鏃跺幓閲嶏紝瑕嗙洊 `startup` 涓?`forwarded` 涓ゆ潯鍏ュ彛銆?
  - 鍓嶇疆椤甸棯鐑佹牴鍥犲凡纭锛?
    - `window_manager.rs` 涓?`run_main_shell_navigation_on_main_thread()` 鍏?`window.navigate(...)`锛屽悗 `window.hide()`銆?
    - 鍚屼竴涓彲瑙?`main` 绐楀彛鍥犳浼氱煭鏆傞湶鍑?shell/loading 涓棿鎬侊紝涓嶆槸绗簩涓獥鍙ｉ棯鐜般€?
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - `pnpm -C apps/kimi-shell build` passed.

## Current Plan (remove prefill-to-shell flash)

### Checklist

- [x] Change the main-window handoff order so the visible prefill surface is hidden before shell navigation
- [x] Keep the existing single-window startup state machine unchanged
- [x] Run `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] Run `pnpm -C apps/kimi-shell build`

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/window_manager.rs`
    - `run_main_shell_navigation_on_main_thread()` 鐜板湪浼氬湪鍒囨崲鍒?shell surface 鍓嶅厛 `window.hide()`銆?
    - 鍘熸潵浣嶄簬 `navigate(...)` 涔嬪悗鐨?`hide()` 琚Щ闄わ紝閬垮厤鍙 prefill 绐楀彛鐭殏闇插嚭 shell/loading 涓棿鎬併€?
    - 鍚姩鐘舵€佹満銆亀atchdog銆乣finalize_main_window_boot()` 鐨?show 鏃舵満淇濇寔涓嶅彉銆?
- Verification:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
  - `pnpm -C apps/kimi-shell build` passed.

## Current Plan (strictly center workspace title in main titlebar)

### Checklist

- [x] Change the desktop titlebar layout to symmetric side columns so the center block is geometrically centered
- [x] Make `Workspace | path` text stay centered even with the folder button present
- [x] Keep the existing mobile stacked titlebar layout
- [x] Run `pnpm -C apps/kimi-shell build`

### Review

- Actual changes:
  - `apps/kimi-shell/src/features/window/ShellTitlebar.tsx`
    - `titlebar-identity` 澧炲姞 `is-workspace` 鐘舵€佺被銆?
    - `titlebar-workspace-line` 鍐呮柊澧炲乏渚х瓑瀹?spacer锛岃鍙充晶鏂囦欢澶规寜閽笉鍐嶆妸涓棿鏂囨湰缁勬媺鍋忋€?
  - `apps/kimi-shell/src/App.css`
    - 鏍囬鏍忔闈㈠竷灞€浠?`auto / 1fr / auto` 鏀逛负瀵圭О鐨?`1fr / auto / 1fr`銆?
    - 宸﹀彸鎿嶄綔鍖哄垎鍒浐瀹氬湪璧锋涓や晶锛屼腑闂?identity 鏀逛负鍑犱綍涓績瀹氫綅銆?
    - `Workspace | path` 琛屾敼鎴愪笁鍒楃綉鏍硷細`spacer / centered text / folder button`锛屼繚璇佹枃瀛楁湰韬篃淇濇寔灞呬腑銆?
    - 绉诲姩绔幇鏈夊弻琛屾爣棰樻爮甯冨眬淇濈暀锛屼粎鍦ㄧЩ鍔ㄧ鎶婂伐浣滃尯鏂囨湰瀵归綈鏂瑰紡鎭㈠涓哄乏瀵归綈銆?
- Verification:
  - `pnpm -C apps/kimi-shell build` passed.
## Current Plan (titlebar path display polish)

### Checklist

- [x] Format workspace titlebar path as relative-to-effective when possible
- [x] Preserve the last folder name when the titlebar path is truncated
- [x] Slightly widen the desktop workspace titlebar center area without breaking strict centering
- [x] Keep hover tooltip showing the full absolute path
- [x] Run `pnpm -C apps/kimi-shell build`

### Review

- `ShellTitlebar.tsx` now formats workspace paths relative to `effectiveWorkDir` when possible and
  splits rendering into a shrinkable prefix plus a fixed leaf segment.
- `App.css` widens the desktop workspace titlebar center area and styles the prefix/leaf pair so the
  last folder name remains visible longer.
- `pnpm -C apps/kimi-shell build` passed.

## Current Plan (v0.0.14 open-source release)

### Checklist

- [x] Add a root `README.md` that explains the repository, app scope, setup, build, and release outputs
- [x] Publish the project under MIT by adding a root `LICENSE` and updating package metadata where appropriate
- [x] Bump the app version from `0.0.13` to `0.0.14` and sync release-facing metadata
- [x] Build fresh installers for `v0.0.14`
- [x] Write `apps/kimi-shell/docs/release-notes-0.0.14.md`
- [x] Commit, tag, push `main`, and create a GitHub Release with the built artifacts

### Acceptance Criteria

- [x] Root `README.md` exists and accurately describes the project and local workflow
- [x] The repository includes an MIT license at the root
- [x] `apps/kimi-shell/package.json`, `apps/kimi-shell/src-tauri/Cargo.toml`, and generated Tauri version metadata resolve to `0.0.14`
- [x] `pnpm -C apps/kimi-shell tauri build` passes
- [x] Fresh `0.0.14` MSI and NSIS artifacts exist under `apps/kimi-shell/src-tauri/target/release/bundle`
- [x] `v0.0.14` is pushed to `origin/main` and published as a GitHub Release

### Review

- Actual changes:
- Added a root `README.md` for the repository and a root `LICENSE` with MIT terms.
- Bumped app metadata to `0.0.14` in `package.json`, `Cargo.toml`, `tauri.conf.json`, and refreshed `Cargo.lock` through build tooling.
- Updated `apps/kimi-shell/README.md` version text and added `apps/kimi-shell/docs/release-notes-0.0.14.md`.
- Kept the existing working-tree product changes for Explorer launch handling and titlebar path display as part of this release candidate.
- Verification:
- `pnpm -C apps/kimi-shell tauri build` passed.
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed.
- Generated artifacts:
  - `D:\MyProject\kimi-app\apps\kimi-shell\src-tauri\target\release\bundle\msi\Kimi Desktop Shell_0.0.14_x64_en-US.msi` (`6795264` bytes, `2026-03-08 12:24:04`)
  - `D:\MyProject\kimi-app\apps\kimi-shell\src-tauri\target\release\bundle\nsis\Kimi Desktop Shell_0.0.14_x64-setup.exe` (`5148649` bytes, `2026-03-08 12:24:13`)
- `origin/main` includes commit `63996ca` (`release: v0.0.14`).
- GitHub Release published at `https://github.com/endearqb/kimi-app/releases/tag/v0.0.14`.
- GitHub repository visibility changed from `private` to `public`.
- Remaining note:
- None.

## Current Plan (Kimi 瀹夎寮圭獥涓庡簲鐢ㄥ唴瀹夎鎺у埗鍙拌鏍兼枃妗?

### Checklist

- [x] 瀹¤褰撳墠 `apps/kimi-shell` 鐨勫畨瑁呬緷璧栥€佸畨瑁?鍗囩骇鍛戒护鍏ュ彛涓庡懡浠ゅ睍绀洪摼璺?
- [x] 鏍稿鍙傝€冮」鐩?`endearqb/execlink` 鐨勫叕寮€瀹夎浜у搧褰㈡€侊紝鎻愮偧鍙鐢ㄧ殑浜や簰缁勭粐鏂瑰紡
- [x] 鏂板涓€浠藉畨瑁呮敼閫犺鏍兼枃妗ｏ紝鏄庣‘缁熶竴瀹夎寮圭獥銆佸簲鐢ㄥ唴瀹夎鎺у埗鍙般€佷换鍔℃ā鍨嬩笌绠＄悊鍛樺厹搴曠瓥鐣?
- [x] 鍦ㄦ枃妗ｄ腑鏄庣‘ `Git for Windows` 浠?Kimi 鍩虹瀹夎鍓嶇疆鏀逛负鍙€夊寮洪」
- [x] 澶嶆牳鏂囨。鍐呭涓庣幇鏈変唬鐮佸叆鍙ｆ槸鍚︿竴鑷达紝骞惰ˉ鍏呴獙鏀舵爣鍑嗕笌瀹炴柦寤鸿

### Acceptance Criteria

- [x] 鏂囨。鏄庣‘鍖哄垎鈥滃簲鐢ㄦ瀯寤?杩愯渚濊禆鈥濅笌鈥淜imi 瀹夎渚濊禆鈥?
- [x] 鏂囨。鏄庣‘鎻忚堪褰撳墠閾捐矾锛歚ControlCenterView` -> `useShellController` -> Tauri `invoke` -> `backend_manager` 澶栭儴 PowerShell
- [x] 鏂囨。鏄庣‘璁板綍褰撳墠澶栭儴 PowerShell 鎷夎捣澶辫触瀵艰嚧瀹夎涓嶉€忔槑鐨勯棶棰?
- [x] 鏂囨。瀹氫箟缁熶竴瀹夎寮圭獥鐨勫洓涓尯鍩熴€佷换鍔″垪琛ㄣ€佹帶鍒跺彴杈撳嚭涓庣鐞嗗憳鍏滃簳绛栫暐
- [x] 鏂囨。瀹氫箟鏂扮殑浠诲姟/浼氳瘽鎺ュ彛鏂瑰悜锛屽寘鎷?`get_install_flow_catalog`銆乣start_install_task`銆乣cancel_install_task`銆乣get_install_session_snapshot`

### Review

- Actual changes:
  - 鏂板 `tasks/Kimi 瀹夎寮圭獥涓庡簲鐢ㄥ唴瀹夎鎺у埗鍙版敼閫犳柟妗?md`
    - 娌夋穩褰撳墠渚濊禆瀹¤銆佺幇鏈夊畨瑁呮墽琛岄摼璺€侀棶棰樻竻鍗曚笌 `execlink` 瀵归綈缁撹銆?
    - 瀹氫箟缁熶竴瀹夎寮圭獥鐨勪俊鎭灦鏋勩€佷竴閿笌鍒嗘浠诲姟妯″瀷銆佸簲鐢ㄥ唴瀹夎鎺у埗鍙拌涓恒€佺鐞嗗憳鏉冮檺鍏滃簳绛栫暐銆?
    - 鏄庣‘ `Git for Windows` 鏀逛负鍙€夊寮洪」锛屼笉鍐嶉樆濉?Kimi 鍩虹瀹夎銆?
    - 缁欏嚭鍓嶅悗绔被鍨?鍛戒护/浜嬩欢鐨勬敼閫犳柟鍚戯紝浠ュ強楠屾敹涓庡疄鏂介樁娈靛缓璁€?
- Verification:
  - 澶嶆牳浜嗙幇鏈変唬鐮佸叆鍙ｄ笌鏂囨。鎻忚堪鐨勪竴鑷存€э細
    - `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`
    - `apps/kimi-shell/src/app/useShellController.ts`
    - `apps/kimi-shell/src-tauri/src/backend_manager.rs`
    - `apps/kimi-shell/src-tauri/src/types.rs`
  - 鏍稿浜?`https://github.com/endearqb/execlink` README 涓€滃揩閫熷畨瑁呭悜瀵?/ 浠呮墽琛屽畨瑁?/ 澶嶅埗瀹夎鍛戒护 / 榛樿缁堢杩愯鍣ㄢ€濈浉鍏宠鏄庯紝骞跺皢鍏朵綔涓轰骇鍝佸舰鎬佸弬鑰冨啓鍏ユ枃妗ｃ€?
- Remaining note:
  - 鏈鎸夌敤鎴疯姹備粎浜や粯瑙勬牸鏂囨。锛屼笉鏀瑰姩杩愯鏃朵唬鐮佷笌瀹夎閾捐矾瀹炵幇銆?

## Current Plan (repo about + README_zh)

### Checklist

- [x] Add a root `README_zh.md` with a Chinese version of the repository overview, setup, and release output notes
- [x] Update the root `README.md` to link to the Chinese README entry point
- [x] Write the GitHub repository About description and verify it remotely
- [x] Commit the documentation changes and push `main` to `origin`

### Acceptance Criteria

- [x] Root `README_zh.md` exists and accurately describes the project in Chinese
- [x] Root `README.md` includes a visible link to the Chinese README
- [x] GitHub repo About description is no longer empty
- [x] `origin/main` contains the new documentation commit

### Review

- Actual changes:
- Added a new root `README_zh.md` with a Chinese repository overview, local development notes, release output paths, and license pointer.
- Added a language switch link at the top of `README.md` so the Chinese README has an explicit entry point.
- Updated the GitHub repository About description to: `Kimi Web 鐨?Windows 妗岄潰澹筹紝鍩轰簬 Tauri v2 + React锛岄泦鎴愬惎鍔ㄧ洃鎺с€佸伐浣滃尯鎺ョ涓庡畨瑁呭寘鍒嗗彂銆俙
- Verification:
- `Get-Content -Encoding utf8 README_zh.md` confirmed the Chinese README content is present and readable.
- `gh repo view endearqb/kimi-app --json description,url,visibility` confirmed the About description is populated and the repo remains public.
- `git push origin main` pushed commit `05a736b` to `origin/main`.
- Remaining note:
- None.

## Current Plan (Kimi 瀹夎寮圭獥涓庡簲鐢ㄥ唴瀹夎鎺у埗鍙版敼閫犲疄鏂?

### Checklist

- [x] 寮曞叆缁熶竴瀹夎浠诲姟鐩綍銆佸畨瑁呬細璇濆揩鐓т笌 Channel 娴佸紡杈撳嚭妯″瀷
- [x] 瀹炵幇 Rust 渚?`InstallManager`銆佸簲鐢ㄥ唴 PowerShell 鎵樼鎵ц涓庡閮ㄧ鐞嗗憳鍏滃簳
- [x] 鏂板瀹夎鐩稿叧 Tauri 鍛戒护骞朵繚鐣欐棫瀹夎鍛戒护鍏煎鍖呰
- [x] 鏀归€犲墠绔?`useShellController`锛屽垏鎹㈠埌瀹夎蹇収 + Channel 妯″瀷
- [x] 鐢ㄧ粺涓€ `InstallFlowModal` 鏇挎崲鐜版湁瀹屾暣鍛戒护寮圭獥锛屽苟绠€鍖栨帶鍒朵腑蹇冨畨瑁呭叆鍙?- [x] 杩愯 `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 杩愯 `pnpm -C apps/kimi-shell build`
- [x] 鍥炲～鏈妭鈥淩eview鈥濅笌楠岃瘉缁撴灉

### Acceptance Criteria

- [x] 鏍稿績瀹夎閾捐矾涓嶅啀渚濊禆澶栭儴 PowerShell 绐楀彛鎵嶈兘鐪嬪埌鎵ц杩囩▼
- [x] `quick_install_core / install_uv / install_python313 / install_kimi / upgrade_kimi` 鍙湪搴旂敤鍐呮樉绀哄疄鏃舵棩蹇?- [x] `install_git / install_nodejs` 鏄庣‘鏍囪涓哄彲閫夊寮洪」锛屽苟璧板閮ㄧ鐞嗗憳鍏滃簳
- [x] 澶嶅埗鍛戒护涓庡疄闄呮墽琛屾楠ゆ潵鑷悓涓€浠戒换鍔″畾涔?- [x] 鍏抽棴鍐嶆墦寮€瀹夎寮圭獥鍚庝粛鑳界湅鍒版渶杩戜竴娆″畨瑁呬細璇濈粨鏋?- [x] `Git` 鏈畨瑁呬笉浼氶樆濉?`coreReady`
- [x] `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 閫氳繃
- [x] `pnpm -C apps/kimi-shell build` 閫氳繃

### Review

- Actual changes:
- 鏂板 `apps/kimi-shell/src-tauri/src/install_manager.rs`
  - 寮曞叆缁熶竴浠诲姟鐩綍銆乣InstallManager` managed state銆佸畨瑁呭揩鐓с€丆hannel 鎺ㄩ€佷笌鏃ュ織缂撳啿銆?  - `quick_install_core / install_uv / install_python313 / install_kimi / upgrade_kimi` 璧板簲鐢ㄥ唴 PowerShell 绠￠亾杈撳嚭銆?  - `install_git / install_nodejs` 鏀逛负澶栭儴绠＄悊鍛?PowerShell 鍏滃簳銆?- 鏇存柊 `apps/kimi-shell/src-tauri/src/lib.rs`
  - 娉ㄥ唽 `InstallManager` state銆?  - 鏂板 `register_install_session_channel / get_install_flow_catalog / get_install_session_snapshot / start_install_task / cancel_install_task`銆?  - 鏃у懡浠?`install_kimi_dependencies / install_kimi_cli / upgrade_kimi_cli / install_nodejs` 鏀逛负鍏煎鍖呰銆?- 鏇存柊 `apps/kimi-shell/src-tauri/src/types.rs`
  - 鏂板瀹夎浠诲姟銆佷細璇濄€佹棩蹇椼€佷簨浠剁被鍨嬨€?  - 鎵╁睍 `InstallProbeStatus`锛屽鍔?`wingetReady` 涓?`coreReady`銆?- 鏇存柊鍓嶇 `apps/kimi-shell/src/app/useShellController.ts`
  - 娉ㄥ唽 Tauri `Channel`锛屾秷璐瑰畨瑁呭揩鐓т笌鏃ュ織銆?  - 鏂板瀹夎浠诲姟鍚姩銆佸彇娑堛€佸揩鐓ф仮澶嶄笌鐩綍鎷夊彇閫昏緫銆?- 鏂板 `apps/kimi-shell/src/features/control-center/InstallFlowModal.tsx`
  - 闆嗘垚鐜鐘舵€併€佷竴閿熀纭€瀹夎銆佸崌绾?鍙€夊寮洪」銆佹帶鍒跺彴鏃ュ織涓庡鍒跺姩浣溿€?- 鏇存柊 `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`銆乣apps/kimi-shell/src/App.tsx`銆乣apps/kimi-shell/src/App.css`
  - 灏嗗畨瑁呭叆鍙ｅ垏鍒扮粺涓€瀹夎寮圭獥锛屽苟琛ュ厖鏈€灏忔牱寮忋€?- Verification:
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 閫氳繃銆?- `pnpm -C apps/kimi-shell build` 閫氳繃銆?- 闈欐€佸疄鐜颁笂宸叉弧瓒筹細
  - 鍩虹瀹夎浠诲姟鍦ㄥ簲鐢ㄥ唴娴佸紡鏄剧ず鏃ュ織銆?  - Git / Node.js 璧板閮ㄧ鐞嗗憳鍏滃簳銆?  - 浠诲姟瀹氫箟鍚屾椂椹卞姩澶嶅埗鍛戒护涓庢墽琛屾楠ゃ€?  - 瀹夎寮圭獥閲嶆柊鎵撳紑鏃朵細閫氳繃蹇収鎭㈠鏈€杩戜竴娆′細璇濄€?- Remaining note:
- `backend_manager.rs` 閲屾棫瀹夎閾捐矾涓庡吋瀹?catalog 浠嶄繚鐣欙紝褰撳墠浼氫骇鐢熶竴缁?`dead_code` warning锛涘畠浠湭褰卞搷鏋勫缓閫氳繃锛屽悗缁彲鍗曠嫭娓呯悊銆?- Follow-up completion:
  - `apps/kimi-shell/src-tauri/src/backend_manager.rs`
    - Isolated the retained compatibility install helpers into an explicit `legacy_install` block and removed the remaining `dead_code` warning noise from active checks.
  - `apps/kimi-shell/src-tauri/src/types.rs`
    - Marked the compatibility-only `InstallCommand*` structs as retained legacy data shapes so active targets no longer warn on them.
  - `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`
    - Simplified the onboarding install card to environment summary + `鎵撳紑瀹夎涓庡崌绾 + `閲嶆柊妫€娴媊, while keeping manual path confirmation available.
  - `apps/kimi-shell/src\App.css`
    - Added minimal label overrides so the streamlined install-entry buttons render the intended copy reliably.
- Verification refresh:
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed with no warnings.
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed (`4` tests).
  - `pnpm -C apps/kimi-shell build` passed after the final UI cleanup.
- Remaining note:
  - Manual Windows click-through for the in-app install flow / fallback-elevation path is still recommended; this environment only covered static build and Rust unit verification.

## Current Plan (bump version to v0.0.18 and build installer)

### Checklist

- [x] Record this version bump + installer build task in `tasks/todo.md`
- [x] Bump `apps/kimi-shell` version by `0.0.1` and sync Tauri metadata
- [x] Build fresh Windows installer packages
- [x] Fill this section with verification results

### Acceptance Criteria

- [x] `apps/kimi-shell/package.json` version is `0.0.18`
- [x] `apps/kimi-shell/src-tauri/Cargo.toml` version is `0.0.18`
- [x] `apps/kimi-shell/src-tauri/tauri.conf.json` version is `0.0.18`
- [x] `pnpm -C apps/kimi-shell tauri build` passes
- [x] Fresh installer artifacts for `0.0.18` exist under `apps/kimi-shell/src-tauri/target/release/bundle`

### Review

- Actual changes:
- Bumped `apps/kimi-shell/package.json` from `0.0.17` to `0.0.18`.
- Ran `pnpm -C apps/kimi-shell tauri build`, which also executed `pnpm sync:version` and synced:
  - `apps/kimi-shell/src-tauri/Cargo.toml` to `0.0.18`
  - `apps/kimi-shell/src-tauri/tauri.conf.json` to `0.0.18`
- Produced fresh installer artifacts:
  - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.18_x64_en-US.msi`
  - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.18_x64-setup.exe`
- Verification:
- `Get-Content apps/kimi-shell/package.json` confirmed version `0.0.18`.
- `Get-Content apps/kimi-shell/src-tauri/Cargo.toml | Select-Object -First 20` confirmed version `0.0.18`.
- `Get-Content apps/kimi-shell/src-tauri/tauri.conf.json | Select-Object -First 20` confirmed version `0.0.18`.
- `pnpm -C apps/kimi-shell tauri build` completed successfully.
- `Get-ChildItem apps/kimi-shell/src-tauri/target/release/bundle/msi,apps/kimi-shell/src-tauri/target/release/bundle/nsis` confirmed the `0.0.18` MSI and NSIS installers exist.
- Remaining note:
- No runtime install test was executed in this step; verification covered version sync and successful installer generation.

## Current Plan (fix Kimi CLI upgrade flow failure)

### Checklist

- [x] Reproduce and inspect the in-app `upgrade_kimi` PowerShell flow
- [x] Harden Kimi install/upgrade scripts for Windows `uv tool` behavior
- [x] Add regression coverage for the shared script builder / upgrade command
- [x] Run targeted Rust tests and full desktop build
- [x] Fill this section with verification results

### Acceptance Criteria

- [x] `upgrade_kimi` no longer relies only on `uv tool install ... --upgrade`
- [x] Shared PowerShell bootstrap adds the `uv tool dir --bin` path when available
- [x] Install and upgrade Kimi steps ensure Python 3.13 before invoking `uv tool`
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passes
- [x] `pnpm -C apps/kimi-shell build` passes

### Review

- Actual changes:
- Updated [install_manager.rs](/D:/MyProject/kimi-app/apps/kimi-shell/src-tauri/src/install_manager.rs) so the shared PowerShell bootstrap now appends `uv tool dir --bin` to `PATH` when `uv` is available.
- Hardened Kimi install and upgrade steps:
  - install now ensures `uv python install 3.13` before `uv tool install kimi-cli --python 3.13 --upgrade`
  - upgrade now ensures Python 3.13, prefers `uv tool upgrade kimi-cli`, and falls back to reinstall if upgrade fails
  - mirrored upgrade keeps the same retry-over-index behavior, but each index now uses upgrade-first then reinstall fallback
- Added regression tests covering the new upgrade strategy and the shared PATH bootstrap script.
- Verification:
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed (`6` tests).
- `pnpm -C apps/kimi-shell build` passed.
- Remaining note:
- This environment verified the scripts and build successfully, but the final confirmation still needs a Windows in-app click-through of `Upgrade Kimi CLI` on the packaged app.

## Current Plan (simplify Kimi upgrade + gate install buttons by probe state)

### Checklist

- [x] Record this follow-up task after the failed upgrade feedback
- [x] Simplify `upgrade_kimi` to pure `uv tool upgrade kimi-cli` semantics
- [x] Improve install-session failure summaries and surfaced console diagnostics
- [x] Gate install modal task buttons strictly from `InstallProbeStatus`
- [x] Run targeted Rust tests and frontend build
- [x] Fill this section with verification results

### Acceptance Criteria

- [x] `upgrade_kimi` no longer installs Python or falls back to reinstall
- [x] Failed install steps surface exit code plus last stderr/stdout summary in the session snapshot
- [x] Install modal buttons only enable when the corresponding dependency is missing, except `upgrade_kimi`, which only enables when `kimiReady=true`
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passes
- [x] `pnpm -C apps/kimi-shell build` passes

### Review

- Actual changes:
- Updated `apps/kimi-shell/src-tauri/src/install_manager.rs`
  - Simplified `upgrade_kimi` to pure `uv tool upgrade kimi-cli` semantics for both official and mirror flows.
  - Added explicit native-command exit checks after the upgrade command so PowerShell cannot mask a failed `uv tool upgrade`.
  - Extended the shared install-session snapshot with `failure_summary`, `last_stdout`, and `last_stderr`.
  - Captured the latest stdout/stderr in the managed install state and promoted a concise failure summary into the session snapshot on non-zero exit.
  - Wrapped generated PowerShell scripts in a top-level `try/catch` that formats and writes error details to stderr before exiting.
- Updated `apps/kimi-shell/src/app/types.ts` and `apps/kimi-shell/src/features/control-center/InstallFlowModal.tsx`
  - Synced the new failure-summary fields into frontend types.
  - Rebuilt the install modal with clean text, strict probe-driven task gating, per-button disabled reasons, and a dedicated failure summary banner above the console.
  - Changed log-copy behavior so failed sessions still copy useful diagnostics even when there are few or no streamed log lines.
- Updated `apps/kimi-shell/src/App.css`
  - Added task-grid, button-hint, and failure-summary styles for the install modal.
- Verification:
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed (`7` tests).
- `pnpm -C apps/kimi-shell build` passed.
- Remaining note:
- This environment covered Rust/unit/static build verification only. The final check is still to click through `Upgrade Kimi CLI` and the disabled/enabled install buttons on Windows.

## Current Plan (fix PowerShell temp script lifetime and stderr capture)

### Checklist

- [x] Reproduce the reported `exit_code=-196608` failure mode locally
- [x] Keep temp install scripts alive until PowerShell exits
- [x] Make install log streaming robust to non-UTF8 PowerShell stderr output
- [x] Re-run targeted Rust tests and frontend build
- [x] Fill this section with verification results

### Acceptance Criteria

- [x] Managed install tasks no longer delete the temp `.ps1` before PowerShell opens it
- [x] `exit_code=-196608` no longer occurs from the missing-script race
- [x] Stderr from PowerShell missing-file / parser-style failures is surfaced into the install session logs or failure summary
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passes
- [x] `pnpm -C apps/kimi-shell build` passes

### Review

- Actual changes:
- Updated `apps/kimi-shell/src-tauri/src/install_manager.rs`
  - Moved temp PowerShell script cleanup from immediately-after-`spawn()` to after the child process exits, removing the race that caused PowerShell to fail with `exit_code=-196608`.
  - Reworked install output streaming to read raw bytes and decode with UTF-8/UTF-16LE fallback instead of `BufRead::lines()`, so PowerShell stderr is no longer dropped on non-UTF8 output.
  - Added helper coverage for temp-script cleanup and stream decoding behavior.
- Root cause confirmed:
- A local reproduction showed that deleting the `.ps1` right after `spawn()` causes PowerShell to print only its startup banner on stdout, emit a missing-file error on stderr, and exit with `-196608`, matching the user report.
- Verification:
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed (`8` tests).
- `pnpm -C apps/kimi-shell build` had already passed on the preceding install-modal/logging changes, and this final patch only touched Rust-side process handling.
- Remaining note:
- The remaining confirmation is an in-app Windows click-through to verify the next failed install/upgrade now shows the real stderr text instead of only `Windows PowerShell`.

## Current Plan (fix workspace split/swap refreshing embedded pages)

### Checklist

- [x] Record the workspace split/swap no-refresh task and acceptance criteria
- [x] Keep workspace iframe mount order fixed in `WorkspaceView`
- [x] Switch split/swap behavior to CSS positioning instead of child reordering
- [x] Run `pnpm -C apps/kimi-shell build`
- [x] Fill this section with verification results

### Acceptance Criteria

- [ ] Clicking split view does not remount or refresh `Kimi Code Web` / `Kimi Chat`
- [ ] Clicking swap panes only changes visual left/right placement
- [ ] Single view, split view, and split drag behavior all continue to work
- [x] `pnpm -C apps/kimi-shell build` passes

### Review

- Actual changes:
  - `apps/kimi-shell/src/features/workspace/WorkspaceView.tsx`
    - Kept the render order fixed as `code pane -> divider -> chat pane` in all modes.
    - Replaced split/swap child reordering with pane position classes so split and swap only change visual placement.
  - `apps/kimi-shell/src/App.css`
    - Added split-grid column rules for left/right pane placement.
    - Hid the divider in single-pane mode without removing it from the React tree.
- Verification:
  - `pnpm -C apps/kimi-shell build` passed.
  - Static review confirms split/swap no longer changes iframe mount order, so the existing embedded pages stay mounted across single/split/swap transitions.
- Remaining note:
  - The three interaction-focused acceptance items still need manual click-through in the desktop app to be fully checked off.

## Current Plan (update v0.0.19 release notes with workspace no-refresh fix)

### Checklist

- [x] Review the existing `v0.0.19` release notes
- [x] Add the workspace split/swap no-refresh fix to the release notes
- [x] Record the result in this section

### Acceptance Criteria

- [x] `apps/kimi-shell/docs/release-notes-0.0.19.md` mentions the workspace split/swap no-refresh fix
- [x] The added wording matches the implemented behavior and does not overstate verification

### Review

- Actual changes:
  - `apps/kimi-shell/docs/release-notes-0.0.19.md`
    - Expanded the highlights summary to mention the workspace split/swap no-refresh behavior fix.
    - Added a dedicated main-change item describing the fixed persistent iframe behavior for split and swap actions.
- Verification:
  - Reviewed the existing `v0.0.19` release notes and updated them to reflect the implemented workspace behavior change.
- Remaining note:
  - This task only updated release-note documentation; no additional code or build verification was needed.

## Current Plan (fix false failure after Python 3.13 install succeeds)

### Checklist

- [x] Record the Python 3.13 false-failure bug and acceptance criteria
- [x] Update managed install verification so uv-managed Python 3.13 passes on Windows
- [x] Add regression coverage for the Python 3.13 verification path
- [x] Run targeted verification
- [x] Fill this section with verification results

### Acceptance Criteria

- [x] `install_python313` no longer fails just because `python` is not on the current PATH
- [x] Verification accepts uv-managed Python 3.13 installs
- [x] Targeted Rust verification passes

### Review

- Actual changes:
  - `apps/kimi-shell/src-tauri/src/install_manager.rs`
    - Replaced the Python 3.13 install-step verification with a dedicated `Invoke-KimiShellPython313Check` helper instead of assuming `python` resolves after install.
    - The new helper accepts multiple Windows verification paths: explicit Python 3.13 executable locations, `py -3.13`, `python3.13`, and `uv run --python 3.13 python --version`.
    - Updated both the official and mirror Python install steps to use the shared helper.
    - Added regression tests covering the Python install command and the injected PowerShell helper content.
  - `tasks/lessons.md`
    - Added the new Windows Python verification lesson so future install flows do not repeat the PATH-only assumption.
- Verification:
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests` passed (`19` tests).
  - `pnpm -C apps/kimi-shell build` passed.
- Remaining note:
  - A manual Windows click-through of `Install Python 3.13` is still recommended to confirm the exact previously reported false-failure path is gone in the packaged app.
