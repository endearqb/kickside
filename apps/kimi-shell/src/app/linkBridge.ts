export function isKnownWorkspaceIframeSource(
  source: MessageEventSource | null,
  root: ParentNode = document,
): boolean {
  if (!source) {
    return false;
  }

  return Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe.workspace-iframe")).some(
    (frame) => frame.contentWindow === source,
  );
}

export function normalizeExternalOpenUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
