# Kimi Desktop Shell 发布说明

版本：`v0.0.17`  
发布日期：`2026-03-09`

## 本次更新重点

本版本聚焦 workspace 壳层体验与安装版稳定性，正式加入 `Kimi Code Web` / `Kimi Chat` 双视图常驻切换、可调分栏，以及 Windows 安装版的下载另存为和纯后端重启收口。

## 主要变更

1. 工作区双视图与分栏
- **双常驻页面**：workspace 现在会同时保留 `Kimi Code Web` 和 `Kimi Chat` 两个页面，切换时不再销毁或重建 iframe。
- **单页 / 分栏切换**：标题栏新增工作区专用按钮，支持单页切换、左右分栏，以及左右换位。
- **可拖拽分栏比例**：分栏支持在 `1:2` 到 `2:1` 范围内平滑调整宽度，并记住上次的布局、激活页、左右顺序和分栏比例。

2. Chat 集成体验收口
- **站内留在 pane，外站跳系统浏览器**：`Kimi Chat` 保持直连 `https://www.kimi.com/`，同站链接继续留在右侧 pane，跨站 `http/https` 链接改为交给系统浏览器打开。
- **下载改为原生另存为**：Windows 安装版中，Chat 页面触发浏览器下载时会弹原生“另存为”对话框，取消或保存都不会再卡死应用。
- **失败兜底更清晰**：如果 Chat 页面后续因站点策略无法嵌入，workspace 会仅在 Chat pane 显示浏览器打开兜底，不影响 Code pane。

3. 后端重启路径修正
- **设置保存只重启后端**：保存 Kimi 路径、保存默认工作目录、清除默认工作目录时，改走 `restart_backend_runtime_only`，不再误触发 prefill/main 窗口重建。
- **壳层内重启统一收口**：当主壳层已经打开时，标题栏、loading 页、workspace 空态和控制中心里的 plain “Restart Backend” 现在都走纯后端重启链路。
- **窗口恢复职责单独保留**：真正需要恢复主窗口的场景仍保留 `recover_main_window_boot`，prefill 启动期重试仍保留 `retry_start_backend`。

## 安装包

- NSIS：`Kimi Desktop Shell_0.0.17_x64-setup.exe`
- MSI：`Kimi Desktop Shell_0.0.17_x64_en-US.msi`

## 已验证

- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- `pnpm -C apps/kimi-shell build`
- `pnpm -C apps/kimi-shell tauri build`
