# Bundled Bridge Ops Follow Workdir Todo

## Control Center Detail Fixes (2026-03-22)

### Plan

- [x] 修复标题栏“技能”和快速设置里“浏览”按钮文案折行，统一按钮内文字不换行。
- [x] 修复控制中心标题栏 tab 在 hover / active 状态下顶部被裁切的问题。
- [x] 将技能中心用户向 “Session” 文案统一改为“工作区”，并在卡片头标题旁增加灰色 `Skill Center` 小字。
- [x] 修复技能中心左侧技能卡片在技能数量较少时被自动拉伸变高的问题。
- [x] 修复切换到 IM Bridge tab 时 `failed to decode bridge sessions payload` 的瞬时全局报错，补上根因兼容。
- [x] 运行前端构建与相关 Rust 测试，并补充本次细节修复回顾。

### Validation

- [x] 运行 `pnpm -C apps/kimi-shell build`，确认前端样式、文案和 bridge 刷新链路改动未引入构建错误。
- [x] 运行相关 Rust 测试，确认 bridge sessions payload 在缺省 `autoApprove` 字段时仍可解码。
- [ ] 手工检查按钮单行、tab 顶部不裁切、技能卡片高度稳定、IM Bridge 切换不闪技术报错。

### Retrospective

- [x] 记录这轮细节修复里暴露出的共享按钮/标题组件约束和 bridge 被动刷新边界。
- [x] 共享按钮基线必须默认禁止文案换行；像“技能”“浏览”这类短按钮一旦允许自动折行，在窄窗口下会直接破坏桌面工具的稳定感。
- [x] 控制中心 tab 不适合复用通用按钮的上移动效；标题栏区域空间紧，active / hover 更适合只用边框、底色和轻量 inset 阴影表达层级。
- [x] Bridge 页签切换这类被动刷新，不应把辅助数据解码失败直接抛成全局 shell alert；要么做静默兜底，要么先修后端/客户端解码兼容，否则用户会把瞬时技术错误误读成主流程故障。

## Second Batch UI Consolidation (2026-03-22)

### Plan

- [x] 基于 `DESIGN.md` 收口安装升级流的状态摘要、中文标签、镜像策略区和日志区主次层级。
- [x] 改造配置中心弹窗的导航命名、摘要区、章节标题和按钮层级，统一中文优先与卡片语法。
- [x] 改造 Bridge Runtime Panel 的信息顺序、状态摘要、中文标签和危险操作隔离。
- [x] 统一更新第二批区域在 `App.css` 中的卡片、表单、日志和危险区样式。
- [x] 运行前端构建验证并补充本次第二批 UI 收口回顾。

### Validation

- [x] 运行 `pnpm -C apps/kimi-shell build`，确认第二批文案和样式重构未引入构建错误。
- [ ] 手工检查安装升级流、配置中心弹窗、Bridge Runtime Panel 的中文文案、状态优先级和按钮层级是否与第一批一致。

### Retrospective

- [x] 记录第二批改造里暴露出的显示层 label map 需求和 live UI QA 边界。
- [x] 安装升级流、配置中心和 Bridge Runtime 都仍然带有底层 schema / wire field 名称，第二批先把它们压到次级标签层；后续应抽一层前端 label map，避免每个表单手写中英混合标签。
- [x] `InstallFlowModal` 和 `BridgeRuntimePanel` 这类状态面板在重排时很容易引入“声明顺序”和“死 helper”一类编译问题，先跑构建能比肉眼更快发现这类回归。
- [x] 第二批仍未完成 live UI QA；1280px / 1024px / 768px 下的真实密度、按钮换行和滚动观感，需要和第一批一起做一轮运行中人工验收。

## Core UI Refresh (2026-03-22)

### Plan

- [x] 基于 `DESIGN.md` 收紧 `kimi-shell` 首批共享设计基线：字体、色彩、按钮、输入框、圆角与状态标签规则。
- [x] 改造标题栏与工作区壳层文案和视觉层级，统一中文优先，明确工作区状态与工具分区。
- [x] 改造 Prefill 启动界面，使成功态 / 失败态共享统一状态面板结构，弱化装饰性提示卡。
- [x] 改造控制中心的概览、运行诊断与 IM Bridge 主面板，重做状态 deck、主 CTA 和危险操作分层。
- [x] 改造 Skill Center 的列表与详情区，使“信任 -> 应用 -> 维护/移除”的顺序明确可扫读。
- [x] 运行构建验证并补充本次 UI 改造回顾。

### Validation

- [x] 运行 `pnpm -C apps/kimi-shell build`，确认前端样式与文案改造未引入构建错误。
- [ ] 手工检查标题栏、Prefill、控制中心概览/运行诊断、IM Bridge、Skill Center 的中文文案和主次层级是否一致。

### Retrospective

- [x] 记录这次“核心五块”改造里暴露出的共享组件设计债和第二批改造边界。
- [x] 控制中心原先的 editorial 文案和随机提示卡会削弱“当前状态 / 下一步动作”的可扫读性，高频运维面板更适合稳定的摘要卡和待处理列表。
- [x] Skill Center 的动作如果全部同权展示，用户很难形成“先应用到当前 Session，再决定是否全局化”的心智；必须用按钮 variant 和分组强制排序。
- [x] 第二批优先补安装升级流、配置中心弹窗和 Bridge Runtime Panel 的中文化与状态层级，因为这些区域仍保留较多技术字段原貌。

## Design Consultation Audit (2026-03-22)

### Plan

- [x] 梳理 `kimi-shell` 的产品定位、核心功能流和当前信息架构，明确本次功能与 UI/UX 审计范围。
- [x] 审阅主工作区、Quick Setup、Control Center、Install & Upgrade、IM Bridge、Skill Center 等核心界面实现，记录功能层与交互层问题。
- [x] 基于 `$design-consultation` 输出一套完整、连贯的设计系统建议，并明确 safe choices / risks。
- [x] 产出仓库级 `DESIGN.md`，补充 `CLAUDE.md` 的设计约束说明。
- [x] 运行必要验证并在本文件补充审计回顾。

### Validation

- [x] 确认新增 `DESIGN.md` / `CLAUDE.md` 内容与当前产品定位一致，无明显自相矛盾项。
- [x] 运行至少一次前端构建，确保本次文档性改动没有引入工程层异常。

### Retrospective

- [x] 记录这次 UI/UX 审计里暴露出的系统性设计问题和后续实现约束。
- [x] 当前最大设计债不是“组件不够漂亮”，而是 shell / prefill / control center / skill center 的视觉语言没有被同一套规则约束，导致产品像多个子系统拼接。
- [x] 中文主界面里的英文术语必须收口到“品牌名 + 技术名词”范围；如果标题、按钮、状态标签都自由混写，用户会把信息层级误读成多个并列系统。
- [x] 对高密度桌面工具来说，主 CTA、次 CTA、危险操作必须做强制分层；仅靠一排同权按钮会持续放大学习成本和误触风险。

## IM Bridge Panel / Binding / Logging

### Implementation

- [x] 将 Skill Center 卡片改为 `header + body` 的真实剩余高度布局，去掉 `72dvh` 固定高度，避免左右两栏底部继续被外层卡片裁切。
- [x] 将 Skill 内容页中的基础信息卡片区和 Skill 内容预览改为默认折叠，详情页首次打开默认停留在应用/移除按钮附近。
- [x] 将 Skill Center 搜索框移回左侧 skill 导航栏顶部，移除控制中心标题栏里的重复搜索入口。
- [x] 精简 Skill Center 左侧 skill 卡片，只保留标题栏与状态标签，不再显示 projection name 和说明内容。
- [x] 重排 workspace 标题栏：移除左侧重复 Skill 入口，左侧保留 chat/code、分栏、左右换位、主题，右侧放 session 目录、Skill 和窗口三键。
- [x] 收缩标题栏拖拽热区：仅中间 drag zone 可拖动或双击，不再让整条 header 参与拖拽命中。
- [x] 调整 Skill Center：统一标签文案为“已信任 / 全局 / session”，列表 description 限制三行并补左栏稳定滚动。
- [x] 修正 Skill Center 目录语义：当前工作区优先使用 active session workdir，并在详情底部展示技能实际已应用目录。
- [x] 去掉 Skill Center 独立弹窗，统一复用控制中心 `skill_center` tab；标题栏 Skill 按钮改为直接切到控制中心的 Skill Center。
- [x] 将 Skill Center 的搜索、从 Git 安装、导入本地 Skill 和全局 / session 筛选移到标题栏右侧横向排列，移除左栏重复工具区。
- [x] 将“从 Git 安装”和“导入本地 Skill”改成应用内统一弹窗；导入本地 Skill 先弹窗选择目录或 ZIP，再打开系统选择器。
- [x] 修正 Skill Center 左栏和详情页滚动到底部仍被遮挡的问题，增加底部滚动留白并去掉卡片 body 的额外裁切。
- [x] 新增“重置到 IM 默认目录并新建会话”命令，保持“新建并切换会话”只切 session 不改当前 binding workdir。
- [x] 调整 IM Bridge 主面板为单主 CTA，移除重复的保存/启动/重启入口，并把高级运行控制收敛到高级区。
- [x] 将 `app.log` 与 `bridge.log` 落盘时间统一为本地时区并显式时区；确保 UI 展示与之保持一致。
- [x] 补充后端/前端测试，覆盖 binding 恢复语义、主 CTA 状态机与日志时间格式。

### Validation

- [x] 运行 `pnpm build`（`apps/kimi-shell`），验证 Skill Center 高度链和详情页默认折叠改动可通过构建。
- [x] 运行 `pnpm build`（`apps/kimi-shell`），验证 Skill Center 搜索框回到左侧导航栏顶部后页面仍可通过构建。
- [x] 运行 `pnpm build`（`apps/kimi-shell`），验证标题栏布局、Skill Center props 和样式改动可通过构建。
- [x] 运行 `pnpm build`（`apps/kimi-shell`），验证移除 Skill Center 独立弹窗后标题栏入口与控制中心 tab 接线仍可通过构建。
- [x] 运行 `pnpm build`（`apps/kimi-shell`），验证 Skill Center 标题栏工具区、统一弹窗和滚动样式改动可通过构建。
- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 运行 `go test ./internal/logging ./internal/app ./internal/admin ./internal/binding`。
- [x] 运行 `pnpm build`（`apps/kimi-shell`）。

### Retrospective

- [x] 标题栏拖拽不应通过“整条 header 可拖 + 按钮区排除”来实现；更稳妥的方式是把拖拽事件只绑在中间专用 drag zone 上。
- [x] Skill Center 里的“当前工作区”不能直接复用 `effectiveWorkDir`，否则会把默认工作目录误显示成当前 active session 所在目录。
- [x] Skill Center 不该同时维护“标题栏弹窗”和“控制中心 tab”两套入口；同一功能应收敛到单一路由，否则状态刷新、Esc 关闭和导航语义都会分叉。
- [x] Skill Center 的安装入口不应继续依赖 `window.prompt` 或左栏额外选择框；统一成应用内弹窗后，输入、选择和视觉风格才和控制中心/主窗口弹窗保持一致。
- [x] 记录本次为什么要把“改默认目录”和“恢复已有 binding 到默认目录”拆成显式动作。

### Notes

- [x] 主面板现在只保留一条面向普通用户的主路径：未配置时“保存并启用 IM Bridge”，未运行时“启动 IM Bridge”，运行中有未应用更改时“应用设置并重启”；危险动作下沉到高级运行面板。
- [x] “重启 bridge”继续只负责进程级重连，不再暗含“把已有 binding 强制拉回默认目录”；恢复到默认目录改成显式按钮，避免把用户的自定义 workdir 当成脏状态偷偷覆盖。
- [x] shell `app.log` 与 bridge `bridge.log` 都改为本地时区落盘，原始日志 tail 直接可读；结构化时间在 Bridge Runtime 面板里也统一按本地时区展示并带时区。

## 401 Auth Investigation

### Plan

- [x] 确认当前机器上 `bridge_skill_auth.json` 的候选路径与实际被读取的路径。
- [x] 核对 auth 文件中的 `admin_base_url`、`admin_token`、`generated_at` 与 bridge 当前运行状态是否一致。
- [x] 验证 bridge admin 401 是“token 不匹配”还是“调用方读错 auth 文件/旧上下文”。
- [x] 输出结论，并给出下一步修复或操作建议。

## Hard Constraints

- [x] `bridge-ops` 作为安装包内置资源分发，bridge follow 模式不再依赖用户手工拷贝 skill。
- [x] `--skills-dir` 的 follow 模式固定解析到 `<effectiveBridgeDefaultWorkDir>\.agents\skills`，不再保留手填绝对路径入口。
- [x] `KIMI_BRIDGE_SKILLS_DIR` 仅作为 `skillsMode=disabled` 时的兼容兜底，不破坏现有环境变量用户。

## Skill Center v1

### Hard Constraints

- [x] Skill 安装必须先进入应用私有目录，不能直接落入任何 Agent 默认扫描目录。
- [x] v1 只支持 Kimi CLI，不扩展 Claude/Codex 投影。
- [x] “应用到用户全局”固定指向 `~/.config/agents/skills`，不再复用 IM 默认目录。
- [x] “仅应用到当前 Session”固定指向 `active_session_work_dir/.agents/skills`，并按 session 生命周期清理受管投影。
- [x] 手动导入支持本地目录和 ZIP；安装包内置 [skills](/D:/MyProject/kimi-app/skills) 目录下的合法 Skill 首次导入默认已信任。

### Implementation

- [x] 新增 Rust Skill Center 模块，完成私有仓库存储、registry/state 持久化、Git 安装、信任、全局/Session 投影与清理。
- [x] 扩展 Tauri 命令与 Rust/TypeScript 公共类型，覆盖 installed skills、detail、apply scope、projection state、workspace recent 等模型。
- [x] 在 `useShellController` 中接入 Skill Center 状态、刷新链路、安装/信任/应用/移除/恢复 handler，以及 active session 切换后的清理刷新。
- [x] 在标题栏加入 Skill 按钮与当前 Session skill 数量徽标，并在 workspace 场景打开 Skill Center modal。
- [x] 在控制中心新增 `Skill Center` section，并实现列表、详情、搜索/筛选、安装弹窗、全局/Session 操作和最近使用恢复。
- [x] 扩展 Skill Center 为多来源模型：`git` / `local_import` / `bundled`，并新增本地导入命令与 ZIP 解压链路。
- [x] 将整个 `skills` 目录打进安装包，并在 `skill_center::initialize()` 中同步 bundled skills 到私有仓库。
- [x] 让 bundled skill 刷新时重同步现有 `copy` 投影，避免私有副本更新后受管复制投影内容过期。
- [x] 调整 Skill Center 前端工具区与详情展示，支持“导入本地 Skill”与多来源元数据渲染。
- [ ] 补充 Rust 单测，覆盖 registry/state 读写、合法/非法 skill 安装、命名规范化、重复安装、投影冲突、清理与 recent 记录。

### Validation

- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 运行 `pnpm build`（`apps/kimi-shell`）。
- [x] 再次运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 再次运行 `pnpm build`（`apps/kimi-shell`）。
- [ ] 手工验证标题栏 modal、控制中心 section、全局目录 `~/.config/agents/skills` 与 session 目录 `.agents/skills` 的应用/移除路径。

### Retrospective

- [x] 记录为什么 Skill Center v1 采用“用户级全局 + 当前 Session”双作用域，而不把 IM 默认目录误称为全局。

### Notes

- [x] Kimi CLI 的用户级全局 skills 目录采用官方推荐的 `~/.config/agents/skills`；`IM 默认目录/.agents/skills` 仍然只表示某个工作目录下的项目级 skills，不能再对外宣称为“全局”。
- [x] Skill Center 通过“安装到应用私有目录，再投影到用户全局或当前 Session”把安装与生效解耦，既能做信任门槛，也能避免把任意 Git 仓库直接落进 Kimi 的默认扫描路径。
- [x] Session 作用域会直接写入 `active_session_work_dir/.agents/skills`，因此必须把清理逻辑挂到 session 切换与 runtime clear 上；否则普通用户会把临时 skill 误留在真实工作区里。

## Implementation

- [x] 修复 Skill Center 对 `SKILL.md` frontmatter 的 CRLF 兼容性，避免 bundled skill 在 Windows 打包环境下错误回退到 H1 标题作为名称。
- [x] 为 `parse_skill_manifest` 补充 `\r\n` 回归测试，并运行目标 Rust 测试验证名称解析恢复为 frontmatter `name`。
- [x] 用 `skillsMode: disabled | follow_default_work_dir` 替换现有 `skillsDir` 持久化字段，并同步 Rust / TypeScript 类型与默认值。
- [x] 将仓库里的 `skills/bridge-ops` 打进 shell 安装包资源，并实现运行时的 bundled skill 定位与递归复制 helper。
- [x] 调整 `save_bridge_settings` / `save_work_dir` / `start_bridge` 链路：follow 模式下统一安装 bundled `bridge-ops` 并解析 `--skills-dir <workdir>\.agents\skills`。
- [x] 在控制中心 IM Bridge 设置区移除手填 skills 目录输入，改为 follow 模式开关、只读预览路径和打开 `.agents\skills` 操作。
- [x] 补充 Rust 单测，覆盖 `skillsMode` 默认值、legacy `skillsDir` 忽略、bundled skill 安装、follow 模式启动参数与 workdir 联动。

## Validation

- [x] 运行 bridge settings / bridge manager 相关 Rust 测试。
- [x] 运行前端构建或类型检查，确认 Bridge 设置区 follow 模式新字段接线正确。
- [ ] 手工验证启用 follow 模式后，`<workdir>\.agents\skills\bridge-ops` 会被创建且运行中的 `kimi-im-bridge.exe` 命令行带上 `--skills-dir <workdir>\.agents\skills`。

## Retrospective

- [x] 记录为什么“内置资源 + follow 默认工作目录”比“手填 skills 目录路径”更适合桌面端默认体验。

### Notes

- [x] follow 模式要把 skill 安装动作和 `--skills-dir` 解析收敛到 Rust 后端，避免前端只展示路径但实际 bridge 启动没有复制资源或路径来源分叉。
- [x] 现在安装包内置的 `bridge-ops` 会在 `save_bridge_settings`、`save_work_dir` 和 `start_bridge` 三条链路里按同一规则落到 `<effectiveBridgeDefaultWorkDir>\.agents\skills\bridge-ops`；相比手填路径，这样更像桌面端“开箱即用”的默认体验，也能把“默认工作目录”和 “bridge skills 目录”保持在同一套来源上。

## Investigation Notes

- [x] 当前机器存在 `C:\Users\Qian\AppData\Roaming\com.kimi.shell\bridge_skill_auth.json`，但文件内容是旧格式：`admin_base_url=http://localhost:60110`、`admin_token=local-bridge-admin`、无 `generated_at`。
- [x] 正在运行的 `kimi-im-bridge.exe` 实际命令行参数使用 40 位随机 `--admin-token`，并监听 `127.0.0.1:60110`；用进程真实 token 调 `/api/v1/status` 返回 200。
- [x] 用旧 auth 文件里的 token 调 `/api/v1/status` 返回 401 `{\"error\":\"unauthorized\"}`，根因不是“重启后没刷新同一 token”，而是“当前 bridge 根本没启用 skills auth 文件写入，却遗留了一份旧 auth 文件被脚本兜底读到了”。
- [x] 当前 `bridge_settings.json` 为 `skillsMode=disabled`，bridge 启动命令行没有 `--skills-dir`；按现实现状，这种模式不会重写 `bridge_skill_auth.json`，所以旧文件会持续误导依赖默认发现路径的调用方。

## Implementation

- [x] 修复 Skill Center 首次启动布局初始化递归：`ensure_layout()` 改为直接写空的 registry/global/workspace 状态文件，不再通过 `save_*` 包装器自调用。
- [x] 重新构建 `0.0.30` 安装包，确认 release 可执行文件不再启动即崩溃。

## Validation

- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 运行 `cargo build --release --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 运行 `pnpm tauri build`（`apps/kimi-shell`），产出新的 MSI / NSIS 安装包。
- [x] 直接启动 `apps/kimi-shell/src-tauri/target/release/appskimi-shell.exe`，确认进程可持续存活，不再立即退出。

## Retrospective

- [x] 首次启动初始化函数不能通过会再次调用 `ensure_layout()` 的 `save_*` 包装器创建默认文件，否则打包环境下会递归栈溢出并表现为“应用无法启动”。

## Implementation

- [x] 修复控制中心 `Skill Center` tab 路由，点击后刷新 Skill Center 状态并切换到 `skill_center` section，不再误跳到运行诊断。
- [x] 重排 workspace 标题栏右侧工具区：将主题切换和 `Skill` 按钮一起移到右侧独立非拖拽区域，避免按钮点击被窗口拖动热区吞掉。

## Validation

- [x] 运行 `pnpm build`（`apps/kimi-shell`）。

## Retrospective

- [x] 控制中心 tab 的 section 分发不能依赖“默认兜底到 runtime”，新增 section 时必须显式补分支，否则 UI 会表现为“tab 存在但点不开”。
- [x] Markdown/frontmatter 解析不能假设仓库文件永远是 `\n`；桌面端打包后会遇到 `\r\n`，如果不先归一化换行符，就会错误回退到 H1 或正文解析路径。

---

## Preserved Tail From Previous Todo

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

---

## Implementation

- [x] 固定配置中心主结构为“左侧导航 + 右侧内容”，移除窄宽度下的顶部横向导航切换。
- [x] 固定技能中心主结构为“左侧技能列表 + 右侧详情”，移除窄宽度下的上下堆叠切换。
- [x] 为 1024px / 768px 及更窄宽度补充左右栏宽度与内边距收紧规则，保证双栏仍可操作。

## Validation

- [x] 运行 `pnpm -C apps/kimi-shell build`。
- [x] 核对 CSS 断点，确认配置中心与技能中心在 `1280px / 1024px / 768px / <=640px` 下都不会退化成单列主结构。

## Retrospective

- [x] 记录为什么配置中心和技能中心在桌面工具语境里应优先保持“双栏信息架构稳定”而不是在平板宽度下切成单列。

### Notes

- [x] 配置中心和技能中心都属于“左选右看”的桌面工作流：即使宽度收窄，也应优先收紧左栏宽度与内边距，保住信息架构稳定；主容器退回单列会让定位、比较和批量操作都变慢。

---

## Implementation

- [x] 将 `apps/kimi-im-bridge` 的配置、领域模型、store 和 admin payload 从单平台单实例升级为多 connector，并补齐 legacy 配置迁移。
- [ ] 将 `apps/kimi-shell/src-tauri` 的 bridge 类型、设置存储、命令和状态拼装升级为 connector 模型，并新增 connector CRUD / secret mask 命令。
- [ ] 将 `apps/kimi-shell` 前端控制器和控制中心 Bridge UI 改成完整 connector 管理：列表、详情、凭证、运行态、bindings / approvals 展示 connector 归属。
- [ ] 为多 connector 补充 Go / Rust / 前端构建级验证与关键回归测试。

## Validation

- [x] 运行 `go test ./...`（`apps/kimi-im-bridge`，至少覆盖 config/store/app/admin/adapters 相关多 connector 场景）。
- [ ] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`。
- [x] 运行 `pnpm -C apps/kimi-shell build`。

## Retrospective

- [x] 记录为什么 bridge 的运行时主身份必须从 `platform` 提升为稳定 `connectorId`，以及哪些 legacy 字段继续保留作兼容。

### Notes

- [x] sidecar 里 `platform` 只适合表达“平台语义”，一旦进入 checkpoint、binding、approval、delivery、turn 这些需要长期追踪和持久化的链路，主键必须升级成稳定 `connectorId`，否则同平台多机器人会串线。
- [x] 为了不打断现有 shell/Tauri 侧的单实例路径，这一轮在 Go 侧保留了少量兼容入口：legacy `channels` / 顶层 secrets 仍可读，store 也允许“单 connector 场景下用 platform 名命中默认 connector”。
