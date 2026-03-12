# Kimi Desktop Shell Release Notes

Version: `v0.0.19`  
Release date: `2026-03-12`

## Highlights

This release hardens the Windows install flow and also improves workspace persistence. Kimi Desktop Shell now resolves newly installed tools more reliably without relying only on the current PowerShell PATH, adds configurable mirror sources inside Control Center, surfaces clearer PowerShell preflight diagnostics for restricted environments, and keeps `Kimi Code Web` / `Kimi Chat` from refreshing when switching split view or swapping pane order.

## Main Changes

1. More reliable Windows install detection
- Unified Windows install probing for `Git`, `Node.js`, `uv`, `Python 3.13`, and `Kimi CLI` around explicit candidate paths.
- Managed install steps now verify installed tools through resolved executable paths instead of assuming the current PowerShell session already picked up updated PATH entries.
- External `Git` and `Node.js` installs now trigger automatic re-checks after the elevated terminal launches.

2. Configurable mirror sources
- Added persisted install-source settings in the app.
- Mirror mode now supports built-in presets for mixed, TUNA, and Aliyun sources.
- Added an advanced custom mirror editor for Git release pages, uv release pages, Python installer URLs, and PyPI indexes.
- Copied install commands and executed install commands are now generated from the same mirror configuration.

3. PowerShell preflight and restricted-environment handling
- Added PowerShell preflight diagnostics that collect execution-policy state, language mode, and a smoke test before install work starts.
- Install sessions now surface PowerShell diagnostic summaries directly in the install flow.
- When `.ps1` execution is blocked, the app can retry managed install steps through inline PowerShell command mode.
- Execution-policy guidance is now shown only for confirmed execution-policy failures, using the safer `CurrentUser` scope recommendation.

4. Workspace split/swap persistence fix
- Fixed the workspace split-view and swap-pane actions so they no longer reorder the embedded iframe mount tree.
- `Kimi Code Web` and `Kimi Chat` now stay mounted while toggling single view, split view, and pane order, matching the existing no-refresh workspace switching behavior more closely.
- The split divider remains part of the workspace tree and is only visually hidden in single-pane mode, reducing unnecessary embedded-page reloads during layout changes.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.19_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.19_x64_en-US.msi`

## Verification

- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests`
- `pnpm -C apps/kimi-shell build`
- `pnpm -C apps/kimi-shell tauri build`
