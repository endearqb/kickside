# Kimi Desktop Shell Release Notes

Version: `v0.0.38`  
Release date: `2026-04-14`

## Highlights

This release tightens desktop control-center flows during install and upgrade, and it removes a protocol mismatch in the Weixin bridge by forcing approval-required turns onto the supported auto-approve path.

## What's New

1. **Control Center onboarding flow stays stable during upgrade**
- The install step now keeps its expanded state while a `upgrade_kimi` task is still running, so the onboarding panel no longer jumps back to a recommended card mid-upgrade.
- Entering the dedicated Control Center screen no longer resets control-center navigation unless the shell is actually leaving that screen.

2. **Top-level control-center tab switching no longer gets stuck on bridge tasks**
- Switching away from an active IM Bridge task now attempts the existing task-close path first and only blocks when the task truly cannot be closed.
- This removes the case where top navigation appeared unresponsive because the current task state was never cleared.

3. **Install detail layout is cleaner and easier to scan**
- The onboarding install detail area now uses a dedicated vertical stack for secondary actions, task content, and status metadata.
- Recent install summaries and transient install messages are grouped into one compact metadata block instead of being scattered across the step body.

4. **Weixin bridge now uses the supported approval model**
- Inbound Weixin turns now call the bridge orchestrator with `AutoApprove=true`, matching the current protocol limitation that Weixin has no in-chat approval callback path.
- Added regression coverage to ensure the Weixin adapter keeps forwarding `DefaultWorkDir` while forcing auto-approve.

## Notes

- This release is focused on operational correctness and interaction polish rather than large feature surface expansion.
- Manual desktop/UI regression is still recommended for the install and IM Bridge navigation paths before broad distribution.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.38_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.38_x64_en-US.msi`

## Verification

- Expected automated checks for this release:
  - `go test ./...` in `apps/kimi-im-bridge`
  - `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
  - `pnpm -C apps/kimi-shell build`
  - `pnpm -C apps/kimi-shell tauri build`
