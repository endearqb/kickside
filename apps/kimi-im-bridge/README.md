# Kimi IM Bridge

Kimi IM Bridge is a local Go sidecar managed by `apps/kimi-shell`.

Phase 0 and Phase 1 provide:

- CLI flags for shell-managed config, secret, database, and log paths
- Admin token transport through `KIMI_IM_BRIDGE_ADMIN_TOKEN` or `KIMI_IM_BRIDGE_ADMIN_TOKEN_FILE`; `--admin-token` remains a deprecated fallback only
- Host-control token transport through `KIMI_IM_BRIDGE_HOST_CONTROL_TOKEN` or `KIMI_IM_BRIDGE_HOST_CONTROL_TOKEN_FILE`; `--host-control-token` remains a deprecated fallback only
- Shell-provided kimi-code runtime locator through `--kimi-runtime-locator` or `KIMI_APP_RUNTIME_LOCATOR_FILE`
- Runtime adapter status in the admin status payload; the current server adapter reads the locator and token file at request time
- `KimiCodeServerAdapter` for `/api/v1` workspace, session, prompt submit, prompt event streaming, approval, and prompt abort calls
- Server pending approval reconcile against `/api/v1/sessions/{id}/approvals?status=pending`
- Experimental `ACPAdapter` for stdio JSON-RPC smoke coverage of `initialize`, `session/new`, `session/resume`, `session/prompt`, `session/cancel`, and live async manual approval resolution
- `SDKAdapter` wrapper around the existing SDK driver, session registry, and live approval coordinator
- Server-backed Bridge provider selection when the shell supplies a readable kimi-code runtime locator, with SDK-backed fallback when no locator is configured
- Channel prompt routing through `bridgecore.Orchestrator` so Telegram, Feishu, and Weixin can use real server session ids instead of newly minted synthetic session ids
- Per-connector `defaultWorkDir` for Telegram, Feishu, and Weixin, with the bridge-level `defaultWorkDir` retained as the legacy fallback; `resetBindingSessionOnStart` is preserved losslessly for the Rust/Go settings contract
- Explicit Server session modes `if_missing`, `always`, `resume_exact`, and `reuse_latest`; new IM bindings use `always`, existing binding recovery uses compatibility `if_missing`
- Store-enforced IM binding isolation: one Kimi Session can belong to only one robot binding across all connectors
- Shared `bridgecore.ExecutionService` for Turn/Runtime/Event/Approval/Session execution; IM orchestration retains connector binding, duplicate inbound handling, and real-session rebind, while future Room callers receive target-aware projection events without Connector secrets
- Agent Room schema v19 remains as inert legacy data. Migration 0014–0019, approval links, turn origins and existing rows are retained without downgrade, DROP, automatic deletion or Connector prune.
- Agent Room is retired: `KIMI_AGENT_ROOM_ENABLED` is ignored, `Options.AgentRoomEnabled` is normalized to false, and production startup never mounts `/api/v1/agent-room/*`, recovers its queue, or starts its observer.
- Shared Session execution guard with owner-conditional 30-second leases, 10-second heartbeats, Runtime busy checks, and a per-Session local FIFO queue capped at 50; unknown strict Runtime state and unconfirmed abort both fail closed
- Connector/Agent bindings are independent from IM `channel_bindings`; effective WorkDir follows Connector override, Agent default, then Bridge global. Feishu group execution requires the exact in-memory bot Open ID mention and ignores app/bot/self senders
- Server prompt controls can be passed through inbound `MetadataJSON` under `runtime_controls` or `controls`
- Telegram and Feishu re-deliver recovered pending approvals as IM approval cards after restart when the target chat context is known
- Loopback-only admin API with `{ ok, data, error, requestId }` envelopes on `/api/v1/*`
- Bridge logger redaction for registered admin, host-control, and platform secret values
- SQLite persistence for channels, bindings, offsets, sessions, approvals, delivery events, and inert legacy Agent Room data
- Legacy Agent Room migrations remain in the ordered migration chain and apply one version per transaction; the retired feature does not read or mutate their product data
- Binding router and idempotency helpers

The shell-managed launcher must not put admin or host-control tokens in process command-line arguments.
The runtime locator file must not contain the server token value; it may contain only the token path and redacted token display.
Shell-managed stdout/stderr capture and UI log tails must redact known Bridge secrets before exposing diagnostics.
The server adapter is the preferred channel runtime path when a shell-provided locator is configured. The SDK-backed path remains available as the degraded/fallback path.
The `/api/v1/ws` integration currently covers the prompt stream subset required for assistant/thinking deltas, status updates, prompt/turn completion, and approval requested/resolved events.
Pending approval reconcile after Bridge restart keeps local pending approvals aligned with server pending state and rebuilds server-only local projections for known sessions, using existing binding chat context when available. Telegram and Feishu adapters re-deliver pending approval cards idempotently through existing delivery keys; Weixin remains admin/UI-only for approvals because it has no in-chat approval callback path.
The ACP adapter is experimental: manual approval requests are now live async requests that wait for Bridge `ResolveApproval`, but they still cannot be reconstructed after this Bridge process exits without protocol-level server persistence.
Shell clients should unwrap the admin envelope but remain compatible with legacy bare JSON during rolling upgrades.

Historical Agent Room development left two non-product test commands; neither enables the retired product surface:

- `go run ./cmd/runtime-probe --locator <kimi_runtime_locator.json>` performs a read-only, redacted Runtime capability probe and emits machine-readable JSON. Mutating capabilities remain disabled with explicit degradation until separately verified.
- `go run ./cmd/fake-runtime --token-file <path>` starts a loopback-only fake Runtime for multi-Session WebSocket, Cursor/reconnect, Approval, Abort, epoch and Transcript tests. The token value is never printed.
