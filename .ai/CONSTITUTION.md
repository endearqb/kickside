# Kimi App Project Constitution

> Scope：本文件约束 `endearqb/kimi-app` 仓库内所有人类维护者与 AI Agent 的长期工程治理。
> Authority：当本文件与 `AGENTS.md`、`README_First.md`、目录 README 或 `.ai/architecture/` 发生规范冲突时，以本文件为准；当本文件与可执行事实冲突时，先承认冲突，再修正文档或代码。
> Update rule：只有抽象治理、单向门决策、完成状态、gate 分层、兼容层退出条件或重构触发标准发生变化时，才更新本文件。

## 1. 宪法目标

本仓库的核心目标是维护一个面向 Kimi Web / Kimi Code Web 的 Windows 桌面壳，并围绕启动、恢复、工作区接管、控制中心、IM Bridge、诊断和 Windows 安装包输出建立稳定、可验证、可演进的工程系统。

本宪法的目标不是规定每一步如何执行；执行细则属于 `AGENTS.md`。本宪法只规定长期不应被普通任务随意推翻的治理原则：

1. 先理解项目上下文，再改变项目。
2. 先收敛本质不确定性，再选择实现。
3. 先保护稳定契约，再扩展能力。
4. 先验证事实，再声明完成。
5. 先记录原因、假设和剩余风险，再结束任务。

## 2. 文档权威与事实权威

### 2.1 规范权威顺序

当文档之间出现“应该怎么做”的冲突时，按以下顺序解释：

1. `.ai/CONSTITUTION.md`
2. `AGENTS.md`
3. `.ai/decisions/` 中状态为 accepted 的 ADR
4. 距离目标文件最近的目录 README
5. 上级目录 README、`README_First.md`、设计系统文档和其他说明文档
6. `.ai/changes/`、`tasks/`、历史计划和复盘材料

历史记录不得反向覆盖当前治理规则。若历史计划与当前宪法冲突，应保留历史，但不得按历史继续执行。

### 2.2 事实权威顺序

当文档与“系统实际是什么”发生冲突时，按以下顺序确认事实：

1. 可运行结果、测试结果、CI gate、构建产物和运行日志
2. 公开接口契约、迁移脚本、生成代码、配置 schema 和 package 脚本
3. 当前源码
4. `.ai/architecture/` 中的当前事实摘要
5. README、`.ai/changes/`、任务计划和人工说明

事实冲突不得静默处理。Agent 必须说明冲突，并选择以下路径之一：修正文档、修正代码、补充验证，或把剩余不确定性记录到 `.ai/changes/`。

## 3. 项目边界不变量

### 3.1 Shell 边界

`apps/kimi-shell` 是 Windows 桌面壳，不是 Kimi Web 的替代实现。Shell 可以负责：

- 本地 `kimi server run` 生命周期管理、健康探测和恢复入口。
- Kimi Code Web / Kimi Chat 的桌面承载、Workspace Grid、窗口与托盘行为。
- 安装、升级、诊断、日志、右键菜单、Windows 打包和发布体验。
- 与 Bridge sidecar 的本机托管、状态展示和控制入口。

Shell 不应在未经明确决策的情况下复制 Kimi Web 的业务能力、长期持有明文 token、绕过官方 runtime API，或把临时调试路径变成长期产品接口。

### 3.2 IM Bridge 边界

`apps/kimi-im-bridge` 是 Shell 托管的 IM sidecar，负责 IM 通道、runtime adapter、审批投递和会话绑定等桥接能力。Bridge 可以适配 Telegram、Feishu、Weixin 等通道，也可以在 SDK、ServerAdapter、ACP 等 runtime 之间做受控 fallback。

Bridge 不应把 secret 放入进程命令行、日志、诊断包或可持久化明文配置；不得让自动审批、pending approval、session binding 或 channel delivery 的兼容分支绕过安全默认值与幂等约束。

### 3.3 官方 runtime 优先

只要官方 Kimi Code server API 能表达目标能力，优先使用官方 API 和可验证契约。兼容层、fallback、旧字段和旧 localStorage key 只能服务迁移或降级，不得成为新的 canonical path。

## 4. 抽象治理

### 4.1 抽象准入

新增抽象层、适配器、状态模型、公共 helper 或跨目录模块前，必须满足至少一项条件：

1. 同一规则已经在两个以上位置重复，并且重复会导致维护风险。
2. 该边界对应稳定外部契约，例如 Tauri command、runtime API、IM channel adapter、installer catalog、Workspace Grid state。
3. 该抽象能隔离明显变化源，例如平台差异、sidecar runtime、安装任务、日志脱敏或 UI view model。
4. 该抽象能减少安全、数据一致性或发布验证风险。

不允许为了“看起来更架构化”而新增抽象。不允许把一次性流程、临时兼容、未验证实验或未来可能需求提前抽象为长期层。

### 4.2 抽象责任

每个长期抽象必须有清晰责任：

- 命名说明它保护的边界，而不是只说明技术形态。
- 输入、输出、错误、持久化副作用和线程/异步边界必须可追踪。
- 公共类型和序列化字段必须兼顾向后兼容、迁移路径和测试。
- 与安全相关的抽象必须默认脱敏、默认拒绝危险输入、默认关闭高风险能力。
- 抽象不得隐藏失败；失败应转化为明确状态、错误类型、日志或 UI 恢复路径。

### 4.3 抽象退出

任何兼容抽象、fallback、legacy key、临时 wrapper 或实验 adapter 都必须具备退出条件：

- canonical path 是什么。
- legacy path 仍支持哪些输入和版本。
- 什么验证证明 legacy path 可以删除。
- 删除时需要更新哪些 README、`.ai/architecture/`、`.ai/changes/` 或 ADR。
- 删除后用户数据、工作区、session、审批和日志如何保持可迁移或可恢复。

没有退出条件的兼容层视为技术债，必须在 `.ai/changes/` 或 `.ai/architecture/current-state.md` 中暴露。

## 5. 单向门决策治理

### 5.1 单向门定义

以下变更属于单向门或近似单向门决策，不得以普通实现细节处理：

- 改变应用主架构、runtime 主路径或 Bridge provider 主路径。
- 改变持久化数据格式、SQLite migration、localStorage schema、配置文件或 runtime locator 结构。
- 改变 Tauri command、公开 API、IM admin API envelope、安装包输出格式或 CI release gate。
- 改变 secret 传递方式、日志脱敏策略、审批默认值、权限默认值或外部 URL/文件处理策略。
- 引入或移除跨目录依赖、平台依赖、sidecar 二进制、构建工具链或发布流程。
- 删除兼容层、迁移路径、旧入口或用户可见行为。

### 5.2 决策要求

单向门决策必须先形成任务契约，并写入 `.ai/decisions/` 或对应 README。记录至少包括：

- 决策背景和被否定的主要备选方案。
- 受影响的目录、公共契约、数据、用户行为和验证 gate。
- 回滚策略或不可回滚原因。
- 兼容策略和退出条件。
- 安全、隐私、可靠性、Windows 打包和 IM 通道影响。
- 验证证据和仍需人工验证的部分。

没有记录的单向门变更不得宣称完成。

## 6. 验证与完成状态

### 6.1 Gate 分层

验证分为四层：

1. **文档 gate**：目标文档存在、职责不冲突、链接与路径有效、没有本机绝对路径或 secret。
2. **静态 gate**：类型检查、lint、格式检查、脚本级合规检查和编译前检查。
3. **运行 gate**：单元测试、集成测试、`cargo check`、`go test`、前端测试、Tauri command 或 sidecar smoke。
4. **人工/发布 gate**：真实 IM 凭证、Windows 安装包、NSIS/MSI、系统托盘、右键菜单、WebView2、下载、诊断包脱敏和发布环境验证。

任务只需要运行与影响范围匹配的最小必要 gate，但必须说明为什么这些 gate 足够。

### 6.2 完成定义

任务只有在满足以下条件后才能标记为完成：

1. 用户目标被转化为明确交付物。
2. 影响范围已经检查，且没有未说明的公共契约变化。
3. 必要 gate 已运行并通过；无法运行的 gate 已说明原因、风险和补位方式。
4. 文档触发条件已评估；需要更新的 README、`.ai/architecture/`、`.ai/decisions/` 或 `.ai/changes/` 已更新。
5. 剩余不确定性已记录，而不是被包装为“已完成”。
6. 没有把未验证的行为称为生产可用、已发布、完全支持或安全无风险。

文档-only 任务也需要验证：至少要确认目标文件位置、规范权威关系、相关索引或已知缺口是否需要同步更新。

## 7. 安全与隐私不变量

以下规则不得被普通任务绕过：

1. 不把 token、API key、密码、cookie、私有路径、IM 平台密钥或可复用凭据写入 README、`.ai/changes/`、日志、诊断包、命令行参数或截图。
2. secret 传递优先使用环境变量、token file 或系统安全存储；不得新增明文 CLI 参数作为主路径。
3. 所有日志、诊断、Bridge tail、runtime locator、错误摘要和 UI 状态都必须脱敏。
4. 自动审批、高权限操作、外部 URL relay、文件导入、下载、右键菜单注册和安装脚本必须采用安全默认值。
5. 外部 Web 内容只能通过明确允许的协议、origin 和隔离边界进入 Shell。
6. 任何安全默认值从“拒绝/关闭”改为“允许/开启”都属于单向门决策。

## 8. 重构治理

### 8.1 重构触发

满足以下条件之一时，应考虑重构：

- 同一文件反复承载无关职责，导致简单修改需要理解过多状态。
- 安全、审批、runtime、安装、日志或持久化路径出现重复判断。
- 公共契约与内部实现耦合，导致测试难以覆盖。
- 兼容分支已经影响 canonical path 的清晰度。
- 新功能必须先拆出自然边界才能以小变更完成。

### 8.2 重构约束

重构必须遵守：

1. 默认不改变用户可见行为、Tauri command 名称、序列化字段、CSS class、i18n key 或安装包输出。
2. 先拆自然边界，再改行为；行为变更应单独提交或单独记录。
3. 只抽出稳定 helper、view model、adapter、catalog、schema 或 boundary owner；不把临时流程抽成框架。
4. 每次重构必须有回归 gate；没有 gate 的重构只能做极小机械移动。
5. 如果重构暴露 README 或架构事实过期，必须同步修正。

## 9. README First 与记录规则

README 是目录契约，不是流水账。`.ai/changes/` 是变更记录，不是架构权威。`.ai/architecture/` 是当前事实入口，不是替代源码。`.ai/decisions/` 是长期决策记录，不是任务清单。

更新规则：

- 普通 bugfix、文案、局部样式、内部重排：写入 `.ai/changes/YYYY-MM-DD.md`。
- 目录职责、公共 API、依赖边界、验证入口或长期约定变化：更新最近的 contract README。
- 当前架构事实、已知缺口或验证 gate 变化：更新 `.ai/architecture/`。
- 单向门决策、跨目录技术路线或不可轻易回滚的取舍：写入 `.ai/decisions/`。
- 抽象治理、完成定义、gate 分层、兼容层退出或重构触发标准变化：更新本文件。

## 10. 禁止行为

维护者和 Agent 不得：

1. 未读上下文就新增、修改或删除文件。
2. 为通过测试而削弱测试、降低安全默认值或扩大 allowlist。
3. 用 README 修改掩盖代码事实错误。
4. 静默改变公共 API、序列化字段、安装行为、secret 传递方式或审批默认值。
5. 把失败的 gate 描述为通过。
6. 把“未验证”“本机无法验证”“需要真实凭证验证”的能力描述为已完成。
7. 为局部问题做大范围重写，除非任务契约和验证计划已经覆盖影响范围。
8. 在 active contract README 中保留本机绝对路径、阶段口号、完成 checklist 或可从 git diff 得到的短期细节。

## 11. 宪法维护

本文件应保持稳定、抽象、可执行。它不记录普通功能清单、发布流水账、临时 bug、阶段计划或一次性任务。

当需要修改本文件时，必须在变更记录中说明：

- 为什么现有治理规则不足。
- 新规则影响哪些文档、代码路径和验证 gate。
- 是否需要同步更新 `AGENTS.md`、`README_First.md`、`.ai/architecture/` 或 `.ai/decisions/`。
- 本次修改是否引入新的单向门规则、抽象准入标准或完成定义。
