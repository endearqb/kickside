export type WorkspaceSessionDisposition = "replace_active" | "new_pane";

export interface WorkspaceSessionNavigationPayload {
  action: string;
  source: string;
  requestId?: string;
  sessionId?: string;
  workDir?: string;
  routeTemplate?: string;
  disposition?: WorkspaceSessionDisposition;
  targetWindowLabel?: string;
}

export interface SessionPaneLike {
  id: string;
  kind: "code" | "chat" | "external";
  sessionId?: string;
  workDir?: string;
}

/** Explorer requests should create/reveal a dedicated pane. Legacy events keep replacement semantics. */
export function resolveDisposition(
  payload: WorkspaceSessionNavigationPayload,
): WorkspaceSessionDisposition {
  if (payload.disposition) return payload.disposition;
  return payload.source === "open_dir_request" || payload.source === "open_files_request"
    ? "new_pane"
    : "replace_active";
}

/**
 * Returns the exact pane whose session owns a workDir update.
 * Never fall back to the active pane: that is incorrect when several Code
 * sessions coexist in the grid.
 */
export function resolvePaneForSessionUpdate(
  panes: readonly SessionPaneLike[],
  sessionId: string | null | undefined,
): SessionPaneLike | null {
  const normalized = sessionId?.trim();
  if (!normalized) return null;
  return (
    panes.find(
      (pane) => pane.kind === "code" && pane.sessionId?.trim() === normalized,
    ) ?? null
  );
}
