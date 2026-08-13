# PRD · kimi-app 接入 DeepSeek Harness（DSH）

| 项 | 值 |
|---|---|
| 日期 | 2026-08-13 |
| 状态 | Reviewed；P0 契约已收敛，双平台发布证据待 M0 回填 |
| 上游文档 | `01-research.md`（事实与风险以其为准） |
| 下游文档 | `03-spec.md`、`04-plan.md` |

## 1. 背景

kimi-app（Kimi Sidekick，当前包版本 `0.1.23`）是 `kimi web` 的 Windows + Apple Silicon macOS 桌面壳：Workspace Grid 的产品入口是 code / chat / external，`agent_room` 仅为冻结兼容 tombstone；控制中心含受管安装、诊断与 Skill 中心。IM Bridge 是独立 Go sidecar，但其 RuntimeAdapter 与执行记录目前都是 Kimi session 语义。DSH 是 DeepSeek 官方的 web-first agent harness：`dsh web` 起本机服务，另有 `--profile headless` 一次性任务模式。首期把 Web UI 作为独立本地后端接入；headless 必须在安全前置收口后通过独立 one-shot 执行契约接入。

代价在 research R-1 ~ R-6 已列：rc 阶段随时 breaking、Windows 行为未验证、又多一套 API key。本 PRD 的范围裁剪即围绕这些代价展开。

## 2. 目标

1. 用户在 kimi-app 里一键启动一个 DSH pane，与 Kimi pane 并排使用，可随时停止，状态可见。
2. IM Bridge 支持把飞书侧任务派给 DSH headless 执行，回贴最终结果。
3. DSH 版本由壳锁定与升级，用户不需要懂 npm/npx。

## 3. 非目标

- 不做 DSH 的远程/移动端访问（DSH 拒绝 0.0.0.0，壳也不做端口转发或反代，见 R-4/R-6）。
- 不做 Cordis patch / profile / 插件生态的图形化管理，不预装任何 dsh-plugin。
- 不做 Kimi 与 DSH 之间的会话互通或模型互通。
- 不代写 `$DSH_HOME/.credentials.yaml`，不改 DSH 遥测配置。
- 不把 DSH 接入壳内 Agent Room 编排、Harness 模板与 Scheduler 定时体系（只在文档中记为后续方向，避免首期范围膨胀）。
- 平台范围 = 壳现状：Windows x86_64 与 Apple Silicon macOS；不新增 Linux。

## 4. 用户与场景

目标用户与壳现有用户重合：在 Windows / macOS 上重度使用 coding agent、希望多家 agent 并用对比、部分场景通过 IM（飞书为主，Telegram / 微信为 Bridge 已有通道）远程派活的开发者。

- US-1 作为用户，我在 Workspace Grid 里新建 pane 时可以选 "DeepSeek Harness"，选一个项目目录，壳拉起服务并加载其 Web UI；首次使用时壳提示我在 DSH 界面里完成工作区选择和 API key 填写。
- US-2 作为用户，我能看到 DSH pane 的状态（启动中/运行中/已停止/异常退出），异常时能一键查看该进程的日志尾部。
- US-3 作为用户，我在飞书里对 IM Bridge 发 "用 deepseek 在 <项目> 里执行：<任务>"，几分钟后收到最终答案或明确的失败原因。
- US-4 作为用户，壳升级 DSH 版本前会告诉我目标版本，升级失败可回退到原版本继续用。

## 5. 功能需求

优先级：P0 = 首个发布必须；P1 = 第二里程碑；P2 = 有余力再做。

| ID | 优先级 | 需求 | 验收要点 |
|---|---|---|---|
| FR-1 | P0 | 环境检测：Node 可用性、npx 可用性、DSH 锁定版本是否已就位；缺失时给中文引导 | preflight 结果进设置页，缺 Node 时给下载指引而非报错堆栈 |
| FR-2 | P0 | 启动/停止 DSH web 实例：壳分配端口、指定项目目录为 cwd、拉起进程、确认 URL、加载进 Grid pane（新增 pane kind 或改造 external 白名单，取决于 spec DR-5） | 从点击到 UI 可交互 ≤ 首次 60s / 热启动 15s（阈值按 M0 实测校准）；Windows 与 macOS 行为一致 |
| FR-3 | P0 | pane 状态机与指示：starting / running / stopped / crashed，crashed 显示退出码 | 状态变化 2s 内反映到 UI |
| FR-4 | P0 | 日志：每实例 stdout/stderr 落盘（滚动上限），pane 菜单可打开 | 崩溃后日志仍可查 |
| FR-5 | P0 | 本地实验开关：`agentBackends.dsh.enabled`，默认关闭；开启后 pane 类型才出现 | 关闭时先停止 DSH，停止成功后再持久化 `false`；关闭后不留 DSH 进程 |
| FR-6 | P0 | 首次使用引导：说明"工作区选择与 API key 在 DSH 界面内完成、保存即生效"，附 DeepSeek 开放平台链接 | 引导只在该 pane 类型首次创建时出现 |
| FR-7 | P1 | headless 任务通道：Bridge 新增 one-shot task executor 与显式 backend router，不复用 Kimi session RuntimeAdapter；固定 `workspace-write`、env 注入 key、超时/取消/整树终止、有界输出；飞书先行，Telegram/微信分别接入验收 | 并发 ≥3 任务互不干扰；超时任务整树消失；前置依赖 A-8/A-10、双平台 descendant-kill 与凭据托管结论 |
| FR-8 | P1 | 多实例：不同项目目录各起一个 DSH pane，端口互不冲突 | 依赖 A-7 验证结论 |
| FR-9 | P1 | 版本升级：壳内展示当前 pin 与最新版，用户确认后升级；失败自动回退 pin | 升级过程中已运行实例不受影响，重启后生效 |
| FR-10 | P2 | headless 任务用"极简模式"预设的开关（更少工具、更可控） | 依赖对 preset 选择机制的进一步确认 |
| FR-11 | P1（headless 硬依赖） | DeepSeek API key 由壳托管并按需注入（系统凭据库：Windows Credential Manager / macOS Keychain） | Web pane 仍走 FR-6；任何 headless 开发前必须先完成，不得写入 Bridge 明文 JSON |

## 6. 非功能需求

| ID | 需求 |
|---|---|
| NFR-1 | 关停：请求停止后 ≤8s 内进程消失（含 5s DSH drain 窗口 + 壳侧超时强杀），无孤儿进程 |
| NFR-2 | 崩溃处理：非用户主动停止的退出，壳提示而非静默；不做无上限自动重启（最多退避重启 2 次后转 crashed） |
| NFR-3 | 隐私：不设置 `DSH_TELEMETRY_MODE`（保持 DSH 默认本地遥测）；壳日志不落 API key |
| NFR-4 | 卸载：壳卸载时清理自装的 DSH 包与日志；`$DSH_HOME`（用户数据、会话、凭据）不动，并在卸载说明中告知 |
| NFR-5 | 安全：所有子进程以 argv 数组方式传参，任务文本不进 shell 拼接；DSH 端口仅 loopback，壳不做任何转发 |

## 7. 成功指标

- 首个发布后 4 周：开启 flag 的用户中 ≥30% 在一周内至少成功启动过一次 DSH pane（成功 = 进入 running 且存活 ≥5min）。
- headless 通道上线后：IM 派发任务成功率（exit 0 / 全部）≥80%，失败项都有可读原因回贴。
- 金丝雀 CI：DSH 新版本导致的破坏在用户报告之前被 CI 捕获的比例 = 100%（即不允许用户先踩到）。

## 8. 发布策略

pane 入口带"实验性"徽标；flag 默认关，先内测名单再放开。DSH 版本随壳 pin（首发 pin 0.1.0-rc.6 或 M0 时点的最新 rc），壳发版说明中列出 DSH pin 变更。若 DSH 在两个壳版本周期内连续 breaking 且无迁移路径，允许把该 pane 降级为"暂不可用"而不撤功能。

## 9. 已收敛问题与开放问题

| ID | 问题 | 计划 |
|---|---|---|
| OQ-1 | 是否等 DSH 1.0 再发？ | 不等。用 flag + pin + 金丝雀控制爆炸半径；M0 若 A-2/A-3/A-5 任一不过则整体推迟 |
| OQ-2 | key 托管（FR-11）要不要提前到 P1？ | 已收敛：是 headless 硬依赖；Web pane 不依赖 |
| OQ-3 | headless 无流式，IM 侧要不要做进度心跳？ | P1 先做"进程存活"心跳（每 60s），真流式不做承诺 |
| OQ-4 | headless 执行面放 Go bridge adapter，还是复用壳内 Harness/Scheduler（新增一种 DSH harness 类型）？ | 已收敛：Bridge one-shot task executor + backend router；不伪装 Kimi RuntimeAdapter。后续定时任务另行评估 |
