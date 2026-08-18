# Signed Desktop Self-Update

## Status

Accepted

> 2026-08-18：更新源与发布位置部分由 `2026-08-18-gitee-update-mirror.md` 增量扩展；GitHub 仍是 canonical 构建与 Release。

## Decision

- Kimi 小助手通过 Tauri v2 Updater 从 GitHub Releases 的 `latest.json` 检测更新，更新必须由用户确认后下载和安装；Windows 安装使用 `passive` 模式。
- `v*` tag 触发唯一的 Windows 发布 workflow。tag 必须与 `apps/kimi-shell/package.json` 版本完全一致，发布结果为非草稿 GitHub Release、NSIS/MSI 安装包、签名文件和 `latest.json`。
- 发布使用 Tauri updater 签名密钥。私钥与密码只保存在 GitHub Actions Secrets，并仅通过环境变量提供给构建；缺少任一 Secret 时发布立即失败。
- `latest.json` 保留 Tauri 2.10+ 的 installer-specific Windows 条目，使现有 NSIS/MSI 安装分别沿用原安装器；legacy Windows 条目优先 NSIS。
- `0.1.13` 是首个支持本体更新的版本。更早版本不能自举 Updater，用户需手动安装一次支持版本。

## Rationale

- Tauri 原生 Updater 已覆盖版本比较、下载和签名验证，无需维护自定义下载器或更新协议。
- GitHub Release 与仓库现有发布位置一致，tauri-action 可在一个构建中生成安装包、签名和静态 manifest。
- 用户确认避免强制更新中断正在运行的 Kimi 后端或 IM Bridge；签名验证防止未授权安装包进入更新链路。

## Consequences

- 发布 tag 前必须先同步 `package.json`、Cargo 和 Tauri 配置版本，并配置长期签名 Secrets；签名私钥丢失会切断已安装客户端的更新信任链。
- Tauri 更新签名不替代 Windows Authenticode，也不解决 SmartScreen 信誉问题。
- 安装包、对应签名和 `latest.json` 缺一不可；自动 workflow 成功只达到构建/发布资产阶段，仍需通过安装版 G3 更新回归才能声明可发布。

## Verification

- Workflow 静态检查覆盖 tag/version 比较、密钥 fail-fast、固定工具链和 tauri-action 发布参数。
- G3 从旧 NSIS 与 MSI 安装版分别验证检测、下载、签名、服务退出、被动安装和新版本启动，并验证断网、损坏签名与下载失败保留当前安装。
