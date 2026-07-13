# Kimi Config Optimistic Revision Contract

## Status

Accepted

## Decision

- `load_kimi_code_access_config` returns an optional opaque `configFingerprint` computed from the same raw `config.toml` snapshot used to build the view.
- `save_kimi_code_access_config` accepts an optional `expectedConfigFingerprint`; when present, a mismatch rejects the save with `config_conflict:` before changing the file.
- Every save rechecks the source revision immediately before replacement and before each retry. Only `NotFound` maps to the missing-file revision.
- Callers that omit the optional revision remain compatible, but receive only the save-window recheck rather than panel-open stale-edit detection.

## Rationale

- Kimi Code and the Shell can both replace `config.toml`; a long-lived settings draft must not silently overwrite an external edit.
- An opaque revision keeps TOML contents and secrets out of the public command contract while allowing the UI to detect stale drafts.
- File locks would not protect against writers that do not participate in the same locking protocol.

## Consequences

- A conflict preserves the external file and the user's in-memory draft; the user must reload the panel before saving again.
- The final revision check and atomic replacement still have a very small race window because Kimi Code does not provide a compare-and-swap API.
- Saves remain non-restarting and apply to subsequently created or reopened sessions.

## Verification

- Rust tests cover stale, missing, pre-commit change, retry, backup, and cleanup behavior.
- Frontend tests cover revision propagation and conflict draft preservation.
- Shell G0/G1 and a manual concurrent-writer regression are required before release.
