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
