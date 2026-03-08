# Kimi Desktop Shell 发布说明

版本：`v0.0.16`  
发布日期：`2026-03-08`

## 本次更新重点

本版本聚焦 Windows 冷启动体验，正式将启动链路切换到“可见 `prefill` + 隐藏预热 `main`”的双窗口交接架构，目标是彻底移除单窗口 `hide -> navigate -> show` 带来的原生闪烁与尺寸突变。

## 主要变更

1. 双窗口启动交接
- **独立启动窗口**：新增独立的 `prefill` 窗口承载启动中、失败恢复、重试、打开日志和退出应用。
- **隐藏主窗口预热**：`main` 改为固定加载 `index.html#/loading` 的隐藏 shell 窗口，在后台完成前端初始化与 loading 渲染。
- **锁存式 handoff**：仅当 `handoff_requested`、`frontend_ready`、`loading_rendered` 全部满足且启动守卫未失败时，才关闭 `prefill` 并显示 `main`。

2. 启动失败与重试收口
- **失败只回退 prefill**：启动守卫失败时，应用不再把 `main` 伪装成 prefill，而是确保 `prefill` 成为唯一可见窗口。
- **重试路径重建主窗口**：`retry_start_backend` 现在会先重建启动窗口状态，销毁旧 `main`，再创建新的隐藏 `main` 并重新进入后端启动流程。
- **启动期窗口保护**：托盘、快捷键、单实例转发和打开请求在启动期间都会优先显示 `prefill`，避免提前暴露隐藏的 `main`。

3. 文档与发布材料
- **设计文档入库**：新增 `apps/kimi-shell/docs/startup-dual-window-handoff.md`，沉淀双窗口交接方案与验收标准。
- **版本同步**：应用版本升级到 `0.0.16`，并同步到 `package.json`、`Cargo.toml`、`tauri.conf.json`。

## 安装包

- NSIS：`Kimi Desktop Shell_0.0.16_x64-setup.exe`
- MSI：`Kimi Desktop Shell_0.0.16_x64_en-US.msi`

## 已验证

- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml window_manager`
- `pnpm -C apps/kimi-shell build`
