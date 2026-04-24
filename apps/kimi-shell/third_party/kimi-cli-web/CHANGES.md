# Local Changes

- Added a productized `官方 Web` / `本地增强版` choice in Kimi App.
- Added a local enhanced Web wrapper that keeps official backend, authentication, stream, model, billing, and permission semantics unchanged.
- Added Chinese-first desktop shell text, theme forwarding, session/prefill message forwarding, health metadata, and fallback support.
- Added compliance metadata and release checks for source commit, Apache-2.0 notice, and brand disclaimer.
- Added an upstream `web/` snapshot baseline for future source-level i18n work while keeping the current runtime on workspace-proxy same-origin injection.
- Treat `third_party/kimi-cli-web/upstream-web/` as read-only upstream code; all local deltas must live in `patches/kimi-web/` or explicit overlay files.

The local enhanced experience is maintained by this application and is not an official MoonshotAI distribution or endorsement.
