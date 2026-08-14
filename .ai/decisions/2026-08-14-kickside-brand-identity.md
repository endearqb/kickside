# ADR · KickSide 品牌与兼容身份

| 项 | 值 |
|---|---|
| 日期 | 2026-08-14 |
| 状态 | Accepted |
| 范围 | 桌面应用展示品牌、安装包、发布渠道与 GitHub 仓库名 |

## Context

仓库和应用长期同时使用 `Kimi App`、`Kimi Sidekick`、`kimi sidekick`、`Kimi 小助手` 与 `kimi小助手`，用户可见身份、安装包名称和仓库名不一致。产品已同时承载 Kimi Code 与 DeepSeek Harness，不应继续以单一后端名称作为壳应用品牌。

品牌改名与操作系统应用身份是两类变更。修改 Tauri bundle identifier、数据目录、localStorage/IPC key、crate/binary 名或 Go module path 会触发设置迁移、登录态迁移、更新兼容和外部调用方风险，不应捆绑在展示品牌改名中。

## Decision

1. 英文与系统级产品名统一为 `KickSide`；中文界面品牌统一为 `KickSide 启伴`。
2. GitHub 仓库改名为 `endearqb/kickside`；包元数据、README、CI、Release 标题与 Tauri updater endpoint 使用新 URL。
3. Tauri `productName` 在所有语言打包配置中统一为 `KickSide`，从而稳定 `.app`、DMG、NSIS 与 MSI 的产品名；中文界面仍显示 `KickSide 启伴`。
4. 保留现有应用图标，本次不设计或替换 logo。
5. 保留 `com.kimi.shell`、现有用户数据目录、localStorage/IPC/event key、`apps/kimi-shell`、Rust crate/binary、sidecar 名，以及 Go module/import path `github.com/endearqb/kimi-app/...`。这些均视为兼容身份，不作为用户可见品牌。
6. 设置 schema 升至 13，只把已知旧版内置 Explorer 右键文案迁移到 `KickSide 启伴`；用户自定义文案原样保留。
7. 旧仓库 URL 依赖 GitHub rename redirect 为既有客户端和链接提供兼容；不得重新创建同名 `endearqb/kimi-app` 仓库，以免破坏重定向。

## Consequences

- 用户在窗口、菜单、控制中心、安装包和发布页看到单一品牌；KimiCode、KimiChat 与 DeepSeek Harness 继续作为后端产品名出现。
- 升级安装沿用 `com.kimi.shell` 与原数据目录，不会被操作系统识别为第二个全新应用。
- 源码仍存在 `kimi-*` 兼容命名；后续若要清理，必须单独制定数据、更新、Go module 和外部调用方迁移方案。
- GitHub 会重定向大多数旧 Web 与 Git URL，但 GitHub Pages、自定义 Actions 等不保证跟随；本仓库当前未启用 Pages，也未发现依赖旧仓库名的托管 Action。

## Verification

- 品牌单元测试、设置迁移测试、前端类型检查与 Vitest。
- Rust fmt/test，确认 `identifier` 仍为 `com.kimi.shell`。
- macOS arm64 本地 `.app` 构建，检查 `KickSide.app`、Info.plist bundle identifier 和 arm64 二进制。
- 仓库改名后验证新 remote、旧仓库 Web redirect 与新 updater endpoint。
