# macOS V1 Platform Support

## Status

Accepted

## Context

Kimi Sidekick currently ships a Tauri v2 + React Windows application. The product now needs an
Apple Silicon macOS version on the same repository and shared business/UI code. The 2026-08-05
macOS plan is a useful starting point, but its Kimi Code 0.33 baseline and Agent Room acceptance
surface are stale: Kimi Code 0.34.0 is current, and Agent Room is retired by an accepted ADR.

## Decision

- Keep `apps/kimi-shell` as the shared Windows/macOS application. Do not fork a second app or add a
  speculative Swift/AppKit shell.
- Target Apple Silicon (`aarch64-apple-darwin`) and macOS 13+ for V1. Intel/universal artifacts are
  outside the first release scope.
- On macOS use system window decorations and traffic lights, the native application menu, Dock
  reopen, standard close/hide behavior, and `Cmd+Q` graceful shutdown. Windows keeps its custom
  titlebar and Explorer integration.
- Add one additive `PlatformCapabilities` Tauri contract. Frontend platform decisions must consume
  that contract rather than scattered user-agent checks.
- Keep Kimi Code external to the app. macOS detects and validates the official executable and
  provides guided first installation. It may ask macOS to open Terminal.app, but must not paste,
  type or execute the remote `curl | sh` pipeline on the user's behalf. Once Kimi Code is installed,
  a user-confirmed managed upgrade may stop only the Shell-owned backend, invoke the validated
  executable directly with the single `upgrade` argument, stream redacted output, re-probe, and
  restart the backend; it must not route through PowerShell, a shell command string, or kill a
  reused external runtime.
- Package the Go IM Bridge through Tauri `externalBin` with target-triple source artifacts. The
  bundled executable keeps the stable runtime name `kimi-im-bridge` / `kimi-im-bridge.exe`.
- Local development may use unsigned/ad-hoc `.app` artifacts. Public distribution requires a
  Developer ID signed, hardened, notarized and stapled DMG plus a signed Tauri updater artifact.
- Keep the existing bundle identifier `com.kimi.shell` for this implementation. Changing application
  identity and migrating installed settings is a separate one-way decision.
- Do not restore Agent Room for macOS. Its frozen compatibility tombstones remain governed by the
  decommission ADR and are not a release acceptance surface.

## Rationale

- The existing Tauri/Rust/React runtime, Grid, diagnostics, Bridge and updater logic are substantial
  shared assets. A native-shell rewrite would add two application shells before a proven product
  requirement justifies that cost.
- Native-feel tenet T3 (adopt the platform; do not compete with it) is satisfied at the platform
  seams that matter for this product: window controls, menus, Dock lifecycle, shortcuts, dialogs and
  process ownership. Tauri remains a deliberate trade-off: it preserves the short React iteration
  loop but cannot promise per-frame parity with a bespoke AppKit host.
- Keeping the bundle identifier avoids an unrelated settings/updater identity migration during the
  first macOS bring-up.

## Consequences

- macOS and Windows may differ in chrome, menu wording, close behavior and unsupported integration
  surfaces while sharing business behavior and IPC names.
- macOS 13 uses the default shared WKWebView data store; per-pane `dataDirectory` is not requested on
  macOS because Tauri does not support it there. Raising the minimum to macOS 14 and adopting stable
  `dataStoreIdentifier` values requires a later decision and migration plan.
- Developer ID credentials, notarization and real updater E2E remain external release gates. Without
  those credentials the implementation can reach G0/G1 and an unsigned local `.app`, not “released”.
- The additive `get_platform_capabilities` command and target-triple sidecar naming are published
  contracts and must remain backward compatible.

## Verification

- macOS: frontend tests/typecheck, Rust check/tests, Go tests, target sidecar smoke, Tauri `.app`
  build, traffic-light/menu/Dock/quit manual smoke.
- Windows: existing frontend/Rust/Go gates plus NSIS/MSI and Explorer regression in CI/release.
- Release: `codesign --verify --deep --strict`, `spctl --assess`, `stapler validate`, `hdiutil verify`,
  nested sidecar identity and real updater E2E.
