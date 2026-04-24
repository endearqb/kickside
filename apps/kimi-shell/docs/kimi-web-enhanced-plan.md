# Kimi Web 本地增强版产品化计划

## 目标

把当前应用中的官方 `kimi web` 内嵌体验扩展为可选择的本地增强体验。默认继续使用官方 Web，用户可在控制中心切换到“本地增强版”；增强版保留官方认证、服务端协议、stream/WebSocket、模型、计费和权限边界，只在桌面壳体验、中文文案、健康状态和回退能力上做产品化增强。

## 实施范围

- `官方 Web`：沿用现有 `kimi web --no-open` 后端进程与 workspace proxy。
- `本地增强版`：加载本地静态入口 `public/enhanced-kimi-web/`，内部承载现有 workspace proxy 地址，并转发 theme、session、prefill 消息。
- 合规资产：`third_party/kimi-cli-web/` 记录 Apache-2.0、上游来源 commit 和本地修改说明。
- 同步管线：`scripts/sync_kimi_cli_web.ps1` 从 MoonshotAI/kimi-cli 指定 commit 同步 `web/` 快照，并保留 `patches/kimi-web/` 作为后续 patch 管线。

## 用户可见行为

- 控制中心的“运行诊断 / Web 体验”展示当前模式、增强版健康状态、上游来源 commit、最近可用版本、回退记录和品牌免责声明。
- 切换到本地增强版后，工作区 iframe 使用本地入口，并通过 query 参数接收官方 workspace proxy 地址。
- 增强版加载失败或超时且自动回退开启时，应用会保存回退原因并切回官方 Web。
- 用户可随时手动回退官方 Web，回退不迁移数据，也不修改 Kimi CLI 配置。

## 接口与状态

- `WorkspaceWebMode = "official" | "enhanced_local"`
- Shell 设置：
  - `workspaceWebMode`
  - `enhancedWebAutoFallback`
  - `enhancedWebPinnedCommit`
  - `enhancedWebLastKnownGoodCommit`
  - `enhancedWebLastFallbackReason`
- Tauri 命令：
  - `get_workspace_web_settings`
  - `save_workspace_web_settings`
  - `fallback_workspace_web_to_official`
  - `mark_enhanced_web_ready`
- App status / diagnostics：
  - `workspaceWebMode`
  - `enhancedWebSourceCommit`
  - `enhancedWebHealth`
  - `enhancedWebLastFallbackReason`

## 验收清单

- 官方 Web 模式保持现有启动、加载、会话和 stream 行为。
- 本地增强版模式可以加载现有 workspace proxy，并转发主题、session、prefill 消息。
- 增强版 iframe blocked 时可自动回退官方 Web。
- 控制中心可切换模式、开关自动回退、查看来源 commit 和免责声明。
- `check:enhanced-web:i18n` 和 `check:enhanced-web:compliance` 通过。
- 发布前确认 `third_party/kimi-cli-web/LICENSE`、`SOURCE.md`、`CHANGES.md` 与 `docs/third-party-notices.md` 完整。
