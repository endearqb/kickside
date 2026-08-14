# Plan · DSH 接入 KickSide 实施计划

| 项 | 值 |
|---|---|
| 日期 | 2026-08-13 |
| 依据 | `02-prd.md`（FR/NFR）、`03-spec.md`（章节与 DR）、`01-research.md`（A-x/R-x） |
| 节奏 | M0 契约审查 + 双平台发布 Spike → M1 P0 Web pane → M1.5 P0 发布证据 → M2 P1 headless（条件式）→ M3 多实例/升级。工时仅表相对规模 |
| 入库位置 | 建议按仓库 `.ai/plans/` 约定落到 `.ai/plans/dsh-integration-2026-08-13/`，四文件沿用 01~04 前缀命名，并补 YAML frontmatter（title/status/date/reviewed_branch 等，参照 macOS docs 目录） |

## M0 · Spike（进入开发前的验证周）

目的：先以 `05-review-alignment.md` 和 Accepted ADR 收敛不依赖真机的契约，再在 Windows 11（PowerShell + WebView2）与 Apple Silicon macOS 13+（WKWebView）补齐发布级 G3。Web 与 headless 的 Go/No-Go 分开，headless 失败不阻塞 Web pane。

| 任务 | 验证 | 产出 |
|---|---|---|
| S-1 | A-1：Node 18/20/22 三档启动 | 最低版本 → spec 8 节 preflight |
| S-2 | A-2：PowerShell 下 npx 与私有前缀两种方式起 `web` | 分发路线确认 |
| S-3 | A-5：完整启动日志存档，确认 URL 行格式与出现时机 | DR-2；就绪正则修订 |
| S-4 | A-4：占用 3080 后启动，记录行为与退出码 | 端口策略确认 |
| S-5 | A-6：`GET /` 与 `/api` 探测 | 健康检查端点定稿 |
| S-6 | A-3：Windows 四种停法（CTRL_BREAK_EVENT、`taskkill`、`taskkill /F /T`、`child.kill()`）各测 3 次；macOS `kill -TERM` 对照组，记录退出码、耗时、会话落盘完整性 | DR-1 |
| S-7 | A-7：双实例（不同 port/workspace，共享 `$DSH_HOME`）并跑 30min | 多实例结论 |
| S-8 | A-8：干净用户目录 + 仅 `DEEPSEEK_API_KEY` 环境变量跑 headless echo 任务 | DR-3 |
| S-9 | A-9：顶层分别加载 `127.0.0.1` 与 `localhost` 写法，观察 `/api` 请求是否被栅栏拒绝 | URL 写法定稿 |
| S-10 | 冷/热启动耗时各 5 次取中位数（双平台分别记录） | FR-2 阈值与 `startTimeoutSec` 校准 |
| S-11 | A-10：构造必触发审批的任务 headless 跑，判定自动放行 / 直接失败 / 挂起 | DR-6；FR-7 前置 |
| S-12 | A-11：在壳 dev 构建里以 iframe 内嵌 `127.0.0.1:<p>`，WebView2 与 WKWebView 各跑完整一轮对话 | DR-5 |

**Go / No-Go 硬门槛**（任一不过则项目暂停，转为跟踪 DSH 上游）：
1. S-2：Windows 原生（非 WSL）与 macOS 均能稳定起 web 并交互。
2. S-3 或 S-5：存在可靠的就绪判定（stdout URL 或 HTTP 探针二者其一）。
3. S-6：每个平台都存在不丢会话数据的可控关停路径（最坏接受"硬杀但落盘无损"，若硬杀导致会话损坏则 No-Go）。
4. S-11：headless 审批行为可被 DR-6 三种应对之一安全覆盖（若挂起且无法用超时安全兜底则 headless 线 No-Go，web pane 线不受影响）。

## M1 · P0：DSH web pane（约 2 周）

| 任务 | 内容 | 对应 | 代码状态 |
|---|---|---|---|
| T-1 | 专属薄 `dsh_manager`；设置 schema 12 + `agentBackends.dsh`，不建立预测性 registry | spec 1/2，ADR | 完成 |
| T-2 | preflight 实现与设置页展示 | FR-1, spec 8 | 完成 |
| T-3 | 独立 DSH 私有前缀安装：临时目录 `npm install`、版本/入口完整性校验、替换；生产禁用 npx fallback | spec 8 | 完成 |
| T-4 | 启动器：端口分配、argv 构造、固定 URL 的 HTTP 状态 + 有界页面身份 readiness、持续轻量 health、状态机；stdout 只作诊断 | FR-2/3, spec 3 | 完成 |
| T-5 | 关停：macOS process-group SIGTERM→强杀；Windows 整树终止兜底；只终止当前持有进程，不按持久化 PID 回收 | NFR-1, spec 5/6 | 代码完成；macOS 已证，Windows G3 待证 |
| T-6 | 有界日志落盘、轮转与 pane/控制中心查看入口 | FR-4, spec 11 | 完成 |
| T-7 | 新增独立 pane kind `"dsh"`；Rust 活状态提供精确 URL，Grid 不持久化 URL/PID/状态；接入 Grid + 首次引导层 | FR-6, spec 4 | 完成 |
| T-8 | feature flag 与实验性徽标 | FR-5 | 完成 |
| T-9 | 错误码 E-DSH-001~005 文案与展示 | spec 10 | 完成 |

**M1 验收**（全部满足才进 M2）：
- [ ] flag 开启后以 Shell 当前默认工作区启动 DSH；每次菜单动作新增 pane，pane 内可切换会话/工作区且标题随之更新；running 后 UI 内可交互；热启动 ≤ S-10 中位数 ×1.5；Windows 与 macOS 双平台各过一遍
- [ ] 停止后 8s 内当前实例整棵进程树消失；重启壳不恢复陈旧运行状态，也不按旧 PID 杀未知进程
- [ ] 拔掉 Node / 占满端口区间 / 杀掉进程三种故障注入，均落到对应 E-DSH 错误码而非白屏
- [ ] flag 关闭状态下不启动 DSH 进程、不自动创建 DSH pane，也不向 pane 提供运行 URL；控制中心的检测/固定版本安装入口继续可发现，标题栏 DSH 新建/浏览器入口仅在启用后出现
- [ ] 与 Kimi pane 并排运行 2h 无相互干扰

### 2026-08-14 证据回填

| 范围 | 结果 | 证据 |
|---|---|---|
| macOS 私有 pin | 通过 | 本机 `com.kimi.shell/dsh/current` 为 `@deepseek-ai/dsh@0.1.0-rc.6`，固定 `lib/bin.js` 存在 |
| macOS 启动/readiness | 通过 | 隔离 `DSH_HOME`、固定入口、3179 端口探针 805ms HTTP ready；收紧页面身份后隔离 production App 在 33080 于 767ms 同时通过 2xx/3xx 与前 512KiB `__DSH_BOOT__` 判定 |
| macOS 关停/残留 | 通过 | 独立 process group SIGTERM，60ms exit 0，剩余 group member = 0 |
| macOS App Quit | 通过（隔离 bundle id） | 临时 `com.kimi.shell.soak` production App 同时启动 owned Kimi 0.36.0 与 DSH rc.6；标准 macOS Quit 触发后约 0.5s App 退出，DSH/Kimi PID 均消失，33080/58235 端口均释放；未读取用户凭据或修改正式 App 配置 |
| macOS S-10 启动基线 | 通过（Node 24.19.0 / arm64） | 固定 pin 连续 5 次隔离 `DSH_HOME` 冷启动中位数 361ms；预热后复用同一 `DSH_HOME` 的 5 次热启动中位数 320ms；10 次均为 SIGTERM 软停且端口释放 |
| macOS WKWebView | 通过（当前 pin） | 用户真机截图已证明 DSH 在 KickSide 窗格内完成加载与会话交互；当前多窗格/目录桥截图也证明壳层与 DSH 同屏工作 |
| 手动停止/崩溃恢复 | 代码完成，macOS 包已构建 | 控制中心在 enabled + stopped/crashed 时提供启动/重试；pane 恢复使用该 pane 最后观测的会话目录，不再把 status refresh 误作 restart；生命周期动作保持单飞 |
| 自动化 | 通过 | argv、pin/入口、端口耗尽 E-DSH-003、日志 10MiB 轮转/UTF-8 截断、Unix descendant kill、loopback URL、pane 生命周期与 UI 投影测试 |
| Windows G3 | 待完成 | 仍需 Windows 11 原生 npm、WebView2、taskkill 软/强停、更新/退出/关开关与子孙残留矩阵 |
| Windows 自动化前置 | 已入库，待 Actions 首跑 | Rust Windows parent+descendant `taskkill /T` 测试；每周/手动真实 npm pin 与 latest 双平台 runtime canary；固定 pin 每个 OS/Node job 在一次安装后连续启动/停止 5 次并输出中位数 |
| P1 headless | No-Go | A-8/A-10、系统凭据库、双平台 descendant-kill、connector authz/取消语义未完成；不得提前实现 |

## M1.5 · P0 发布证据（双平台 G3）

- Windows：真实 npm 私有前缀安装、WebView2 完整交互、端口占用、退出/更新/关开关三条停止路径、Node 子孙进程残留检查。
- macOS：相同矩阵，并验证 WKWebView loopback iframe 与 process-group SIGTERM/强杀。
- 未完成任一平台 G3 时，只能报告“代码实现完成/该平台待验证”，不能宣称双平台发布完成。
- Windows 人工回填使用 `07-windows-g3-checklist.md`；自动化 canary 不能替代 WebView2 与应用级退出/更新交互。

## M2 · P1：headless × IM Bridge（安全前置通过后，约 2 周）

| 任务 | 内容 | 对应 |
|---|---|---|
| T-10 | 纯 Go one-shot runner：minimal env、有界 stdout/stderr、timeout/cancel、双平台整树终止，fake-child 集成测试 | FR-7, spec 7 |
| T-11 | 显式 backend router 与 task persistence 决策；解除 `ProviderName="kimi"` 硬编码但不复用 `kimi_session_id` | FR-7 |
| T-12 | 系统凭据库存取 + 版本化 Shell→Bridge handoff；临时文件权限/立即删除/崩溃清理/轮换测试 | FR-11, spec 7/9 |
| T-13 | canonical workspace 串行、全局上限 3；queued/running 分别可取消，Bridge shutdown 清场 | spec 7 |
| T-14 | 飞书 submit/status/cancel/heartbeat/final E2E；命令语法与 authz 明确 | FR-7 |
| T-15 | Telegram、微信分别做非阻塞轮询、幂等、长度限制与取消验收；微信保持 fail-closed | FR-7 |
| T-16 | 日志/数据库/诊断全链路 redaction 与保留策略 | spec 7 |

**M2 验收**：
- [ ] 飞书发任务 → 收到结果，全链路演示 3 个场景（成功 / exit 1 失败 / 超时取消），回贴内容符合 spec 7 表
- [ ] 3 个不同 workspace 并发任务互不阻塞；同 workspace 第二个任务排队
- [ ] 升级到假想新版（本地 tarball 模拟 breaking：冒烟失败）→ 自动回退且原实例可继续启动
- [ ] 全部日志与回贴中 grep 不到 API key

## M3 · 多实例、升级与收尾（约 1 周）

先完成 A-7 后设计不依赖持久化 PID 的多实例所有权；升级使用临时前缀冒烟与回退。随后完成崩溃策略、E-DSH-006/007、卸载清理与 `$DSH_HOME` 说明、用户文档和埋点。

**M3 验收**：手测清单全绿（见下）、文档合入、内测名单发布。

## 测试计划

- 单测：argv 构造（含含空格/引号的任务文本）、退出码→状态映射、URL 正则、端口分配、输出截断。
- 集成（CI，真实进程）：起 web → health → 软停 → 断言 exit 0；headless echo → 断言 stdout 与 exit 0。
- **金丝雀（CI 定时，每周）**：对 npm latest（非 pin）跑上述集成集；红了只报警不阻塞，用于提前发现 breaking（R-1，PRD 成功指标 3）。
- 手测清单（M3 出口）：首次安装无 Node、断网启动、休眠唤醒后 pane 状态、飞书取消进行中任务、双 pane（Kimi + DSH）各开 2h、卸载后残留检查等 12 项（Windows 与 macOS 各跑一遍），随 M1/M2 验收项固化成 checklist 文件。

## 风险应对（对应 research R-x）

| 风险 | 触发条件 | 动作 |
|---|---|---|
| R-1 breaking | 金丝雀变红 | pin 不动；评估迁移量，>2 天工作量则跳过该版 |
| R-1 极端 | 连续两个壳版本周期无可用新版路径 | 按 PRD 8 节把 pane 降级"暂不可用" |
| R-2 关停退化 | S-6 只剩硬杀且落盘无损 | 接受硬杀，文档明示"停止即中断当前回合" |
| R-3 冷启动慢 | S-10 冷启动 >90s | 强制私有前缀路线，npx 仅诊断用 |
| R-5 双 key 混淆 | 用户反馈 | 设置页把 Kimi/DeepSeek 凭据分区并加说明 |

## 发布与回滚

本地开关默认 off → 完成 M1.5 后进入内测 → 无 P0 缺陷且成功指标达标后再评估默认 on。仓库当前没有远程配置基础设施；回滚依赖用户关闭本地开关或发布禁用版本，关闭动作必须即时停止实例。

## 明确不做（复述 PRD 非目标，防蔓延）

远程/移动端访问 DSH、Cordis patch 与插件管理 UI、Kimi↔DSH 会话互通、代写 `$DSH_HOME/.credentials.yaml`、改 DSH 遥测。
