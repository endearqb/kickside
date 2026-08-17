⚠️ **macOS 版本未签名、未公证**

macOS 安装包没有 Apple Developer ID 签名或公证，首次打开时可能需要前往“系统设置 → 隐私与安全性”手动允许。请只从本仓库的 GitHub Release 下载。Windows 与 macOS 自动更新产物仍使用 Tauri updater 签名校验。

# KickSide v0.2.2

v0.2.2 聚焦 KimiCode 工作区交互、外部浏览器跳转、Windows 安装迁移和 DSH 控制中心体验。

## 重点修复

- 根据内容区和 sidebar 位置调整 TOC 短条位置，窄屏无 sidebar 时使用内容区边界判定。
- 收窄 TOC 展开触发区，避免鼠标选择正文时误触发展开。
- Windows 安装器启动阶段提前检测并卸载历史 Kimi 小助手 / Kimi Sidekick，再进入正式安装流程，避免安装过程中嵌套卸载卡住。
- 优化 DSH 控制中心检测缓存与状态轮询，避免每次打开控制中心重复执行完整检测。
- KimiCode 登录、套餐升级和新标签页外链统一交给系统默认浏览器打开，同时保留普通应用内导航。

## 验证状态

- GitHub Actions 已通过前端、Rust、Go bridge、macOS arm64 构建、Windows 构建及 DSH Runtime Canary。
- Windows 安装包包含 NSIS 与 MSI；macOS 提供 Apple Silicon `.dmg` 与 `.app.tar.gz`。
- macOS 包仅含 ad-hoc identity，未经过 Developer ID 签名、公证、stapling 或 Gatekeeper 信任验证。

完整变更可查看 [`v0.2.1...v0.2.2`](https://github.com/endearqb/kickside/compare/v0.2.1...v0.2.2)。
