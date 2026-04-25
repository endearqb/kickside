# Kimi Desktop Shell Release Notes

Version: `v0.0.43`  
Release date: `2026-04-25`

## Highlights

This release continues the proxy-injected Chinese enhancement path for the official Kimi Web, expands the fixed-text coverage into the chat work area and brand header, and tightens the Control Center install flow by moving common dependency actions into the primary action area.

## What's New

1. **Enhanced Web Chinese injection now covers more in-chat system UI**
- Extended the same-origin injection table to cover fixed labels inside the chat workspace, including `Thought`, tool action labels such as `Edit` / `Read` / `Search`, activity states, prompt-composer helper text, session context-menu labels, and context-usage copy.
- Added limited dynamic sentence matching for only three stable patterns: `Thought for {n}s`, `{percent}% context`, and `{n} selected`.
- Kept the injection boundary narrow: paths, URLs, tool parameters, approval payload descriptions, question payload content, model output, and user-authored message content are still not translated.

2. **The top-left Kimi Web brand title is now localized in enhanced mode**
- The visible `Kimi Code` title in the upstream brand component is now injected as `Kimi 小助手`.
- The black `K` logo image, version text, brand link target, and accessibility attributes remain unchanged.
- This is intentionally a display-name override, not a full brand-system rename.

3. **Control Center install flow is faster for common dependency actions**
- Added dedicated `安装 Git` and `安装 Node.js` quick-action buttons directly under the main install/upgrade buttons.
- Removed the duplicate optional-enhancement block from the detailed options section to reduce repetition.
- Mirror-source detection is now user-triggered instead of auto-running when switching tabs, and the mirror strategy card is hidden when the official source tab is active.

4. **Release state now lands on version 0.0.43**
- `package.json`, `Cargo.toml`, `Cargo.lock`, and `tauri.conf.json` are synchronized to `0.0.43`.
- This release bundles the third-stage injection expansion, the brand-title localization, and the install-flow polish together.

## Notes

- Enhanced mode still runs through the existing workspace proxy and same-origin injection path; this release does not switch to a locally built upstream `web/` bundle.
- Chinese coverage continues to target fixed UI and a very small number of constrained dynamic patterns. If future requirements demand broader variable-sentence translation, that work should move to source-level patches instead of expanding injection indefinitely.
- Official authentication, backend protocol, stream semantics, billing, and permission behavior remain unchanged.

## Installers

- NSIS: `Kimi Desktop Shell_0.0.43_x64-setup.exe`
- MSI: `Kimi Desktop Shell_0.0.43_x64_en-US.msi`

## Verification

- Release-cycle checks used for this version:
  - `pnpm --dir apps/kimi-shell check:enhanced-web:i18n`
  - `pnpm --dir apps/kimi-shell check:enhanced-web:compliance`
  - `pnpm --dir apps/kimi-shell verify:tracked-markdown:no-abs-paths`
  - `pnpm --dir apps/kimi-shell exec tsc --noEmit`
  - `pnpm --dir apps/kimi-shell build`
  - `cargo check --manifest-path apps/kimi-shell/src-tauri/Cargo.toml`
  - `git diff --check`

- Known local limitations during this release cycle:
  - Direct execution of Rust test binaries on this Windows machine still fails with `0xc0000139 (STATUS_ENTRYPOINT_NOT_FOUND)`. Rust code and tests compile successfully, but runtime test execution could not be completed locally in this environment.
  - A full installed-app UI click regression was not completed during this release note pass; manually recheck the localized brand title, in-chat fixed Chinese labels, session context menu, context-usage pill, and the Control Center install flow in the packaged app.
