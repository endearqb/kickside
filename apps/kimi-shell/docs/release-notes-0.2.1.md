⚠️ **macOS 版本未签名、未公证**

macOS 安装包没有 Apple Developer ID 签名或公证，首次打开时可能需要前往“系统设置 → 隐私与安全性”手动允许。请只从本仓库的 GitHub Release 下载。Windows 与 macOS 自动更新产物仍使用 Tauri updater 签名校验。

# KickSide v0.2.1（预览版）

v0.2.1 集中修复 Windows DeepSeek Harness 安装、启动与应用退出体验，不改变 DSH 固定版本、工作区数据或现有更新信任边界。

## 重点修复

- 修复 Windows 官方 Node 目录同时存在 `npm` 与 `npm.cmd` 时误启动 POSIX shim、导致 DSH 安装报 `os error 193` 的问题。
- 修复 Node.js 26 无法把 Windows `\\?\` canonical 路径作为 DSH 主模块入口、启动时报 `EISDIR: lstat 'C:'` 的问题；canonical 路径仍用于安装根安全校验。
- 优化应用退出：关闭遮罩在整个退出周期保持稳定，不再依次闪回工作区和通用 Loading 页。
- 退出卡片移除随机提示，保留阶段文本和毫秒计时。
- DSH 与 Kimi 后端改为并行停止，任一进程树未确认关闭时仍保持 fail-closed，不伪造成功退出。

## 验证状态

- Windows 真实 DSH 私有安装已完成，DSH Web readiness 返回 HTTP 200 并包含固定页面身份标记。
- 前端 281 项、Rust 287 项、严格 clippy、TypeScript、安全门禁与 Windows NSIS 本地构建通过。
- Windows 安装版仍需继续人工确认退出全过程只显示一个关闭遮罩，并覆盖官方 Node、nvm-windows、Volta 与代理环境。
- macOS 包仅含 ad-hoc identity，未经过 Developer ID 签名、公证、stapling 或 Gatekeeper 信任验证。

完整变更可查看 [`v0.2.0...v0.2.1`](https://github.com/endearqb/kickside/compare/v0.2.0...v0.2.1)。
