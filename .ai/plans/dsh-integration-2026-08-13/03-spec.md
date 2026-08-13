# Spec · DSH Provider for kimi-app

| 项 | 值 |
|---|---|
| 日期 | 2026-08-13 |
| 状态 | Reviewed；P0 契约已定，标注【M0/G3】的双平台证据仍待回填 |
| 对应需求 | `02-prd.md` FR-1 ~ FR-11、NFR-1 ~ NFR-5 |
| 事实依据 | `01-research.md` 第 2/4 节；A-x / R-x 编号同该文档 |
| 壳侧快照 | kimi-app · 2026-08-14 · 0.1.23（pane/bridge/install 事实以 `05-review-alignment.md` 为准） |

## 1. 架构位置与命名

**命名约定（R-7）**：壳内 "provider" 已指模型 API 供应商（`provider_api`），"Harness" 已指壳内任务模板系统（`harness.rs`）。DeepSeek Harness 一律缩写 **DSH**。P0 只有一个新增后端，按 Accepted ADR 使用专属 `dsh_manager`，不提前建立通用 AgentBackend 抽象。

DSH 侧全部当黑盒：壳只依赖固定 CLI 参数、私有安装入口与 HTTP readiness；不读写 `$DSH_HOME` 内部结构，不碰 Cordis patch 层。stdout 只写诊断日志，不授予 URL authority。

```
Workspace Grid（独立 dsh pane）──────▶ dsh_manager
                                                            ├─ preflight()   FR-1
                                                            ├─ start()/stop() FR-2, NFR-1
                                                            └─ health()      FR-3
kimi-im-bridge（Go sidecar）── OneShotTaskExecutor + backend router ──▶ dsh headless   FR-7
子进程：dsh (web | headless)，cwd = 项目目录，仅 loopback
```

web pane 归壳（Rust/TS）。headless 归 Go bridge（第 7 节），但必须通过显式、版本化的 pin/path/key-source handoff；它不直接读取壳内部目录结构。

## 2. DSH Manager 契约（壳侧）

```ts
interface DshManager {
  id: "dsh";
  displayName: "DeepSeek Harness";
  experimental: true;                          // FR-5 徽标

  preflight(): Promise<PreflightReport>;       // node / npm / pinned 包；registry 只在安装时检查
  start(opts: {
    workspaceDir: string;                      // cwd = workspace root（DSH 语义）
    port?: number;                             // 缺省由 PortAllocator 分配
  }): Promise<{ pid: number; port: number; url: string }>;
  health(inst): Promise<"up" | "down">;
  stop(inst): Promise<{ exitCode: number | null; forced: boolean }>;
  logsPath(inst): string;

  credentialStrategy: "none";                  // pane 不注入任何凭据（research 4a 节）
}
```

headless 不在壳侧接口里。未来属于 Go bridge 的 one-shot task executor；壳只通过明确 IPC 契约下发 pin、入口路径与凭据来源。

## 3. 启动规格（FR-2）

### 3.1 命令构造

一律 argv 数组，禁止 shell 字符串拼接（NFR-5）：

```
prog = [<受控 Node 绝对路径>, <私有前缀内已验证的 lib/bin.js>]
argv = [...prog, "web", "--port", String(port)]
cwd  = opts.workspaceDir
env  = 继承 PATH 等最小集；默认不注入 DEEPSEEK_API_KEY（web 路线的 key 在 DSH UI 内填）
```

生产启动禁止运行时 `npx` fallback；它只可用于人工诊断。入口缺失或版本不匹配时必须回到 preflight/安装流程。

launcher 参数与 app 参数的边界：`web` 之后的 flag 归 web app 解析，顺序不能颠倒（research 2.2）。

### 3.2 端口分配

壳侧 `PortAllocator` 从 `agentBackends.dsh.portRange`（默认 3080–3179）取第一个 TCP 探测空闲的端口。不依赖 DSH 自增（该行为无文档证据，A-4【M0】确认后若存在也不使用，保持行为可预测）。

### 3.3 就绪判定

1. 启动后立即对壳本次分配的精确 `http://127.0.0.1:<port>` 做 HTTP 轮询；不解析 stdout 取得 URL。
2. `startTimeout`（默认 60s，经验值由 M0 校准）内首次 health `up` → 状态 running，webview 加载固定 URL。
3. stdout/stderr 只进入脱敏诊断日志；其中出现的 URL 或重定向目标都不扩大 authority。

### 3.4 健康检查

`GET http://127.0.0.1:<port>/`，2xx/3xx 视为 up；间隔 5s，连续 3 次失败且进程仍存活 → 状态 degraded 并提示。是否存在更精确的 `/api` 探针【M0，A-6】。

## 4. Pane 集成（Workspace Grid）

壳的 pane 体系（research 4 节第 2 条）：`WorkspacePaneKind = "code" | "chat" | "external" | "agent_room"`，carrier `iframe | local`，带 mountPolicy / loadState / workDir / storageNamespace。DSH 落位：

- **DR-5（已定）**：新增 pane kind `"dsh"`，不塞入 `"external"`，也不增加运行时 generic allowlist。DSH iframe 的 src 只取 Rust 当前状态中的精确 loopback URL；URL、PID、端口和运行状态不进入 Grid 持久化状态。
- **承载**：复用 code pane 同款 iframe 承载与 WebviewWindow fallback；`storageNamespace` 独立（`dsh:<instanceId>`）；mountPolicy 默认与 code pane 一致。iframe 内嵌 `http://127.0.0.1:<p>` 在 WebView2 / WKWebView 下的渲染与 `/api` 调用【M0，A-11】。
- **无凭据注入**：`credentialStrategy: "none"`，无 token、无脚本注入、无 cookie 预置；壳必须保证该端口永不离开本机（NFR-5）。
- **URL 写法**：统一 `127.0.0.1` 字面量，不用 `localhost`——`/api` browser-trust fence 以 authority 为单位受信，`localhost` 是否默认等价【M0，A-9】；确认前不引入第二种写法，也不使用 `--trusted-host`。
- **pane 状态映射（FR-3）**：DSH 的 starting/running/stopped/crashed 投影到既有 `WorkspacePaneLoadState` 的 loading/ready/empty/blocked；后端保留诊断状态，Grid 不持久化它。
- **首次引导（FR-6）**：创建该类型 pane 首次叠加引导层：提示在 DSH UI 内 Choose workspace、Settings → Models 填 key（保存即生效，research 2.4/2.6）。壳不自动化这两步（DSH 前端内部结构，rc 期不可依赖）。

## 5. 生命周期与关停（NFR-1）

DSH 的 POSIX 语义：5s drain，SIGTERM→exit 0，SIGINT→130，第二信号强杀（research 2.5）。按平台分支：

- **macOS**：直接 `kill(SIGTERM)` → 等 8s → `SIGKILL`。文档语义原生适用，预期 exit 0；A-3 在 macOS 侧只做对照验证。
- **Windows**：没有 SIGTERM 等价物，通路待定——方案 A：`CREATE_NEW_PROCESS_GROUP` 生成子进程，停止时发 `CTRL_BREAK_EVENT`，给 8s 窗口等自然退出；方案 B：`taskkill /PID <pid> /T`（不带 /F）软停，超时 `/F /T` 强杀；兜底：Tauri `child.kill()`（硬杀）。A/B 实际效果（是否触发 drain、退出码、会话是否完好落盘）由【M0，A-3】测定，结论写入 DR-1。

无论哪条路径：停止流程 = 软停请求 → 等 8s → 强杀 → 校验 pid 消失 → 状态 stopped。

退出码解释表（FR-3）：

| exitCode | 含义 | 壳侧动作 |
|---|---|---|
| 0 | 正常/软停成功 | stopped |
| 130 | 中断（Ctrl+C 语义） | stopped |
| 其他非 0（用户未请求停止） | 启动失败或运行崩溃 | crashed，展示码 + 日志入口；P0 不自动重启 |

## 6. 多实例（FR-8，P1）

P0 只允许一个运行实例。多实例必须先通过 A-7，并设计不依赖持久化 PID 的 ownership model。禁止按旧 PID 做孤儿回收，因为 PID 可重用且无法证明进程身份；跨重启只清除非权威 UI 投影，不杀未知进程。

## 7. Headless 任务通道（FR-7）

**归属**：`apps/kimi-im-bridge`（Go）新增 one-shot task executor 与显式 backend router。它不实现 Kimi `RuntimeAdapter`，DSH task id 也不写入 `kimi_session_id`。先接飞书；Telegram 与微信因轮询、取消、审批和消息上限语义不同，分别设计与验收。

```
argv = [<dsh 入口，来自壳下发的前缀路径>, "--profile", "headless", taskText]   // taskText 为单个 argv 元素
cwd  = 目录映射后的 workspaceDir
env  = { ...minimal, DEEPSEEK_API_KEY: <bridge 从 key 文件读取，见下> }
```

key 必须来自系统凭据库。壳与 Bridge 之间采用单一、版本化 handoff 契约，并明确一次性文件的创建权限、启动读取、立即删除、崩溃清理与轮换所有权；现有 admin token-file 只有读取优先级模式，不能视作已实现这套安全生命周期。

**审批前置（A-10）**：上游代码核验表明，默认 `workspace-write + ask` 在 headless 没有 approval answerer 时会 fail-closed 为 `unavailable`。P1 必须真机复核并保持该默认；禁止设置 `danger-full-access` 绕过审批。任何行为偏离 fail-closed 时，FR-7 为 No-Go。

契约（全部来自 research 2.2，属 DSH 文档化行为）：stdout = 最后一条非空 assistant 文本；exit 0 = completed，else 1；成功不写 stderr；不开监听端口 → 与 web 实例、与其他 headless 任务天然并行。

壳侧包装：

| 项 | 规格 |
|---|---|
| 超时 | 默认 15min（`agentBackends.dsh.headless.timeoutSec` 可配）；超时按第 5 节对应平台的软停→强杀流程终止整棵进程树，回贴"超时" |
| 取消 | 同超时路径，由 IM 指令触发 |
| 输出上限 | stdout 缓冲上限 256 KiB，超出截断并注明；回贴按 IM 消息长度再截 |
| 心跳 | 每 60s 检查进程存活，向 IM 更新一次"仍在执行"（OQ-3 的最低实现） |
| 失败回贴 | exit≠0：回贴 stderr 尾部 ≤2 KiB + exit code；启动即失败（node/npx 缺失）回贴 preflight 结论 |
| 审计 | 任务文本、目录、发起人、时长、exit code 落壳日志；不落 key |
| 并发 | 每 workspace 同时最多 1 个 headless 任务（避免同目录并发写），跨 workspace 并发上限 3（可配） |
| 冷环境前提 | 纯 env 注入 key、零交互配置能否直接完成任务【M0，A-8】；不通过则 FR-7 的前置改为"该目录已在 web UI 完成过一次配置" |

## 8. 安装与升级（FR-1、FR-9）

现有 `InstallFlowCatalog` 是 Kimi/PowerShell 特化实现且 macOS 会拒绝通用 flow。DSH 使用独立的窄安装器，共享设置页的状态表达与日志安全约束，不伪装复用不成立的目录。

- 分发：把 `@deepseek-ai/dsh@<pinned>` 装到壳私有前缀的临时目录，验证 package version 与固定入口后原子替换。壳直接以 Node 执行该入口；入口损坏时 fail closed，不使用 npx fallback。
- preflight 检查项：node 存在与版本（最低版【M0，A-1】回填）、npm 可用、私有前缀内 pinned 版本完好、npm registry（含所选镜像）可达（仅安装/升级时要求）。**macOS 注意**：kimi-code 在 macOS 走原生二进制，壳此前对 macOS 用户没有 Node 假设——DSH 是 macOS 侧第一个需要 Node 的组件，缺失时给 Homebrew / nodejs.org LTS 指引，不代装。
- 升级：设置页展示 pin 与 npm latest → 用户确认 → 装到临时前缀 → 起一次 `web --port <探测口>` 冒烟（能打印 URL 即过）→ 原子替换前缀 → 更新 pin。失败则丢弃临时前缀，pin 不动（FR-9 的自动回退）。已运行实例不受影响，重启实例后用新版。
- 卸载：删私有前缀与壳侧日志；`$DSH_HOME` 保留并在卸载文案说明（NFR-4）。

## 9. 配置 Schema

```jsonc
"agentBackends": {
  "dsh": {
    "enabled": false,                 // FR-5，默认关
    "pinnedVersion": "0.1.0-rc.6",
    "portRange": [3080, 3179],
    "startTimeoutSec": 60,
    "headless": {
      "timeoutSec": 900,
      "maxConcurrent": 3,
      "apiKeyRef": null               // 系统凭据库条目名（Credential Manager / Keychain）；null = headless 未启用 key
    }
  }
}
```

key 存取：P1 阶段 `apiKeyRef` 指向系统凭据库条目（Windows Credential Manager / macOS Keychain，经 tauri keyring 插件）；壳仅在向 bridge 下发时读出、写入受限权限临时文件（第 7 节的 token-file 模式），用后即删；壳日志、配置文件、崩溃报告一律不落明文（NFR-3）。web 路线不经过壳（第 4 节）。

## 10. 错误码

| 码 | 场景 | 用户可见文案要点 |
|---|---|---|
| E-DSH-001 | preflight：node 缺失/过低 | 给 LTS 下载链接 |
| E-DSH-002 | preflight：pinned 包缺失且 registry 不可达 | 提示网络/代理 |
| E-DSH-003 | 端口区间无空闲 | 提示改 portRange 或关闲置实例 |
| E-DSH-004 | 启动超时（无 URL、health 不通） | 附日志尾部 20 行 |
| E-DSH-005 | 运行中崩溃 | 退出码 + 日志入口 + "重试"按钮 |
| E-DSH-006 | headless 超时/取消 | 标明已终止，附耗时 |
| E-DSH-007 | 升级冒烟失败 | 已回退到 <旧版>，附失败日志 |

## 11. 可观测性

P0 Web 实例写 `logs/dsh.log`，达到 10 MiB 时保留一个 `dsh.log.1`；未来 headless 每任务独立文件并采用有界输出。不设 `DSH_TELEMETRY_MODE`（NFR-3）。壳埋点仅记事件（启动成功/失败、时长、退出码分布），不采内容。

## 12. 决策记录（M0 后填写）

| ID | 决策点 | 候选 | 结论 |
|---|---|---|---|
| DR-1 | Windows 软停通路（macOS 已定：SIGTERM） | taskkill tree / 直接硬杀 | 待 A-3 真机；发布硬门槛 |
| DR-2 | 就绪信号 | HTTP 纯轮询；stdout 只诊断 | 已定 |
| DR-3 | headless 冷环境前提 | 纯 env 即可 / 需先 UI 配置一次 | 待 A-8 |
| DR-4 | 首发 pin | 0.1.0-rc.6 / M0 时点最新 rc | 待 M0 收口 |
| DR-5 | pane 落位 | 独立 kind `"dsh"`；不扩 generic allowlist | 已定；A-11 仍是发布 G3 |
| DR-6 | headless 审批策略应对 | 默认 workspace-write 下 fail-closed；禁止 danger-full-access | 上游已核验，待 A-10 真机复核 |
