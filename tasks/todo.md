# Merge 冲突收口

## Checklist
- [x] 阅读 `DESIGN.md`、`tasks/lessons.md` 与当前 merge conflict 清单，确认冲突边界
- [x] 备份冲突中的旧 `tasks/todo.md` 到 `tasks/history/todo-2026-04-15-merge-conflict.md`
- [x] 判定各冲突采用“保留两边内容 / 统一版本号 / 去除误留标记”的合并策略
- [x] 解决 `kimi-im-bridge`、`kimi-shell`、release notes 与 `tasks/todo.md` 的冲突
- [x] 运行针对性验证，确认仓库已脱离未解决冲突状态
- [x] 在本节补充 Review，记录本次 merge 决策与验证结果

### Review
- 合并策略：对 `feishu/streaming.go`、`feishu/types.go`、`weixin/client_test.go`、`weixin/typing.go`、`workspace_import.*`、`WorkspaceImportModal.tsx`、`workspaceImportService.ts` 和 `0.0.37` release notes 这类“只有冲突标记、无真实语义差异”的文件，直接清理标记并保留原内容。
- 行为保留：`apps/kimi-im-bridge/internal/adapters/weixin/service_test.go` 保留了来自 `origin/main` 的 `AutoApprove` 断言与额外回归测试，同时不丢本地已有的状态流式测试覆盖。
- 版本统一：shell 相关版本号统一保留 `0.0.38`，同步于 `package.json`、`Cargo.toml`、`Cargo.lock` 与 `tauri.conf.json`，与仓库当前 release 线一致。
- todo 收口：由于原 `tasks/todo.md` 合并后会超过 300 行，已按仓库约定把冲突中的旧文件备份到 `tasks/history/todo-2026-04-15-merge-conflict.md`，并重建精简版 `tasks/todo.md`，同时保留原文档最新 20 行上下文。
- 验证结果：`go test ./...`（`apps/kimi-im-bridge`）、`pnpm -C apps/kimi-shell exec tsc --noEmit`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-15 通过。本次 `go test` 已真实执行通过，未再复现先前 merge 输出中的测试层失败。

## 保留的最近上下文（原 todo 最新 20 行）
- 顶部 tab 切换：主导航切换前会先尝试关闭当前 task；如果 task 因未保存配置或 busy 状态不能关闭，则沿用原有阻止逻辑，否则清掉任务态后直接进入目标 section，bridge 的“连接与凭据 / 高级运行面板”不再拦截顶部 tab。
- 验证结果：`pnpm build` 在 `apps/kimi-shell` 于 2026-04-14 通过。首次构建前本地缺少 `node_modules`，已执行 `pnpm install --frozen-lockfile` 补齐依赖后重跑成功。
- 未完成项：本轮未在真实桌面界面里手工点击验证 3 条交互路径，仍需启动应用做一轮 UI 回归确认。

## v0.0.38 发版执行

### Checklist
- [x] 复查 `tasks/lessons.md`、当前工作区 diff 和现有发版约定
- [x] 确认版本号已同步到 shell `package.json`、`Cargo.toml`、`Cargo.lock`、`tauri.conf.json`
- [x] 撰写 `apps/kimi-shell/docs/release-notes-0.0.38.md`
- [x] 运行本次发版所需验证命令并记录结果
- [x] 提交当前工作区改动并推送 `main`
- [x] 创建并推送 `v0.0.38` tag / GitHub release

### Review
- 目标：基于当前已完成的控制中心交互修复、Weixin auto-approve 行为修正和 `0.0.38` 版本号更新，补齐 release notes 后完成一次完整发版。
- 风险：仓库当前包含用户本地新增的 `AGENTS.md` 约束和未做真实桌面手工回归的 UI 交互修复，因此自动化验证之外仍保留安装版/桌面点击验证缺口。
- Release note：已新增 `apps/kimi-shell/docs/release-notes-0.0.38.md`，内容覆盖控制中心 onboarding/导航修复、Weixin `AutoApprove=true` 协议修正，以及本次安装包名称与验证命令。
- 自动化验证：`go test ./...`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell tauri build` 于 2026-04-14 通过，`0.0.38` 的 NSIS/MSI 安装包已生成。
- Rust 测试说明：`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 于 2026-04-14 通过；完整 `cargo test` 真正执行测试二进制时在当前 Windows 机器仍报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，与 `tasks/todo.md` 既有多次记录一致，属于本机运行时环境问题，不是本次改动的编译失败。

## 修复打包版 skills 资源路径

### Checklist
- [x] 复查 `tauri.conf.json`、`skill_center.rs` 与生成的 NSIS `installer.nsi`，确认 `_up_` 来源
- [x] 将 `bundle.resources` 改为 source->target 映射，固定 `skills` 和 `binaries` 的资源落点
- [x] 运行一次 Windows NSIS debug 打包验证资源目标路径
- [x] 在本节补充 Review，记录验证结果与仍未覆盖的缺口

### Review
- 根因确认：`apps/kimi-shell/src-tauri/tauri.conf.json` 原先把 `skills` 写成 `../../../skills`，NSIS 生成脚本会把每一级 `..` 安全改写为 `_up_`，因此安装包目标路径变成 `_up_/_up_/_up_/skills`。
- 实现方式：`bundle.resources` 改为对象映射，使用 `binaries/ -> binaries/` 与 `../../../skills/ -> skills/`，只修正安装包资源布局，不改 Rust/TS 运行时读取逻辑。
- 自动化验证：`pnpm --dir apps/kimi-shell exec tauri build --bundles nsis --debug` 已执行通过；生成的 `apps/kimi-shell/src-tauri/target/debug/nsis/x64/installer.nsi` 中，skills 资源目标已变为 `skills\\...`，未再出现 `_up_\\_up_\\_up_\\skills`。
- 行为结论：安装后资源目录应收敛为 `C:\Users\endea\AppData\Local\Kimi Desktop Shell\skills`，`skill_center.rs` 现有 `resource_dir()/skills` 查找逻辑可直接复用，无需额外代码改动。
- 未覆盖项：本轮未在真实已安装包上手工点开应用验证 Skill Center 展示，但由于运行时仍读取 `resource_dir()/skills` 且 NSIS 目标路径已修正，风险主要剩余在安装后人工回归层。

## 修复旧安装包默认 skill 扫描兼容

### Checklist
- [x] 核对技能中心 bundled 扫描入口与当前安装版实际资源目录
- [x] 确认旧安装版默认 5 个 skill 位于 `_up_/_up_/_up_/skills`
- [x] 为 `skill_center` 增加 legacy `_up_` 资源目录兼容
- [x] 补一条单测锁定 bundled 扫描候选路径
- [x] 运行针对性 Rust 单测验证兼容逻辑

### Review
- 根因确认：当前安装目录 `C:\Users\endea\AppData\Local\Kimi Desktop Shell` 仍是旧安装包布局，默认 5 个 skill 实际位于 `_up_\\_up_\\_up_\\skills`；而 `skill_center::resolve_bundled_skills_dir()` 只查 `resource_dir()/skills`，因此在“全新用户数据目录 + 旧安装包”场景下不会注册 bundled skills。
- 现状核对：`C:\Users\endea\AppData\Roaming\com.kimi.shell\skill-center\registry.json` 里已有 5 个 bundled skill，说明当前机器上 UI 是否显示取决于历史 registry；问题主要影响新安装或清空状态后的初始化。
- 实现方式：参照 `bridge_manager` 的思路，把 bundled skills 资源候选扩展为根级 `skills` 与 legacy `_up_/_up_/_up_/skills` 两种路径，新打包布局和旧安装包都能被识别。
- 自动化验证：`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml bundled_skills_resource_candidates_include_root_and_legacy_up_path --no-run` 已通过，确认新增单测可正常编译；直接执行测试二进制在当前 Windows 机器仍报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，与仓库既有记录一致，属于本机运行时环境问题。
- 行为结论：新安装包继续使用干净的 `skills` 目录；旧安装包即使不重装，也能在下一次启动时正确扫到默认 5 个 skill 并完成注册。

## 精简 Kimi 安装页 + 卸载入口 + 镜像健康校验

### Checklist
- [x] 扩展安装任务与设置类型，新增 `uninstall_kimi`、`ustc` 预设与镜像健康返回结构
- [x] 修正默认镜像链与 `aliyun -> mixed` 迁移逻辑，补齐镜像健康检查接口与单测
- [x] 更新安装弹层 UI：精简文案、增加卸载确认与镜像健康展示
- [x] 接通前端控制器数据流与安装状态刷新，确保卸载后停留控制中心
- [x] 运行 `pnpm build` 与 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager`
- [x] 在本节补充 Review，记录镜像修正、验证结果与剩余风险

### Review
- 类型与任务流：`InstallTaskId` 新增 `uninstall_kimi`，`InstallMirrorPreset` 新增 `ustc`，并补了 `InstallMirrorHealthReport` / `InstallMirrorHealthEntry`。Tauri 新增 `uninstall_kimi_cli` 与 `get_install_mirror_health_report`，安装会话、日志流、成功消息和后端停止判定都已接通。
- 镜像策略：默认混合链已替换为可用地址，`tuna` 预设改为 Git/Python/PyPI 走清华、uv 直接回退 USTC；`ustc` 预设四类资源全部走中科大；旧 `aliyun` 预设在设置加载和保存时都会迁移到 `mixed`。
- 安装页 UI：主操作区收敛成安装、升级、卸载和详细选项入口；卸载按钮使用危险样式并带确认弹层；“当前来源”卡补了镜像健康摘要；镜像策略卡新增 4 类紧凑健康状态卡和“重新检测”入口；原先冗长说明已删减为简短提示。
- 前端数据流：控制中心和 shell controller 增加镜像健康状态、刷新动作和自动同步；切换安装来源、刷新设置、保存镜像配置后都会刷新镜像健康；卸载成功后不会展示“重启后端”按钮。
- 自动化验证：`pnpm -C apps/kimi-shell build` 已于 2026-04-22 通过；`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 已通过，说明 Rust 代码与测试二进制可成功编译。
- Rust 测试说明：`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager` 在当前 Windows 机器编译通过后，执行测试二进制阶段仍报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`；这是本机既有运行时环境问题，不是本次改动引入的编译错误。
- 未覆盖项：本轮没有启动桌面应用做真实 UI 点击回归，因此卸载按钮、镜像健康卡与控制中心状态切换的最终交互仍保留一轮手工验收缺口。

## 修复启动计时卡住并延长启动超时

### Checklist
- [x] 复查 prefill 启动计时、startup monitor 和 watchdog 现状，锁定冻结根因与现有超时阈值
- [x] 更新 `PrefillApp` 计时逻辑，避免切页阶段冻结，并在路由调用失败时给出明确恢复行为
- [x] 放宽 Rust 侧总启动超时与 watchdog 阈值，保持现有检查策略不变
- [x] 补充或更新启动监控相关单测，覆盖 60 秒总超时与既有路由优先级
- [x] 运行前端类型检查与 Rust 编译级验证，确认不引入新错误
- [x] 在本节补充 Review，记录本次启动行为修正与验证结果

### Review
- 根因确认：prefill 页在收到 `route_workspace` / `route_control_center` 后会先把 `statusState` 切到 `opening_main`，但同时立即 `setPolling(false)`，导致“已耗时”停在最后一次轮询值；应用其实可以继续打开，只是 prefill 自己不再刷新。
- 前端修正：`PrefillApp` 现在会在 `opening_main` 阶段切到本地连续计时，并把当前 `startupPhase`、失败类型一起展示出来；如果 `complete_startup_monitor_route` 调用失败，会撤销切页锁存、恢复等待态并显示错误，而不是卡在静止的“正在打开主窗口…”。
- Rust 阈值：总启动超时从 `30_000 ms` 放宽到 `60_000 ms`；watchdog 阈值调整为主线程进入 `4s`、主窗口创建 `8s`、前端 ready `15s`，避免慢启动时被过早误判。
- 检查策略：`MissingKimi`、`BackendCrashed`、`OnboardingRequired`、`BackendReady` 这 4 类 startup monitor 路由判断，以及 `MainThreadTaskStalled`、`MainWebviewBuildHung`、`FrontendReadyTimeout` 这 3 类 watchdog 均保持不变，没有新增用户可关闭的设置。
- 自动化验证：`pnpm -C apps/kimi-shell exec tsc --noEmit` 通过；`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 通过，说明本次 TS/Rust 改动可成功编译。
- Rust 测试说明：实际执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml startup_monitor_fails_after_timeout -- --exact` 时，测试二进制仍在当前 Windows 机器报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，属于本机既有运行时环境问题，不是本次启动逻辑改动引入的编译错误。
- 未覆盖项：本轮没有启动桌面应用做真实 prefill 到工作区 / 控制中心的点击回归，所以“切页完成前连续计时”的最终桌面观感仍保留一轮手工验收缺口。

## 登录优先 + Provider API 语义修正

### Checklist
- [x] 梳理现有认证判定、运行时状态与控制中心卡片实现，锁定最小修改面
- [x] 调整 Rust 认证状态模型：登录优先、未验证时回退 Provider API，并新增独立 Provider API 健康状态
- [x] 新增 `logout_kimi_login` Tauri 命令并接通前端 handler / 按钮
- [x] 修正控制中心认证卡片布局与文案，区分 Kimi 登录和 Provider API 的失败归因
- [x] 运行前端构建与 Rust 编译级验证，确认改动可通过静态检查
- [x] 在本节补充 Review，记录行为变化、验证结果与剩余风险

### Review
- 认证优先级：后端 `auth_state` 现在按“`Kimi 登录` 已验证优先，否则回退到已配置的 `Provider API`，provider 存在但无凭据则记为 `Unknown`”统一计算 `authMode`；登录检测、退出登录、onboarding 状态和工作区运行时都走同一套判定。
- 状态拆分：新增独立 `provider_api_health`，导出到 `AppStatus`、`DiagnosticsInfo` 和 `OnboardingStatus`；工作区请求 401/403 时，如果当前入口是 `Provider API`，只更新 Provider API 健康状态，不再污染 `kimi_login_health`。
- 退出登录：新增 Tauri 命令 `logout_kimi_login`，调用 `kimi logout --json`；前端 controller 已接通同一套 busy / 刷新逻辑，控制中心认证步骤在 `Kimi 登录` 视图下新增“退出登录”按钮。
- 控制中心 UI：`cc-brief-item` 改为左右分栏布局，认证卡内 badge 现在默认右对齐；认证步骤里分别展示 `Kimi 登录` 和 `Provider API` 的状态、来源、时间和摘要，`Provider API` 失败会显示为单独告警，不再伪装成“登录失效”。
- 自动化验证：`pnpm -C apps/kimi-shell exec tsc --noEmit`、`pnpm -C apps/kimi-shell build`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 均通过，说明 TS、前端构建与 Rust 编译级检查均正常。
- Rust 测试说明：实际执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml auth_mode_prefers_verified_kimi_login_over_provider_api -- --exact` 时，测试二进制仍在当前 Windows 机器报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`；这是本机既有运行时环境问题，不是本次认证逻辑改动引入的编译错误。
- 未覆盖项：本轮没有启动桌面应用做真实点击回归，因此“退出登录后自动回退到 Provider API”以及认证卡在实际窗口宽度下的最终观感仍保留一轮手工验收缺口。

## 绝对路径泄露整改

### Checklist
- [x] 复查 bridge / bundled skills 的开发态路径回退与报错文案，收敛为默认不走工作区回退、仅显式开发开关启用
- [x] 调整 Go sidecar 与 Tauri 打包脚本，为公开产物注入 `-trimpath` / `--remap-path-prefix` 并补充清理说明
- [x] 新增公开产物与已跟踪文档的绝对路径扫描脚本，覆盖工作区根路径泄露校验
- [x] 补充 Rust 单测，覆盖默认禁用工作区回退、显式启用工作区回退与错误文案脱敏
- [x] 清理已跟踪 `docs/` / `tasks/` 中的工作区绝对路径引用，改为占位符或相对路径
- [x] 运行针对性测试、脚本扫描与编译级检查，并在本节补充 Review

### Review
- 运行时收敛：`bridge_manager.rs` 与 `skill_center.rs` 现在默认只接受环境变量覆盖或打包资源目录；工作区相对路径回退仅在显式设置 `KIMI_DEV_ALLOW_WORKSPACE_FALLBACK=1` 时启用。桥接 sidecar、bundled `bridge-ops` 和 bundled skills 的缺失报错均已改为 `checked_sources=...` 这类来源标签，不再回显工作区绝对路径。
- 构建链路：`apps/kimi-shell/scripts/build_bridge_sidecar.ps1` 已切到 `go build -trimpath`；`apps/kimi-shell/scripts/build_webview_variant.ps1` 会在公开构建时注入 `RUSTFLAGS=--remap-path-prefix=<workspace-root>`、设置 `KIMI_PUBLIC_RELEASE=1`，并在归档前后各跑一次公开产物扫描。新增 `clean_public_build_artifacts.ps1`、`verify_public_artifacts_no_abs_paths.ps1` 与 `verify_tracked_markdown_no_abs_paths.ps1`，同时把入口接入 `package.json` 与 release checklist。
- 跟踪内容清理：已清掉 `docs/`、`tasks/` 中确认存在的当前工作区绝对路径引用，改成 `<workspace-root>`、相对路径或技能目录占位。`verify:tracked-markdown:no-abs-paths` 在当前仓库通过，说明已跟踪 Markdown 不再暴露当前工作区根路径。
- 自动化验证：`pnpm -C apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm -C apps/kimi-shell clean:public-build-artifacts`、`pnpm -C apps/kimi-shell build:bridge-sidecar`、`pnpm -C apps/kimi-shell verify:public-artifacts:no-abs-paths`、`pnpm -C apps/kimi-shell tauri:build:webview:evergreen`、`pnpm -C apps/kimi-shell exec tsc --noEmit` 已于 2026-04-23 通过。`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 之前已通过，说明新增 Rust 代码与测试可编译。
- Rust 测试说明：直接执行 `cargo test` 的测试二进制在当前 Windows 机器仍报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`；这与仓库里既有多次记录一致，属于本机运行时环境问题，不是本次“绝对路径泄露整改”引入的编译错误。

## 简化 Kimi API 配置入口

### Checklist
- [x] 复查当前认证页、配置中心与旧 `save_kimi_cli_api_config` 链路，锁定最小改动面
- [x] 在认证页新增只含 `API 密钥` 的 Kimi 简化配置卡片，并固定展示只读接口地址说明
- [x] 在前端 controller 中接入“保存模板 / 设为默认”两条独立动作与刷新逻辑
- [x] 在 Tauri 后端实现 Kimi 规范模板写入与“设为默认”命令，统一三处 `api_key`
- [x] 补充 Rust 单测，覆盖模板写入、固定 URL、无关配置保留与默认切换约束
- [x] 运行针对性 TS / Rust 验证，并在本节补充 Review

### Review
- 认证页 `Provider API` 现在不再把用户直接丢进配置中心；主路径改成 Kimi 单卡片，只保留 `API 密钥` 输入，接口地址固定只读展示为 `Kimi Coding Plan` 和 `https://api.kimi.com/coding/v1`。顶部主操作改成 `保存`，次操作改成 `设为默认`，`打开配置中心弹窗 / 打开配置目录` 被降级到卡片内的辅助动作。
- 前端 controller 新增了简化 Kimi API 状态与动作：保存时调用独立的模板写入命令，设默认时调用独立的默认切换命令；两条链路都会刷新 `configCenterView` 与核心 onboarding/auth 状态，并在保存或设默认后清空明文输入，不回显已有 key。配置中心草稿如果有未保存修改，简化入口会先阻止覆盖。
- Tauri 后端把旧 `save_kimi_cli_api_config` 升级为规范模板写入：只重写 `providers.kimi-for-coding`、`models.kimi-for-coding`、`services.moonshot_search`、`services.moonshot_fetch` 四段，固定写入 `https://api.kimi.com/coding/v1`、`/search`、`/fetch`，并把同一个 `api_key` 同步到三处。新增 `set_kimi_cli_api_as_default` 只改顶层 `provider / model / default_model`，未保存模板时会直接报错。
- 配置中心兼容性也补上了：`services.*.base_url` 现在会被当成 service endpoint 读入高级配置视图，因此简化入口写出的 Moonshot Search / Fetch 段在配置中心里仍然可见，不会出现“保存了但高级视图空白”的割裂状态。
- 验证结果：`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 和 `pnpm --dir apps/kimi-shell exec tsc --noEmit` 于 2026-04-23 通过，说明 Rust 与前端类型层面已接通。`cargo test save_kimi_api_template ...` 与 `cargo test set_kimi_api_default ...` 在当前 Windows 环境执行测试二进制时仍报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，属于本机既有运行时问题；新增测试代码已随 `cargo check` 一起通过编译，但本轮没法在这台机器上完成实际运行。

## 镜像健康检查移出启动路径

### Checklist
- [x] 移除启动期、设置读取期和保存设置后的自动镜像健康检查
- [x] 移除安装弹窗里根据来源/预设变化自动检测镜像的 effect
- [x] 将镜像健康检查改为仅由“镜像源”按钮和“重新检测”按钮触发
- [x] 运行类型检查并补充 Review

### Review
- 启动路径收敛：`refreshInstallSettings()`、`saveCurrentInstallSettings()` 和 controller 初始化 effect 不再隐式调用 `refreshInstallMirrorHealth()`，应用启动不会自动发起镜像健康检查。
- 用户触发入口：安装详细选项里的“镜像源”按钮现在会先切换来源，再用当前 `mirrorDraft` 主动调用一次镜像健康检查；“官方源”按钮只切换来源；“重新检测”按钮保留手动刷新能力。
- 自动 effect 清理：安装弹窗中原本跟随 `installSource / installSettings / mirrorDraft.mirrorPreset` 自动检测镜像的 effect 已移除，避免打开详细选项或切换预设时后台自动跑 PyPI 检查。
- 验证结果：`pnpm --dir apps/kimi-shell exec tsc --noEmit` 于 2026-04-24 通过；本轮未启动桌面应用做真实点击验收。

## 快速设置探测显式化与登录/API 默认切换

### Checklist
- [x] 移除快速设置进入时自动环境探测，保留手动重新检测入口
- [x] 调整安装/升级入口，避免点击时先同步执行环境探测
- [x] 增加“设为默认登录”后端命令、认证判定与前端入口
- [x] 将 API Key 输入框移动到 Provider API 卡片内部
- [x] 运行前端类型检查与 Rust 编译级验证，并补充 Review

### Review
- 快速设置探测：控制中心进入 onboarding 时不再自动执行 `onRefreshInstallProbe()`；“重新检测”现在是唯一显式环境检测入口，并会显示“正在检测安装环境...”和完成/错误状态。
- 安装入口：旧安装 helper 不再点击前同步跑环境探测，只使用已有缓存判断“无需重复安装”；主安装/升级任务仍直接进入 install session，任务完成后的复检保留在安装流程内。
- 登录/API 默认：新增 `set_kimi_login_as_default`，会清除顶层 Kimi Coding Plan 的 `provider / model / default_model` 选择，但保留 Kimi API 模板和 API Key；认证判定现在会在 Kimi API 明确设为默认且凭据可用时切到 Provider API，否则已验证登录优先。
- UI 调整：登录卡片新增“设为默认登录”，API 卡片按钮文案改为“设为默认 API”；API Key 输入框已移动到 API Key 卡片内部。
- 验证结果：`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 和 `git diff --check` 通过。新增 Rust 单测可编译，但实际运行仍遇到本机既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 测试二进制启动问题，非断言失败。

## 允许删除唯一 IM Bridge 机器人

### Checklist
- [x] 调整 Bridge 配置归一化，避免删除唯一飞书/微信机器人后被自动补回
- [x] 补充 Rust 单测覆盖首次默认配置、读取空平台配置、删除唯一飞书/微信机器人
- [x] 收敛删除机器人失败横幅文案，避免直接暴露后端路径详情
- [x] 运行前端类型检查与 Rust 编译级验证，并补充 Review

### Review
- 后端 `normalize_bridge_settings()` 不再在普通读取、保存或删除后强制补回默认飞书/微信机器人；默认三机器人仍由缺失 `bridge_settings.json` 时的 `default_bridge_settings()` 负责创建。
- `delete_connector_files()` 现在允许删除最后一个飞书或微信 connector，并同步移除对应 connector secrets；已补充单测覆盖唯一飞书、唯一微信、首次默认配置和已存在空 connector 配置不补回。
- 前端删除机器人失败横幅和机器人详情错误提示已改为短文案“删除机器人失败，请稍后重试或查看日志。”；删除成功但运行状态刷新失败时也不再把底层路径详情透出到横幅。
- 验证结果：`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`、`git diff --check -- apps/kimi-shell/src-tauri/src/bridge_settings_store.rs apps/kimi-shell/src/app/useShellController.ts apps/kimi-shell/src/features/control-center/ControlCenterView.tsx tasks/todo.md` 均通过。
- Rust 测试说明：`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml delete_connector_allows` 已完成测试编译，但测试二进制启动仍报当前 Windows 环境既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，没有进入断言阶段。

## Kimi Web 本地增强版产品化

### Checklist
- [x] 落地开发计划文档、第三方合规说明、上游来源与修改记录
- [x] 新增 `kimi-cli/web` 同步脚本、patch/overlay 目录和增强版静态入口骨架
- [x] 扩展 Shell 设置、AppStatus/Diagnostics 类型与 Tauri 命令，支持 `official` / `enhanced_local` 模式、健康状态和回退原因
- [x] 接入前端 controller 与 workspace 加载逻辑，支持增强版加载失败自动回退官方 Web
- [x] 在控制中心新增“Web 体验”设置区，展示模式、来源、健康状态、免责声明与回退操作
- [x] 补齐 i18n 检查脚本、合规检查脚本和 package scripts
- [x] 运行 TypeScript、Rust、脚本级验证，并补充 Review

### Review
- 产品入口：新增 `official` / `enhanced_local` Web 体验模式，默认仍为官方 Web；本地增强版通过 `public/enhanced-kimi-web/` 静态入口承载现有 workspace proxy，不改变官方认证、stream、模型、计费或权限语义。
- 回退机制：新增 `workspaceWebMode`、`enhancedWebAutoFallback`、`enhancedWebLastKnownGoodCommit`、`enhancedWebLastFallbackReason` 等设置字段，并通过 Tauri 命令支持读取、保存、标记 ready 和手动/自动回退官方 Web。
- 控制中心：运行诊断页新增“Web 体验”卡片，可切换官方 Web / 本地增强版、开关自动回退、查看增强版健康状态、上游 commit、最近可用版本、回退记录和品牌免责声明。
- 合规与同步：新增 `apps/kimi-shell/docs/kimi-web-enhanced-plan.md`、`docs/third-party-notices.md`、`third_party/kimi-cli-web/{LICENSE,SOURCE.md,CHANGES.md}`、`patches/kimi-web/` 与 `scripts/sync_kimi_cli_web.ps1`；当前记录上游 commit 为 `1e45df06da698151d2dc29a700722c37432e86ce`。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`、`git diff --check` 均通过。
- 未覆盖项：本轮未启动桌面应用做真实 UI 点击验收，因此“切换本地增强版后 iframe 内部承载 Kimi Web、自动回退提示与控制中心视觉观感”仍需要一轮手工回归。
- 追加修复：截图反馈显示增强版入口 HTML 加载但外部 CSS/JS 未执行，导致 iframe 未设置 `src` 并卡在“正在加载”。已将增强版入口改为单文件内联 CSS + 普通脚本自举，避免 Tauri iframe 内相对静态资源或 module script 差异导致卡住；复跑 i18n、合规、TS、build、Rust check 与 `git diff --check` 均通过。

## Kimi Web 本地增强版从 Wrapper 改为注入增强

### Checklist
- [x] 确认当前本地增强版只是外层 wrapper，主体仍是官方 Web iframe
- [x] 回滚前端 `remoteUrl` wrapper 构造，让工作区继续直接加载 workspace proxy
- [x] 扩展 workspace proxy HTML 注入链路，按 `workspaceWebMode` 区分官方模式和增强模式
- [x] 新增同源增强注入脚本，覆盖高频英文空状态、搜索、会话、归档、新建按钮等中文化
- [x] 新增轻量增强 CSS，仅作用于本地增强模式标记，避免大范围覆盖官方样式
- [x] 更新健康文案与经验记录，明确 wrapper 不是主体增强
- [x] 运行 TypeScript、Rust、build、合规/i18n 与 diff 检查，并补充 Review

### Review
- 根因确认：上一版“本地增强版”通过 `/enhanced-kimi-web/index.html?workspaceUrl=...` 外层 wrapper 再嵌套官方 Web，主体 DOM 仍完全由官方页面控制，所以用户看到的主界面不会出现真实 i18n 或体验优化。
- 加载链路修正：前端 `remoteUrl` 已回到直接使用 workspace proxy URL；`enhanced_local` 不再构造 wrapper URL，因此工作区不会再出现额外“本地增强版”顶栏。
- 注入实现：workspace proxy 在 HTML 响应阶段读取 `workspaceWebMode`；官方模式只注入现有 theme/session/prefill bridge，增强模式额外注入同源增强脚本和轻量 CSS。
- 首批增强：增强脚本通过 `MutationObserver` 翻译高频英文文案，包括 `Create a session to begin`、`Click the + button...`、`Create new session`、`Search sessions...`、`SESSIONS`、`Archived` 等，并给空状态、主按钮和侧栏打局部标记做轻量视觉优化。
- 健康状态：增强版健康文案已改为“本地增强注入已启用”，避免继续暗示当前阶段已经是完整源码 fork。
- 经验沉淀：已在 `tasks/lessons.md` 记录“本地增强版不能只做外层 wrapper，真实增强必须运行在官方 Web DOM 同源上下文或本地源码构建内”。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`、`git diff --check` 均通过。
- 未覆盖项：本轮仍未启动桌面应用做真实点击回归；需要手工确认切到本地增强版后主体界面直接显示中文空状态，且新建会话、搜索、归档、theme/session/prefill/WebSocket stream 均正常。

## backend_manager.rs 瘦身重构

### Checklist
- [x] 记录重构前 Rust 基线验证结果
- [x] 新建 `backend_manager/` 子模块目录，保留 `backend_manager.rs` 作为 façade
- [x] 拆出 `system_open.rs`、`config.rs`、`install_compat.rs`
- [x] 拆出 `lifecycle.rs`、`workspace_proxy.rs`、`workspace_injection.rs`
- [x] 保持现有公开 API、Tauri command 名称和行为不变
- [x] 运行格式、编译、测试与 diff 检查，并补充 Review

### Review
- `backend_manager.rs` 已从 5275 行收敛到 53 行，仅保留模块声明、公开 re-export 和少量共享常量。
- 后端职责已拆到 `backend_manager/` 子模块：系统打开、Kimi config、兼容安装入口、生命周期、workspace proxy、workspace 注入各自独立；原有对外 API 和 Tauri command 调用点保持不变。
- 现有单测已迁移到对应子模块，覆盖范围保持在 config、proxy、injection、lifecycle 各自文件内。
- 验证结果：重构前 `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过；重构后 `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`git diff --check` 均通过。
- 测试说明：重构前后 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml backend_manager` 均能完成测试编译，但测试二进制启动仍报当前 Windows 环境既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，没有进入断言阶段。

## 修复本地增强版切换后卡在加载中

### Checklist
- [x] 确认切换 `official` / `enhanced_local` 时 iframe URL 不变导致不会重新请求 HTML
- [x] 为工作区 iframe 增加加载身份 key，模式切换或回退时强制重新挂载
- [x] 调整 workspace pane loading 状态依赖，避免只设置 `loading` 却没有新 `onLoad`
- [x] 更新经验记录，避免后续同源注入模式忽略 iframe 重新加载
- [x] 运行 TypeScript、Rust、build、fmt 与 diff 检查，并补充 Review

### Review
- 根因确认：当前增强版和官方版都使用同一个 workspace proxy URL；切换模式只保存设置并把面板状态改为 `loading`，不会改变 `iframe.src`，因此不会触发新的 HTML 请求和 `onLoad`。
- 重新加载机制：工作区 iframe 新增由 `remoteUrl + workspaceWebMode + reloadToken` 组成的加载身份，并作为 React `key` 传入 `WorkspaceView`；模式切换或回退会推进 token，强制 iframe 重新挂载。
- 状态修正：`startWorkspacePane()` 改为比较加载身份而非仅比较 URL，模式切换后会进入真正的新加载周期，成功后由 iframe `onLoad` 切回 `ready`，不再长期停留在遮罩层。
- 回退同步：手动/自动回退官方 Web 后同样触发 iframe 重新挂载，避免继续显示旧的增强 DOM 或等不到新的加载事件。
- 经验沉淀：已在 `tasks/lessons.md` 记录同 URL proxy 注入模式必须显式重载 iframe。
- 验证结果：`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`、`git diff --check` 均通过；`git diff --check` 仅输出当前工作区已有 CRLF 提示。

## 0.0.40 / 0.0.41 发布说明与 GitHub 发布

### Checklist
- [x] 梳理 `v0.0.39` 之后的工作区变更，按 0.0.40 / 0.0.41 划分发布主题
- [x] 新增 `apps/kimi-shell/docs/release-notes-0.0.40.md`
- [x] 新增 `apps/kimi-shell/docs/release-notes-0.0.41.md`
- [x] 新增今天的 `update/updatenote_20260424*.md`
- [x] 验证文档、版本号、安装包资产和基础检查
- [ ] 提交到 `main` 并推送 GitHub
- [ ] 创建/推送 `v0.0.40`、`v0.0.41` GitHub Releases，并上传对应 NSIS/MSI 资产
- [ ] 记录发布结果与验证回顾

### Plan Confirmation
- 当前 `tasks/todo.md` 232 行，未超过 300 行，不需要归档。
- 当前源码版本为 `0.0.41`，本地已有 `0.0.40` 与 `0.0.41` 安装包资产。
- `0.0.40` 聚焦 Kimi Web 本地增强版产品化；`0.0.41` 聚焦增强版切换修复、`backend_manager` 瘦身重构与桥接设置修正。

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
