# Kimi Web Local Patches

This directory stores local patches against `third_party/kimi-cli-web/upstream-web/`.

- Do not edit the upstream snapshot in place.
- Keep each patch focused and reviewable.
- Runtime-only integration code belongs in explicit overlay files or workspace-proxy injection, not in the upstream snapshot.
