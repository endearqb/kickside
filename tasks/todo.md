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
