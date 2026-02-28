# Kimi Desktop Shell 开发进度与完成情况

## 1. 文档信息

- 项目：Kimi Desktop Shell
- 阶段：MVP（v0.1）
- 统计时间：2026-02-28
- 统计范围：`D:\MyProject\kimi-app\apps\kimi-shell`
- 依据文档：`docs\需求文档 PRD.md`、`docs\Spec.md`

## 2. 当前结论（摘要）

- 当前已完成 MVP 核心能力开发，桌面端启动后可正常拉起 `kimi web` 并在壳内展示。
- 已完成托盘、全局快捷键、日志、错误页、缺失依赖引导等关键桌面集成功能。
- 已完成 Windows 构建产物输出（MSI + NSIS 安装包）。
- 已修复关键启动问题：Windows GBK 编码导致 `kimi web` 启动时 `UnicodeEncodeError` 崩溃，造成 `/healthz` 超时。

## 3. PRD 功能项完成状态（FR 对齐）

| 编号 | 需求项 | 状态 | 说明 |
|---|---|---|---|
| FR-01 | 启动时检测 `kimi` 命令可用性 | 已完成 | 支持 PATH 自动检测 + 手动选择可执行路径。 |
| FR-02 | 自动启动 `kimi web --no-open` | 已完成 | 壳启动后自动拉起后台，禁用系统浏览器弹出。 |
| FR-03 | 服务未就绪显示 Loading | 已完成 | 本地 Loading 页面先展示。 |
| FR-04 | 就绪后跳转 `127.0.0.1:<port>` | 已完成 | 随机高端口起始并探活后自动导航。 |
| FR-05 | 启动失败展示错误页与恢复入口 | 已完成 | 错误页支持重试、打开日志目录。 |
| FR-06 | 托盘菜单（打开/隐藏、重启、日志、退出） | 已完成 | 四项菜单已实现并联动后台状态。 |
| FR-07 | 全局快捷键 toggle 窗口 | 已完成 | 默认 `CmdOrCtrl+Shift+K`。 |
| FR-08 | 退出时可靠回收后台进程 | 已完成 | 支持优雅终止 + 超时强杀兜底。 |

## 4. 实现完成情况（模块）

### 4.1 Rust 后端（Tauri）

- 进程与状态管理：`BackendState` 状态机、启动/重启/停止、后台进程监控。
- 端口策略：随机起始端口（55000-59999），探测 `PORT0..PORT0+9`，轮询 `/healthz`。
- 依赖定位：`kimi` PATH 检测与手动配置路径优先。
- 日志体系：后台日志 `backend.log` 统一落盘，支持日志目录打开。
- 桌面能力：系统托盘、全局快捷键、多实例独立运行。
- 窗口策略：本地 `loading/missing-kimi/error` 页面与远程 Web UI 导航切换。
- 退出回收：`Quit` 和应用退出事件均触发后端 stop 流程。

### 4.2 前端（React）

- 三态页面：Loading、缺失依赖、Error。
- 操作入口：重试启动、选择并保存 `kimi` 路径、打开日志目录。
- 状态轮询：通过 Tauri 命令读取后端状态并实时刷新展示。
- 视觉样式：完成桌面壳状态页基础视觉与响应式适配。

## 5. 安全与约束实现情况

- 启动参数固定绑定 `--host 127.0.0.1`，默认不暴露网络。
- 启动命令固定包含 `--no-open`，避免系统浏览器抢焦点。
- Tauri capability 当前仅开放必要权限（核心 + 对话框）用于本地状态页交互。
- 后台管控（托盘、快捷键、进程管理）全部在 Rust 侧执行。

## 6. 测试与验证结果

### 6.1 构建与检查

- `cargo check`：通过
- `cargo test`：通过（当前含端口策略单测）
- `pnpm build`：通过
- `pnpm tauri build --debug`：通过

### 6.2 产物输出（Windows, 2026-02-28）

- `apps\kimi-shell\src-tauri\target\debug\bundle\msi\Kimi Desktop Shell_0.1.0_x64_en-US.msi`
- `apps\kimi-shell\src-tauri\target\debug\bundle\nsis\Kimi Desktop Shell_0.1.0_x64-setup.exe`

### 6.3 运行验证

- 本地执行 `kimi web` 后 `/healthz` 返回 200，服务可达。
- 桌面壳启动后可稳定运行，用户确认“运行后没有问题”。

## 7. 问题处理记录（本轮关键）

### 7.1 现象

- 报错：`Startup timed out. No /healthz response ... within 20 seconds`
- 位置：`C:\Users\endea\AppData\Local\com.kimi.shell\logs\backend.log`

### 7.2 根因

- `kimi web` 在打印 banner 时因 Windows 控制台 GBK 编码触发 `UnicodeEncodeError`，进程提前退出，导致健康探活超时。

### 7.3 修复

- 在桌面壳启动子进程时注入：
- `PYTHONIOENCODING=utf-8`
- `PYTHONUTF8=1`

### 7.4 修复结果

- 编译与打包验证通过。
- 用户侧再次启动已正常。

## 8. FR+ 当前进展

### 8.1 FR+01 工作目录管理

- 已完成设置项 `work_dir` 持久化。
- 已支持本地页面中选择目录、保存目录、清空目录并重启后台。
- 已在后台启动流程中使用配置目录作为 `kimi web` 的 `current_dir`。
- 已在状态信息中返回“配置目录 + 实际生效目录”。

### 8.2 FR+02 诊断页

- 已新增 Diagnostics 页面（本地页面路由）。
- 已支持显示：
- `kimi --version` 结果（或错误原因）
- 当前状态、起始端口、实际端口
- 检测到的 `kimi` 路径与配置路径
- 配置工作目录与生效目录
- 启动命令摘要、最近错误、日志目录
- `backend.log` 最近 80 行日志
- 已新增托盘入口 `Open Diagnostics`，可从远程 Web UI 快速回到本地诊断页。

### 8.3 FR+03 多实例/多窗口模式

- 已完成“多进程多实例 App”方案。
- 已移除单实例限制：应用可多开，每个进程独立管理一个窗口和一个 `kimi web` 后台。
- 已实现全局热键“首进程持有”策略：仅首个实例注册热键，避免多实例抢占冲突。
- 已实现窗口关闭行为隔离：关闭当前窗口仅回收当前实例后台，不影响其他实例。
- 托盘保持每实例一个，菜单操作默认仅作用于当前实例（含 Quit This Instance）。
- 状态/诊断信息已补充实例维度字段（`instanceId`、`pid`、`startedAt`、`isHotkeyOwner`）。

## 9. 下一阶段建议

- 补充自动化测试：多实例并行、热键主从切换、关闭行为隔离、进程回收。
- 增加实例管理页：查看当前所有实例与端口占用（可选增强）。
- 完善跨平台验证：macOS/Linux 手工回归与打包链路验证。
- 增加发布文档：安装指引、常见故障排查、日志采集流程。

## 10. NFR 执行进展（2026-02-28 当日新增）

### 10.1 NFR-01 / NFR-02（性能与反馈）

- 已新增启动指标采集：
- `shell -> loading` 毫秒耗时
- `backend ready` 毫秒耗时
- 已新增前端上报命令 `report_loading_rendered`，用于记录 Loading 首屏渲染时刻。
- 已在状态页和诊断页展示指标，并显示 `loading_sla_met`（阈值 1 秒）。

### 10.2 NFR-03 / NFR-04（可靠性与端口恢复）

- 已新增端口起始位环境变量覆盖：`KIMI_SHELL_BASE_PORT`（用于压测/复现）。
- 已新增 Windows 脚本：
- `apps\kimi-shell\scripts\nfr_port_conflict.ps1`
- `apps\kimi-shell\scripts\nfr_reliability.ps1`
- 可用于端口冲突恢复验证与重复启动/关闭压力检查。

### 10.3 NFR-05 / NFR-06（安全）

- 启动参数构造已集中管理，固定本地回环绑定：
- `web --no-open --host 127.0.0.1 --port <port>`
- 已新增 `kimi web --help` CLI 合约检查：
- 必须包含 `--no-open` / `--host` / `--port`
- capability 已收敛到 `dialog:allow-open`，移除 `dialog:default`。
- 已新增静态校验脚本：
- `apps\kimi-shell\scripts\check_capabilities.mjs`

### 10.4 NFR-07 / NFR-08（可维护与可观测）

- 已新增 `cli_contract` 模块，避免依赖上游不稳定内部行为。
- 日志已拆分为：
- `app.log`（壳事件）
- `backend.log`（kimi stdout/stderr）
- 已增加日志轮转策略（10MB * 5 文件）。
- 诊断信息已新增：
- `cliContractOk/cliContractError`
- `appLogPath/backendLogPath`
- `lastExitReason`
- `appLogTail/backendLogTail`
