# Continued From Previous Todo

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

---

# IM Bridge 双栏工作台改造（2026-03-26）

## Plan

- [x] 将 IM Bridge 主区改造成左侧机器人列表、右侧详情/任务面的双栏结构。
- [x] 在标题栏增加全局一键停止、一键重启，并把“新建机器人”改成微信/飞书下拉菜单。
- [x] 让 `bridge_connector_secrets` 和 `bridge_runtime` 只占据右栏，不再替换整个控制中心内容。
- [x] 调整 `App.css` 中 Bridge 布局与响应式样式，保持和设计系统一致。
- [x] 运行 `pnpm -C apps/kimi-shell build` 做构建验证。

## Validation

- [ ] 标题栏包含一键停止、一键重启和单一新建机器人入口。
- [ ] 左栏切换机器人时右栏详情正确更新。
- [ ] 连接与凭据、高级运行面板在右栏打开并可返回。
- [ ] 多机器人和窄宽度下布局不裁切。
- [x] `pnpm -C apps/kimi-shell build` 通过。

## Retrospective

- [x] Bridge 这次最稳的改法不是重做任务状态，而是保留 `selectedBridgeConnectorId + activeTaskPayload.connectorId` 两层选择语义，让右栏在详情态和任务态之间切换。
- [x] “新建机器人”下拉只隐藏创建入口，不移除 Telegram 既有展示和数据兼容；这样不会把历史 connector 变成无法访问的孤儿状态。

---

# Tauri 构建阻塞修复（2026-03-26）

## Plan

- [x] 补齐 `src-tauri/src/skill_center.rs` 中缺失的 workspace pin / recommendation / update / uninstall 能力。
- [x] 修复 `feishu_onboarding.rs` 与 `skill_center.rs` 中因 DTO 升级导致的结构体初始化缺字段问题。
- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 与 `pnpm -C apps/kimi-shell tauri build` 验证。

## Validation

- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
- [x] `pnpm -C apps/kimi-shell tauri build` 通过。

## Retrospective

- [x] 这次失败点不是 IM Bridge 前端改造，而是 `src-tauri` 里 skill center 命令声明和实现脱节；先按编译错误把缺失符号补齐，能最快恢复发布链路。
- [x] DTO 升级后最容易漏的是“默认字段”和“初始化器同步”，尤其是 `InstalledSkill`、`BridgeConnectorSecretsInput` 这类在多个模块里手写构造的结构体。

---

# 0.0.31 Release Notes（2026-03-26）

## Plan

- [x] 参考现有版本说明格式与当前 `0.0.31` 已落地能力整理发布口径。
- [x] 新建 `apps/kimi-shell/docs/release-notes-0.0.31.md` 并写入版本说明。
- [x] 记录验证命令，确保 release notes 与实际产物一致。

## Validation

- [x] `apps/kimi-shell/docs/release-notes-0.0.31.md` 已保存。
- [x] 文档版本号、发布日期、安装包名称与当前构建结果一致。

## Retrospective

- [x] 这次版本说明不能只写当前会话里的 UI 改动，还需要把多机器人、微信接入和 Skill Center 完整度提升合并成一个真实的 0.0.31 叙事。

---

# Skill Center 外部发现与导入重构（2026-03-26）

## Plan

- [x] 为 Skill Center 增加应用级工作区索引与发现缓存，纳入主目录和已知 workspace 的 `.agents/skills`、`.codex/skills`、`.claude/skills`。
- [x] 扩展 Rust 类型、存储层与命令接口，支持扫描发现、发现详情和从发现结果导入私有 Skill Center。
- [x] 保持现有受管应用/移除链路不变，补充已安装 Skill 的外部来源展示与 discovered_import 刷新逻辑。
- [x] 将“工作区洞察”改造成发现视图，支持重扫、过滤、查看来源和一键导入。
- [x] 运行 Rust 测试与前端构建验证，修复回归并回填结论。

## Validation

- [x] `scan_discoverable_skills` 能返回主目录和工作区目录中的合法 Skill，并按物理来源折叠。
- [x] `import_discovered_skill` 对同一 canonical 来源幂等，且导入后可在技能管理页看到来源位置。
- [x] Skill Center 的“技能管理”现有应用/移除、信任、更新、卸载链路无回归。
- [x] “工作区洞察”页面可展示发现列表、详情与导入按钮，空态和过滤状态正常。
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 与 `pnpm -C apps/kimi-shell build` 通过。

## Retrospective

- [x] 这次重构最稳的落点是把“发现”与“受管应用”分成两条链路：外部目录只做扫描与导入，现有 apply/remove 投影完全不动，显著降低了回归面。
- [x] 发现结果以 canonical skill root 聚合后，前端就能同时展示“同一 Skill 的多个暴露位置”和“是否已导入”，比按目录平铺更贴近用户心智。
- [x] 工作区索引的关键不是做一次扫描，而是在 `effective_work_dir`、active session、workspace session API 和 open/bootstrap 路径上持续 upsert，这样发现中心才会越用越完整。

---

# Skill Center 与概览页文案/统计精简（2026-03-26）

## Plan

- [x] 调整 Skill Center 标题栏为上下双层标题，`Skill Center` 默认显示在中文标题下方。
- [x] 移除技能管理页标题栏筛选按钮，并将说明文案改为仅在标题栏 hover 时显示。
- [x] 将工作区洞察的外部发现总览收敛到标题栏中部极简统计，移除内容区总览卡。
- [x] 将概览页“飞书最终状态/快速设置进度”改为“IM机器人/技能总览”，并统一统计口径。
- [x] 运行前端构建验证并回填结果。

## Validation

- [x] 技能中心标题下方显示 `Skill Center`，说明文案默认隐藏且 hover 标题栏时出现。
- [x] 技能管理页标题栏不显示 `全局 / 当前工作区 / Pin / 未信任 / 可更新`。
- [x] 工作区洞察标题栏中部显示 `已安装技能 / 已导入发现 / 外部发现总数`，内容区不再显示外部发现总览卡。
- [x] 概览页显示 `IM机器人` 和 `技能总览` 两张新统计卡，且统计值口径正确。
- [x] `pnpm -C apps/kimi-shell build` 通过。

## Retrospective

- [x] 这轮最稳的方式不是继续堆 Skill Center panel 内的大卡，而是把“总览”收敛回标题栏，让内容区只负责列表和详情，视觉层级明显更清楚。
- [x] `ControlCenterCardHeader` 只加可选能力而不改默认布局，能让 Skill Center 拿到“副标题下置 + hover 文案”，同时不影响其他控制中心卡片。
- [x] 概览页的统计口径和工作区洞察标题栏复用同一组前端聚合值后，用户在不同页面看到的技能数字不再打架。

---

# Skill Center 说明移除与技能总览卡压缩（2026-03-26）

## Plan

- [x] 移除 Skill Center 标题栏中的安装说明文案，以及对应的 hover 显示实现。
- [x] 将概览页“技能总览”改为 2 行四宫格样式，缩小中文标签字重与字号。
- [x] 运行前端构建验证并回填结果。

## Validation

- [x] Skill Center 标题栏仅保留双层标题，不再显示安装说明，也没有 hover 才出现文案的交互。
- [x] 概览页“技能总览”以 2 行四宫格显示 3 个指标，中文标签字号已压缩。
- [x] `pnpm -C apps/kimi-shell build` 通过。

## Retrospective

- [x] 这类标题栏说明如果不是真正的长期信息，直接移除比做 hover reveal 更干净，也更符合控制中心的低噪声方向。
- [x] 概览卡里密度更高的技能指标不适合继续塞成一句话，拆成小栅格后中文阅读效率和对齐感都明显更好。

---

# 概览页发现技能口径调整（2026-03-26）

## Plan

- [x] 将概览页原“技能总览”卡调整为“发现技能”数量展示。
- [x] 清理不再使用的四宫格结构和样式，保持实现简洁。
- [x] 运行前端构建验证并回填结果。

## Validation

- [x] 概览页技能卡已改为 `发现技能`，只展示外部发现技能数量。
- [x] 旧的四宫格结构与样式已移除，没有遗留无用选择器。
- [x] `pnpm -C apps/kimi-shell build` 通过。

## Retrospective

- [x] 这类概览卡如果用户只关心一个主指标，就不要为了“信息完整”硬塞聚合摘要；单值卡更符合概览层的扫读节奏。
- [x] 当统计口径已经在其他页面完整展开时，概览页应该回到最短路径，只做入口级信号而不是重复解释。

---

# 工作区洞察筛选下拉收口（2026-03-26）

## Plan

- [x] 将工作区洞察搜索栏中的 6 个筛选按钮改为搜索框后的 `范围`、`状态` 两个下拉。
- [x] 保留原有筛选能力与状态映射，只调整信息架构和布局样式。
- [x] 运行前端构建验证并回填结果。

## Validation

- [x] 工作区洞察搜索栏现在是 `搜索框 + 范围下拉 + 状态下拉`，不再显示 6 个筛选按钮。
- [x] 原有 `全部范围 / 工作区 / 主目录` 与 `全部状态 / 待导入 / 已导入` 筛选能力保持不变。
- [x] `pnpm -C apps/kimi-shell build` 通过。

## Retrospective

- [x] 对枚举型筛选条件，按钮组一旦超过 4 个就会明显抬高工具栏噪声；收成带标签的下拉更适合控制中心这类高密度面板。
- [x] 搜索栏旁边的辅助筛选应该围绕“先搜索，再收口范围”组织，避免用户在列表前先看到一排等权重按钮。

---

# Skill Center 合并发现视图与工作区 Skill 管理重构（2026-03-26）

## Plan

- [x] 为 Skill Center 增加 workspace target / inventory 读写接口，支持按工作区与容器管理目录中的 Skill。
- [x] 重构技能管理页，将外部发现合并进左侧技能目录列表，并通过搜索框后的工作区下拉切换上下文。
- [x] 重做工作区洞察页为工作区 Skill 管理：左侧工作区目标，右侧容器化的已有 Skill / 可导入 Skill 管理。
- [x] 运行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 与 `pnpm -C apps/kimi-shell build`，回填验证与回顾。

## Validation

- [x] 后端已新增 workspace target / inventory / add / remove 接口，前端可按目标工作区和 `.agents / .codex / .claude` 容器管理目录中的 Skill。
- [x] 技能管理页已通过搜索框后的“工作区”下拉合并显示技能中心安装项与对应范围内的外部发现，并对已导入发现做去重合并。
- [x] 工作区洞察页已重做为“工作区 Skill 管理”：左侧工作区目标，右侧容器切换、已有 Skill 列表、从技能中心导入列表，以及工作区目录删除。
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（122 passed）。
- [x] `pnpm -C apps/kimi-shell build` 通过。

## Retrospective

- [x] 当“洞察页”开始承担真实目录管理职责时，必须把“发现目录”和“目标目录管理”拆成两条清晰路径；继续把两者塞进同一个旧面板只会让筛选和动作语义互相打架。
- [x] 工作区级 Skill 管理最稳的抽象不是复用 session/global projection，而是显式暴露 `workspace target + container inventory` 接口，让前端围绕真实目录状态组织交互。
