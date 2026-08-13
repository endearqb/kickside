---
title: Kimi App macOS V1 PRD
status: proposed
date: 2026-08-05
repository: https://github.com/endearqb/kimi-app
reviewed_commit: 1ed10dac0bc19ffb828bfffbe6581c7a2c0211d0
product_version_target: 0.2.x
platform: macOS 13+ / Apple Silicon
release_channel: Developer ID signed and notarized DMG
related_research: ./01-kimi-app-macos-research.md
---

# Kimi App macOS V1 PRD

## 0. 文档目的

本 PRD 定义 Kimi App 首个可正式交付的 macOS 版本。它不以“编译成功”为完成标准，而以一个符合 macOS 使用习惯、能够稳定管理 Kimi Code 本地运行时、可通过 Gatekeeper、可升级、可诊断且不破坏 Windows 版本的桌面产品为完成标准。

---

## 1. 背景与问题

Kimi App 当前是基于 Tauri 2 + React 的 Kimi Code Web 桌面壳，已经具备多窗工作区、控制中心、Kimi Code 生命周期管理、IM Bridge、托盘、全局快捷键、Updater 和日志诊断等能力。但当前发行、安装与交互模型主要围绕 Windows 构建：

- 只能获得 MSI/NSIS 安装包。
- 公共构建脚本依赖 PowerShell。
- 安装中心依赖 winget、PowerShell 和 Git for Windows。
- 窗口采用 Windows 风格自定义控制按钮。
- Explorer 右键菜单依赖 Windows Registry。
- Kimi Code 服务复用仍依赖上游已废弃的 legacy lock。

用户即将使用 Apple Silicon MacBook Pro，需要在新机器上继续使用 Kimi App 的工作区、多 Pane、控制中心和 Kimi Code 集成能力。直接使用浏览器或单独运行 Kimi Code 无法提供 Kimi App 已形成的桌面工作流。

### 核心产品问题

> 如何让 Kimi App 在 macOS 上成为一个可信、原生、稳定的 Kimi Code 桌面工作台，而不是一个需要用户绕过安全提示、手工修 PATH、频繁残留进程的网页套壳？

---

## 2. 产品愿景

让 Kimi Sidekick 成为同一套工作流在 Windows 与 macOS 上的统一桌面入口：

- Kimi Code 负责 Agent、会话、工具与本地 Web 服务。
- Kimi Sidekick 负责桌面窗口、工作区编排、启动恢复、控制中心、IM Bridge、诊断与更新。
- 两个平台共享业务能力，但遵循各自的原生交互语义。

macOS V1 的目标不是把 Windows UI 原样移植，而是让用户感到它本来就是一个 Mac App。

---

## 3. 目标用户与 Jobs To Be Done

### 3.1 核心用户

**本地开发与知识工作用户**

- 使用 Apple Silicon Mac。
- 需要在多个目录、仓库和 Kimi Code session 间切换。
- 希望保留 Kimi App 的多 Pane、Workspace、控制中心、IM Bridge 和诊断能力。
- 不希望每次启动都手工打开终端、寻找端口或处理 token。

### 3.2 典型任务

1. 当我从 Finder 启动 App 时，我希望它自动找到已安装的 Kimi Code，并恢复上次工作区。
2. 当 Kimi Code 尚未安装时，我希望得到官方、可信、可理解的安装指引，而不是不透明地执行脚本。
3. 当我关闭窗口时，我希望它符合 Mac 的关闭/退出语义，并能从 Dock 重新打开。
4. 当我选择退出时，我希望由 App 启动的 Kimi Code 和 IM Bridge 被干净停止，不留下后台进程。
5. 当版本更新时，我希望应用能自动验证签名并正常更新，而不需要重新绕过 Gatekeeper。
6. 当启动失败时，我希望诊断页告诉我 Kimi 路径、版本、端口、签名/运行状态和可执行修复动作。
7. 当我从 Windows 切换到 Mac 时，我希望工作区和应用概念一致，但快捷键和窗口行为符合 macOS。

---

## 4. 产品目标

### G-01 可安装与可信分发

提供 Apple Silicon DMG，使用 Developer ID 签名、Hardened Runtime、公证与 stapling。普通用户从浏览器下载后无需执行 `xattr`、右键“打开”绕过或关闭 Gatekeeper。

### G-02 稳定管理 Kimi Code

在 Finder 启动的 GUI 环境中可靠定位 Kimi Code 0.33.0+，正确处理当前 `server/instances` 多实例协议，区分 owned 与 external runtime。

### G-03 原生 macOS 生命周期

支持原生 traffic lights、App Menu、Dock reopen、`Cmd+Q`、关闭窗口隐藏、标准快捷键和正确的前后台切换。

### G-04 保持核心功能等价

首版至少保留：

- 主工作区与多 Pane。
- 控制中心。
- Kimi Code 登录与配置状态。
- Workspace 打开与恢复。
- IM Bridge 基本启动与状态。
- 日志、诊断与应用更新。
- 全局唤起快捷键。

### G-05 不回归 Windows

macOS 平台化不得破坏现有 Windows build、MSI/NSIS、Explorer 菜单、WebView2 与更新能力。

---

## 5. 非目标

macOS V1 明确不包含：

1. Mac App Store 上架。
2. Finder Sync Extension。
3. 对所有文件或文件夹注册全局 Open With handler。
4. 自动安装 Xcode、Homebrew、Node.js 或其他系统依赖。
5. 在 App 内静默执行远程 `curl | bash`。
6. 将 Kimi Code 原生 binary 捆绑进 Kimi Sidekick。
7. Intel Mac 或 universal binary 正式支持。
8. iCloud 同步、Keychain 凭据迁移或跨设备 session 同步。
9. 开机自启动和纯 menu-bar-only 模式。
10. 重新设计所有业务页面。
11. 与 Windows 完全像素一致的窗口 chrome。

---

## 6. 产品原则

### P-01 原生优先，而非一致性优先

业务概念跨平台一致；窗口、菜单、快捷键、关闭和 Dock 行为遵循 macOS。

### P-02 外部依赖必须可见

Kimi Code 是独立产品和运行时。App 应展示检测、版本和升级状态，不应假装其完全内置。

### P-03 安全默认值不可降级

- 只绑定 loopback。
- 保留 bearer token。
- 禁止 `--dangerous-bypass-auth`。
- updater 必须验证签名。
- 不静默执行远程 shell。

### P-04 所有权决定退出行为

App 只停止自己启动的 runtime。复用用户在终端启动的 Kimi 实例时，不得在退出时杀死它。

### P-05 可诊断性是首发功能

PATH、Kimi 版本、实例注册、端口、token 文件存在性、sidecar、应用签名和 updater 状态必须可检查。

### P-06 平台差异显式建模

前端不通过到处判断 `navigator.platform` 隐式分叉；由后端提供统一 `PlatformCapabilities`。

---

## 7. 发布范围

### 7.1 P0：macOS V1 GA 必须交付

- Apple Silicon `aarch64-apple-darwin`。
- macOS 13+。
- `.app`、签名公证 `.dmg`、Tauri updater artifact。
- Finder 启动 Kimi Code 定位。
- Kimi Code 0.33.0+ 版本验证和能力探测。
- `server/instances/*.json` 多实例发现。
- owned runtime 的 process group 管理。
- 原生标题栏与 traffic lights。
- App Menu、Dock reopen、Cmd+Q。
- 全局快捷键 `⌘⇧K`。
- Open Folder、拖放目录/文件、现有 OpenRequest 复用。
- IM Bridge arm64 sidecar。
- macOS 诊断信息。
- 签名、公证、stapling 和 updater CI。
- Windows 回归 build。

### 7.2 P1：首发后增强

- Intel x86_64 独立包或 universal binary。
- `kimi-sidekick://` deep link。
- Finder Quick Action。
- Kimi Code 受管下载与 checksum 验证。
- 登录项/开机启动。
- menu bar icon 可配置开关。
- macOS 原生通知。

### 7.3 P2：独立战略立项

- Mac App Store。
- App Sandbox 兼容模式。
- Finder Sync Extension。
- 将 Kimi Code runtime 嵌入 App bundle。

---

## 8. 用户流程

### 8.1 首次启动：Kimi Code 已安装

1. 用户将 App 拖入 `/Applications` 并启动。
2. Gatekeeper 正常验证，不出现“已损坏”或未识别开发者提示。
3. App 在 1 秒内显示 prefill/loading 窗口。
4. App 按顺序定位：
   - 用户配置路径；
   - `~/.kimi-code/bin/kimi`；
   - `/opt/homebrew/bin/kimi`；
   - 其他可信常见路径；
   - 受控 login-shell `command -v kimi`。
5. 执行 `kimi --version`，验证最低版本和能力。
6. 启动 owned `kimi web --no-open --port <base>`。
7. 通过实例注册和健康检查确定实际端口。
8. 读取 token，进入工作区或 onboarding。
9. 用户看到上次窗口/工作区状态。

### 8.2 首次启动：Kimi Code 未安装

1. App 进入 onboarding 的“安装 Kimi Code”步骤。
2. 页面明确说明 Kimi Code 是独立本地运行时。
3. 页面提供官方命令：

```sh
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
```

4. 提供“复制命令”“打开终端”“重新检测”“手动选择可执行文件”。
5. App 不自动执行该命令，不请求管理员权限。
6. 用户安装后点击“重新检测”，成功进入下一步。

### 8.3 Kimi Code 版本过低或不兼容

1. 页面展示检测路径和版本。
2. 明确说明最低支持 0.33.0。
3. 提供“复制升级命令”“打开终端”“重新检测”。
4. 未通过协议能力探测时，阻止进入不可靠 workspace，并进入诊断页。

### 8.4 关闭、隐藏、恢复、退出

- 点击红色关闭按钮：隐藏主窗口，应用仍运行。
- 点击 Dock 图标：恢复并聚焦主窗口。
- `⌘W`：关闭/隐藏当前主窗口，遵循窗口语义。
- `⌘H`：隐藏 App。
- `⌘Q`：停止 owned Kimi runtime 和 bridge，退出应用。
- 从菜单选择 Quit：同 `⌘Q`。
- App 更新重启：先执行受控 shutdown，再安装更新。

### 8.5 打开工作区

V1 提供：

- File > Open Folder…
- 控制中心选择工作目录。
- 将目录或文件拖入主窗口。
- 现有应用内“打开到 Pane”流程。

Finder 右键扩展不作为 V1 前置条件。

### 8.6 更新

1. App 检查 `latest.json`。
2. manifest 必须同时包含当前平台的 `darwin-aarch64` 条目。
3. 用户确认更新。
4. 下载 `.app.tar.gz`，Tauri 验证 updater signature。
5. App 停止 owned runtime 与 sidecar。
6. 安装并重启。
7. 新版本启动后验证配置和 workspace 状态仍在。

---

## 9. 功能需求

### 9.1 平台检测与能力

#### FR-MAC-PLAT-001

系统必须提供后端生成的 `PlatformCapabilities`，至少包含：

- `os`: `macos | windows`
- `arch`: `aarch64 | x86_64`
- `nativeWindowControls`
- `supportsExplorerContextMenu`
- `supportsFinderQuickAction`
- `supportsDockReopen`
- `supportsAppMenu`
- `hotkeyLabel`
- `kimiInstallMode`
- `bundleChannel`

#### FR-MAC-PLAT-002

前端必须根据 capabilities 隐藏 Windows-only UI，不得把 unsupported 功能显示为可操作开关。

#### FR-MAC-PLAT-003

Windows 和 macOS 必须共享同一 IPC contract；平台差异使用字段表达，不创建两套页面协议。

### 9.2 Kimi Code 定位

#### FR-MAC-KIMI-001

App 必须在 Finder 启动时可靠定位 Kimi Code，不得只依赖进程继承的 PATH。

#### FR-MAC-KIMI-002

定位顺序必须可解释，并在诊断页展示“命中路径”和“命中来源”。

#### FR-MAC-KIMI-003

用户必须能手动选择 `kimi` 可执行文件；选择后验证它是常规文件、可执行且 `--version` 成功。

#### FR-MAC-KIMI-004

无效配置路径不得静默 fallback；应展示配置错误并允许清除。

#### FR-MAC-KIMI-005

login-shell 探测必须有超时、输出长度限制和安全解析，不能无限等待用户 shell 初始化。

### 9.3 Kimi Code 版本与协议

#### FR-MAC-KIMI-010

首发最低支持 Kimi Code 0.33.0。

#### FR-MAC-KIMI-011

App 必须执行 capability probe，而不能只依据版本字符串判断兼容性。

#### FR-MAC-KIMI-012

必须支持当前 `server/instances/*.json` 注册机制。

#### FR-MAC-KIMI-013

实例候选必须验证：PID、loopback host、端口范围、启动时间和健康接口。

#### FR-MAC-KIMI-014

App 必须记录 runtime ownership：

- `OwnedChild`
- `ExternalReused`
- `Unknown`

`Unknown` 不得执行破坏性停止。

### 9.4 运行时启动与停止

#### FR-MAC-RUN-001

owned Kimi Code 必须运行在独立 Unix process group/session。

#### FR-MAC-RUN-002

正常退出先发送 SIGTERM，等待 grace period 后再 SIGKILL。

#### FR-MAC-RUN-003

停止操作必须验证进程组已退出，避免 orphan process。

#### FR-MAC-RUN-004

App 不得停止 external reused runtime。

#### FR-MAC-RUN-005

启动失败必须保留脱敏后的 stdout/stderr、命令、退出码和状态转换。

#### FR-MAC-RUN-006

App 永远不得使用 `--dangerous-bypass-auth`。

### 9.5 窗口与生命周期

#### FR-MAC-WIN-001

macOS 主窗口必须使用原生 traffic lights，不显示 Windows 自制最小化/最大化/关闭按钮。

#### FR-MAC-WIN-002

主窗口必须支持最小化、zoom/fullscreen 和拖拽，不因 titlebar 自定义而丢失系统能力。

#### FR-MAC-WIN-003

点击 Dock 图标且没有可见窗口时，App 必须恢复主窗口。

#### FR-MAC-WIN-004

红色关闭按钮不得直接杀死 runtime；默认隐藏主窗口。

#### FR-MAC-WIN-005

`Cmd+Q` 必须触发 graceful shutdown。

#### FR-MAC-WIN-006

Agent Room、workspace picker 等附属窗口必须遵循同一 platform window policy。

### 9.6 菜单与快捷键

#### FR-MAC-MENU-001

App 必须提供原生 App Menu，包含 About、Settings、Services、Hide、Hide Others、Quit。

#### FR-MAC-MENU-002

必须提供 File、Edit、View、Window、Help 菜单。

#### FR-MAC-MENU-003

File 菜单至少包含 Open Folder、Close Window。

#### FR-MAC-MENU-004

Edit 菜单必须保留系统级 Undo/Redo/Cut/Copy/Paste/Select All 行为。

#### FR-MAC-MENU-005

全局唤起快捷键默认显示为 `⌘⇧K`，不得在 macOS UI 显示 `Ctrl+Shift+K`。

### 9.7 工作区入口

#### FR-MAC-OPEN-001

必须提供原生 Open Folder dialog。

#### FR-MAC-OPEN-002

必须支持将目录或文件拖入 App 并转换到现有 OpenRequest。

#### FR-MAC-OPEN-003

必须处理 Tauri `RunEvent::Opened`，并对不受支持的资源给出明确反馈。

#### FR-MAC-OPEN-004

V1 不注册为所有文件和文件夹的默认处理器。

### 9.8 Kimi Code 安装引导

#### FR-MAC-INSTALL-001

macOS 安装中心不得显示 winget、PowerShell Execution Policy、Git for Windows 或 Windows Python 安装器。

#### FR-MAC-INSTALL-002

默认展示 Kimi Code 官方 macOS 安装命令，并标注来源。

#### FR-MAC-INSTALL-003

提供复制、打开 Terminal、重新检测和手动选择路径。

#### FR-MAC-INSTALL-004

V1 不在 App 内自动执行远程安装脚本。

#### FR-MAC-INSTALL-005

Kimi Code 升级入口与 Kimi Sidekick 自身更新入口必须分开。

### 9.9 IM Bridge

#### FR-MAC-BRIDGE-001

必须构建 arm64 macOS bridge sidecar。

#### FR-MAC-BRIDGE-002

sidecar 必须被放入 App bundle、带 executable bit、由同一 Developer ID 签名并通过 notarization。

#### FR-MAC-BRIDGE-003

bridge 的设置、状态、日志和停止行为应与 Windows 等价。

#### FR-MAC-BRIDGE-004

App 退出时只停止自己启动的 bridge。

### 9.10 更新与发布

#### FR-MAC-UPD-001

macOS build 必须生成 `.app`、`.dmg`、`.app.tar.gz` 和 `.sig`。

#### FR-MAC-UPD-002

DMG 必须签名、公证并 staple。

#### FR-MAC-UPD-003

Updater manifest 必须包含 `darwin-aarch64` 和现有 Windows 条目。

#### FR-MAC-UPD-004

多平台构建不得并发覆盖 `latest.json`。

#### FR-MAC-UPD-005

发布流水线必须在发布前验证 codesign、Gatekeeper、stapler 和 DMG integrity。

### 9.11 诊断

#### FR-MAC-DIAG-001

诊断页必须显示：

- App 版本、OS、arch、bundle channel。
- Kimi path、source、version、home。
- instance registry 路径、选中 server ID、PID、host、port、heartbeat age。
- runtime ownership。
- health/auth probe 状态。
- bridge path、version、PID、status。
- App signature/notarization 基本状态（release build）。

#### FR-MAC-DIAG-002

所有 token、API key、URL fragment 必须脱敏。

#### FR-MAC-DIAG-003

导出诊断包前必须提示可能包含的路径和日志范围。

---

## 10. 非功能需求

### NFR-MAC-PERF-001 启动可感知性能

- prefill/loading 窗口：P95 ≤ 1.0 秒出现。
- 已安装且兼容的 Kimi Code：P95 ≤ 15 秒进入可用 workspace。
- 已有健康 external runtime：P95 ≤ 5 秒进入 workspace。
- Dock reopen：P95 ≤ 500 ms 显示并聚焦。

### NFR-MAC-REL-001 稳定性

- 连续 100 次启动/退出 smoke 中不得残留 owned Kimi 或 bridge 进程。
- 端口冲突时必须自动恢复，不得进入无限 starting。
- App crash 后下次启动能识别 stale registry，不错误复用死实例。
- updater 失败不得破坏当前可运行版本。

### NFR-MAC-SEC-001 安全

- release build 必须通过 Developer ID、Hardened Runtime 和 notarization。
- updater signature 强制启用。
- 不记录 bearer token 或 API key。
- loopback URL 只允许 `127.0.0.1` / `localhost` 受控来源。
- sidecar 和主 binary 均必须签名。
- 不启用 macOS private API。
- 自定义 entitlement 遵循最小化原则。

### NFR-MAC-COMPAT-001 兼容性

- 首发：macOS 13、14、15、26 的 Apple Silicon 实机或可用测试环境中至少完成 smoke。
- 主验证设备：用户的 M5 MacBook Pro。
- Kimi Code：0.33.x 必测。
- Windows：现有 CI build 和核心 smoke 必须继续通过。

### NFR-MAC-UX-001 原生体验

- 所有面向用户的快捷键使用 macOS 符号和术语。
- 不出现“最小化到系统托盘”“Explorer”“PowerShell”等 Windows-only 文案。
- 菜单、关闭、隐藏、全屏符合 macOS 预期。
- 支持系统深色/浅色主题与 Retina 显示。

### NFR-MAC-A11Y-001 可访问性

- 菜单和关键按钮可通过键盘访问。
- traffic lights 不被 HTML 元素覆盖。
- 焦点顺序、Esc、Cmd+W、Cmd+, 等标准行为可用。
- 关键状态不只依赖颜色表达。

### NFR-MAC-OBS-001 可观测性

- 启动状态转换有结构化日志。
- 每次 runtime 选择记录 source、ownership 和 server ID，但不记录 token。
- CI 保留 notarization log 和 artifact manifest。

---

## 11. UX 与文案要求

### 11.1 缺少 Kimi Code

标题：`需要安装 Kimi Code`

正文：

> Kimi Sidekick 使用本机 Kimi Code 提供 Agent、会话和工作区能力。未检测到可用的 Kimi Code。请使用官方命令安装，完成后返回这里重新检测。

按钮：

- `复制官方安装命令`
- `打开终端`
- `重新检测`
- `手动选择 Kimi 可执行文件`

### 11.2 版本不兼容

标题：`Kimi Code 版本需要更新`

信息：

- 当前路径
- 当前版本
- 最低支持版本
- 协议探测失败项

按钮：

- `复制升级命令`
- `打开终端`
- `重新检测`
- `查看诊断`

### 11.3 关闭行为首次提示

首次点击红色关闭按钮时可显示一次非阻塞提示：

> 窗口已关闭，Kimi Sidekick 仍在运行。点击 Dock 图标可重新打开；按 ⌘Q 可完全退出。

提供“不再提示”。

### 11.4 退出中

> 正在停止由 Kimi Sidekick 启动的本地服务…

若 external runtime 被复用：

> 正在退出 Kimi Sidekick；你在终端启动的 Kimi Code 将继续运行。

---

## 12. 成功指标

### 产品指标

| 指标 | Beta 目标 | GA 目标 |
|---|---:|---:|
| 支持设备首次启动成功率 | ≥ 90% | ≥ 97% |
| 已安装 Kimi 后进入 workspace 成功率 | ≥ 95% | ≥ 99% |
| 无残留 owned runtime 的正常退出率 | ≥ 98% | 100%（测试样本） |
| Gatekeeper 无绕过安装率 | 100% | 100% |
| Updater 成功率 | ≥ 90% | ≥ 98% |
| 启动失败具备可行动诊断比例 | ≥ 95% | 100% |

### 工程发布门槛

- 所有 P0 FR 有自动或手工验收证据。
- macOS arm64 release build 在 CI 成功。
- `codesign --verify --deep --strict` 成功。
- `spctl --assess --type execute` 成功。
- `xcrun stapler validate` 成功。
- `hdiutil verify` 成功。
- clean user account 安装启动成功。
- 更新前后 workspace/settings 保持。
- Windows release workflow 回归成功。

---

## 13. 验收场景

### AC-01 Clean install

Given 一台没有安装 Kimi Sidekick 的 Apple Silicon Mac
When 用户下载 DMG、拖入 Applications 并启动
Then App 通过 Gatekeeper，不要求绕过安全设置。

### AC-02 Missing Kimi

Given Kimi Code 未安装
When App 启动
Then 显示 macOS 官方安装引导，不显示 Windows 安装项，不执行远程脚本。

### AC-03 Finder PATH

Given `kimi` 已通过官方脚本安装，但 Finder 环境 PATH 中没有对应目录
When App 从 Finder 启动
Then App 仍能通过官方路径或受控 shell probe 定位并验证它。

### AC-04 New instance registry

Given Kimi Code 0.33.x
When App 启动 owned `kimi web`
Then App 从 `server/instances` 找到匹配 child PID 的实例并连接实际端口。

### AC-05 Port conflict

Given 默认端口被占用
When Kimi Code 自动递增端口
Then App 连接注册记录中的真实端口，而不是错误宣告启动失败。

### AC-06 External runtime ownership

Given 用户在终端启动了 Kimi Code
When App 复用该实例并随后退出
Then external Kimi Code 保持运行。

### AC-07 Owned process cleanup

Given App 启动了 Kimi Code 和 bridge
When 用户按 `Cmd+Q`
Then App 在 grace period 内停止两者，必要时升级信号，最终无残留进程。

### AC-08 Dock reopen

Given 用户关闭了主窗口但未退出
When 点击 Dock 图标
Then 主窗口显示并聚焦，workspace 不刷新。

### AC-09 Native chrome

Given macOS 主窗口
Then 左上角使用系统 traffic lights，支持最小化与全屏，不显示 Windows 自制按钮。

### AC-10 Updater

Given 已安装旧版 signed/notarized App
When 用户安装新版本更新
Then signature 验证成功、App 重启、sidecar 可启动、设置不丢失。

### AC-11 Bridge

Given bridge 已启用
When App 启动
Then arm64 sidecar 可运行并通过状态检查；发布包 codesign/notary 校验通过。

### AC-12 Windows regression

Given 同一提交
When Windows release job 构建
Then MSI/NSIS 和 Windows updater 仍成功，Explorer 功能未被 mac 分支破坏。

---

## 14. 数据与隐私

- 默认不新增远程 telemetry。
- 本地诊断日志保留现有脱敏策略并增加 macOS 路径/注册记录脱敏检查。
- 不上传工作区内容、会话内容、token 或 API key。
- 导出诊断包必须由用户主动触发。
- 登录凭据继续由 Kimi Code 自己管理；Kimi Sidekick 不复制 OAuth token 到自身配置。
- 后续若引入崩溃上报，应另行 PRD，默认 opt-in。

---

## 15. 依赖与前置条件

### 外部前置

- 有效 Apple Developer Program 账号。
- `Developer ID Application` 证书。
- App Store Connect API key 或 Apple ID notarization credentials。
- 稳定的 Bundle ID。
- GitHub Actions secrets。
- Apple Silicon 实机用于最终 QA。

### 仓库前置

- 保留并使用 `pnpm-lock.yaml`、`Cargo.lock`。
- release 使用 `pnpm install --frozen-lockfile` 与 `cargo --locked`。
- 将公共 PowerShell 脚本迁移到跨平台实现。
- 新 Kimi runtime adapter 必须先于 mac release 完成。

---

## 16. 发布策略

### Alpha

- unsigned/ad-hoc 本机开发构建。
- 只验证编译、窗口、runtime、bridge。
- 不向普通用户分发。

### Beta

- Developer ID signed + notarized DMG。
- GitHub prerelease。
- 仅 Apple Silicon。
- 至少完成用户 M5、另一台 Apple Silicon Mac 和 clean account 测试。

### GA

- 非 prerelease GitHub Release。
- updater `latest.json` 同时包含 Windows 和 `darwin-aarch64`。
- 发布说明明确最低 macOS 与 Kimi Code 版本。
- 维护 rollback artifact 和前一版本 manifest。

---

## 17. PRD 完成定义

macOS V1 只有在以下条件同时成立时才算完成：

1. 不是只运行 `pnpm tauri build`，而是产出可被普通用户安装的 signed/notarized DMG。
2. 使用 Kimi Code 当前实例注册协议，而不是 legacy lock。
3. Finder 启动可定位 Kimi。
4. Dock、App Menu、traffic lights、关闭与退出符合 macOS。
5. owned 子进程无残留，external 子进程不被误杀。
6. bridge 被正确打包和签名。
7. updater 可以跨平台发布且不覆盖 manifest。
8. Windows 现有版本无回归。
