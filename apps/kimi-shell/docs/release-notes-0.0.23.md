# Kimi Desktop Shell Release Notes

Version: `v0.0.23`  
Release date: `2026-03-17`

## Highlights

This release expands the Feishu IM Bridge from plain text replies into a richer messaging path. Kimi Desktop Shell and the Go sidecar now support cached inbound Feishu images and files, interactive Markdown card replies by default, outbound image/file delivery, and a clearer Bridge Runtime setting for Feishu reply rendering.

## Main Changes

1. Richer Feishu IM Bridge messaging
- Added Feishu inbound `image` and `file` handling in the bridge sidecar.
- Pure attachment messages are now cached per chat/thread instead of immediately starting a turn.
- The next eligible text prompt consumes the cached attachments and forwards them into the model request.
- Added outbound Feishu `image`, `file`, and `interactive` reply delivery on the existing Go adapter path.

2. Interactive Markdown replies by default
- Normal Feishu model replies now default to `interactive + lark_md` cards.
- Long replies are automatically chunked into multiple interactive cards when needed.
- Existing command cards, onboarding cards, approval cards, and doctor cards continue to use the same interactive transport.
- `post/text` remains available as a compatibility fallback if the Feishu API rejects the preferred renderer.

3. Attachment-aware runtime plumbing
- Extended bridge-side attachment and artifact contracts across domain, runtime, bridgecore, and Kimi provider request types.
- Added staged local attachment handling so cached Feishu images can be passed as multimodal `image_url` prompt content.
- File attachments are now surfaced to the current Kimi SDK path through a staged-file manifest in the prompt text.
- Added a bridge-local `artifact_ready` event shape to support future richer model output delivery.

4. Settings and Control Center update
- Replaced the old boolean `feishuReplyCards` setting with explicit `feishuReplyRenderer`.
- Preserved backward compatibility by mapping legacy boolean settings onto the new renderer value when loading config.
- Updated the Bridge Runtime panel in Control Center to use an explicit Feishu reply renderer selector.

5. Persistence and delivery metadata
- Added an additive SQLite migration for pending inbound Feishu attachments.
- Cached attachments now persist staged path, original platform key, source message id, and expiry metadata.
- Outbound delivery records now capture renderer and delivery-kind metadata for card/image/file sends.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.23_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.23_x64_en-US.msi`

## Verification

- `go test ./...` in `apps/kimi-im-bridge`
- `cargo test --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
- `pnpm -C apps/kimi-shell build`
