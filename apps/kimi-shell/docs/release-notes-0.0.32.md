# Kimi Desktop Shell Release Notes

Version: `v0.0.32`  
Release date: `2026-03-28`

## Highlights

This release turns Kimi Desktop Shell into a more complete operator console: IM Bridge now supports multi-bot management with first-class Weixin onboarding, Control Center has been reorganized into clearer split-pane workflows, and Skill Center is more usable for real workspace management instead of simple skill discovery.

## What's New

1. **Multi-Bot IM Bridge with Weixin Onboarding**
- Added first-class `Weixin` support to IM Bridge, including QR onboarding, owner binding, token persistence, and masked credential management.
- IM Bridge now manages multiple connectors as separate bots instead of a single flat bridge entry.
- Added clearer bot creation and connector selection flows so operators can manage Weixin and Feishu bots independently.
- Strengthened bridge diagnostics, host control, and session recovery paths for more reliable day-to-day operations.

2. **Reworked Control Center and Bridge Workspace**
- Reorganized the `IM Bridge` experience into a split-pane workbench with a compact bot rail and a focused detail surface.
- Moved connector settings, onboarding details, and advanced runtime controls into clearer task surfaces instead of replacing the entire page.
- Refined Control Center shared primitives and status language so Bridge, install flows, and workspace surfaces feel more consistent.
- Improved dark-button contrast and reduced visual friction in high-density operator screens.

3. **Skill Center Workspace Management**
- Refactored Skill Center workspace management to better support workspace-specific views, recommendations, and applied-skill states.
- Improved tolerance for invalid workspace skill entries so the app degrades more safely when local skill state is messy.
- Expanded the desktop-side skill management path so workspace actions are closer to production-ready rather than placeholder UI.

4. **Packaging and Release Readiness**
- Carried forward the bridge sidecar build and packaging flow into the `0.0.32` desktop installers.
- Produced updated Windows installers for both `NSIS` and `MSI` distribution formats.

## Notes

- Weixin support in this release focuses on the primary onboarding and private-chat bridge workflow.
- Existing bridge and skill data from earlier versions should remain compatible, but this release includes substantial Control Center and Bridge UI reorganization.

## Installers

- NSIS: `Kimi.Desktop.Shell_0.0.32_x64-setup.exe`
- MSI: `Kimi.Desktop.Shell_0.0.32_x64_en-US.msi`

## Verification

- Existing built installers located under `apps/kimi-shell/src-tauri/target/release/bundle/`
- NSIS build timestamp: `2026-03-27 22:26:44`
- MSI build timestamp: `2026-03-27 22:25:45`
