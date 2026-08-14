# KickSide 启伴

[English README](README.md)

KickSide 启伴是一个基于 MIT 协议发布的仓库，核心产物是面向 Kimi Code Web 与 DeepSeek Harness 的 Windows / Apple Silicon macOS 桌面工作台。
当前主应用位于 `apps/kimi-shell`，技术栈为 `Tauri v2 + React`，把启动接管、安装与升级、
多标签控制中心、IM Bridge 运维、诊断日志和跨平台安装包输出整合进同一个面向工作区的桌面应用。

仓库名为 `endearqb/kickside`。`com.kimi.shell`、已有数据 key、内部包名与当前应用图标作为兼容身份继续保留。

## 仓库结构

- `apps/kimi-shell`：桌面应用源码、打包配置、截图素材和发布说明
- `tasks`：本仓库的任务记录、调查文档和工程复盘材料

## 核心亮点

- 为 `Kimi Code Web` 与 `Kimi Chat` 提供常驻桌面壳，支持分栏与视图切换
- Windows 支持资源管理器右键打开目录、单文件和多文件；macOS 不展示该平台专属入口
- 提供面向首次使用与日常恢复场景的 Quick Setup 引导流程
- Windows 提供受管安装任务；macOS 仅引导使用官方 native installer 与 `kimi upgrade`
- 控制中心整合概览、快速设置、运行诊断和 IM Bridge 操作入口
- IM Bridge 页面聚焦飞书等通道控制、会话切换、审批与工作目录映射
- macOS 提供原生 traffic lights、App Menu、关闭隐藏、Dock reopen 与 Cmd+Q；Windows 保持 close-to-tray

## 项目能力

- 拉起并监控本地 Kimi Web 后端
- 在进入主工作区前展示 prefill 启动页
- 在同一个壳层中常驻 `Kimi Code Web` 与 `Kimi Chat`，减少频繁刷新与切换成本
- 处理普通启动，以及资源管理器右键菜单/打开请求触发的目录、单文件和多文件工作区接管
- 对目录直接接管为当前工作目录；对单文件和多文件则复制到新建工作区后再启动桌面壳
- 通过统一控制中心提供安装引导、升级操作、诊断信息、日志与运行控制
- 提供 IM Bridge 能力，用于飞书通道管理、会话轮换、审批处理与工作目录映射
- 生成 Windows NSIS/MSI 与 macOS arm64 app/DMG 产物

## 界面预览

Workspace Grid：在一个可调整布局的桌面工作区中同时展示 Kimi Code、Kimi Chat 与多个活跃会话。

![KickSide 启伴六窗格 Workspace Grid](apps/kimi-shell/public/workspace-grid.png)

KickSide 设置：集中管理应用更新、Kimi Code 升级、工作目录、外部 IM 通道与诊断日志。

![KickSide 启伴设置](apps/kimi-shell/public/assistant-settings.png)

Skill 中心：以可搜索目录统一查看内置 Skill 和工作区 Skill。

![KickSide 启伴 Skill 中心](apps/kimi-shell/public/skill-center.png)

会话设置与并行工作：在对话旁直接调整模型、思考强度、权限和 Swarm 模式，并同时跟踪多个任务。

![KickSide 启伴会话设置与并行工作](apps/kimi-shell/public/workspace-session-settings.png)

## 本地开发

环境要求：

- Node.js 22+
- pnpm 10.34.4
- Rust stable
- Go（版本以 `apps/kimi-im-bridge/go.mod` 为准）
- Windows WebView2 Runtime
- Apple Silicon macOS 13+；签名/公证 release 需要完整 Xcode 与 Apple Developer 凭据

常用命令：

```bash
pnpm -C apps/kimi-shell install
pnpm -C apps/kimi-shell tauri dev
pnpm -C apps/kimi-shell build
pnpm -C apps/kimi-shell tauri:build:macos:local
pnpm -C apps/kimi-shell tauri build
```

## 发布产物

生产安装包默认输出到：

- `apps/kimi-shell/src-tauri/target/release/bundle/nsis`
- `apps/kimi-shell/src-tauri/target/release/bundle/msi`
- `apps/kimi-shell/src-tauri/target/aarch64-apple-darwin/release/bundle/macos`

发布说明位于：

- `apps/kimi-shell/docs`

## 许可证

本仓库以 MIT License 发布，详见 `LICENSE`。
