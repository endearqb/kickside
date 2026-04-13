# Kimi Desktop Shell v0.0.37

发布日期：`2026-04-13`

## 亮点

- Windows 资源管理器现在支持直接把文件或文件夹导入工作区，不会强制重启 backend，也不会切换当前会话。
- IM Bridge 新增飞书流式回复；如果流式 patch 失败，会自动回退到最终交互卡片，避免消息丢失。
- IM Bridge 新增微信生成中状态投递（`typing / GENERATING -> final`），同时飞书 connector 现在可以单独选择回复呈现方式。

## 改进

- 右键菜单按应用状态拆分为“冷启动打开”和“应用内导入工作区”两条路径。
- 工作区选择器改成独立轻量窗口，并针对大量工作区场景收紧了布局。
- IM Bridge connector 面板移除了多余说明文案；当没有真实错误时，不再显示“没有最近错误”类占位提示。

## 兼容性

- 现有 bridge 设置和 connector secrets 保持兼容。
- 历史 Feishu reply-card 配置仍会正确迁移，不会被新的 `streaming` 默认值意外覆盖。

## 验证

- `go test ./...` in `apps/kimi-im-bridge`
- `pnpm -C apps/kimi-shell exec tsc --noEmit`
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`