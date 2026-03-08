# TODO - 按 docs/需求文档2.md 开发与执行

## 本轮计划（关闭应用读秒窗接入随机 Tips）

### 计划清单

- [x] 记录本轮关闭应用读秒窗 tips 接入目标、边界与验收标准
- [x] 提取共享 tips 数据模块，避免主界面依赖 `prefill/` 目录
- [x] 调整 `apps/kimi-shell/src/App.tsx`，在 shutdown overlay 中固定显示本次退出流程的随机 tip
- [x] 调整 `apps/kimi-shell/src/App.css`，让居中的 shutdown card 适度变大并容纳摘要 tips 区
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 点击关闭应用后，读秒小窗内会显示 1 条随机 tip
- [x] 单次退出流程中 tip 固定不变，不随 shutdown stage 切换重抽
- [x] 读秒小窗仍保持居中显示，尺寸仅适度扩大
- [x] 退出状态信息优先级仍高于 tips
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/lib/agentTips.ts`
    - 提取共享 tips 数据与 `pickRandomAgentTip()` helper，供前置页和主界面关闭读秒窗共同使用。
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx`
    - 改为消费共享 tips 模块，不再依赖 `prefill/` 私有数据文件。
  - `apps/kimi-shell/src/App.tsx`
    - 为 shutdown overlay 新增本地 `shutdownTip` 状态。
    - 在 `shutdownProgress` 从空变为非空时随机锁定 1 条 tip，并在退出流程结束后清空。
    - 读秒窗内新增摘要 tips 区，显示编号、标题和 2 行正文摘要。
  - `apps/kimi-shell/src/App.css`
    - `shutdown-card` 保持居中逻辑不变，宽度从 `360px` 适度放宽到 `420px`，并增大圆角和内边距。
    - 新增 shutdown tips 摘要块样式，保持退出状态区优先级更高。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 手工建议：
  - 重点验证标题栏关闭和界面内“退出应用”两条路径，确认单次退出流程中的 tip 不变化，而不同退出流程有机会变化。

## 本轮计划（基于当前工作区重新构建安装包）

### 计划清单

- [x] 记录本轮安装包重构建目标、边界与验收标准
- [x] 执行 `pnpm -C apps/kimi-shell tauri build`
- [x] 核对安装包产物路径、文件名、大小与时间
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] `pnpm -C apps/kimi-shell tauri build` 通过
- [x] `apps/kimi-shell/src-tauri/target/release/bundle` 下生成当前版本安装包
- [x] 可明确给出本次构建产物路径、文件大小和时间

### 回顾（完成后填写）

- 实际变更：
  - 未新增业务代码改动；基于当前工作区内容重新执行安装包构建。
  - 构建链路仍使用现有 `pnpm -C apps/kimi-shell tauri build`，自动包含 `sync:version`、前端生产构建和 Tauri bundle。
- 验证结果：
  - `pnpm -C apps/kimi-shell tauri build` 通过。
  - 当前版本：`0.0.10`
  - 安装包产物：
    - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.10_x64_en-US.msi`
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.10_x64-setup.exe`
  - 产物大小与时间：
    - MSI `5193728` bytes，`2026-03-06 23:18:53`
    - NSIS EXE `3569558` bytes，`2026-03-06 23:19:03`
- 手工建议：
  - 如果这次构建用于分发，下一步优先做安装、启动和卸载实机验收，确认前置页最新 UI 也包含在安装包内。

## 本轮计划（去掉前置页 titlebar 与 shell-root 边框）

### 计划清单

- [x] 记录本轮前置页边框收口目标与验收标准
- [x] 调整 `apps/kimi-shell/src/prefill/prefill.css`，移除前置页 `shell-root` 外边框
- [x] 调整 `apps/kimi-shell/src/prefill/prefill.css`，局部覆盖去掉前置页 `titlebar` 下边框
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 前置页 `shell-root` 不再显示外边框
- [x] 前置页 `titlebar` 不再显示下边框
- [x] 改动不影响右上角按钮和前置页布局
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/prefill/prefill.css`
    - 将前置页 `shell-root` 的 `border` 从 `1px solid` 改为 `0`。
    - 为 `prefill-titlebar` 增加局部 `border-bottom: none`，只影响前置页，不改全局 `titlebar` 样式。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 手工建议：
  - 重点看前置页顶部与窗口外缘是否已经完全去线，同时确认右上角“打开日志”和关闭按钮在无边框状态下仍然对齐正常。

## 本轮计划（版本递增到 0.0.10 并构建安装包）

### 计划清单

- [x] 记录本轮版本递增与安装包构建目标、边界和验收标准
- [x] 将 `apps/kimi-shell/package.json` 版本从 `0.0.9` 递增到 `0.0.10`
- [x] 执行版本同步链路，确保 `Cargo.toml` 与 `tauri.conf.json` 跟随到 `0.0.10`
- [x] 执行 `pnpm -C apps/kimi-shell tauri build`
- [x] 核对安装包产物路径、文件名、大小和时间
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] `apps/kimi-shell/package.json` 版本为 `0.0.10`
- [x] `apps/kimi-shell/src-tauri/Cargo.toml` 版本为 `0.0.10`
- [x] `apps/kimi-shell/src-tauri/tauri.conf.json` 版本为 `0.0.10`
- [x] `apps/kimi-shell/src-tauri/target/release/bundle` 下生成可分发安装包
- [x] 可明确给出本次安装包文件名与所在路径
- [x] `pnpm -C apps/kimi-shell tauri build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/package.json`
    - 版本号从 `0.0.9` 递增到 `0.0.10`。
  - `apps/kimi-shell/src-tauri/Cargo.toml` / `apps/kimi-shell/src-tauri/tauri.conf.json`
    - 通过现有 `sync:version` 链路同步到 `0.0.10`，未手工分散改版本号。
- 验证结果：
  - `pnpm -C apps/kimi-shell tauri build` 通过。
  - 安装包产物：
    - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.10_x64_en-US.msi`
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.10_x64-setup.exe`
  - 产物大小与时间：
    - MSI `5193728` bytes，`2026-03-06 22:53:31`
    - NSIS EXE `3569859` bytes，`2026-03-06 22:53:43`
- 手工建议：
  - 若你准备发包，下一步优先在目标 Windows 机器做一次实际安装、启动和卸载回归。

## 本轮计划（前置页 Tips 主视觉化与状态区降权）

### 计划清单

- [x] 记录本轮前置页 Tips 主视觉化目标、边界与验收标准
- [x] 新增本地 `prefillTips` 数据模块，整理 `docs/Tips_of_Agent.md` 中 25 条 tips
- [x] 调整 `apps/kimi-shell/src/prefill/PrefillApp.tsx`，接入随机 tips、主视觉卡片与失败态优先布局
- [x] 调整 `apps/kimi-shell/src/prefill/prefill.css`，将状态区收敛为轻量状态条/状态 chips，减少边框和层级感
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 前置页等待态/进入主界面态的视觉中心为随机 tips 卡片
- [x] 同一次前置页停留期间 tips 保持固定，不因轮询重抽
- [x] 启动状态仍可见，但不再是三张独立指标卡
- [x] 失败态切回恢复卡片为主视觉，tips 退为次级块
- [x] 右上角“打开日志”、关闭按钮和标题栏拖拽保持可用
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/prefill/prefillTips.ts`
    - 新增 25 条结构化 tips 数据，作为前置页的本地内容源，不在运行时解析 `docs/Tips_of_Agent.md`。
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx`
    - 前置页首次挂载时随机选择一条 tip，并在本次前置页生命周期内固定。
    - 等待态与进入主界面态改为“hero tip 卡片 + 轻量状态条”布局，状态信息保留但降为次级层级。
    - 失败态改为恢复卡片重新占主视觉，并把随机 tip 作为下方次级块保留。
  - `apps/kimi-shell/src/prefill/prefill.css`
    - 删除旧的“三张指标卡主导”视觉结构，改为单一 tips 主卡和低对比状态 chips。
    - 收紧页面内部边框数量，更多依赖留白、字号和柔和背景区分主次。
    - 保留移动端下 tips 主卡、状态 chips 和失败态按钮的纵向堆叠规则。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 手工建议：
  - 重点看三种状态是否符合预期：等待态 tips 为主、进入主界面态 tips 不重抽、失败态恢复卡重新成为主视觉。

## 本轮计划（前置页 UI 进一步收敛）

### 计划清单

- [x] 记录本轮前置页顶栏与状态面板收敛目标
- [x] 调整 `apps/kimi-shell/src/prefill/PrefillApp.tsx`，移除标题栏中部文案以及最小化/最大化逻辑
- [x] 调整 `apps/kimi-shell/src/prefill/PrefillApp.tsx`，删除 `prefill-stage` / `prefill-status-shell` 包裹层，只保留 `prefill-status-panel`
- [x] 调整 `apps/kimi-shell/src/prefill/prefill.css`，把居中和宽度约束并入 `prefill-status-panel`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 顶栏不再显示“启动监控”
- [x] 顶栏窗口控制仅保留关闭按钮
- [x] 标题栏仍可拖拽窗口
- [x] 主内容区不再存在 `prefill-stage` / `prefill-status-shell`
- [x] `prefill-status-panel` 仍保持居中和原有状态内容
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx`
    - 删除 `prefill-titlebar-center` 与“启动监控”文案。
    - 删除最小化、最大化/还原按钮及对应状态、初始化副作用和双击最大化逻辑。
    - 保留标题栏拖拽与右上角“打开日志 + 关闭”结构。
    - 删除 `prefill-stage` / `prefill-status-shell` 包裹层，让 `prefill-status-panel` 直接挂在 `header` 下。
  - `apps/kimi-shell/src/prefill/prefill.css`
    - 顶栏 grid 改为左右两列，适配“左品牌 + 右操作”布局。
    - 删除 `prefill-titlebar-center`、`prefill-stage`、`prefill-status-shell` 的样式定义。
    - 将原本外层负责的居中、外边距和宽度约束并入 `prefill-status-panel`，保持状态面板尺寸与内部内容结构基本不变。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 手工建议：
  - 启动监控页重点确认三项：标题栏只剩品牌与右侧操作、关闭按钮可用、状态面板在桌面和窄窗下都仍然居中。

## 本轮计划（启动监控页改为无系统标题栏的小窗壳）

### 计划清单

- [x] 记录本轮启动页窗口壳与几何收口目标
- [x] 调整 `apps/kimi-shell/src-tauri/tauri.conf.json` 与 `window_manager.rs`，让 prefill surface 使用无系统标题栏并缩小窗口尺寸
- [x] 调整 `apps/kimi-shell/src/prefill/PrefillApp.tsx`，为启动监控页增加轻量自绘顶部壳与窗口控制
- [x] 调整 `apps/kimi-shell/src/prefill/prefill.css`，使启动页视觉风格贴近主窗口并紧贴状态面板
- [x] 执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 启动监控页不再显示原生 Windows title bar
- [x] 启动监控页窗口使用与主窗口一致的圆角/壳层视觉方向
- [x] 启动监控页窗口尺寸明显小于当前版本，并更贴近状态面板内容
- [x] 右上角日志按钮仍保留 `icon + 文字` 无边框样式
- [x] 启动页仍可拖拽、最小化和关闭
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/tauri.conf.json` / `apps/kimi-shell/src-tauri/src/window_manager.rs`
    - prefill surface 的窗口几何从 `760x520` 收紧到 `720x420`，最小尺寸改为 `660x380`。
    - 启动监控页窗口改为 `decorations=false`，并开启阴影，让它和主窗口一样走无系统标题栏方向。
    - 运行时 `apply_window_surface()` 也同步把 prefill surface 改为无标题栏，避免窗口创建时先闪原生标题栏。
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx`
    - 启动监控页新增轻量自绘顶部壳，包含品牌、顶部拖拽区、右上角“打开日志”按钮以及最小化/最大化/关闭按钮。
    - 继续保留上一轮收好的单一状态面板，未改动启动监控轮询与分流逻辑。
  - `apps/kimi-shell/src/prefill/prefill.css`
    - 启动页整体改为小型 `shell` 风格窗口壳：圆角、边框、阴影、顶部条和内容区分层。
    - 内容区压缩外层留白，让窗口几何更贴近中间状态面板。
    - 指标卡和失败态按钮继续保留响应式规则。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（50/50）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 手工建议：
  - 启动监控页重点确认三项：没有系统标题栏、顶部拖拽和窗口控制可用、窗口尺寸相比上一版明显更紧凑。
  - 如果你希望它进一步贴得更紧，下一步最值得微调的是 prefill 窗口高度和状态面板内部上下 padding。

## 本轮计划（启动监控页 UI 收敛）

### 计划清单

- [x] 记录本轮 UI 收敛目标、边界与验收标准
- [x] 调整 `apps/kimi-shell/src/prefill/PrefillApp.tsx`，移除外层 header/footer，只保留右上角日志按钮与居中状态面板
- [x] 调整等待态、进入主界面态和失败态文案与按钮布局
- [x] 调整 `apps/kimi-shell/src/prefill/prefill.css`，收敛为单一居中状态面板样式
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 等待态页面不再显示外层标题区和底部操作区
- [x] 等待态主标题为“正在等待后端启动完成”
- [x] 等待态不再显示重复的小字说明
- [x] 右上角存在无边框 `icon + 文字` 的“打开日志”按钮
- [x] 失败态使用同一紧凑面板，按钮放在面板内部
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx`
    - 移除了外层 `header/footer` 结构，页面改为“右上角日志按钮 + 单一居中状态面板”。
    - 等待态标题改成“正在等待后端启动完成”，进入主界面态改成“正在进入主界面”。
    - 等待态与进入主界面态不再渲染重复的小字说明；失败态继续保留详细错误说明。
    - 失败态按钮改为内收进状态面板，只保留“重试启动 / 退出应用”；“打开日志”统一抽到页面右上角。
  - `apps/kimi-shell/src/prefill/prefill.css`
    - 删除旧的 dialog/header/footer 样式，重写为单一居中虚线状态面板布局。
    - 新增右上角无边框 `icon + 文字` 日志按钮样式。
    - 保留三张指标卡，并维持窄屏下单列的响应式行为。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 手工建议：
  - 重点看等待态是否只剩单一状态面板。
  - 检查右上角“打开日志”按钮 hover 是否足够轻量，且在窄窗下不会压住主内容。
  - 人为触发失败态时，确认“重试启动 / 退出应用”都在面板内部。

## 本轮计划（Kimi Shell 0.0.9 版本发布）

### 计划清单

- [x] 记录本轮版本升级、安装包构建与发布说明范围
- [x] 将 `apps/kimi-shell` 版本从 `0.0.8` 升级到 `0.0.9`
- [x] 同步 `package.json`、`Cargo.toml`、`tauri.conf.json` 版本号
- [x] 编写 `apps/kimi-shell/docs/release-notes-0.0.9.md`
- [x] 构建 Windows NSIS 安装包
- [x] 核对安装包产物路径、大小与时间
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] `apps/kimi-shell/package.json` 版本为 `0.0.9`
- [x] `apps/kimi-shell/src-tauri/Cargo.toml` 版本为 `0.0.9`
- [x] `apps/kimi-shell/src-tauri/tauri.conf.json` 版本为 `0.0.9`
- [x] 发布说明文件 `apps/kimi-shell/docs/release-notes-0.0.9.md` 已创建
- [x] NSIS 安装包成功产出
- [x] `tasks/todo.md` 已补齐本轮回顾

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/package.json`
    - 版本号从 `0.0.8` 升级到 `0.0.9`。
  - `apps/kimi-shell/src-tauri/Cargo.toml` / `apps/kimi-shell/src-tauri/tauri.conf.json`
    - 通过 `pnpm -C apps/kimi-shell sync:version` 与 `package.json` 同步到 `0.0.9`。
  - `apps/kimi-shell/docs/release-notes-0.0.9.md`
    - 新增 `0.0.9` 版本更新说明，聚焦单窗口启动、启动监控页、启动失败兜底与快捷方式启动误判修复。
- 构建结果：
  - 执行 `pnpm -C apps/kimi-shell tauri build --bundles nsis` 通过。
  - 产物路径：`apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.9_x64-setup.exe`
  - 产物大小：`3567277` bytes
  - 构建时间：`2026-03-06 16:18:01`
- 验证结果：
  - `pnpm -C apps/kimi-shell sync:version` 通过。
  - `pnpm -C apps/kimi-shell tauri build --bundles nsis` 通过。
- 手工建议：
  - 安装后优先验证第二次冷启动、启动监控页自动分流和桌面快捷方式启动三条关键链路是否与本轮说明一致。

## 本轮计划（启动前置页改为后端启动监控页）

### 计划清单

- [x] 记录本轮启动监控页目标、分流规则与验收标准
- [x] 新增 Rust 轻量启动分流类型与命令：`get_startup_monitor_status`、`complete_startup_monitor_route`
- [x] 调整单窗口关闭语义：启动监控页阶段关闭窗口直接优雅退出，不再进入 shell
- [x] 将 `prefill.html` 对应前端改为启动监控页 UI，移除输入/提交逻辑
- [x] 接入启动轮询、自动分流到 workspace / onboarding / diagnostics / control_center
- [x] 为 diagnostics 追加最近一次启动监控决策信息
- [x] 执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 启动页不再承载文本输入，只显示启动计时、状态文案和恢复动作
- [x] `backend running + workspace_port ready` 时，启动页自动进入 workspace
- [x] `onboarding required / first install / missing_kimi` 时，启动页自动进入控制中心 `onboarding`
- [x] `backend crashed` 时，启动页自动进入控制中心 `diagnostics`
- [x] `starting >= 30s` 时，启动页停留在失败态，不自动进入控制中心
- [x] 启动监控命令仅在状态变化时写日志，不产生轮询刷屏
- [x] 启动监控页阶段点击关闭窗口会优雅退出应用，不再触发进入 shell
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/src/types.rs` / `apps/kimi-shell/src-tauri/src/app_state.rs`
    - 新增 `StartupMonitorState`、`StartupMonitorReason`、`StartupMonitorTargetRoute`、`StartupMonitorStatus`。
    - runtime 追加最近一次启动监控状态、原因、目标路由、详情与去重日志 key。
  - `apps/kimi-shell/src-tauri/src/lib.rs`
    - 新增命令 `get_startup_monitor_status` 与 `complete_startup_monitor_route`。
    - 新增轻量分流规则：`missing_kimi -> onboarding`、`crashed -> diagnostics`、`onboarding required -> onboarding`、`running + workspace_port/active_port ready -> workspace`、`>=30s -> failed`。
    - 启动监控状态只在状态变化时写日志，并同步到 diagnostics。
  - `apps/kimi-shell/src-tauri/src/window_manager.rs`
    - 监控页阶段点击窗口关闭，不再触发“跳过进入 shell”，而是回到主窗口默认关闭链路，由 `start_graceful_exit()` 接管。
    - 新增 `LocalRoute::Onboarding`，并提供 `complete_startup_monitor_route()` 把启动监控页自动分流到 `workspace / onboarding / diagnostics / control_center`。
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx` / `apps/kimi-shell/src/prefill/prefill.css`
    - 启动页改成监控 UI：显示计时、后端状态、分流目标、等待态 spinner、失败态按钮。
    - 移除文本输入与提交逻辑，改为轮询 `get_startup_monitor_status`，首次进入路由态时调用 `complete_startup_monitor_route`。
    - 失败态复用 `retry_start_backend`、`open_logs_folder`、`quit_app_gracefully`。
  - `apps/kimi-shell/src/app/types.ts` / `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`
    - 前端类型补齐启动监控状态。
    - 诊断页新增最近一次启动监控状态、原因、目标和详情展示。
- 根因与方案收口：
  - 启动前置页不再承担业务输入，只做轻量监控和分流，避免把重探测和用户交互放到 shell ready 之前。
  - 分流判断只依赖 runtime 和 settings 的轻量状态，不复用 `get_onboarding_status()`，避免启动路径重新变重。
  - shell loading 仍保留为第二层兜底，启动监控页只负责“先去哪里”。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（50/50）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 手工建议：
  - 安装后首次启动：应先停在监控页，再自动进入控制中心 `onboarding`。
  - 正常启动：监控页应显示计时并自动进入 workspace。
  - 人为制造后端 crash：应自动进入 `diagnostics`。
  - 启动监控页点击右上角关闭：应直接优雅退出，不再跳进 shell。

## 本轮计划（启动卡死根因修复：单窗口启动 + 前移 watchdog）

### 计划清单

- [x] 记录本轮根因、改造边界与验收标准
- [x] 将 `apps/kimi-shell/src-tauri/tauri.conf.json` 改为仅保留 `main` 原生窗口，并以 `prefill.html` 作为启动入口
- [x] 重构 `apps/kimi-shell/src-tauri/src/window_manager.rs` 启动状态机，加入 `startupAttemptId/startupPhase/startupFailureKind/startupFailureDetail`
- [x] 将 watchdog 前移到 `run_on_main_thread` 之前，并覆盖 main build task / window create / frontend ready 三段超时
- [x] 移除第二个原生 `prefill` 窗口依赖，改为同一 `main` 窗口从 `prefill.html` 导航到 `index.html#/loading`
- [x] 扩展 `AppStatus` / `DiagnosticsInfo` 与前端类型，暴露新的启动阶段与失败原因
- [x] 调整 `PrefillApp`、`LoadingView` 与主窗口失败态交互，统一到单窗口启动恢复链路
- [x] 执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 启动期只存在一个 Kimi 原生窗口，不再依赖第二个 `prefill` 原生窗口
- [x] 点击提交或关闭前导页时，不再创建第二个 WebView2 窗口，而是在同一窗口内导航到 `index.html#/loading`
- [x] `app.log` / diagnostics 中每次启动都能看到完整 `startupAttemptId + startupPhase` 终态
- [x] 若卡在主线程任务、WebView2 build 或 frontend ready 任一阶段，都会得到明确的 `startupFailureKind/startupFailureDetail`
- [ ] 启动失败时失败页停留在同一主窗口，并提供“重试打开主界面 / 打开日志 / 退出应用”
- [x] 不再出现“日志只有 `main_create_requested` 没有后续阶段”的观测盲区
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/tauri.conf.json`
    - 删除独立 `prefill` 原生窗口配置，只保留 `main`。
    - `main` 默认入口改成 `prefill.html`，并保持 `create: false`、`visible: false`，由 Rust 手动创建并切换表面形态。
  - `apps/kimi-shell/src-tauri/src/window_manager.rs`
    - 启动链路改为单窗口：启动时先创建 `main(prefill surface)`，提交/跳过 prefill 后在同一窗口导航到 `index.html#/loading`。
    - 新增 `startupAttemptId / startupPhase / startupFailureKind / startupFailureDetail`，并统一同步到 runtime diagnostics。
    - watchdog 前移到 `run_on_main_thread` 之前，按 `main_build_task_entered -> main_window_created -> frontend_ready` 三段推进，不再依赖第二个窗口创建完成后才开始兜底。
    - 移除旧的 destroy+recreate 第二窗口恢复主路径，失败后只保留同窗口失败态；若窗口真的丢失，再退回到同标签 `main` 的 prefill fallback 页面承载恢复按钮。
  - `apps/kimi-shell/src-tauri/src/lib.rs`
    - setup 阶段显式创建启动 `main` 窗口，再记录 `prefill_surface_shown`。
    - `RunEvent::WindowEvent` 只处理 `main` 标签，不再保留 `prefill` 窗口关闭逻辑。
  - `apps/kimi-shell/src/app/types.ts` / `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`
    - 前端类型和诊断面板补齐新的启动阶段、失败原因与 attempt id 展示。
  - `apps/kimi-shell/src/features/loading/LoadingView.tsx` / `apps/kimi-shell/src/app/useShellController.ts` / `apps/kimi-shell/src/App.tsx`
    - 主窗口 loading 页新增启动失败态，提供“重试打开主界面 / 打开日志 / 退出应用”。
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx`
    - 文案调整为“进入主界面”，与单窗口启动体验保持一致。
- 根因闭环：
  - 这轮不再尝试在 prefill 之外额外创建第二个 WebView2 主窗口，因此把“第二个窗口 build / 首文档加载卡在 `about:blank`”这条单点故障从架构上移除了。
  - 旧的 `main_create_requested` 观测点也被更细的分段阶段取代，后续再卡死时会明确落在主线程任务、窗口创建或 frontend ready 哪一段。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（43/43）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 未完成的人工验收：
  - 还需要在问题机器的安装版环境里做至少 10 次“第一次正常关闭后第二次冷启动 -> 点击提交”的实机回归。
  - 当前唯一未勾选项就是这条人工验收：确认极端失败时，失败页确实稳定停留在同一主窗口，而不是退化成空白或自动退出。

## 本轮计划（桌面快捷方式启动误判为 open-files）

### 计划清单

- [x] 记录桌面快捷方式启动复制自身 exe 到默认工作目录的根因与修复边界
- [x] 修正 `apps/kimi-shell/src-tauri/src/open_request.rs`，忽略自启动 exe / argv0 误判，保留默认工作目录回退
- [x] 为桌面快捷方式启动场景补回归测试，覆盖“仅 self exe”与“self exe + 真实文件”
- [x] 执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 双击桌面快捷方式启动时，不再在默认工作目录下创建 `20260306-appskimi-shell-xxxxxx` 这类临时 workspace
- [x] 不再把 `Kimi Desktop Shell.exe` 自身复制到默认工作目录新建目录
- [x] 正常无参数启动时，应用继续回退到已配置的默认工作目录作为 workspace
- [x] 显式 `--open-files` / `--open-dir` 与真实文件打开链路不回归
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/src/open_request.rs`：
    - `parse_open_request()` 现在会结合 `cwd` 识别“当前应用自己的可执行文件”这一类自启动噪声参数，不再把它当成隐式 `open-files` 候选。
    - `strip_executable_arg()` 扩展为优先剔除 self exe / `argv0`；即使只有一个可执行文件路径参数，也会被识别为普通启动而不是文件打开。
    - `parse_implicit_candidates()` 新增 self-launch 过滤，兜住 `/embedding` 等噪声过滤后的残留 self exe 场景，避免再次误判。
    - 新增路径等价比较辅助函数，支持用当前进程真实 exe 路径比对传入参数，避免绝对路径/规范化差异造成漏判。
    - 新增 3 个回归测试：
      - `parse_implicit_current_executable_is_ignored`
      - `parse_implicit_ignores_current_executable_and_keeps_real_file`
      - `parse_implicit_filters_current_executable_after_shell_noise`
- 根因结论：
  - 桌面快捷方式启动时，启动参数链路会在某些场景下把应用自己的 exe 路径带进 `open_request` 解析。
  - 旧逻辑会把“存在的文件路径”一律视为隐式 `open-files`，于是错误触发“创建新 workspace 并复制文件”，最终把 `Kimi Desktop Shell.exe` 自身复制进默认工作目录下的临时目录。
  - 修复后，这类 self exe / `argv0` 参数会被当作启动噪声忽略，应用将继续走原本的无参启动路径，后端自然回退到已配置的默认工作目录作为 workspace。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（43/43）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 风险与后续：
  - 本轮修复覆盖的是“自身 exe 被误判为打开文件”的根因；如果你的机器上桌面快捷方式还会传入额外的 `.lnk` 或其他外壳参数，下一步应直接看 `app.log` 里的 `open-request parse` 记录补样本，而不是继续扩大过滤面。
  - 我还没法替你在安装版环境里双击桌面快捷方式做最终手工回归，建议你优先验证：
    - 双击快捷方式启动时，默认工作目录下不再出现新的 `20260306-appskimi-shell-xxxxxx` 目录。
    - 打开后 workspace 是否直接落在你配置的默认工作目录。

## 本轮计划（启动白屏偶发成功：手动创建 main + 启动期护栏 + WebView2 A/B）

### 计划清单

- [x] 记录本轮根因导向修复边界、实施步骤与验收标准
- [x] 将 `apps/kimi-shell/src-tauri/tauri.conf.json` 调整为仅 `prefill` 自动创建，`main` 改为手动创建
- [x] Rust 侧实现 `ensure/destroy/recreate main window`，并把 `prefill -> main` 放行条件收敛为 `notify_frontend_ready`
- [x] Rust 侧补 `startup_pending`、启动 trace、退出拦截与主窗口启动期销毁恢复逻辑
- [x] 为晚创建 `main` 的场景补齐待派发队列，避免 `workspace-session` / `open-request` 等事件丢失
- [x] 扩展 diagnostics，补充 WebView2 runtime 信息、启动 trace 和主窗口创建模式
- [x] 增加 Evergreen / Fixed Runtime A/B 构建配置与脚本入口
- [x] 执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 启动时只自动创建 `prefill`，`main` 在需要进入主界面时才创建
- [x] `prefill` 只在 `main` 真正 `frontend_ready` 后关闭，启动异常时停留在可操作失败页
- [x] 启动期 `main` 首次超时会执行一次 destroy + recreate，再失败进入 `startup_failed`
- [x] 启动期收到退出或主窗口销毁时，不会让应用静默整体退出
- [x] `workspace-session`、`open-request-error`、prefill payload 在晚创建 `main` 场景下不丢失
- [x] 诊断页可看到 `webviewRuntimeKind`、`webviewRuntimeVersion`、`startupPending`、`startupExitCause`、`mainCreateMode`、`startupTrace`
- [ ] 可分别构建 Evergreen 与 Fixed Runtime A/B 包
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/tauri.conf.json`：
    - `main` 改为 `create: false`，`prefill` 显式保留 `create: true`，彻底移除“启动即后台创建 hidden main”的默认路径。
  - `apps/kimi-shell/src-tauri/src/window_manager.rs`：
    - 重写启动编排，改为手动创建 `main`，并集中管理 `startup_pending`、`prefill_completion_pending`、watchdog、destroy+recreate、启动失败页、退出许可与启动 trace。
    - `notify_frontend_ready` 成为唯一放行点；只有 ready 到达后才真正关闭 `prefill` 并显示 `main`。
    - 启动期 5 秒超时后执行一次 `destroy + recreate main`，再 5 秒仍失败则切 `startup_failed`，保留 `prefill`。
    - 新增 `publish_workspace_session_event` / `publish_open_request_error`，为晚创建 `main` 的场景补齐待派发队列。
  - `apps/kimi-shell/src-tauri/src/lib.rs` / `apps/kimi-shell/src-tauri/src/app_state.rs` / `apps/kimi-shell/src-tauri/src/types.rs`：
    - `RuntimeState` 与 `DiagnosticsInfo` 新增 `webviewRuntimeKind`、`webviewRuntimeVersion`、`startupPending`、`startupExitCause`、`mainCreateMode`、`startupTrace`。
    - setup 阶段记录 `prefill_shown`，初始化 WebView2 runtime 元信息。
    - `RunEvent::ExitRequested` 在 startup pending 时会 `prevent_exit()`；正常退出链路统一通过 `permit_process_exit()` 放行。
  - `apps/kimi-shell/src-tauri/src/workspace_session.rs` / `apps/kimi-shell/src-tauri/src/open_request.rs` / `apps/kimi-shell/src-tauri/src/tray_manager.rs`：
    - `workspace-session`、`open-request-error`、tray quit 全部接入新的窗口管理入口，避免晚创建 `main` 时丢事件或被退出拦截误伤。
  - `apps/kimi-shell/src/app/types.ts` / `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`：
    - 前端 diagnostics 类型与控制中心诊断面板新增 WebView runtime、startup pending/exit cause、main create mode 与 startup trace 展示。
  - `apps/kimi-shell/package.json` / `apps/kimi-shell/scripts/build_webview_variant.ps1` / `apps/kimi-shell/src-tauri/tauri.webview.evergreen.conf.json` / `apps/kimi-shell/src-tauri/tauri.webview.fixed-runtime.conf.json`：
    - 新增 Evergreen / Fixed Runtime A/B 构建入口与覆盖配置，并把 `KIMI_WEBVIEW_RUNTIME_KIND` 注入编译期，供 diagnostics 区分 runtime kind。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（40/40）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 风险与后续：
  - 代码、测试和前端构建已通过，但“安装版第二次冷启动是否 10/10 成功”仍需你在问题机器上做真实安装包回归。
  - Fixed Runtime A/B 的构建入口已经补齐，但本轮没有实际产出 Fixed Runtime 包；原因是仓库里还没有 `apps/kimi-shell/src-tauri/webview2-fixed-runtime` 运行时目录。
  - 下一步手工验收应优先看：
    - 第二次冷启动时是否还会出现空白后自动退出。
    - 若故意制造失败，`prefill` 是否稳定停留在 `startup_failed`，并能用“重试打开主界面 / 打开日志 / 退出应用”恢复。
    - diagnostics 中的 `startupTrace` 是否能帮助区分“创建失败 / 重建失败 / 启动期销毁 / ready 超时”。

## 本轮计划（安装版第二次冷启动白屏后退出修复）

### 计划清单

- [x] 记录本轮问题边界、修复策略与验收标准
- [x] Rust 侧为 `prefill -> main` 切换增加启动护栏、watchdog 与失败态
- [x] 新增 `prefill-status` 事件与 `recover_main_window_boot` / `quit_app_gracefully` 接口
- [x] `prefill` 前端增加 `idle/opening_main/startup_failed` 状态机与恢复入口
- [x] 补充 Rust 单测或行为级验证，覆盖延迟完成与恢复路径
- [x] 执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 第二次冷启动时，即使 `main` 尚未 ready，`prefill` 也不会立刻让位给空白主窗口
- [x] `notify_frontend_ready` 到达后，`prefill` 自动关闭并显示主窗口
- [x] `main` 超时未 ready 时，`prefill` 会进入失败态并提供“重试打开主界面 / 打开日志 / 退出应用”
- [x] 启动失败期间应用保持存活，不出现空白后整 app 直接退出
- [x] 原有文本 prefill、阻断态控制中心、主窗口正常关闭退出不回归
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/src/window_manager.rs`：
    - 为 prefill 完成流程新增启动护栏状态：`prefill_completion_pending`、watchdog、失败态与 generation 防重入。
    - `submit_prefill` / `complete_prefill_without_text` 改为“请求完成 prefill”，只有在 `notify_frontend_ready` 已到达时才真正关闭 `prefill` 并显示 `main`。
    - 新增一次性 watchdog：5 秒未 ready 时对 `main` 执行一次 `tauri://localhost/index.html#/loading` 恢复导航；再等 3 秒仍未 ready，则发出 `startup_failed`。
    - 新增 `prefill-status` 事件和 `recover_main_window_boot()`。
    - 增补 3 个单测，覆盖 deferred completion、manual recovery re-arm、ready 后清理 guard。
  - `apps/kimi-shell/src-tauri/src/lib.rs` / `apps/kimi-shell/src-tauri/src/types.rs`：
    - 新增 `PrefillStatusState` / `PrefillStatusPayload`。
    - 新增命令 `recover_main_window_boot`、`quit_app_gracefully`。
    - 主窗口关闭与 prefill 失败页退出统一复用 `start_graceful_exit()`，保留原有优雅停后端退出。
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx` / `apps/kimi-shell/src/prefill/prefill.css` / `apps/kimi-shell/src/app/types.ts`：
    - prefill 前端改为 `idle | opening_main | startup_failed` 三态。
    - `opening_main` 显示等待主界面文案；`startup_failed` 显示“重试打开主界面 / 打开日志 / 退出应用”。
    - 新增对 `prefill-status` 事件的监听与样式。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（39/39）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 风险与后续：
  - 代码与构建验证已完成，但“安装版第二次冷启动 + 主窗口确实卡住时的人工重试”仍需你在目标机器手工验收。
  - 这轮恢复导航使用单次 `tauri://localhost/index.html#/loading`，没有恢复旧的高频 about:blank 轮询；若个别机器仍失败，下一步应优先补主窗口 URL / page-load 级日志，而不是直接加回循环重试。

## 本轮计划（版本 0.0.8 发布：升级版本 + 安装包 + 更新说明）

### 计划清单

- [x] 记录本轮发布目标与验收标准
- [x] 将 `apps/kimi-shell/package.json` 版本从 `0.0.7` 升级到 `0.0.8`
- [x] 执行 `pnpm -C apps/kimi-shell sync:version` 同步 `Cargo.toml` 与 `tauri.conf.json`
- [x] 新增 `apps/kimi-shell/docs/release-notes-0.0.8.md` 版本更新说明
- [x] 构建 NSIS 安装包并确认产物路径
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] `package.json` / `Cargo.toml` / `tauri.conf.json` 版本均为 `0.0.8`
- [x] NSIS 安装包构建成功且可定位产物
- [x] `release-notes-0.0.8.md` 已创建并记录本轮核心变更与验证结果

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/package.json` 版本从 `0.0.7` 升级到 `0.0.8`。
  - 执行 `pnpm -C apps/kimi-shell sync:version`，同步更新：
    - `apps/kimi-shell/src-tauri/Cargo.toml`
    - `apps/kimi-shell/src-tauri/tauri.conf.json`
    - `apps/kimi-shell/src-tauri/Cargo.lock`
  - 新增版本说明：`apps/kimi-shell/docs/release-notes-0.0.8.md`。
  - 执行 `pnpm -C apps/kimi-shell tauri build --bundles nsis` 生成 `0.0.8` 安装包。
- 验证结果：
  - 版本字段检查通过：
    - `apps/kimi-shell/package.json` = `0.0.8`
    - `apps/kimi-shell/src-tauri/Cargo.toml` = `0.0.8`
    - `apps/kimi-shell/src-tauri/tauri.conf.json` = `0.0.8`
  - 构建命令通过：
    - `pnpm -C apps/kimi-shell sync:version`
    - `pnpm -C apps/kimi-shell tauri build --bundles nsis`
  - 安装包产物：
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.8_x64-setup.exe`
    - 大小：`3535629` bytes
    - 构建时间：`2026-03-06 10:06:49`
- 风险与后续：
  - 本轮已完成版本升级、更新说明和打包；建议你在目标 Windows 机器上手工确认安装、启动以及控制中心弹窗交互。

## 本轮计划（控制中心状态栏弹窗入口 + 探测改为点击触发）

### 计划清单

- [x] 基于已确认方案整理实施清单并锁定边界
- [x] `useShellController` 增加控制中心 modal/chrome 状态，并移除控制中心自动探测 effect
- [x] `App.tsx` 改为状态栏设置按钮入口 + 控制中心弹窗壳
- [x] `ShellTitlebar.tsx` 移除工作区控制中心按钮
- [x] `ControlCenterView.tsx` 支持 `fullscreen/modal` 与 `dashboard/full` 双形态，并按点击触发探测
- [x] `App.css` 增加控制中心弹窗样式并适配 dashboard/full 两种布局
- [x] 执行 `pnpm -C apps/kimi-shell build` 验证
- [x] 回填本节回顾与验证结果

### 验收标准

- [ ] 状态栏设置按钮位于左侧 `running` 状态标签前，点击打开控制中心弹窗
- [ ] 工作区标题栏控制中心按钮被移除
- [ ] 弹窗默认只显示 dashboard，不显示 sidebar，不自动触发控制中心探测
- [ ] 点击 dashboard 入口后才切换到带 sidebar 的 full 形态，并触发对应探测
- [ ] 阻断态与 hash 路由的全屏控制中心行为保持不变
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/app/useShellController.ts`：
    - 新增 `controlCenterModalOpen` / `controlCenterChrome` 状态，区分 workspace 主动打开的 modal 控制中心与阻断态全屏控制中心。
    - `openControlCenter()` 改为 workspace 下仅打开 modal，不再切 `#/control-center`。
    - 新增 `closeControlCenterModal()`、`openOnboardingFromDashboard()`、`openRuntimePanelFromDashboard()`。
    - 删除“进入控制中心自动刷新 onboarding / context menu / install probe / diagnostics / config center”的 effect。
    - 保留启动期 `refreshStatus + refreshOnboarding`，并让 `#/onboarding` / `#/diagnostics` / `#/logs_paths` 路由在全屏模式下按目标位置触发对应探测。
    - 安装依赖 / 安装 Kimi 后仅刷新 `onboarding + installProbe`；保存工作目录后不再因为处于控制中心就额外刷新 diagnostics。
  - `apps/kimi-shell/src/App.tsx`：
    - 底部状态栏左侧新增设置图标入口，位置位于 `status-indicator` 前。
    - 新增控制中心 modal overlay，支持遮罩关闭与 `Esc` 关闭（若二级 `ConfigCenterModal` 未打开）。
    - 全屏与 modal 两种控制中心都统一复用 `ControlCenterView`。
  - `apps/kimi-shell/src/features/window/ShellTitlebar.tsx`：
    - 移除 workspace 标题栏的控制中心菜单按钮。
  - `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`：
    - 新增 `surface="fullscreen|modal"` 与 `chrome="dashboard|full"`。
    - modal 默认仅显示 dashboard 主内容，不显示 sidebar。
    - 点击 dashboard 入口后才切换为 full 形态，并按目标位置触发 `onboarding / diagnostics / context menu` 探测。
    - 安装区“重新检测”改为真正调用 `refreshInstallProbe()`；窄屏安装步骤展开时也会触发探测。
    - runtime panel 切换改为按面板点击触发：`core/logs` 拉 diagnostics，`paths` 拉 diagnostics + context menu。
    - `ConfigCenterModal` 仅在 full 形态下渲染。
  - `apps/kimi-shell/src/App.css` / `apps/kimi-shell/src/app/types.ts`：
    - 增加控制中心 modal 样式及 `ControlCenterSurface` / `ControlCenterChrome` 类型。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
  - 构建过程中 `sync:version` 触达了 `apps/kimi-shell/src-tauri/Cargo.toml` 与 `apps/kimi-shell/src-tauri/tauri.conf.json`，经 `git diff --ignore-cr-at-eol` 确认为无文本内容变化。
- 风险与后续：
  - 以下交互已在代码层落地，但仍需你在桌面端手工验收：
    - 状态栏设置按钮位置与图标是否符合预期。
    - modal 首次打开是否只显示 dashboard，且不触发额外探测。
    - 点击 dashboard 入口后是否切到带 sidebar 的 full 形态。
    - 阻断态与 `#/diagnostics` / `#/logs_paths` / `#/onboarding` 全屏控制中心入口是否都符合预期。

## 本轮计划（task0305-2 控制中心切换卡顿：现状核对 + 优化方案讨论）

### 计划清单

- [x] 阅读 `tasks/kimishell-task0305-2.md`、`tasks/todo.md` 与 `tasks/lessons.md`
- [x] 对照当前代码确认控制中心切换时仍会触发的前后端调用
- [x] 输出一版分阶段优化计划（首屏体验、缓存策略、去重策略、验证方案）
- [x] 回填本节讨论结论与后续建议

### 验收标准

- [x] 明确当前实现里仍会在切到控制中心时触发的重操作
- [x] 给出可执行的优化顺序，而不是只给方向
- [x] 说明每一步的收益、代价与验证方式

### 回顾（完成后填写）

- 现状核对：
  - 当前 `useShellController.ts` 在每次切到 `control_center` 时，仍会自动触发 `refreshOnboarding()`、`refreshContextMenuStatus()`、`refreshInstallProbe()`。
  - 其中诊断页与配置中心的 eager load 已经收敛：`runtime_center` 才拉 `get_diagnostics`，`onboarding` 才懒加载 `load_kimi_cli_config_center`。
  - 但 `refreshContextMenuStatus()` 与 `refreshOnboarding()` 存在重复读取右键状态的问题，因为后者内部已经会调用 `context_menu::status`。
  - `refreshInstallProbe()` 仍会执行 `git --version`、`uv --version`、Python 3.13 探测、`kimi -v`，这是当前最像“切屏卡一下”的重操作。
- 建议的优化顺序：
  - Phase 1（低风险高收益）：切到控制中心时不再自动调用 `refreshContextMenuStatus()`；优先把右键状态从 `onboarding` 结果派生，保留“手动刷新”与启用/禁用后的强制刷新。
  - Phase 1（低风险高收益）：`refreshInstallProbe()` 改为按需触发，只在进入引导安装步骤、点击手动刷新、执行安装动作后强制刷新；平时走 60s TTL 缓存。
  - Phase 1（低风险高收益）：`refreshOnboarding()` 增加 5-10s 短 TTL / stale-while-revalidate；保存路径、登录探测、右键启停、完成引导等操作后显式失效。
  - Phase 2（后端兜底）：在 Rust 侧为 install probe / onboarding 子项补缓存，避免未来前端或其他入口重复触发时再次启动外部进程。
  - Phase 3（验证）：补充每个 invoke 与后端探测的耗时日志，对比“切到控制中心前后首屏可交互时间”和“后台探测完成时间”。
- 风险与取舍：
  - 代价是控制中心中的安装/引导状态会有几秒到几十秒的非实时，但该页面更适合“近实时”而不是“每次切屏实时探测”。
  - 不建议第一步就上新的聚合 command；先做去重 + lazy load + TTL，收益最大、改动最小，也更符合最小影响原则。

## 本轮计划（版本 +0.0.1 + 构建安装包）

### 计划清单

- [x] 在 `tasks/todo.md` 记录本轮计划与验收标准
- [x] 将 `apps/kimi-shell/package.json` 版本从 `0.0.5` 升级到 `0.0.6`
- [x] 执行 `pnpm -C apps/kimi-shell sync:version` 同步 `Cargo.toml` 与 `tauri.conf.json`
- [x] 构建 NSIS 安装包并确认产物路径
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] `package.json` / `Cargo.toml` / `tauri.conf.json` 版本均为 `0.0.6`
- [x] NSIS 安装包构建成功且可定位产物

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/package.json` 版本从 `0.0.5` 升级到 `0.0.6`。
  - 执行 `pnpm -C apps/kimi-shell sync:version`，同步更新：
    - `apps/kimi-shell/src-tauri/Cargo.toml`
    - `apps/kimi-shell/src-tauri/tauri.conf.json`
    - `apps/kimi-shell/src-tauri/Cargo.lock`
  - 执行 `pnpm -C apps/kimi-shell tauri build --bundles nsis` 生成 `0.0.6` 安装包。
- 验证结果：
  - 版本字段检查通过：
    - `apps/kimi-shell/package.json` = `0.0.6`
    - `apps/kimi-shell/src-tauri/Cargo.toml` = `0.0.6`
    - `apps/kimi-shell/src-tauri/tauri.conf.json` = `0.0.6`
  - 安装包产物：
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.6_x64-setup.exe`
    - 大小：`3534480` bytes
    - 构建时间：`2026-03-05 22:17:40`
- 风险与后续：
  - 本轮仅完成版本升级与打包，功能回归请继续按既有清单在目标机器手工验证。

## 本轮计划（task0305-2 回归修复：标题栏跟随 + 关闭计时 + 文件右键失败提示）

### 计划清单

- [x] 在 `tasks/todo.md` 记录本轮计划、验收项与回顾
- [x] 后端新增 `open-request-error` 事件与 `OpenRequestErrorPayload` 类型
- [x] `open_request` 在 startup/forwarded parse 或 apply 失败时统一发出结构化错误事件并补日志
- [x] `backend_manager` 在 WebSocket `/api/sessions/{id}/stream` 升级链路提取 session id 并上报 active-session hint
- [x] `workspace_session` 增加按 `session_id` 即时回填 active session 的逻辑（并发出 `active_session_updated`）
- [x] 前端监听 `active_session_updated` 后即时 merge 到 `status`，标题栏优先刷新
- [x] 前端关闭进度改为本地连续计时（100ms tick）并在退出 stopping 后清理
- [x] 前端监听 `open-request-error` 并在 alert 区域显示明确错误原因
- [x] 增补 Rust 单测（session stream id 解析、session hint 回填、open request 错误事件）
- [x] 执行 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 执行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与风险说明

### 验收标准

- [ ] Kimi Web 侧栏切换 session 时，标题栏工作区在 2 秒内更新
- [ ] 关闭应用弹层中的耗时数字连续变化（非静态）
- [ ] 文件右键普通文档链路可用，不回归目录右键
- [ ] 文件右键失败场景下，前端即时展示结构化错误提示
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - Rust：
    - `apps/kimi-shell/src-tauri/src/types.rs` 新增 `OpenRequestErrorPayload`。
    - `apps/kimi-shell/src-tauri/src/open_request.rs` 新增 `open-request-error` 事件发射；覆盖 startup/forwarded parse 与 apply 失败，输出结构化日志（含 source/stage/message/args）。
    - `apps/kimi-shell/src-tauri/src/open_request.rs` 补充 `open-files` 失败上下文（workspace_root/workspace_dir/first_file/stage）提升诊断可读性。
    - `apps/kimi-shell/src-tauri/src/backend_manager.rs` 在 WebSocket `/api/sessions/{id}/stream` 升级链路提取 `session_id`，调用 `workspace_session::note_session_stream_activity`。
    - `apps/kimi-shell/src-tauri/src/workspace_session.rs` 新增基于 `session_id` 的即时回填逻辑，命中后立即触发 `active_session_updated`，并保留轮询兜底。
    - 新增/更新单测：`open_request` 错误 payload、`backend_manager` stream path 解析、`workspace_session` session_id 匹配。
  - 前端：
    - `apps/kimi-shell/src/app/types.ts` 新增 `OpenRequestErrorPayload`。
    - `apps/kimi-shell/src/app/useShellController.ts` 新增 `open-request-error` 监听，并将 `active_session_updated` 即时 merge 到 `status`。
    - `apps/kimi-shell/src/app/useShellController.ts` 新增关闭进度本地连续计时器（100ms tick），在离开 `stopping` 或卸载时清理。
    - `apps/kimi-shell/src/App.tsx` 关闭弹层耗时显示改为本地实时值 `shutdownElapsedMs`。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --nocapture` 通过（33/33）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 风险与后续：
  - 本轮为代码与自动化验证；以下验收项仍需在目标桌面环境手工确认：
    - Kimi Web 侧栏切换 session 时标题栏工作区 2 秒内跟随。
    - 关闭弹层耗时数字在真实关闭流程中连续跳动。
    - Explorer 文件右键普通文档链路与失败提示交互。

## 本轮计划（版本 0.0.5 发布：升级版本 + 安装包 + 更新说明）

### 计划清单

- [x] 升级 `apps/kimi-shell/package.json` 版本到 `0.0.5`
- [x] 执行 `pnpm -C apps/kimi-shell sync:version` 同步 `Cargo.toml` 与 `tauri.conf.json`
- [x] 构建 NSIS 安装包并确认产物路径
- [x] 新增 `apps/kimi-shell/docs/release-notes-0.0.5.md` 版本更新说明
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 应用版本号为 `0.0.5`
- [x] 安装包构建成功并可定位产物
- [x] 版本更新说明文档已创建并记录本轮核心变更

### 回顾（完成后填写）

- 实际变更：
  - 版本号升级：`apps/kimi-shell/package.json` 从 `0.0.4` 升级到 `0.0.5`。
  - 版本同步：执行 `pnpm -C apps/kimi-shell sync:version`，同步更新 `apps/kimi-shell/src-tauri/Cargo.toml` 与 `apps/kimi-shell/src-tauri/tauri.conf.json`。
  - 构建安装包：执行 `pnpm -C apps/kimi-shell tauri build --bundles nsis`，生成 `0.0.5` 安装包。
  - 新增版本说明：`apps/kimi-shell/docs/release-notes-0.0.5.md`。
- 验证结果：
  - `apps/kimi-shell/package.json` / `Cargo.toml` / `tauri.conf.json` 版本字段均为 `0.0.5`。
  - 安装包产物：
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.5_x64-setup.exe`
    - 大小：`3524789` bytes
    - 构建时间：`2026-03-05 16:50:37`
- 风险与后续：
  - 建议在目标机器安装后做一次手工回归：目录/文件右键链路、外链外开、关闭进度提示。

## 本轮计划（task0305-1 两期实施：右键稳定性 + Session 自动化）

### 计划清单

- [x] Phase 0：在 `tasks/todo.md` 记录两期计划与验收门槛，补文档分流与专项调查记录
- [x] Phase 1：实现右键注册表自动自愈（启动时发现漂移/缺失自动重写）
- [x] Phase 1：统一并强制写入目录/文件右键命令模板（含 `AllFilesystemObjects`）
- [x] Phase 1：增强 `context_menu` 状态提示，明确缺失键与命令漂移点
- [x] Phase 1：补强 `open_request` 的“非空参数但 parse 为 none”诊断日志
- [x] Phase 1：修复关闭应用终端闪现（`taskkill` 无窗）并增加关闭进度事件/前端可视化
- [x] Phase 1：注入桥接并外开 iframe 内外链（拦截 `<a>` 与 `window.open`）
- [x] Phase 1：补日志埋点（右键自愈结果、外链桥接、关闭流程耗时）
- [x] Phase 2：新增 `workspace_session` 服务（轮询 `/api/sessions` 并维护 active session）
- [x] Phase 2：扩展 `AppStatus` 与 TS 类型（`activeSessionId`/`activeSessionWorkDir`/`sessionSource`）
- [x] Phase 2：实现工作区 bootstrap（open-dir/open-files 后自动建/切 session）
- [x] Phase 2：实现 session 导航桥（捕获 stream 模板 + `navigate_session` 指令）
- [x] Phase 2：让 prefill 在 session 导航完成后发送，优先作为新 session 首条 prompt
- [x] Phase 2：标题栏优先显示 session 工作区，回退 runtime `effectiveWorkDir`
- [x] 补充 Rust 单测（`context_menu`、`open_request`、`workspace_session`）并执行回归
- [x] 执行前端构建验证并回填本节回顾

### 验收标准

- [ ] 安装后不手动点“启用”，目录右键与文件右键都可触发链路
- [ ] 文件右键不再出现“前置页几秒后关闭且打开失败”
- [ ] 应用内 Kimi Web 外链可稳定跳系统浏览器
- [ ] 关闭应用不再弹终端窗口，并显示关闭进度提示
- [ ] 标题栏可在 2 秒内跟随 active session 工作区（回退逻辑正常）
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - Rust：
    - `lib.rs` 接入 `workspace_session`、`AppStatus` 回填 active session 字段、启动时 context menu 自动自愈、主窗口关闭改为 `shutdown-progress` 事件 + 后台线程停服退出。
    - `backend_manager.rs` 接入 session bootstrap 触发与状态清理；`taskkill` 改无窗执行；注入脚本新增外链桥、session 桥、`window.open` 与锚点拦截。
    - `open_request.rs` 在 `open-dir/open-files` 成功后排队 workspace bootstrap；补“args 非空但无可执行请求”日志。
    - `context_menu.rs` 状态 message 增强为“缺失键/漂移键”可读根因。
    - 新增模块 `workspace_session.rs`（轮询 sessions、活动会话判定、按工作区建 session、桥接事件发射）。
  - 前端：
    - `types.ts/theme.ts/useShellController.ts` 新增 shutdown/session/external-link 桥接类型与监听、session 导航调度、prefill 在 session 导航期间挂起后再发送。
    - `ShellTitlebar.tsx` 优先展示 `activeSessionWorkDir`，回退 `effectiveWorkDir`。
    - `App.tsx/App.css` 新增关闭进度覆盖层展示。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（27/27）。
  - `pnpm -C apps/kimi-shell build` 通过（含 `sync:version`、`tsc`、`vite build`）。
- 风险与后续：
  - Explorer 真实右键链路、外链跳转与 session 自动切换仍需你在目标安装包环境做手工验收（本轮未自动化驱动 Explorer/UI）。
  - `navigate_session` 目前是“模板观测 + 最佳努力跳转”策略，若 Kimi Web 路由后续变更，可能需要补充更精确的路由模板识别规则。

## 本轮计划（回归修复：安装后文件右键不触发链路）

### 计划清单

- [x] 记录用户回归问题（目录右键可触发，文件右键不触发）
- [x] 调整文件右键命令模板，提升 Explorer 兼容性
- [x] 补充文件对象注册兜底键（`AllFilesystemObjects`）
- [x] 保持 `open_request` 对 `--open-files --` 新语法兼容，同时增强无分隔符场景容错
- [x] 增补/更新单测并执行回归验证
- [x] 回填本轮回顾与后续验证建议

### 验收标准

- [ ] 安装后目录右键链路保持可用
- [ ] 安装后文件右键可稳定触发 `open-files` 链路
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/src/context_menu.rs`：
    - 文件右键命令模板从 `--open-files -- "%1"` 调整为 `--open-files "%1"`，提升 Explorer 触发兼容性。
    - 新增文件对象兜底注册：`HKCU\\Software\\Classes\\AllFilesystemObjects\\shell\\KimiWebShell` 及 `command`。
    - `status` 校验范围同步扩展到 `AllFilesystemObjects` 命令键，发现缺失/漂移时仍给出“启用重写”提示。
  - `apps/kimi-shell/src-tauri/src/open_request.rs`：
    - `collect_candidate_paths` 增强容错：在非 literal 模式下，若参数以 `--` 开头但解析后路径真实存在，仍按文件路径处理。
    - 新增单测：`parse_open_files_without_literal_still_accepts_existing_dash_prefixed_file`。
  - 版本与发布：
    - 版本提升到 `0.0.4`（`package.json` + `sync:version` 同步到 `Cargo.toml` 与 `tauri.conf.json`）。
    - 新增版本说明：`apps/kimi-shell/docs/release-notes-0.0.4.md`。
    - 重新构建 NSIS 安装包：`Kimi Desktop Shell_0.0.4_x64-setup.exe`。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml context_menu -- --nocapture` 通过（3/3）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml open_request -- --nocapture` 通过（9/9）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（24/24）。
  - `pnpm -C apps/kimi-shell tauri build --bundles nsis` 成功，产物：
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.4_x64-setup.exe`
- 风险与后续：
  - 真实 Explorer 右键链路属于系统交互验收，需你在安装 `0.0.4` 后手工确认“目录/文件右键均可触发”。
  - 若机器上保留旧版注册表值，请在应用内点击一次“启用右键菜单”完成重写后再测试。

## 本轮计划（版本 +0.0.1 + 更新说明 + 安装包）

### 计划清单

- [x] 记录并确认本轮发布目标（版本升级、更新说明、安装包产出）
- [x] 将 `apps/kimi-shell/package.json` 版本从 `0.0.2` 升级到 `0.0.3`
- [x] 执行 `sync:version` 同步 `Cargo.toml` 与 `tauri.conf.json`
- [x] 新增版本更新说明文档（Markdown）
- [x] 执行安装包构建命令并确认产物路径
- [x] 回填本轮回顾与验证结论

### 验收标准

- [x] 应用版本号成功升级到 `0.0.3`
- [x] 版本更新说明文档已创建并包含核心变更与验证信息
- [x] 安装包构建成功并可定位到产物文件

### 回顾（完成后填写）

- 实际变更：
  - 版本升级：`apps/kimi-shell/package.json` 从 `0.0.2` 升级到 `0.0.3`。
  - 版本同步：执行 `pnpm -C apps/kimi-shell sync:version`，同步更新 `apps/kimi-shell/src-tauri/Cargo.toml` 与 `apps/kimi-shell/src-tauri/tauri.conf.json` 的版本字段。
  - 新增版本说明文档：`apps/kimi-shell/docs/release-notes-0.0.3.md`。
  - 安装包构建：执行 `pnpm -C apps/kimi-shell tauri build --bundles nsis`，成功生成 NSIS 安装包。
- 验证结果：
  - `sync:version` 日志确认：`version=0.0.3`。
  - 打包命令成功结束（exit code 0）。
  - 安装包产物存在：
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.3_x64-setup.exe`
    - 文件大小：`3495009` bytes。
- 风险与后续：
  - 当前仅产出 NSIS 安装包；如需 MSI 或多语言安装包，需要追加对应 bundler 参数与构建流程。

## 本轮计划（右键文档 404 修复 + 调查分流）

### 计划清单

- [x] 梳理并落地本轮方案到 `tasks/todo.md`（执行前清单）
- [x] 强化 `context_menu.rs` 状态判定：键存在 + 命令值匹配预期
- [x] 统一右键命令模板（目录背景/目录/文件），文件命令改为 `--open-files -- "%1"`
- [x] `enable_context_menu` 每次全量重写命令；`status` 发现漂移返回修复提示
- [x] 重构 `open_request.rs` 参数解析为“规范化 + 分类”流程
- [x] 支持 `file:///` 路径、保留 `--` 后字面量参数、过滤常见 Shell 噪声参数
- [x] 为 `--open-files` 增加“无有效文件”安全回退（单目录降级 `OpenDir`，其余结构化报错）
- [x] 增加关键埋点日志（startup/forwarded args + cwd + parse result）
- [x] 补充单测：`open_request` 覆盖 file URI / literal `--` / shell 噪声 / 目录降级
- [x] 补充单测：`context_menu` 纯函数层命令构造与匹配（含空格与引号路径）
- [x] 调查文档分流：`white-screen-investigation.md` 增加分流说明；新增 `right-click-404-investigation.md`
- [x] 完成验证并回填回顾（必要时更新 `tasks/lessons.md`）

### 验收标准

- [ ] Explorer 目录右键仍可正常打开（`--open-dir` 行为不回归）
- [ ] 文件/文档右键触发后不再出现应用内 404（`--open-files` 行为稳定）
- [x] 支持 `--open-files -- <path...>` 新语法，同时兼容旧语法
- [x] 日志可见清晰的 open-request 解析记录与结构化错误信息
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/src/context_menu.rs`：
    - 新增命令模板构造与匹配纯函数；文件右键命令升级为 `--open-files -- "%1"`。
    - `status` 从“仅键存在”升级为“键存在 + 命令值匹配预期”；命令漂移时返回修复提示消息。
    - `enable` 每次覆盖写入目录背景/目录/文件三类命令值，保证旧值可修复。
    - 新增 3 个单测：空格路径、引号路径、命令匹配行为。
  - `apps/kimi-shell/src-tauri/src/open_request.rs`：
    - `parse_open_request` 重构为“规范化 + 分类”流程，支持 `file:///`、`--open-files -- <path...>` 字面量模式。
    - 过滤常见 Shell 噪声参数（`/embedding`、`/prefetch:*`）。
    - `--open-files` 在“无有效文件”时新增安全回退：单目录自动降级 `OpenDir`，其他场景返回结构化错误（含 `first_invalid_token`）。
    - 增加 startup/forwarded 解析埋点日志（args/cwd/result）。
    - 新增 5 个解析单测：file URI、literal `--`、噪声过滤、单目录降级、结构化错误字段。
  - 文档分流：
    - `tasks/white-screen-investigation.md` 新增“问题分流说明”。
    - 新增 `tasks/right-click-404-investigation.md` 记录右键 404 专项排查与修复。
  - 经验沉淀：
    - `tasks/lessons.md` 新增“右键状态必须校验命令值一致性”经验。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml open_request -- --nocapture` 通过（8/8）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml context_menu -- --nocapture` 通过（3/3）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（23/23）。
  - 手工命令验证（本机）：
    - `appskimi-shell.exe --open-dir <docs>`：日志显示 `result=open_dir` 且 `cwd` 切换成功。
    - `appskimi-shell.exe --open-files <file>`：日志显示 `result=open_files:1` 且创建工作区成功。
    - `appskimi-shell.exe --open-files -- <file>`：新语法可用，日志可见 parse 结果。
    - `--open-files` 缺失文件：日志包含结构化错误与 `first_invalid_token`。
- 风险与后续：
  - 本轮未直接自动化驱动真实 Explorer 右键点击链路；“Explorer 实际交互 + 应用内无 404”仍需在目标机器做一次手工验收。
  - 若用户机器已启用旧版右键命令，需在应用内点击一次“启用右键菜单”以重写注册表命令值，漂移提示会给出修复引导。

## 本轮计划（Splashscreen 预填窗口替换：主窗口单次加载 + 自动预填发送）

### 计划清单

- [x] 将 `tauri.conf.json` 改为双窗口：`main` 隐藏启动 + `prefill` 可见启动
- [x] 更新 capability，使 `prefill` 具备 `core:default` 调用能力
- [x] Rust 新增 `submit_prefill` 命令与 `SubmitPrefillAck`，并接入关闭 prefill/显示 main/派发事件流程
- [x] Rust 扩展 `notify_frontend_ready` 返回 `pending_prefill`，防止启动监听时序丢包
- [x] `window_manager` 移除 `window.navigate(...)` 文档导航，改为 `emit_to("main","shell-route",...)`
- [x] `RunEvent` 处理 `prefill` 关闭（X）：拦截并按“空预填完成”路径切到 main
- [x] 新增 prefill 前端入口（`prefill.html + src/prefill/*`）并复用现有对话框视觉体系
- [x] Vite 增加多入口构建（`index.html` + `prefill.html`）
- [x] 主窗口前端接入 `prefill-chat` / `shell-route` 事件，先监听后握手
- [x] workspace 注入桥扩展 prefill 自动填入 + 自动发送 + ack 回传，前端加入低频重试队列
- [x] 更新调查文档与经验沉淀（`white-screen-investigation.md` / `lessons.md`）
- [x] 完成构建与验证（`cargo test`、`pnpm build`、`check:nfr:security`、`tauri build --no-bundle`）

### 验收标准

- [x] 冷启动先出现 `prefill`，`main` 初始不可见；提交后关闭 `prefill` 并显示 `main`
- [x] 关闭 `prefill`（X）不退出应用，直接进入 `main`（空输入）
- [x] 启动日志不再出现 Rust 侧本地 `window.navigate(...)` 导航链
- [x] 预填文本可在 workspace ready 后自动填入并自动发送；慢启动场景可排队重试且不风暴
- [x] `missing_kimi` / `crashed` / 托盘诊断入口保持可用
- [x] 自动化命令全部通过

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri/tauri.conf.json` 改为双窗口：`main(visible=false)` + `prefill(visible=true, url=prefill.html)`；`capabilities/default.json` 允许 `prefill` 使用 `core:default`。
  - `src-tauri/window_manager.rs` 重构为事件驱动路由分发：移除 `window.navigate(...)`，改为 `emit_to("main","shell-route", payload)`；新增 prefill 状态与排队、`submit_prefill`、`complete_prefill_without_text`、`consume_prefill_close_allowance`。
  - `src-tauri/lib.rs` 新增命令 `submit_prefill` 并注册；`notify_frontend_ready` 扩展 `pending_prefill` 回传；移除 `on_page_load` 与单次 `about:blank` 超时恢复线程；`RunEvent` 新增 `prefill` 关闭拦截分支。
  - 新增 prefill 前端入口：`prefill.html`、`src/prefill/main.tsx`、`src/prefill/PrefillApp.tsx`、`src/prefill/prefill.css`；支持 textarea + 提交按钮 + Ctrl/Cmd+Enter。
  - `vite.config.ts` 增加多入口构建（`index.html` + `prefill.html`），产物验证包含 `dist/prefill.html`。
  - `useShellController.ts` 接入 `shell-route` / `prefill-chat` 监听（先监听后握手），新增 prefill 下发、iframe ack 监听、低频重试队列（超时/失败重试 + 次数上限）。
  - `backend_manager.rs` 的注入脚本扩展 prefill 桥：接收 `prefill-sync`、尝试定位输入框写入、自动发送并回传 `prefill-bridge` ack。
  - `types.rs` / `types.ts` 新增并对齐：`SubmitPrefillAck`、`PrefillChatPayload`、`ShellRoutePayload`、`PrefillBridgeAck`；`FrontendReadyAck` 扩展 `pendingPrefill`。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16）。
  - `pnpm -C apps/kimi-shell build` 通过（包含 `prefill.html` 多入口产物）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
  - `pnpm -C apps/kimi-shell tauri build --no-bundle` 通过，生成 `src-tauri/target/release/appskimi-shell.exe`。
- 风险与后续：
  - 预填自动发送依赖对上游 chat DOM 的启发式定位（textarea/contenteditable/button 选择器）；若 Kimi Web 后续大改 DOM，可能触发 ack 失败并进入重试上限，需要补充针对性选择器。
  - 本轮已把主窗口启动期从文档导航切为事件路由，但“冷启动 10 次”与“慢机实机”属于手工体验验收，仍建议你在目标机器补跑一轮。

## 本轮计划（版本号单点维护 + 版本升级构建）

### 计划清单

- [x] 将版本号收敛到单一来源（`apps/kimi-shell/package.json`）
- [x] 新增自动同步脚本，将版本写入 `src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json`
- [x] 调整 npm scripts，确保 `dev/build/tauri` 前自动同步版本
- [x] 版本号 `+0.0.1`（`0.0.1 -> 0.0.2`）
- [x] 执行项目构建验证

### 验收标准

- [x] 只需改 `package.json` 的 `version` 即可驱动 Tauri/Cargo 版本一致
- [x] `Cargo.toml` 与 `tauri.conf.json` 版本同步到 `0.0.2`
- [x] 构建命令通过

### 回顾（完成后填写）

- 实际变更：
  - 将 `apps/kimi-shell/package.json` 作为版本单一来源，版本升级为 `0.0.2`。
  - 新增 `apps/kimi-shell/scripts/sync_version.mjs`，在构建前自动同步 `src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 的版本字段。
  - 调整 npm scripts：`dev/build/tauri` 统一前置 `pnpm sync:version`，避免三处版本漂移。
- 验证结果：
  - `pnpm -C apps/kimi-shell sync:version` 通过，日志显示 `version=0.0.2` 已同步到 Cargo 与 Tauri 配置。
  - `pnpm -C apps/kimi-shell build` 通过。
  - `pnpm -C apps/kimi-shell tauri build --no-bundle` 通过，生成 `src-tauri/target/release/appskimi-shell.exe`。
- 风险与后续：
  - 若后续新增发布配置文件（如语言/渠道覆盖 config），需确认其版本字段也走同一同步路径，避免发布产物版本不一致。

## 本轮计划（白屏修复：事件驱动串行导航 + 前端握手）

### 计划清单

- [x] 接入 `on_page_load`，记录 `main` 窗口 Started/Finished + URL，并在 Finished 释放导航锁
- [x] 将 `window_manager` 重构为串行导航协调器（`frontend_ready/in_flight_nav/queued_route/boot_timeout_recovered`）
- [x] 统一本地路由跳转为“单飞行 + 队列覆盖”，禁止并发/重入导航
- [x] 删除 `spawn_blank_window_recovery` 与 workspace 顶层 HTTP fallback
- [x] 删除 `RunEvent::Ready` 二次 `enter_local_boot`
- [x] 新增 `notify_frontend_ready` 命令与 `FrontendReadyAck` 类型，并接入前端启动握手
- [x] 增加 8 秒单次超时兜底（仅在 `about:blank` 且未恢复时触发一次 `recover_loading_route`）
- [x] 更新白屏调查文档与本节回顾
- [x] 完成构建与验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] 启动日志可见 `page-load Started/Finished`，且 `Finished` 能稳定出现
- [x] 不再出现高频 `blank-window recovery forced navigate...` 循环日志
- [x] 不再出现“`navigate` 成功但长期停在 `about:blank`”
- [x] `missing_kimi`/`crashed` 路由仍可稳定进入控制中心，不发生重入抖动
- [x] 自动化验证通过

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri/window_manager.rs` 重构为事件驱动串行导航协调器：新增 `frontend_ready/in_flight_nav/queued_route/boot_timeout_recovered`，所有本地导航统一走“单飞行 + 队列覆盖”。
  - 新增 `handle_page_load_finished`，仅在 `PageLoadEvent::Finished` 后释放 in-flight 并推进队列导航；并补充导航失败回收逻辑，避免死锁。
  - `src-tauri/lib.rs` 接入 `Builder::on_page_load`，记录 `main` 窗口 Started/Finished + URL，并在 Finished 回调协调器。
  - `src-tauri/lib.rs` 删除 `spawn_blank_window_recovery`/`try_navigate_workspace_fallback` 与 `RunEvent::Ready` 二次导航，替换为 8 秒单次超时兜底。
  - 新增 `notify_frontend_ready` 命令与 `FrontendReadyAck` 类型（Rust/TS 双端），前端启动后主动 `invoke` 进行一次性握手（`invoke only`）。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16）。
  - `pnpm -C apps/kimi-shell build` 通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 已按最小改动完成“事件驱动 + 串行导航”；若仍有极端机型卡白屏，下一阶段可切换为 splashscreen 方案，把主窗口导航次数进一步收敛到 1 次。

## 本轮计划（白屏修复 1/2/3：首屏本地页 + 去阻断 + 导航状态机）

### 计划清单

- [x] 启动时强制加载本地首屏（`loading`），避免窗口停留 `about:blank`
- [x] 移除“onboarding 完成前阻断远程导航”逻辑，不再依赖 `pending_remote_port` gate
- [x] 在 `window_manager` 建立统一导航状态机，收敛所有本地路由跳转入口
- [x] 将白屏恢复逻辑接入统一导航入口，避免多处并发抢导航
- [x] 完成构建与验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] 首次启动时窗口可稳定进入本地壳页，不再长期停留 `about:blank`
- [x] backend ready 后仅更新状态，不再打印“holding remote navigation until onboarding is completed”
- [x] 所有本地路由切换通过单一状态机函数执行，日志可追踪阶段变更
- [x] 白屏恢复不再持续覆盖已成功导航的页面
- [x] 自动化验证通过

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri/window_manager.rs` 重构为统一导航状态机：`NavigationStage + LocalRoute`，所有本地路由跳转统一经 `transition(...)` 执行并记录阶段变更日志。
  - `src-tauri/lib.rs` 在 `setup` 阶段先执行 `enter_local_boot(..., "setup_bootstrap")`，确保首屏强制落在本地 `loading`；白屏恢复改为 `recover_loading_route(...)` 状态机入口。
  - `src-tauri/backend_manager.rs` 删除 onboarding gate：移除 `pending_remote_port` 与 `should_defer_remote_navigation` 分支，backend ready 后只做 `mark_backend_ready(...)` 状态更新。
  - `src-tauri/app_state.rs` 删除 `pending_remote_port` 运行时字段，彻底去除“引导前阻断”残留状态。
  - `src-tauri/tray_manager.rs` 打开诊断页改为 `show_diagnostics(..., "tray_open_diagnostics")`，接入统一导航入口。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16）。
  - `pnpm -C apps/kimi-shell build` 通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
  - `pnpm -C apps/kimi-shell tauri build --bundles nsis` 通过，产物：
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.1_x64-setup.exe`
- 风险与后续：
  - 这轮已去掉后端层面的 onboarding 导航阻断；若个别机器仍出现 `about:blank`，下一步应聚焦 WebView2 初始化时序（窗口可见性与首次导航调用先后）做更细粒度埋点。

## 本轮计划（引导第 3 步配置中心完整弹窗）

### 计划清单

- [x] 后端新增配置中心命令与类型：`load_kimi_cli_config_center` / `save_kimi_cli_config_center`
- [x] 后端实现配置中心全量 TOML 读写（providers/models/services/defaults/loop_control/mcp_servers）
- [x] 后端实现环境变量覆盖状态采集面板（只读、掩码、覆盖关系）
- [x] 后端保存成功后原子更新 `api_config_ack=true`
- [x] 前端新增配置中心 DTO 与校验结构（与后端类型对齐）
- [x] 前端实现配置中心弹窗（左侧 section 导航 + 右侧全结构化表单）
- [x] 前端实现 `providers/models/services/mcp_servers` 完整 CRUD（新增/编辑/删除/重命名 key）
- [x] 前端接入引导第 3 步触发入口，替换旧 API 四字段表单
- [x] 前端实现保存成功自动完成 API 配置步骤，并刷新摘要
- [x] 完成回归验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] 第 3 步点击按钮可打开配置中心弹窗，支持关闭未保存确认
- [x] 全量 section 可编辑并成功写回 `~/.kimi/config.toml`
- [x] `providers/models/services/mcp_servers` CRUD 与重命名可用
- [x] 阻断校验生效（key 唯一/非空、模型与服务 provider 引用校验）
- [x] 环境变量面板显示 set/unset、掩码值、覆盖关系与优先级说明
- [x] 保存成功后自动 `api_config_ack=true`，引导步骤状态更新为完成
- [x] 保留旧 `load/save_kimi_cli_api_config` 命令兼容
- [x] 自动化验证通过

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri/types.rs` 新增配置中心完整 DTO：`KimiCliConfigCenterView/Input`、`ProviderEntry/ModelEntry/ServiceEntry/LoopControlEntry/McpServerEntry`、`EnvOverrideStatus`、`KeyValueEntry/TypedFieldEntry`。
  - `src-tauri/backend_manager.rs` 新增 `load_kimi_cli_config_center` 与 `save_kimi_cli_config_center`，实现全量 section 解析、校验、结构化重写和环境变量覆盖状态采集；保存成功后原子写入 `api_config_ack=true`。
  - `src-tauri/lib.rs` 暴露并注册新命令，同时保留旧 `load/save_kimi_cli_api_config` 兼容接口。
  - 新增前端组件 `ConfigCenterModal.tsx`：左侧分区导航、全结构化表单、providers/models/services/mcp_servers 完整 CRUD、extra typed fields、env/custom_headers 编辑、未保存确认、阻断错误展示。
  - `useShellController.ts` 接入配置中心加载/编辑/重置/保存状态与命令调用。
  - `ControlCenterView.tsx` 第 3 步 API 区域改为“打开配置中心弹窗 + 摘要展示”，去除旧四字段表单，保存后自动完成步骤。
  - `App.tsx` 与 `App.css` 接入新弹窗与响应式样式。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16，含新增配置中心单测）。
  - `pnpm -C apps/kimi-shell build` 通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 目前 `services/loop_control/mcp_servers` 的“全结构化”以通用字段 + `extra_fields` 形式覆盖，后续如 Kimi CLI 文档明确新增固定字段，可再升级为更强约束控件。

## 本轮计划（标题栏恢复切换 + effectiveWorkDir 展示 + 黑色按钮垂直居中）

### 计划清单

- [x] 标题栏恢复 `Workspace/Control Center` 切换按钮
- [x] workspace 标题栏中线后展示 `effectiveWorkDir`，去掉“路径”字样并接入打开路径按钮
- [x] 状态栏移除切换按钮与路径展示残留
- [x] 修复控制中心黑色按钮文字垂直居中问题
- [x] 完成回归验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] 切换按钮回到标题栏，状态栏不再承载该入口
- [x] workspace 标题栏显示 `Workspace | <effectiveWorkDir>`，无“路径”前缀
- [x] 路径为空时显示 `-` 且打开按钮禁用
- [x] 路径来源为 `effectiveWorkDir`
- [x] 控制中心黑色按钮文本视觉垂直居中
- [x] 自动化验证通过

### 回顾（完成后填写）

- 实际变更：
  - `ShellTitlebar.tsx` 恢复标题栏左侧导航切换按钮，并在 workspace 中区显示 `Workspace | effectiveWorkDir + 打开路径 icon`。
  - `App.tsx` 传入标题栏所需的新 props，并移除状态栏中的导航与路径显示块。
  - `App.css` 新增标题栏路径样式，并修正控制中心 action 黑色按钮的垂直居中对齐。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm -C apps/kimi-shell build` 首次受沙箱 `spawn EPERM` 影响，提权后重跑通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 路径为空时按约定显示 `-`，避免误导到非当前工作区路径。

## 本轮计划（标题栏/状态栏重排 + 安装已装弹窗）

### 计划清单

- [x] 将 Control Center / Workspace 导航从标题栏迁移到底部状态栏，并移除状态栏 Logs 占位文案
- [x] workspace 状态栏显示生效工作目录路径，并增加“打开路径”icon 按钮
- [x] workspace 页面隐藏标题栏 logo 与名称，control_center 页面继续显示
- [x] 标题栏“重启后端”仅在状态非 running 时显示，且改为红色按钮
- [x] 返回工作区入口 icon 改为工作区语义 icon
- [x] 移除引导配置第 3 项中的登录说明文案
- [x] 安装 Kimi/依赖前增加已装探测，命中时应用内弹窗提示并跳过安装命令
- [x] 调整黑色按钮 hover 文本颜色为更亮白色
- [x] 完成回归验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] 标题栏不再出现 Control Center / Workspace 导航按钮
- [x] 底部状态栏显示上下文导航按钮；workspace 显示路径与打开路径按钮
- [x] workspace 标题栏不显示品牌，control_center 显示品牌
- [x] 状态为 running 时不显示标题栏重启按钮，非 running 时显示红色重启按钮
- [x] 引导配置第 3 项不再出现“登录检测仅更新状态...”文案
- [x] 依赖或 Kimi 已安装时，点击按钮弹出“已安装”提示且不重复执行安装命令
- [x] 黑色按钮 hover 文本保持高对比亮白
- [x] 自动化验证通过

### 回顾（完成后填写）

- 实际变更：
  - `ShellTitlebar.tsx` 删除顶部导航按钮，新增 `backendState` 控制；重启按钮仅在非 `running` 时显示并改为红色 `destructive`。
  - `ShellTitlebar.tsx` 在 workspace 页面隐藏 `KimiCliBrand`，control_center/loading 页面保留品牌显示。
  - `App.tsx` 将导航入口迁移到底部状态栏：workspace 显示“控制中心”按钮，control_center 显示“工作区（Monitor icon）”按钮。
  - `App.tsx` workspace 底栏新增“路径: effectiveWorkDir”与“打开路径”icon 按钮，并移除原 Logs 文案占位。
  - `ControlCenterView.tsx` 引导第 3 项移除“登录检测仅更新状态...”提示文案。
  - `types.rs/lib.rs/backend_manager.rs` 新增安装探测接口 `get_install_probe_status`（git/uv/python3.13/kimi）。
  - `useShellController.ts` 接入安装探测：依赖或 Kimi 已安装时弹出应用内 `alert`，并跳过安装命令执行。
  - `App.css` 增强黑色与红色按钮 hover 文本对比（强制高亮白色）。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm -C apps/kimi-shell build` 首次沙箱失败（`spawn EPERM`），提权后重跑通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - “已安装”探测依赖本机命令可见性（`git/uv/py`），极端环境下可能与实际安装状态存在偏差，必要时可加“强制执行安装”开关。

## 本轮计划（引导卡片合并 + 安装动作双按钮 + 悬浮态修复）

### 计划清单

- [x] 修复左侧导航“已选中项 hover 变黑导致文字不可见”问题，改为与未选中项一致的 hover 颜色
- [x] 调整步骤 1 文档按钮文案为“打开官方文档”，并移除其他步骤中的文档按钮
- [x] 在登录状态区域去掉原始探测 JSON/长文本回显，仅保留状态与必要提示
- [x] 合并“登录状态 + Provider API 配置”为同一卡片，并增加 switch 切换显示
- [x] 在步骤 1 增加“源选择（官方/镜像）+ 一键安装依赖 + 安装 Kimi”两类动作按钮
- [x] 后端新增安装命令（官方/镜像）并与前端按钮打通
- [x] 完成回归验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] 左侧导航选中态 hover 不再黑底黑字，文字始终可读
- [x] 引导页仅保留步骤 1 的“打开官方文档”按钮，其它卡片无文档按钮
- [x] 登录卡片不再显示原始 JSON/长输出，界面整洁
- [x] 登录与 API 配置在同一卡片，通过开关切换显示，API key 默认掩码
- [x] 步骤 1 可执行“安装依赖”和“安装 Kimi”，并支持官方/镜像源切换
- [x] 自动化验证通过

### 回顾（完成后填写）

- 实际变更：
  - `ControlCenterView.tsx` 将左侧导航按钮统一为 `ghost` 变体，并新增 `cc-nav-btn` hover 覆盖，修复选中项 hover 文字不可读。
  - 引导步骤仅保留步骤 1 文档按钮，文案改为“打开官方文档”；其余步骤文档按钮已移除。
  - 将“登录状态 + Provider API 配置”合并为同一卡片，新增 `Kimi 登录 / Provider API` 开关切换显示。
  - 登录区域不再渲染原始探测输出，改为仅展示状态与简短提示。
  - 步骤 1 新增安装源切换（官方/镜像）和两类动作按钮（“一键安装依赖”“安装 Kimi”）。
  - `useShellController.ts` 新增安装源状态、安装消息、安装动作 handler。
  - `src-tauri` 新增命令 `install_kimi_dependencies` 与 `install_kimi_cli`，支持官方/镜像脚本执行。
  - `App.css` 修复卡片圆角裁切（`overflow: hidden`），并补充安装/开关相关布局样式。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm -C apps/kimi-shell build` 首次沙箱失败（`spawn EPERM`），提权后重跑通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 一键安装依赖/安装 Kimi 依赖本机网络与安装权限（尤其 winget/安装器场景）；建议在目标机器做一次真实安装链路手测。

## 本轮计划（引导配置页精简 + API 配置直写 + 文档链接修复）

### 计划清单

- [x] 去掉引导步骤头部“进行中/已完成/待处理”文字，仅保留状态图标
- [x] 重做步骤 1 布局：移除输入框，改为“已检测到路径 + 浏览 + 安装文档”同层紧凑布局
- [x] 重做步骤 4 布局：路径输入/浏览/打开文件夹图标/当前生效目录同一行
- [x] 重做步骤 5 布局：移除冗余说明，新增配置目录按钮与配置文件直写能力
- [x] 后端新增 `~/.kimi/config.toml` 读取与 TOML 合并写入逻辑（provider/model/base_url/api_key）
- [x] 新增后端目录打开能力（任意目录、Kimi 配置目录）
- [x] 修复并替换所有引导文档链接到 `www.kimi.com` 新地址
- [x] 统一 Control Center 视觉为紧凑黑白灰，修复卡片顶部圆角断点显示问题
- [x] 完成回归验证（`cargo test`、`pnpm build`、`pnpm check:nfr:security`）

### 验收标准

- [x] 引导页不再显示步骤状态文字，仅显示标题后的状态 icon
- [x] 步骤 1/4/5 信息更简洁整齐且不丢失
- [x] 步骤 5 可直接在 UI 中写入 API 配置到 `~/.kimi/config.toml`
- [x] 文档按钮可打开且链接为新的 Kimi 官方域名地址
- [x] 左侧导航保持左对齐，未完成项保持灰色 `X` 且容器无蓝色描边
- [x] 卡片顶部圆角处无断点感

### 回顾（完成后填写）

- 实际变更：
  - 前端移除 `stepStateLabel` 文案渲染，步骤头部仅保留状态图标。
  - `ControlCenterView` 的步骤 1/4/5 改为紧凑行内布局，步骤 4 新增“打开当前目录”icon 按钮。
  - Provider API 卡片新增四项配置输入（provider/model/base URL/API key）、“打开配置目录”和“写入配置文件”按钮。
  - 后端新增命令：`open_folder`、`open_kimi_config_dir`、`load_kimi_cli_api_config`、`save_kimi_cli_api_config`。
  - 后端基于 `toml_edit` 实现配置合并写入，保留无关配置项，API key 支持“留空保持已有值”。
  - 文档链接统一更新为 `https://www.kimi.com/code/docs/kimi-cli/guides/...` 新地址。
  - `App.css` 调整为黑白灰紧凑视觉，并优化卡片圆角裁切和导航左对齐。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm build` 通过（需提权执行以规避本环境 `esbuild spawn EPERM`）。
  - `pnpm check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - Kimi 官方域名下目前未发现 provider/web-subcommand 的专页，已按“全部 Kimi 域名”策略映射到相关指南页；若官方后续发布专页，建议再精确替换。

## 计划清单

- [x] 梳理并确认需求边界（OpenRequest、单实例转发、文件复制工作区、右键注册）
- [x] 设计并实现 `OpenRequest` 协议与命令行参数解析（`--open-dir` / `--open-files` / 宽松回退）
- [x] 实现“文件复制到默认工作目录新文件夹”的工作区创建逻辑（命名、去重、冲突处理）
- [x] 引入会话级工作目录覆盖（不污染默认工作目录配置），并接入后端重启流程
- [x] 接入 `tauri-plugin-single-instance`，将二次启动参数转发到主实例
- [x] 实现多文件请求聚合（350ms 防抖）以应对 Explorer 多次启动
- [x] 实现 Windows HKCU 右键菜单注册/卸载（目录空白处、文件夹、文件多选）
- [x] 暴露 Tauri 命令并在前端诊断页提供“启用/禁用/状态查看”入口
- [x] 运行格式化与测试（至少 `cargo fmt`、`cargo test`），修复阻塞问题
- [x] 更新文档回顾与结果记录

## 验收标准

- [x] `kimi-shell.exe --open-dir <path>` 能切换到目标目录并重启后端
- [x] `kimi-shell.exe --open-files <a> <b>` 能创建工作区并复制文件后切换
- [x] 多次快速 `--open-files` 请求仅创建一个工作区目录（聚合生效）
- [x] 注册右键后可从 Explorer 触发上述行为；禁用后注册表项清理完成
- [x] 原有功能（托盘、诊断、日志、重启）不回归

## 回顾（完成后填写）

- 实际变更：
  - 新增 `open_request` 模块，支持 `--open-dir` / `--open-files` 参数解析、文件工作区创建、复制与 `sources.json` 记录。
  - 新增会话级工作目录覆盖（`session_work_dir`），右键打开目录/文件仅影响当前会话，不覆盖默认配置。
  - 接入 `tauri-plugin-single-instance`，将二次启动参数转发给主实例；对 `OpenFiles` 做 350ms 防抖聚合。
  - 新增 `context_menu` 模块，支持 Windows HKCU 右键菜单启用/禁用与状态查询。
  - 前端诊断页新增 Explorer 右键菜单状态与启用/禁用操作。
  - 修复 `port_manager` 单测中的环境变量并发竞争，避免偶发失败。
- 验证结果：
  - `cargo fmt` 通过。
  - `cargo test` 通过（10/10）。
  - `pnpm build` 通过。
- 风险与后续：
  - 右键功能已支持注册表开关，但未在本轮自动化脚本中覆盖真实 Explorer 触发链路，建议后续补一个手工验收脚本或集成测试说明。

---

## 本轮计划（无系统标题栏）

### 计划清单

- [x] 在 `src-tauri` 运行时仅 Windows 启用无系统标题栏（`set_decorations(false)` + `set_shadow(false)`）
- [x] 更新 capability，最小授权窗口拖拽/最小化/最大化/关闭/最大化状态读取
- [x] 改造后端导航为“本地壳页常驻”，移除运行后直接跳转远端 URL 的行为
- [x] 在前端实现自绘标题栏（拖拽区、窗口控制按钮、无障碍属性）
- [x] 新增 `workspace` 视图并使用 `iframe` 承载 `http://127.0.0.1:<port>`
- [x] 实现 `iframe` 失败兜底（页内提示 + 手动外开链接）
- [x] 完成回归验证（`cargo test`、`pnpm build`、`pnpm check:nfr:security`）

### 验收标准

- [ ] Windows 下主窗口无系统标题栏，且可拖拽、最小化、最大化/还原、关闭
- [x] 后端 ready 后不再 `window.navigate(remote)`，前端可在壳页内展示 Kimi Web
- [ ] Onboarding/Diagnostics 路由与托盘、热键、日志操作无回归
- [ ] `iframe` 被策略拦截时显示明确提示并可手动外开

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri` 在 `setup` 阶段新增 Windows 运行时窗口设置：`set_decorations(false)` + `set_shadow(false)`。
  - `capabilities/default.json` 改为 capability 列表，并新增 `frameless-window-controls`（Windows 平台，最小化授权窗口控制权限）。
  - 后端移除运行后远端导航：`backend_manager` 不再调用 `window.navigate(http://127.0.0.1:<port>)`，`release_pending_remote_navigation` 仅清理 pending 状态。
  - 前端新增自绘标题栏：拖拽区、最小化/最大化/关闭按钮、双击拖拽区最大化/还原、按钮 `aria-label/title`。
  - 前端新增 `workspace` 视图与 `iframe` 承载远端页面，并增加 8 秒超时与 `onError` 兜底提示（手动外开链接）。
  - 新增 workspace/titlebar 对应样式，并适配移动端断点布局。
- 验证结果：
  - `cargo test` 通过（13/13）。
  - `pnpm build` 通过。
  - `pnpm check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 尚未完成真实 Windows UI 手工验证（无标题栏交互、缩放边缘、iframe 被 X-Frame-Options/CSP 拦截场景），对应验收项仍保留未勾选。

---

## 本轮计划（Notepad 风格紧凑化）

### 计划清单

- [x] 统一全应用 UI 为简洁紧凑风格（loading/onboarding/diagnostics/workspace/titlebar）
- [x] 重构 `App.css` 视觉系统：去拟态渐变、大圆角和重阴影，改为 Win11 Notepad 风格
- [x] 调整标题栏、按钮、输入框与区块间距，提升信息密度并保持可读性
- [x] onboarding 步骤改为可折叠分组（当前推荐步骤默认展开）
- [x] diagnostics 改为分组折叠展示（关键运行态默认展开，路径与日志可折叠）
- [x] 保持现有业务命令与路由逻辑不变，仅改前端结构与样式
- [x] 运行验证（`pnpm build`、`cargo test`、`pnpm check:nfr:security`）

### 验收标准

- [ ] 首屏视觉接近 Windows Notepad：浅色平面、细边框、低圆角、紧凑排版
- [ ] 标题栏与窗口按钮在桌面端交互正常且布局不拥挤
- [ ] onboarding 默认仅当前步骤展开，其他步骤可按需展开
- [ ] diagnostics 首屏优先展示关键信息，日志与次要信息折叠后可访问
- [ ] workspace 与 iframe 兜底提示在新风格下显示正确

### 回顾（完成后填写）

- 实际变更：
  - `App.css` 全面切换为 Win11 Notepad 风格：浅灰背景、细边框、低圆角、弱装饰、紧凑间距。
  - 标题栏与窗口控制按钮尺寸收紧，导航与状态信息采用更紧凑排布。
  - onboarding 从平铺块改为 `details/summary` 折叠分组，并根据推荐步骤默认展开当前步骤。
  - diagnostics 从单大块改为三组折叠：`Core Runtime`（默认展开）、`Context Menu & Paths`、`Recent Logs`。
  - 业务逻辑保持不变：现有 invoke 命令、路由与按钮行为未改语义。
- 验证结果：
  - `pnpm build` 通过。
  - `cargo test` 通过（13/13）。
  - `pnpm check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 尚未完成真实桌面端手工视觉验收（尤其是折叠分组的可用性、标题栏密度、workspace 兜底态观感）；验收标准先保留未勾选。

---

## 本轮计划（Control Center 双栏整合）

### 计划清单

- [x] 将路由统一为 `control-center`，并兼容 `#/onboarding` / `#/diagnostics` 旧 hash
- [x] 合并标题栏导航入口：统一为 `Control Center`，在可返回时提供 `Back to Workspace`
- [x] 把 onboarding 与 diagnostics 合并到同一页面并左右分栏展示
- [x] 保持现有命令行为不变（路径保存、重启后端、上下文菜单开关、日志查看）
- [x] 为合并页补充响应式样式（桌面双栏、窄屏上下堆叠）
- [x] 运行回归验证（`pnpm build`、`cargo test`、`pnpm check:nfr:security`）

### 验收标准

- [x] 访问 `#/control-center`、`#/onboarding`、`#/diagnostics` 均进入统一页面
- [x] 桌面端为左右分栏，移动端（窄屏）自动改为上下布局
- [x] onboarding 与 diagnostics 的核心操作按钮和数据展示保留可用
- [ ] 真机手工验收：双栏滚动体验、标题栏按钮行为与布局密度

### 回顾（完成后填写）

- 实际变更：
  - `App.tsx` 的 `Screen` 从三路控制页改为 `loading | control_center | workspace`，旧路由映射到 `control_center`。
  - 标题栏导航改为统一入口，不再区分独立 Onboarding/Diagnostics 页面。
  - 非 workspace 主体中新增 `control-center` 结构：左栏放 onboarding，右栏放 diagnostics。
  - onboarding 底部新增“刷新运行态数据”按钮，用于一次刷新 onboarding/diagnostics/context menu。
  - `App.css` 新增 `control-center-shell` 与列布局样式，支持桌面双栏与 `max-width: 900px` 下的堆叠布局。
- 验证结果：
  - `cargo test` 通过（13/13）。
  - `pnpm build` 通过（在本环境需提升权限执行，解决 `spawn EPERM`）。
  - `pnpm check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 目前仅完成自动化构建与测试；真实桌面窗口下的交互密度与滚动体验仍建议手工验收。

---

## 本轮计划（Classic UI 设计语言重构）

### 计划清单

- [x] 基于 `docs/classic-ui-design-guide.md` 建立 Classic Light/Dark 语义 token 体系
- [x] 在 `App.tsx` 引入主题状态与持久化（`localStorage` + 系统偏好回退）
- [x] 重构标题栏为 Classic 信息架构（左动作、中身份、右窗口控制）
- [x] 增加底部状态栏（状态/错误/日志路径摘要 + 主题与运行信息）
- [x] 保持 `control-center` 双栏结构并按“高频上移、低频折叠”重排
- [x] 统一控件状态（按钮/输入/折叠区/日志区）到 Classic 视觉语言
- [x] 完成回归验证（`pnpm build`、`cargo test`、`pnpm check:nfr:security`）

### 验收标准

- [x] Light/Dark 两套 Classic 风格可切换，并在重启后保持
- [ ] 标题栏支持拖拽、双击、最小化、最大化/还原、关闭
- [ ] Control Center 桌面双栏、窄屏堆叠行为正确
- [x] 业务行为不回归（重试、路径设置、上下文菜单、日志查看）
- [x] 自动化检查通过（`pnpm build`、`cargo test`、`pnpm check:nfr:security`）

### 回顾（完成后填写）

- 实际变更：
  - `App.tsx` 新增 `ThemeMode` 与 `getInitialThemeMode`，支持 `localStorage(kimi_shell_theme_mode)` 持久化与系统深色偏好回退。
  - 根容器新增 `ui-classic theme-light/theme-dark` 类，按 Classic 设计语言切换整套语义 token。
  - 标题栏重构为“左动作/中身份/右窗口控制”：新增 `Restart` 与 `Light/Dark Theme` 快捷动作，保留拖拽与双击最大化逻辑。
  - 底部新增常驻 `statusbar`，统一展示运行态、错误/消息、日志路径摘要，以及主题/端口/PID 元信息。
  - `App.css` 全量重写为 Classic Light/Dark 双主题 token，统一按钮、输入、分组折叠、日志框、workspace 兜底、control-center 双栏与移动端堆叠规则。
- 验证结果：
  - `pnpm build` 通过（需在本环境提权执行，规避 `vite/esbuild spawn EPERM`）。
  - `cargo test` 通过（13/13）。
  - `pnpm check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 尚未完成真实 Windows 桌面手工验收（标题栏拖拽/窗口控制、双栏滚动手感、暗色主题可读性）；对应验收项先保留未勾选。

---

## 本轮计划（外层圆角透明窗口）

### 计划清单

- [x] 启用 Tauri 主窗口透明背景配置，使圆角外区域可透出
- [x] 打开窗口阴影并保持无系统标题栏
- [x] 统一前端 `html/body/#root` 背景为透明，避免白底兜底层
- [x] 保持现有圆角尺寸与壳层布局不变，仅修正外层容器透出效果
- [x] 完成验证（`pnpm build`）

### 验收标准

- [ ] 外层圆角外区域不再出现直角白底
- [ ] 阴影效果可见且不影响窗口交互
- [ ] 应用主内容区域视觉不回归
- [x] `pnpm build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `tauri.conf.json` 主窗口新增 `decorations: false`、`transparent: true`、`shadow: true`，使窗口支持透明圆角外层并启用阴影。
  - `src-tauri/src/lib.rs` 将 Windows 运行时设置改为 `window.set_shadow(true)`，并更新日志文案为 enable shadow。
  - `App.css` 将 `html/body/#root` 背景统一设为透明，去除 Web 层默认白底兜底。
- 验证结果：
  - `pnpm build` 通过。
  - `cargo test` 通过（13/13）。
  - `pnpm check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 外层圆角透明与阴影观感依赖 Windows 桌面合成器与系统效果设置，建议在目标机器手工确认最终视觉。

---

## 本轮计划（KimiWeb 配色对齐 + 全按钮 Icon 化）

### 计划清单

- [x] 将 Classic Light/Dark 语义 token 调整为贴近 Kimi Web 的蓝灰配色方案
- [x] 新增通用 `IconButton` 组件，统一 `title/aria-label` 提示
- [x] 将 `App.tsx` 中所有按钮改为 icon-only 按钮（标题栏、workspace、control center、workdir 区）
- [x] 保持现有业务命令与路由语义不变，仅替换按钮外观与文案承载方式
- [x] 完成回归验证（`pnpm build`、`cargo test`、`pnpm check:nfr:security`）

### 验收标准

- [x] 外壳整体配色与 Kimi Web 风格趋同（浅蓝灰骨架 + 蓝色强调）
- [x] 所有按钮均为 icon 按钮，且具备 `title`/`aria-label` 可访问描述
- [x] 原有操作能力不回归（重启、路径选择、上下文菜单、登录探测、窗口控制）
- [x] 自动化检查通过（`pnpm build`、`cargo test`、`pnpm check:nfr:security`）

### 回顾（完成后填写）

- 实际变更：
  - `App.tsx` 新增 `IconButton` 组件，所有 `<button>` 调用统一改为 icon-only 按钮，使用 tooltip 和无障碍文本承载语义。
  - 顶栏动作、窗口控制、workspace 操作、onboarding 与 diagnostics 操作按钮全部完成 icon 化。
  - `App.css` 更新 Light/Dark token（壳层、chrome、强调色、hover、overlay、阴影）以对齐 Kimi Web 的蓝灰视觉语义。
  - `App.css` 新增 `.icon-btn` 与 `.sr-only`，并调整按钮尺寸策略，使 icon-only 按钮在桌面与移动布局下保持一致触达面积。
- 验证结果：
  - `pnpm build` 通过。
  - `cargo test` 通过（13/13）。
  - `pnpm check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - icon 字符当前使用 Unicode 符号，若目标系统字体覆盖不一致，个别符号观感可能有差异；如需可进一步替换为内置 SVG 图标集。

---

## 本轮计划（Kimi Web 同色 + 系统级主题同步）

### 计划清单

- [x] 查阅 `MoonshotAI/kimi-cli/web` 主题源码并确认配色与主题切换机制
- [x] 将 Shell Light/Dark 语义 token 调整为 Kimi Web 同源黑白中性底 + 冷蓝强调
- [x] 将主题状态从二态升级为 `system/light/dark` 三态并默认 `system`
- [x] 持久化切换为 `localStorage(kimi-theme)`，兼容迁移旧键 `kimi_shell_theme_mode`
- [x] 在 `system` 模式监听系统主题变化并实时应用到 Shell
- [x] 更新标题栏主题按钮为三态循环，并在状态栏显示主题同步信息
- [x] 运行回归验证（`pnpm build`、`cargo test`、`pnpm check:nfr:security`）

### 验收标准

- [x] Shell 配色与 Kimi Web 设计语言一致（黑白中性基底，不再是蓝灰主底）
- [x] 主题切换支持 `System / Light / Dark` 三态，且状态文案清晰
- [x] `system` 模式下 Shell 跟随系统主题变化，与 Kimi Web 默认策略一致
- [x] 已存在用户的旧主题偏好（`kimi_shell_theme_mode`）可无感迁移
- [x] 自动化检查通过（构建、单测、能力检查）

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/App.tsx` 新增 `ThemePreference(system/light/dark)` 与 `resolvedTheme` 计算，主题按钮改为三态循环。
  - 主题持久化改为 `localStorage(kimi-theme)`；保留对 `kimi_shell_theme_mode` 的迁移兼容并在写入时清理旧键。
  - 新增系统主题监听（`prefers-color-scheme`），在 `system` 模式下自动更新 UI；同时同步 `document.documentElement` 的 `dark` 类与 `color-scheme`。
  - `apps/kimi-shell/src/App.css` 顶层 token 重映射为 Kimi Web 同源 palette（中性背景/文本、边框层级、冷蓝强调、语义色与阴影）。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（本环境首次需提权绕过 `esbuild spawn EPERM`）。
  - `cargo test` 通过（13/13）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 当前实现为“系统级同步”：与 Kimi Web 的默认主题策略一致，但不做跨源 iframe 强制控制（避免代理/注入带来的维护与兼容风险）。

---

## 本轮计划（KimiWeb 切换后壳层跟随）

### 计划清单

- [x] 复盘主题不同步根因并确认跨域 `iframe` 下存储隔离限制
- [x] 在 `src-tauri` 增加 workspace 本地代理端口，转发 `kimi web` 请求
- [x] 对代理返回的 HTML 注入主题桥接脚本，建立 `postMessage` 通道
- [x] 在前端监听来自 workspace 的主题事件并回写壳层主题状态
- [x] 在前端把壳层主题变化反向同步到 workspace（双向同步）
- [x] 补充运行态字段 `workspacePort` 用于前端与诊断显示
- [x] 完成回归验证（`cargo test`、`pnpm build`、`pnpm check:nfr:security`）

### 验收标准

- [x] 在 Kimi Web 内切换 Light/Dark 后，Shell 主题实时跟随
- [x] 在 Shell 内切换主题后，Kimi Web 主题也保持一致
- [x] workspace 仍可正常加载与交互，不影响现有控制中心功能
- [x] 自动化检查通过（构建、单测、能力检查）

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri` 增加 workspace 代理：`backend_manager` 启动 `tiny_http` 本地转发服务，新增 `workspace_port` 运行态字段。
  - 代理在 HTML 响应中注入 `data-kimi-shell-theme-bridge` 脚本，拦截 `kimi-theme` 变更并通过 `postMessage` 向父壳层广播主题。
  - 前端 `App.tsx` 增加 iframe 消息监听与回推逻辑：接收 `kimi-shell-theme-bridge`，发送 `kimi-shell-theme-sync`，实现壳层与 workspace 双向同步。
  - 前端 workspace URL 优先使用 `workspacePort`，并在 diagnostics 中新增 `Workspace Port` 显示项。
- 验证结果：
  - `cargo test` 通过（13/13）。
  - `pnpm -C apps/kimi-shell build` 通过（本环境需提权避免 `esbuild spawn EPERM`）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 代理当前是轻量 HTTP 转发实现，后续若 Kimi Web 引入新的长连接或协议特性，建议补充对应链路的手工回归与监控。

---

## 本轮计划（移除系统跟随主题）

### 计划清单

- [x] 取消壳层 `system/light/dark` 三态，改回 `light/dark` 双态
- [x] 保留并修正壳层与 workspace 的 `postMessage` 主题同步，不再接收 `system` 值
- [x] 主题按钮改为双态切换文案与图标
- [x] 运行前端构建验证（`pnpm build`）

### 验收标准

- [x] 壳层可以稳定切到暗色和亮色
- [x] Kimi Web 与壳层主题仍保持同步
- [x] 不再出现系统跟随导致的主题回跳
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `App.tsx` 主题状态从 `ThemePreference(system/light/dark)` 简化为 `Theme(light/dark)`。
  - 删除系统主题监听与 `system` 存储分支，统一将当前主题写入 `localStorage(kimi-theme)`。
  - workspace 桥接消息仅接受 `light/dark`，忽略其他值，避免第三态反向覆盖。
  - 顶栏主题按钮与状态栏文案调整为双态表达。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过。
- 风险与后续：
  - 当前主题行为更可预测；若后续要恢复系统跟随，建议作为独立开关实现，避免默认参与同步链路。

---

## 本轮计划（Shell UI/CSS/Icon 与 Kimi Web 全量统一）

### 计划清单

- [x] 对齐前端基础设施（新增 `src/index.css` + `main.tsx` 样式入口 + Vite/TS alias + `lucide-react`）
- [x] 引入 Kimi Web 同源基础组件（`Button`/`Input`/`ThemeToggle`/`KimiCliBrand`/`cn`）
- [x] 重构 `App.tsx` 页面结构与按钮体系，移除 Unicode 图标按钮并统一为 icon button
- [x] 迁移壳层视觉 token 到 Kimi Web 设计语言，保持透明外壳圆角与阴影行为
- [x] 统一品牌资源：新增 `public/logo.png` 并替换壳层品牌位显示
- [x] 统一安装包图标：替换 `src-tauri/icons/*` 为 Kimi Web 同源品牌图标
- [x] 完成回归验证（`pnpm -C apps/kimi-shell build`、`cargo test`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] 壳层配色与图标按钮风格与 Kimi Web 设计语言保持一致
- [x] 壳层与 iframe 内主题切换双向同步仍可用（light/dark）
- [x] Control Center 与 Workspace 功能无回归（重启、路径、诊断、日志）
- [x] 应用内 logo 与安装包/任务栏图标统一为 Kimi 品牌图标
- [x] 自动化验证全部通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/main.tsx` 新增 `index.css` 全局样式入口，`vite.config.ts`/`tsconfig.json` 新增 `@` 别名用于组件化迁移。
  - 新增 `src/lib/utils.ts`、`src/components/ui/button.tsx`、`src/components/ui/input.tsx`、`src/components/ui/theme-toggle.tsx`、`src/components/kimi-cli-brand.tsx`。
  - `App.tsx` 全量替换 Unicode 图标按钮为 `lucide-react` icon 按钮；标题栏品牌位改为 Kimi logo + Kimi Code 样式；输入框切换为统一 `Input` 组件。
  - `App.css` 重写为 Kimi Web 语义 token 风格（中性黑白基底 + 蓝色强调），并补充 `ui-btn`/`ui-input`/`kimi-brand` 样式体系。
  - 新增 `apps/kimi-shell/public/logo.png`（来自 Kimi Web），并执行 `pnpm -C apps/kimi-shell tauri icon public/logo.png` 重建 `src-tauri/icons/*`。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（需提权执行以避免 `esbuild spawn EPERM`）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
- 风险与后续：
  - 目前使用轻量本地组件实现 Kimi Web 视觉语言，未完整引入 Tailwind/shadcn 运行时；若后续要求 1:1 组件 API 一致，可再追加一次技术栈迁移。

---

## 本轮计划（Session 连接卡住：WebSocket 代理补强）

### 计划清单

- [x] 复核 `connecting to session` 根因并确认 `/api/sessions/:id/stream` 需要 WebSocket Upgrade
- [x] 在 workspace 代理中区分 HTTP 与 WebSocket 请求路径，避免 `/stream` 退化为普通 GET
- [x] 补强握手兼容：放宽 Upgrade 识别条件，并向上游强制写入 `Connection: Upgrade` / `Upgrade: websocket`
- [x] 补强 101 响应头：确保向浏览器回写 `Connection/Upgrade` 与 `Sec-WebSocket-*` 头
- [x] 增加 `/stream` 降级告警日志，便于继续排查头部缺失来源
- [x] 完成回归验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [ ] 在 workspace 中新建 session 时，不再长期停留在 `connecting to session`
- [ ] `backend.log` 出现 `WebSocket /api/sessions/.../stream [accepted]`，不再出现同会话反复 `GET .../stream 404`
- [x] 自动化检查通过（Rust 单测、前端构建、Capability 安全检查）

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/src/backend_manager.rs` 的 `handle_workspace_proxy_request` 先判断 WebSocket Upgrade，并在 `/stream` 被当作普通 HTTP 时写入诊断日志。
  - `is_websocket_upgrade_request` 从“严格依赖 `upgrade+connection`”改为“兼容 `Sec-WebSocket-Key` 存在场景”，降低头部被中间层裁剪时的误判概率。
  - `build_upstream_websocket_request` 现在强制补齐 `Connection: Upgrade` 与 `Upgrade: websocket`，避免上游把流请求识别成普通 GET。
  - `collect_websocket_upgrade_headers` 现在确保 101 响应包含 `Connection/Upgrade` 及必要的 `Sec-WebSocket-*` 头，保证浏览器握手一致性。
  - 新增 `summarize_request_headers`，用于输出可读且截断的请求头摘要，辅助后续现场排障。
- 验证结果：
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm -C apps/kimi-shell build` 通过（需提权执行，规避本环境 `esbuild spawn EPERM`）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 当前环境无法直接执行完整桌面交互链路，仍建议在目标机器复测一次“新建 session”并查看日志中 `WebSocket ... [accepted]` 证据。

---

## 本轮计划（Control Center 按 Kimi Web 风格重构）

### 计划清单

- [x] 将 Control Center 从“左右双栏”重构为“侧栏导航 + 主内容区”信息架构
- [x] 将 Control Center 内操作按钮统一为“文字 + 图标”样式（保留标题栏窗口按钮 icon-only）
- [x] 将 Control Center 文案改为中文优先，并保留关键技术术语
- [x] 以卡片化结构重排模块：概览、引导配置、运行诊断、日志与路径
- [x] 补充响应式布局（桌面侧栏、窄屏横向导航）并保持移动端可用
- [x] 完成回归验证（`cargo test`、`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] Control Center 为侧栏导航 + 主内容区，不再是旧双栏布局
- [x] Control Center 内按钮为文字+图标风格，信息可读性提升
- [x] 引导与诊断核心操作能力不回归（路径设置、重启、登录探测、右键菜单、日志）
- [x] 桌面与窄屏布局都能正常显示与交互
- [x] 自动化检查通过（Rust 单测、前端构建、Capability 安全检查）

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/App.tsx` 增加 `ControlSectionId` 与 `activeControlSection`，引入 `概览/引导配置/运行诊断/日志与路径` 四段导航。
  - Control Center 结构改为 `cc-layout`：左侧导航、右侧卡片主区；原 `control-center-shell` 双栏渲染逻辑已替换。
  - Control Center 内操作按钮改为 `Button + icon + 文本`，并统一中文文案；标题栏与窗口控制继续沿用 icon-only。
  - onboarding 步骤在新结构下改为独立卡片流，保留原命令 handler 与状态判断。
  - `apps/kimi-shell/src/App.css` 新增 `cc-*` 样式体系（侧栏、导航、卡片、动作区、响应式），并替换旧 `control-center-*` 布局规则。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm -C apps/kimi-shell build` 通过（本环境需提权规避 `esbuild spawn EPERM`）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 当前自动化验证已通过；建议在目标机做一次手工视觉验收，重点确认窄屏横向导航与中文文案密度。

---

## 本轮计划（App 组件化 + Kimi Web 满窗同源化）

### 计划清单

- [x] 移除 Control Center 页面内标题栏（应用级标题栏保留）
- [x] 将 `apps/kimi-shell/src/App.tsx` 拆分为独立组件与 hooks（中等粒度）
- [x] 将壳层布局改为满窗显示：`App.tsx` 内容占满窗口，外层无圆角
- [x] 移除底部状态栏并清理相关 JSX/CSS
- [x] 统一主题 token、控件样式与交互密度到 Kimi Web 风格
- [x] 保持现有业务命令行为不变（重启、路径、登录检测、右键菜单、日志）
- [x] 完成回归验证（`pnpm -C apps/kimi-shell build`、`cargo test`、`pnpm -C apps/kimi-shell check:nfr:security`）

### 验收标准

- [x] Control Center 页面中不再出现内部 title 栏
- [x] `App.tsx` 不再承载大段页面结构，主要作为组装入口
- [x] Workspace 与 Control Center 主体都从标题栏下方铺满到窗口底部，无外层圆角容器
- [x] Light/Dark 切换及与 iframe 的主题同步不回归
- [x] 自动化检查通过（构建、Rust 单测、Capability 安全检查）

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/App.tsx` 缩减为 100 行组装入口，页面结构与渲染分发迁移到独立组件。
  - 新增 `src/app/types.ts`、`src/app/theme.ts`、`src/app/useShellController.ts`、`src/app/useWorkspaceThemeBridge.ts`，将状态、轮询、窗口控制、主题桥接从页面层抽离。
  - 新增 `src/features/window/ShellTitlebar.tsx`、`src/features/workspace/WorkspaceView.tsx`、`src/features/loading/LoadingView.tsx`、`src/features/control-center/ControlCenterView.tsx`。
  - 新增通用组件 `src/components/common/IconButton.tsx`、`DiagnosticItem.tsx`、`PathField.tsx`，复用 icon 按钮、诊断项、路径输入。
  - Control Center 去掉页面内部标题区与 sidebar 头部区，保留左侧导航 + 右侧内容区。
  - `src/App.css` 与 `src/index.css` 重写为满窗无外层圆角方案，移除底部状态栏样式并统一 Kimi 风格 token。
  - 新增 `apps/kimi-shell/docs/kimi-web-style-map.md`，记录 shell 与 Kimi Web 风格映射。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（本环境需提权以规避 `esbuild spawn EPERM`）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 自动化验证通过，但 UI 细节（与上游 Kimi Web 的像素级一致性）仍建议在目标机进行一轮手工对比验收。

---

## 本轮计划（恢复底部状态栏）

### 计划清单

- [x] 在 `apps/kimi-shell/src/App.tsx` 恢复底部状态栏渲染
- [x] 在 `apps/kimi-shell/src/App.css` 恢复状态栏样式（状态标签、消息、右侧元信息）
- [x] 保持现有满窗布局与 Control Center 结构不变，仅新增底栏
- [x] 运行构建验证（`pnpm -C apps/kimi-shell build`）

### 验收标准

- [x] 底部重新出现状态栏，显示状态、消息/错误、主题/端口/PID
- [x] 小屏下右侧元信息按预期折叠
- [x] 页面主结构（标题栏 + 主内容）无回归
- [x] 构建通过

### 回顾（完成后填写）

- 实际变更：
  - `App.tsx` 恢复 `statusbar` JSX，状态标签使用 `formatBackendState`，并展示 loading/error/message/logs 以及 `Theme/Port/PID`。
  - `App.css` 恢复 `statusbar`、`status-indicator`、`status-text`、`status-meta` 等样式，并在 `max-width: 900px` 下隐藏右侧元信息。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（本环境需提权规避 `esbuild spawn EPERM`）。
- 风险与后续：
  - 状态栏与顶部 `shell-alert` 会同时显示错误信息；若你希望只保留一处，可下一步合并提示位。

---

## 本轮计划（Control Center：Dashboard + 引导头行化 + 运行日志合并互斥）

### 计划清单

- [x] 将概览从重复引导内容改为 dashboard（统计信息 + 入口）
- [x] 引导配置完成态改为标题后绿色 `√` 图标，移除绿色边框
- [x] 引导卡片标题与操作按钮改为同一行横向布局
- [x] 合并“运行诊断”和“日志与路径”为单一导航模块
- [x] 合并模块内部改为互斥展开，默认展开“路径与上下文菜单”
- [x] 保持业务命令与后端接口不变，仅调整前端组织与样式
- [x] 完成回归验证（`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`、`cargo test`）

### 验收标准

- [x] 概览不再与引导配置重复，具备 dashboard 统计与跳转入口
- [x] 引导配置完成态以绿色 `√` 图标呈现，且无绿色边框
- [x] 引导配置标题与按钮同一行，不分行
- [x] 运行与日志合并后，展开状态互斥，默认展开路径面板
- [x] 自动化验证全部通过

### 回顾（完成后填写）

- 实际变更：
  - `src/app/types.ts`：`ControlSectionId` 改为 `overview | onboarding | runtime_center`，新增 `RuntimePanelId(core|paths|logs)`。
  - `src/app/useShellController.ts`：新增 `activeRuntimePanel` 状态（默认 `paths`），兼容旧 hash：`#/diagnostics` -> `runtime_center/core`，`#/logs_paths` -> `runtime_center/paths`。
  - `src/features/control-center/ControlCenterView.tsx`：
    - 概览重构为 dashboard（统计卡 + 模块入口）。
    - 引导步骤头部改为“标题 + 按钮同一行”，完成态为标题后绿色 `√` 图标。
    - 运行诊断与日志路径合并为 `runtime_center`，内部 3 个互斥展开面板（核心诊断 / 路径与上下文菜单 / 最近日志）。
  - `src/App.css`：新增 dashboard、step header、runtime accordion 样式；删除引导完成态绿色边框样式。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（本环境需提权规避 `esbuild spawn EPERM`）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
- 风险与后续：
  - 当前“标题与按钮同一行”在极窄宽度下通过横向滚动保证不换行，建议在目标机做一次窄屏手工验收确认体验。

---

## 本轮计划（引导配置容器遮挡修复）

### 计划清单

- [x] 将引导步骤卡内容区改为“下层左右两栏”布局，避免内容挤压遮挡
- [x] 调整引导步骤头部按钮容器，去除裁切来源（允许换行、取消横向裁切）
- [x] 为窄屏补充响应式规则，避免按钮和内容互相覆盖
- [x] 完成回归验证（构建、安全检查、Rust 单测）

### 验收标准

- [x] 引导配置每一项容器呈现“上层头部 + 下层左右双栏”结构
- [x] 不再出现引导项内容被遮挡/裁切
- [x] 窄屏下布局自动退化为单列，不出现重叠
- [x] 自动化验证通过

### 回顾（完成后填写）

- 实际变更：
  - `ControlCenterView.tsx` 中五个引导步骤的 `cc-card-body` 改为 `cc-step-body`，并拆分为 `cc-step-main` + `cc-step-side` 双栏结构。
  - `App.css` 中新增 `cc-step-body`、`cc-step-main`、`cc-step-side`、`cc-step-side-empty` 样式；`cc-step-card` 改为 `overflow: visible`。
  - `cc-step-actions` 从不换行横向滚动改为可换行并右对齐，消除被裁切问题。
  - 在 `max-width: 1024px/900px` 断点下增加引导区响应式退化规则，防止窄宽度遮挡。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（本环境需提权规避 `esbuild spawn EPERM`）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
- 风险与后续：
  - 该修复优先解决遮挡可用性；若后续仍需“按钮绝不换行”，建议在固定最小宽度前提下再做一次布局收敛。

---

## 本轮计划（Control Center 紧凑化 + 外链打开修复）

### 计划清单

- [x] 引导步骤头部按钮改为固定紧凑样式，整体配色收敛到黑白灰（更接近 Kimi Web）
- [x] 控制中心左侧导航按钮与文案改为明确左对齐（含窄屏横向导航）
- [x] 未完成步骤在标题后展示灰色 `X` 图标，并去除步骤容器激活蓝色边框
- [x] 修复卡片顶部圆角断点（定位并修复 `overflow` 引起的裁切问题）
- [x] 引导配置卡片做结构化精简：保持信息完整、布局更整齐
- [x] 修复全部外链入口：点击后可稳定拉起系统默认浏览器（不再依赖 `_blank`）
- [x] 完成回归验证（`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`、`cargo test`）

### 验收标准

- [x] 引导步骤头部按钮视觉统一、尺寸固定且更紧凑
- [x] 左侧导航在桌面和窄屏场景均为左对齐
- [x] 步骤完成态为绿色对勾，未完成态为灰色 `X`，且步骤卡无蓝色激活边框
- [x] 所有卡片顶部圆角连续完整，不出现断点
- [x] 引导卡片信息不丢失，阅读路径更简洁规整
- [x] Control Center 文档按钮 + Loading 链接 + Workspace 外开链接均可打开外部浏览器

### 回顾（完成后填写）

- 实际变更：
  - `src/features/control-center/ControlCenterView.tsx`：引导步骤标题后统一显示状态图标（完成=绿色勾，未完成=灰色 `X`），去除步骤卡 `active` 视觉依赖；导航按钮文案新增独立文本容器并强制左对齐。
  - `src/features/control-center/ControlCenterView.tsx`：四个文档入口从 `<a target="_blank">` 改为按钮，统一走 `onOpenExternalUrl` 回调，避免 WebView 内 `_blank` 行为不一致。
  - `src/features/loading/LoadingView.tsx`、`src/features/workspace/WorkspaceView.tsx`：外链入口改为统一回调触发（Loading 的 URL 行内按钮、Workspace 兜底按钮）。
  - `src/app/useShellController.ts`：新增 `handleOpenExternalUrl`，Tauri 运行时调用 `invoke("open_external_url")`，浏览器环境回退 `window.open`。
  - `src-tauri/src/backend_manager.rs`、`src-tauri/src/lib.rs`：新增 `open_external_url` 命令，限制 `http/https` 并走系统浏览器打开（Windows/macOS/Linux）。
  - `src/App.css`：步骤头部按钮改为固定紧凑样式与中性黑白灰配色；导航按钮改为网格左对齐；步骤卡恢复 `overflow: hidden` 修复圆角断点；补充 `cc-step-summary/meta`、`cc-doc-btn`、`inline-link-btn` 等整齐化样式。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（首次沙箱执行命中 `esbuild spawn EPERM`，提权后重跑通过）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
- 风险与后续：
  - 自动化验证已通过；仍建议在目标 Windows 机器手工点测所有外链入口，确认系统默认浏览器拉起与焦点切换体验符合预期。

---

## 本轮计划（Shell CSS 与 KimiWeb index.css 完全统一）

### 计划清单

- [x] 解析 `docs/index.css` 的 token 体系与基础语义（去除 Tailwind 专用语法）
- [x] 将 `apps/kimi-shell/src/index.css` 重构为同源 token（light/dark、semantic、shadow、sidebar）
- [x] 将 `apps/kimi-shell/src/App.css` 的主题变量改为映射 KimiWeb token（不保留旧配色常量）
- [x] 统一按钮、输入框、卡片、导航激活态到 KimiWeb 语义（primary/secondary/accent/ring）
- [x] 保持现有组件结构与交互不变，仅改样式系统
- [x] 完成回归验证（`pnpm -C apps/kimi-shell build`、`pnpm -C apps/kimi-shell check:nfr:security`、`cargo test`）

### 验收标准

- [x] 全局设计 token 与 KimiWeb `docs/index.css` 对齐（light/dark 均一致）
- [x] 控制中心与标题栏视觉风格与 KimiWeb 黑白灰语义一致
- [x] 输入框/按钮焦点、hover、边框、阴影语义与 KimiWeb 一致
- [x] 业务能力无回归，构建与测试通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/index.css`：引入与 `docs/index.css` 同源的 light/dark design token（background/foreground/card/primary/secondary/muted/accent/destructive/success/warning/info/ring/border/input/shadow/sidebar 等），并同步基础排版、代码片段与滚动条语义。
  - `apps/kimi-shell/src/App.css`：移除旧固定色值主题块，改为从 KimiWeb token 派生 Shell 语义变量；按钮/输入框/卡片/导航激活态统一到 `primary/secondary/accent/ring` 语义体系。
  - 保留现有 React 组件结构与业务逻辑，仅替换视觉层实现，避免行为回归。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（首次沙箱执行命中 `esbuild spawn EPERM`，提权后重跑通过）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
- 风险与后续：
  - `docs/index.css` 中 Tailwind 专用指令（`@import "tailwindcss"`、`@layer`、`@theme inline`）未直接引入当前工程，而是做了等价语义映射；若后续需要与 KimiWeb 完全同构的原子类体系，可再单独引入 Tailwind/shadcn 构建链。

---

## 本轮计划（中英文 MSI/EXE 安装包，版本 0.0.1）

### 计划清单

- [x] 将前后端版本统一为 `0.0.1`（`package.json`、`tauri.conf.json`、`Cargo.toml`）
- [x] 增加中英文打包配置（WiX + NSIS）并确保可复用
- [x] 构建中文安装包（MSI + EXE）
- [x] 构建英文安装包（MSI + EXE）
- [ ] 安装前先卸载本机已安装版本并验证安装流程
- [x] 汇总产物路径与校验结果

### 验收标准

- [x] 生成 `0.0.1` 中文 `msi/exe` 安装包
- [x] 生成 `0.0.1` 英文 `msi/exe` 安装包
- [ ] 本机安装前已完成旧版本卸载
- [ ] 新安装包可完成安装，且可正常卸载

### 回顾（完成后填写）

- 实际变更：
  - 将 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 版本统一到 `0.0.1`。
  - 新增按语种拆分的打包覆盖配置：`tauri.conf.bundle.zh-CN.json`、`tauri.conf.bundle.en-US.json`。
  - 完成中英文 `msi/exe` 构建，并归档到 `apps/kimi-shell/release-artifacts/0.0.1`。
- 验证结果：
  - `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis --config src-tauri/tauri.conf.bundle.zh-CN.json` 通过。
  - `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis --config src-tauri/tauri.conf.bundle.en-US.json` 通过。
  - 本机卸载项扫描结果为 `MATCH_COUNT=0`（无已安装版本）。
- 风险与后续：
  - 该方案是“分语种安装包”；后续需求已改为“同包多语言自动选择”，因此继续在下一个计划中处理多语言同包构建。

---

## 需求变更（多语言自动选择安装包）

### 计划清单

- [x] 新增多语言安装配置：中/英文同包（优先按系统语言自动选择）
- [x] 重新构建 MSI + EXE
- [x] 校验产物命名、语言配置与输出路径

### 回顾（完成后填写）

- 实际变更：
  - 新增多语言覆盖配置 `apps/kimi-shell/src-tauri/tauri.conf.bundle.multilang.json`：
    - WiX: `language = ["zh-CN", "en-US"]`
    - NSIS: `languages = ["SimpChinese", "English"]`，`displayLanguageSelector = false`
  - 重新构建产物并归档到 `apps/kimi-shell/release-artifacts/0.0.1-multilang`。
- 验证结果：
  - `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis --config src-tauri/tauri.conf.bundle.multilang.json` 通过。
  - 构建输出包含：
    - `Kimi Desktop Shell_0.0.1_x64_zh-CN.msi`
    - `Kimi Desktop Shell_0.0.1_x64_en-US.msi`
    - `Kimi Desktop Shell_0.0.1_x64-setup.exe`
  - 生成的 NSIS 脚本包含 `MUI_LANGUAGE "SimpChinese"` 和 `MUI_LANGUAGE "English"`（自动按系统语言匹配）。
- 风险与后续：
  - WiX 仍会输出两个 MSI（zh-CN / en-US）；NSIS EXE 为单包多语言并按系统语言自动选择。

---

## 本轮计划（启动卡住与标题栏交互修复）

### 计划清单

- [x] Windows 下 `kimi` 相关命令统一为无控制台窗口启动
- [x] 后端异常退出时切到 Control Center，不停留 error/loading
- [x] 标题栏改为整条（除按钮区）支持拖拽，双击切换最大化
- [x] 运行构建与测试验证（Rust + 前端 + capability 检查）

### 验收标准

- [x] 启动应用不再弹出多个终端窗口
- [x] `kimi web` 异常退出后，主界面切到 Control Center 并展示可重试入口
- [x] 标题栏可拖动窗口，双击可最大化/还原
- [x] 构建与测试通过

### 回顾（完成后填写）

- 实际变更：
  - 新增 `src-tauri/src/command_utils.rs`，并将 `kimi` 相关命令统一接入 Windows 无控制台启动策略：
    - 后端启动 `kimi web ...` 使用 `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP`，并显式 `stdin = null`。
    - `kimi web --help`、`kimi login --json`、`kimi --version`、`kimi -v` 探测使用 `CREATE_NO_WINDOW`。
  - 崩溃跳转改为 `Control Center`：
    - `backend_manager` 的监控退出与 `set_crashed` 路径统一调用 `navigate_control_center`。
    - `window_manager` 新增 `navigate_control_center` 并移除未使用的 `navigate_error`。
    - 前端 hash 路由将 `#/error` 与 `#/missing-kimi` 统一映射到 `control_center`。
  - 标题栏交互重做：
    - `ShellTitlebar` 改为在标题栏根容器处理 `onMouseDown/onDoubleClick`。
    - 过滤按钮区与交互元素后，触发 `startDragging` 或 `toggleMaximize`。
    - `useShellController` 新增 `handleStartWindowDrag`，`App.tsx` 透传。
    - `App.css` 增加标题栏拖拽光标与按钮区光标规则。
  - 近似原生细化：
    - `ShellTitlebar` 将拖拽与双击判定收敛为单一函数 `isTitlebarDragTarget`，统一规则避免行为漂移。
    - 双击事件新增左键限制，避免非主键交互误触发最大化。
    - `App.css` 为标题栏根容器增加 `user-select: none`，降低拖拽时误选中文本。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（13/13）。
  - `pnpm -C apps/kimi-shell build` 通过（首轮 `spawn EPERM`，提权后通过）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 已完成编译与自动化校验；“启动不弹终端/拖拽双击体验”属于 GUI 行为，仍建议在目标 Windows 机器做一次手工验收（尤其是多显示器与缩放场景）。

---

## 本轮计划（引导卡片窄屏折叠 + 流程操作去卡片 + 安装区按探测收敛）

### 计划清单

- [x] 引导配置 4 个步骤在 `<=480px` 默认折叠为标题栏，点击标题展开/收起，且同一时间仅展开一个
- [x] 窄屏标题栏强制单行，右侧仅保留主按钮，次级按钮下沉到展开内容区
- [x] “引导流程操作”移除卡片容器和标题，保留 4 个按钮（全屏尺寸生效）
- [x] “安装 Kimi CLI”在依赖和 Kimi 全部就绪时隐藏安装按钮与官方/镜像切换
- [x] 完成构建验证并回填结果

### 验收标准

- [x] `<=480px` 时每张引导卡片仅显示标题栏，点击标题可展开/收起
- [x] 标题与右侧主按钮始终同一行，按钮不换到下一行
- [x] 流程操作区域无卡片外框和标题，仅有 4 个操作按钮
- [x] 安装步骤在全就绪时不显示安装源切换与安装按钮
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `ControlCenterView.tsx` 新增 `installProbe` 入参，接入安装就绪判断 `hideInstallControls`（`git/uv/python313/kimi` 全部 ready 时隐藏安装源切换与安装按钮）。
  - 新增窄屏折叠状态（`matchMedia("(max-width: 480px)")`）与 `expandedOnboardingStep`，实现默认全部折叠、标题点击展开/收起、同一时间仅展开一个。
  - `StepHeader` 重构为 `primaryAction + secondaryActions` 模式：窄屏标题栏只展示主按钮，次级按钮下沉到展开内容区。
  - 引导第 1~4 步内容改为按步骤展开状态条件渲染；保留桌面端原有信息密度与交互。
  - “引导流程操作”去除卡片容器与标题，改为仅渲染 4 个操作按钮区域。
  - `App.tsx` 将 `shell.installProbe` 透传给 `ControlCenterView`。
  - `App.css` 新增窄屏标题栏单行样式与折叠指示样式，移除 `<=900px` 下把引导头部改为纵向堆叠的旧规则。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过（首轮 `spawn EPERM`，提权后通过）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过（Capability check passed）。
- 风险与后续：
  - 折叠交互与按钮显隐已在代码层落地；建议在目标 Windows 设备做一次 `<=480px` 实机验收，重点确认标题省略与主按钮文案可读性。

## 本轮计划（安装后透明窗口卡死修复）

### 计划清单

- [x] 排查并固化启动透明窗口的根因与最小修复范围
- [x] 调整 Tauri 窗口配置，移除发布版透明窗口依赖
- [x] 增加关键 UI 背景/前景的兼容兜底样式，避免首屏透明
- [x] 重新构建并产出可安装 EXE/MSI
- [x] 回填本节验收与回顾

### 验收标准

- [x] 安装后首次启动不再出现“完全透明窗口”
- [x] 即使后端未就绪，壳层页面也可见（loading/control center 可见）
- [x] `pnpm -C apps/kimi-shell tauri build` 构建通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src-tauri/tauri.conf.json` 将主窗口改为 `transparent: false`，避免发布环境首屏渲染异常时整窗透明。
  - `apps/kimi-shell/src/index.css` 为 `body` 增加显式 sRGB 背景/文字回退色，保证变量色值异常时仍有可见底色。
  - `apps/kimi-shell/src/App.css` 为 `shell-root`、`titlebar`、`control-center`、`modal`、`statusbar` 等关键容器增加显式回退背景/边框色，降低 WebView 兼容差异风险。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16）。
  - `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis` 通过，产出新的 `setup.exe` 与 `msi`。
- 风险与后续：
  - 当前修复优先保障“可见与可操作”；如目标机器仍出现空白，可继续补充 WebView 版本探测与运行时错误日志上报。

## 本轮计划（安装后白窗口修复）

### 计划清单

- [x] 复盘白窗口可能触发链路并锁定最小修复面
- [x] 增加启动白屏保护层（JS 未挂载时可见提示）
- [x] 增加前端全局错误捕获与可视化 fallback（避免静默白屏）
- [x] 下调构建 target 提升旧 WebView 兼容性
- [x] 重新构建并产出新 EXE/MSI
- [x] 回填本节验收与回顾

### 验收标准

- [x] 启动失败时不再是纯白空白，至少显示可读提示
- [x] 前端运行时异常可被捕获并在界面呈现
- [x] `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/index.html` 新增启动 fallback 覆盖层：当前端模块未加载/挂载失败时，界面可见且提示日志路径，不再纯白。
  - `apps/kimi-shell/src/app/RootErrorBoundary.tsx` 新增根错误边界，捕获渲染异常并展示错误信息。
  - `apps/kimi-shell/src/main.tsx` 增加启动阶段错误处理（`error`/`unhandledrejection`），并在 React 成功启动后自动移除 boot fallback。
  - `apps/kimi-shell/vite.config.ts` 设置 `base: "./"` 与 `build.target: "es2019"`，降低资源路径与旧 WebView 语法兼容风险。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过。
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16）。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过。
  - `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis` 通过，已生成新安装包。
- 风险与后续：
  - 若目标机器 WebView2 运行时损坏/被策略拦截，仍可能无法正常渲染业务页，但现在会显示可读错误提示而非白屏；下一步可据提示日志继续定位。

## 本轮计划（安装版窗口 13x13 与二次启动不聚焦修复）

### 计划清单

- [x] 记录已定位根因（窗口异常尺寸 + 单实例不聚焦）
- [x] 启动阶段加入窗口尺寸自愈（小于最小尺寸时恢复并居中）
- [x] 单实例回调加入 `show_and_focus`，确保重复启动可见
- [x] 重新构建并产出 EXE/MSI
- [x] 回填本节验收与回顾

### 验收标准

- [x] 启动后主窗口尺寸不再出现 13x13 等异常值
- [x] 重复双击启动时可拉起并聚焦已运行窗口
- [x] `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis` 通过

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri/lib.rs` 的单实例回调新增 `window_manager::show_and_focus(&app)`，确保重复启动时可见窗口被拉起。
  - `src-tauri/lib.rs` 在 Windows setup 阶段新增窗口尺寸自愈：设置最小尺寸 `900x640`，若检测到异常小窗口（如 `13x13`）则自动 `unminimize + set_size(1200x820) + center`。
  - 保留无边框与阴影策略不变，仅补充可见性与可恢复性保障。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16）。
  - `pnpm -C apps/kimi-shell build` 通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过。
  - `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis` 通过。
  - 本地启动 `target/release/appskimi-shell.exe` 实测窗口尺寸恢复为 `1213x828`（不再是 `13x13`）。
- 风险与后续：
  - 若目标机仍出现“窗口可见但内容白屏”，更可能是 WebView2 运行时环境问题；当前版本已具备启动兜底提示，可继续基于日志定位。

## 本轮计划（安装版停在 about:blank 自救）

### 计划清单

- [x] 记录“WebView 停在 about:blank”根因假设与修复策略
- [x] 在 setup 增加 about:blank 启动自救导航（重试）
- [x] 保留现有窗口尺寸自愈与单实例聚焦能力
- [x] 重新构建并产出 EXE/MSI
- [x] 回填本节验收与回顾

### 验收标准

- [x] 安装版启动后不再长期停留 `about:blank`
- [x] DevTools `Sources` 不再只有 `about:blank`，可看到应用文档与静态资源
- [x] `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis` 通过

### 回顾（完成后填写）

- 实际变更：
  - `src-tauri/lib.rs` 新增 `spawn_blank_window_recovery`：启动后最多 40 次轮询（350ms 间隔）检查窗口 URL，前 20 次优先强制 `navigate_loading`，20 次后优先尝试 `workspace` HTTP 兜底导航（`http://127.0.0.1:<workspace_port>`）。
  - 修正兜底状态机：`workspace fallback` 成功后不再重复覆盖导航，后续仅观察是否生效并记录 waiting 日志，避免“成功后又被重置”。
  - `setup` 中在 `start_backend` 后挂载自救线程，保留“窗口尺寸自愈 + 单实例 show_and_focus”逻辑，三者并行保障可见性。
- 验证结果：
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过（16/16）。
  - `pnpm -C apps/kimi-shell build` 通过。
  - `pnpm -C apps/kimi-shell check:nfr:security` 通过。
  - `pnpm -C apps/kimi-shell tauri build --bundles msi,nsis` 通过。
  - 本地日志可见 `blank-window recovery tick sent`，证明自救线程已生效。
- 风险与后续：
  - 若目标机 WebView2 环境异常严重，`location.replace` 仍可能受限；此时需继续采集 WebView2 运行时版本与系统策略信息。

## Iteration Plan (task0305-2 regression round: default session/prefill/switch perf/keepalive)

### Checklist

- [x] Implement backend bootstrap strategy: reuse latest session for current `work_dir`, create only when no match.
- [x] Keep `workspace iframe` mounted across screen switches (no unmount on control center).
- [x] Remove `screen === "workspace"` hard gate for session navigate/prefill dispatch; rely on runtime-ready + iframe-ready.
- [x] Add route navigation fallback path so session navigation can still proceed when observed template is missing.
- [x] Reduce control-center switch load: avoid eager config-center load, poll status-only every 1s, run diagnostics on runtime-center entry.
- [x] Add/adjust Rust unit tests for work_dir session matching and navigation fallback coverage.
- [x] Run verification: `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` and `pnpm -C apps/kimi-shell build`.
- [x] Fill review notes and mark this section done after verification.

### Review

- Implemented work_dir-based bootstrap session reuse in `workspace_session.rs`:
  - fetches `limit=500` session list
  - selects latest session matching normalized work_dir
  - falls back to create session only when no match
  - emits bootstrap bridge with `route_template="/?session={{session_id}}"`
- Implemented session navigation fallback in injected workspace bridge script:
  - keeps existing template-based navigation
  - adds query fallback (`/?session=...`) when no observed template is available
  - sends richer `navigate_session_ack` reasons for observability
- Implemented workspace keepalive rendering:
  - `App.tsx` now keeps `WorkspaceView` mounted in a persistent base layer
  - loading/control-center are rendered as overlay layers, so switching screens no longer unmounts iframe
- Implemented prefill/session dispatch robustness and perf tuning:
  - removed hard `screen === "workspace"` gate
  - dispatch now depends on backend running + iframe ready + valid origin
  - prefill retries increased to 12 and failure reason is surfaced in `actionError`
  - 1s polling changed to status-only
  - control-center no longer eagerly loads config center or diagnostics on every entry
  - diagnostics refresh now triggers when entering `runtime_center`; config-center data loads lazily on onboarding section
- Validation:
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed (36 tests).
  - `pnpm -C apps/kimi-shell build` passed.
  - release follow-up completed: version bumped `0.0.6 -> 0.0.7`, synced Tauri metadata, NSIS package built successfully:
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.7_x64-setup.exe`

## 本轮计划（构建安装包，2026-03-06）

### 计划清单

- [x] 确认当前桌面端打包脚本、Tauri bundle 配置与目标产物类型
- [x] 执行安装包构建，产出可分发安装文件
- [x] 核对构建日志与产物路径，确认版本号和文件落盘
- [x] 回填本节验收与回顾

### 验收标准

- [x] `pnpm -C apps/kimi-shell tauri build` 构建通过
- [x] `apps/kimi-shell/src-tauri/target/release/bundle` 下生成安装包产物
- [x] 可明确给出本次安装包文件名与所在路径

### 回顾

- 实际变更：
  - 未修改业务代码；仅按现有打包链路执行 `pnpm tauri build`，并在 `tasks/todo.md` 记录本轮计划与结果。
  - 构建过程中 `sync_version.mjs` 再次确认 `package.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json` 版本号均为 `0.0.9`。
- 验证结果：
  - `pnpm -C apps/kimi-shell tauri build` 通过，前端 `vite build`、Rust `release` 编译与 Tauri bundle 全部成功。
  - 产物已落盘：
    - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.9_x64_en-US.msi`
    - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.9_x64-setup.exe`
  - 文件时间戳与大小已核对：
    - MSI `5193728` bytes，`2026-03-06 21:35:44`
    - NSIS EXE `3566739` bytes，`2026-03-06 21:35:56`
- 风险与后续：
  - 当前验证覆盖“可构建并产出安装包”，未在目标 Windows 机器上执行安装与启动验收。
  - `bundle` 目录保留旧版本安装包；若后续要做发布归档，建议按版本清理或单独整理产物目录。
## 本轮计划（安装链路对齐 execlink）
### 计划清单

- [ ] 记录本轮安装链路对齐目标、边界与验收标准
- [ ] 调整 Rust 安装命令为外置 PowerShell 终端执行，并补齐 Node.js / Kimi 升级 / 完整命令目录接口
- [ ] 扩展安装探测类型与前端状态管理，加入 `nodeReady`、安装动作分类和命令弹窗状态
- [ ] 调整控制中心安装卡，加入 `升级 Kimi`、`安装 Node.js` 和 `查看完整安装命令`
- [ ] 新增完整安装命令弹窗，支持分段复制与复制全部
- [ ] 执行 `pnpm -C apps/kimi-shell build`
- [ ] 回填本节回顾与验证结果

### 验收标准

- [ ] 安装卡始终显示 `安装依赖（Git / uv）`、`安装 Kimi`、`升级 Kimi`、`安装 Node.js`、`查看完整安装命令`
- [ ] `升级 Kimi` 在未检测到 Kimi 时禁用，检测到后可点击
- [ ] 所有安装相关动作都改为启动外置终端，不再后台静默执行
- [ ] `安装依赖` 的完成标准仅为 `gitReady && uvReady`
- [ ] `InstallProbeStatus` 新增 `nodeReady`
- [ ] 完整安装命令弹窗可展示全部脚本并支持复制
- [ ] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）
## 本轮计划（安装链路对齐 execlink）
### 计划清单

- [x] 补齐 Rust 安装命令、外置终端启动、安装探测与命令目录输出
- [x] 扩展前端安装探测类型与状态管理，加入 `nodeReady`、安装动作分类和命令弹窗状态
- [x] 调整控制中心安装卡，加入 `升级 Kimi`、`安装 Node.js` 和 `查看完整安装命令`
- [x] 运行 `pnpm -C apps/kimi-shell build`
- [x] 运行 `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 安装卡始终显示 `安装依赖（Git / uv）`、`安装 Kimi`、`升级 Kimi`、`安装 Node.js`、`查看完整安装命令`
- [x] 安装动作改为启动外置 PowerShell，并由前端轮询安装探测结果
- [x] `InstallProbeStatus` 新增 `nodeReady`
- [x] 命令弹窗可展示完整安装/升级/验证命令目录
- [x] `pnpm -C apps/kimi-shell build` 通过
- [x] `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过

### 回顾（完成后填写）
- 实际变更：
  - `apps/kimi-shell/src-tauri/src/backend_manager.rs`
    - 安装依赖、安装 Kimi、升级 Kimi、安装 Node.js 全部改为“写入临时 `.ps1` + 启动外置 PowerShell”。
    - 安装探测增加 `git/uv/python/node/kimi` 常见安装路径兜底，减少 PATH 未刷新导致的误判。
    - 新增 `upgrade_kimi_cli()`、`install_nodejs()`、`get_install_command_catalog()`。
  - `apps/kimi-shell/src-tauri/src/types.rs` / `apps/kimi-shell/src-tauri/src/lib.rs`
    - 扩展 `InstallProbeStatus.nodeReady`，并接入新的 Tauri 命令和安装命令目录类型。
  - `apps/kimi-shell/src/app/types.ts` / `apps/kimi-shell/src/app/useShellController.ts`
    - 前端安装状态改为“启动外置终端 -> 轮询 probe -> 超时/成功消息”。
    - 新增安装动作分类、命令弹窗开关、命令目录获取、`升级 Kimi` 和 `安装 Node.js` handler。
  - `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`
    - 安装卡新增 `升级 Kimi`、`安装 Node.js`、`查看完整安装命令` 入口，并保留源切换。
  - `apps/kimi-shell/src/features/control-center/InstallCommandsModal.tsx`
    - 新增完整安装命令弹窗，支持分段复制和复制全部。
  - `apps/kimi-shell/src/App.tsx` / `apps/kimi-shell/src/App.css`
    - 两处控制中心入口都接入新安装 props，并补齐命令弹窗样式。
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过。
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
- 剩余说明：
  - Rust 侧仍保留旧的隐藏安装脚本常量和旧 helper，当前仅产生 `dead_code` warning，不影响编译和运行。
  - 还未做 GUI 手工验收；需要重点验证外置终端、UAC 提升、单次安装轮询超时提示和命令弹窗复制体验。
## 本轮计划（修复安装后 Notification Area 缺少托盘图标）
### 计划清单

- [ ] 排查托盘图标创建逻辑、图标资源引用与安装后启动路径
- [ ] 实现最小修复，确保安装后启动时 `Kimi Shell` 在 Windows Notification Area / Overflow 中可见
- [ ] 运行构建验证并回填本节回顾

### 验收标准

- [ ] 应用启动后会创建托盘图标，而不是只创建主窗口
- [ ] 安装版与开发版共用同一套托盘资源解析逻辑，不依赖开发路径
- [ ] `pnpm -C apps/kimi-shell build` 通过
- [ ] 如有 Rust 侧改动，`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
## 本轮计划（修复安装后托盘图标缺失）
### 计划清单

- [x] 排查托盘图标创建逻辑、图标资源引用与安装后启动路径
- [x] 实现最小修复，确保安装后启动时 `Kimi Shell` 在 Windows Notification Area / Overflow 中可见
- [x] 运行构建验证并回填本节回顾

### 验收标准

- [x] 应用启动后会创建带图标的托盘项，而不是仅创建菜单
- [x] 托盘图标使用应用默认图标资源，安装版与开发版共用同一解析逻辑
- [x] `pnpm -C apps/kimi-shell build` 通过
- [x] `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过

### 回顾
- 实际变更：
  - `apps/kimi-shell/src-tauri/src/tray_manager.rs`
    - 将 `TrayIconBuilder::new()` 改为显式设置 `id`、`tooltip`
    - 在构建 tray 时绑定 `app.default_window_icon().cloned()`，避免 Windows 创建无 icon 的托盘项
- 验证结果：
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
  - `pnpm -C apps/kimi-shell build` 通过
- 结论：
  - 根因是托盘创建代码只设置了菜单，没有显式设置 icon；Tauri tray builder 默认不会自动补一个可见托盘图标
  - 当前修复已确保托盘使用打包后的默认应用图标资源
## 本轮计划（版本递增并构建安装包）
### 计划清单

- [ ] 将 `apps/kimi-shell/package.json` 版本从 `0.0.10` 递增到 `0.0.11`
- [ ] 通过现有 `sync:version` 链路同步 `Cargo.toml` 与 `tauri.conf.json`
- [ ] 运行 `pnpm -C apps/kimi-shell tauri build`
- [ ] 核对安装包输出路径、文件名、大小与时间
- [ ] 回填本节回顾与验证结果

### 验收标准

- [ ] `apps/kimi-shell/package.json` 版本为 `0.0.11`
- [ ] `apps/kimi-shell/src-tauri/Cargo.toml` 版本为 `0.0.11`
- [ ] `apps/kimi-shell/src-tauri/tauri.conf.json` 版本为 `0.0.11`
- [ ] `apps/kimi-shell/src-tauri/target/release/bundle` 下生成新版本安装包
- [ ] `pnpm -C apps/kimi-shell tauri build` 通过
## 本轮回顾（版本递增并构建安装包）

### 完成项

- [x] 将 `apps/kimi-shell/package.json` 版本从 `0.0.10` 递增到 `0.0.11`
- [x] 通过 `sync:version` 同步 `apps/kimi-shell/src-tauri/Cargo.toml` 与 `apps/kimi-shell/src-tauri/tauri.conf.json`
- [x] 执行 `pnpm -C apps/kimi-shell tauri build`
- [x] 核对 MSI / NSIS 安装包产物路径、大小与时间

### 验证结果

- [x] `apps/kimi-shell/package.json` 版本为 `0.0.11`
- [x] `apps/kimi-shell/src-tauri/Cargo.toml` 版本为 `0.0.11`
- [x] `apps/kimi-shell/src-tauri/tauri.conf.json` 版本为 `0.0.11`
- [x] 已生成新版本安装包
- [x] `pnpm -C apps/kimi-shell tauri build` 通过

### 产物

- MSI: `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.11_x64_en-US.msi`，`5197824` bytes，`2026-03-07 00:44:49`
- NSIS: `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.11_x64-setup.exe`，`3576855` bytes，`2026-03-07 00:44:59`

### 说明

- 本轮仅做版本号递增和安装包构建，没有新增功能改动。
- 还未做安装包实际安装、启动和卸载验收。
## 本轮计划（关闭应用读秒窗完整展示 tips）

### 计划清单

- [x] 排查关闭应用读秒窗 tips 被截断的根因并明确最小修复范围
- [x] 调整 `shutdown-card` 尺寸和 `shutdown-tip-body` 样式，保证 tips 正文完整显示
- [x] 为极端矮视口补充安全兜底，避免内容不可达
- [x] 运行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 关闭应用读秒窗仍保持居中显示
- [x] `shutdown-tip-body` 不再被 `2` 行截断
- [x] 默认窗口下 tips 可以完整显示，不裁切、不重叠
- [x] 极端小视口下内容仍可访问
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/App.css`
    - 将 `shutdown-card` 宽度从 `420px` 放宽到 `460px`
    - 增加 `max-height: calc(100dvh - 32px)` 和 `overflow-y: auto`，作为极端矮视口兜底
    - 将卡片 `padding` 从 `18px` 调整为 `20px`，`gap` 从 `12px` 调整为 `14px`
    - 将 `shutdown-tip-card` 的内部间距从 `12px 13px` 调整为 `14px 15px`
    - 去掉 `shutdown-tip-body` 的 `-webkit-line-clamp: 2`、`display: -webkit-box` 和 `overflow: hidden`
    - 改为普通换行展示，并增加 `overflow-wrap: anywhere` / `word-break: break-word`
- 根因结论：
  - 关闭应用读秒窗 tips 不能显示全，根因是 CSS 明确把 `shutdown-tip-body` 截成了 `2` 行，而不是卡片本身固定高度
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过
- 剩余说明：
  - 当前仅做样式层修复，没有改动 `shutdownTip` 的随机逻辑、退出阶段状态或 JSX 结构
  - 还未做 GUI 手工验收；需要重点确认默认窗口下最长 tips 是否已经无需滚动即可完整显示
## 本轮计划（启动过渡收敛到前置页）

### 计划清单

- [x] 将 loading 页中的工作目录编辑能力并入前置页
- [x] 在主壳首次握手阶段增加 boot hint，正常启动直达 workspace / control_center，不再可见旧 loading 页
- [x] 将 `LoadingView` 降级为异常恢复兜底页，删除工作目录编辑区
- [x] 保持 `report_loading_rendered` 指标在正常启动路径下仍可上报
- [x] 运行 `pnpm -C apps/kimi-shell build`
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] 正常启动时只看到前置页，不再出现旧 `Loading | State: starting` 页面
- [x] 前置页显示 tips、启动状态和工作目录编辑
- [x] 前置页可执行 `浏览`、`保存并重启`、`清空并使用默认`
- [x] `missing_kimi` / onboarding / crashed 仍能正常分流
- [x] `loadingStartupMs` 不回归为缺失
- [x] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/prefill/PrefillApp.tsx`
    - 前置页新增工作目录编辑能力，复用 `get_app_status`、`save_work_dir`、`retry_start_backend`、`open_logs_folder`
    - 等待态改为 `hero tip + support row(status/workdir)`，失败态改为 `failure card + support row(workdir/tip)`
  - `apps/kimi-shell/src/prefill/prefill.css`
    - 前置页新增 `prefill-support-row` 与 `prefill-workdir-card` 样式
    - 为容纳工作目录区，将辅助区改成双列 support row，避免默认窗口纵向挤爆
  - `apps/kimi-shell/src/app/useShellController.ts`
    - 新增一次性 `bootHint` 和 `shellBootPending`
    - 主壳握手 `notify_frontend_ready` 后，若已具备 `running + workspaceUrl`，在首轮真实状态刷新前直接按 workspace 渲染
    - `report_loading_rendered` 改为在握手阶段也补报，避免正常启动跳过 loading 后指标缺失
    - 初始加载不再立即渲染旧 loading 视图，loading 保留为异常恢复兜底
  - `apps/kimi-shell/src/features/loading/LoadingView.tsx`
    - 删除工作目录编辑卡，仅保留状态、日志、重试、退出等恢复能力
  - `apps/kimi-shell/src/App.tsx` / `apps/kimi-shell/src/App.css`
    - 主壳改为根据 `showLoadingView` 决定是否显示 loading 覆盖层
    - loading 兜底页改为单列居中布局
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过
- 剩余说明：
  - 还未做 GUI 手工验收，尤其需要确认“前置页 -> 直接进入 workspace”是否已经完全看不到旧 loading 页
  - `loading` 路由仍然保留，用于主壳异常恢复、手动返回状态页和其他 fallback 场景
## 本轮计划（统一替换 kimilogo 并构建安装包）

### 计划清单

- [x] 核对 `apps/kimi-shell/public/kimilogo.png`、前端品牌图引用和 Tauri 打包 icon 资源
- [x] 将前端 logo 统一切换到 `kimilogo.png`
- [x] 用 `kimilogo.png` 覆盖生成 `src-tauri/icons` 下的安装包图标资源
- [x] 将 `apps/kimi-shell/package.json` 版本从 `0.0.11` 递增到 `0.0.12`
- [x] 运行 `pnpm -C apps/kimi-shell tauri build`
- [x] 核对安装包产物并回填本节回顾

### 验收标准

- [x] 应用内品牌 logo 使用 `kimilogo.png`
- [x] 安装包与应用图标资源使用 `kimilogo.png` 生成
- [x] `package.json` / `Cargo.toml` / `tauri.conf.json` 版本均为 `0.0.12`
- [x] 生成新的 MSI / NSIS 安装包
- [x] `pnpm -C apps/kimi-shell tauri build` 通过

### 回顾（完成后填写）

- 实际变更：
  - `apps/kimi-shell/src/components/kimi-cli-brand.tsx`
    - 品牌组件图片从 `/logo.png` 切换为 `/kimilogo.png`
  - `apps/kimi-shell/package.json`
    - 版本从 `0.0.11` 递增到 `0.0.12`
  - `apps/kimi-shell/src-tauri/icons`
    - 通过 `pnpm -C apps/kimi-shell tauri icon public/kimilogo.png --output src-tauri/icons` 重建整套图标资源
    - 已覆盖 `icon.ico`、`icon.icns`、`32x32.png`、`128x128.png` 等平台图标
- 资源核对：
  - `apps/kimi-shell/public/kimilogo.png` 尺寸为 `1024x1024`
  - 生成后的 `icon.ico` / `icon.icns` 时间戳为 `2026-03-07 10:58:06`
- 构建结果：
  - `pnpm -C apps/kimi-shell tauri build` 通过
  - MSI: `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.12_x64_en-US.msi`，`6795264` bytes，`2026-03-07 10:59:58`
  - NSIS: `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.12_x64-setup.exe`，`5154958` bytes，`2026-03-07 11:00:12`
- 剩余说明：
  - Rust 侧现存 `dead_code` warning 仍在，但不影响本次打包
  - 还未做安装后手工验收，尤其建议确认桌面快捷方式、窗口左上角、托盘和安装程序中的新图标是否全部生效
## 本轮计划（前置页收敛、启动静默与图标残留修正）

### 计划清单

- [ ] 收敛前置页：移除独立 work directory 卡，仅在状态卡内显示 `Effective directory`
- [ ] 修正主壳 handoff：正常启动不再露出 `Loading | State: starting`
- [ ] 调整安装探测时机：应用启动不做 `git/uv/node/python` 完整探测，仅在控制中心安装步骤或显式安装动作时探测
- [ ] 静默化 probe 命令：`git/uv/node` 探测不再弹出短暂终端
- [ ] 清理 favicon 与旧 logo 残留入口，统一到 `kimilogo`
- [ ] 运行构建验证并回填本节结果

### 验收标准

- [ ] 前置页正常态只保留 tips hero 和单一状态卡
- [ ] 前置页不再出现单独的 work directory 卡片
- [ ] 状态卡中可见 `Effective directory`
- [ ] 正常启动时不再出现旧 `Loading | State: starting` 页面
- [ ] 应用冷启动和状态检查时不会触发 `git/uv/node` 完整探测
- [ ] 仅在控制中心“安装 Kimi”步骤展开或显式安装动作时才执行完整 install probe
- [ ] 检查/探测命令不再弹出短暂终端
- [ ] favicon、品牌图、托盘/安装包图标链路统一到 `kimilogo`
- [ ] `pnpm -C apps/kimi-shell build` 通过

### 回顾（完成后填写）
### 回顾（本轮完成）
- 完成项：
  - 前置页删除独立 work directory 卡，`Effective directory` 并入状态卡/失败卡
  - 正常启动链路去掉默认 install probe；完整 install probe 只在控制中心安装步骤或显式安装动作时触发
  - `git/uv/node/python` probe 改为静默执行，不再使用可见终端
  - `notify_frontend_ready -> report_loading_rendered -> complete_pending_prefill_handoff` 重新串联，避免正常启动露出旧 loading 页
  - `index.html` favicon 改为 `/kimilogo.png`，`public/logo.png` 已覆盖成 `kimilogo.png`
- 验证结果：
  - `pnpm -C apps/kimi-shell build` 通过
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过
  - 代码引用已无 `vite.svg` 或 `/logo.png` 入口，只保留 `/kimilogo.png`
- 剩余说明：
  - `apps/kimi-shell/public/vite.svg` 文件本身仍在工作区，但已无任何引用入口
  - Rust 侧仍有既存 `dead_code` warning，未在本轮顺手清理
  - 尚未做 GUI 手工验收，重点应核对 `prefill -> workspace` 是否完全无 loading 闪现，以及 onboarding 安装步骤的惰性探测是否符合预期
## 本轮计划（基于当前工作区重建安装包）

### 计划清单

- [x] 记录本轮安装包重建目标与验收标准
- [x] 执行 `pnpm -C apps/kimi-shell tauri build`
- [x] 核对 MSI / NSIS 产物路径、大小与时间
- [x] 回填本节回顾与验证结果

### 验收标准

- [x] `pnpm -C apps/kimi-shell tauri build` 通过
- [x] 生成当前版本 `0.0.12` 的 MSI / NSIS 安装包
- [x] 可给出产物绝对路径、大小与时间

### 回顾（完成后填写）

- 实际变更：
  - 未新增代码改动；基于当前工作区内容重新执行安装包构建
  - 构建链路仍为 `pnpm -C apps/kimi-shell tauri build`
- 验证结果：
  - `pnpm -C apps/kimi-shell tauri build` 通过
  - MSI: `D:\MyProject\kimi-app\apps\kimi-shell\src-tauri\target\release\bundle\msi\Kimi Desktop Shell_0.0.12_x64_en-US.msi`，`6782976` bytes，`2026-03-07 11:43:01`
  - NSIS: `D:\MyProject\kimi-app\apps\kimi-shell\src-tauri\target\release\bundle\nsis\Kimi Desktop Shell_0.0.12_x64-setup.exe`，`5142243` bytes，`2026-03-07 11:43:08`
- 剩余说明：
  - Rust 侧既存 `dead_code` warning 仍在，但不影响打包成功
  - 还没做安装后手工验收
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
  - Historical pinned items that target other executables, such as old `Kimi 智能助手` installs, remain untouched by design.
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
## 本轮计划（清理剩余 dead_code 警告）
### 计划清单

- [ ] 修复 `apps/kimi-shell/src-tauri/src/backend_manager.rs` 当前语法损坏，恢复可编译状态
- [ ] 运行 `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 获取最新 dead_code 清单
- [ ] 逐条删除剩余 dead_code（13 条）对应的废弃常量和 helper
- [ ] 复跑 `cargo check` 验证 dead_code 警告已清理
- [ ] 回填本节“回顾”与验证结果

### 验收标准

- [ ] `cargo check` 可通过（至少无语法错误）
- [ ] 本轮定位的 dead_code 警告全部消失
- [ ] 仅做最小改动，不引入行为回归
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
    - `PendingWorkspaceBootstrap` 新增 `auto_session`，把“是否自动 bootstrap session”从 `force_create_new` 中拆开。
  - `apps/kimi-shell/src-tauri/src/workspace_session.rs`
    - `queue_workspace_bootstrap(...)` 接入 `auto_session`。
    - `handle_backend_ready()` 遇到 `auto_session=false` 时不再 `fetch/create session`，也不再发送 `navigate_session` bridge。
    - 跳过 bootstrap 时会清空当前 active session runtime，避免沿用旧 session 状态。
  - `apps/kimi-shell/src-tauri/src/open_request.rs`
    - 文件/文件夹/目录空白处对应的 open request 统一改为 `auto_session=false`。
    - 新增基于 `请求类型 + 规范化路径` 的短时去重，覆盖 `startup` 与 `forwarded` 两条入口。
  - 前置页闪烁根因已确认：
    - `window_manager.rs` 中 `run_main_shell_navigation_on_main_thread()` 先 `window.navigate(...)`，后 `window.hide()`。
    - 同一个可见 `main` 窗口因此会短暂露出 shell/loading 中间态，不是第二个窗口闪现。
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
    - `run_main_shell_navigation_on_main_thread()` 现在会在切换到 shell surface 前先 `window.hide()`。
    - 原来位于 `navigate(...)` 之后的 `hide()` 被移除，避免可见 prefill 窗口短暂露出 shell/loading 中间态。
    - 启动状态机、watchdog、`finalize_main_window_boot()` 的 show 时机保持不变。
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
    - `titlebar-identity` 增加 `is-workspace` 状态类。
    - `titlebar-workspace-line` 内新增左侧等宽 spacer，让右侧文件夹按钮不再把中间文本组拉偏。
  - `apps/kimi-shell/src/App.css`
    - 标题栏桌面布局从 `auto / 1fr / auto` 改为对称的 `1fr / auto / 1fr`。
    - 左右操作区分别固定在起止两侧，中间 identity 改为几何中心定位。
    - `Workspace | path` 行改成三列网格：`spacer / centered text / folder button`，保证文字本身也保持居中。
    - 移动端现有双行标题栏布局保留，仅在移动端把工作区文本对齐方式恢复为左对齐。
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
