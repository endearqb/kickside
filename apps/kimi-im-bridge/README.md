# Kimi IM Bridge

Kimi IM Bridge is a local Go sidecar managed by `apps/kimi-shell`.

Phase 0 and Phase 1 provide:

- CLI flags for shell-managed config, secret, database, log, and admin token paths
- Loopback-only admin API
- SQLite persistence for channels, bindings, offsets, sessions, approvals, and delivery events
- Binding router and idempotency helpers

Runtime SDK integration and IM adapters are intentionally deferred to later phases.
