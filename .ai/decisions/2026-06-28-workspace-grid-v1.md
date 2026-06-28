# Workspace Grid v1 Decisions

## Status

Accepted

## Decisions

- DR-A: Workspace Grid uses `zustand` as the first isolated frontend state slice.
- DR-B: Workspace Grid v1 handles blocked external pages with a visible fallback and an external-open action. Embedded Tauri child Webviews are deferred to v1b/v2.

## Rationale

- The current shell keeps workspace UI state inside `useShellController`; Grid is small enough to prove a separate store without migrating the whole app.
- Browser frame blocking is not reliably detectable through `iframe.onerror`, so v1 only promises no permanent blank pane.

## Consequences

- Grid state must not persist tokens, cookies, or URL fragments.
- The existing two-pane UI remains the compatibility path until the Grid renderer replaces it.

## Follow-up

- 2026-06-28: WG-7 later added embedded Tauri child Webviews and WebviewWindow fallback for blocked external panes. Native Webview carriers use stable per-pane `dataDirectory` namespaces; iframe carriers still require hosted web-app support for true same-origin localStorage namespacing.
