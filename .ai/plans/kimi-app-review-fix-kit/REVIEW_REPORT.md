# kimi-app 代码审查报告

## 1. 结论

本次审查定位到 **5 个高置信度问题**，其中 4 个属于高优先级，1 个属于中优先级。修复工具包已为这些问题生成本地可应用的代码变更和回归检查，不会向 GitHub 写入任何内容。

| 编号 | 优先级 | 问题 | 交付状态 |
|---|---:|---|---|
| KIMI-SEC-001 | 高 | Prefill / Import Picker 默认继承全部自定义 Tauri commands | 已修复 |
| KIMI-FUNC-002 | 高 | Import Picker 使用目录对话框但缺少 `dialog:allow-open` | 已修复 |
| KIMI-CONC-003 | 高 | Go Bridge 的 `Start` / `Shutdown` 生命周期存在竞态 | 已修复并加回归测试 |
| KIMI-UI-004 | 高 | 异步创建的子 Webview 可在窗格销毁后成为孤儿进程/资源 | 已修复并加回归测试 |
| KIMI-API-005 | 中 | Bridge Admin API 接受一个请求体中的多个 JSON 值 | 已修复并加回归测试 |

审查基线：`main@c2aaa14b9891c7de31363610d643ba70fa95c1e4`，应用版本 `0.1.7`。

## 2. 审查范围与方法

重点审查了以下边界：

- React/Tauri 窗口、Webview、事件与 command 权限模型。
- Workspace Grid 的原生子 Webview 生命周期。
- IM Bridge 的 Go 服务启动、停止和 Admin API。
- 安装控制器、轮询控制器与独立 Import Picker 的副作用。
- 已有安全检查脚本与测试接入方式。

方法包括代码路径追踪、竞态时序推演、权限面枚举、失败路径分析，以及在合成 Git fixture 上验证修复器生成补丁、应用补丁和重复执行的行为。

## 3. 详细问题

### KIMI-SEC-001：独立窗口继承全部自定义 Tauri commands

**位置**

- `apps/kimi-shell/src-tauri/src/commands.rs`
- `apps/kimi-shell/src-tauri/build.rs`
- `apps/kimi-shell/src-tauri/capabilities/default.json`

**根因**

仓库把 135 个自定义 command 注册到统一的 `tauri::generate_handler!`，但 `build.rs` 只调用默认构建函数，没有通过 `AppManifest::commands` 为应用 command 生成可授权的权限对象。当前 capability 文件虽然把 `main`、`prefill` 和 `workspace-import-picker` 分成不同 capability，但这种分隔只约束已声明的 Tauri Core/Plugin 权限；自定义 command 仍采用 Tauri 的默认全窗口可调用行为。

因此，原本应当是低权限、功能单一的 Prefill 和 Import Picker，本地前端一旦出现 XSS、供应链污染或错误调用，理论上可以触达主窗口的完整 command 面，包括安装任务、Skill 安装与信任、工作区文件读取、调度器、Bridge 配置和运行控制等。

这不是“远程 iframe 可以直接调用 Tauri”的结论；风险点是**本地应用窗口之间没有形成预期的最小权限边界，导致受影响窗口的爆炸半径过大**。

**修复设计**

1. 在 `build.rs` 中枚举 command 注册表，并通过 `tauri_build::AppManifest::commands` 生成 command 权限。
2. 新增 `src-tauri/permissions/command-access.toml`：
   - `main-command-access`：保持主窗口现有完整功能。
   - `prefill-command-access`：只允许 6 个启动监控与恢复 command。
   - `workspace-import-command-access`：只允许 4 个导入请求 command。
3. capability 按窗口引用对应权限。
4. 新增 `scripts/check_command_permissions.mjs`，在 CI/本地安全检查中校验：
   - `commands.rs`、`build.rs` 和权限 TOML 完全同步；
   - Prefill/Picker 白名单没有漂移；
   - Picker 保留目录对话框权限。

### KIMI-FUNC-002：Import Picker 的目录浏览会被权限系统拒绝

**位置**

- `apps/kimi-shell/src/app/useWorkspaceImportController.ts`
- `apps/kimi-shell/src-tauri/capabilities/default.json`
- `apps/kimi-shell/src/app/useInstallController.ts`
- `apps/kimi-shell/src/app/useShellPollingController.ts`
- `apps/kimi-shell/src/app/useShellController.ts`

**根因**

Import Picker 调用 `@tauri-apps/plugin-dialog` 的 `open({ directory: true })`，但它的 capability 只有 `core:default`，没有 `dialog:allow-open`。在 Tauri 权限检查生效时，用户点击“浏览目录”会被拒绝。

此外，Import Picker 与主窗口共用 `useShellController`。即使界面只显示导入流程，安装 Channel 注册、全局状态轮询、Skill 状态刷新和 loading 指标上报仍可能在后台触发。启用严格 command ACL 后，这些非必要调用会造成权限拒绝、错误噪声和不必要的工作。

**修复设计**

- 给 Picker capability 增加 `dialog:allow-open`。
- 给安装控制器和轮询控制器增加 `enabled` 门控。
- Picker 路由关闭安装 Channel 注册、全局轮询、Skill 自动刷新和 loading 上报。
- Picker 完成导入后不再调用不在其白名单内的 `get_app_status`；后端本身负责发布结果和关闭/复用 Picker。

### KIMI-CONC-003：Bridge 并发启动可产生错误状态或多监听器

**位置**

- `apps/kimi-im-bridge/internal/app/app.go`
- `apps/kimi-im-bridge/internal/app/app_test.go`

**失败时序**

原来的 `Start()` 只在持有 `mu` 时检查 `Running`，把状态改成 `Starting` 后立刻解锁，再执行 `net.Listen` 和适配器启动。两个并发调用可以同时通过检查：

1. 调用 A 设置 `Starting` 并成功监听端口。
2. 调用 B 也设置 `Starting`，随后监听相同固定端口失败。
3. B 把服务状态写成 `Crashed`，覆盖 A 已经成功运行的事实。
4. 当配置端口为 `0` 时，多个调用甚至可能分别绑定不同的临时端口，留下不可管理的监听器。

`Shutdown()` 也没有与 `Start()` 共用串行化边界，因此启动和停止可以交错。

**修复设计**

- 新增独立的 `lifecycleMu`，覆盖完整的 `Start()` 与 `Shutdown()` 生命周期。
- 保留原有 `mu` 作为状态和字段的细粒度锁，避免扩大读路径锁竞争。
- 新增 24 个并发调用 `Start()` 的回归测试，要求全部幂等成功且最终状态为 `Running`。

### KIMI-UI-004：异步子 Webview 创建完成后可能失去引用

**位置**

- `apps/kimi-shell/src/features/workspace-grid/PaneFrame.tsx`
- `apps/kimi-shell/src/features/workspace-grid/WorkspaceGridView.test.tsx`

**失败时序**

`handleOpenEmbeddedWebview()` 会异步调用 `createEmbeddedExternalWebview()`。如果用户在创建完成前关闭窗格、切换 URL、挂起窗格或改变挂载策略：

1. React effect cleanup 先运行，此时 `embeddedControllerRef.current` 仍为 `null`，所以没有对象可关闭。
2. 异步创建随后完成，并把 controller 写入已经失效组件的 ref。
3. 该 controller 没有可达的清理路径，可能留下隐藏 Webview、内存占用和事件资源。
4. 异步完成后还可能对已卸载组件执行状态更新。

**修复设计**

- 新增单调递增的 `embeddedOpenGenerationRef`。
- 每次打开记录请求代次；窗格卸载、URL 变化或挂起时使代次失效。
- 异步创建结果返回时检查代次：过期结果立即调用自身 `close()`，不写 ref、不更新 React state。
- 新增回归测试：创建 Promise 未完成时删除窗格，随后完成 Promise，断言 controller 被关闭一次。

### KIMI-API-005：Admin API 接受多个 JSON 值

**位置**

- `apps/kimi-im-bridge/internal/admin/server.go`
- `apps/kimi-im-bridge/internal/admin/server_test.go`

**根因**

原来的 `decodeAdminJSON` 只执行一次 `json.Decoder.Decode(target)`，因此以下请求会把第一个对象视为有效请求并忽略第二个对象：

```json
{"source":"shell-web","sourceSessionId":"web-1","workDir":"D:/repo"}{"workDir":"D:/other"}
```

这会让代理、审计日志和业务处理对“请求体到底是什么”产生不同理解，属于请求解析歧义。

**修复设计**

- 第一次解码后再次调用 decoder，要求结果严格为 `io.EOF`。
- 保留 `http.MaxBytesReader` 和 413 映射。
- 多值或尾随非空内容返回 400，且不调用业务 Service。
- 新增多 JSON 值回归测试。

## 4. 自动修复涉及的文件

修复器会对 15 个文件生成变更，其中 2 个是仓库内新增文件：

```text
apps/kimi-im-bridge/internal/admin/server.go
apps/kimi-im-bridge/internal/admin/server_test.go
apps/kimi-im-bridge/internal/app/app.go
apps/kimi-im-bridge/internal/app/app_test.go
apps/kimi-shell/package.json
apps/kimi-shell/scripts/check_command_permissions.mjs          # 新增
apps/kimi-shell/src-tauri/build.rs
apps/kimi-shell/src-tauri/capabilities/default.json
apps/kimi-shell/src-tauri/permissions/command-access.toml      # 新增
apps/kimi-shell/src/app/useInstallController.ts
apps/kimi-shell/src/app/useShellController.ts
apps/kimi-shell/src/app/useShellPollingController.ts
apps/kimi-shell/src/app/useWorkspaceImportController.ts
apps/kimi-shell/src/features/workspace-grid/PaneFrame.tsx
apps/kimi-shell/src/features/workspace-grid/WorkspaceGridView.test.tsx
```

`build.rs` 已存在，修复器会用带 `AppManifest::commands` 的版本替换其默认构建入口。

## 5. 建议继续完善但未自动修改的项目

### 5.1 轮询请求应增加 single-flight 或请求代次

`useShellPollingController` 使用 `setInterval` 触发异步刷新，没有等待上一轮完成。后端阻塞超过轮询周期时会出现并发请求；较旧响应晚到可能覆盖较新状态。建议为状态、Bridge 详情和日志轮询分别增加 single-flight 锁或 generation token，并在组件卸载时忽略过期结果。

### 5.2 `useWorkspaceEmbedUrl` 应防止旧启动周期响应回写

`refreshWorkspaceEmbedUrlForStatus` 把异步结果与调用时的 `startCycleId` 关联，但没有验证返回时该周期是否仍是最新周期。建议记录请求 generation，并只接受最后一次请求或当前 `startCycleId` 的结果。

### 5.3 将关键权限和竞态测试纳入跨平台 CI

建议至少增加：

- Node/TypeScript：`pnpm verify`。
- Rust：`cargo test` 和 release build 的权限清单生成检查。
- Go：`go test ./...`、`go vet ./...`；Linux runner 上执行 `go test -race ./...`。
- Windows 集成冒烟：Prefill、Picker、子 Webview 和 Bridge 快速启停。

## 6. 验证状态与限制

已完成：

- 修复器 Python 语法编译。
- 在合成 Git fixture 上生成 15 文件补丁。
- `git apply --check --whitespace=error`。
- 应用补丁后再次运行修复器，确认幂等。
- 使用与真实仓库一致的 135 个 command 名称验证权限生成和检查器。
- 生成的 capability JSON 与 permission TOML 解析。
- Go 变更通过 `gofmt`。
- 基线不匹配时默认拒绝继续。

未完成：

当前执行环境无法取得完整仓库 checkout，因此没有在真实仓库上运行完整的 `pnpm verify`、Vite/Tauri build、Cargo tests 或 Go 全量测试。工具包通过“唯一源锚点 + 基线提交校验 + 动态 patch 生成”降低集成风险，但应用后仍应按 `VALIDATION.md` 在你的本地完整 checkout 上执行全部验证。
