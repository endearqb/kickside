# Kimi Desktop Shell 发布说明

版本：`v0.0.14`  
发布日期：`2026-03-08`

## 本次更新重点

本版本聚焦资源管理器打开流程收敛、启动切换闪现修复、工作区标题栏路径可读性提升，以及仓库开源化发布准备。

## 主要变更

1. 资源管理器打开流程更稳
- 目录、文件和文件夹的 Explorer open request 不再默认自动创建新 Session。
- 为启动参数路径和单实例转发路径增加短窗口去重，减少同一次操作触发两次启动链路的问题。

2. 启动切换体验优化
- 在主窗口切到 shell surface 前先隐藏可见窗口，减少 prefill 到主界面的闪现。

3. 工作区标题栏路径展示优化
- 工作区路径在可相对化时优先显示为相对 `effectiveWorkDir` 的形式。
- 路径截断时尽量保留最后一级目录名，并适度放宽桌面端标题栏中区宽度。

4. 开源发布治理
- 仓库根目录新增 `README.md`，统一说明项目结构、开发命令和安装包输出路径。
- 新增根目录 `LICENSE`，项目以 MIT 许可证发布。
- 应用包元数据同步声明 MIT 许可证与仓库地址。

## 安装包

- NSIS：`Kimi Desktop Shell_0.0.14_x64-setup.exe`
- MSI：`Kimi Desktop Shell_0.0.14_x64_en-US.msi`

## 已验证

- `pnpm -C apps/kimi-shell tauri build`
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
