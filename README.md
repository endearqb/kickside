# Kimi App

Kimi App is an MIT-licensed repository for the Windows desktop shell around Kimi Web.
The main deliverable is `apps/kimi-shell`, a Tauri v2 + React application that packages
startup flow, workspace handoff, diagnostics, and Windows installers into a single app.

## Repository Layout

- `apps/kimi-shell`: desktop app source, packaging config, and release notes
- `tasks`: local task tracking and engineering review notes for this repository

## What The App Does

- Launches and monitors the local Kimi Web backend
- Shows a prefill/startup surface before handing off to the main workspace
- Handles workspace bootstrap from normal launch and Windows Explorer open requests
- Provides diagnostics, logs, and onboarding/install helpers
- Produces Windows installer artifacts in NSIS and MSI formats

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
