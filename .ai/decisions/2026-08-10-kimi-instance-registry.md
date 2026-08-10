# Kimi Code Instance Registry Discovery

## Status

Accepted

## Supersedes

The discovery portion of `2026-07-14-reuse-existing-kimi-server.md`. Its ownership rule remains in
force: normal stop, reconnect and application exit never terminate a reused external runtime.

## Decision

- Use `<KIMI_CODE_HOME>/server/instances/*.json` as the primary Kimi Code runtime discovery source.
- Accept records only after bounded-size JSON parsing, non-zero PID/port, loopback host validation,
  live-PID validation and health plus Bearer-authenticated API probing.
- For an owned launch, snapshot server IDs before spawn and prefer a record whose PID matches the
  child. A newly created record near the launch time is the secondary match; bounded port probing is
  only a fallback while the child remains alive.
- Preserve the legacy `server/lock` reader only as an explicitly registered compatibility path for
  pre-0.28 Kimi installations when no current registry candidate is usable. New features must not
  depend on the legacy path.
- Treat Kimi Code 0.34.0/0.34.x as the first tested native macOS baseline. Version text alone is not
  sufficient because legacy Python `kimi-cli` has a numerically higher 1.x version; command family
  and required runtime capabilities must also be validated.
- Invalid or foreign registry files are ignored with redacted diagnostics and are never deleted by
  Kimi Sidekick.

## Rationale

- Current Kimi Code supports multiple instances and registers the actual PID/port in per-instance
  files. The old single lock cannot represent port auto-increment or multiple live servers.
- PID, loopback, health and Bearer checks together prevent a syntactically valid local JSON file from
  redirecting the app to an untrusted service.
- Keeping the legacy reader as a bounded fallback preserves already published Windows compatibility
  while allowing both platforms to move to the current upstream contract.

## Consequences

- Runtime diagnostics add discovery source, server ID, PID, host version and heartbeat information
  without exposing the server token.
- A healthy external registry instance remains `reused_external`; only a child started by the shell
  is `owned_by_shell`.
- Token rotation may produce an auth failure while the process is alive. The shell must re-read
  `server.token` before declaring the runtime unavailable.
- The legacy lock compatibility path exits after supported upgrade paths have moved active users to a
  registry-capable Kimi Code release for one full release cycle and the Shell G1 gate passes without
  it.

## Verification

- Fixture tests cover valid/invalid records, loopback hosts, record size, ordering, PID liveness,
  owned PID matching and legacy fallback selection.
- Integration smoke covers port auto-increment, multiple external instances, external-not-killed and
  owned process-group shutdown.
