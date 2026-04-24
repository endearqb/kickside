# Kimi Desktop Shell Release Notes

Version: `v0.0.42`  
Release date: `2026-04-25`

## Highlights

This release establishes a tracked upstream `kimi-cli/web` source baseline for future source-level maintenance, expands the local enhanced Web same-origin injection to cover the main fixed UI paths in Chinese, and keeps the current runtime boundary stable by continuing to use the official workspace proxy instead of switching to a local Web fork.

## What's New

1. **The enhanced Web now has a real upstream source baseline**
- `MoonshotAI/kimi-cli` `web/` is now synchronized into `third_party/kimi-cli-web/upstream-web/` at recorded commit `e32568cf2db0e95ad76878a4e6482986c8ecb180`.
- `SOURCE.md`, `manifest.json`, and third-party notices now stay aligned with the synced upstream commit.
- Added maintainer guidance and patch-boundary docs so future local deltas stay in `patches/kimi-web/` or explicit overlays instead of mutating the upstream snapshot directly.

2. **Chinese injection coverage now reaches the main fixed UI paths**
- The same-origin enhanced injection still uses a single script entry inside the workspace proxy, but the translation table is now grouped by page area instead of a flat ad-hoc list.
- Added fixed Chinese UI coverage for sessions/sidebar actions, create-session dialog copy, message search, workspace header controls, approval dialog controls, toast titles, and the front-end error boundary.
- The injection still only targets fixed text nodes plus `placeholder`, `aria-label`, and `title`; it does not translate user messages, model output, or server-provided payload text.

3. **The runtime boundary stays intentionally conservative**
- `官方 Web` / `本地增强版` behavior and Tauri command interfaces are unchanged.
- Enhanced mode still runs through the existing workspace proxy and same-origin injection path; this release does not switch to loading a locally built upstream `web/` bundle.
- Dynamic question / approval payload content remains outside the current i18n scope to avoid brittle rule growth.

4. **Release state now lands on version 0.0.42**
- `package.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json` are synchronized to `0.0.42`.
- This release bundles the upstream-baseline work and the second injection expansion pass together.

## Notes

- This release is intentionally a “full injection” follow-up, not a source-level i18n fork.
- If future Chinese coverage starts needing many variable sentences or complex DOM-structure rules, the next phase should stop expanding injection and move those areas to source-level patches instead.
- `官方 Web` remains the stable fallback, and the local enhanced experience still keeps official auth, backend, stream, billing, and permission semantics unchanged.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.42_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.42_x64_en-US.msi`

## Verification

- Release-cycle checks used for this version:
  - `pnpm --dir apps/kimi-shell check:enhanced-web:i18n`
  - `pnpm --dir apps/kimi-shell check:enhanced-web:compliance`
  - `pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`
  - `pnpm --dir apps/kimi-shell exec tsc --noEmit`
  - `pnpm --dir apps/kimi-shell build`
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
  - `git diff --check`

- Known local limitations during this release cycle:
  - Direct execution of Rust test binaries on this Windows machine still fails with `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`. Rust code and tests compile successfully, but runtime test execution could not be completed locally in this environment.
  - A full installed-app UI click regression was not completed during this release note pass; manually recheck sessions/sidebar Chinese labels, create-session dialog, message search, approval dialog, and error-boundary copy in the packaged app.
