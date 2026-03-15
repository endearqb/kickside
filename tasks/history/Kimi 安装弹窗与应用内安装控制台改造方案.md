# Kimi 安装弹窗与应用内安装控制台改造方案

## 1. 背景与目标

当前 `apps/kimi-shell` 已经具备安装引导的基础骨架，但真实执行链路仍然依赖外部 PowerShell。用户点击安装后，应用只是写出临时 `.ps1`，再通过 `Start-Process` 拉起外部终端执行；一旦外部 PowerShell 启动异常、窗口闪退或提权失败，界面内几乎没有可读反馈，用户无法判断当前执行到哪一步，也无法确认是命令本身失败还是终端唤起失败。

本次方案目标不是直接改代码，而是沉淀一份可直接实施的规格文档，明确：

- 当前依赖和安装链路的真实现状。
- 为什么要把安装入口统一收口到一个弹窗。
- 为什么核心 Kimi 安装/升级需要迁移到应用内安装控制台。
- 哪些动作必须是应用内执行，哪些动作允许保留外部管理员终端兜底。
- 前后端需要新增哪些类型、命令、事件和状态模型。

本方案默认约束：

- `Git for Windows` 从“必装前置”调整为“可选增强项”。
- 应用内“终端”定义为安装控制台，不做通用交互式 PTY。
- `uv / Python 3.13 / kimi-cli / 升级 kimi-cli` 走应用内执行主链路。
- `Git / Node.js` 允许保留外部管理员终端兜底，不阻塞 Kimi 基础安装。

## 2. 当前现状审计

### 2.1 应用构建与运行依赖

#### 前端

- 框架：`React 19.1.0`
- 构建：`Vite 7.0.4`
- 桌面桥接：`@tauri-apps/api ^2`
- 原生对话框：`@tauri-apps/plugin-dialog 2.6.0`
- 图标库：`lucide-react 0.561.0`

#### Rust / Tauri

- 核心：`tauri 2`
- 插件：`tauri-plugin-dialog`、`tauri-plugin-global-shortcut`、`tauri-plugin-single-instance`
- 网络/代理：`reqwest`、`tiny_http`
- 配置与定位：`toml_edit`、`which`
- Windows 平台依赖：`windows`、`webview2-com`、`winreg`

#### 桌面运行前置

- WebView2 Runtime
- Windows 环境

说明：这些属于应用本身的构建和运行依赖，不等同于 Kimi CLI 安装依赖，不应该全部塞进“安装 Kimi”按钮的责任范围。

### 2.2 Kimi 安装依赖

#### Kimi 基础安装必需项

- `winget / App Installer`：用于安装 `uv` 或可选安装其他工具
- `uv`
- `Python 3.13`
- `kimi-cli`

#### 可选增强项

- `Git for Windows`
- `Node.js`

结论：

- 从当前安装命令本身看，`install_kimi_cli` 实际依赖的是 `uv + Python 3.13`。
- `Git` 并不是 Kimi CLI 基础安装的硬前置。
- 现有“安装依赖（Git / uv）”命名和实际目标耦合过重，容易让用户误以为“不装 Git 就不能装 Kimi”。

### 2.3 当前前后端链路

#### 前端入口

- `apps/kimi-shell/src/features/control-center/ControlCenterView.tsx`
  - 引导配置页中已有安装按钮、安装源切换、完整命令弹窗入口。
- `apps/kimi-shell/src/features/control-center/InstallCommandsModal.tsx`
  - 当前负责展示和复制命令，但不负责执行。
- `apps/kimi-shell/src/app/useShellController.ts`
  - 当前负责安装探测、按钮点击、Tauri `invoke` 调用、安装完成后的轮询复检。

#### 后端入口

- `apps/kimi-shell/src-tauri/src/lib.rs`
  - 暴露 `install_kimi_dependencies`
  - 暴露 `install_kimi_cli`
  - 暴露 `upgrade_kimi_cli`
  - 暴露 `install_nodejs`
  - 暴露 `get_install_probe_status`
  - 暴露 `get_install_command_catalog`
- `apps/kimi-shell/src-tauri/src/backend_manager.rs`
  - 内置 PowerShell 脚本常量。
  - 负责生成命令目录。
  - 负责把脚本写到临时目录。
  - 通过 `Start-Process` 拉起外部 `powershell.exe`。

### 2.4 当前执行方式

当前真实执行链路如下：

1. 用户在控制中心点击安装按钮。
2. `ControlCenterView` 调用 `useShellController` 中的安装 handler。
3. `useShellController` 通过 Tauri `invoke` 调用 Rust 命令。
4. Rust 在 `backend_manager.rs` 中选择对应 PowerShell 脚本。
5. Rust 把脚本写入 `%TEMP%\\kimi-shell-installer\\*.ps1`。
6. Rust 再调用 `powershell.exe -Command Start-Process ...` 启动外部 PowerShell。
7. 前端只拿到一句“外部 PowerShell 已启动”的摘要文本。
8. 前端随后轮询 `get_install_probe_status`，等待环境复检通过。

### 2.5 当前问题

#### 问题 1：安装执行不透明

- 应用内无法看到 stdout/stderr。
- 用户只能看到一句成功拉起摘要，无法判断命令执行过程。
- 一旦脚本执行卡住，界面缺乏阶段感知。

#### 问题 2：外部 PowerShell 容易成为故障点

- 当前用户已反馈：拉起外部 PowerShell 时会直接报错退出。
- 这类故障与安装命令本身无关，但会被误认为“安装失败”。
- 应用内没有展示启动 PowerShell 失败的细节，也没有日志流帮助定位。

#### 问题 3：命令展示与执行逻辑重复维护

- `backend_manager.rs` 里同时维护“执行脚本常量”和“命令目录展示文本”。
- 两者功能接近，但并非同一份数据。
- 后续一旦调整脚本顺序、参数或说明，容易出现“复制出来的命令”和“实际执行脚本”不一致。

#### 问题 4：安装入口分散

- 当前引导页正文里有安装按钮。
- “查看完整安装命令”又是另一套弹窗。
- 用户要在“按钮执行”和“看命令复制”之间来回切换，学习成本高。

#### 问题 5：Git 被错误塑造成 Kimi 基础依赖

- 当前“安装依赖”默认包含 `Git + uv`。
- 但 Kimi CLI 核心安装并不依赖 Git。
- 这会把本可快速安装完成的核心链路拉长，并引入管理员权限、安装器 UI 等额外不确定性。

## 3. 参考项目对齐结论

参考项目：`https://github.com/endearqb/execlink`

从其公开 README 可提炼出三点产品形态：

1. 未安装时提供“快速安装向导”。
2. 提供“仅执行安装”能力，不强迫用户先手动复制命令。
3. 提供“复制安装命令”，满足高级用户手动执行需求。

另外，`execlink` 默认终端运行器是 `Windows Terminal (wt)`，说明它把“如何执行安装命令”作为产品能力明确收口，而不是让用户自己找终端。

本项目不直接照搬其通用终端思路，而是只吸收其安装产品分层：

- “快速安装向导” -> 本项目的一键基础安装。
- “仅执行安装” -> 本项目的分步安装按钮。
- “复制安装命令” -> 本项目弹窗中的逐步复制和整组复制。

## 4. 目标产品方案

### 4.1 统一弹窗定位

将现有“完整安装命令”弹窗升级为统一的“安装与升级”弹窗，成为安装相关唯一主入口。

弹窗职责：

- 展示环境检测状态。
- 提供一键基础安装。
- 提供分步安装/升级。
- 展示控制台输出。
- 提供复制命令和失败兜底说明。

原控制中心引导卡片只保留一个入口按钮，例如：

- `打开安装与升级`

不再在卡片正文中长期摆放多排安装按钮，避免主界面过载。

### 4.2 弹窗固定信息架构

弹窗分成 4 个区域。

#### A. 环境状态区

展示以下状态项：

- `winget / App Installer`
- `uv`
- `Python 3.13`
- `kimi-cli`
- `Git`
- `Node.js`
- 聚合状态：`Kimi 基础环境`

状态文案建议：

- `已就绪`
- `未安装`
- `可选`
- `需管理员权限`
- `检测失败`

聚合规则：

- `coreReady = uvReady && python313Ready && kimiReady`
- `gitReady` 单独展示，不参与 `coreReady`

#### B. 一键操作区

提供一个主按钮：

- `一键安装 Kimi 基础环境`

其执行顺序固定为：

1. 安装 `uv`
2. 安装 `Python 3.13`
3. 安装 `kimi-cli`
4. 自动复检并刷新引导状态

该按钮不包含 `Git`，也不包含 `Node.js`。

#### C. 分步操作区

提供以下独立动作：

- `安装 uv`
- `安装 Python 3.13`
- `安装 Kimi`
- `升级 Kimi`
- `安装 Git`
- `安装 Node.js`

分步按钮用于：

- 用户只想补齐缺失项。
- 一键安装失败后局部重试。
- 高级用户按需控制步骤。

#### D. 控制台区

控制台区展示：

- 当前任务名
- 当前阶段名
- 实时输出
- 标准输出/错误输出来源标识
- 开始时间与结束时间
- 退出码
- 复检结果
- 重试按钮
- 取消按钮
- 复制日志
- 复制当前步骤命令
- 复制整组流程命令

控制台支持“最近一次执行结果保留”，避免用户关闭后丢失上下文。

### 4.3 安装源切换

保留：

- `官方源`
- `镜像源`

但切换作用于统一任务模型，而不是仅作用于命令展示。

具体规则：

- 同一个 `taskId` 可根据 `source` 选择不同命令步骤。
- 控制台标题、复制命令、执行内容都从同一份任务定义派生。

## 5. 执行架构设计

### 5.1 设计原则

- 一个动作只有一份命令定义。
- 应用内执行优先，外部终端兜底次之。
- 用户看得见执行过程，而不是只看最终摘要。
- 核心链路尽量避免管理员权限。
- 不把通用终端能力膨胀进本次改造范围。

### 5.2 单一数据源

Rust 侧以“安装流程目录”作为唯一数据源，替代当前“执行脚本常量 + 展示命令目录”双份结构。

建议模型：

- `InstallTaskId`
- `InstallTaskGroup`
- `InstallTaskDefinition`
- `InstallTaskStep`
- `InstallTaskCatalog`

每个 task 定义包含：

- task id
- 标题
- 分组
- 说明
- 是否推荐
- 是否可在应用内执行
- 是否需要管理员权限
- 官方源步骤
- 镜像源步骤
- 成功后的复检谓词
- 失败后的兜底说明

### 5.3 应用内执行主链路

以下任务必须改成应用内托管进程执行：

- `quick_install_core`
- `install_uv`
- `install_python313`
- `install_kimi`
- `upgrade_kimi`

实现方式建议：

1. 仍可把 PowerShell 内容写入临时 `.ps1`，避免内联脚本转义过重。
2. 但不再通过 `Start-Process` 拉起新窗口。
3. 直接由 Rust `Command::new("powershell.exe")` 启动子进程。
4. 参数固定为：
   - `-NoLogo`
   - `-NoProfile`
   - `-ExecutionPolicy Bypass`
   - `-File <temp-script>`
5. `stdout` 和 `stderr` 使用管道捕获。
6. 后台线程持续读取输出并转发到前端事件。

这样可以彻底绕开“外部 PowerShell 窗口是否启动成功”这个额外故障点。

### 5.4 管理员权限兜底策略

以下动作允许保留外部管理员终端兜底：

- `install_git`
- `install_nodejs`

原因：

- 它们通常依赖 `winget` 或安装器自身的管理员权限、交互式安装 UI。
- 强行收进当前非 PTY 方案，会增加提权、窗口所有权、安装器子进程追踪复杂度。

策略约束：

- 弹窗里必须明确标记“可选增强项”。
- 点击执行前明确提示“该操作可能会拉起管理员 PowerShell 或安装器窗口”。
- 即使走外部兜底，也要保留：
  - 复制命令
  - 查看步骤
  - 查看失败说明
  - 执行前后的环境复检

### 5.5 单实例安装会话管理器

Rust 侧新增单实例安装会话管理器，职责如下：

- 同时只允许一个安装任务运行。
- 维护当前运行 taskId/source/startTime/stage。
- 推送输出日志块。
- 推送状态更新。
- 记录退出码和失败原因。
- 任务结束后自动触发复检。
- 支持取消当前任务。

状态建议：

- `idle`
- `starting`
- `running`
- `cancelling`
- `succeeded`
- `failed`
- `cancelled`
- `fallback_required`

阶段建议：

- `prepare`
- `execute_step`
- `probe`
- `done`

## 6. 接口与类型设计

### 6.1 前端类型

建议在 `apps/kimi-shell/src/app/types.ts` 新增：

```ts
export type InstallTaskId =
  | "quick_install_core"
  | "install_uv"
  | "install_python313"
  | "install_kimi"
  | "upgrade_kimi"
  | "install_git"
  | "install_nodejs";

export type InstallTaskGroup = "core" | "optional" | "upgrade";

export type InstallSessionStatus =
  | "idle"
  | "starting"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "fallback_required";

export interface InstallLogChunk {
  taskId: InstallTaskId;
  source: "official" | "mirror";
  stream: "stdout" | "stderr" | "system";
  text: string;
  at: string;
}

export interface InstallSessionState {
  status: InstallSessionStatus;
  taskId?: InstallTaskId;
  source?: "official" | "mirror";
  title?: string;
  stage?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  message?: string;
  fallbackReason?: string;
  logs: InstallLogChunk[];
}
```

对 `InstallProbeStatus` 增加：

```ts
coreReady: boolean;
wingetReady: boolean;
```

其中：

- `coreReady = uvReady && python313Ready && kimiReady`
- `gitReady` 保持存在，但只用于可选项展示

### 6.2 Rust 类型

建议在 `apps/kimi-shell/src-tauri/src/types.rs` 对应新增：

- `InstallTaskId`
- `InstallTaskGroup`
- `InstallTaskDefinition`
- `InstallFlowCatalog`
- `InstallSessionSnapshot`
- `InstallLogChunk`

### 6.3 Tauri 命令

新增命令：

- `get_install_flow_catalog`
- `start_install_task(taskId, source)`
- `cancel_install_task`
- `get_install_session_snapshot`

保留：

- `get_install_probe_status`

兼容层策略：

- `install_kimi_dependencies`
- `install_kimi_cli`
- `upgrade_kimi_cli`
- `install_nodejs`

先保留一版兼容包装，内部逐步委托到统一任务调度器，避免前端和已有逻辑一次性全切。

### 6.4 Tauri 事件

新增事件：

- `install-session-state`
- `install-session-output`

事件职责：

- `install-session-state`：状态切换、阶段切换、完成/失败/取消、复检完成
- `install-session-output`：流式日志块

## 7. UI 落地建议

### 7.1 组件组织

建议替换现有 `InstallCommandsModal.tsx` 为统一安装弹窗组件，例如：

- `InstallFlowModal.tsx`

职责拆分：

- `InstallEnvironmentStatus.tsx`
- `InstallTaskActions.tsx`
- `InstallConsolePanel.tsx`

### 7.2 控制中心入口

`ControlCenterView.tsx` 中安装卡片只保留：

- 当前环境摘要
- `打开安装与升级`
- `重新检测`

避免在卡片正文中直接堆叠所有按钮。

### 7.3 控制台交互细节

建议行为：

- 打开弹窗时自动拉取一次 `get_install_probe_status` 和 `get_install_session_snapshot`
- 执行任务后控制台自动滚到底部
- 新任务开始时保留上一任务折叠摘要
- 失败时显示：
  - 失败阶段
  - 最后一条错误输出
  - 重试按钮
  - 复制日志按钮
- 走管理员兜底时显示：
  - “该操作将切换为外部管理员终端执行”
  - 原因说明
  - 复制命令

## 8. 任务定义建议

### 8.1 一键基础安装

- Task ID: `quick_install_core`
- 目标：一次性完成 `uv -> Python 3.13 -> kimi-cli`
- 复检条件：`coreReady === true`

### 8.2 分步任务

- `install_uv`
  - 复检条件：`uvReady === true`
- `install_python313`
  - 复检条件：`python313Ready === true`
- `install_kimi`
  - 复检条件：`kimiReady === true`
- `upgrade_kimi`
  - 复检条件：升级完成后 `kimi -v` 成功，并刷新 `kimiReady`
- `install_git`
  - 复检条件：`gitReady === true`
  - 默认允许外部管理员终端兜底
- `install_nodejs`
  - 复检条件：`nodeReady === true`
  - 默认允许外部管理员终端兜底

## 9. 管理员权限策略

### 9.1 主路径

以下任务默认不要求管理员权限，应优先做成应用内可见输出：

- `install_uv`
- `install_python313`
- `install_kimi`
- `upgrade_kimi`
- `quick_install_core`

### 9.2 兜底路径

以下任务允许使用外部管理员终端：

- `install_git`
- `install_nodejs`

触发条件：

- task 定义中 `requiresElevation === true`
- 当前实现阶段尚未支持应用内提权后的输出接管

展示要求：

- 在任务按钮上显示“可选 / 可能需要管理员权限”
- 在任务开始前弹出说明
- 在控制台里记录“已切换外部管理员终端兜底”

## 10. 实施阶段建议

### Phase 1：数据模型统一

- 收敛现有安装命令定义为单一目录结构。
- 让复制命令和执行命令共用同一份步骤数据。

### Phase 2：应用内安装会话

- 引入安装会话状态机。
- 完成 PowerShell 子进程托管与输出流转发。
- 先覆盖 `quick_install_core / install_uv / install_python313 / install_kimi / upgrade_kimi`。

### Phase 3：统一弹窗 UI

- 用统一安装弹窗替换现有完整命令弹窗。
- 把控制中心安装卡片简化为摘要入口。

### Phase 4：管理员兜底与打包验证

- 为 `install_git / install_nodejs` 加外部管理员兜底。
- 完成 Windows 打包态人工验证。

## 11. 验收标准

### 文档验收

- 明确区分应用构建/运行依赖与 Kimi 安装依赖。
- 明确记录当前链路与问题点。
- 明确 `Git` 改为可选增强项。
- 明确统一安装弹窗结构、任务模型、接口模型与兜底策略。

### 行为验收

- 打开安装弹窗后，所有安装/升级入口都在同一弹窗内可见。
- 点击“一键安装 Kimi 基础环境”后，不再依赖外部 PowerShell 才能看到执行过程。
- 分步执行 `安装 Kimi`、`升级 Kimi` 后，会自动复检并刷新引导状态。
- `Git` 未安装时，不阻塞 Kimi 基础安装。
- `Git / Node.js` 走兜底时，界面内必须明确说明原因和后续操作。

### 技术验收

- `pnpm -C apps/kimi-shell build`
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- 至少 1 轮 Windows 打包态人工验证：
  - 一键基础安装成功
  - 失败日志可见
  - 升级链路可复检

## 12. 结论

本项目当前最需要解决的，不是“命令够不够全”，而是“执行是否可见、入口是否统一、核心链路是否足够短”。因此本次方案明确将安装能力收敛为：

- 一个统一安装弹窗
- 一条应用内可见输出的核心安装链路
- 一组可独立重试的分步任务
- 一套与任务模型绑定的复制命令能力
- 一个只用于可选增强项的管理员兜底机制

这样既能解决当前外部 PowerShell 报错退出的问题感知，也能把后续代码实现范围控制在“安装控制台”而不是“完整终端系统”上。
