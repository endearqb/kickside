# Kimi Desktop Shell v0.0.37

Released: `2026-04-13`

## Highlights

- Added workspace import flows from Windows Explorer without forcing a backend restart or session switch.
- Added Feishu streaming replies in IM Bridge, with safe fallback to final interactive replies if patching fails.
- Added Weixin generating-state delivery (`typing / GENERATING -> final`) and exposed per-connector reply renderer settings for Feishu.

## Improvements

- Split Explorer context-menu behavior between cold-start open and in-app workspace import.
- Moved the workspace picker into a dedicated lightweight window and tightened the layout for large workspace lists.
- Cleaned up IM Bridge connector panels by removing extra explanatory copy and hiding “no recent error” placeholders when there is no actual error.

## Compatibility

- Existing bridge settings and connector secrets remain compatible.
- Legacy Feishu reply-card settings continue to normalize correctly and are not overwritten by the new `streaming` default.

## Validation

- `go test ./...` in `apps/kimi-im-bridge`
- `pnpm -C apps/kimi-shell exec tsc --noEmit`
- `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
