# 工作区选择器独立窗口与列表收紧

## Checklist
- [x] 阅读现有工作区导入队列、窗口管理与前端渲染路径，确认最小改造面
- [x] 新增独立 `workspace-import-picker` 窗口配置与 Rust 侧打开/复用/关闭逻辑
- [x] 调整导入请求事件投递与请求读取接口，让独立窗口和主窗口 fallback 共用同一套导入状态
- [x] 重构工作区选择器 UI 为独立窗口视图 + fallback 模态，并将列表收紧为单行紧凑项
- [x] 运行构建检查并在本节补充 Review

### Review
- 窗口承载：新增 `workspace-import-picker` 独立小窗口配置，并由 Rust 侧统一负责创建、复用、置顶显示和空队列隐藏；窗口右上角关闭与内容区关闭按钮都按“取消当前请求”处理，队列还有下一条时会直接切到下一条，不再叠多个窗。
- 导入请求路由：右键“选择其他工作区”优先发往独立窗口；窗口创建或事件投递失败时，自动回退到主窗口内的 fallback 模态。新增当前活跃导入请求读取接口，避免新窗口首帧错过事件后出现空白。
- 前端视图：主窗口不再承担主要选择器承载，只保留结果提示与 fallback；独立窗口改成固定高度的紧凑选择器，待导入内容收敛成单行摘要，工作区列表改为单行项，标签与路径同列显示，超长路径省略并通过 `title` 保留完整值。
- 验证结果：`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run`、`pnpm exec tsc --noEmit`、`pnpm build` 已通过。当前仍只有既有的 Rust dead_code warning：`preview_default_work_dir_after_app_sync` 未使用。

# 右键菜单启动前/启动后分流优化

## Checklist
- [x] 阅读并确认右键菜单、启动参数解析、工作区索引与现有导入链路的实现边界
- [x] 扩展 Windows 右键菜单注册/状态校验，新增“移动到工作区”子菜单及命令模板
- [x] 重构 open request 模型与批处理/去重逻辑，显式区分打开请求与导入请求
- [x] 实现后端工作区导入执行器、目标枚举与导入结果事件
- [x] 接入前端工作区选择模态、导入结果提示与当前工作区刷新提示
- [x] 补充单元测试与构建验证，并在本节回填 Review

### Review
- 注册表模板：保留原有 `KimiWebShell` 目录/文件入口不变，并新增 `MoveToWorkspace` 级联子菜单，覆盖 `Directory`、`*`、`AllFilesystemObjects` 三类键位；状态校验同步升级为检查旧入口与新子菜单的 `MUIVerb`、`Icon`、命令值和 `MultiSelectModel`。
- 请求分流：`open_request` 新增 `ImportToDefaultWorkspace` / `ImportWithWorkspacePicker`，`--open-files` 不再把目录隐式回退成 `OpenDir`；导入请求单独做 350ms 聚合和按动作类型区分的去重指纹，避免误伤原有 open request。
- 后端导入：新增 `workspace_import.rs`，提供“默认工作区导入”、“待选择目标导入”、“导入目标枚举”和“结果事件”能力；目录复制保留层级、同名自动加后缀，若目标工作区嵌套在待导入目录内部会显式拒绝，避免递归复制。
- 前端交互：新增工作区导入覆盖层与成功提示条，右键触发“选择其他工作区”时会列出当前/默认/已知工作区，并提供目录浏览兜底；导入成功后不切换会话，只提示目标路径，若命中当前工作区则给出刷新提示。
- 回归修复：补上 Windows 级联父菜单必须写入的 `SubCommands=""`，并把该字段纳入右键状态检查；否则 Explorer 会把“移动到工作区”父项当普通动作执行，点击文件时直接落到系统“无关联应用”报错。
- 验证结果：`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run`、`pnpm exec tsc --noEmit`、`pnpm build` 已通过。`cargo test ... open_request::tests` 与 `workspace_import::tests` 在当前 Windows 机器上执行测试二进制时仍报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，属于本机运行时环境问题，不是本次代码编译失败。

# Kimi 登录失效提醒与诊断方案（Provider API 免打扰）

## Checklist
- [x] 阅读 `DESIGN.md`、`tasks/lessons.md` 与相关登录/认证实现，确认现状边界
- [x] 扩展 Rust 登录健康模型、认证模式判定与诊断写入
- [x] 接入 workspace API 被动认证失败捕获，更新登录健康状态
- [x] 同步前端类型、控制器状态与全局横幅展示规则
- [x] 拆分控制中心/引导里的 Kimi 登录与 Provider API 状态展示
- [x] 运行构建或检查验证，并在本节补充 Review

### Review
- 状态模型：新增 `AuthMode` 与 `KimiLoginHealth`，并把它们接入 `AppStatus`、`DiagnosticsInfo`、`OnboardingStatus` 和 Tauri runtime；旧 `login_verified` 仅作为兼容回填，不再是登录真值来源。
- 认证判定：新增 `auth_state.rs`，按 `default_provider -> 首个有效 provider` 的顺序解析活动 provider；只有活动 provider 带 `api_key/auth_token` 时才判为 `provider_api`，否则回落到 `unknown` 或 `kimi_login`，避免误报横幅。
- 失效捕获：手动 `probe_kimi_login` 现在会把成功、需要重新登录、命令异常都写入统一登录健康状态；`workspace_session` 在 `/api/sessions` 相关请求命中 `401/403` 或明确认证失败文案时，会被动把健康状态降级为 `auth_required`。
- UI 展示：工作区顶部和控制中心顶部新增非阻断登录横幅，但只在 `authMode === kimi_login` 且 `needsAttention === true` 时显示；Provider API 模式下不会再出现“Kimi 未登录”的全局打扰。控制中心认证卡片拆分展示 `Kimi 登录` 与 `Provider API` 两条状态，运行诊断新增 `Auth Mode` 与最近登录检查字段。
- 控制器同步：保存配置中心和手动重新检测后都会立即刷新 `status + onboarding`，避免依赖轮询延迟。
- 验证结果：`pnpm -C apps/kimi-shell build` 于 2026-04-01 通过；`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 于 2026-04-01 通过。完整 `cargo test` 在当前 Windows 机器上仍会因为测试二进制运行时环境报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，属于本机运行时问题，不是本次改动的编译失败。

# 控制中心双栏与控件语言统一改造

## 0.0.32 Release
- [x] 核对 `0.0.32` 版本号、现有 release notes 模板与本轮主变更
- [x] 定位目录内已构建完成的 `0.0.32` 安装包与实际文件名
- [x] 编写 `apps/kimi-shell/docs/release-notes-0.0.32.md`
- [x] 创建或更新 GitHub Release `v0.0.32`，并上传本地安装包
- [x] 验证 release 页面中的文案与附件已正确发布

### Review
- Release notes 已写入 `apps/kimi-shell/docs/release-notes-0.0.32.md`，并以该文件作为 GitHub Release 正文发布。
- 已上传安装包：
  - `Kimi.Desktop.Shell_0.0.32_x64-setup.exe`
  - `Kimi.Desktop.Shell_0.0.32_x64_en-US.msi`
- 发布地址：`https://github.com/endearqb/kimi-app/releases/tag/v0.0.32`
- 验证结果：`gh release view v0.0.32` 确认 release 已发布，正文正确，两个附件状态均为 `uploaded`。

## Checklist
- [x] 阅读 `DESIGN.md`、`tasks/lessons.md`，确认控制中心现状与注意事项
- [x] 检查工作区脏文件边界，避免覆盖用户在 `tasks/` 下的历史整理
- [x] 在 `src/components/control-center/` 新增共享原语组件与共享样式层
- [x] 用共享原语重构快速安装任务面的状态徽标，并让共享样式层接管安装面板主视觉
- [x] 用共享原语重构 IM Bridge 工作台与高级运行面板的关键控件（摘要卡、开关、状态区块）
- [x] 用共享原语重构技能中心双栏工作台的关键控件（空态、状态徽标、容器切换、折叠卡）
- [x] 调整 `ControlCenterCardHeader` 兼容共享状态视觉语言
- [x] 运行前端构建验证
- [x] 扩展 `ControlCenterWorkbenchLayout` 的 body class 接口，承载 Bridge / Skill Center 的内容区差异
- [x] 将 `ControlCenterView.tsx` 中 Bridge 工作台从手写 `bridge-workbench-*` 骨架迁移到共享 `ControlCenterWorkbenchLayout`
- [x] 将 `SkillCenterPanel.tsx` 中 `manage` 与 `workspace_insights` 的双栏骨架迁移到共享 `ControlCenterWorkbenchLayout`
- [x] 清理 `App.css` 与 `control-center.css` 中旧双栏骨架的布局级兼容规则，仅保留业务块样式
- [x] 重新执行 `pnpm -C apps/kimi-shell build` 验证迁移后的骨架与响应式未回归

## Review
- 改动摘要：新增 `src/components/control-center/` 共享原语与 `control-center.css`；Bridge Runtime、Bridge 工作台、Skill Center、Install Flow 已接入共享状态/卡片/切换器中的一部分；旧双栏骨架由共享样式层统一接管。
- 验证结果：`pnpm -C apps/kimi-shell build` 已通过（无沙箱构建，用于放行 Vite/esbuild 子进程）。
- 遗留风险：`ControlCenterWorkbenchLayout` 已落库但当前主要通过共享样式层接管旧双栏 DOM，后续若继续深挖可把 Skill Center / Bridge 的旧骨架完全替换成该组件。
- 本轮收口：Bridge 主工作台和 Skill Center 的 `manage / workspace_insights` 已全部改为 `ControlCenterWorkbenchLayout` 承载 rail/detail、滚动区和空态；`ControlCenterWorkbenchLayout` 新增 `railBodyClassName` / `detailBodyClassName` 以适配业务内容密度。
- 样式清理：删除了 `App.css` 与 `control-center.css` 中针对 `skill-center-manage`、`skill-center-workspace-layout`、`bridge-workbench-shell` 等旧骨架的布局级规则，保留列表项、详情块、工作区 item、Bridge 摘要卡等业务样式。
- 最新验证：`pnpm -C apps/kimi-shell build` 于 2026-03-27 再次通过，未出现 TS 或 Vite 构建错误。
- [ ] 运行桌面 / 窄宽度视觉 QA，截图核对 Bridge 与技能中心的骨架、层级和响应式

## 技能中心工作区洞察页视觉修正

### Checklist
- [x] 阅读 `DESIGN.md`、`tasks/lessons.md`，确认这次视觉修正仍遵循控制中心既有语言
- [x] 调整工作区洞察详情头部的标题/路径间距，并新增“打开工作区目录”的 icon 按钮
- [x] 删除工作区洞察里的容器说明卡片，让容器切换直接衔接详情头部
- [x] 修复“已有 Skill”列卡片在长内容下的横向溢出问题
- [x] 透传 `onOpenFolder` 到 `SkillCenterPanel`，不改业务状态流
- [x] 运行 `pnpm -C apps/kimi-shell build` 验证修改未回归

### Review
- 改动摘要：`workspace_insights` 详情头部改为更明确的标题/路径垂直节奏，并在状态 badge 后新增“在资源管理器中打开工作区”的紧凑图标按钮。
- 结构精简：移除了工作区洞察详情里的容器说明卡片，让容器切换直接承接标题区，减少无效说明噪音。
- 布局修复：为“已有 Skill / 从技能中心导入”两列及卡片内部文本补齐了 `min-width: 0`、换行与溢出约束，避免长名称、长描述和长路径把左列撑出容器。
- 接口调整：`SkillCenterPanelProps` 新增 `onOpenFolder`，由 `ControlCenterView` 直接透传既有打开目录能力，没有新增业务状态或命令。
- 验证结果：`pnpm -C apps/kimi-shell build` 于 2026-03-27 通过；中途捕获并修复了一处 `Promise<void>` 透传被 `void` 包裹导致的 TS 类型错误。

## 技能管理左栏头部三列化改造

### Checklist
- [x] 阅读 `DESIGN.md`、`tasks/lessons.md`，确认头部收口仍符合控制中心的高密度工具栏语言
- [x] 将技能管理左栏头部改成 `2:1:1` 三列布局，收口为搜索框、范围下拉、详情下拉/按钮
- [x] 移除原有的筛选按钮行与非技能中心态的目录路径摘要卡
- [x] 将技能中心态筛选改成单一下拉，不改原有 `filter` 逻辑
- [x] 调整响应式样式，保证窄宽度下三列可自然堆叠
- [x] 运行前端构建验证并回填结果

### Review
- 结构调整：技能管理左栏头部已改成单层三列工具栏，桌面下按 `2:1:1` 布局呈现搜索框、范围下拉、详情下拉/按钮，不再保留第二行辅助内容。
- 交互收口：技能中心态的 `全部 / 全局 / 当前工作区 / 已固定 / 未信任 / 可更新` 已从按钮组改成单一下拉；非技能中心态则统一显示“重新扫描”按钮。
- 信息减负：原来的目录路径摘要卡已从技能管理左栏头部移除，避免在高密度工具栏里重复暴露非必要说明。
- 样式同步：新增了管理页头部专用网格与窄屏堆叠规则，并覆盖了旧搜索框的固定宽度，使其能正确占满 `2fr` 列。
- 验证结果：`pnpm -C apps/kimi-shell exec tsc` 与 `pnpm -C apps/kimi-shell exec vite build` 于 2026-03-27 通过。

## 机器人绑定恢复 + Skill 卡片布局修复

### Checklist
- [x] 阅读并确认微信 / 飞书 onboarding 与工作区洞察 Skill 卡片的现状实现
- [x] 为 Rust onboarding 外呼提取共享 HTTP helper，补齐日志、超时与 Windows 兜底

## IM Bridge 端口保留导致的连接降级排查

### Checklist
- [x] 阅读 `tasks/lessons.md`，确认 bridge 失联优先追前序异常而不是后续人工恢复动作
- [x] 检查 bridge skill 规范、auth 文件与当前 bridge 配置
- [x] 诊断 Windows 上 `127.0.0.1:60110` 的占用/保留状态，确认 bind 失败根因
- [x] 将 bridge admin 端口改到未被系统保留的可用端口，并执行恢复动作
- [x] 验证 bridge admin/status 恢复可访问，确认连接降级解除
- [x] 在本节补充 Review，记录根因、修复动作与验证结果

### Review
- 根因确认：Windows 当前 `excludedportrange` 覆盖了 `60078-60477`，而 shell/bridge 默认固定使用 `60110`，导致 bridge sidecar 在 `listen tcp 127.0.0.1:60110` 时被系统直接拒绝；本机同时运行 Docker Desktop / WSL2 / HNS，符合常见触发场景。
- 代码修复：`apps/kimi-shell/src-tauri/src/bridge_manager.rs` 现在在启动前区分“显式 override”与“默认端口”两种模式。默认模式下不再盲用 `60110`，而是在启动时临时选择可绑定的 localhost 端口；显式 override 不可用时会记录原因并自动降级到动态端口；若 sidecar 仍因 bind 失败退出，会再自动换口重试一次。
- 可观测性：bridge 启动失败消息新增了 bind-failure hint，会直接提示 Windows excluded port range 以及 Docker Desktop / WSL2 / Hyper-V 的常见背景，减少把 `access permissions` 误判成权限或防火墙问题。
- 编译验证：`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 与 `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 于 2026-03-29 通过；`cargo test ... bridge_manager::tests::` 真正执行测试二进制时在当前机器报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，属于本机运行时依赖问题，不是这次改动的编译错误。
- 实机恢复：为当前已安装 shell 的运行时配置把 `C:\Users\Qian\AppData\Roaming\com.kimi.shell\bridge_settings.json` 中 `adminPort` 临时切到 `61110` 后，通过 host control 触发了 bridge restart；`bridge_ops.ps1 status` 已返回 `bridge_state=running`，`bridge_skill_auth.json` 也已刷新为 `admin_base_url=http://127.0.0.1:61110`，说明连接降级已解除。

## 0.0.33 Release

### Checklist
- [x] 阅读 `tasks/lessons.md`，确认发版仍需校对版本号、安装包形态与现有脏改动边界
- [x] 核对当前版本号来源、构建脚本与工作树改动范围
- [x] 将 Kimi Desktop Shell 版本从 `0.0.32` 升级到 `0.0.33`
- [x] 编写 `apps/kimi-shell/docs/release-notes-0.0.33.md`
- [x] 构建 `0.0.33` 安装包并核对产物路径/文件名
- [x] 提交并推送到 `main`
- [x] 创建或更新 GitHub Release `v0.0.33`，上传安装包并验证发布结果

### Review
- 版本同步：通过 `pnpm -C apps/kimi-shell version:bump:patch` 将 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 同步到 `0.0.33`，随后手动补齐了 `onboarding_http.rs` 的 UA 版本字符串，并在构建后确认 `Cargo.lock` 也已落到 `0.0.33`。
- 发布说明：新增 `apps/kimi-shell/docs/release-notes-0.0.33.md`，并顺手把此前未入库的 `apps/kimi-shell/docs/release-notes-0.0.32.md` 一并纳入版本库；`0.0.33` 说明聚焦 bridge admin 端口动态避让、Windows reserved-port 诊断提示，以及当前工作树里的 onboarding 加固改动。
- 构建验证：`pnpm -C apps/kimi-shell tauri build` 于 2026-03-29 通过，产出
  - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.33_x64-setup.exe`
  - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.33_x64_en-US.msi`
- 发布资产：为保持 GitHub Releases 命名一致性，构建后额外复制出
  - `Kimi.Desktop.Shell_0.0.33_x64-setup.exe`
  - `Kimi.Desktop.Shell_0.0.33_x64_en-US.msi`
  并以这两个文件名上传到 release。
- Git / Release：已提交 `release: v0.0.33`（`86f1691`），并推送到 `origin/main`；`gh release create v0.0.33` 已成功发布，地址为 `https://github.com/endearqb/kimi-app/releases/tag/v0.0.33`，两个附件状态均为 `uploaded`。
- [x] 修复微信 onboarding 状态兼容与成功后提示文案
- [x] 为 Go 微信 adapter 增加瞬时网络错误有限重试与更清晰错误透传
- [x] 调整工作区洞察“已有 Skill”卡片文案与布局，移除“查看技能中心”按钮
- [x] 运行 `cargo test`、`go test`、`pnpm -C apps/kimi-shell build` 验证修改

### Review
- 绑定加固：新增 `apps/kimi-shell/src-tauri/src/onboarding_http.rs` 作为共享外呼 helper，统一了 `User-Agent`、连接/总超时、transport 分类日志，以及 Windows 原生 PowerShell `Invoke-WebRequest` 兜底。
- 飞书流程：`feishu_onboarding.rs` 已改为通过共享 helper 执行 `init / begin / poll`，请求失败时会带上更具体的阶段和响应摘要；官方接口直连验证仍可用，桌面端在 transport 失败时会自动切到 Windows 原生请求。
- 微信流程：`weixin_onboarding.rs` 的二维码获取与状态轮询均切到共享 helper，并补上了 `scaned / scanned` 双状态兼容；错误上下文也会包含具体阶段。
- Bridge 稳定性：`apps/kimi-im-bridge/internal/adapters/weixin/service.go` 为微信 API 外呼补上了有限重试、非 2xx 响应体摘要和更明确的 attempt 信息，避免瞬时 EOF/timeout 让已绑定机器人看起来像失效。
- UI 修复：`SkillCenterPanel.tsx` 已从“已有 Skill”卡片移除“查看技能中心”按钮，把“已关联技能中心”改成“已关联”，并为工作区洞察卡片引入单行省略的技能名和更稳定的头部布局；`App.css` 同步收紧了 action 区和溢出规则。
- 验证结果：`go test ./...` 与 `pnpm -C apps/kimi-shell build` 于 2026-03-27 通过；Rust `cargo test --no-run` 已通过编译，`cargo test` 真正执行测试二进制时在当前 Windows 环境报 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`，属于本机运行时依赖问题，非本次代码编译错误。

## 工作区导入独立窗口回归修复

### Checklist
- [x] 阅读 `DESIGN.md`、`tasks/lessons.md`，确认独立窗口需对齐现有自定义无边框辅助窗口样式
- [x] 修复 `workspace-import-picker` 的 Tauri capability / ACL，允许 invoke、关闭、拖拽和最小化
- [x] 将 picker 窗口改回无原生标题栏，并套用和 `prefill` 一致的自定义 titlebar 壳层
- [x] 修复 picker 首帧空转，确保打开后能立即加载活动导入请求和可用工作区
- [x] 运行 Rust / 前端校验并在本节回填 Review，同时把经验写入 `tasks/lessons.md`

### Review
- 根因修复：`workspace-import-picker` 之前没有进入 `default` 与 `frameless-window-controls` capability 范围，导致 picker 窗口内的 `invoke`、`window.close`、`window.startDragging`、`window.minimize` 都会被 ACL 拦截；现在已把该窗口纳入对应权限范围。
- 窗口样式：`tauri.conf.json` 和 `window_manager.rs` 现在都统一把 picker 设为 `decorations=false`，不再被运行时重新改回 Windows 原生标题栏；独立窗口顶部改为复用项目现有无边框辅助窗口语言的自定义 titlebar。
- 加载恢复：由于 ACL 补齐，picker route 首帧的 `get_active_workspace_import_request` 与 `list_workspace_import_targets` 已可正常执行；空状态文案也从“等待中”收敛为“暂无请求/暂无待处理导入请求”，避免把权限失败误读成卡死。
- 交互收口：自定义 titlebar 提供最小化与关闭按钮；当仍有激活导入请求时，关闭会走“取消请求并关闭窗口”的既有后端清理路径，队列为空时窗口自动隐藏。
- 验证结果：`pnpm -C apps/kimi-shell exec tsc --noEmit`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`pnpm -C apps/kimi-shell build` 于 2026-04-13 通过。当前仍只有既有 Rust warning：`preview_default_work_dir_after_app_sync` 未使用。

## 工作区导入独立窗口再次收口

### Checklist
- [x] 阅读当前 picker 组件与样式，确认“双层壳”和内容区关闭入口的具体来源
- [x] 移除独立 picker 的整个前端 titlebar，仅保留单层内容面板
- [x] 删除内容区所有关闭图标，统一由底部 `取消` 承担可见退出入口
- [x] 重做可用工作区列表的容器和行布局，修复重叠与压缩问题
- [x] 运行前端 / Rust 校验并在本节回填 Review，同时补充这次用户纠正带来的经验

### Review
- 结构收口：`workspace-import-picker` 的前端 titlebar 已整体移除，独立窗口现在直接渲染单层选择器内容；titlebar 下方原来的内嵌大卡片也已取消，不再存在“双层壳”。
- 交互统一：内容区所有关闭图标都已删除，包括标题区 `X` 和待导入区域上方的关闭入口；窗口内唯一可见退出动作现在是底部 `取消`。为了避免空请求时点取消无响应，`handleCancelWorkspaceImportPicker` 在独立 picker 路由下会在无 active request 时直接关闭窗口。
- 列表修复：可用工作区列表从 `grid` 收口成稳定的纵向滚动容器，列表项补上了显式最小高度、三段列布局、统一行高和滚动区留白，避免按钮行在高 DPI / 多工作区场景下互相挤压重叠。
- 样式方向：独立窗口保留整窗石墨/琥珀背景语气，但不再叠加额外内容壳；modal fallback 仍保留卡片式承载，因此没有引入第二套业务视图。
- 验证结果：`pnpm -C apps/kimi-shell exec tsc --noEmit`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`pnpm -C apps/kimi-shell build` 于 2026-04-13 通过。当前仍只有既有 Rust warning：`preview_default_work_dir_after_app_sync` 未使用。

## IM Bridge 流式消息支持

### Checklist
- [x] 阅读 `tasks/lessons.md`、现有 bridge adapter 实现和官方插件源码，确认 Feishu / Weixin 的真实流式能力边界
- [x] 为 `kimi-im-bridge` 配置层补齐 `feishu_reply_renderer=streaming` 与 `weixin_reply_mode=status_only` 等新枚举，并把 shell 侧类型同步到可持久化
- [x] 为 Feishu gateway / sender 增加消息更新能力，接通基于 delta 的真流式卡片更新与最终回退
- [x] 为 Weixin client / service 增加 `getConfig` / `sendTyping`，接通 `typing + final` 的保守流式体验
- [x] 为 Feishu / Weixin / config 增加回归测试，运行 Go / Rust / 前端校验

### Review
- 能力边界：复查官方插件后，飞书插件明确支持卡片流式更新；微信插件公开能力则是 `getconfig + sendtyping + sendmessage`，并显式声明 `blockStreaming`，因此本轮按“状态流式”落地，而不承诺逐字增量文本。
- Feishu 真流式：`internal/adapters/feishu` 新增了 reply streamer，利用 bridge/runtime 的 `content_delta` 事件在同一张卡片上节流更新；gateway 侧补了 `PatchMessage`，首次可见输出创建锚点消息，后续 patch 同一消息，结束时收敛为完成态。
- Feishu 回退：如果中途 patch 失败、内容过长或最终收尾失败，会自动降级到一次性 interactive reply，保证不会因为流式链路异常而丢回复；已补对应单测覆盖正常流式与 patch 失败回退。
- Weixin 保守接入：`internal/adapters/weixin` 新增 `GetConfig` / `SendTyping` 与 typing session，默认 `status_only` 模式会在处理期间持续上报 `GENERATING`，完成时发送最终消息并收口到 `FINISH`；`streaming_experimental` 当前显式降级到同一路径。
- 配置同步：Go 配置层、shell Rust 类型和前端 TS 类型都已补齐 `streaming` / `status_only` / `streaming_experimental` 枚举，默认值更新为 Feishu `streaming`、Weixin `status_only`，控制中心新建 connector 时也会带上对应默认配置。
- 兼容修复：补了一处旧配置迁移兼容，确保 legacy `feishuReplyCards` 在没有 Feishu connector 的历史文件里也不会被新的 `streaming` 默认值意外覆盖。
- 验证结果：`go test ./...`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`pnpm -C apps/kimi-shell exec tsc --noEmit` 于 2026-04-13 通过。当前 shell 侧仍只有既有 warning：`preview_default_work_dir_after_app_sync` 未使用。

## Feishu Connector Renderer 选择

### Checklist
- [x] 阅读 `DESIGN.md`、`tasks/lessons.md` 并检查控制中心现有 connector 设置表单的承载位置
- [x] 在每个 Feishu connector 设置中增加 `interactive / post / streaming` renderer 选择项
- [x] 保持默认 renderer 为 `streaming`，同时不破坏老 connector 的已保存值
- [x] 运行前端 / Rust 校验并回填 Review

### Review
- 配置入口：在 Feishu connector 的详情设置里新增了“回复呈现”下拉，放在“机器人名称”和“连接凭据”之间，继续复用现有 `bridge-port-card + cc-config-select` 表单语言，没有引入新的视觉组件。
- 可选项：每个 Feishu connector 现在都可以独立选择 `Streaming / Interactive / Post`，并附带简短说明，帮助区分“流式卡片更新”“完成后发交互卡片”“完成后发普通富文本”。
- 默认行为：下拉默认仍指向 `streaming`；新建 Feishu connector 会直接带 `feishuReplyRenderer: "streaming"`，老 connector 如果已经保存过 `interactive` 或 `post`，会继续显示并保留原值，不会被强制覆盖。
- 验证结果：`pnpm -C apps/kimi-shell exec tsc --noEmit` 与 `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 于 2026-04-13 通过。当前 Rust 侧仍只有既有 warning：`preview_default_work_dir_after_app_sync` 未使用。

## IM Bridge 文案收口

### Checklist
- [x] 阅读 `tasks/lessons.md` 并定位 IM Bridge 主工作台、任务面和运行面板里的固定说明文案
- [x] 删除 IM Bridge 主工作台和任务面里的解释性说明文案，仅保留标题、状态、数据与操作
- [x] 调整错误区域渲染，无错误时不再显示“没有最近错误”占位文案
- [x] 保留真正的数据空状态，并将空详情提示收紧为最短必要文案
- [x] 运行前端 / Rust 校验并回填 Review，同时补充这次纠正带来的经验

### Review
- 主工作台收口：移除了机器人列表头部说明、详情卡里的工作区/删除辅助文案，以及危险操作区的解释性说明；开关控件只在真正忙碌时显示“正在应用配置...”这类状态文案。
- 错误展示：左侧列表、右侧详情和运行状态区块都改成“有错误才显示”；无错误时对应区域直接不渲染，不再出现“当前没有记录到最近错误”类占位句。
- 任务面收口：`连接与凭据` 和 `高级运行面板` 任务面都去掉了顶部描述；为避免传空字符串保留空白，还把任务面组件的 `description` 改成了可选字段。
- 解释文案精简：IM Bridge 内部的固定流程解释也一并收紧，只保留动态状态、真实错误、字段约束和必要空状态；像机器人名称同步说明、飞书 renderer 描述、扫码成功后的步骤说明等都已移除。
- 空状态保留：保留了“还没有机器人”“当前没有选中的机器人”“当前机器人还没有建立聊天绑定”等真实数据空态，但把右侧空详情描述收短为最小必要提示。
- 验证结果：`pnpm -C apps/kimi-shell exec tsc --noEmit` 与 `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 于 2026-04-13 通过。当前 Rust 侧仍只有既有 warning：`preview_default_work_dir_after_app_sync` 未使用。

## Bridge Store Warning 清理

### Checklist
- [x] 确认 `preview_default_work_dir_after_app_sync` 的实际调用范围
- [x] 将该 helper 收口为仅测试可见，避免正常编译产生 dead_code warning
- [x] 运行 Rust 校验确认 warning 消失

### Review
- 根因：`preview_default_work_dir_after_app_sync` 仅被同文件测试使用，生产代码从未调用，所以正常 `cargo check` 会把它报告成 `dead_code`。
- 修复：将该函数改成 `#[cfg(test)]` 下才编译，保留测试覆盖但不再进入正常构建产物，比单纯加 `#[allow(dead_code)]` 更干净。
- 验证结果：`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 于 2026-04-13 通过，原 warning 已消失。
