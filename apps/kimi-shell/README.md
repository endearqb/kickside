# Kimi Desktop Shell（中文说明）

Kimi Desktop Shell 是基于 `Tauri v2 + React` 的 Windows 桌面壳程序，用于托管 `Kimi Code Web`，把启动监控、workspace 壳层、控制中心、日志诊断和安装包输出整合进同一个桌面应用。

## 项目简介

- 应用名称：`Kimi Desktop Shell`
- 当前版本：`0.0.43`
- 目标平台：Windows（当前发布产物为 MSI / NSIS）
- 核心目标：把 `kimi server run` 的启动、恢复、安装引导、右键入口与桌面体验统一在一个桌面应用中

## 核心能力

- 启动前置页（prefill）：显示启动状态、随机 Tips、失败恢复入口
- Workspace Grid 壳层：常驻 `Kimi Code Web` 与 `Kimi Chat`，支持 1/2/3/4/5/6 窗预设、窗格切换、最大化、拖拽调宽/调高、命名布局保存/恢复、外部页降级、嵌入式子 Webview 承载、native Webview per-pane 存储目录与独立应用 WebviewWindow 打开
- 后端守护与健康探测：拉起 `kimi server run --foreground --port <port>`，读取 `KIMI_CODE_HOME/server.token`，并用 `#token=` 接入 workspace
- 会话与 workspace 映射：Shell 后端通过 `/api/v1` Bearer 客户端创建/读取 workspace 与 session，Workspace Grid 只使用真实 server session id
- 控制中心：集中提供运行状态、重启后端、工作目录、安装引导与诊断入口
- Chat 集成收口：跨站链接跳系统浏览器，Windows 安装版下载使用原生“另存为”
- 右键菜单集成：支持目录空白处、文件、文件夹入口
- 诊断与日志：应用日志、后端日志、Kimi Code Doctor、错误提示与恢复操作
- 安全退出流程：退出读秒窗 + 状态反馈

## 界面预览

主 workspace：

![Kimi Desktop Shell 主界面](public/home.png)

控制中心：

![Kimi Desktop Shell 控制中心](public/control_center.png)

## 运行环境

- Node.js 18+（建议 20+）
- pnpm 8+
- Rust stable
- Windows WebView2 Runtime（Tauri 桌面运行时依赖）

## 开发命令

在 `apps/kimi-shell` 目录执行：

```bash
pnpm install
pnpm tauri dev
pnpm build
pnpm tauri build
```

可选检查命令：

```bash
pnpm test
pnpm check:nfr:security
pnpm check:nfr:port-conflict
pnpm check:nfr:reliability
```

## 打包命令

```bash
pnpm tauri build
```

默认会同步版本号到 `Cargo.toml` 和 `tauri.conf.json`，并构建前端与 Tauri 安装包。

## 安装包位置

构建完成后可在以下目录找到安装包：

- `src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Kimi Desktop Shell_<version>_x64_en-US.msi`

## 发布资料

- 发布说明：`docs/release-notes-0.0.17.md`
- 设计文档：`docs/startup-dual-window-handoff.md`

## 常见问题

### 1) 打开应用后停在前置页

- 先点击右上角“打开日志”检查 `backend.log`
- 在失败态尝试“重试启动”或“恢复主窗口”
- 确认本机 `kimi` 可执行文件可被找到，或已在控制中心完成安装

### 2) 保存工作目录或点击“重启后端”后会不会重建窗口

- `0.0.17` 起，主壳层内的 plain “重启后端”已统一为纯后端重启
- 控制中心、loading 页、标题栏和 workspace 空态里的普通重启不会再主动重建 prefill/main 窗口
- 只有启动恢复类场景才会继续走主窗口恢复链路

### 3) Chat 页面下载如何处理

- Windows 安装版会弹原生“另存为”对话框
- 取消或保存都不应该再导致应用卡死
- 若下载异常，可先查看应用日志与系统浏览器行为是否正常

### 4) 右键菜单入口不可用

- 在控制中心检查右键菜单状态
- 如状态异常，执行“应用右键菜单”重新注册
- 重新打开资源管理器后再验证
