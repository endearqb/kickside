# Kimi Desktop Shell Release Notes

Version: `v0.0.18`  
Release date: `2026-03-12`

## Highlights

This release focuses on the install and upgrade experience inside the app. Kimi Desktop Shell now keeps the full install flow in Control Center with a managed PowerShell console, clearer dependency status, safer upgrade behavior on Windows, and a direct restart path after CLI upgrades.

## Main Changes

1. In-app install and upgrade console
- Added a managed install task system in the Tauri backend with task catalog, session snapshots, bounded logs, cancel support, and frontend streaming through `Channel`.
- Replaced the old command-only install popup with a unified install flow modal that shows environment status, quick core install, step-by-step tasks, and a live console.
- Unified displayed commands and executed commands under the same task definitions, so copyable commands match the real execution path.

2. Smarter environment gating and clearer feedback
- Install buttons are now enabled only when the corresponding dependency is missing.
- `Upgrade Kimi CLI` is available only when Kimi CLI is already installed.
- Failure summaries now surface the step name, exit code, and the most useful stderr/stdout detail instead of leaving users with only the PowerShell banner.

3. Safer Kimi CLI upgrade flow on Windows
- `Upgrade Kimi CLI` now uses pure `uv tool upgrade kimi-cli` semantics.
- The app backend is stopped before upgrade so `kimi.exe` is not locked during file replacement.
- After upgrade completes, Control Center remains available and offers a direct `Restart Backend` action.
- Version verification now uses `kimi --version`, which matches the current CLI behavior.

4. Install scope cleanup
- `Quick Core Install` now covers `uv`, `Python 3.13`, and `Kimi CLI`.
- `Git` and `Node.js` remain optional enhancement tasks and continue to use the external elevated fallback path when needed.
- Install probe status now distinguishes `winget`, `core ready`, and optional tools more clearly.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.18_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.18_x64_en-US.msi`

## Verification

- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager::tests`
- `pnpm -C apps/kimi-shell build`
- `pnpm -C apps/kimi-shell tauri build`
