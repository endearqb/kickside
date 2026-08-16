# Kimi Web Local Patches

This directory stores local patches against `third_party/kimi-cli-web/upstream-web/`.

- Do not edit the upstream snapshot in place.
- Keep each patch focused and reviewable.
- Runtime-only all-frame integration belongs in `src-tauri/src/frame_workspace_bridge.js`; the retired workspace-proxy injection is compatibility code and must not receive new product behavior.
