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
# Control Center Editorial Redesign Todo

## Hard Constraints

- [x] Keep `useShellController` action signatures and control-center props stable.
- [x] Preserve fullscreen and workspace modal control-center behavior.
- [x] Keep modal shells fixed-header/fixed-footer with body-only scrolling.

## Implementation

- [x] Restructure the control center overview into an editorial dashboard with health summary, priority tasks, and quick actions.
- [x] Rework onboarding into a progress-driven layout with a visible step rail and focused detail panel.
- [x] Reframe runtime/diagnostics into a summary-first flow with expandable deep-dive panels.
- [x] Refresh shared control-center headers, modal shells, and status badges to use one coherent visual language.
- [x] Introduce control-center-specific design tokens, typography, surfaces, and motion in `App.css`.
- [x] Differentiate fullscreen/full and modal/dashboard presentations without changing core behaviors.

## Validation

- [x] Run a frontend build for `apps/kimi-shell`.
- [ ] Verify the redesigned control center still renders across overview, onboarding, runtime, fullscreen, and modal surfaces.
- [x] Review responsive behavior and state mapping for success, warning, running, and error states.

## Retrospective

- 控制中心现在改成了“编辑化仪表台”结构：概览页先给健康摘要和任务入口，设置页改成步骤轨道，运行页先给风险摘要再进入深挖面板。
- 展示层重组集中在 `ControlCenterView.tsx` 和 `App.css`，没有改 `useShellController` 的动作签名，也没有动后端接口。
- `pnpm build` 已通过；仍缺桌面端真实窗口下的 fullscreen / workspace modal 手点验收。

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

---

# Bridge Sandbox YOLO Research Todo

## Hard Constraints

- [x] 只依据 `kimi cli` 与 `kimi-agent-sdk-go` 官方仓库中的文档、代码、issue/README 等公开信息下结论，不混入非官方二手说法。
- [x] 明确区分“CLI 本身是否支持 sandbox yolo”与“bridge 接入 IM 对话时是否暴露/继承该能力”。
- [x] 如果官方仓库没有直接写明，需要标注为基于代码/接口行为的推断，而不是当成已承诺能力。

## Implementation

- [x] 查询 `kimi cli` 官方仓库中 sandbox、approval、yolo、bridge/IM 相关说明与实现。
- [x] 查询 `kimi-agent-sdk-go` 官方仓库中 sandbox、approval、yolo、bridge/IM 相关说明与实现。
- [x] 交叉比对两边接口，判断 bridge 连接飞书 IM 对话时，sandbox 下是否可以使用 yolo 模式，以及是否存在前提或缺口。

## Validation

- [x] 保存关键来源链接与日期，确保最终结论可追溯。
- [x] 将“明确支持 / 明确不支持 / 仓库未体现”三类证据分别归档到回顾里。

## Retrospective

- 调研基线：`MoonshotAI/kimi-cli` 已拉到 `a304a0dc609293bde79a921e42751dda6d635ae9`（2026-03-17），`MoonshotAI/kimi-agent-sdk` 已拉到 `c207267072a6cdd084b75f6d0f167e14fb34be56`（2026-03-02）。
- 明确支持：`kimi-cli` 官方文档明确支持 `--yolo / --auto-approve / default_yolo`，且文档直接写明“在安全隔离环境中”可启用 YOLO；源码 `src/kimi_cli/soul/approval.py` 中 `self._state.yolo` 为真时会直接 `return True`，即跳过审批。
- 明确支持：`kimi-agent-sdk` Go SDK 官方文档要求默认必须处理 `ApprovalRequest`，但同时在 `guides/go/approval-requests.md` 和 `go/option.go` 明确提供 `kimi.WithAutoApprove()`，其实现就是向 CLI 追加 `--auto-approve`。
- 仓库未体现：两边官方仓库对 `Feishu` / `Lark` / `IM bridge` 关键字检索均无匹配，因此“bridge 连接飞书 IM 对话时”并不是官方单独承诺的场景，只能基于 CLI + Go SDK 的通用能力推断。
- 基于接口行为的推断：如果 IM bridge 底层是用 Go SDK/CLI 起会话，那么在 sandbox 场景下可以开启 YOLO；方式要么是启动 CLI 时传 `--yolo/--auto-approve`，要么在 Go SDK 里用 `kimi.WithAutoApprove()`。这样 approval 事件会在 CLI 层被自动放行，而不是继续抛到 IM。
- 对当前仓库的附加核对：本项目 `apps/kimi-im-bridge/internal/providers/kimi/sdk_driver.go` 与 `apps/kimi-im-bridge/internal/runtime/sdk_driver.go` 已经在 `request.AutoApprove` 为真时调用 `WithAutoApprove()`；因此现在飞书里仍看到 approval，说明更可能是当前会话/bridge 请求没有把 `AutoApprove` 打开，而不是官方能力缺失。

---

# Feishu AutoApprove Wiring Todo

## Hard Constraints

- [x] 新增 `feishuAutoApprove` 必须保持现有 bridge 配置向后兼容，旧 `bridge_settings.json` 缺字段时默认启用（`true`）。
- [x] 仅影响 Feishu 通道，不改变 Telegram 的审批行为。
- [x] 修复 session 持久化时 `autoApprove` 被覆盖为 `false` 的问题，保证 UI 与实际执行一致。

## Implementation

- [x] 扩展 Go sidecar 配置模型：`BridgeSettings` / 默认值 / 归一化支持 `feishuAutoApprove=true`。
- [x] 扩展 Rust+TS bridge settings 类型、默认值与归一化逻辑，保证前后端字段一致。
- [x] 在 Feishu adapter 配置中加入 `AutoApprove`，并在 `HandleInbound` 调用时传递 `HandleOptions.AutoApprove`。
- [x] 在 app adapter 构造阶段将 `settings.feishuAutoApprove` 注入 Feishu 配置。
- [x] 在 `bridgecore.Orchestrator` 与 legacy runtime 路径补齐 `AutoApprove` 透传/持久化，防止覆盖为 false。
- [x] 在 Bridge Runtime 面板新增 “Feishu Auto Approve” 开关，并在运行中改动该开关时提示需重启 bridge。

## Validation

- [x] Go config 单测：默认值与旧配置缺字段回填为 true。
- [x] Feishu adapter 单测：断言 orchestrator `HandleOptions.AutoApprove` 与配置一致。
- [x] Orchestrator/Runtime 单测：断言 session upsert 保存的 `AutoApprove` 与入参一致。
- [x] Rust `bridge_settings_store` 单测：默认值、读旧配置回填、save/load 往返不丢字段。
- [x] 前端构建或类型检查通过，确保 `BridgeSettings` 新字段不破坏现有调用。

## Retrospective

- `feishuAutoApprove` 现已贯通 Go sidecar 配置、Rust/Tauri settings DTO、TypeScript `BridgeSettings`、控制中心 UI，并默认开启（`true`）。
- 飞书消息链路现在会把该开关透传到 `HandleOptions.AutoApprove`，最终触发 `sdk.WithAutoApprove()`；Telegram 保持现状不受影响。
- `bridgecore.Orchestrator` 与 legacy runtime `turn_runner` 的 session upsert 已统一写入 `AutoApprove`，修复了后写覆盖为 `false` 的历史问题。
- 已执行并通过：
  - `go test ./internal/config ./internal/adapters/feishu ./internal/bridgecore ./internal/runtime`（workdir: `apps/kimi-im-bridge`）
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bridge_settings_store -- --nocapture`
  - `pnpm build`（workdir: `apps/kimi-shell`）

---

# Control Center Structure Refactor Todo

## Hard Constraints

- [x] 不改 `useShellController` 的 action 签名与控制中心核心行为路由。
- [x] 不改 Bridge 后端接口与 invoke 行为，只做信息架构与 UI 呈现迁移。
- [x] 一级导航改为标题栏 Tabs，移除 sidebar 导航渲染。

## Implementation

- [x] 扩展 `ControlSectionId`，新增独立一级 section：`bridge_center`。
- [x] 将 `ControlCenterView.tsx` 一级导航迁移到 `cc-modal-header` 的 tabs（便签样式）。
- [x] 从 onboarding 步骤中移除 `bridge`，保留安装/右键菜单/登录API/工作目录四步。
- [x] 新增独立 `IM Bridge` Tab，并复用现有 Bridge 操作块。
- [x] 删除标题区、导航区、overview/onboarding/runtime 中说明性文案（保留错误与结果提示）。
- [x] 状态标签统一为短词：`就绪 / 待办 / 进行中 / 异常 / 不支持`。
- [x] 更新 `App.css`：新增 `cc-header-tabs` 相关样式，清理 sidebar/nav 对布局的影响并适配窄屏横向滚动。

## Validation

- [x] `pnpm build`（workdir: `apps/kimi-shell`）通过。
- [x] 检查 tabs 切换：`概览 / 快速设置 / 运行诊断 / IM Bridge` 均可进入（静态代码路径核对）。
- [x] 检查 onboarding 中不再出现 Bridge 步骤。
- [x] 检查 `runtime` 与 `bridge` 的操作链路（刷新/启动/停止/配置）仍可触发（静态代码路径核对）。

## Retrospective

- 一级信息架构已从 `sidebar` 切到标题栏 Tabs，`activeControlSection` 仍作为唯一一级导航状态，避免引入额外状态复杂度。
- IM Bridge 已从 onboarding 流程拆出并升级为独立一级 Tab；原有 Bridge 关键动作（保存、启动、停止、刷新、配置、审批）保持不变并集中到新页面。
- 状态标签已收敛到短词表，去掉句子型状态；说明性文案在标题区、导航区、overview/onboarding/runtime 的主容器里做了批量精简。
- 已完成 `pnpm build`；尚缺桌面端手点验收（tabs 真实交互、窄屏滚动体验、Bridge 实际启停链路）。

---

# Control Center Tabs + Bridge Status Tag + Brief Tips Todo

## Hard Constraints

- [x] 保留 workspace 弹窗与 fullscreen 双入口，不改后端 API / invoke 命令签名。
- [x] 控制中心内部 chrome 收敛到单一 `full` 形态，不再保留 `dashboard` 分支。
- [x] 简报 Tips 复用现有 `agentTips` 数据源，不新增配置文件。

## Implementation

- [x] 收敛 `ControlCenterChrome` 类型为单值，并移除 `useShellController` 中 `controlCenterChrome` 状态与所有分支设置。
- [x] `openControlCenter()`（workspace）统一打开带 tabs 的概览页；关闭/返回后重开行为保持重置一致。
- [x] `ControlCenterView` 头部改为同一行结构：标题（左）/ Tabs（中）/ 关闭按钮（右），Tabs 在 modal/fullscreen 常驻。
- [x] `ControlCenterView` 概览“简报”在无阻塞项时展示本地随机 tips 卡片，并提供右上角刷新按钮仅刷新该卡片。
- [x] `App.tsx` 底栏新增 Bridge 状态标签按钮：`stopped/crashed` 可一键启动；`running/starting/degraded/stopping` 仅状态展示不可点击。
- [x] 补充 `App.css` 样式：头部单行三列 + tabs 横向滚动不换行 + bridge 标签 tone + 简报 tips 卡片样式。

## Validation

- [x] `pnpm build`（workdir: `apps/kimi-shell`）通过。
- [x] 代码路径核对：深链 `/control-center` `/onboarding` `/diagnostics` `/logs_paths` 仍映射到统一 tabs 框架。
- [x] 代码路径核对：简报 tips 刷新仅作用于 `ControlCenterView` 本地 state，不影响启动/关闭小窗 tips。

## Retrospective

- 控制中心已从“modal dashboard/full 双态”收敛为单态渲染，减少了打开/重置/路由分流中的条件分支。
- 标题栏现在稳定为一行三段布局，Tabs 常驻并在窄屏下横向滚动，关闭按钮不会被换行挤出。
- 底栏 Bridge 标签按状态策略实现了“未启动可一键启动，已启动相关状态只读展示”，并保持短词状态映射一致。
- 概览简报在无阻塞时展示随机 tips 卡片，支持局部刷新，不会干扰 prefill/shutdown 的 tip 状态。

---

# README Explorer Open Logic Note Todo

## Hard Constraints

- [x] 仅更新 README / README_zh 的长期说明文案，不改代码逻辑。
- [x] README 里的描述必须与当前右键目录、单文件、多文件真实行为一致，不夸大为“自动切换 session”。
- [x] 文案保持产品导向，但明确“文件会复制进新工作区”这一关键语义。

## Implementation

- [x] Review Explorer 右键目录、单文件、多文件打开链路与 session/工作区行为。
- [x] 在英文 README 的亮点和能力说明中补充单文件/多文件右键打开的准确描述。
- [x] 在中文 README 的核心亮点和项目能力中同步补充对应说明。

## Validation

- [x] 核对 README 新文案与当前 `open_request.rs` / `context_menu.rs` / `workspace_session.rs` 行为一致。
- [x] 确认中英文 README 结构与信息密度保持一致。

## Retrospective

- 当前 Explorer 右键链路支持目录、单文件与多文件三类入口：目录会直接接管为工作目录，文件会复制到新建工作区后再启动 shell。
- 这套逻辑目前是“工作区接管/复制导入”语义，而不是“自动切换到对应 session”语义，因此 README 文案已避免误导性表述。
- 中英文 README 已同步补上这项亮点，保持产品向表达，同时不失真。

---

# Release v0.0.28 Todo

## Hard Constraints

- [ ] 合并到 `main` 前先同步远端状态，避免基于过期 `main` 发版。
- [ ] 发布说明与版本号必须与当前 `0.0.28` 保持一致，不夸大未落地的能力。
- [ ] 推送时同时处理 `main` 与版本 tag，确保 release 可追溯。

## Implementation

- [x] 核对当前分支、远端、版本文件与已有 release notes。
- [ ] 同步远端 `main` 并完成合并准备。
- [ ] 运行关键校验并创建发布提交/版本 tag（如缺失）。
- [ ] 推送 `main` 与 `v0.0.28`，整理简要中文更新说明。

## Validation

- [ ] 确认 `apps/kimi-shell/package.json` 与 `src-tauri/Cargo.toml` 版本均为 `0.0.28`。
- [ ] 确认 `apps/kimi-shell/docs/release-notes-0.0.28.md` 可作为发布说明来源。
- [ ] 确认远端已收到 `main` 最新提交与 `v0.0.28` tag。

## Retrospective

- [ ] 待完成发布后回填。
