⚠️ **macOS 版本未签名、未公证**

macOS 安装包没有 Apple Developer ID 签名或公证，首次打开时可能需要前往“系统设置 → 隐私与安全性”手动允许。请只从本仓库的 GitHub 或 Gitee Release 下载。Windows 与 macOS 自动更新产物仍使用 Tauri updater 签名校验。

# KickSide v0.2.3

v0.2.3 首次把可信局域网访问和 GitHub/Gitee 双更新源带入正式安装包，并补充 DSH 升级与 macOS Finder 附件体验。

## 新功能

- 在控制中心临时开启 Kimi Code 局域网访问，同一可信家庭或办公网络中的手机和电脑可通过地址或按需二维码访问。
- 局域网模式每次启动默认关闭，仅切换 KickSide 自己启动的 Kimi Code；Bearer 认证保持开启，远程终端、关机和 debug 接口保持关闭。
- 应用更新支持“自动（推荐）”“Gitee”和“GitHub”三种来源。自动模式并行检查两个源，优先选择较新版本，同版本优先 Gitee。
- GitHub 继续作为唯一构建与 canonical Release；Gitee 发布同字节安装包、签名文件和独立下载清单。

## 改进与修复

- DeepSeek Harness 增加上游版本检测与用户主动升级，已验证的 rc.6 可继续运行，新安装和升级使用推荐 rc.7，并在新版启动失败时恢复旧版本。
- macOS Finder 文件可通过原生单次授权拖入 Kimi Code，文件路径不会进入 Web 页面或日志。
- 修复局域网模式下 App 内 Kimi Code iframe、流式输出与 WebSocket 在 macOS 上的连接问题。
- Windows 与 macOS 更新安装继续沿用既有 Tauri updater 签名和退出协调流程。

## 验证与限制

- GitHub Actions 构建 Windows x64 NSIS/MSI 与 Apple Silicon macOS `.dmg`/`.app.tar.gz`，并生成两端 updater 签名。
- macOS 包仅含 ad-hoc identity，未经过 Developer ID 签名、公证、stapling 或 Gatekeeper 信任验证。
- 局域网访问只适合可信网络，使用 HTTP，不支持公网、跨 VLAN、NAT 穿透或公共 Wi-Fi。
- Gitee 镜像必须在 8 项附件公开回下载验证和 manifest-last 后才可提升为稳定 Release。

完整变更可查看 [`v0.2.2...v0.2.3`](https://github.com/endearqb/kickside/compare/v0.2.2...v0.2.3)。
