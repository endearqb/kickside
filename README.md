# Kimi App

[中文说明](README_zh.md)

Kimi App is an MIT-licensed repository for the Windows desktop shell around Kimi Web.
The main deliverable is `apps/kimi-shell`, a Tauri v2 + React application that packages
startup flow, workspace handoff, diagnostics, and Windows installers into a single app.

## Repository Layout

- `apps/kimi-shell`: desktop app source, packaging config, and release notes
- `tasks`: local task tracking and engineering review notes for this repository

## What The App Does

- Launches and monitors the local Kimi Web backend
- Shows a prefill/startup surface before handing off to the main workspace
- Keeps `Kimi Code Web` and `Kimi Chat` side by side, with persistent view switching and split panes
- Handles workspace bootstrap from normal launch and Windows Explorer open requests
- Provides diagnostics, logs, onboarding/install helpers, and a control center for runtime operations
- Produces Windows installer artifacts in NSIS and MSI formats

## App Preview

Main workspace with the persistent Code/Chat shell:

![Kimi Desktop Shell workspace](apps/kimi-shell/public/home.png)

Control center for runtime status, restart, work directory, and diagnostics entry points:

![Kimi Desktop Shell control center](apps/kimi-shell/public/control_center.png)

## Local Development

Requirements:

- Node.js 18+
- pnpm 8+
- Rust stable
- WebView2 Runtime on Windows

Common commands:

```bash
pnpm -C apps/kimi-shell install
pnpm -C apps/kimi-shell tauri dev
pnpm -C apps/kimi-shell build
pnpm -C apps/kimi-shell tauri build
```

## Release Outputs

Production installer artifacts are generated under:

- `apps/kimi-shell/src-tauri/target/release/bundle/nsis`
- `apps/kimi-shell/src-tauri/target/release/bundle/msi`

Release notes are stored under:

- `apps/kimi-shell/docs`

## License

This repository is released under the MIT License. See `LICENSE`.
