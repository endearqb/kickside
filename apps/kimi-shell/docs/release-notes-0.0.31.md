# Kimi Desktop Shell Release Notes

Version: `v0.0.31`  
Release date: `2026-03-26`

## Highlights

This release turns IM Bridge into a true multi-bot workspace: Weixin is now a first-class bridge platform, the Bridge page is reorganized into a split-pane operator layout, and Skill Center actions are wired through more completely for real workspace use.

## What's New

1. **Multi-Bot IM Bridge with Weixin Support**
- Added first-class `Weixin` as an IM Bridge platform alongside Feishu and existing connector data models.
- Added Weixin onboarding flow with QR scan, owner binding, bot token persistence, and masked credential views in Control Center.
- Bridge connector management now supports naming and operating multiple bots separately instead of treating Bridge as a single flat card.
- Telegram remains compatible for existing data, but it is intentionally hidden from the new-bot entry until full support is ready.

2. **IM Bridge Split-Pane Workspace**
- Reworked the `IM Bridge` page into a left-right workspace:
  - left side for a compact bot list
  - right side for the selected bot's detail view
- Added titlebar-level `一键重启` and `一键停止` actions for the global Bridge runtime.
- Replaced multiple creation buttons with a single `新建机器人` menu that currently offers only `微信` and `飞书`.
- `连接与凭据` and `高级运行面板` now open inside the right-side detail pane instead of replacing the whole Control Center page.

3. **Skill Center Completeness Improvements**
- Filled in workspace-level pinning so skills can be fixed to the current workspace profile.
- Added workspace skill recommendations based on recent usage, last-session usage, and pinned skills.
- Wired `更新技能` and `卸载技能` through the Tauri backend so Skill Center actions are no longer frontend-only placeholders.
- Extended installed skill records with metadata and update-status fields for future recommendation and refresh flows.

4. **Build and Packaging Reliability**
- Fixed release-blocking Tauri compile issues caused by missing Skill Center backend commands and outdated DTO initializers.
- Verified the desktop bundle flow end to end again, including frontend build, bridge sidecar build, Rust tests, and installer generation.

## Notes

- Weixin support in this release is focused on the initial private-chat bot flow; group and richer message modes are still intentionally limited.
- Existing Telegram connectors are still shown if already present in settings, but new Telegram bot creation is hidden in this version.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.31_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.31_x64_en-US.msi`

## Verification

- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- `pnpm -C apps/kimi-shell tauri build`
