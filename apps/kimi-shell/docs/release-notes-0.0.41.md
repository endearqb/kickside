# Kimi Desktop Shell Release Notes

Version: `v0.0.41`  
Release date: `2026-04-24`

## Highlights

This release turns the local enhanced Web experience from an outer wrapper into same-origin workspace injection, fixes mode switching so the workspace actually reloads, and splits the large backend manager into focused modules without changing the public Tauri API.

## What's New

1. **Local Enhanced Web now runs inside the workspace proxy**
- The workspace no longer loads an extra wrapper page around the official Web surface.
- Enhanced mode now keeps the same workspace proxy URL and injects local enhancements into the HTML response.
- The first injection pass localizes high-frequency empty-state, search, session, archived, and new-session labels, then applies small scoped desktop styling improvements.

2. **Switching Web modes now reloads reliably**
- The workspace iframe load identity now includes the remote URL, Web mode, and a reload token.
- Switching between `官方 Web` and `本地增强版` remounts the iframe, which forces a fresh HTML request and lets the proxy apply or remove injection.
- Manual and automatic fallback to official Web also remounts the workspace frame, avoiding stale enhanced DOM and stuck loading overlays.

3. **Backend manager code is split into focused modules**
- `backend_manager.rs` is now a small facade instead of a 5,000+ line implementation file.
- Responsibilities moved into `backend_manager/config.rs`, `install_compat.rs`, `lifecycle.rs`, `system_open.rs`, `workspace_proxy.rs`, and `workspace_injection.rs`.
- Public command names, exported APIs, workspace proxy behavior, install compatibility behavior, and tests are preserved.

4. **Release state now lands on version 0.0.41**
- `package.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json` are synchronized to `0.0.41`.
- The current release includes both the enhanced-Web follow-up fix and the backend module split.

## Notes

- This release is a follow-up to `v0.0.40`: users who tried local enhanced mode and saw unchanged content or a loading overlay should use `v0.0.41`.
- `官方 Web` remains the stable fallback, and enhanced mode can still auto-fallback if loading is blocked.
- Because `backend_manager` was split into modules, manually recheck startup, workspace proxy loading, config-center auth operations, and install compatibility paths before broad rollout.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.41_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.41_x64_en-US.msi`

## Verification

- Release-cycle checks used for this version:
  - `pnpm --dir apps/kimi-shell check:enhanced-web:i18n`
  - `pnpm --dir apps/kimi-shell check:enhanced-web:compliance`
  - `pnpm --dir apps/kimi-shell exec tsc --noEmit`
  - `pnpm --dir apps/kimi-shell build`
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
  - `cargo fmt --manifest-path apps/kimi-shell/src-tauri/Cargo.toml -- --check`
  - `git diff --check`

- Known local limitation during this release cycle:
  - Direct execution of Rust test binaries on this Windows machine still fails with `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`. Rust code and tests compile successfully, but runtime test execution could not be completed locally in this environment.
  - A full installed-app UI click regression was not completed for this release note pass.
