# Kimi Shell Skill Center 需求文档

## 1. 文档信息

- 文档名称：Kimi Shell Skill Center 需求文档
- 版本：v1.0
- 状态：草案
- 适用产品：Kimi Shell
- 目标读者：产品、设计、前端、Tauri/Rust、测试

---

## 2. 背景与问题定义

当前本地 Agent 工具通常会扫描约定目录中的 Skills，例如主目录或工作区中的 `.claude`、`.codex` 等目录。用户在这些目录中安装 Skills 后，往往会面临以下问题：

1. **已安装即被扫描**
   许多 Skill 一旦落在约定目录中，就会被 Claude Code、Codex、Kimi CLI 等工具自动发现。

2. **误触发风险高**
   某些 Skill 虽然有价值，但并不适用于所有任务。一旦被运行时上下文感知到，模型可能在不合适的场景中错误触发它们。

3. **主目录污染**
   用户从第三方来源安装的大量 Skill 会长期堆积在主目录，缺少统一管理入口，也缺少清晰的“安装”和“启用”边界。

4. **工作区不可控**
   若直接把 Skill 安装到真实项目目录，会导致项目被污染，也会让不同 Agent 工具共享同一批 Skill，失去会话级控制能力。

因此，需要在 Kimi Shell 中引入一个应用级的 **Skill Center**，将 Skill 的“安装”和“启用”拆分为两个动作：

- **安装**：进入应用私有 Skill Center，仅供管理，不被外部 Agent 扫描。
- **启用**：在当前 Session 中，用户手动选择 Skill，将其投影到当前 Session 的 Agent 工作区，使其仅在本次会话可见。

---

## 3. 产品目标

### 3.1 核心目标

构建一个应用私有的 Skill 管理中心，实现：

- 所有从 Git 安装的 Skill 默认进入应用目录的 Skill Center。
- Skill Center 不位于外部 Agent 的默认扫描目录中。
- 用户可在当前 Session 中通过标题栏入口打开 Skill Center 弹窗。
- 用户可手动选择所需 Skill，并一键应用到当前 Session。
- 应用后的 Skill 仅对当前 Session 可见，不直接污染真实项目目录。

### 3.2 设计原则

1. **安装不等于生效**
2. **Session 优先于全局**
3. **真实项目目录尽量无污染**
4. **外部 Agent 默认不可见**
5. **用户显式选择优先于自动发现**

### 3.3 产品口径

一句话定义：

> Skill 安装到应用，应用到 Session，不直接落盘到真实工作区。

---

## 4. 术语定义

### 4.1 Skill Center
应用私有的 Skill 仓库和管理中心，用于存放、展示、更新、信任和选择 Skill。

### 4.2 Installed Skill
已从 Git 仓库拉取到本地应用目录中的 Skill，但尚未被应用到任何 Session。

### 4.3 Trusted Skill
经过用户确认、允许被应用到 Session 的 Skill。

### 4.4 Session
用户当前在 Kimi Shell 中进行的一次工作会话。一个 Session 对应一个可独立控制的 Skill 集合。

### 4.5 Session Overlay / Agent Workspace
Kimi Shell 为当前 Session 构建的临时工作区，用于向 Claude Code、Codex、Kimi CLI 等 Agent 暴露当前已启用的 Skill。

### 4.6 应用到 Session
将某个 Skill 从 Skill Center 中投影到当前 Session 的 Agent 工作区，使其在当前 Session 中可见并可被 Agent 使用。

---

## 5. 需求范围

### 5.1 本期范围（In Scope）

1. 从 Git 安装 Skill 到应用私有目录。
2. 在 Skill Center 中展示已安装 Skill 列表。
3. 在标题栏提供 Skill Center 入口。
4. 在当前 Session 中选择并应用 Skill。
5. 将 Skill 以链接或复制方式投影到当前 Session 的 Agent 工作区。
6. 在当前 Session 中移除已应用 Skill。
7. 保存当前工作区最近使用的 Skill 记录。
8. 基础信任确认能力。

### 5.2 非本期范围（Out of Scope）

1. Skill 在线市场或推荐系统。
2. Skill 自动评分与智能排序。
3. 多用户协同共享 Skill Center。
4. 云端同步 Skill Center。
5. 自动根据任务内容智能启用 Skill。
6. Skill 编辑器与在线修改功能。

---

## 6. 用户角色与使用场景

### 6.1 目标用户

- 使用 Kimi Shell 作为本地 Agent 壳应用的开发者
- 同时使用 Claude Code、Codex、Kimi CLI 等工具的高级用户
- 希望统一管理第三方 Skills，但不希望它们默认进入运行时上下文的用户

### 6.2 典型场景

#### 场景 A：从 Git 安装 Skill
用户在 Skill Center 中输入一个 Git 仓库地址，将 Skill 安装到应用私有目录中，安装完成后可在列表中查看，但默认不会生效。

#### 场景 B：在当前 Session 中启用 Skill
用户进入某个工作区，在标题栏点开 Skill Center 弹窗，选择一个或多个 Skill，点击“应用到当前 Session”，这些 Skill 即可被当前 Session 关联的 Agent 发现。

#### 场景 C：避免误触发
用户安装了很多 Skills，但只有本次任务需要其中 2 个，因此只将这 2 个应用到当前 Session，其余 Skills 不会暴露给 Agent。

#### 场景 D：Session 结束后自动清理
用户关闭 Session 后，投影到 Session 工作区中的 Skill 自动被清理，应用私有 Skill Center 中的原始 Skill 仍被保留。

---

## 7. 功能需求

## 7.1 Skill Center 主能力

### 7.1.1 私有存储
系统应将所有从 Git 安装的 Skill 存储到应用私有目录，而非用户主目录中的 Agent 默认扫描路径。

要求：
- 不应默认落到 `.claude`、`.codex`、`.kimi` 等目录。
- 技术上应与真实项目目录解耦。

### 7.1.2 Skill 列表展示
Skill Center 应展示所有已安装 Skill，并提供以下信息：

- Skill 名称
- 描述
- 来源 Git 仓库地址
- 安装时间
- 最近更新时间
- 当前版本（branch/tag/commit）
- 信任状态
- 当前 Session 是否已应用

### 7.1.3 从 Git 安装 Skill
用户应可通过输入 Git 地址安装 Skill。

支持：
- repo URL
- 可选 branch / tag / commit

安装后系统应：
1. 拉取仓库到应用私有目录
2. 解析 Skill 结构
3. 读取 `SKILL.md`
4. 生成本地注册信息
5. 将其标记为 Installed
6. 默认不应用到任何 Session

### 7.1.4 Skill 详情查看
用户应可查看单个 Skill 的详情，包括：

- 名称与描述
- 本地路径
- 来源地址
- commit / tag / branch
- 包含文件结构概览
- 是否含 `scripts/`
- 最近安装或更新时间
- 信任状态

### 7.1.5 信任控制
从 Git 安装的 Skill 在首次应用到 Session 前，应允许用户进行信任确认。

最小能力包括：
- 标记信任 / 取消信任
- 未信任的 Skill 不允许直接应用到 Session

---

## 7.2 Session 内 Skill 使用能力

### 7.2.1 标题栏入口
在壳项目标题栏中新增 Skill 按钮。

要求：
- 点击可打开 Skill Center 弹窗
- 按钮可显示当前 Session 已应用 Skill 数量徽标

### 7.2.2 弹窗展示结构
弹窗应至少包含以下区域：

1. **已安装 Skills**
2. **当前 Session 已应用 Skills**
3. **最近使用 / 推荐恢复**（可先做最近使用）

### 7.2.3 应用到当前 Session
用户在弹窗中选择 Skill 后，可点击“应用到当前 Session”。

系统应执行：
1. 校验 Skill 已安装
2. 校验 Skill 已信任
3. 在当前 Session Overlay 中创建 Agent 可见目录
4. 以链接优先、复制兜底的方式将 Skill 投影进去
5. 更新当前 Session 的应用状态
6. 刷新标题栏徽标和弹窗状态

### 7.2.4 从当前 Session 移除
用户应可将已应用到 Session 的 Skill 移除。

系统应执行：
- 从 Session Overlay 中删除对应投影
- 更新 Session 状态
- 不删除 Skill Center 中的原始 Skill

### 7.2.5 恢复上次使用
系统应记录某个工作区最近一次 Session 使用过的 Skill 列表，以便用户在下一次进入该工作区时快速恢复。

本期可提供简单能力：
- 弹窗显示“上次在该工作区使用过”
- 用户手动一键重新应用

---

## 7.3 Session Overlay 能力

### 7.3.1 Overlay 目录
系统应为每个 Session 创建独立的临时 Overlay 目录。

该目录用于承载当前 Session 已应用的 Skills，并作为对 Agent 暴露的工作区 Skill 入口。

### 7.3.2 投影方式
系统应优先使用软链接、符号链接或 junction 将 Skill 映射到 Session Overlay。

若系统权限或平台限制导致链接失败，可回退为复制。

### 7.3.3 生命周期
Session Overlay 的生命周期应与 Session 绑定：

- Session 创建时初始化
- Skill 应用时动态写入
- Session 结束时清理

### 7.3.4 不污染真实项目目录
默认情况下，Skill 不应被写入真实项目目录。

除非未来显式增加“永久安装到工作区”能力，否则本期不支持将 Skill 长期落盘到用户项目目录。

---

## 8. 非功能需求

### 8.1 可用性
- Skill Center 弹窗应在 300ms 内打开
- Skill 列表应支持搜索
- 应用或移除 Skill 的操作应给出即时反馈

### 8.2 安全性
- 未信任 Skill 不应进入 Session
- 应保留基本来源信息和版本信息
- 应避免静默覆盖已存在 Skill

### 8.3 可维护性
- Skill 的安装、注册、应用、移除逻辑应模块化
- 前端状态管理与 Tauri 命令层应解耦

### 8.4 兼容性
- 支持 Windows 优先
- 对 macOS / Linux 预留链接与路径兼容能力
- 对不同 Agent 的 Skill 扫描目录结构预留扩展接口

---

## 9. 信息架构与目录设计

## 9.1 应用私有目录建议

```text
<AppData>/KimiShell/skill-center/
  registry.json
  repos/
    repo-search@a1b2c3d/
      SKILL.md
      ...
    commit-helper@f9e8d7c/
      SKILL.md
      ...
  trust/
  cache/
```

说明：
- `registry.json`：记录本地安装信息
- `repos/`：存放实际 Skill 内容
- `trust/`：可用于记录信任关系
- `cache/`：可用于缓存拉取信息

## 9.2 Session Overlay 建议

```text
<AppData>/KimiShell/sessions/<session-id>/
  workspace-overlay/
    .claude/
      skills/
    .codex/
      skills/
    .kimi/
      skills/
  session.json
```

说明：
- 当前 Session 需要向哪个 Agent 暴露 Skill，就在对应目录下 materialize
- 原始 Skill 仍只保存在 Skill Center

---

## 10. 交互设计要求

## 10.1 标题栏交互

### 10.1.1 Skill 按钮
- 位置：壳项目标题栏右侧功能区
- 样式：图标按钮
- 状态：
  - 无已应用 Skill：无徽标或显示 0
  - 有已应用 Skill：显示数量徽标

### 10.1.2 点击行为
点击后打开 Skill Center 弹窗，不跳离当前页面上下文。

---

## 10.2 Skill Center 弹窗

### 10.2.1 布局建议
左侧：Skill 列表
右侧：Skill 详情和操作区

### 10.2.2 列表项信息
每个 Skill 项应展示：
- 名称
- 简短描述
- 来源标识（Git）
- 信任状态
- 当前 Session 是否已应用

### 10.2.3 操作按钮
每个 Skill 可支持以下操作：
- 应用到当前 Session
- 从当前 Session 移除
- 查看详情
- 信任 / 取消信任

### 10.2.4 顶部能力
弹窗顶部应支持：
- 搜索 Skill
- 从 Git 安装 Skill
- 筛选：全部 / 已应用 / 未应用 / 未信任

---

## 11. 数据模型建议

## 11.1 InstalledSkill

```ts
interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  gitRef?: string;
  commit: string;
  localPath: string;
  trusted: boolean;
  installedAt: number;
  updatedAt: number;
  hasScripts?: boolean;
}
```

## 11.2 WorkspaceSkillProfile

```ts
interface WorkspaceSkillProfile {
  workspaceId: string;
  recentSkillIds: string[];
  pinnedSkillIds?: string[];
  lastSessionSkillIds: string[];
}
```

## 11.3 SessionSkillState

```ts
interface SessionSkillState {
  sessionId: string;
  overlayPath: string;
  appliedSkillIds: string[];
  targetAgents: Array<'claude' | 'codex' | 'kimi'>;
}
```

---

## 12. 技术方案要求

## 12.1 总体原则

- Skill Center 与真实工作区解耦
- 运行时只暴露当前 Session 已应用的 Skill
- 安装与启用分离
- 数据状态分为全局、工作区、Session 三层

## 12.2 三层状态模型

### 12.2.1 全局层
管理已安装 Skill 仓库与注册表。

### 12.2.2 工作区层
管理该工作区最近使用或上次使用过哪些 Skill。

### 12.2.3 Session 层
管理本次会话真正已生效的 Skill 集合。

---

## 13. Tauri / Rust 命令接口建议

```rust
install_skill_from_git(repo_url, git_ref?) -> InstalledSkill
list_installed_skills() -> Vec<InstalledSkill>
read_skill_manifest(skill_id) -> SkillManifest
set_skill_trust(skill_id, trusted: bool) -> ()
apply_skill_to_session(session_id, skill_id, target_agents) -> SessionSkillState
remove_skill_from_session(session_id, skill_id) -> SessionSkillState
list_session_skills(session_id) -> SessionSkillState
cleanup_session_overlay(session_id) -> ()
```

### 13.1 install_skill_from_git
职责：
- 拉取 Git 仓库
- 校验 Skill 结构
- 读取 `SKILL.md`
- 写入 registry

### 13.2 apply_skill_to_session
职责：
- 校验已安装与已信任
- 创建 Session Overlay 目录
- 将 Skill materialize 到目标 Agent 路径
- 更新 Session 状态

### 13.3 remove_skill_from_session
职责：
- 删除 Session Overlay 中对应的链接或复制内容
- 更新 Session 状态

---

## 14. 前端模块建议

## 14.1 模块拆分
建议新增以下模块：

- `features/skill-center/`
- `stores/skillStore.ts`
- `services/skillCenterService.ts`
- `services/sessionSkillService.ts`

## 14.2 页面与组件
建议组件：

- `SkillCenterButton`
- `SkillCenterModal`
- `SkillList`
- `SkillListItem`
- `SkillDetailPanel`
- `InstallFromGitDialog`
- `SessionSkillBadge`

## 14.3 状态管理
建议管理三类状态：
- 已安装 Skills
- 当前 Session 已应用 Skills
- 当前工作区最近使用 Skills

---

## 15. 业务流程

## 15.1 安装流程

1. 用户打开 Skill Center
2. 点击“从 Git 安装”
3. 输入 repo URL 和可选 git ref
4. 系统拉取仓库
5. 系统解析 Skill 并写入应用私有目录
6. 列表出现该 Skill，状态为“已安装未应用”

## 15.2 应用流程

1. 用户进入某个 Session
2. 点击标题栏 Skill 按钮
3. 在弹窗中选择 Skill
4. 点击“应用到当前 Session”
5. 系统校验信任状态
6. 系统在 Session Overlay 中 materialize Skill
7. 当前 Session 状态更新

## 15.3 移除流程

1. 用户在弹窗中查看当前已应用 Skill
2. 点击“移除”
3. 系统删除 Session Overlay 中对应映射
4. Session 状态更新

## 15.4 结束清理流程

1. Session 结束
2. 系统清理 Session Overlay
3. 保存该工作区最近使用的 Skill 历史
4. Skill Center 中原始 Skill 保留

---

## 16. 错误处理与边界情况

### 16.1 Git 拉取失败
- 应提示拉取失败原因
- 不应写入无效记录

### 16.2 Skill 结构非法
- 若缺少 `SKILL.md` 或结构不合法，应提示“不是有效 Skill”
- 不应进入已安装列表

### 16.3 重复安装
- 若同一 repo + ref 已存在，应提示已安装
- 可后续支持更新逻辑

### 16.4 未信任直接应用
- 阻止应用
- 提示用户先进行信任确认

### 16.5 链接创建失败
- 自动回退到复制
- 若复制也失败，应提示具体错误

### 16.6 Session Overlay 不存在
- 应自动创建
- 若创建失败，应提示并中止应用流程

---

## 17. 验收标准

## 17.1 功能验收

1. 用户可从 Git 成功安装一个合法 Skill 到应用私有目录。
2. 安装后的 Skill 不会出现在真实项目目录，也不会默认进入外部 Agent 扫描目录。
3. 标题栏存在 Skill Center 按钮，并可打开弹窗。
4. 用户可在弹窗中看到已安装 Skill 列表。
5. 用户可将已信任 Skill 应用到当前 Session。
6. 应用后，当前 Session 对应 Agent 可见该 Skill。
7. 用户可将已应用 Skill 从当前 Session 中移除。
8. Session 结束后，Overlay 被清理，Skill Center 中 Skill 保留。
9. 系统可记录某个工作区最近使用过的 Skill。

## 17.2 体验验收

1. 用户能够清楚区分“安装”和“应用到当前 Session”两个动作。
2. 用户在任何时刻都能知道当前 Session 生效了哪些 Skill。
3. 用户不会因为安装了大量 Skill 而默认暴露给所有 Agent。

---

## 18. 里程碑建议

### M1：最小可用版本
- Skill Center 私有目录
- 从 Git 安装
- 标题栏入口
- 当前 Session 应用 / 移除
- Session Overlay

### M2：可用性增强
- 搜索与筛选
- 最近使用恢复
- 信任状态管理
- 错误提示优化

### M3：增强能力
- 更新 Skill
- 多 Agent 定向投影
- 风险提示
- 更完整的 Skill 详情面板

---

## 19. 后续可扩展方向

1. 支持 Skill 更新与 diff
2. 支持按 Agent 选择投影目标
3. 支持“仅手动注入，不自动暴露”模式
4. 支持批量应用与工作区模板
5. 支持导入本地 Skill 压缩包

---

## 20. 附录：一句话方案摘要

> Skill Center 负责安装和管理，Session Overlay 负责临时暴露。安装进入应用私有仓库，启用才进入当前 Session，避免真实工作区污染与外部 Agent 误扫描。

