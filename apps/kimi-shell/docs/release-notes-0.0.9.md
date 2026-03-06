# Kimi Shell 版本更新说明

版本：`0.0.9`  
发布日期：`2026-03-06`

## 本次更新重点

本版本聚焦 Windows 安装版启动稳定性，重点收敛“第二次冷启动卡住 / 白屏 / 自动退出”以及桌面快捷方式启动误判问题。

## 变更详情

1. 启动链路改为单窗口
- 启动期不再创建第二个 Kimi 主 WebView2 窗口。
- 应用现在统一使用单个 `main` 窗口承载启动页与后续主界面，降低 WebView2 在启动阶段卡在 `about:blank` 的风险。

2. 启动前置页改为启动监控页
- 原前置输入页改为后端启动监控页，只显示启动计时、当前状态与恢复动作。
- 当后端 ready 且 workspace 端口就绪时，应用会自动进入工作区。
- 首次安装、缺少 Kimi 或需要引导配置时，会自动进入控制中心 `onboarding`。
- 后端崩溃时，会自动进入控制中心 `diagnostics`。

3. 启动失败兜底更明确
- 启动超时时不再直接白屏或退出，而是停留在启动监控页或 loading 失败页。
- 失败态提供“重试启动 / 打开日志 / 退出应用”等恢复入口。
- 诊断信息新增启动阶段、失败原因与最近一次启动监控决策，便于定位真实卡点。

4. 快捷方式启动不再误判为打开文件
- 修复了双击桌面快捷方式时误把应用自身 `exe` 当成 `open-files` 的问题。
- 现在双击快捷方式启动时，不会再在默认工作目录下创建临时 workspace 并复制 `Kimi Desktop Shell.exe`。
- 无参数启动会继续正确回退到已配置的默认工作目录作为 workspace。

## 验证结果

- `pnpm -C apps/kimi-shell sync:version` 通过。
- `pnpm -C apps/kimi-shell tauri build --bundles nsis` 通过。
- NSIS 安装包构建成功：
  - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_0.0.9_x64-setup.exe`

## 升级后建议

1. 在安装版环境下验证第二次冷启动：确认不会再出现白屏后自动退出。
2. 验证启动监控页能根据场景自动进入 workspace、`onboarding` 或 `diagnostics`。
3. 双击桌面快捷方式启动时，确认默认工作目录下不再出现 `20260306-appskimi-shell-xxxxxx` 这类临时目录。
4. 若仍遇到启动异常，优先在控制中心诊断页查看最近一次 `startup phase / failure kind`，并结合 `app.log` 排查。
