# Kimi 小助手

[English README](README.md)

Kimi 小助手是一个基于 MIT 协议发布的仓库，核心产物是面向 Kimi Web 的 Windows 桌面壳。
当前主应用位于 `apps/kimi-shell`，技术栈为 `Tauri v2 + React`，把启动接管、安装与升级、
多标签控制中心、IM Bridge 运维、诊断日志和 Windows 安装包输出整合进同一个面向工作区的桌面应用。

## 仓库结构

- `apps/kimi-shell`：桌面应用源码、打包配置、截图素材和发布说明
- `tasks`：本仓库的任务记录、调查文档和工程复盘材料

## 核心亮点

- 为 `Kimi Code Web` 与 `Kimi Chat` 提供常驻桌面壳，支持分栏与视图切换
- 支持资源管理器右键打开目录、单文件和多文件，并分别完成目录接管或文件导入工作区
- 提供面向首次使用与日常恢复场景的 Quick Setup 引导流程
- 内置安装与升级中心，统一展示 PowerShell 预检与依赖状态
- 控制中心整合概览、快速设置、运行诊断和 IM Bridge 操作入口
- IM Bridge 页面聚焦飞书等通道控制、会话切换、审批与工作目录映射
- 提供符合 Windows 使用习惯的系统托盘、最小化到托盘和安装包输出能力

## 项目能力

- 拉起并监控本地 Kimi Web 后端
- 在进入主工作区前展示 prefill 启动页
- 在同一个壳层中常驻 `Kimi Code Web` 与 `Kimi Chat`，减少频繁刷新与切换成本
- 处理普通启动，以及资源管理器右键菜单/打开请求触发的目录、单文件和多文件工作区接管
- 对目录直接接管为当前工作目录；对单文件和多文件则复制到新建工作区后再启动桌面壳
- 通过统一控制中心提供安装引导、升级操作、诊断信息、日志与运行控制
- 提供 IM Bridge 能力，用于飞书通道管理、会话轮换、审批处理与工作目录映射
- 生成 Windows 的 NSIS / MSI 安装包

## 界面预览

主工作区：提供常驻的 Code / Chat 桌面壳，以及稳定的导航与切换体验。

![Kimi 小助手主界面](apps/kimi-shell/public/home.png)

快速设置：将首次安装、环境修复和关键引导步骤集中到更聚焦的 onboarding 流程中。

![Kimi 小助手快速设置](apps/kimi-shell/public/quick_setup.png)

安装与升级：把 PowerShell 预检、依赖就绪状态和升级入口放到同一个面板里。

![Kimi 小助手安装与升级](apps/kimi-shell/public/install&updata.png)

控制中心：以统一多标签工作台承载概览、快速设置、运行诊断和日常操作入口。

![Kimi 小助手控制中心](apps/kimi-shell/public/control_center.png)

IM Bridge：集中处理通道状态、当前绑定/会话切换，以及默认工作目录等桥接工作流配置。

![Kimi 小助手 IM Bridge](apps/kimi-shell/public/IM_bridge.png)

## 本地开发

环境要求：

- Node.js 18+
- pnpm 8+
- Rust stable
- Windows WebView2 Runtime

常用命令：

```bash
pnpm -C apps/kimi-shell install
pnpm -C apps/kimi-shell tauri dev
pnpm -C apps/kimi-shell build
pnpm -C apps/kimi-shell tauri build
```

## 发布产物

生产安装包默认输出到：

- `apps/kimi-shell/src-tauri/target/release/bundle/nsis`
- `apps/kimi-shell/src-tauri/target/release/bundle/msi`

发布说明位于：

- `apps/kimi-shell/docs`

## 许可证

本仓库以 MIT License 发布，详见 `LICENSE`。
