export function createWorkspaceBridgeNonce(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) {
    return cryptoApi.randomUUID();
  }

  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isTrustedWorkspaceIframeSource(
  source: MessageEventSource | null,
  frame: HTMLIFrameElement | null,
): boolean {
  return Boolean(source && frame?.contentWindow === source);
}

export function isExpectedWorkspaceBridgeNonce(
  nonce: unknown,
  expectedNonce: string,
): boolean {
  return typeof nonce === "string" && nonce !== "" && nonce === expectedNonce;
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

export function redactWorkspaceUrlForDisplay(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    if (url.hash) {
      url.hash = "token=[REDACTED]";
    }
    return url.toString();
  } catch {
    const hashIndex = trimmed.indexOf("#");
    return hashIndex >= 0 ? `${trimmed.slice(0, hashIndex)}#[REDACTED]` : trimmed;
  }
}
