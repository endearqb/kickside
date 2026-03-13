# Kimi IM Bridge 发布清单

## 适用范围

- This checklist is version-agnostic.
- It covers the bridge sidecar, shell packaging, automated verification, and manual gate evidence.
- It does not imply a version bump by itself.

## 构建命令

1. `go test ./...` in `apps/kimi-im-bridge`
2. `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
3. `pnpm -C apps/kimi-shell build`
4. `pnpm -C apps/kimi-shell tauri build`

## 预期构建产物

- Sidecar binary:
  - `apps/kimi-shell/src-tauri/binaries/kimi-im-bridge.exe`
  - `apps/kimi-shell/src-tauri/target/release/binaries/kimi-im-bridge.exe`
- Desktop bundles:
  - `apps/kimi-shell/src-tauri/target/release/bundle/nsis/Kimi Desktop Shell_<version>_x64-setup.exe`
  - `apps/kimi-shell/src-tauri/target/release/bundle/msi/Kimi Desktop Shell_<version>_x64_en-US.msi`

## Sidecar 资源检查

- Confirm `tauri.conf.json` includes `bundle.resources` for `binaries`.
- Confirm WiX staging includes `binaries\kimi-im-bridge.exe`.
- Confirm NSIS staging includes `binaries\kimi-im-bridge.exe`.
- Do not accept a release if the sidecar exists only in `apps/kimi-im-bridge/bin` or another dev-only path.

## 自动化验证闸门

- `go test ./...` passed
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml` passed
- `pnpm -C apps/kimi-shell build` passed
- `pnpm -C apps/kimi-shell tauri build` passed

以上任一失败都属于发布阻塞项。

## 手工证据清单

- Telegram:
  - private chat multi-turn
  - approval request and resolve
  - invalid token classification
  - restart dedupe / offset recovery
- Feishu:
  - direct message
  - group mention / summon
  - thread routing
  - approval action
  - invalid credentials classification
  - reconnect dedupe / checkpoint recovery
- Control Center:
  - pending approvals list and resolve
  - `bridge.log` tail
  - `recent errors`
  - secrets mask only, no plaintext leak
- Installed build:
  - install succeeds
  - bundled sidecar exists
  - configuration succeeds
  - `Start` / `Stop` / `Restart` works
  - release runtime does not depend on workspace dev path

手工证据的唯一事实来源是 `docs/kimi-im-bridge-manual-test-runbook.md`。

## 发布阻塞项

- Any automated verification failure
- Missing sidecar resource in installer staging
- Real Telegram or Feishu critical path unverified
- Installed-build smoke not executed
- Runbook contains `Blocked` or `Partial` on a release-critical case without a conscious waiver

## 当前状态快照（2026-03-13）

- 自动化验证：已就绪
- Sidecar 打包证据：已就绪
- 统一手工闸门：受当前工作站缺少 Telegram / 飞书凭证和安装版点击验证所阻塞
