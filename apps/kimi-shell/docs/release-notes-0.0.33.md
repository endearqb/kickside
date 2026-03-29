# Kimi Desktop Shell Release Notes

Version: `v0.0.33`  
Release date: `2026-03-29`

## Highlights

This release hardens bridge and onboarding operations for real Windows environments. The desktop shell now avoids reserved localhost ports during bridge startup, retries bridge admin bind failures more safely, and gives clearer diagnostics when Docker Desktop, WSL2, or Hyper-V networking has reserved the default port range.

## What's New

1. **Bridge Admin Port Auto-Fallback**
- Bridge startup no longer depends on the fixed `60110` admin port when using the default shell configuration.
- The shell now selects a bindable localhost admin port at startup, and it can automatically retry once with a fresh port if the bridge sidecar still exits on bind failure.
- Explicit admin-port overrides are still respected, but if the configured port is unavailable the shell now degrades to a working dynamic port instead of leaving IM Bridge unavailable.

2. **Clearer Windows Diagnostics for Port Reservation Conflicts**
- Bridge startup failures now surface a direct hint when the failure matches Windows socket reservation behavior.
- Error messages now point operators toward `excluded port range` conflicts commonly introduced by `Docker Desktop`, `WSL2`, or `Hyper-V`, instead of leaving only the raw `access permissions` socket error.
- This reduces time spent misdiagnosing bridge startup issues as generic firewall or permissions problems.

3. **Onboarding HTTP Flow Polish**
- The shared onboarding HTTP helper remains in place for Feishu and Weixin onboarding paths, with the `0.0.33` desktop shell user agent carried through the Rust-side transport.
- Existing Weixin and Feishu onboarding improvements from the current worktree remain part of this release, including clearer request structuring and Windows-native fallback coverage.

## Notes

- This release is operationally focused and is intended to improve recovery on Windows machines that also run container or virtualization stacks.
- Existing bridge data and auth files remain compatible; after startup, the generated `bridge_skill_auth.json` reflects the actual admin port chosen by the running bridge.

## Installers

- NSIS: `Kimi.Desktop.Shell_0.0.33_x64-setup.exe`
- MSI: `Kimi.Desktop.Shell_0.0.33_x64_en-US.msi`

## Verification

- Build command: `pnpm -C apps/kimi-shell tauri build`
- Expected output directories:
  - `apps/kimi-shell/src-tauri/target/release/bundle/nsis`
  - `apps/kimi-shell/src-tauri/target/release/bundle/msi`
