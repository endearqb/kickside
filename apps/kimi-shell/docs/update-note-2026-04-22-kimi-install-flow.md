# Kimi Desktop Shell Update Note

Date: `2026-04-22`  
Status: `unreleased draft`

## Summary

This update tightens the Control Center install flow for Kimi CLI. The page now stays focused on state and actions, adds a direct uninstall path, and surfaces mirror health so users can see whether the current source chain is usable before they start an install or upgrade.

## Changes

1. **Install page copy is shorter and easier to scan**
- The main install area now keeps only the core actions and compact status context.
- Repetitive helper copy under the action buttons was removed to reduce noise.

2. **Main action area now supports uninstall**
- Added a destructive `卸载 Kimi CLI` action inside the primary operation area.
- Uninstall uses a confirmation dialog and only removes `kimi-cli`; it keeps `uv` and Python 3.13 in place.
- Upgrade and uninstall both stop the backend first when needed, so `kimi.exe` is not left locked by the running app.

3. **Mirror strategy is corrected and observable**
- Replaced broken default mirror entries in the mixed preset with curated working sources.
- Added a new `ustc` preset and kept legacy `aliyun` values compatible by migrating them to `mixed`.
- The install source area now shows a compact health summary, and the mirror strategy area shows per-category health cards for Git, uv, Python, and PyPI.

4. **Health checks are now part of the install flow**
- Release-page checks verify that the page is reachable and still exposes expected release assets.
- Python installer checks accept healthy `HEAD` or `GET` responses.
- PyPI checks require a valid HTML index response instead of only a bare HTTP 200.

## Verification

- `pnpm -C apps/kimi-shell build`
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml --no-run`

## Notes

- Running `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml install_manager` on this Windows machine still exits with `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)` when the compiled test binary starts. The Rust code and tests compile successfully; the remaining failure is this machine's runtime environment.
- Manual desktop click-through verification is still recommended for the uninstall action, mirror health cards, and post-uninstall control-center state refresh.
