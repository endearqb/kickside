# Agent Room V1（v1.1）

## 任务契约

- 用户目标：按 `.ai/plans/agent-room-2026-07-18/` 的 v1.1 基线完成并验证 Observer MVP、Forward MVP 与完整 V1 DoD。
- 直接交付物：Go/Rust/React 实现、只增 migration、accepted ADR、自动化/手工 Gate 证据、同步后的 PRD/SPEC/PLAN/current-state/changes/release notes。
- 影响范围：`apps/kimi-im-bridge`、`apps/kimi-shell`、`.ai/decisions`、`.ai/architecture/current-state.md`、`.ai/changes` 与 Agent Room 计划文档。
- 非目标：不重做 Kimi Code Web、不复制完整 Session、不做云端多人协作、不突破 6 个可见 Pane、不 commit/push/PR、不重置或清理用户工作树。
- 约束：Session 是唯一执行/对话真相；Observer 先于 Forward；React 无 token；同 Session 单一执行所有者；Abort 未确认不替代；Feature Flag 默认关闭；migration 只增不改。
- 验收：PLAN §25、§26、§27、§31 全部有可追溯证据；G3 环境缺失项必须写明 `blocked` 与解除条件。
- 已知不确定性：Runtime Phase 0 已收敛；真实 active Abort 确认、Session-scope Approval、真实 Connector 凭据、Runtime model、Windows CGO、签名私钥和隔离安装 VM 仍按证据 blocked。
- 保守假设：未验证 Runtime 能力一律关闭并明确降级；不以 Draft 代替事实；§28 优先于 Phase 章节中 Lease/Queue 与 migration 的顺序冲突。
- 架构入口：`.ai/architecture/README.md`、`current-state.md`、`verification-gates.md`；索引已声明其余三个主题文档尚未建立。
- 验证入口：Go test/race、Rust test、Shell test/build/verify、三个 registry/capability/resource 检查、Tauri build、真实 Runtime/Connector/NSIS/MSI 手工矩阵。
- 文档触发：每个 Phase 更新 PLAN/PRD/SPEC/current-state/changes；CreateMode、migration、Admin/Tauri 契约、Grid V2 跨门前先 accepted ADR；README 只在长期职责/契约变化时更新。

## Phase / AR Checklist

- [x] Phase 0：AR-000 基线、AR-001 Runtime Capability Probe、AR-002 Fake Runtime（桌面截图与本机 race/Rust binary 按证据 blocked，不冒充通过）。
- [x] Phase 1：AR-100 WorkDir、AR-101 CreateMode、AR-102 Session 唯一性、AR-103 Sidecar 语义、AR-104 附件（附件 wire 未验证时显式失败）。
  - [x] AR-100：per-connector WorkDir / reset JSON 契约、三 Adapter override/global fallback、4 Connector round-trip 与 legacy fixture。
  - [x] AR-101：Accepted CreateMode ADR；Server `always` / `resume_exact` / `reuse_latest` / compatibility `if_missing` 与 Workspace mismatch 测试。
  - [x] AR-102：用户库重复 Session 只读审计、IM 跨 Connector 禁止共享、Store 事务级 Create/Rebind 防重与并发测试；Agent Room 独立表约束冻结，实体表留待 AR-300。
- [x] Phase 2a：AR-200 ExecutionService。
  - [x] AR-200：共享执行主链、Room target projection、strict exact、PromptID、Approval 内存关联、Duplicate/Rebind 边界与三 Adapter 回归。
- [x] Phase 3a：AR-300～304 migrations/store。
- [x] Phase 2b：AR-201～203 Lease/Queue/Busy（真实 Abort 确认仍 capability-blocked；替代 Run fail closed）。
- [x] Phase 3b：AR-305～306 Admin API/Diagnostics（flag 默认关闭；Observer/Forward 未开放）。
- [x] Phase 4：AR-400～405 Multi Session Observer（Fake 1/6 全矩阵；真实 0.27.0 只读 1/6 transport）。
- [x] Phase 5～7：Rust Pump、Grid V2、Native Pane、Reverse Mirror；Observer MVP Gate 已通过后才开放 Forward。
- [x] Phase 8～10：Forward Dispatch、Approval/Recovery、Workflow/Connector（真实 Connector matrix 单独 blocked）。
- [ ] Release：本地 Product/Architecture/Security/Reliability、NSIS/MSI 构建与静态升级兼容已验证；签名 updater、隔离安装升级与真实 Connector G3 blocked。

## Phase 0 基线

- [x] 起始 commit：`1cc7dbaca9405d055bd237e2b6f6db83b1cc86cf`；分支 `main`，未切换或重置。
- [x] `go test ./...`：通过。
- [x] `pnpm -C apps/kimi-shell test`：18 files / 134 tests 通过。
- [x] `pnpm -C apps/kimi-shell build`：通过。
- [x] `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`：Windows manifest 修复后 235 tests 通过。
- [ ] `go test -race ./...`：blocked，当前 `CGO_ENABLED=0`；需 CGO+GCC 或 Linux CI。
- [x] 1/2/6 Pane：Fake Runtime 全矩阵、真实 Runtime 1/6 transport 与独立 Tauri Native Pane/Sidecar 恢复 Gate 通过。

## Final Review

- 已实现：Observer/Forward/Workflow/Connector 本地 V1；Feature Flag 继续默认关闭，未 commit/push/release。
- 已验证：Go 全量/vet、Rust 235 tests、前端 175 tests、正式 release binary、NSIS/MSI、bundled sidecar smoke、Grid/DB migration 与安全 Gate。
- blocked：Go race 需 CGO；真实 Forward 需 Runtime model；真实 Feishu/Weixin 需隔离凭据；updater/安装升级 G3 需签名私钥与隔离 Windows VM。
- 已发布：否。

# Explorer 右键打开独立 Session 与 Pane Shelf

## Checklist
- [x] 校验补丁包 manifest、SHA256、overlay 与参考测试
- [x] 对照当前 HEAD 复核 Explorer 注册表、单实例、session 与 Grid 调用链
- [x] 持久化菜单启用意图并清理重叠注册表入口
- [x] 使用有界单消费者队列创建独立 session，不重启运行中的后端
- [x] 新增 `new_pane` 路由、sessionId 精确 workDir 更新与事件去重
- [x] Pane 目录按 iframe 当前 sessionId 精确解析，移除全部缓存 workDir 回退
- [x] 支持六个可见、十二个总 pane 与 Pane Shelf
- [x] 修复 worker 世代归属竞态，并让异步打开失败拉起主窗口
- [x] 运行 Rust G0/G1 编译门、前端测试与生产构建

## Review
- 包内 `0001`–`0004` 是人工参考且包含并发失序、静默回退和重复 reducer 问题，未机械应用；实现复用现有 `/api/v1` client、RuntimeState queue 与 Zustand Grid store。
- Pane header 通过 iframe route handshake 获取当前 session，并用 `grid_get_session` 精确查询；打开前再次确认 session 未切换。
- `cargo check`、`cargo test --no-run`、前端 116 项测试和 `pnpm build` 通过；Rust 测试执行仍被本机既有 `STATUS_ENTRYPOINT_NOT_FOUND` 阻塞。
- Windows Explorer 真机矩阵属于 G3，发布前补跑；包含后端处于 `Stopping` 时右键打开、停止完成后请求可继续执行的窄窗口场景。

# Windows browser open bugfix

## Checklist
- [x] 确认 Windows URL 打开错误地复用了 `explorer`
- [x] 文件夹打开继续用资源管理器
- [x] URL 打开改用系统默认浏览器关联
- [x] 运行 Rust check 与 diff gate

## Review
- `open_external_url` 现在在 Windows 下走 `rundll32 url.dll,FileProtocolHandler <url>`。
- 只修共享后端函数，覆盖挂起窗格“在浏览器打开”和其他外链入口。

# Workspace Grid pane external link opening

## Checklist
- [x] 确认现有 Chat/旧 proxy 有 link bridge，但 DirectServer Code pane 不走旧 proxy 注入
- [x] 将 Tauri main window all-frames 初始化脚本从 chat-only 泛化到所有子 iframe
- [x] iframe 内跨站 `http/https` 链接和 `window.open` 通过 bridge 交给父窗口
- [x] 父窗口只接受 workspace origin 或当前 DOM 中 `.workspace-iframe` 的消息
- [x] 复用现有 `open_external_url`，不新增打开浏览器实现
- [x] 增加最小 jsdom 测试覆盖已知 iframe source 校验
- [x] 运行前端、Rust 与 diff gate

## Review
- 当前窗格内链接按“跨站链接外部打开、同源链接留在窗格内”处理。
- 这覆盖 Code / Chat / external iframe；native child Webview 内的页面仍由 Webview 自身承载，不在本轮加 hook。

# Workspace Grid pane interaction fixes

## Checklist
- [x] Code 空窗格和 header 切换 Code 不再自动创建 server session
- [x] 无 `sessionId` 的 Code pane 打开 Kimi Code Web 根页面，历史 session pane 继续支持 `/sessions/{id}`
- [x] Code pane 持久化当前 `workDir`，header 增加“打开此窗格目录”
- [x] pane header 增加每窗独立明暗主题切换，全局主题仍影响未单独设置主题的 pane
- [x] `addPane(input, targetSlotId)` 支持直接添加到指定空 slot，修复第四格按钮灰掉/不可用的根因
- [x] 支持拖动 pane header 到另一个 slot 交换或移动窗格
- [x] 更新 store/component 单测与 current-state 事实
- [x] 运行前端 test/tsc/build 与 diff gate

## Review
- 新建/切换 Code pane 现在只打开 Kimi Code Web 根页面，不再调用 `grid_create_session`；旧布局中已经有 `sessionId` 的 pane 仍按历史 session URL 渲染。
- per-pane 主题通过 iframe `postMessage` 即时同步；同源 Kimi Code Web 仍可能在页面重载后受共享 localStorage 影响，完全隔离需要后续 native Webview 或 Web 侧 storage carrier。
- 第四格问题由 store 层指定 slot 添加修复，不依赖添加后再 move。
- 拖拽交换只改变 slot 的 `paneId`，不改变当前 preset、track size 或 pane 内容。

# Workspace Grid toolbar and resize-shadow cleanup

## Checklist
- [x] 移除 Grid 内自定义布局工具栏
- [x] 不再渲染“保存布局 / 选择布局 / 已保存自定义布局尺寸”
- [x] Grid 根布局不再预留工具栏高度
- [x] resize handle 保留拖拽命中区但不再显示 hover/focus 阴影条
- [x] active pane 不再额外绘制布局阴影
- [x] 更新组件测试和 current-state 事实
- [x] 运行前端 test/tsc/build 与 diff gate

## Review
- 本轮只删可见 UI 和阴影视觉，不改 Grid store、preset 或 session 创建逻辑。
- 底层 saved layout helper 仍留给旧状态兼容；没有用户可见入口。

# Workspace Grid session API path payload fix

## Checklist
- [x] 确认仍失败的 root cause 是 API payload 边界可能继续携带 Windows verbatim/url-ish 前缀
- [x] 新增 `api_workspace_root`，把 `/?/D:/...` / `\\?\D:\...` 转成 `D:/...`
- [x] `POST /api/v1/workspaces` 的 `root` 使用同一 helper
- [x] `POST /api/v1/sessions` fallback 的 `metadata.cwd` 使用同一 helper
- [x] 补 Rust 单测覆盖坏输入和普通 `D:/repo`
- [x] 运行 Rust、前端与 diff gate

## Review
- 本轮只修后端 API payload 字符串，不改前端和 Grid UI。
- 外层路径归一化保留，但不再作为唯一防线。
- 验证结果：Rust fmt/check/test no-run、前端 test/tsc、`git diff --check` 均通过。

# Workspace Grid layout entry and path cleanup

## Checklist
- [x] 读取目标 objective，继续采用 `zustand` Grid slice 与 v1 fallback 决策
- [x] 修复 `/?/D:/...` workspace root 归一化为 `D:/...`
- [x] 三窗 preset 改为左侧一格、右侧上下两格
- [x] Grid 内 preset 数字按钮移到标题栏布局 popover
- [x] 移除空 pane 的 Kimi.com 添加入口
- [x] 移除 pane header 的 Kimi.com 切换入口
- [x] Grid resize/active 视觉改为中性色，不再显示黄色长线
- [x] 补前端与 Rust 单测覆盖本轮行为
- [x] 运行完整前端、Rust 与 diff gate

## Review
- 本轮只调整 Workspace Grid 的入口与修复坏路径，不拆旧 `WorkspaceView` 兼容层。
- 标题栏 popover 使用现有 6 个 preset，3 列展示；不新增真实 9 窗布局。
- external pane carrier 代码仍保留，用于已保存布局、fallback 和后续兼容，但 UI 不再提供 Kimi.com 新建/切换按钮。
- 验证结果：前端 test、tsc、build 通过；Rust fmt/check/test no-run 通过；`git diff --check` 通过。直接执行 Rust test binary 仍受本机既有 `STATUS_ENTRYPOINT_NOT_FOUND` 限制。

# Workspace Grid hardening review fixes

## Checklist
- [x] 确认目标文件中的两个决策：Grid 状态切片采用 `zustand`，v1 承载 DoD 以可见 fallback + 外部打开为基线
- [x] `buildCodePaneUrl` 保留运行时 `#token=` hash，避免纯 session 布局恢复后丢 bootstrap
- [x] 新增 pane 默认 `mountPolicy: "eager"`，让新加窗格立即可见
- [x] 现有窗格切换到 Code 时调用 `grid_create_session` 创建真实 server session
- [x] 嵌入式 Tauri 子 Webview 激活后卸载对应 iframe，避免双 carrier 资源和焦点冲突
- [x] 持久化 Grid state 加载/恢复时归一化未知 preset、幽灵 slot、重复/超限 pane 和失效 active/maximized pane
- [x] 补单测和组件测试覆盖上述行为
- [x] 运行前端、Rust、Go 与 diff gate

## Review
- 本轮处理 Workspace Grid 审查中剩余的 P1/P2 收口项，保持现有 Pane/Slot + zustand 架构，不引入新的 picker UI 或大范围重构。
- Code session URL 的 `#token=` 只来自运行时 `codeRemoteUrl`，不会写入 Grid persisted state、saved layout 或 changelog。
- 切换已有 pane 为 Code 现在与空 slot 新增 Code 一样先建真实 server session，不再产生无 session 的 Code pane。
- 嵌入式 Webview 成功接管外部页面后，React iframe 不再留在同一 pane DOM 内。
- 坏 localStorage 会被收敛回可渲染状态；未知 preset fallback 到 `1x2`，pane 上限仍是 6。
- 验证结果：`pnpm --dir apps/kimi-shell test`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run`、`go test ./...`（`apps/kimi-im-bridge`）通过。

# Workspace Grid native Webview storage namespace

## Checklist
- [x] 每个 Grid pane 持有稳定 `storageNamespace`
- [x] 旧持久化 panes 缺少 namespace 时按 pane id 补齐
- [x] 嵌入式子 Webview 使用 pane namespace 作为 Tauri `dataDirectory`
- [x] 独立 WebviewWindow fallback 使用同一个 pane namespace
- [x] 单测覆盖 legacy pane namespace 补齐，组件测试覆盖 native carrier 调用参数

## Review
- 本轮推进 WG-8 的 native Webview per-pane localStorage namespace：Tauri `Webview` / `WebviewWindow` carrier 通过 `dataDirectory` 隔离本地存储。
- 当前仓库没有 `apps/kimi-web`，DirectServer code pane 仍是同源 iframe carrier；iframe 级 localStorage 隔离不能只靠 shell state 补丁完成。

# Workspace Grid embedded external Webview

## Checklist
- [x] 增加 Tauri v2 子 `Webview` service，复用现有 `urlSafety`
- [x] 外部页 blocked fallback 增加“在窗格内打开”
- [x] 子 Webview 根据 pane bounds 创建，并在 resize/scroll/source change/unmount 时同步或销毁
- [x] 给 main capability 增加 create/focus/position/size/close 子 Webview 权限
- [x] 组件测试覆盖 iframe 超时后调用嵌入式子 Webview

## Review
- 本轮推进 WG-7 的窗格内承载方案：被 iframe 阻止的外部页可选择嵌入式 Tauri 子 Webview，独立 WebviewWindow 仍作为退路。
- 后续已补齐 native Webview per-pane `dataDirectory` namespace；真实 Tauri 桌面中 z-order/focus/DPI 行为还需要人工点击验证。

# Workspace Grid external WebviewWindow fallback

## Checklist
- [x] 增加外部 URL WebviewWindow service，复用现有 `urlSafety`
- [x] 外部页挂起/blocked fallback 增加“在应用窗口打开”
- [x] 给 main capability 增加 `core:webview:allow-create-webview-window`
- [x] 组件测试覆盖 iframe 超时后调用 WebviewWindow fallback

## Review
- 本轮推进 WG-7 的退路方案：被 iframe 阻止的外部页可在独立应用 WebviewWindow 承载。
- 嵌入式子 Webview 与 native Webview per-pane `dataDirectory` namespace 已在后续切片补齐。

# Workspace Grid resizable custom tracks

## Checklist
- [x] 增加 `trackSizes` 持久化字段，保存自定义列/行比例
- [x] Grid canvas 增加列/行 seam 拖拽 handle
- [x] preset 切换时清除不匹配的 custom tracks
- [x] 命名布局保存/恢复自动携带 sanitized track sizes
- [x] 单测覆盖 track resize clamp、持久化与 preset 清理
- [x] 组件测试覆盖拖拽 handle 后写入 store

## Review
- 本轮推进 WG-8 的“逐缝拖拽 resize + 持久化 custom template”；custom template 先实现为当前 preset 的列/行 `fr` track sizes。
- 后续已补齐 WG-7 子 Webview 与 native Webview per-pane `dataDirectory` namespace。

# Workspace Grid named layouts

## Checklist
- [x] 复用现有 sanitized grid state 快照保存命名布局
- [x] 工具栏支持保存当前布局并从下拉框恢复
- [x] 恢复布局时清除 transient 最大化状态
- [x] 单测覆盖 URL fragment 不入保存布局、恢复布局
- [x] 组件测试覆盖保存后切换预设再恢复

## Review
- 本轮推进 WG-8 的“命名布局保存/恢复”；未引入 modal 或新状态库，先用原生 `prompt`/`select`。
- 后续已补齐 WG-7 子 Webview、native Webview per-pane `dataDirectory` namespace 和逐缝拖拽 resize。

# Workspace Grid v1 hardening

## Checklist
- [x] 支持方向键切换 active pane
- [x] 外部网页 pane 支持输入自定义 `http/https` URL，并继续剥离 fragment
- [x] mount policy 具备可见挂起/恢复行为，非活跃 on-focus pane 可延迟挂载
- [x] 顶栏状态展示运行中 Code Session 数量
- [x] 增加 jsdom + React Testing Library 组件级测试，覆盖键盘切换、自定义外部 URL、挂起/恢复
- [x] 运行前端、Rust、Go 与 diff gate

## Review
- 本轮补齐 WG-4/WG-5/WG-6 中上一轮仍偏弱的交互证据：键盘切换、custom external URL、mount policy 行为和状态区运行数量。
- `jsdom` 固定为 `24.1.3`，避免把本仓库 README 里的 Node 18+ 要求悄悄抬到 Node 20+。
- 真实已安装应用当前是旧包且窗口为 13x13，不能作为新源码视觉证据；本轮用组件级 jsdom 测试补强 UI 行为证据。

# Workspace Grid renderer and session commands

## Checklist
- [x] 替换 `WorkspaceView` 内部写死双窗渲染，改为 `WorkspaceGridView` + `PaneFrame`
- [x] 接入 1/2/3/4/5/6 预设、空 slot、窗格关闭、最大化和内容切换
- [x] 外部页使用 timeout fallback + 浏览器打开，不依赖 iframe `onError`
- [x] 将旧 titlebar 的单窗/双窗/换位按钮同步到 Grid store
- [x] 新增 `grid_list_sessions` / `grid_create_session` Tauri command 与前端 service
- [x] 空 Code slot 在存在工作目录时通过 server 创建真实 session，并用 `/sessions/{id}` URL 渲染
- [x] 运行 Vitest、TypeScript、Vite build、Rust fmt/check 与 diff check

## Review
- `WorkspaceView` 现在只作为兼容入口，实际渲染由 `features/workspace-grid/WorkspaceGridView.tsx` 与 `PaneFrame.tsx` 承担。
- Grid v1 已覆盖 WG-2，并推进 WG-3/WG-4/WG-5/WG-6 的最小闭环；Tauri 子 Webview 和 v2 per-pane 隔离仍留在 WG-7/WG-8。
- 验证结果：`pnpm --dir apps/kimi-shell test`、`.\node_modules\.bin\tsc.cmd --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo fmt -- --check`、`cargo check`、`git diff --check` 通过。
- 补充验证：使用临时 `KIMI_CODE_HOME` 启动本机 `kimi server run --foreground`，通过 `/api/v1/workspaces` 和 3 次 `/api/v1/sessions` 创建验证，返回 3 个 distinct server session id。

# Workspace Grid v1 foundation

## Checklist
- [x] 读取目标文件，确认 Workspace Grid 先落 WG-0/WG-1 基础切片
- [x] 建立 README First、架构和设计系统上下文
- [x] 确认 DR-A：Workspace Grid v1 采用 `zustand` 作为独立状态切片试点
- [x] 确认 DR-B：v1 外部页承载只承诺可见 fallback + 外部打开，不要求自动子 Webview
- [x] 新增 Vitest 基线、`pnpm test`、workspace-grid 状态/迁移/URL 纯逻辑和单测
- [x] 运行 `pnpm test`、`tsc --noEmit` 与 `git diff --check`

## Review
- 本轮只完成 WG-0/WG-1 的最小可验证基础：`workspace-grid` 新目录包含 Pane/Slot 分离类型、预设、旧双窗 localStorage 迁移、zustand store、selector、`paneUrl` 与 `urlSafety`。
- 已新增 accepted ADR：`.ai/decisions/2026-06-28-workspace-grid-v1.md`。
- 现有 `WorkspaceView` 和 `useShellController` 未接入新 store，双窗 UI 行为保持不变；WG-2 才替换渲染器。
- 验证结果：`pnpm --dir apps/kimi-shell test` 通过；`.\node_modules\.bin\tsc.cmd --noEmit`（`apps/kimi-shell`）通过；`git diff --check` 通过，仅有既有 CRLF 提示。

# kimi-code v3 迁移与 IM Bridge 安全门禁

## Checklist
- [x] 读取粘贴的 v3 整合目标，收敛当前线程目标
- [x] 建立 README First 上下文并记录 `.ai/CONSTITUTION.md` / `.ai/architecture` 缺失风险
- [x] 盘点 Shell backend、workspace session 与 Bridge 启动 token 触点
- [x] 修复 Bridge admin / host-control token 命令行暴露：Shell 改 env，sidecar 支持 env/token-file
- [x] 切换 Shell 后端主路径到 `kimi server run --foreground --port <port>`
- [x] 新增 server token resolver，生成 `/#token=` workspace URL
- [x] 暂停 P1A 默认 workspace proxy 与旧 `/api/sessions` bootstrap
- [x] 补 `.ai/architecture` 当前事实和验证入口
- [x] 新增 Rust `api_v1_client` 薄客户端，统一 Bearer 与 envelope 解包
- [x] 写出 Shell `kimi_runtime_locator.json`，并传给 Bridge sidecar
- [x] Bridge status 暴露 runtime locator 配置/可读/health 状态
- [x] 用 `/api/v1` 替换 Shell workspace/session 调用，并恢复 DirectServer ready 后 session bootstrap
- [x] 新增 Bridge `RuntimeAdapter` 契约与 `KimiCodeServerAdapter` REST 地基，并在 status 暴露 runtime adapter 状态
- [x] Bridge admin `/api/v1/*` 改为 `{ ok, data, error, requestId }` envelope，Shell client 兼容新旧响应
- [x] Bridge stdout/stderr、bridge log tail 与 Go logger 纳入已知 secret redaction
- [x] 运行最小验证并记录结果
- [x] 把 Bridge channel prompt 主路径切到 `KimiCodeServerAdapter`
- [x] 接入 `/api/v1/ws` prompt 事件流的最小内容/状态/approval 映射
- [x] 完成 server pending approval reconcile 与本地持久 projection
- [x] 实现 ACPAdapter 实验性 stdio/JSON-RPC smoke
- [x] 实现 SDKAdapter wrapper
- [x] 通过 Bridge metadata 映射 server prompt controls：model、thinking、permission、plan、swarm、goal
- [x] P3 安装主链路移除 uv/Python：Kimi 安装改官方 install.ps1，升级改 `kimi upgrade`，core ready 不再依赖 uv/Python
- [x] P3 Git Bash 检测与 `KIMI_SHELL_PATH` 配置：Shell 启动 server 时自动注入检测到的 Git Bash 路径
- [x] P3 Bridge sidecar installed-build smoke：重建 bundled `kimi-im-bridge.exe`，token-file 启动、health/status envelope、runtime stop 和输出 redaction 通过
- [x] P4A `kimi doctor`：控制中心运行诊断面板可直接执行 `kimi doctor`，展示 exit code、路径与脱敏输出
- [x] 后续：把 server-only recovered approvals 重新投递成 Telegram/Feishu IM approval card
- [x] 后续：把 ACPAdapter manual approval 从 live auto/cancel 升级为当前进程内异步 resolve
- [x] 收口本地开发门禁与剩余 P5 真凭证手工门禁边界

## Review
- 已先落 v3 明确标为高风险的 Bridge secret transport 门禁，并开始 P1A DirectServer 主路径迁移。
- DirectServer 主路径已推进：Rust lifecycle 现在启动 `kimi server run --foreground --port <port>`，读取 `KIMI_CODE_HOME/server.token`，并把 `/#token=` URL 交给前端。
- P1B 地基已推进：新增 `api_v1_client`，Shell workspace/session 调用已改到 `/api/v1`，Shell 写出不含明文 token 的 runtime locator，Bridge 接收 locator 并在 status 中报告可读性。
- P4C 主路径已推进：Bridge 新增 `RuntimeAdapter` 契约和 `KimiCodeServerAdapter` REST/WS 客户端；Telegram/Feishu/Weixin 通过 bridgecore orchestrator 优先走 server-backed runtime provider，创建新 binding 时使用 server 返回的真实 session id，旧 synthetic binding 会在 server run 后 rebind。
- `/api/v1/ws` 已接入 prompt 事件流的最小映射，覆盖 assistant/thinking delta、status、turn/prompt completion 和 approval requested/resolved。
- Server pending approval reconcile 已接入：Bridge 启动时按本地 pending 与已知 server session/binding 查询 server pending，保留仍 pending 的审批、将 server 确认不存在的本地 pending 标为 `stale_failed`，并为同一 session 下 server-only pending 重建带 chat context 的本地 projection。
- `internal/runtime` 已补 `SDKAdapter` wrapper 与实验性 `ACPAdapter`。ACPAdapter 具备 stdio JSON-RPC transport、initialize/session/new/session/resume/session/prompt/session/cancel 的 smoke 覆盖；manual approval 已在当前进程内支持 live async resolve，但尚无跨 Bridge 重启恢复。
- Server provider 已从 `MetadataJSON` 读取 `runtime_controls` / `controls`，映射 model、thinking、permission mode、plan、swarm 和 goal controls；未新增配置 UI。
- P3 安装链路已推进：Shell quick/core Kimi 安装不再串联 uv/Python，改用 Kimi Code 官方 Windows installer；升级改走 `kimi upgrade`；卸载清理托管 Kimi CLI binary/npm package；旧 `backend_manager/install_compat.rs` uv/Python 安装路径已删除；安装文档同步移除 uv/Python 主路径。
- P3 Git Bash 已接入：Shell 会检测现有 `KIMI_SHELL_PATH`、Git for Windows `bash.exe` 常见路径或 PATH `bash`，启动 `kimi server run` 时写入 `KIMI_SHELL_PATH`，安装面板展示 Git Bash 状态和检测路径。
- P3 Bridge sidecar installed-build smoke 已补：`apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe` 已由当前 Go 源码重建，使用 token files 启动后 `/healthz`、`/api/v1/status` envelope、`/api/v1/runtime/stop` 和 stdout/stderr/log token redaction 检查通过。
- P4A `kimi doctor` 已接入：控制中心运行诊断面板新增手动运行入口，Shell 后端调用本机 `kimi doctor` 并对已知 API key / token / secret 做精确值脱敏后返回 UI。
- Recovered approval redelivery 已接入：Telegram/Feishu adapter 启动后会扫描 pending approvals，用既有 delivery key 幂等重投递 approval card；Feishu 仅在 binding 有 last inbound message id 时重投递以保持线程/回复上下文。
- ACPAdapter manual approval 已从 auto/cancel smoke 升级为 live async：`session/request_permission` 会在 manual mode 下登记 pending approval、发出 approval event，并等待 `ResolveApproval` 返回 ACP selected/cancelled outcome；跨 Bridge 重启恢复仍未实现。
- Admin API 已收紧：sidecar `/api/v1/*` 返回稳定 envelope，Rust `BridgeHttpClient` 已支持 envelope unwrap，并保留旧裸 JSON 兼容。
- Bridge 日志安全门禁已推进：Go logger 会 redaction admin/host-control 与平台密钥；Shell 托管的 sidecar stdout/stderr 通过 redactor 写入 bridge log，UI log tail 与失败摘要也会二次 redaction。
- 本地代码门禁已收口到 P4C：Shell 自有 UI 不新增独立 prompt composer/全局 approval inbox，主交互继续由官方 Kimi Code Web 承载；Bridge approval 由 IM card 与 Bridge runtime panel 承载。
- P5 未在本地自动完成：真实 Telegram/Feishu/Weixin 凭证、NSIS/MSI 安装包环境、OpenAPI/AsyncAPI CI 快照和发布回退仍是发布前手工/专用环境门禁，不阻塞本轮代码合并。
- 验证结果：`go test ./...`（`apps/kimi-im-bridge`）通过；`cargo check` 通过；`cargo test --no-run` 通过；`.\node_modules\.bin\tsc.cmd --noEmit` 通过；`git diff --check` 通过。
- 已知限制：Rust 测试二进制运行在当前 Windows 环境仍报既有 `STATUS_ENTRYPOINT_NOT_FOUND`，未执行到断言阶段。

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
- [x] 提交当前工作区改动并推送 `main`
- [x] 创建并推送 `v0.0.42` tag
- [x] 创建 GitHub release 并上传 `0.0.42` 的 NSIS / MSI 安装包

### Review
- 发版边界：当前版本号已统一到 `0.0.42`，本次发版内容包含两类改动：一是 `kimi-cli/web` 上游源码基线与维护边界落库，二是本地增强版 same-origin 注入的第二阶段中文固定文案扩展；运行时仍保持官方 workspace proxy + 注入模式。
- 发布文档：已新增 `apps/kimi-shell/docs/release-notes-0.0.42.md`，内容覆盖上游 `web/` 基线、第二阶段全注入扩展、保持运行时边界不变，以及 `0.0.42` 的验证和已知限制；已新增 `update/updatenote_202604250034.md`，概括同一批改动及用户影响。
- 安装包产物：已确认本地存在 `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.42_x64-setup.exe` 与 `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.42_x64_en-US.msi`，可用于 GitHub release 上传。
- 自动化验证：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过。
- diff 检查：`git diff --check` 已于 2026-04-25 执行，未发现内容级错误，仅剩当前工作区 CRLF 提示。
- Git 提交：已创建 `f170ddf release: ship v0.0.42`，并已推送到 `origin/main`。
- 标签：`v0.0.42` 已创建并推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.42`，地址为 `https://github.com/endearqb/kimi-app/releases/tag/v0.0.42`；已上传 `0.0.42` 的 NSIS 与 MSI 安装包，且已设置为 latest。
- 已知限制：本轮仍未完成安装版 UI 点击回归；Rust 测试二进制在当前 Windows 环境仍受既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 影响，未能执行到断言阶段。

## 红框区域中文注入扩展

### Checklist
- [x] 复查现有增强注入表、截图定位结果和上游文案来源，锁定仅新增红框区域及相邻固定文案
- [x] 扩展 `workspace_injection.rs` 的翻译分组，补齐 `Thought`、工具标签、活动状态、输入区提示、右键菜单和上下文占用文案
- [x] 在不引入复杂 DOM 特判的前提下，为 `Thought for {n}s`、`{percent}% context`、`{n} selected` 增加轻量动态句式匹配
- [x] 更新 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md`，补充第三阶段注入覆盖范围和仍排除的动态文本
- [x] 更新 `apps/kimi-shell/docs/kimi-web-maintenance.md`，明确第三阶段动态句式边界与停止扩注入条件
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录新增注入命中范围、动态句式策略和验证结果

### Review
- 注入脚本：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仍保持单一 same-origin 注入入口；本轮只新增 `ai_reasoning_and_tools`、`chat_activity_and_composer`、`session_context_menu_and_multiselect`、`toolbar_context_usage` 四组翻译，不改观察器和属性覆盖机制。
- 新增覆盖：本轮补齐了 `Thought` / `Thinking...` / `Thought for {n}s`、`Copy`、工具标签 `Edit` / `Read` / `Search` 及同源工具名、`Awaiting input`、批准等待、上传/连接/启动环境状态、输入框提示、`Collapse input` / `Expand input`、`Stop generation` / `Queue message`、会话右键菜单 `Rename` / `Archive` / `Unarchive` / `Select Multiple`、多选条 `Select all` / `Deselect all` / `{n} selected`、以及右下角 `{percent}% context` 和 token 用量说明。
- 动态句式：仅新增三类轻量模式匹配：`Thought for {n}s`、`{percent}% context`、`{n} selected`；没有引入通用正则翻译器，也没有加任何 DOM 结构特判。
- 排除边界：本轮继续排除了 `approval.description`、`approval.sender`、`currentQuestion.*`、模型输出正文、用户消息正文、文件路径、URL 和工具参数本体；例如 `Edit (D:\...)` 只翻译 `Edit`，路径保持原样。
- 文档：`apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已补充“第三阶段”注入覆盖状态；`apps/kimi-shell/docs/kimi-web-maintenance.md` 已明确第三阶段只允许三类变量句式，并重申超过该边界就应停止扩注入、转源码 patch。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 未覆盖项：本轮未启动桌面应用做手工点击回归，因此截图里的 `Thought` 折叠头、工具调用行、输入区状态、右键菜单、多选条和 `% context` 仍需你在真实界面点一遍确认最终命中效果。

## 快速设置安装区调整

### Checklist
- [x] 在安装主操作区增加第二行 `安装 Git` / `安装 Node.js` 快捷按钮
- [x] 移除详细选项中的重复“可选增强”入口
- [x] 官方源 tab 下隐藏镜像策略卡
- [x] 镜像源 tab 切换不自动检测，改为手动点击检测按钮触发
- [x] 运行 `tsc --noEmit`、`build`、`cargo check` 并记录结果

### Review
- 主操作区：`InstallFlowTaskContent` 现在将 `install_git` 与 `install_nodejs` 放在安装 / 升级按钮下方第二行，沿用现有探测状态禁用逻辑和任务执行路径。
- 详细选项：已移除原“可选增强”重复卡；官方源只保留来源切换，镜像策略仅在镜像源下显示。
- 镜像检测：点击镜像源 tab 只切换来源；只有点击“检测镜像源”才调用镜像健康检测，并固定以 `preferredSource: "mirror"` 检测。
- 验证结果：`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已通过。

## 左上角品牌名注入

### Checklist
- [x] 复查品牌标题来源，确认左上角 `Kimi Code` 是独立文本节点而非图片资源
- [x] 在 `workspace_injection.rs` 中新增精确品牌映射 `Kimi Code` → `Kimi 小助手`，且不引入更宽的 `Kimi` 匹配
- [x] 更新维护文档与盘点文档，明确当前仅替换可见标题，不改 logo、版本号、链接和可访问属性
- [x] 运行 `check:enhanced-web:i18n`、`check:enhanced-web:compliance`、`tsc --noEmit`、`build`、`cargo check` 与 `git diff --check`
- [x] 在本节补充 Review，记录品牌注入边界、验证结果和仍需手工确认的点

### Review
- 标题来源：已确认上游 `apps/kimi-shell/third_party/kimi-cli-web/upstream-web/src/components/kimi-cli-brand.tsx` 中左上角品牌由 `/logo.png` 图片、独立文本 `Kimi Code` 和独立版本文本 `v{kimiCliVersion}` 组成；红框内文字不是图片。
- 注入范围：`apps/kimi-shell/src-tauri/src/backend_manager/workspace_injection.rs` 仅新增 `brand_identity` 分组，并加入精确映射 `Kimi Code` → `Kimi 小助手`；没有新增 `Kimi` 这类宽匹配，也没有改动现有观察器、属性覆盖逻辑或 logo/版本/链接逻辑。
- 文档：`apps/kimi-shell/docs/kimi-web-maintenance.md` 与 `apps/kimi-shell/docs/kimi-web-i18n-inventory.md` 已补充品牌注入边界，明确当前只替换可见标题，不改 `/logo.png`、版本号、外链和 `alt`/`title`/`aria-label`。
- 验证结果：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过；`git diff --check` 仅剩 CRLF 提示，无内容级错误。
- 手工确认：本轮未启动桌面应用做点击回归，因此仍需在真实界面确认左上角已显示 `Kimi 小助手 v1.39.0`，且黑底 `K` logo、品牌链接和版本号展示保持不变。

## v0.0.43 发版执行

### Checklist
- [x] 复查当前工作区 diff、版本号与本地 `0.0.43` 安装包产物，确认发版边界
- [x] 撰写 `apps/kimi-shell/docs/release-notes-0.0.43.md`
- [x] 撰写 `update/updatenote_202604251248.md`
- [x] 运行本次发版所需验证命令并记录结果
- [x] 提交当前工作区改动并推送 `main`
- [x] 创建并推送 `v0.0.43` tag
- [x] 创建 GitHub release 并上传 `0.0.43` 的 NSIS / MSI 安装包

### Review
- 发版边界：当前版本号已统一到 `0.0.43`。本次发版内容集中在两块：一是增强版官方 Web 的第三阶段中文注入扩展与左上角品牌标题 `Kimi 小助手` 注入；二是控制中心安装流程区的快捷操作与镜像检测交互调整。
- 发布文档：已新增 `apps/kimi-shell/docs/release-notes-0.0.43.md`，覆盖第三阶段注入扩展、品牌标题本地化、安装流程区调整与 `0.0.43` 验证结果；已新增 `update/updatenote_202604251248.md`，概括同一批改动及用户影响。
- 安装包产物：已确认本地存在 `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.43_x64-setup.exe` 与 `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_0.0.43_x64_en-US.msi`，可用于 GitHub release 上传。
- 自动化验证：`pnpm --dir apps/kimi-shell check:enhanced-web:i18n`、`pnpm --dir apps/kimi-shell check:enhanced-web:compliance`、`pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`、`pnpm --dir apps/kimi-shell exec tsc --noEmit`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 已于 2026-04-25 通过。
- diff 检查：`git diff --check` 已于 2026-04-25 执行，未发现内容级错误，仅剩当前工作区 CRLF 提示。
- Git 提交：已创建 `261a3e6 release: ship v0.0.43`，并已推送到 `origin/main`。
- 标签：`v0.0.43` 已创建并推送到 GitHub。
- Releases：已创建 `Kimi Desktop Shell v0.0.43`，地址为 `https://github.com/endearqb/kimi-app/releases/tag/v0.0.43`；已上传 `0.0.43` 的 NSIS 与 MSI 安装包，且已设置为 latest。

## SPEC-08 Phase 0：Kimi Code 接入后端收敛

### Checklist
- [x] 复用 `KIMI_CODE_HOME` 解析，默认配置路径切到 `~/.kimi-code/config.toml`
- [x] 新增 Kimi Code 接入配置读取、保存和连接测试命令
- [x] 保存时只 patch `kimi-app-api-key` provider、`kimi-app/kimi-for-coding` model、`moonshot_search` / `moonshot_fetch` 的白名单字段
- [x] 保存前创建并轮转 `config.toml.kimi-app-backup-*`
- [x] API key 只返回掩码状态，不在新命令中返回明文
- [x] 禁用旧全量 `save_kimi_cli_config_center`
- [x] 子 Agent 并发上限进入 App settings，并在启动 Kimi Code 时注入 `KIMI_CODE_AGENT_SWARM_MAX_CONCURRENCY`
- [x] 运行 Rust fmt/check/test-no-run 并记录 Windows test binary 执行限制

### Review
- Phase 0 后端地基已完成；旧全量读取暂保留给 auth/status 兼容，旧全量保存已被拒绝。
- 验证结果：`cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 通过；执行 `cargo test ... config -- --nocapture` 仍受本机既有 `STATUS_ENTRYPOINT_NOT_FOUND` 限制。

## SPEC-08 Phase 1：Kimi Code 接入配置面板

### Checklist
- [x] 新增“Kimi Code 接入配置”面板
- [x] 新增 API Base URL / API Key 表单
- [x] 新增 Search / Fetch service 表单
- [x] 新增子 Agent 并发上限表单
- [x] 移除 providers/models/services/defaults/loop/MCP 全量编辑区
- [x] 保留官方配置状态只读诊断
- [x] 更新控制中心文案
- [x] 运行 `tsc --noEmit`、前端测试、前端 build 和 `cargo check`

### Review
- 控制中心已不再暴露全量 Kimi Code `config.toml` 编辑器；当前只允许编辑 SPEC-08 白名单字段，并通过新 Tauri command 保存。
- 快速 Kimi API 设置入口已复用新的 `save_kimi_code_access_config`，不再调用旧 `save_kimi_cli_api_config` 写入旧路径。
- 连接测试按钮已接入 `test_kimi_code_access_config`，UI 不展示明文 API key，仅显示配置状态和脱敏结果。
- 验证结果：`.\node_modules\.bin\tsc.cmd --noEmit` 通过；`pnpm --dir apps/kimi-shell test -- --run` 通过（4 files / 36 tests）；`pnpm --dir apps/kimi-shell build` 通过；`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` 通过。
- 未完成项：旧 provider 的显式迁移按钮尚未实现，留待后续小步补齐。

## SPEC-08 Phase 2：Skill 投影与工作区管理

### Checklist
- [x] 将控制中心 Skill 分区命名为“Skill 投影与工作区管理”
- [x] 用户全局默认投影目录改为 `~/.agents/skills`
- [x] 新增显式投影到 `$KIMI_CODE_HOME/skills`
- [x] 当前工作区投影容器收敛为 `.agents/skills` 与 `.kimi-code/skills`
- [x] `~/.config/agents/skills` 只保留为 legacy discovery
- [x] 未信任 Skill 不可通过普通 apply 或 workspace target copy 投影
- [x] 运行 `tsc --noEmit`、前端测试、前端 build、Rust check 和 Rust test no-run

### Review
- Phase 2 已完成目录边界收敛；`.codex/.claude` 保留类型兼容但不再作为新 workspace target 主入口。
- 后端新增 `kimi_code_home` scope，复用全局投影记录但移除动作按 scope 精确删除。
- 前端按钮、chips、容器 tab 和标题栏入口已改为 Skill 投影语义，并隐藏未信任 Skill 的 workspace target 投影候选。
- 验证结果：`.\node_modules\.bin\tsc.cmd --noEmit`、`pnpm --dir apps/kimi-shell test -- --run`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run` 均通过。
- 未完成项：真实桌面点击投影到 `$KIMI_CODE_HOME/skills` 和 `.kimi-code/skills` 仍需人工验证。

## SPEC-08 Phase 3：外部 IM 通道配置

### Checklist
- [x] Bridge 文案明确为“外部 IM 通道配置”
- [x] 新建机器人菜单补齐 Telegram / Feishu / Weixin
- [x] Telegram / Feishu / Weixin 配置 UI 与高级运行面板均保留
- [x] Telegram bot token、Feishu appSecret / verificationToken / encryptKey、Weixin bot token 不明文展示为已保存值
- [x] Feishu verificationToken / encryptKey 加入已保存凭据掩码状态
- [x] Bridge controls 不写官方 `config.toml`，继续通过 runtime metadata/controls
- [x] approval / binding / session / runtime diagnostics 保留
- [x] 运行前端、Rust 与 Go bridge 验证

### Review
- Phase 3 已完成；`apps/kimi-im-bridge` sidecar 名称保持不变，控制中心用户入口改为“外部 IM 通道配置”。
- 新建机器人入口现在覆盖 Telegram、微信、飞书；高级运行面板可正确显示 Weixin 平台与凭据掩码。
- secrets 继续只展示 masked/configured 状态，未把完整 token/appSecret/encryptKey 暴露到 UI。
- 验证结果：`.\node_modules\.bin\tsc.cmd --noEmit`、`pnpm --dir apps/kimi-shell test -- --run`、`pnpm --dir apps/kimi-shell build`、`cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`、`go test ./...`（`apps/kimi-im-bridge`）均通过。
- 未完成项：真实桌面三平台创建/保存/高级面板点击仍需人工验证。

## 小助手设置区收敛与环境探测修复

### Checklist
- [x] 删除五个设置栏操作区的重复状态徽章并右对齐按钮
- [x] 修复 Git Bash 的环境变量、PATH、Git 根目录和常见安装目录探测
- [x] 在安装更多选项中恢复 uv / Python 3.13 legacy repair 入口
- [x] 扁平化右键菜单、API 配置和默认工作目录详情
- [x] 移除 Telegram 默认项、新建入口及已保存 connector/secrets
- [x] 将微信/飞书扫码改为机器人行内直接展开二维码
- [x] 补充前端与 Rust 单测、ADR、README、架构事实和变更记录
- [x] 运行类型检查、前端测试/build、Rust fmt/check/test-no-run 和 diff 检查

### Review
- API 配置继续复用既有脱敏读写和连接测试命令，不再创建二级任务面；扫码继续复用现有 onboarding session 和轮询。
- `AppSettings` schema 9 只迁移历史默认菜单名，保留自定义值；启动自愈会重写已启用的 Explorer 菜单。
- Telegram 清理在 Shell 初始化时幂等执行，不写日志或备份 secrets；Go Bridge adapter 保留。
- 自动验证通过：TypeScript、Vitest 12 files / 86 tests、Vite build、cargo fmt check、cargo check、cargo test no-run、git diff check。
- Rust 测试二进制执行仍被本机既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 阻塞；真实 Explorer、Git Bash 和微信/飞书扫码需在 Tauri 窗口手工验证。

## 自定义路径 Git Bash 升级预检修复

### Checklist
- [x] 复用 `kimi_locator::locate_shell_path()`，向安装任务 PowerShell 子进程注入 `KIMI_SHELL_PATH`
- [x] 覆盖 managed file、inline retry 和 elevated fallback 三条启动路径
- [x] 增加最小命令环境回归测试
- [x] 运行 Rust fmt check 和 cargo check

### Review
- 根因是安装面板与升级脚本使用了两套不一致的 Git Bash 探测；现在 PowerShell 子进程直接继承统一 locator 的结果。
- `cargo fmt -- --check`、`cargo check` 通过；目标测试完成编译，但执行仍受既有 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 阻塞。
- 待在真实 Tauri 窗口验证 `D:\Program Files\Git\bin\bash.exe` 条件下的升级任务。

## 设置主操作按钮右对齐

### Checklist
- [x] 设置列表和卡片头显式占满可用宽度
- [x] 五个桌面主操作按钮统一靠右
- [x] 保留 `820px` 以下单列堆叠布局
- [x] 运行 TypeScript 检查、Vite build 和 diff 检查

### Review
- 本次只调整 `App.css`，未修改组件、交互或按钮尺寸。
- 纯 Web 预览受 Tauri IPC 限制停在启动页；需要在真实 Tauri 控制中心补做最终截图复核。

## kimi-app review fix kit 审核后适配

### Checklist
- [x] 校验工具包基线、manifest、SHA256 和 check-only 行为
- [x] 核验 5 个问题在 `main@c2aaa14` 仍真实存在
- [x] 显式收紧 Tauri 自定义 command 的窗口权限，并恢复 Picker 目录对话框权限
- [x] 隔离 Picker 路由的安装、轮询、Skill 和 loading 后台副作用
- [x] 串行 Bridge `Start` / `Shutdown`，严格拒绝多 JSON 请求体
- [x] 清理异步迟到的嵌入式 Webview controller
- [x] 补齐自动测试、README、架构事实和变更记录
- [x] 运行前端、Rust、Go 与 diff gate，并记录 blocked 的手工/环境门禁

### Deferred TODO：轮询 single-flight / 响应代次
- What：为状态、Bridge 详情和日志轮询增加每个轮询域独立的 single-flight 或 generation 控制。
- Why：固定间隔触发的慢请求可能重叠，较旧响应晚到时可能覆盖新状态。
- Pros：消除轮询重入和旧响应回写，降低后端阻塞时的请求放大。
- Cons：需要逐个确认各刷新函数的取消、错误和可见性语义，不适合混入本轮权限修复。
- Context：入口为 `src/app/useShellPollingController.ts`；本轮只在 Import Picker 路由禁用这些轮询，不改变主窗口轮询模型。
- Depends on / blocked by：先为状态、Bridge 详情和日志轮询建立可独立断言的回归测试。

### Deferred TODO：Workspace embed URL 启动周期保护
- What：为 `useWorkspaceEmbedUrl` 的异步刷新增加请求 generation，并只接受当前 `startCycleId` 的返回值。
- Why：快速重启时旧启动周期的响应可能晚到并覆盖新的 embed URL。
- Pros：避免 iframe 在重启竞态下回退到旧 runtime 地址。
- Cons：需要覆盖启动、重试和状态切换时序，和本轮 child Webview controller 生命周期不是同一问题。
- Context：入口为 `src/app/useWorkspaceEmbedUrl.ts`；本轮 generation 只保护 Workspace Grid 的原生 child Webview 创建。
- Depends on / blocked by：需要可控 deferred response 测试覆盖两个启动周期的逆序返回。

### Review
- Tauri：135 个自定义 commands 已进入应用 manifest；`main`、`prefill`、`workspace-import-picker` 分别使用完整、6 项和 4 项 command permission，现有 command registry 门禁同步检查 build、permission 与 capability。
- Picker：独立窗口保留目录选择和 4 个导入命令；安装 Channel、轮询、Skill 刷新、loading 上报及完成后的全局状态刷新均被隔离，主窗口 modal 的完成后刷新保持不变。
- Bridge/Admin：完整生命周期使用独立互斥锁串行；Admin 请求体只接受一个 JSON 值，并保留 413 body-size 行为。
- Webview：删除 pane、换 URL、挂起或重复打开都会使旧 generation 失效，迟到 controller 只关闭一次。
- 已验证：固定 pnpm 10.34.4 frozen install；前端 `verify` 16 files / 105 tests、Web build、安全门禁；Rust fmt/check/clippy/test-no-run；Go vet/test；Tauri release build 及 MSI/NSIS bundle；`git diff --check`。
- Blocked：完整 Rust test binary 在本机以 `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` 退出；Go race 需要 CGO/GCC 或 Linux CI；真实 Prefill/Picker/Bridge/Webview 点击回归仍需桌面人工执行。

## Kimi 小助手本体自动更新

### Checklist
- [x] 接入 Tauri Updater 的应用内检测、下载进度与用户确认安装入口
- [x] 安装前复用退出协调停止 Kimi 后端与 IM Bridge
- [x] 新增 `v*` tag Windows 发布 workflow，校验 tag/version 并生成签名安装包与 `latest.json`
- [x] 固定 Node 22、pnpm 10.34.4、Rust stable 与 `go.mod` Go 版本
- [x] 新增 accepted ADR、README、架构事实、验证门与变更记录
- [x] 配置长期 Tauri 签名密钥的两个 GitHub Actions Secrets
- [ ] 将签名私钥与密码分别离线备份
- [ ] 从旧 NSIS/MSI 安装版完成自动更新与失败场景 G3 矩阵

### Review
- 自动发布在签名 Secrets 缺失或 tag 与 `apps/kimi-shell/package.json` 版本不一致时 fail-fast；workflow 不包含任何密钥值。
- `0.1.13` 是首个支持本体更新的目标版本，`0.1.12` 及更早版本需手动安装一次。
- 当前状态：代码、发布配置与签名 Secrets 已完成；真实 Release 资产、签名信任链及 NSIS/MSI 安装回归在完成 G3 前为 blocked。

## Kimi Code 0.28.0 后端启动兼容修复

### Checklist
- [x] 核对脱敏 `backend.log`、本机 CLI 契约和 Kimi Code 官方 0.28.0 Release/源码
- [x] 将 Shell 自有后端改为 `kimi web --no-open --port <port>`
- [x] 将失败态契约探测改为 `kimi web --help`
- [x] 更新回归测试、Shell README、安装文档和架构事实
- [x] 运行 Rust 格式/编译/针对性测试和 Kimi Code 0.28.0 真实健康检查

### Review
- 根因是 Kimi Code 0.28.0 将 `kimi server` 整个命令树替换为弃用占位命令；它吞掉 `run --help` 后退出，导致启动失败和错误的“支持 server run”诊断。
- 修复只替换共享启动参数与契约探测，不增加版本分支、回退层或新依赖。
- 已验证：`cargo fmt -- --check`、`cargo check`、两条针对性 Rust 测试通过；本机 0.28.0 真实启动后 `/api/v1/healthz` 返回 HTTP 200。
