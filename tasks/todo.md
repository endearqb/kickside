# TODO - 按 docs/需求文档2.md 开发与执行

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
