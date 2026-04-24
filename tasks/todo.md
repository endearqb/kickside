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
- [ ] 提交当前工作区改动并推送 `main`
- [ ] 创建并推送 `v0.0.42` tag
- [ ] 创建 GitHub release 并上传 `0.0.42` 的 NSIS / MSI 安装包

### Review
- 发版边界：当前版本号已统一到 `0.0.42`，本次发版内容包含两类改动：一是 `kimi-cli/web` 上游源码基线与维护边界落库，二是本地增强版 same-origin 注入的第二阶段中文固定文案扩展；运行时仍保持官方 workspace proxy + 注入模式。
- 发布文档：已新增 `apps/kimi-shell/docs/release-notes-0.0.42.md`，内容覆盖上游 `web/` 基线、第二阶段全注入扩展、保持运行时边界不变，以及 `0.0.42` 的验证和已知限制；已新增 `update/updatenote_202604250034.md`，概括同一批改动及用户影响。
- 安装包产物：已确认本地存在 `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.42_x64-setup.exe` 与 `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.42_x64_en-US.msi`，可用于 GitHub release 上传。
- 自动化验证：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过。
- diff 检查：`git diff --check` 已于 2026-04-25 执行，未发现内容级错误，仅剩当前工作区 CRLF 提示。
- 仍待完成：提交并推送 `main`、创建 `v0.0.42` tag、创建 GitHub release 并上传两个安装包。
