# Kimi Desktop Shell Release Notes

Version: `v0.0.28`  
Release date: `2026-03-19`

## Highlights

This release focuses on IM Bridge usability and desktop interaction consistency: dynamic Bridge naming by enabled channel, first-card quick controls (including session regeneration), Chinese tray menu labels, and a rememberable main-window close strategy (ask/exit/minimize to tray).

## Main Changes

1. **System Tray + Main Window Close Strategy**
- Localized tray menu labels to Chinese while keeping existing actions/order unchanged:
  - `显示/隐藏窗口`
  - `重启后端服务`
  - `打开诊断`
  - `打开日志目录`
  - `退出`
- Added persisted main-window close behavior (`ask | exit | minimize_to_tray`), defaulting to `ask`.
- Added first-close decision prompt with “remember my choice”, plus runtime diagnostics entry to switch behavior at any time.
- Kept prefill window close behavior unchanged.

2. **IM Bridge Session Strategy Enhancements**
- Added `resetBindingSessionOnBridgeStart` to Bridge settings (default `true`, including legacy-settings fallback).
- When enabled, Bridge now rotates each binding session after successful start (preserving binding and workDir mapping).
- Added manual per-binding session regeneration command path (`reset_bridge_binding_session`) and wiring in shell/sidecar client.
- Exposed manual “新建并切换会话” operation in Control Center binding flows.

3. **Control Center IM Bridge UX Improvements**
- Dynamic Bridge display naming based on enabled channels:
  - Feishu only -> `飞书`
  - Telegram only -> `Telegram`
  - None or both -> `IM Bridge`
- Applied dynamic naming consistently to tab title, card titles, panel titles, and config entry labels.
- Upgraded first IM Bridge card:
  - Added quick switches for `飞书自动审批` and `每次 Bridge 启动新建会话`.
  - Moved “当前绑定” + “新建并切换会话” into a card aligned with `IM 默认工作目录` (same design language, same row on desktop).
  - Replaced the long ready-state line with a compact `i` info popover.
- Unified runtime-panel checkbox visuals to the same switch style used in Control Center.

4. **Behavior and Sync Reliability**
- Reduced false-positive onboarding dirty state in Bridge flow by refining onboarding-draft sync behavior (preventing “配置仍有未保存更改” misreporting during normal state refresh).
- Updated app/settings schema wiring to support the new close-behavior and Bridge session-strategy settings.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.28_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.28_x64_en-US.msi`

## Verification

- `pnpm -C apps/kimi-shell exec tsc --noEmit`
