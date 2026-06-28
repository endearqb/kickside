export function buildCodePaneUrl(originOrWorkspaceUrl: string, sessionId: string): string {
  const origin = new URL(originOrWorkspaceUrl).origin;
  const url = new URL(`/sessions/${encodeURIComponent(sessionId)}`, origin);
  return url.toString();
}
