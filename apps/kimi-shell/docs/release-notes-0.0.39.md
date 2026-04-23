# Kimi Desktop Shell Release Notes

Version: `v0.0.39`  
Release date: `2026-04-23`

## Highlights

This release tightens desktop release hygiene, fixes auth-mode semantics, and makes Provider API setup dramatically simpler for non-technical users. It also improves startup resilience and keeps older installed builds compatible with the current bundled-skill layout.

## What's New

1. **Provider API setup is now a guided Kimi-only flow**
- The Control Center `Provider API` entry no longer drops users straight into the advanced config editor.
- Kimi setup now asks for only one `API Key`, shows the endpoint as a fixed read-only `Kimi Coding Plan` target, and writes the full normalized Kimi template automatically.
- `保存` and `设为默认` are now separate actions, so users can save credentials without immediately switching the active auth path.

2. **Auth status now distinguishes Kimi Login from Provider API**
- Runtime auth mode now prefers a verified `Kimi 登录` session and falls back to configured Provider API credentials only when login is not verified.
- Added a dedicated `provider_api_health` status, so Provider API failures no longer appear as if the Kimi login session itself expired.
- The Control Center auth card now shows separate health, source, timestamp, summary, and a direct `退出登录` action for Kimi login.

3. **Desktop release artifacts are hardened against workspace-path leakage**
- Packaged bridge and bundled-skill resolution now defaults to packaged resources or explicit environment overrides instead of silently falling back to workspace dev paths.
- Public build scripts now inject `-trimpath` / `--remap-path-prefix` and run release-artifact path scans.
- Added release verification scripts for tracked markdown and public artifacts so absolute workspace paths are less likely to leak into shipped output.

4. **Startup and install flows are more resilient**
- Prefill startup timing no longer freezes while the app is transitioning into the main window, and the total startup timeout is now more forgiving on slower machines.
- The install flow keeps mirror health visible, supports uninstall, and uses corrected default mirror presets.
- Older installed builds that still use the legacy `_up_/_up_/_up_/skills` resource layout can now recover bundled skills without requiring a reinstall.

## Notes

- This release focuses on operational clarity, packaging safety, and auth reliability rather than broad UI expansion.
- Manual installed-build smoke testing is still recommended for:
  - startup transition from prefill to main window
  - auth-mode switching between `Kimi 登录` and `Provider API`
  - simplified Kimi API setup
  - installed bridge / bundled-skill resource loading

## Installers

- NSIS: `Kimi Desktop Shell_0.0.39_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.39_x64_en-US.msi`

## Verification

- Release-cycle checks used for this version:
  - `pnpm -C apps/kimi-shell exec tsc --noEmit`
  - `pnpm -C apps/kimi-shell build`
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
  - `pnpm -C apps/kimi-shell clean:public-build-artifacts`
  - `pnpm -C apps/kimi-shell verify:tracked-markdown:no-abs-paths`
  - `pnpm -C apps/kimi-shell tauri:build:webview:evergreen`

- Known local limitation during this release cycle:
  - Direct execution of Rust test binaries on this Windows machine still fails with `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`. Rust code and tests compile successfully, but runtime test execution could not be completed locally in this environment.
