# Bridge Ops Skill Auth Injection Fix Todo

## Hard Constraints

- [x] 保持现有 bridge admin / host-control 接口协议不变，只修复 skill 侧 auth file 发现与传递。
- [x] 保持 `KIMI_BRIDGE_AUTH_FILE` 兼容，不能破坏已经依赖环境变量的调用链。
- [x] 优先修复真实 skill 执行链路，不把问题转嫁给用户手动设置环境变量。

## Implementation

- [x] 让 `skills/bridge-ops/scripts/bridge_ops.ps1` 支持显式 `--auth-file`，并在环境变量缺失时做受控回退发现。
- [x] 将 Feishu 注入的 `[bridge_context]` 扩展为包含 auth file 路径，避免 skill 执行依赖进程环境继承。
- [x] 更新 `skills/bridge-ops/SKILL.md`，要求脚本调用优先传入上下文里的 auth file。
- [x] 为脚本/提示上下文补充回归测试，覆盖 env 缺失但显式 auth file 存在的场景。

## Validation

- [x] 运行 bridge 侧相关 Go 测试。
- [x] 手工验证 `bridge_ops.ps1 status` 在显式 auth file 传参下可读取 bridge 状态或至少越过“env 未设置”错误。

## Retrospective

- [x] 记录为什么单靠 `KIMI_BRIDGE_AUTH_FILE` 环境注入在真实 skill 链路里不够稳，以及这次如何改成显式传参 + 兼容回退。

- 这次失败点不在 bridge admin 本身，而在“skill 脚本如何拿到 auth file”。原方案把 `bridge_ops.ps1` 完全绑在 `KIMI_BRIDGE_AUTH_FILE` 进程环境继承上，实际 agent/tool 链路里这个假设并不稳，结果就是脚本一运行就直接报 env 未设置。
- 现在改成三层优先级：Feishu prompt 上下文显式携带 `bridge_auth_file` 并要求脚本用 `--auth-file` 传入；原有 `KIMI_BRIDGE_AUTH_FILE` 保持兼容；最后脚本再尝试从本机 `com.kimi.shell` 默认配置目录兜底发现 auth file。
- 回归测试不再只验证 `os.Setenv`，而是直接执行真实 PowerShell 脚本并模拟 bridge admin API，确认“env 为空但显式 auth file 存在”时 `status` 可以成功返回 JSON。

# Bridge Ops V2 CLI Skill Todo

## Hard Constraints

- [x] Keep Feishu `/bridge` entrypoints hidden; do not re-enable slash commands or card callbacks.
- [x] Convert bridge ops to a pure CLI-agent skill; remove the Feishu-native bridge-ops executor path instead of keeping a fallback.
- [x] Do not auto-load the project `skills/` directory; only enable bridge ops skills when `KIMI_BRIDGE_SKILLS_DIR` is explicitly provided.

## Implementation

- [x] Rewrite `skills/bridge-ops/SKILL.md` so it instructs the agent to run a deterministic PowerShell helper instead of relying on adapter-native execution.
- [x] Add `skills/bridge-ops/scripts/bridge_ops.ps1` with JSON-returning `status`, `list-sessions`, `switch-session`, and `restart` commands.
- [x] Add optional `--skills-dir` bridge startup plumbing and thread it into both Kimi SDK driver paths via `WithSkillsDir(...)`.
- [x] Generate a bridge-local auth file for CLI skills and expose its path to spawned Kimi CLI sessions via `KIMI_BRIDGE_AUTH_FILE`.
- [x] Prepend a compact bridge context block to Feishu inbound prompts only when bridge skills are enabled.
- [x] Remove the Feishu-native `bridge_ops.go` interception / pending-confirmation flow so Feishu messages return to the normal agent prompt path.
- [x] Add focused regression coverage for skills-dir plumbing, auth-file injection, Feishu prompt behavior, and script-facing bridge admin data flow.

## Validation

- [x] Run focused Go tests for bridge app/runtime/provider/Feishu adapter changes.
- [x] Run focused Rust tests for shell bridge startup argument plumbing.
- [ ] Run a manual PowerShell smoke of `skills/bridge-ops/scripts/bridge_ops.ps1` against the local bridge admin surface when available.

## Retrospective

- [x] Capture what changed between v1 native bridge-ops execution and v2 pure CLI skill execution, including the fact that bridge ops are unavailable until `skillsDir` is explicitly enabled.

## Retrospective

- 第二版把 Feishu `bridge-ops` 从适配层原生拦截改成了真正的 CLI skill：消息重新进入正常 agent prompt，只有在 bridge 启动时显式传入 `--skills-dir` 时，Kimi CLI session 才会加载 `D:\MyProject\kimi-app\skills\bridge-ops`。
- 由于 bridge admin token 只存在宿主内存里，纯 CLI skill 不能直接“猜到” localhost 权限；这次通过 sidecar 生成桥接 auth file，并在拉起 Kimi CLI session 前注入 `KIMI_BRIDGE_AUTH_FILE`，把权限交给脚本而不是写死在 workdir 或日志里。
- 当前仓库内已完成 `go test ./...`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --nocapture`，并验证脚本在未注入 `KIMI_BRIDGE_AUTH_FILE` 时会安全失败；真正的 live bridge 手工 smoke 仍需在你显式启用 `KIMI_BRIDGE_SKILLS_DIR` 后再做一次。

---

# Feishu Bridge Ops Skill Todo

## Hard Constraints

- [x] Keep Feishu `/bridge` entrypoints hidden; do not re-enable slash commands or card callbacks.
- [x] Reuse existing bridge admin/binding/session control semantics; avoid changing public bridge APIs unless host restart plumbing strictly requires it.
- [x] Keep bridge ops replies lightweight and text-based so restart/switch flows do not depend on interactive card callbacks.

## Implementation

- [x] Add a project-local `skills/bridge-ops/SKILL.md` that defines the supported bridge ops intents, confirmation rules, and concise reply style.
- [x] Add Feishu bridge-ops intent parsing for explicit prefixes and high-confidence natural language while preserving hidden `/bridge` behavior.
- [x] Add chat/thread-scoped pending confirmation and session-selection state for `restart` and `switch_session`.
- [x] Reuse existing doctor/session/binding capabilities to implement `status`, `list_sessions`, and `switch_session` responses without routing through the normal model prompt path.
- [x] Add a minimal shell host-control endpoint so the bridge sidecar can request `restart_bridge` from the Tauri host.
- [x] Thread the host-control endpoint/token into bridge startup so Feishu restart confirmations can trigger a real bridge restart.
- [x] Add focused Go and Rust regression coverage for bridge ops parsing/execution and host-control restart plumbing.

## Validation

- [x] Run focused Go tests for Feishu bridge ops parsing, confirmation, and execution behavior.
- [x] Run focused Rust tests or cargo test coverage for the new host-control plumbing.
- [x] Verify the new skill file is present at `D:\MyProject\kimi-app\skills\bridge-ops\SKILL.md`.

## Retrospective

- `/bridge` 的底层 bridge 管理能力仍然保留；这次没有恢复飞书 slash/card 入口，而是在 Feishu 适配层前置了一层 text-based bridge ops executor。
- `restart` 之所以不能只在 sidecar 内部做，是因为真正的拉起动作掌握在 shell/Tauri 宿主里；因此这次补了一个最小 localhost host-control 通道来承接重启。
- session 选择流的编号必须和展示顺序完全一致；实现里最终以“当前绑定 session 优先显示”的顺序生成候选和编号，避免出现用户看到的序号与实际切换目标不一致。

---

# Feishu Image/File/Interactive Integration Todo

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

# IM Bridge Session Switch Investigation Todo

## Hard Constraints

- [x] 先确认问题是否由 web 侧切换 session 直接触发，再决定是否需要代码修复，避免误把网络抖动当作绑定逻辑问题。
- [x] 排查时优先复用现有日志、binding/session 持久化与 shell/session 聚合实现，不做猜测式结论。
- [x] 若发现问题，需要给出最小影响面的修复方案，并在验证后再标记完成。

## Investigation

- [x] 梳理用户提供日志中的时间线，确认 bridge 停止/重启前是否已有网络或连接异常信号。
- [x] 检查 Feishu binding、session 切换、shell/web session 聚合与 bridge dispatch 相关代码路径。
- [x] 判断 Kimi Code Web 切换 session 是否会影响当前 binding 命中的 bridge-native session 或消息派发门禁。
- [x] 如发现根因在代码，实施修复并补充最小必要验证；如不是代码问题，整理可复现条件和排查建议。

## Validation

- [x] 运行最小必要的测试或静态验证，证明结论与代码现状一致。

## Retrospective

- [x] 这次日志里真正异常先出现在 Feishu 长连接：`transient_network` + `wsasend: An established connection was aborted by the software in your host machine.`，它比 bridge 重启更早出现，更像宿主机网络/安全软件中断了连接，而不是 web 切 session 直接打断了 binding。
- [x] shell/web session 与 IM bridge session 在当前实现里是分层的：shell 侧只把 workspace session 聚合展示为 `source = shell/web`，并明确标记 `switchable = false`、`importable = true`；飞书 binding 真正使用的是 bridge-native session，因此单纯在 web 上切 session 不会直接改写 Feishu binding。
- [x] 用户日志里的 `binding rebound` 与 `binding workdir updated` 更符合 bridge 启动后自动轮换 binding session 的现有设计；`resetBindingSessionOnBridgeStart` 默认值就是 `true`，bridge 成功启动后 shell 会对已有 binding 逐个生成新的 bridge-native session id 并回写 workdir。
- [x] 本次未改业务代码；完成了静态代码核对，并跑通 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bridge_manager -- --nocapture` 与 `go test ./internal/binding ./internal/store ./internal/adapters/feishu` 作为最小验证。

---

# Feishu IM Bridge Recovery Diagnostics Todo

## Hard Constraints

- [x] 不改现有 sidecar 架构，不引入独立 watchdog 或额外后台进程。
- [x] 保持现有 session / binding / import 语义不变，只增强通道恢复可观测性、doctor 与控制中心状态展示。
- [x] 诊断文案优先解释“通道异常”和“binding/session 异常”是不同问题，避免误导用户直接重启。

## Implementation

- [x] 为 bridge channel status 扩展恢复诊断字段：`lastReadyAt`、`lastFailureAt`、`lastFailureOperation`、`lastFailureRetryable`、`consecutiveFailures`、`nextRetryAt`、`lastRecoveryAt`、`recoveryHint`。
- [x] 新增 SQLite `0010_channel_recovery_diagnostics.sql` 迁移，并让 store 支持持久化/读取新的恢复诊断字段。
- [x] 在 Feishu service 中补齐连接生命周期日志：`opening`、`failure`、`retry scheduled`、`ready`、`recovered`，并对 `wsasend ... host machine` 归类为 `transient_network + host_connection_aborted`。
- [x] 升级 `/bridge doctor`，展示自动恢复状态、最近 ready/失败、失败阶段、连续失败次数、下一次重试与恢复提示，并给出更准确的下一步建议。
- [x] 扩展 Rust / TypeScript bridge status 类型与控制中心 Bridge Runtime 面板，新增 Feishu 连接恢复状态卡片与“刷新诊断”入口。

## Validation

- [x] 运行 `go test ./internal/adapters/feishu ./internal/store ./internal/app ./internal/admin`。
- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --nocapture`。
- [x] 运行 `pnpm build`（`apps/kimi-shell`）。

## Retrospective

- [x] 现在 bridge / doctor / 控制中心会共享同一份 Feishu 恢复事实，不再只能从 `bridge.log` 文本里手工猜测“是否还在自动恢复”。
- [x] `host_connection_aborted` 被单独提炼成恢复提示后，控制中心可以直接显示“本机连接被中断”，避免把宿主机网络/安全软件问题误导成飞书配置错误。
- [x] 即使通道已经恢复到 `ready`，最近一次失败时间、失败阶段、恢复时间和恢复提示仍会保留，便于回看“为什么刚才失联过”。
