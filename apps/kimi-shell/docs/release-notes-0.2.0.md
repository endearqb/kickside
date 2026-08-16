⚠️ **macOS 版本未签名、未公证**

macOS 安装包没有 Apple Developer ID 签名或公证，首次打开时可能需要前往“系统设置 → 隐私与安全性”手动允许。请只从本仓库的 GitHub Release 下载。Windows 与 macOS 自动更新产物仍使用 Tauri updater 签名校验。

# KickSide v0.2.0（预览版）

v0.2.0 将原 Kimi Sidekick 统一为 **KickSide / KickSide 启伴**，加入可选的 DeepSeek Harness 工作区、Kimi Code 消息目录，以及桌面运行、安装和更新可靠性改进。兼容 bundle id、现有数据目录和内部存储键保持不变。

## 重点更新

- **DeepSeek Harness 工作区**：可在 Workspace Grid 中创建多个 DSH 窗格；这些窗格共享一个受管运行时，关闭窗格不会停止后端。DSH 默认关闭，可在“KickSide 设置 → 更新与运行”中启用。
- **实时安装反馈**：DSH 私有安装显示阶段和经过脱敏的实时日志，并提供启动、停止、异常恢复和运行状态刷新。
- **Kimi Code 消息目录**：保留官方 Sessions sidebar 和 Header，在正文左侧显示常驻短条；鼠标悬停或键盘聚焦时，以半透明毛玻璃浮层向右展开并跳转到对应消息。窄窗格在上游未渲染目录时使用有界移动端投影。
- **更顺畅的 Kimi 工作区**：启动页面跳过重复欢迎流程；主窗口不再抢占文件拖放，附件交由 Kimi Code Web 处理。
- **统一控制中心**：Kimi Code 与 DSH 使用一致的“更新与运行”设置行、状态摘要、图标和亮暗主题交互。

## Windows 改进

- 新安装器可识别旧 `kimi sidekick`、`Kimi Sidekick`、`kimi小助手` 和 `Kimi Desktop Shell` 安装项，经确认后调用旧版正式卸载流程并保留应用数据，避免品牌改名后出现两份应用。
- 修复直接启动 `npm.cmd` 导致 DSH 安装失败的问题；优先由同一 Node 工具链直接执行 `npm-cli.js`，受控的系统 `cmd.exe` 仅作为校验后的回退。
- 加强中文、空格以及 `%`、`&` 等特殊路径处理和进程树清理测试。

## macOS 改进

- Finder 启动的 App 可从 NVM、Volta、asdf、nodenv、mise、fnm、Homebrew 等常见位置发现 Node/npm，不依赖终端继承的 PATH。
- 更新安装成功后会显式退出旧 App，并在退出协调中停止由 KickSide 启动的 Kimi、DSH 与 IM Bridge。
- 支持 Apple Silicon macOS 13+；本版本未进行 Developer ID 签名或公证，不代表 Gatekeeper 可信发布。

## 运行要求

- Windows 10/11 x64，并安装 WebView2 Runtime。
- Apple Silicon macOS 13+；不提供 Intel Mac 或 Linux 安装包。
- 可选 DSH 需要 Node.js `22.19+` 的 22.x，或 Node.js 24+；Node 23 不受支持。新安装或重装还需要与所选 Node 同一工具链的 npm。
- DSH 当前固定为 `@deepseek-ai/dsh@0.1.0-rc.6`，属于默认关闭的预发布集成；DSH headless 尚未接入 IM Bridge。

## 从 v0.1.24 升级

- 现有设置、布局和登录数据继续沿用；产品显示名会从 Kimi Sidekick 变为 KickSide。
- Windows 安装器若提示迁移旧版，请确认该步骤；迁移失败或旧注册项仍存在时，安装器会停止，而不是并存安装。
- macOS 若应用内更新不可用，请从本 Release 手动下载，并按页面顶部的未签名说明操作。
- 升级不会自动启用 DSH；需要时请先检查 Node 版本，再在控制中心手动开启。

## 已知限制

- Kimi 消息目录和响应式窗格已有自动化与 Chrome 视觉回归；真实 WKWebView、WebView2、3:2 屏幕、125%/150% 缩放、触控、IME 和屏幕阅读器仍需继续实机验证。
- Windows DSH 仍需使用最终安装包继续覆盖官方 Node、nvm-windows、Volta、代理环境、WebView2 与 `taskkill /T` 全流程。
- macOS 安装包仅含 ad-hoc identity，未经过 Developer ID 签名、公证、stapling 或 Gatekeeper 信任验证。

完整变更可查看 [`v0.1.24...v0.2.0`](https://github.com/endearqb/kickside/compare/v0.1.24...v0.2.0)。
