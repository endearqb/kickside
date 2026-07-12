import { SESSION_BRIDGE_SOURCE, SESSION_SYNC_SOURCE } from "@/app/theme";

const MAX_SESSION_ID_LENGTH = 512;
const SESSION_QUERY_TIMEOUT_MS = 2_000;

export type WorkspaceFrameSessionMessage = {
  action: "pane_session_changed" | "current_session_response";
  requestId?: string;
  sessionId: string | null;
  applied: boolean;
  reason?: string;
};

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

export function parseWorkspaceFrameSessionMessage(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
  expectedOrigin: string,
): WorkspaceFrameSessionMessage | null {
  if (
    !expectedOrigin ||
    event.origin !== expectedOrigin ||
    !isTrustedWorkspaceIframeSource(event.source, frame)
  ) {
    return null;
  }

  const data = event.data as Record<string, unknown> | null;
  if (
    !data ||
    data.source !== SESSION_BRIDGE_SOURCE ||
    (data.action !== "pane_session_changed" &&
      data.action !== "current_session_response")
  ) {
    return null;
  }

  const rawSessionId = data.sessionId;
  const sessionId =
    typeof rawSessionId === "string" && rawSessionId.trim().length > 0
      ? rawSessionId.trim()
      : null;
  if (sessionId && sessionId.length > MAX_SESSION_ID_LENGTH) {
    return null;
  }

  return {
    action: data.action,
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
    sessionId,
    applied: data.applied === true,
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
}

export function queryWorkspaceFrameSessionId(
  frame: HTMLIFrameElement | null,
  expectedOrigin: string,
): Promise<string> {
  const frameWindow = frame?.contentWindow;
  if (!frame || !frame.isConnected || !frameWindow || !expectedOrigin) {
    return Promise.reject(new Error("当前会话窗格尚未加载。"));
  }

  const requestId = createWorkspaceBridgeNonce();
  return new Promise((resolve, reject) => {
    let timer = 0;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
    const onMessage = (event: MessageEvent) => {
      const message = parseWorkspaceFrameSessionMessage(event, frame, expectedOrigin);
      if (
        !message ||
        message.action !== "current_session_response" ||
        message.requestId !== requestId
      ) {
        return;
      }
      cleanup();
      if (!message.applied || !message.sessionId) {
        reject(new Error("当前窗格尚未进入会话。"));
        return;
      }
      resolve(message.sessionId);
    };

    window.addEventListener("message", onMessage);
    timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("读取当前会话超时。"));
    }, SESSION_QUERY_TIMEOUT_MS);
    try {
      frameWindow.postMessage(
        { source: SESSION_SYNC_SOURCE, action: "report_current_session", requestId },
        expectedOrigin,
      );
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
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
