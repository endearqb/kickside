# Agent Room 文档仓库核对与修订报告

- 核对对象：`PRD.md` / `SPEC.md` / `PLAN.md`（Draft v1.0）
- 核对基线：`endearqb/kimi-app` `main@1cc7dbaca9405d055bd237e2b6f6db83b1cc86cf`（已克隆并确认为当前 main HEAD）
- 交付产物：三份文档的 v1.1 修订版（保留原结构与编号，增量修订）+ 本报告
- 核对日期：2026-07-18

## 一、总体结论

三份文档的质量明显高于常见的"设想式"设计文档：对仓库现状的绝大多数事实性声明经逐文件核对后成立，包括最关键的两个前置正确性问题——Go `ConnectorConfig` 确实没有 per-connector `defaultWorkDir` 字段（Rust 侧已有该字段与 `resetBindingSessionOnStart`，Go 用普通 `json.Unmarshal` 解码会静默丢弃）；`EnsureSession` 在只给 Workspace 时确实会取 `sessions[0]` 隐式复用。WS 协议细节（`client_hello` 的 `subscriptions[]` + per-session `cursors`、`resync_required`、事件类型集合）、lease 字段现状、`userVersion=13`、Connector prune 表清单、Admin envelope、`.ai/` 文档约定、`CURRENT_SETTINGS_SCHEMA_VERSION=10` 等也全部与仓库一致。文档提出的架构方向（Execution Core 提取、独立 Observer、Room 表与 Connector prune 隔离）与仓库自身的 `.ai/CONSTITUTION.md` 治理规则兼容。

在此基础上，核对发现了 3 处需要修正的表述、6 项文档此前未覆盖的仓库事实（其中两项是会直接影响实施顺序的现有缺口），以及若干一致性问题。全部已在 v1.1 中落实，明细如下。

## 二、需要修正的表述（v1.0 → v1.1）

**1. "处理审批和中止"高估了 Abort 的现状。** 适配器确实实现了 `AbortPrompt`（`POST /sessions/{id}/prompts/{promptId}:abort`，并把一个错误码列为幂等允许码），但 Provider、Orchestrator、Admin 三层没有任何调用方——Abort 是"有端点、无链路"。这反而是好消息：PRD §24 第 5 条与 SPEC CG-005 原本把 Abort 当作纯未知能力去探测，实际只需验证 `turn.ended(reason=aborted)` 的确认与超时语义，再新建调用链。已改写 PRD §3.1 第 6 条、§24 第 5 条、SPEC CG-005，并在 PLAN 风险表新增 R-14。

**2. `artifact.ready` 不是已证实的 Server WS 事件。** SPEC §16.5 把它与其它事件并列映射，但当前 Server 适配器的 WS 帧处理没有任何 artifact 分支；`artifact_ready` 只存在于 SDK Driver 路径（`providers/kimi/provider.go`）。若按原文实现，Room 会承诺一个可能不存在的事件。已在映射表标注"待验证"、表后补充"哪些事件已在现网单 Prompt 流中证实"的清单，并新增 CG-008；PLAN AR-001 探测清单同步补项。

**3. Grid 回滚风险从"抽象担忧"升级为"已确认的具体行为"。** 现有加载器对 `parsed.version !== 1` 的处理是回退 legacy 迁移——即静默重置为默认布局，而非报错；且存储键名本身就是 `kimi-workspace-grid-state-v1`。原 PLAN §18.3 给出的"同 key + version 2"建议在回滚场景下会让旧版本清空用户布局。v1.1 将其改为明确决策：独立键 `kimi-workspace-grid-state-v2`，读取时 v2 优先、缺失则从 v1 迁移且不回写不删除 v1。另发现 `kimi-workspace-grid-saved-layouts-v1` 中每条 saved layout 内嵌完整 persisted state——三份文档此前都遗漏了 saved layouts 的迁移，已补入 SPEC §18.2/§35.1 与 PLAN AR-600/§18.3。

## 三、仓库带来的新信息（文档此前未覆盖）

**1. Server 路径附件丢失（现有缺口，影响实施顺序）。** `AdapterPromptRequest.Attachments` 在 `SubmitPrompt` 中从未被序列化进 `/prompts` 请求体——Server Provider 下飞书图片/文件附件今天就在被静默丢弃。这不只关系 Agent Room 的 FR-RUN-007，也是现有 IM 的正确性问题。v1.1 新增 SPEC CG-007（先验证 `/prompts` 附件契约）与 PLAN AR-104（修复任务，明确不依赖 Agent Room Feature Flag），并进入 Phase 1 Gate 与风险表 R-13。

**2. `promptEventMatches` 缺省放行。** payload 无 `prompt_id` 时按匹配处理，同 Session 并发时可能把无关事件归入当前 Prompt 聚合。这一现存尖角直接支持 SPEC §16.4"Observer 不用 Prompt 过滤"的设计，同时要求 Spike 摸清"哪些事件类型总是带 prompt_id"（AR-001 新增探测项，另加"prompt metadata 是否在事件中回带"——决定 Run 归属第一优先级是否可用）。

**3. 新建 Code Pane 默认无 Session。** 仓库自述（`.ai/architecture/current-state.md`）明确：Grid 新建/切换 Code Pane 打开的是 Kimi Code Web 根页面，不自动创建 Session。反向镜像必须把"可见 Code Pane、无任何 Session"作为一等状态处理。已补入 SPEC §2.1、PLAN §19.2 测试矩阵与 Observer MVP DoD。

**4. `openPaneFromExplorer` 只按持久化 `sessionId` 匹配。** 不看运行期 `activeSessionId`——目标 Session 已在某 Pane 中显示（运行期导航所致）时会错误新建重复 Pane。这是"打开/聚焦准确 Session"（G4/FR-PANE-002）的隐蔽反例。已在 SPEC §18.4 把 effective-session 匹配定为泛化时的强制修正，并注明 `focus_existing` 是对现有 `WorkspaceSessionDisposition`（仅 `replace_active | new_pane`）的新增值；PLAN AR-603 补对应任务与测试。

**5. Locator 已含 `generation` / `ownership`。** `kimi_runtime_locator.json` 由 Rust 维护 generation 与 ownership（含 `reused_external` 外部进程形态），Go 侧 snapshot 目前只读 origin/tokenPath/health。SPEC §17.4 的 Runtime Generation 不必另造计数，改为以 locator 为权威来源；`reused_external` 纳入 Observer 生命周期与降级文案的考虑。另外 `wsCursor` 已带可选 `epoch` 字段、`GET /sessions/{id}` 返回 `last_seq` 可作 Cursor 引导——分别形成新 CG-009 与 §16.3 补注。

**6. 前端完整 Gate 是 `pnpm -C apps/kimi-shell verify`。** 该脚本串联 tsc、vitest 与三个 NFR 安全检查（`check_capabilities.mjs` / `check_bundle_resources.mjs` / `check_command_registry.mjs`）。原 PLAN §21 只列了其中一个；新增 Tauri command 时 capabilities 与 bundle 检查必然联动。已补全（并注明脚本内 tsc 路径为 Windows 专用）。

**7. 治理约束落到条款。** `.ai/CONSTITUTION.md` 把持久化结构、序列化契约（含 Tauri command 名、Admin envelope、locator 字段）列为"单向门"，要求先出 accepted ADR。v1.1 在 PLAN §16 明确列出需要 ADR 的五类变更及对应 PR（Grid V2 / migrations 0014–0016 / agent-room Admin 契约 / 新 Tauri commands / `CreateMode` 扩展），并把 ExecutionService 提取按"抽象由第二个调用方证明"的宪法条款定性。其余零散事实（`listSessions` 不翻页、`thinking_delta` 已在 `turn_events` 持久化、飞书触发仅前缀 at-tag 未校验 mention-self、Shell UI 会幂等删除 Telegram connector、iframe 桥经 `initialization_script_for_all_frames` 注入全部 frame）也已写入对应位置。

## 四、一致性修正

SPEC §19.9 `afterSeq`"必需，默认 0"自相矛盾，改为"可选，缺省 0"；SPEC §10.4 Run Origin 补 `unknown` 与 PRD §15.4 对齐；SPEC §8.5 `AgentRun` 补 `QueuePosition *int` 与 §9.2 表结构对齐；§8.9 Lease 补心跳连续失败的降级行为；§27.3 补现有 Approval 解决链路（`ResolveApproval(approvalID, status, payload)` 三参形态、40902 幂等码）说明 Room 只做归属校验不改契约；PRD §15.2 补注 Session 终态是"最近一次 Turn 的投影"；§13.5 `CreateMode` 标注为缺省 `if_missing` 的只增扩展、`reuse_latest` 即现有 `sessions[0]` 语义的显式命名。

## 五、v1.1 变更定位

- `PRD.md`：§3.1（两处改写 + 新增 10/11 条）、§3.2（新增 5 条缺口）、§15.2 注、§21 风险（1 改 2 增）、§24（2 改 4 增）、新增 **§27 仓库核对记录**（16 行证据表 + 修订清单）。
- `SPEC.md`：§2.1/§2.2 现状补充、§8.5、§8.9、§10.4、§13.5、§16.3/16.5/16.8、§17.4、§18.2、§18.4、§19.9、§27.3、§35.1、§36（CG-005 改写，新增 CG-007/008/009）、§40、新增 **§42 现有代码契约对照**（Go 结构体、WS 帧/Cursor、Runtime HTTP、Shell/Grid 事实、治理约束五个子节，作为"只增不改"的冻结基准）。
- `PLAN.md`：AR-001（+6 探测项 + Abort 注）、AR-100 注、新增 **AR-104**、Phase 1 Gate、AR-600、AR-603、§16 单向门 ADR 要求、§18.3 改写、§19.2、§21、§24（R-05 改 + R-13/R-14）、Observer MVP DoD、新增 **§32 仓库核对记录**。

所有修订均为增量插入或原句改写，未改动任何原有章节编号、FR/AC/AR/PR/CG/INV 编号与既有结论；三份文档的交叉引用（PRD §27 ↔ SPEC §42 ↔ PLAN §32）互相指向。

## 六、遗留开放问题

以下问题核对无法在静态仓库层面关闭，仍归属 Phase 0 Spike：多 Session 订阅的实际行为（hello 协议形态已知，多值语义未知）、Transcript/用户 Prompt 事件是否存在、`epoch` 语义、原生 Follow-up 队列、`approved_for_session` 的重启后范围、附件与 artifact 事件的 Runtime 侧答案。另有一处产品层面建议（未写入文档，供决策）：PRD §15.2 的 Session 状态枚举与 Run 终态高度重叠，长期可考虑收敛为 `idle/running/waiting_approval/unreachable/unknown + lastTurnStatus` 二元结构，v1.1 仅以注释澄清语义、未改枚举，以免牵动 SPEC/PLAN 的既有引用。
