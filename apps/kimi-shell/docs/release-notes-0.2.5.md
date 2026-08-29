⚠️ **macOS 版本未签名、未公证**

macOS 安装包没有 Apple Developer ID 签名或公证，也未经过 stapling 或 Gatekeeper 信任验证；首次打开时可能需要前往“系统设置 → 隐私与安全性”手动允许。请只从本仓库的 GitHub 或 Gitee Release 下载。Windows 与 macOS 自动更新产物仍使用 Tauri updater 签名校验。

# KickSide v0.2.5

v0.2.5 将 Kimi Code 官方 Remote Control 包装成本机、局域网和官方远程三种互斥访问方式。KickSide 只管理官方 CLI 进程，不自建中继，也不调用 Kimi 内部注册 API。

## 新功能

- 控制中心新增“Kimi 官方远程（实验）”，一键启动官方 `kimi web --remote-control` 能力，无需用户手动设置实验环境变量、命令行或中继参数。
- 从官方 CLI 输出中识别并展示远程访问二维码和地址；远程地址只保存在内存中，日志与诊断输出会在写入前脱敏。
- 标题栏持续显示本机、局域网或官方远程状态，同一 KickSide 实例仍只允许一个活跃的 owned Kimi 进程。

## 改进与修复

- 能力探测兼容 Kimi Code 0.39.1 的 `--rc, --remote-control` 帮助输出，并使用官方实验开关进行 fail-closed 检测。
- 以官方 CLI 的 OAuth 与 Relay 结果为登录权威，避免宿主侧陈旧认证摘要错误阻断远程启动。
- 精确区分 Relay 与手机设备连接状态；手机熄屏或浏览器进入后台不会再把官方 Relay 误报为已断开。
- Windows 能力探针使用隐藏进程并在超时或异常时通过 `taskkill /T /F` 清理完整子进程树，避免 npm/pnpm `.cmd` launcher 遗留 Node 进程。

## 验证与限制

- GitHub Actions 在原生 Windows runner 上执行 Rust、React、安全门禁并构建 x64 NSIS/MSI；Apple Silicon runner 构建 macOS `.dmg`/`.app.tar.gz`，两端生成 Tauri updater 签名。
- macOS 0.39.1 已实测 OAuth、Relay、二维码、手机连接/熄屏与重连状态；Windows 自动化验证共享代码、参数、环境变量、进程树边界和安装包构建。
- Windows 实机上的 Kimi 0.39.1 OAuth、Relay、二维码、手机熄屏/重连、NSIS/MSI 安装升级与退出后无残留进程仍属于 G3，不能由 CI 自动化结果替代。
- macOS 包仅含 ad-hoc identity，未经过 Developer ID 签名、公证、stapling 或 Gatekeeper 信任验证。

完整变更可查看 [`v0.2.4...v0.2.5`](https://github.com/endearqb/kickside/compare/v0.2.4...v0.2.5)。
