# Kimi Desktop Shell（中文说明）

Kimi Desktop Shell 是基于 `Tauri v2 + React` 的 Windows 桌面壳程序，用于托管 `kimi web`，提供稳定启动、前置监控页、安装引导、日志与诊断能力。

## 项目简介

- 应用名称：`Kimi Desktop Shell`
- 当前版本：`0.0.13`
- 目标平台：Windows（当前发布产物为 MSI / NSIS）
- 核心目标：把 `kimi web` 的启动、恢复、安装引导、右键入口与桌面体验统一在一个桌面应用中

## 核心能力

- 启动前置页（prefill）：显示启动状态、随机 Tips、失败恢复入口
- 后端守护与健康探测：拉起 `kimi web`，探测可用端口并接入 workspace
- 控制中心（onboarding）：安装依赖、安装/升级 Kimi、查看完整命令
- 右键菜单集成：支持目录空白处、文件、文件夹入口
- 诊断与日志：应用日志、后端日志、错误提示与恢复操作
- 安全退出流程：退出读秒窗 + 状态反馈

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
pnpm tauri build --debug
```

可选检查命令：

```bash
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

## 常见问题

### 1) 打开应用后停在前置页

- 先点击右上角“打开日志”检查 `backend.log`
- 在失败态尝试“重试启动”
- 确认本机 `kimi` 可执行文件可被找到或已在控制中心完成安装

### 2) 右键菜单入口不可用

- 在控制中心检查右键菜单状态
- 如状态异常，执行“应用右键菜单”重新注册
- 重新打开资源管理器后再验证

### 3) 图标或快捷方式显示异常

- 先确认使用的是最新安装包重装
- 清理旧快捷方式后重新创建
- 任务栏固定项建议从新版快捷方式重新固定
