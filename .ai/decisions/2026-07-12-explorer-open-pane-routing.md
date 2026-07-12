# Explorer Open Pane Routing

## Status

Accepted

## Decision

- Persist the user's Explorer context-menu enable/disable intent in `AppSettings` schema 10. Existing settings default to enabled; disabling also removes stale owned registry keys.
- Keep the existing Tauri command names stable. Registry commands add the `--` path separator, remove overlapping `AllFilesystemObjects` registrations, and notify Explorer after changes.
- Route Explorer open requests through one bounded FIFO worker and the existing `/api/v1` workspace/session client. A running backend is not restarted and global cwd is not changed.
- Extend the additive workspace-session payload with `disposition` and `targetWindowLabel`; Explorer requests use `new_pane`, legacy events retain `replace_active`.
- Keep six visible Grid slots and allow up to twelve persisted panes. A seventh pane replaces the active slot while the displaced pane remains in the Pane Shelf. At twelve, replacement requires explicit confirmation.

## Rationale

- Restarting the shared backend breaks unrelated panes and loses in-flight UI state.
- The existing Pane/Slot split already represents hidden panes, so a second reducer or pane model is unnecessary.
- Persisted intent is required for a user-visible disable action to survive startup self-heal.

## Compatibility

- Missing schema-10 fields load through existing serde defaults; known historical copy labels migrate without changing custom labels.
- Missing payload disposition keeps replacement semantics, except known Explorer sources which use the safer new-pane behavior.
- Grid state remains version 1 because its shape is unchanged; loading now accepts at most twelve panes and still sanitizes slots and active/maximized ids.

## Verification

- Shell Rust G0/G1 gates, frontend typecheck/tests, and Windows Explorer manual checks from `.ai/architecture/verification-gates.md`.
