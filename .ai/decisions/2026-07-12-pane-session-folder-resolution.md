# Pane Session Folder Resolution

## Status

Accepted

## Decision

- Treat the current Code iframe route, not persisted `WorkspacePane.sessionId/workDir`, as the authority for the pane header folder action.
- Use a parent/iframe `postMessage` handshake that carries only `sessionId`, `requestId`, status, and reason. The parent derives pane ownership from the exact iframe `WindowProxy` and workspace origin.
- Add the main-window-only `grid_get_session(sessionId)` Tauri command, backed by exact `GET /api/v1/sessions/{id}` lookup and the existing `WorkspaceSessionRecord` response.
- Confirm the iframe session again after resolving its work directory. Any mismatch or failure closes the action without a cached-path fallback.

## Rationale

- Kimi Web can switch sessions inside an iframe without updating the Shell's persisted pane snapshot.
- `grid_list_sessions` is capped at 100 records and cannot reliably resolve an arbitrary current session.
- Keeping observed session state transient avoids iframe reloads caused by changing the persisted session URL/key.

## Consequences

- The folder tooltip no longer displays a potentially stale path.
- `pane.workDir` remains historical Grid metadata but is not authoritative for this action.
- Future non-iframe Code carriers must provide an equivalent authenticated session handshake before exposing the action.

## Verification

- Frontend bridge/component tests, Shell command-registry gate, Rust G0/G1 gates, and Windows multi-pane manual verification.
