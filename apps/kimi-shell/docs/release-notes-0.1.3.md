# Kimi Sidekick Release Notes

Version: `v0.1.3`  
Release date: `2026-06-30`

## Update Summary

This release summarizes the main changes from `v0.0.43` to `v0.1.3`.

- The app identity has been consolidated as `Kimi Sidekick` / `kimi 小助手`, with matching desktop titles, installer naming, package metadata, and README references.
- The workspace shell has moved from a single embedded work area to a persistent Workspace Grid with saved layouts, resizable panes, native WebView storage isolation, external WebView fallback, and a slimmer titlebar.
- Kimi Code access is now managed through the shell, including workspace-oriented access settings, runtime session bridging, and more focused Control Center entry points.
- External IM and bridge operations have been folded into the main shell flow, while the old standalone local `bridge-ops` skill files were removed.
- The UI has been simplified around the active workspace: less shell chrome, lighter internal panels, cleaner icon buttons, and tighter pane/window alignment.
- Version metadata is synchronized at `0.1.3` across the frontend package, Tauri config, Cargo package, and lockfile.

## Installers

- NSIS: `kimi小助手_0.1.3_x64-setup.exe`
- NSIS: `kimi sidekick_0.1.3_x64-setup.exe`
- MSI: `kimi小助手_0.1.3_x64_zh-CN.msi`
- MSI: `kimi sidekick_0.1.3_x64_en-US.msi`

