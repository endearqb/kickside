# Kimi Desktop Shell Release Notes

Version: `v0.0.40`  
Release date: `2026-04-24`

## Highlights

This release makes setup actions more explicit, adds a safer default-login/API switching flow, allows users to fully remove IM Bridge connectors, and introduces the first productized `Official Web` / `Local Enhanced Web` mode for the Kimi workspace.

## What's New

1. **Install and mirror checks are now user-triggered**
- Control Center no longer runs install probes or mirror-health checks just because the onboarding view opens.
- Mirror health now runs from explicit actions such as choosing the mirror source or clicking `重新检测`.
- Install and upgrade actions use the existing probe cache and enter the install session directly, keeping startup and setup screens quieter.

2. **Kimi Login and Provider API can be selected deliberately**
- Added a `设为默认登录` action that clears the top-level Provider API default while preserving saved API templates and keys.
- The Provider API action is now labeled `设为默认 API`, making the active auth path easier to understand.
- Auth-mode evaluation now prefers Provider API only when the Kimi Coding Plan API is explicitly selected and has credentials; otherwise verified Kimi Login remains the default.

3. **IM Bridge connector deletion is less sticky**
- Users can now delete the only Feishu or Weixin connector without the settings normalizer silently recreating it.
- Connector secrets are removed together with the deleted connector.
- Delete failures now show a short user-facing message instead of leaking backend path details into the UI.

4. **Local Enhanced Web mode is now productized**
- Control Center adds a `Web 体验` card with `官方 Web` and `本地增强版` modes.
- The local enhanced mode records its upstream source commit, health state, last-known-good commit, fallback reason, and brand disclaimer.
- Added compliance and i18n checks for the enhanced Web assets and third-party notices.
- The first local enhanced entry preserves official authentication, stream, model, billing, and permission semantics while adding a desktop-managed shell around the existing workspace proxy.

## Notes

- `官方 Web` remains the default mode.
- The local enhanced experience is maintained by this application and is not an official MoonshotAI distribution or endorsement.
- The current source record for the enhanced Web work is `1e45df06da698151d2dc29a700722c37432e86ce`.
- A full installed-app UI click regression was not completed for this release note pass; manually verify Control Center mode switching and enhanced Web fallback before broadly distributing to non-technical users.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.40_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.40_x64_en-US.msi`

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
