# Kimi Sidekick

[中文说明](README_zh.md)

Kimi Sidekick is an MIT-licensed desktop shell around Kimi Code Web for Windows and
Apple Silicon macOS (macOS 13+).
The main deliverable is `apps/kimi-shell`, a `Tauri v2 + React` desktop application that
combines startup handoff, install and upgrade flows, a multi-tab control center, IM Bridge
operations, diagnostics, and platform-specific packaging into one workspace-oriented app.

## Repository Layout

- `apps/kimi-shell`: desktop app source, packaging config, screenshots, and release notes
- `tasks`: local task tracking, investigation notes, and engineering review materials

## Key Highlights

- Persistent desktop shell for `Kimi Code Web` and `Kimi Chat`, with Workspace Grid presets, resizable saved layouts, embedded external Webview panes, WebviewWindow fallback, and view switching
- Windows Explorer context-menu launch for folders, single files, and multi-file selections, creating independent sessions without restarting a running backend
- Native macOS traffic lights, App/Edit/Window menus, close-to-hide, Dock reopen, and graceful Cmd+Q
- Compact assistant settings with app self-update, platform-aware install guidance, read-only authentication/API health, Kimi Code Web settings guidance, default work directory, and IM channels
- Windows-managed Kimi Code install/upgrade plus macOS guided install and in-app upgrade of the located native executable
- Unified Control Center for overview, quick setup, runtime diagnostics, and IM Bridge operations
- IM Bridge workspace with Feishu-focused controls for channel status, work directory, approvals, and session switching
- Platform-native window lifecycle, tray behavior, diagnostics access, and NSIS/MSI/app/DMG outputs
- Signed, user-confirmed desktop self-updates from GitHub Releases

## What The App Does

- Launches and monitors the local `kimi-code` server runtime
- Shows a prefill/startup surface before handing off to the main workspace
- Keeps `Kimi Code Web`, `Kimi Chat`, and additional grid panes mounted inside one shell, reducing refresh-heavy workflow switching
- Handles workspace bootstrap from normal launch, plus Windows Explorer open requests where supported
- Hands off folders directly as the active work directory, and copies selected files into a fresh workspace before launching the shell
- Provides onboarding, install and upgrade actions, diagnostics, logs, and runtime operations from one control surface
- Exposes IM Bridge controls for Feishu channel management, session rotation, approvals, and working-directory mapping
- Produces Windows NSIS/MSI and Apple Silicon macOS app/DMG artifacts

## App Preview

Workspace Grid keeps Kimi Code, Kimi Chat, and active sessions visible in one resizable desktop workspace:

![Kimi Sidekick six-pane Workspace Grid](apps/kimi-shell/public/workspace-grid.png)

Assistant Settings brings app updates, Kimi Code upgrades, work directories, IM channels, and diagnostics into one control surface:

![Kimi Sidekick assistant settings](apps/kimi-shell/public/assistant-settings.png)

Skill Center provides a searchable catalog for built-in and workspace skills:

![Kimi Sidekick Skill Center](apps/kimi-shell/public/skill-center.png)

Session settings and parallel panes keep model, thinking, permissions, Swarm mode, and long-running tasks close to the conversation:

![Kimi Sidekick session settings and parallel panes](apps/kimi-shell/public/workspace-session-settings.png)

## Local Development

Requirements:

- Node.js 22+
- pnpm 10.34.4
- Rust stable
- Go (version declared by `apps/kimi-im-bridge/go.mod`)
- WebView2 Runtime on Windows
- macOS 13+ on Apple Silicon; full Xcode is required for signed/notarized release builds

Common commands:

```bash
pnpm -C apps/kimi-shell install
pnpm -C apps/kimi-shell tauri dev
pnpm -C apps/kimi-shell build
pnpm -C apps/kimi-shell tauri:build:macos:local  # unsigned local .app
pnpm -C apps/kimi-shell tauri build              # release bundles; signing keys required
```

## Release Outputs

Production installer artifacts are generated under:

- `apps/kimi-shell/src-tauri/target/release/bundle/nsis`
- `apps/kimi-shell/src-tauri/target/release/bundle/msi`
- `apps/kimi-shell/src-tauri/target/aarch64-apple-darwin/release/bundle/macos`

Release notes are stored under:

- `apps/kimi-shell/docs`

Pushing a `vX.Y.Z` tag matching `apps/kimi-shell/package.json` creates a draft release, builds Windows x86_64 and macOS arm64 bundles, and publishes one signed cross-platform `latest.json`. Release `v0.1.24` is the explicitly labeled macOS ad-hoc/unsigned transition build; later releases fail closed until the normal Developer ID signing and notarization flow is restored.

## License

This repository is released under the MIT License. See `LICENSE`.
