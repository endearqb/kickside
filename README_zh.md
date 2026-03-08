# Kimi App

[English README](README.md)

Kimi App 是一个基于 MIT 协议发布的仓库，核心产物是面向 Kimi Web 的 Windows 桌面壳。
当前主应用位于 `apps/kimi-shell`，技术栈为 `Tauri v2 + React`，把启动监控、工作区接管、
诊断日志和 Windows 安装包输出整合进同一个桌面应用。

## 仓库结构

- `apps/kimi-shell`：桌面应用源码、打包配置和发布说明
- `tasks`：本仓库的任务记录、调查文档和工程复盘

## 项目能力

- 拉起并监控本地 Kimi Web 后端
- 在进入主工作区前展示 prefill 启动页
- 处理普通启动和资源管理器打开请求的工作区接管
- 提供安装引导、诊断信息和日志入口
- 生成 Windows 的 NSIS / MSI 安装包

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
