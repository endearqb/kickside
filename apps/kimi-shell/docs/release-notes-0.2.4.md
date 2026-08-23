⚠️ **macOS 版本未签名、未公证**

macOS 安装包没有 Apple Developer ID 签名或公证，也未经过 stapling 或 Gatekeeper 信任验证；首次打开时可能需要前往“系统设置 → 隐私与安全性”手动允许。请只从本仓库的 GitHub 或 Gitee Release 下载。Windows 与 macOS 自动更新产物仍使用 Tauri updater 签名校验。

# KickSide v0.2.4

v0.2.4 让 DeepSeek Harness 可以在不发布新版 KickSide 的情况下，由用户主动、安全地跟随官方 npm latest，同时缩短升级停机窗口并加强失败回滚。

## 新功能

- 控制中心直接展示 DSH 当前版本与官方 latest；用户确认后即可安装或升级，无需等待 KickSide 再发一个固定 DSH pin 版本。
- 后端只从固定的 npm 官方 metadata 入口发现 latest，将 SemVer 与 sha512 integrity 冻结为本次精确目标，再执行精确版本安装；前端不能指定包名或版本。
- 保留已发布更新字段的原有语义，以 additive 字段表达官方版本、官方更新状态与最低运行基线，旧客户端可安全忽略。

## 改进与修复

- staging 下载、解包、入口与 integrity 校验期间继续运行现有 DSH，只在原子激活前停止，减少长时间安装造成的服务中断。
- 增加私有持久 npm cache、6 小时成功 metadata cache，并消除升级前后的重复强制请求。
- 单调停止 epoch 覆盖 metadata、安装、验证和正式启动；应用退出或用户停止不会被并发安装吞掉。
- 新版本启动验证失败时优先隔离失败目录、恢复旧安装，并保留无法自动恢复的 backup 以 fail closed。
- Windows npm launcher 优先使用同工具链 `node.exe + npm-cli.js`，仅在受验证条件下使用系统 `cmd.exe` shim fallback。

## 验证与限制

- GitHub Actions 构建 Windows x64 NSIS/MSI 与 Apple Silicon macOS `.dmg`/`.app.tar.gz`，并生成两端 Tauri updater 签名。
- macOS 包仅含 ad-hoc identity，未经过 Developer ID 签名、公证、stapling 或 Gatekeeper 信任验证。
- 轻量策略把 DeepSeek 官方 npm 发布视为兼容授权；若未来版本不满足固定入口、integrity 或启动页身份验证，安装会失败或回滚。
- Windows WebView2、macOS WKWebView、真实代理 registry 与安装包进程树仍按发布前 G3 清单验证，不从单平台自动化外推。

完整变更可查看 [`v0.2.3...v0.2.4`](https://github.com/endearqb/kickside/compare/v0.2.3...v0.2.4)。
