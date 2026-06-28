# README First

面向本仓库所有 AI Agent 和维护者的项目上下文协作原则。

`.ai/CONSTITUTION.md` 规定项目级治理宪法；`README_First.md` 解释为什么要采用 README First 以及文档如何分层；`AGENTS.md` 规定每次任务必须执行的具体规则。若日常执行步骤表述有差异，以 `AGENTS.md` 为准；若抽象、单向门决策、完成状态或重构治理原则有差异，以 `.ai/CONSTITUTION.md` 为准。

## 一句话定义

先读上下文，再执行操作；先收敛不确定性，再修改文件；先验证影响，再记录变化。

README First 的目的不是多写文档，而是让每一次人类或 AI 的变更都从稳定上下文出发，并把新的长期事实沉淀回仓库。

## 为什么需要它

真实工程中的 AI 风险通常不是语法错误，而是上下文缺失：

1. 不知道目录职责，导致把文件放错层级。
2. 没有检查既有实现，重复创建模块或抽象。
3. 忽略公共 API、权限、schema、路由、CI gate 或数据流边界。
4. 把历史方案、当前事实和未来计划混在一起。
5. 修改完成后只留下 diff，没有留下原因、假设、验证和剩余风险。

README First 把这些风险转化为可执行流程：先读取、再定位、再收敛、再实施、再验证、再记录。

## 文档分层

| 机制 | 职责 |
|---|---|
| `.ai/CONSTITUTION.md` | 项目宪法，规定抽象、决策、验证、完成状态和重构治理的最高长期规则 |
| `AGENTS.md` | AI 行为规则和执行流程 |
| `README_First.md` | README First 原则说明和文档分层说明 |
| 根 `README.md` | 仓库地图、主工程入口和全局索引 |
| 目录 `README.md` | 局部目录职责、边界、接口和验证方式 |
| `.ai/architecture/` | Agent 动手前需要确认的长期架构事实入口 |
| `.ai/decisions/` | 长期架构决策、跨目录约定和技术路线 |
| `.ai/changes/` | 每次 AI 修改的原因、范围、假设、验证和剩余风险 |
| `tasks/todo.md` | 当前任务计划、进度追踪和复盘 |
| `README_FIRST_EXECUTION_PLAN.md` | README First 初始化历史执行方案，不作为日常规则入口 |

## 推荐读取顺序

执行查询、分析、新增、修改或删除前，默认按以下顺序建立上下文：

1. `AGENTS.md`
2. `.ai/CONSTITUTION.md`
3. `README_First.md`
4. 根 `README.md`
5. 必要的 `.ai/architecture/` 主题文档
6. 目标路径从上到下的目录 `README.md`
7. 目标文件、直接依赖、调用方和相关测试
8. `.ai/changes/`、`.ai/decisions/`、`tasks/todo.md` 中与当前任务相关的记录

复杂任务、架构变更、权限/API/schema/CI/数据流相关任务，必须把 `.ai/architecture/README.md` 作为架构事实入口。

## 好 README 的标准

- 准确：基于当前文件、代码和验证入口，不凭空设计。
- 简短：记录长期有用的职责、边界、接口和验证方式。
- 可操作：能指导 Agent 做正确的增删改查。
- 有边界：明确本目录负责什么、不负责什么。
- 有验证：说明修改后应运行哪些检查。
- 可维护：不记录流水账，不堆积临时调试信息。

README 不应记录普通 bugfix、局部样式、临时日志、可从 git diff 看出的细节或未经验证的猜测。普通修改写入 `.ai/changes/`；长期决策写入 `.ai/decisions/`；架构事实索引写入 `.ai/architecture/`。

抽象、单向门决策、完成状态、gate 分层、兼容层退出条件和重构触发标准写入 `.ai/CONSTITUTION.md`。只有这些宪法级规则变化时才更新该文件。

## README 类型与预算

每份 README 应能归入一种类型，避免把稳定契约、历史阶段和导出说明混在一起：

| 类型 | 用途 | 建议上限 |
|---|---|---:|
| `contract` | 活跃目录职责、边界、稳定契约和验证入口 | 根/应用 120 行；域/feature 70 行 |
| `pointer` | 指向 canonical source，不重复维护细节 | 30 行 |
| `archive` | 历史快照或外部导入材料，不作为当前执行入口 | 40 行 |
| `artifact` | 可复制、导出或交付包的本地使用说明 | 60 行；长手册另放专门文档 |
| `release` | 特定阶段、UAT、evidence 或 release 基线 | 不进入日常目录契约权威链 |

## Contract README 模板

活跃目录 README 默认保持以下最小结构；目录过小时可以压缩为指针式说明：

````md
# <目录或模块名>

> 类型：contract
> Canonical sources：<源码/OpenAPI/migration/机器清单>

## 职责与非职责
- 负责：
- 不负责：

## 稳定契约
- <核心对象、状态机、入口或不可破坏的不变量>

## 依赖边界
- 允许依赖：
- 禁止依赖：

## 变更触发
- <哪类变更必须同步 OpenAPI、migration、权限、测试或其他 README>

## 验证
```powershell
# 从仓库相对路径执行的 1-4 个稳定入口
```
````

## README 禁项

active contract README 不应长期保留：

- Windows 盘符路径、用户主目录路径或 URL 化盘符路径等本机绝对路径。
- 可直接使用的账号密码、令牌、数据源 secret、对象存储凭据或其他私密配置。
- 普通 bugfix、阶段流水账、已完成 checklist 或可从 git diff 得到的细节。
- 可从文件树、`package.json` 或脚本目录自动得到的大段清单。
- 未验证的“已完成”“已生产可用”“已部署”等完成状态。
- 里程碑代号和阶段标签；这类历史只应出现在 archive、release、`.ai/changes/` 或 git history。

## 标准执行流程

```txt
1. 把 prompt 转换为任务契约
2. 定位影响范围
3. 读取 AGENTS.md、.ai/CONSTITUTION.md、README_First.md、根 README 和相关目录 README
4. 按任务类型读取 .ai/architecture 中的长期架构事实
5. 检查 README、架构文档与实际代码是否冲突
6. 用最小、保守、可验证的方式执行
7. 运行或说明验证方式
8. 按触发条件更新 .ai/CONSTITUTION、README、.ai/architecture 或 .ai/decisions
9. 在 .ai/changes/ 和 tasks/todo.md 记录结果
10. 输出包含假设、验证和剩余不确定性的简洁报告
```

## 与现有文档的关系

- `README_FIRST_EXECUTION_PLAN.md` 是建立 README First 体系时的执行方案，保留为历史材料。
- `.ai/CONSTITUTION.md` 是项目级治理宪法，约束抽象、决策、完成状态和重构触发。
- `README_First.md` 是长期原则入口，供后续 Agent 快速理解文档系统。
- `.ai/architecture/` 是当前新增的确定性层，负责聚合架构事实、边界和验证入口。
- `hte-v2/docs/architecture/` 仍然负责 HTE V2 工程内的架构基线和治理文档。

## 结论

README First 的本质是项目上下文治理：让 AI 先理解项目，再改变项目；让每一次改变反过来增强项目的可理解性。