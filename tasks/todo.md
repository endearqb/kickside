# Shell IM Bridge Entry Restore Todo

## Hard Constraints

- [x] Only restore Shell UI entry points for IM Bridge; keep the Feishu `/bridge` soft-hide behavior unchanged.
- [x] Limit the code change to control-center navigation and overview entry visibility.

## Implementation

- [x] Re-add the `IM Bridge` tab in Control Center header navigation.
- [x] Re-add the overview-side “打开 IM Bridge” task card.
- [x] Restore control-section routing so selecting `bridge_center` opens the IM Bridge panel again.

## Validation

- [x] Run `pnpm build` in `apps/kimi-shell`.

## Retrospective

- [x] Restored only the Shell-side IM Bridge navigation surfaces in Control Center; the Feishu `/bridge` text-command and legacy card-entry soft-hide remains unchanged.
- [x] Validation passed with `pnpm build` in `apps/kimi-shell`; version-sync touched `package.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json` again during the build.

---

# Bridge Command Soft Hide Todo

## Hard Constraints

- [x] Keep bridge runtime, binding, approval, and session internals intact; only remove user-facing `/bridge` and shell-management entry points.
- [x] Preserve approval decision cards in Feishu so runtime approval flow still works.
- [x] Avoid changing bridge admin API or persisted bridge settings/state formats.

## Implementation

- [x] Disable Feishu text-command exposure for `/bridge ...` while keeping normal IM prompt flow unchanged.
- [x] Downgrade legacy Feishu bridge panel/session/workdir card actions to a hidden-entry response so old cards cannot reopen management UI.
- [x] Hide shell-side IM Bridge management entry points from visible navigation and overview cards without removing runtime status surfaces.
- [x] Update focused Go/TS tests to match the hidden-entry behavior.

## Validation

- [x] Run focused Go tests for Feishu adapter command/card behavior.
- [x] Run `pnpm build` in `apps/kimi-shell`.

## Retrospective

- [x] `/bridge` text commands are no longer intercepted in Feishu; they now fall back to the normal IM prompt path, while runtime/session/binding/approval internals stay in place.
- [x] Legacy bridge management card callbacks (`bridge_show_panel`, session switching, workdir preset/clear) now collapse into a hidden-entry card so old chat cards cannot reopen management UI.
- [x] Control Center no longer exposes the `IM Bridge` tab or overview jump card, but dashboard/status surfaces and background bridge runtime remain untouched.
- [x] Validation passed with `go test ./internal/adapters/feishu` and `pnpm build` in `apps/kimi-shell`; the frontend build again triggered version-sync noise in `package.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json`.

---

# Control Center / IM Bridge Interaction Cleanup Todo

## Hard Constraints

- [x] Keep existing bridge admin/runtime APIs and persisted `BridgeSettings` / `BridgeStatus` wire shape unchanged.
- [x] Limit behavior changes to control-center UX, shell status chip rendering, onboarding dirty/save handling, and focused Rust test coverage.
- [x] Reuse existing Tauri dialog and `open_folder` capabilities for IM default work-dir actions; do not add new commands.

## Implementation

- [x] Change onboarding progress and auth-card completion to count 4 cards, with login/API completion treated as one card.
- [x] Update dashboard hero to show backend state plus IM final state, and remove the latest excerpt card.
- [x] Normalize footer IM chip sizing and labels so success displays `IM Running`.
- [x] Refactor `BridgeRuntimePanel` into collapsible sections with only the first section expanded by default.
- [x] Add IM default work-dir input actions in the first bridge runtime card: browse directory and open current folder.
- [x] Fix IM bridge onboarding auto-start dirty detection and keep auto-start persisted across restart.
- [x] Add/update focused Rust assertions for onboarding auto-start persistence.
- [x] Collapse the entire outer “Bridge 运行面板” card by default and move `IM Default Work Dir` controls into the main IM Bridge panel.

## Validation

- [x] Run `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bridge_settings_store -- --nocapture`.
- [x] Run `pnpm build` in `apps/kimi-shell`.
- [x] Note remaining manual desktop validation for dashboard, bridge accordion, and auto-start-on-relaunch behavior.
- [x] Re-run `pnpm build` after moving the IM default work-dir controls and folding the outer runtime panel.

## Retrospective

- Quick setup progress now follows the 4 visible onboarding cards instead of mixing card UX with the old 5-step backend checklist, so auth completion is no longer double-counted.
- Dashboard hero was simplified to backend state plus IM final state, and the IM runtime panel now uses collapsible cards with a dedicated default-workdir browse/open-folder flow.
- The auto-start regression came from frontend dirty-state logic, not Rust persistence; adding `autoStart` to onboarding dirty detection fixed the toggle reset while Rust coverage now rechecks the saved round-trip.
- Validation completed with `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bridge_settings_store -- --nocapture` and `pnpm build`; desktop click-through for dashboard visuals, accordion defaults, and relaunch auto-start still needs one manual smoke pass.
- Follow-up adjustment: the outer `Bridge 运行面板` card is now collapsed by default, while `IM Default Work Dir` has been promoted into the main IM Bridge panel so users can edit it without opening the advanced runtime panel.

---

# Feishu Image/File/Interactive Integration Todo

# Feishu Reply Card Title Cleanup Todo

## Hard Constraints

- [x] Keep existing Feishu interactive reply delivery and fallback behavior unchanged; only remove the visible reply-card title text.
- [x] Limit the code change to the reply-card renderer and its focused regression tests.

## Implementation

- [x] Locate the interactive reply-card title generation path used by normal IM bridge replies.
- [x] Remove the `Kimi reply` / `Kimi reply (n/N)` title text from normal reply cards.
- [x] Update focused Go tests to assert the new card header behavior.

## Validation

- [x] Run focused Go tests for the Feishu sender reply-card path.

## Retrospective

- Normal Feishu interactive replies now send a body-only card payload without `header.title`, so the visible `Kimi reply` label is gone while markdown content and chunk splitting remain unchanged.
- Updated sender- and service-level tests to assert the new no-header shape and to keep coverage on interactive reply delivery.
- Verified with `go test ./internal/adapters/feishu`.

## Hard Constraints

- [x] Keep the existing Go sidecar architecture and admin API lifecycle unchanged; no new Node/OpenClaw runtime.
- [x] Use additive SQLite migration only for pending inbound attachments; keep existing bridge settings/secrets backward-compatible.
- [x] Preserve existing `/bridge` command, approval-card, onboarding-card, and doctor-card behavior while moving normal Feishu replies to renderer-driven delivery.

## Implementation

- [x] Add bridge-local attachment/artifact contracts across domain, runtime, bridgecore, and Kimi provider request types.
- [x] Add pending inbound attachment persistence, expiry cleanup, and capped per-chat/thread caching in the bridge store.
- [x] Extend Feishu inbound mapping to accept `image` and `file`, stage/download resources locally, and consume cached attachments on the next eligible text prompt.
- [x] Extend the Feishu gateway/sender to upload and send `image`, `file`, and `interactive` replies with delivery metadata and fallback behavior.
- [x] Switch bridge settings from `feishuReplyCards` to `feishuReplyRenderer` with backward-compatible normalization in Go, Rust, and TypeScript.
- [x] Update the shell Bridge Runtime panel to use an explicit Feishu reply renderer selector instead of a boolean checkbox.

## Validation

- [x] Run focused Go tests for store, config, Kimi provider, and Feishu adapter behavior.
- [x] Run focused Rust tests for bridge settings persistence and normalization.
- [x] Run a frontend build for the Bridge Runtime panel changes.
- [ ] Note remaining manual Feishu smoke checks for image/file inbound and interactive reply delivery.

## Retrospective

- Normalized Feishu reply rendering onto an explicit renderer enum across Go/Rust/TS while preserving legacy `feishuReplyCards` read compatibility and avoiding config file churn on save.
- Added staged inbound attachment caching plus multimodal prompt wiring without changing the existing sidecar runtime boundary; bridge-local artifact send now rides the current Feishu gateway/sender path.
- Remaining validation is external to the repo: live Feishu smoke for image/file inbound, interactive chunking, and artifact upload/send behavior against a real tenant.

---

# Kimi IM Bridge Refactor Todo

## Hard Constraints

- [x] Keep CLI flags and admin API behavior stable.
- [x] Keep `go test ./...` green after each implementation phase.
- [x] Use additive SQLite migrations only; no destructive schema rewrites.

## Implementation

- [x] Add `internal/bridgecore` types, interfaces, and orchestrator.
- [x] Add `internal/providers/kimi` and move provider/session orchestration there.
- [x] Add `internal/adapterkit` shared inbound/checkpoint/approval contracts.
- [x] Add `internal/platforms/{telegram,feishu}` and switch app wiring to them.
- [x] Expand store/domain for turns, events, checkpoints, leases, and delivery metadata.
- [x] Split `internal/app` into wiring and lifecycle responsibilities.
- [x] Keep `internal/runtime` as an admin/debug compatibility facade.
- [x] Add or update tests for bridgecore, provider, migrations, and app wiring.
- [x] Run full package tests and verify migration coverage.

## Review

- [x] Confirm app startup still initializes channels and reconciles pending approvals.
- [x] Confirm Telegram and Feishu adapters only advance checkpoints after successful handling.
- [x] Confirm turn/approval persistence keeps `turn_id` and `step_id`.

## Retrospective

- Introduced `bridgecore` as the orchestration seam without breaking legacy adapter tests by making adapters accept either the old runtime path or the new orchestrator path.
- Added additive migrations through schema version 7 so old databases can move forward without rebuilds.
- Kept admin/debug behavior stable by leaving `internal/runtime` in place while production adapter wiring now flows through provider + bridgecore.

---

# Kimi Shell Control Center UI Todo

## Hard Constraints

- [x] Keep backend commands, bridge/admin APIs, and Tauri window topology unchanged.
- [x] Keep lightweight interactions inline in cards; heavy Bridge/API config must use dedicated modals.
- [x] Keep modal structure consistent: fixed header + fixed footer + scrollable body only.

## Implementation

- [x] Flatten onboarding/settings cards so core fields are visible without accordion expansion.
- [x] Remove the work-dir detail modal and keep work-dir editing directly in the card.
- [x] Convert Bridge onboarding/detail flow into a dedicated Bridge config modal for config + secrets only.
- [x] Add shared control-center modal shell and shared card header / status badge patterns.
- [x] Update runtime Bridge panel to separate normal actions from danger actions and add clearer grouping labels.
- [x] Rework install flow modal so only the body scrolls while header/footer remain fixed.
- [x] Update responsive styles so fullscreen and workspace modal surfaces share one layout language.

## Validation

- [ ] Verify control center works in fullscreen and workspace modal surfaces.
- [ ] Verify work-dir can be edited and saved inline without opening a modal.
- [ ] Verify API config and Bridge config only edit sensitive settings through dedicated modals.
- [ ] Verify modal `Escape` and overlay-close behavior still work with fixed header/footer shells.
- [x] Run a frontend build and confirm no layout regressions in the touched control-center flows.

## Retrospective

- Shared `ControlCenterModalShell` now enforces one modal rule across config, install, and Bridge setup: fixed header, fixed footer, and body-only vertical scrolling.
- Onboarding cards no longer mix accordion expansion with detail dialogs; lightweight actions stay inline, while API and Bridge heavy config are isolated in dedicated modals.
- Bridge runtime actions are easier to parse after splitting normal operations from danger groups, which also keeps destructive actions away from the primary flow.
- `pnpm build` 已通过；真实窗口的 fullscreen/workspace 双形态和手动交互 smoke 仍需在桌面端实际点检一次。

---

# Bridge Status / Feishu Diagnostics Todo

## Hard Constraints

- [x] Keep admin API routes and `BridgeStatus` JSON shape backward-compatible.
- [x] Keep bridge start/stop lifecycle semantics unchanged: process stays alive if only status probing fails.
- [x] Prefer root-cause visibility over optimistic UI fallback; degraded state must not masquerade as connecting.

## Implementation

- [x] Make `apps/kimi-im-bridge/internal/app/app.go` return best-effort status snapshots even when some store reads fail.
- [x] Add Go regression tests covering partial status snapshot failures and `/api/v1/status` returning `200`.
- [x] Update `apps/kimi-shell/src-tauri/src/bridge_manager.rs` degraded fallback mapping so enabled channels resolve to `degraded`, not `connecting`.
- [x] Add Rust tests covering local degraded status synthesis after status-probe failure.
- [x] Add explicit Feishu startup-stage diagnostics for credential probe, endpoint fetch, websocket handshake, and long-connection failures.
- [x] Adjust control-center Bridge copy so it no longer implies that saving credentials confirms Feishu platform connectivity.

## Validation

- [x] Run `go test ./internal/admin ./internal/app ./internal/store`.
- [x] Run Rust bridge-manager targeted tests.
- [x] Verify degraded snapshots now surface `lastError*` and do not report Feishu as `connecting` when status probing fails.

## Retrospective

- Sidecar `Status()` now treats channel listings and counters as independent best-effort reads, so `/api/v1/status` no longer collapses to HTTP 500 when SQLite snapshotting is partially unavailable.
- Shell local fallback now synthesizes degraded channel states from settings whenever runtime probing fails in a degraded/crashed state, which removes the misleading `Bridge Degraded + Feishu Connecting` combination.
- Feishu startup diagnostics now separate credential probe, endpoint fetch, and websocket handshake failures in `bridge.log`, and the control-center copy no longer implies that saved credentials alone prove platform connectivity.

---

# Feishu IM Bridge UX / Sessions / Startup Diagnostics Todo

## Hard Constraints

- [x] Keep the existing Go bridge architecture and admin shutdown lifecycle; do not introduce a new Node runtime or detached background daemon flow.
- [x] Keep persisted approval correlation fields (`turn_id`, `step_id`) intact across new approval UX changes.
- [x] Treat `shell-web` sessions as discoverable/importable only; never bind them as if they were bridge-native sessions.

## Implementation

- [x] Add bridge-native session listing and binding workdir update support to the bridge store/domain/admin API.
- [x] Add Feishu bridge management commands and card-based responses for help, sessions, cwd, and approvals.
- [x] Rebuild Feishu approval cards to render structured summaries and expose approve once / approve for session / reject actions.
- [x] Add session aggregation in shell/runtime so bridge-native and shell/web sessions can be surfaced with clear source labels.
- [x] Add `defaultWorkDir` to shell bridge settings and preserve it across Rust/TS/JSON round-trips.
- [x] Capture bridge startup stdout/stderr tails and surface structured startup-failure diagnostics in shell runtime/control center.

## Validation

- [x] Run focused Go tests for store/admin/Feishu adapter/session behavior.
- [x] Run focused Rust tests for bridge manager/settings/session aggregation behavior.
- [x] Run targeted frontend validation or build for the touched control-center flow.
- [ ] Manually verify Feishu command/card flows, approval card readability, and startup-failure surfacing.

## Retrospective

- Feishu bridge 现在先识别 `/bridge ...` 管理命令，再回落到普通 mention prompt 流程；这让 session/cwd/approval 管理不再和模型对话路径耦合。
- 飞书审批卡片不再被错误降级成 text/post 发送，结合结构化摘要提取和 `Approve for session` 动作后，pending approvals 不再把原始 JSON 直接暴露给用户。
- 飞书卡片回调更新现在显式返回 `card_json` 而不是 `raw`，避免审批按钮点击后因回调卡片更新载荷不被接受而出现通用错误码。
- Shell 侧把 `defaultWorkDir`、bridge-native sessions、shell/web sessions 和启动失败日志尾部整合进同一块控制中心面板；其中 shell/web session 目前只允许“导入为新的 bridge session”，避免误绑异构 session id。
- 已完成 `go test ./...`、`cargo test --manifest-path src-tauri/Cargo.toml`、`pnpm build`；飞书真机卡片交互和桌面端手点 smoke 仍需补一次人工验收。

---

# Bridge WorkDir Sync / Feishu Markdown Todo

## Hard Constraints

- [x] Keep bridge runtime lifecycle unchanged unless a work-dir sync fix strictly requires config persistence updates.
- [x] Preserve existing bridge settings compatibility; explicit bridge-specific work-dir overrides must still win over app defaults.
- [x] Keep Feishu normal chat replies compatible with current `post/text` fallback while clarifying markdown limitations honestly.

## Implementation

- [x] Make bridge `defaultWorkDir` follow the app `work_dir` when bridge is still inheriting the app default or currently unset.
- [x] Update shell `save_work_dir` flow so changing the app work directory also persists the bridge default-follow behavior.
- [x] Add clearer IM bridge work-dir command aliases/help text so Feishu users can directly add/remove per-chat work directories.
- [x] Add focused tests for work-dir sync and Feishu command parsing aliases.

## Validation

- [x] Run focused Rust tests for bridge settings/work-dir sync.
- [x] Run focused Go tests for Feishu command parsing/help behavior.

## Retrospective

- Bridge 现在把 app 的 `work_dir` 当作全局默认来源：bridge 默认目录为空时会自动继承它，且只有在 bridge 之前本来就在跟随 app 默认目录时，app 改目录才会继续联动更新。
- 飞书里已经能直接按聊天“增删工作目录”了；这次把命令别名补成了更直观的 `/bridge cwd add <path>` 和 `/bridge cwd remove`，并在帮助卡片里明确了它们与全局默认目录的关系。
- 已完成 `go test ./internal/adapters/feishu -v`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`pnpm build`。

---

# Feishu Reply Card Mode Todo

## Hard Constraints

- [x] Keep Feishu normal replies backward-compatible by making card rendering opt-in.
- [x] Preserve bridge settings compatibility across Go bridge, Rust store, and TS UI round-trips.
- [x] Reuse existing Feishu interactive card primitives instead of introducing a new message transport path.

## Implementation

- [x] Add a persisted `feishuReplyCards` bridge setting and expose it in shell control center.
- [x] Thread the new setting into the Go bridge app wiring and Feishu adapter config.
- [x] Make normal Feishu model replies optionally send `interactive` cards with `lark_md`, while keeping current `post/text` fallback when disabled.
- [x] Add focused regression coverage for reply-mode selection and bridge settings normalization.

## Validation

- [x] Run focused Go tests for Feishu sender/config behavior.
- [x] Run focused Rust tests for bridge settings persistence.
- [x] Run a frontend build for the updated bridge runtime panel.

## Retrospective

- 普通 Feishu 模型回复现在可以按设置切到 `interactive` 卡片模式，沿用已有 `buildCard + lark_md` 组件，因此命令卡片、审批卡片和普通回复最终都走同一套渲染语义。
- `feishuReplyCards` 已经贯通到 Go bridge 配置、Rust `bridge_settings.json`、TypeScript UI 类型和控制中心面板，旧配置缺少该字段时会安全回落到 `false`。
- 卡片模式对长回复会按较小分片大小拆成多张卡片，并带上 `Kimi reply (n/N)` 标题；关闭开关时仍保持原来的 `post/text` fallback，不影响现有聊天。
- 已完成 `go test ./internal/adapters/feishu ./internal/config`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bridge_settings_store -- --nocapture`、`pnpm build`。

---

# Feishu WorkDir Presets Todo

## Hard Constraints

- [x] Keep bridge settings backward-compatible; missing `workDirPresets` must safely fall back to an empty list.
- [x] Preserve current `/bridge cwd set|add|clear|remove` text-command behavior while adding preset buttons.
- [x] Do not add runtime hot-reload for presets; saving while bridge is running should only warn that restart is required for Feishu card freshness.

## Implementation

- [x] Add `workDirPresets` to Go bridge config, Rust settings store, and TypeScript bridge settings types with trim/filter/dedupe normalization.
- [x] Extend the Bridge Runtime panel with add/remove preset rows and a save-time restart hint for running bridge sessions.
- [x] Extend Feishu `/bridge cwd` cards to show preset buttons, highlight the active preset, and keep a clear-current-workdir action.
- [x] Add Feishu card callback handling for preset apply/clear and update the card in place after the click.

## Validation

- [x] Run focused Go tests for config normalization and Feishu cwd card/callback behavior.
- [x] Run focused Rust tests for bridge settings preset normalization.
- [x] Run a frontend build for the Bridge Runtime panel changes.

## Retrospective

- `workDirPresets` 现在已经贯通到 Go bridge、Rust `bridge_settings.json` 和 TypeScript 控制中心类型，保存时会统一做 trim、空值过滤和按路径去重，旧配置缺字段时安全回落为空列表。
- 控制中心 Bridge Runtime 面板新增了可编辑的预设目录列表，支持逐行新增/删除；如果 bridge 正在运行，保存成功后会提示需要重启 bridge，飞书 `/bridge cwd` 卡片才会加载最新预设。
- 飞书 `/bridge cwd` 现在会同时显示默认目录、当前 binding workdir、选中的 preset，以及可点击的 preset 按钮和 `Clear current workdir` 操作；点按钮后卡片会原地刷新高亮状态。
- 已完成 `go test ./internal/adapters/feishu ./internal/config`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bridge_settings_store -- --nocapture`、`pnpm build`；真实飞书点击 smoke 仍需手工补一轮。

---

# OpenClaw-Lark Interaction Absorption Todo

## Hard Constraints

- [x] Keep the current Go Feishu adapter architecture and sidecar lifecycle unchanged; no Node runtime or detached daemon work.
- [x] Keep `/bridge help|sessions|cwd|approvals` backward-compatible while adding `start` and `doctor`.
- [x] Use additive SQLite migration only for binding onboarding metadata, and keep admin bindings JSON backward-compatible.

## Implementation

- [x] Add binding onboarding persistence fields plus a migration and store/router support for reading/updating onboarding state.
- [x] Extend Feishu bridge commands with `/bridge start`, `/bridge doctor`, and a shared `bridge_show_panel` card action.
- [x] Add onboarding cards with DM auto-send, group manual-send behavior, and quick actions into sessions/cwd/approvals/doctor.
- [x] Add doctor report/card generation that reuses bridge status, binding/session state, pending approvals, and a live Feishu credential probe.
- [x] Update Rust/TS binding record types if needed so new admin fields round-trip safely.

## Validation

- [x] Run focused Go tests for store migrations, Feishu command parsing/cards, onboarding gating, and doctor behavior.
- [x] Run targeted Rust tests if binding record shape changes require shell client coverage.
- [ ] Manually verify DM auto-onboarding, group `/bridge start`, and `/bridge doctor` card refresh in Feishu.

## Retrospective

- 这次没有把 openclaw-lark 的 runtime 搬进来，而是把最有价值的三层模式吸收到现有 Go Feishu adapter：统一 `/bridge` 命令入口、首次 welcome/onboarding 卡片、以及可原地刷新的 doctor 自诊断卡片。
- onboarding 元数据现在按 binding 持久化在 SQLite 里，采用加法式 `0008` 迁移补了 `onboarded_at` 和 `onboarding_version`，这样 DM 首次自动欢迎和未来版本化重引导都不再依赖内存状态。
- `bridge_show_panel` 把 help/start/sessions/cwd/approvals/doctor 六类卡片统一到一条 callback 链路，避免每个新面板都要单独发明 action 类型；同时继续沿用现有 `card_json` 原地更新路径。
- doctor 卡片复用了现有 bridge store + Feishu gateway 轻量 credential probe，默认给安全摘要和下一步建议，详情按按钮展开，不暴露 secrets 或原始日志尾部。
- 已完成 `go test ./internal/adapters/feishu ./internal/store ./internal/admin`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bridge_manager -- --nocapture`、`pnpm build`；真实 Feishu 会话的 DM/group smoke 仍需手工点一轮。

---

# Feishu Tools Doc Todo

## Hard Constraints

- [x] 文档只覆盖仓库里已经落地的飞书 IM Bridge 能力，不预写未来功能。
- [x] `tools.md` 放在项目根目录，采用“使用者手册 + 开发者附录”的双层结构。
- [x] 命令、卡片按钮、审批决策值、触发条件必须与当前实现完全一致。

## Implementation

- [x] 新增根目录 `tools.md`，说明飞书侧前置配置、入口规则、普通对话行为和回复模式。
- [x] 在 `tools.md` 中列出 `/bridge help|start|sessions|use|cwd|approvals|doctor` 及其别名、示例和返回结果。
- [x] 在 `tools.md` 中写清 onboarding、session 切换、workdir preset、clear workdir、approval resolve、panel switch 等卡片交互。
- [x] 在 `tools.md` 中补充开发者附录，说明 `mapMessageToInbound`、`parseBridgeCommand`、`stripExplicitSummon`、card actions 和 reply 渲染策略。

## Validation

- [x] 逐项对照 `commands_cards.go`、`approval.go`、`service.go`、`sender.go`，静态核对文档与实现一致。
- [x] 对照手工测试运行手册，确认文档没有声称支持未验证或不存在的飞书能力。

## Retrospective

- 新增的 `tools.md` 现在把飞书侧“怎么用”和“代码里怎么实现”放在同一份入口文档里，适合同时给使用者和开发者使用。
- 文档明确限定在当前已实现能力内：文本消息、`/bridge` 命令、交互卡片、审批、workdir、doctor；没有把文件上传、图片输入或未来 OpenClaw/Lark 演进提前写进去。
- 已完成静态核对，重点对齐了命令解析、群聊显式召唤、card action、审批决策值、reply card 开关，以及手工运行手册中已经定义的 Feishu 验证边界；本次未运行自动化测试，因为改动仅涉及文档与任务记录。
