# Kimi Shell 安装版白屏问题沉淀

更新时间：2026-03-04

## 0. 问题分流说明（2026-03-05）

- 本文档聚焦“启动白屏 / `about:blank` / 主窗口文档导航竞态”问题。
- 新出现的“Explorer 文档右键打开后应用内 404”不属于本问题域，已拆分到独立文档：`tasks/right-click-404-investigation.md`。
- `tasks/task0305-1.md` 的“文件右键不触发、session/工作区自动化、外链与关闭体验”也已分流到 `tasks/task0305-1-investigation.md`，避免与白屏链路混淆。
- 后续若排查右键链路、命令行参数解析、注册表命令漂移，请优先查看右键专项文档，避免与白屏链路混淆。

## 1. 问题现象

- 安装版启动后窗口出现透明/纯白，DevTools 显示 `about:blank`。
- 同时后端 `kimi web` 实际已成功启动，`/healthz` 返回 200。
- 直接在系统浏览器打开后端地址（例如 `http://127.0.0.1:58841/`）可正常访问。

结论：后端服务可用，问题集中在 Tauri 主窗口 WebView 顶层文档加载/导航链路。

## 2. 关键日志证据（节选）

- `backend ready on port ...; workspace proxy on ...`（后端已就绪）
- `blank-window recovery forced navigate_loading (attempt=...)`
- `blank-window workspace fallback navigate succeeded (attempt=20, url=http://127.0.0.1:xxxx)`
- `blank-window recovery exhausted retries; window may still be stuck on about:blank`

说明：即使 `navigate succeeded`，主窗口 URL 仍可能卡在 `about:blank`，表明导航调用成功不等于文档提交成功。

## 3. 已做过的修复尝试与结果

### 3.1 窗口与样式层面

1. 将窗口透明关闭
- 变更：`apps/kimi-shell/src-tauri/tauri.conf.json` `transparent: false`
- 结果：解决“完全透明窗口”阶段问题，但白屏问题仍可复现。

2. 增加 CSS 回退色
- 变更：`src/index.css`、`src/App.css` 增加关键容器背景/文字回退
- 结果：降低透明感与视觉不可见风险，但未根治 `about:blank` 卡住。

3. 启动 fallback UI 与前端错误边界
- 变更：`index.html` 启动占位层，`RootErrorBoundary`，`main.tsx` 全局错误监听
- 结果：能提升“前端异常可见性”，但当前主问题仍是 WebView 顶层未进入应用文档。

### 3.2 前端构建兼容

4. Vite 资源路径与目标下调
- 变更：`vite.config.ts` 设置 `base: "./"`、`build.target: "es2019"`
- 结果：构建资源路径与语法兼容性更稳，但白屏仍存在。

### 3.3 窗口行为与实例管理

5. 启动窗口尺寸自愈（防止 13x13）
- 变更：Windows setup 时校正异常小窗口，恢复默认尺寸并居中
- 结果：解决异常尺寸问题，与白屏并行存在。

6. 单实例聚焦增强
- 变更：single-instance 回调 `show_and_focus`
- 结果：改善重复启动体验，不影响白屏根因。

### 3.4 导航与恢复链路

7. about:blank 恢复线程（多次重试）
- 变更：`spawn_blank_window_recovery`，最多 40 次轮询并强制导航 `loading`
- 结果：日志显示大量重试，仍可能最终卡住 `about:blank`。

8. workspace HTTP 顶层 fallback
- 变更：重试后切到 `http://127.0.0.1:<workspace_port>`
- 结果：日志可见 `navigate succeeded`，但文档仍可能不提交。

9. 去 onboarding 阻断 + 统一导航状态机
- 变更：
  - 去除 `pending_remote_port` 与 “holding remote navigation until onboarding is completed”
  - `window_manager` 统一 `NavigationStage + LocalRoute`
- 结果：减少了业务逻辑阻断和多入口导航分叉，但白屏仍存在。

10. 主线程导航 + Ready 阶段再引导 + 显式窗口 URL
- 变更：
  - 窗口配置增加 `url: "index.html#/loading"`
  - `window.navigate` 调度到 `run_on_main_thread`
  - `RunEvent::Ready` 再执行一次 `enter_local_boot`
- 结果：仍出现“backend ready 但 about:blank 卡住”。

## 4. 环境级验证结论（已完成）

1. WebView2 Runtime
- 已安装：`Microsoft Edge WebView2 Runtime`
- 版本：`145.0.3800.82`
- 路径：`C:\Program Files (x86)\Microsoft\EdgeWebView\Application\145.0.3800.82`

2. 策略与环境变量
- 未发现 `Edge/WebView2/EdgeUpdate/EmbeddedBrowserWebView` 相关策略键
- 未发现 `WEBVIEW2*`、`EDGE_*` 相关环境变量

3. 用户数据目录
- 目录存在：`%LOCALAPPDATA%\com.kimi.shell\EBWebView`
- 有持续写入痕迹，权限正常，Crashpad 无崩溃报告

结论：环境层（Runtime 缺失/策略拦截/目录权限）基本可排除为主因。

## 5. 与 execlink 项目对比（已完成）

对比仓库：`https://github.com/endearqb/execlink`

发现的关键差异：

1. `frontendDist` 相同
- 两者均为 `../dist`，不是打包输出目录映射问题。

2. 启动复杂度不同
- `execlink` 启动逻辑极简（基本不做运行时导航恢复）。
- `kimi-shell` 有后端启动、状态机、恢复线程、fallback 导航等复杂时序。

3. 导航恢复策略不同
- `execlink` 无高频 `about:blank` 恢复循环。
- `kimi-shell` 有 40 次轮询与 fallback 切换，存在重入/覆盖风险。

推断：当前问题更像“复杂导航时序导致文档提交失败”，而非基础打包配置错误。

## 6. 当前可能原因（按置信度）

### 高置信度

1. WebView 顶层导航提交异常（调用成功但文档不提交）
- 证据：`navigate succeeded` + 仍 `about:blank`。

2. 启动期导航竞争/重入
- 证据：恢复线程反复强制导航，与 backend ready/onboarding 逻辑阶段并发。

### 中置信度

3. `tauri://` 与 HTTP 顶层跳转混用导致状态不稳定
- 证据：同一生命周期内多路 URL 目标切换。

4. WebView2 在该环境的初始化时序问题
- 证据：浏览器访问后端正常，仅嵌入窗口异常。

### 低置信度

5. 资源路径/构建产物缺失
- 证据不足：构建稳定通过，`dist` 正常，且后端链路健康。

## 7. 后续建议（待执行）

1. 做一次“极简启动实验分支”
- 暂时移除 40 次恢复循环，仅保留一次延迟导航。
- 启动阶段仅允许单一路由（本地壳页），禁用 workspace 顶层 fallback。

2. 增加更细粒度埋点
- 记录每次导航前后 `window.url()`、`is_visible`、`is_minimized`、窗口尺寸。
- 区分“navigate 调用成功”和“文档实际提交完成”的事件边界。

3. 备用兜底策略
- 若持续 `about:blank`，尝试销毁并重建主 WebView 窗口（同 label 或重建后切换）。

## 8. 验证命令记录

- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`：通过（16/16）
- `pnpm -C apps/kimi-shell build`：通过
- `pnpm -C apps/kimi-shell check:nfr:security`：通过
- `pnpm -C apps/kimi-shell tauri build --bundles nsis`：通过

说明：构建与测试通过不代表该白屏问题已解决；该问题属于安装运行时行为层面。

## 9. 本轮落地（事件驱动串行导航，2026-03-04）

### 9.1 已实施改动

1. 接入页面加载事件作为导航完成边界
- 在 `src-tauri/lib.rs` 使用 `Builder::on_page_load` 记录 `main` 窗口 `Started/Finished + URL`。
- 仅在 `PageLoadEvent::Finished` 回调中调用 `window_manager::handle_page_load_finished(...)`，作为“允许下一次导航”的唯一释放点。

2. 导航状态机改为串行协调器
- 在 `src-tauri/window_manager.rs` 新增状态字段：
  - `frontend_ready`
  - `in_flight_nav`
  - `queued_route`
  - `boot_timeout_recovered`
- 路由调度改为“单飞行 + 队列覆盖”：
  - 有 in-flight 时新请求仅更新 `queued_route`
  - 无 in-flight 且满足条件时才发起 `navigate`
  - `Finished` 后再推进 queued route

3. 彻底移除高频恢复与顶层 HTTP fallback
- 删除 `spawn_blank_window_recovery` 与 `try_navigate_workspace_fallback`。
- 删除 `RunEvent::Ready` 阶段的二次 `enter_local_boot`（避免启动期重复导航）。

4. 前端主动 invoke 握手
- 新增命令 `notify_frontend_ready`，返回 `FrontendReadyAck`（`accepted/backendState/workspaceUrl/startCycleId`）。
- 前端 `useShellController` 在启动时主动调用 `invoke("notify_frontend_ready")`，并保持幂等。

5. 单次超时兜底
- 新增 8 秒 one-shot 检查：若仍为 `about:blank`，仅触发一次 `recover_loading_route_once`。
- 不再进行轮询重试，不再频繁派发导航指令。

### 9.2 本轮验证结果

- `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`：通过
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`：通过（16/16）
- `pnpm -C apps/kimi-shell build`：通过
- `pnpm -C apps/kimi-shell check:nfr:security`：通过

### 9.3 当前结论

- 启动期导航链路已从“重试轮询驱动”切换为“事件驱动串行化”。
- `navigate()` 调用成功与文档提交完成已被显式解耦，避免了之前的重入覆盖风险。
- 若后续仍出现极端机型白屏，下一阶段建议升级为 splashscreen 方案，进一步减少主 WebView 启动期导航次数。

## 10. 本轮落地（官方 Splashscreen 预填窗口替换，2026-03-04）

### 10.1 目标与策略

1. 目标
- 避免主窗口启动期反复 `navigate` 导致的 WebView2 竞态，改为“主窗口仅加载一次 + 事件驱动路由切换”。

2. 策略
- 窗口结构调整为 `main(hidden)` + `prefill(visible)`。
- 用户在 `prefill` 提交文本后，仅执行：`close(prefill) -> show(main) -> emit prefill payload`。
- 主窗口通过 `prefill-chat` 事件与 iframe `postMessage` 完成自动填入并自动发送。

### 10.2 关键改动

1. 双窗口配置与权限
- `src-tauri/tauri.conf.json`：
  - `main` 新增 `label="main"`、`visible=false`
  - 新增 `prefill` 窗口：`label="prefill"`、`url="prefill.html"`、启动可见
- `src-tauri/capabilities/default.json`：
  - `default.windows` 从 `["main"]` 扩展为 `["main","prefill"]`

2. Rust 事件化替代文档导航
- `src-tauri/window_manager.rs`：
  - 删除 `window.navigate(...)` 路径
  - 路由改为 `emit_to("main","shell-route", payload)`
  - 新增 prefill 排队与窗口切换流程：
    - `submit_prefill`
    - `complete_prefill_without_text`
    - `consume_prefill_close_allowance`
- `src-tauri/lib.rs`：
  - 新增命令 `submit_prefill`
  - `notify_frontend_ready` 扩展返回 `pending_prefill`
  - 移除 `on_page_load` 导航完成依赖与 8 秒 `about:blank` 单次恢复线程
  - `RunEvent` 新增 `prefill` 关闭分支（X 关闭走“空预填完成”路径）

3. 前端 prefill 入口与主窗口事件链路
- 新增入口与页面：
  - `prefill.html`
  - `src/prefill/main.tsx`
  - `src/prefill/PrefillApp.tsx`
  - `src/prefill/prefill.css`
- `vite.config.ts` 增加多入口构建（`index.html` + `prefill.html`）。
- `useShellController.ts`：
  - 先注册 `shell-route` / `prefill-chat` 监听，再 `notify_frontend_ready`
  - 支持 `pending_prefill` 兜底接收
  - 新增 prefill 到 iframe 的 postMessage 下发与 ack 监听
  - 注入失败/超时走低频重试（有限次数，避免风暴）

4. iframe 注入桥扩展
- `src-tauri/backend_manager.rs` 注入脚本新增：
  - 接收 `kimi-shell-prefill-sync`
  - 选择器定位 chat 输入控件（textarea/contenteditable）
  - 写入文本并触发输入事件
  - 自动发送（按钮优先，Enter 兜底）
  - 回传 `kimi-shell-prefill-bridge` ack（applied/failed + reason）

### 10.3 验证结果

- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`：通过（16/16）
- `pnpm -C apps/kimi-shell build`：通过（产物包含 `dist/prefill.html`）
- `pnpm -C apps/kimi-shell check:nfr:security`：通过
- `pnpm -C apps/kimi-shell tauri build --no-bundle`：通过

### 10.4 结论

- 主窗口启动链路已切换为 Splashscreen 思路，避免启动阶段文档级重导航竞态。
- 路由切换改为壳层事件，不再依赖 Rust 侧 `window.navigate(...)`。
- prefill 文本链路具备“队列 + ack + 低频重试”，在后端慢启动时可延后投递。
