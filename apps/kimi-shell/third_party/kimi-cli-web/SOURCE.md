# MoonshotAI/kimi-cli Web Source

- Repository: https://github.com/MoonshotAI/kimi-cli.git
- Upstream path: `web/`
- Commit: `e32568cf2db0e95ad76878a4e6482986c8ecb180`
- License: Apache-2.0
- Source strategy: upstream snapshot plus local patch/overlay
- Synced at: 2026-04-24 22:27:08 +08:00

This directory stores an upstream Web source snapshot for source-level i18n and patch review. The current runtime loads the official Kimi runtime URL directly and uses `src-tauri/src/frame_workspace_bridge.js` for bounded desktop integration; this snapshot is not the runtime DOM authority. Local changes should live in `patches/kimi-web/` or in explicit overlay files, not directly inside the upstream snapshot.
