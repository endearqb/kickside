# MoonshotAI/kimi-cli Web Source

- Repository: https://github.com/MoonshotAI/kimi-cli.git
- Upstream path: `web/`
- Commit: `e32568cf2db0e95ad76878a4e6482986c8ecb180`
- License: Apache-2.0
- Source strategy: upstream snapshot plus local patch/overlay
- Synced at: 2026-04-24 22:27:08 +08:00

This directory stores the upstream Web source snapshot used by the Kimi App local enhanced Web experience. The current runtime still uses workspace-proxy same-origin injection; this synced snapshot exists to support future source-level i18n and patch review. Local changes should live in `patches/kimi-web/` or in explicit overlay files, not directly inside the upstream snapshot.