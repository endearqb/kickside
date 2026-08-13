# DeepSeek Harness（DSH）接入 kimi-app · 调研报告

| 项 | 值 |
|---|---|
| 日期 | 2026-08-13 |
| 调研对象 | github.com/deepseek-ai/deepseek-harness（默认分支 `master`） |
| 版本快照 | npm `@deepseek-ai/dsh` latest = **0.1.0-rc.6**，发布于 2026-08-13（当天），历史共 6 个版本 |
| 壳侧对象 | github.com/endearqb/kimi-app · main 快照 2026-08-13、壳版本 0.1.24（Tauri v2 + React；Windows x86_64 与 Apple Silicon macOS 13+ 双平台；主后端 kimi-code `kimi web`；Go 编写的 IM Bridge sidecar） |
| 结论 | 可接入。web pane 成本低；headless 模式对 IM Bridge 有独立价值；主要不确定性集中在 Windows 进程行为，须先做 M0 Spike |

---

## 1. 调研问题

1. DSH 能否像 OpenChamber 一样，作为 kimi-app 里与 `kimi web` 平行的一个 agent pane？
2. DSH 对壳的 IM Bridge（飞书任务通道）有没有 kimi 之外的增量价值？
3. 接入成本、维护成本和风险分别落在哪里？

## 2. DSH 事实卡

以下每条都来自仓库文档或 npm registry，未核实的内容不在本节，统一放第 6 节。

### 2.1 身份与许可

DSH 是 DeepSeek AI 官方开源的 agent harness，MIT 许可，第三方依赖许可在 `THIRD_PARTY_NOTICES.md` 单独披露。架构口号是 "everything is a plugin"，运行时基于 Cordis（cordiverse/cordis）。README 用大写警告标注当前处于 developer preview："THERE WILL BE COMPATIBILITY-BREAKING CHANGES"。
来源：仓库 README（master）。

### 2.2 运行形态

`dsh` 是一个 profile 启动器，不是单一应用。入口模式：

| 命令 | 行为 |
|---|---|
| `npx @deepseek-ai/dsh web` | 起 Web UI，默认 `http://127.0.0.1:3080`，命令会打印实际 URL |
| `dsh web --port 8080` | `dsh web` 是 `--profile web` 的硬编码别名；launcher 自身参数在前，第一个不认识的 token 起全部交给 app（`--port`/`--host`/`--trusted-host` 归 web app 解析） |
| `dsh --profile headless "任务文本"` | 一次性任务：新建一个持久化会话，提交任务，等待静默，打印最后一条非空 assistant 文本到 stdout。`turn/end` 为 completed 时 exit 0，否则 exit 1。**不挂 HTTP server、不开监听端口，成功时不写 stderr** |
| `dsh plugin --profile <n> <pnpm args>` | 管理 profile 插件（转发给 pnpm） |

web 和 headless 两个 profile 首次使用时从内置模板自动初始化；其他 profile 需手工创建。TUI 不是默认能力（文档示例写明 "assuming the tui profile is installed"）。
来源：`apps/cli/README.md`、`apps/cli/reference/README.md`。

### 2.3 网络与安全边界

- 只服务 loopback：`--host 0.0.0.0` 被有意不支持，传入直接 usage error 退出。
- `--trusted-host`（可重复）向 `/api` 的 browser-trust fence 添加受信 authority，不等于对外监听。
- 文档未提及任何 Web UI 层的登录/token 机制——对照：kimi 是 `#token=` fragment，OpenChamber 是 `--ui-password`，DSH 与 pi-gui 一样按"本机即信任"设计。
来源：`apps/cli/reference/README.md`。

### 2.4 凭据

解析链：环境变量 → `$DSH_HOME/.credentials.yaml` → 调用目录 `.env` → `$DSH_HOME/.env`。托管凭据文档不会物化进 `process.env`。搜索工具用 `DEEPSEEK_API_KEY`，接受 `DEEPSEEK_SEARCH_BASE_URL`。`web_fetch` 默认禁用，需 patch 层显式启用。Web UI 内 Settings → Models 填入 API key 后立即生效，无需重启。支持其他 provider 和自定义 OpenAI 兼容端点（`docs/user/guide/providers.md`）。
来源：`apps/cli/reference/README.md`、`docs/user/guide/index.md`。

### 2.5 生命周期与信号（POSIX 语义）

优雅关停给插件树最多 5 秒 dispose；SIGTERM 视为 supervisor 的常规停止请求，一律 exit 0；SIGINT 返回 130；第二个信号强制退出。one-shot 卡在 disposal 时第一个 Ctrl+C 即升级为立即退出。这套语义是四个候选后端里对进程监督最友好的，但文档只描述了 POSIX 行为，Windows 行为未写（见 A-3）。
来源：`apps/cli/reference/README.md`。

### 2.6 工作区语义

调用目录 = 默认 workspace root。新开的 Web UI 没有已选工作区，必须在 UI 里 Choose workspace 之后 composer 才可用。所有模式加载适用的 `AGENTS.md` / `CLAUDE.md`，渲染预算 65,536 字节。会话内容索引用进程内 SQLite。
来源：`docs/user/guide/index.md`、`apps/cli/reference/README.md`。

### 2.7 配置与扩展

Profile 目录（`$DSH_HOME/profiles/<n>`）含 `package.json`（`dsh.profile` manifest + bundles 顺序）和 `cordis.patch.yml`。合成顺序：bundles 按序 → profile patch → home 级 patch → `--patch` 覆盖。两层 `cordis.patch.yml` 被监视、事务性热应用。`--dump-default-config` / `--dump-config` 可离线检视合成树。`DSH_TOOLS_MODE` 取 `native`/`code`/`both`，其他值 boot 失败。内置"极简模式"agent preset：固定系统提示词，仅 `bash` + `str_replace_editor` 两个工具。遥测默认本地，`DSH_TELEMETRY_MODE=FULL` 才外发 OTLP。
来源：`apps/cli/README.md`、`apps/cli/reference/README.md`。

### 2.8 版本与生态

npm 最新 0.1.0-rc.6（2026-08-13 发布，即调研当天），共 6 个版本，61 个运行时依赖，**package.json 未声明 engines 字段**（Node 最低版本未知，见 A-1）。GitHub `dsh-plugin` topic 下已出现社区插件生态：Web UI 插件/皮肤集（任务板、git graph、右侧面板、远程移动 UI、token 统计）、视觉工具包、本地记忆集成等。另有 Python SDK。
来源：registry.npmjs.org、github.com/topics/deepseek-harness、`docs/user/guide/index.md`。

## 3. 四后端对比

| 维度 | kimi-code | opencode（经 OpenChamber） | pi（pi-gui 扩展） | DSH |
|---|---|---|---|---|
| 维护方 | Moonshot 官方 | opencode 官方 + OpenChamber 第三方（MIT，1.18.x） | pi 官方 + gui 第三方（0.4.1） | DeepSeek 官方 |
| Web 形态 | TUI 优先，`kimi web` 附带 | CLI 优先，GUI 靠 OpenChamber | TUI 优先，`/gui` 会话内起 | **web-first**，`dsh web` 即主入口 |
| Web 鉴权 | URL `#token=` fragment | `--ui-password` 表单 | 无 | 无（loopback + trusted-host 栅栏） |
| 端口行为 | 58628 起自动 +1，实例注册到 `~/.kimi-code/server/instances/` | 可配 | 默认 3847，`PI_GUI_PORT` | 默认 3080，`--port` 可指定；冲突行为未文档化（A-4） |
| 远程能力 | loopback 默认，可放开 | OpenChamber 有 tunnel/LAN 体系 | 无 | 明确无（拒绝 0.0.0.0） |
| 进程监督 | 前台进程，banner 带 token | `--foreground` 可挂前台 | host 生命周期挂在 pi 会话进程里 | 前台进程，5s drain + 明确退出码表 |
| 一次性任务 | 无同类文档化模式 | 无 | print/JSON headless（pi 本体） | `--profile headless`，契约最干净 |
| 成熟度 | 稳定 | OpenChamber 1.18.x | 0.4.x 实验 | **0.1.0-rc，官方警告会 breaking** |

## 4. 壳侧现状核对（main 快照 2026-08-13）

早前几轮讨论基于旧 README，与最新代码有出入。逐项核对：

1. **双平台，不再 Windows-only**：`PlatformOs = "windows" | "macos"`，产物含 NSIS/MSI 与 macOS arm64 app/DMG。macOS 是 POSIX 环境——DSH 文档写明的 SIGTERM/SIGINT 语义在 macOS 上直接适用，Windows 侧才是未知数（R-2 相应收窄）。
2. **Pane 体系已成型**：`WorkspacePaneKind = "code" | "chat" | "external" | "agent_room"`，carrier 为 `iframe | local`，带 mountPolicy（eager/on-focus/manual/suspended）、loadState（idle/loading/ready/blocked/empty/suspended）、workDir、storageNamespace 等字段。"external" pane 有 origin 白名单：默认仅 `https://kimi.com` / `https://www.kimi.com`，扩展项走构建期环境变量 `VITE_KIMI_EXTERNAL_FRAME_ALLOWLIST`，且会剥离 URL hash（`urlSafety.ts`）。所以 DSH 不能简单塞进 "external"——loopback origin 不在白名单里，白名单也不是运行时可配的。落位要么新增 pane kind，要么改造 external 的白名单机制（spec DR-5 决策）。
3. **术语碰撞（两处）**：壳内 "provider" 已指模型 API 供应商（`AuthMode = "kimi_login" | "provider_api"`、`providerApiActiveProvider`）；"Harness" 已指壳内建的任务模板系统（`src-tauri/src/harness.rs`、三套内置 harness、Harness Directory、变量表单与 dry-run）。本套文档的后端抽象改名为 **AgentBackend**（配置键 `agentBackends.dsh`），"DSH" 专指 DeepSeek Harness 产品，避免与壳内 Harness 混用。
4. **IM Bridge 是独立 Go sidecar**（`apps/kimi-im-bridge`），由壳管理：admin/host-control token 走环境变量或文件下发；已有三个 runtime adapter——`KimiCodeServerAdapter`（`/api/v1`）、实验性 `ACPAdapter`（stdio JSON-RPC）、`SDKAdapter`；`bridgecore.Orchestrator` 把 **Telegram、飞书、微信**三条通道路由到真实 kimi 会话，每 connector 有独立 defaultWorkDir，会话与 binding 有隔离约束。DSH headless 的自然落点是这里新增第四个 adapter，而不是壳前端。
5. **壳内已有 ACP + Scheduler + Agent Room**：`kimi acp` plan-then-run、`scheduler.rs` 定时执行、Agent Room 多成员编排（rooms/members/审批面板）都已落地。此前对话里"ACP 作为跨 agent 通道"的备忘，kimi 侧已实现；DSH 不说 ACP，不影响。

## 4a. DSH 落位分析

- **Web pane**：壳指定端口拉起 `dsh web --port <p>`，解析 stdout URL 或直接用 `http://127.0.0.1:<p>`；DSH 无 UI 鉴权，iframe 直接加载，无 token 注入——external pane 会剥离 hash 的行为对 DSH 无影响（本就没有 `#token=`）。DeepSeek API key 属模型凭据，默认引导用户在 DSH 自己的 Settings → Models 里填（保存即生效），壳不代管。
- **与 kimi 后端的差异**：无实例注册表（kimi 有 `~/.kimi-code/server/instances/`，DSH 没有，壳自己记 pid/port，可并入壳既有状态存储）；无端口自增证据；首次使用需在 DSH UI 内选工作区（kimi 由壳传目录即绑定）。
- **Headless 增量**：IM 消息 → bridge spawn 一个 headless 进程（cwd = 目标 workspace，env 带 key）→ stdout 即答案、退出码即成败、无端口无 stderr 干扰，天然并发。比再接一套 REST/WS 协议便宜；代价是无流式、只有终态。一个新未知：DSH Web UI 会在需审批操作前询问（permission policy），headless 模式下同类操作是自动放行、直接失败还是挂起等待，文档没写（A-10）——这直接决定 headless 能不能安全接 IM。

## 5. 风险登记

| ID | 风险 | 依据 | 影响 |
|---|---|---|---|
| R-1 | rc 阶段 breaking change，官方明示 | README 警告；6 版本、最新版当天发布 | 命令行参数、URL 打印格式、配置结构随时可能变 |
| R-2 | Windows 进程行为未文档化（macOS 为 POSIX，文档语义直接适用） | 信号语义只写了 POSIX | Windows 优雅关停可能退化为硬杀 |
| R-3 | npx 冷启动慢 | 61 个运行时依赖 | 首次/缓存失效时 pane 启动可能数十秒 |
| R-4 | 无 UI 鉴权 | 2.3 节 | 本机 webview 可接受；壳绝不能替它做端口转发暴露 |
| R-5 | 凭据双生态 | Kimi key 与 DeepSeek key 并存 | 设置页与 headless env 注入要区分清楚 |
| R-6 | 远程/移动端诉求在 DSH 上无解 | 拒绝 0.0.0.0 | 产品预期管理：DSH pane 只承诺本机 |
| R-7 | 术语碰撞："provider" 与 "Harness" 在壳内已有既定含义 | 4 节第 3 条 | 命名统一为 AgentBackend / DSH，否则代码评审与文档会互相误导 |

## 6. 待验证假设（供 plan 的 M0 引用）

| ID | 假设/未知 | 验证方法 |
|---|---|---|
| A-1 | Node 最低版本（engines 未声明；仓库 pnpm 构建链较新，猜测 ≥20 但无依据） | 在 Node 18/20/22 各跑一次 `npx @deepseek-ai/dsh@0.1.0-rc.6 web` |
| A-2 | 双平台原生启动：Windows PowerShell 下 npx 起 web（路径、编码、控制台行为）；macOS 下同一命令行为一致性 | 两台目标机各实测 |
| A-3 | 关停通路：Windows 上 CTRL_BREAK_EVENT 能否触发 5s drain？taskkill 软/硬差异？macOS 上 SIGTERM 是否如文档 exit 0 且会话完好（预期直接过，作对照组） | 起进程后逐一试 GenerateConsoleCtrlEvent、`taskkill /PID`、`taskkill /F /PID /T`、`kill -TERM`，观察退出码与会话落盘 |
| A-4 | 端口被占时的行为（报错退出 or 自增） | 占用 3080 后启动 |
| A-5 | stdout 打印 URL 的确切格式与时机（能否作为 ready 信号） | 抓一次完整启动日志 |
| A-6 | 健康检查端点（`GET /` 是否稳定 200；`/api` 下有无 ping 类路径） | 启动后探测 |
| A-7 | 同机多实例：不同 `--port` + 共享 `$DSH_HOME` 是否冲突（SQLite 为进程内，理论可行） | 双实例并跑 |
| A-8 | headless 在纯 env 注入 key、无任何交互配置的冷环境下能否直接完成任务 | 干净用户目录 + `DEEPSEEK_API_KEY` 实测 |
| A-9 | 顶层加载 `127.0.0.1:<p>` 是否触发 trusted-host 栅栏问题；`localhost` 写法是否等价受信 | 两种写法各加载一次，观察 `/api` 请求 |
| A-10 | headless 模式的权限策略：遇到 Web UI 里"需审批"的操作时是自动放行、直接失败还是挂起等待？ | 构造一个必触发审批的任务（如删除文件类操作）headless 跑一遍，观察行为与退出码 |
| A-11 | 壳的 pane 走 iframe 承载：在 WebView2（Win）与 WKWebView（macOS）里 iframe 内嵌 `http://127.0.0.1:<p>` 的渲染与 `/api` 调用是否正常（混合内容/CSP/cookie 分区） | 在壳 dev 构建里各嵌一次，跑完整一轮对话 |

## 7. 建议

1. 接入分两条线：web pane（P0，本机第三/第四 pane）+ headless 任务通道（P1，接 IM Bridge）。远程能力明确排除在范围外。
2. 版本必须锁定到具体 rc（当前 0.1.0-rc.6），升级走壳内受控流程；建 CI 每周金丝雀跑"启动 + 健康 + headless echo"三件事，breaking 早发现。
3. 所有 A-1 ~ A-11 在动 UI 代码前集中在一个 Spike 周清掉（Windows 与 macOS 双平台矩阵），其中 A-2、A-3、A-5、A-10 是 go/no-go 硬门槛。
4. 壳不写 `$DSH_HOME/.credentials.yaml`，不设 `DSH_TELEMETRY_MODE`，不碰 Cordis patch 层——把 DSH 当黑盒 web 服务用，降低对 rc 内部结构的耦合。

## 8. 来源

- https://github.com/deepseek-ai/deepseek-harness （README，master 分支）
- 仓库内文档：`docs/user/guide/index.md`、`apps/cli/README.md`、`apps/cli/reference/README.md`
- https://registry.npmjs.org/@deepseek-ai/dsh （版本、依赖、license、engines）
- https://github.com/topics/deepseek-harness （插件生态）
- kimi-code 侧事实：官方文档站（`kimi web` 别名、端口自增、instances 注册表、`#token=` 鉴权）
- 壳侧现状：github.com/endearqb/kimi-app main 分支 tarball（codeload，2026-08-13 快照，壳版本 0.1.24）：README/README_zh、`apps/kimi-shell/src/app/types.ts`、`features/workspace-grid/gridTypes.ts` 与 `urlSafety.ts`、`src-tauri/src/harness.rs`、`scheduler.rs`、`install_manager.rs`、`apps/kimi-im-bridge/README.md`、`.ai/plans/` 目录约定
