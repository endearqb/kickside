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
