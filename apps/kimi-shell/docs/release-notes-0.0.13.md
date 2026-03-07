# Kimi Desktop Shell 发布说明

版本：`v0.0.13`  
发布日期：`2026-03-07`

## 本次更新重点

本版本聚焦启动体验收敛、前置页视觉整理与发布流程规范化，同时回退了“非双击启动强制新建 Session”策略，恢复为可复用同目录已有 Session 的行为。

## 主要变更

1. 启动与前置页
- 前置页窗口高度与布局优化，减少滚动与留白不均问题。
- 保持“后端进入 running 后再切主界面”的切换策略，避免早切换造成闪屏或状态错位。

2. Session 启动策略回退
- 取消非双击入口（目录空白/文件/文件夹/单实例转发）强制新建 Session。
- 现在 open request 路径恢复为可复用同目录既有 Session。

3. 文档与发布治理
- 项目 README 更新为中文版本，统一说明运行环境、开发/打包命令与排障路径。
- 发布流程统一为 `v0.0.13` tag + GitHub Release，并附 MSI/NSIS 安装包。

## 安装包

- NSIS：`Kimi Desktop Shell_0.0.13_x64-setup.exe`
- MSI：`Kimi Desktop Shell_0.0.13_x64_en-US.msi`

## 已验证

- `pnpm -C apps/kimi-shell tauri build`
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`

