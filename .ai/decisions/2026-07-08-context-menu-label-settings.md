# Context Menu Label Settings

## Status

Accepted

## Decision

- Store editable Explorer context-menu labels as an additive `AppSettings.context_menu_labels` field.
- Keep existing context-menu Tauri commands stable; add `save_context_menu_labels` for label persistence and optional re-apply when the menu is enabled.
- Load old settings through serde defaults and bump the settings schema version to 8.

## Rationale

- Labels must persist when the user edits them, and `AppSettings` is the existing small local settings store for shell preferences.
- A separate store or registry-only storage would add more code without improving compatibility.

## Consequences

- Existing settings files load with default labels.
- Future removal or rename of label fields must keep a compatible load path.
