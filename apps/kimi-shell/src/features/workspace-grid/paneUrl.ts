export function buildCodePaneUrl(originOrWorkspaceUrl: string, sessionId: string): string {
  const source = new URL(originOrWorkspaceUrl);
  const url = new URL(`/sessions/${encodeURIComponent(sessionId)}`, source.origin);
  url.search = source.search;
  url.hash = source.hash;
  return url.toString();
}
