import { isTauri } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { normalizeEmbeddableUrl } from "@/features/workspace-grid/urlSafety";

interface OpenExternalWebviewWindowInput {
  url: string;
  title: string;
  storageNamespace?: string;
}

export interface EmbeddedExternalWebviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EmbeddedExternalWebviewController {
  sync(bounds: EmbeddedExternalWebviewBounds): Promise<void>;
  close(): Promise<void>;
}

interface CreateEmbeddedExternalWebviewInput {
  url: string;
  title: string;
  bounds: EmbeddedExternalWebviewBounds;
  storageNamespace?: string;
}

export async function openExternalWebviewWindow({
  url,
  title,
  storageNamespace,
}: OpenExternalWebviewWindowInput): Promise<void> {
  const normalized = normalizeEmbeddableUrl(url);
  if (!normalized.ok) {
    throw new Error(`unsupported external URL: ${normalized.reason}`);
  }

  if (!isTauri()) {
    const opened = window.open(normalized.url, "_blank", "noopener,noreferrer");
    if (!opened) {
      throw new Error("browser popup was blocked");
    }
    return;
  }

  const webview = new WebviewWindow(createExternalWebviewLabel(), {
    url: normalized.url,
    title: title.trim() || new URL(normalized.url).hostname,
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    center: true,
    resizable: true,
    dataDirectory: createWebviewDataDirectory(storageNamespace),
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once("tauri://created", () => resolve());
    void webview.once<unknown>("tauri://error", (event) =>
      reject(new Error(String(event.payload ?? "failed to create webview window"))),
    );
  });
}

export async function createEmbeddedExternalWebview({
  url,
  bounds,
  storageNamespace,
}: CreateEmbeddedExternalWebviewInput): Promise<EmbeddedExternalWebviewController> {
  const normalized = normalizeEmbeddableUrl(url);
  if (!normalized.ok) {
    throw new Error(`unsupported external URL: ${normalized.reason}`);
  }

  if (!isTauri()) {
    throw new Error("embedded webview requires the Tauri runtime");
  }

  const webview = new Webview(getCurrentWindow(), createExternalWebviewLabel(), {
    url: normalized.url,
    ...normalizeEmbeddedBounds(bounds),
    focus: true,
    dragDropEnabled: false,
    dataDirectory: createWebviewDataDirectory(storageNamespace),
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once("tauri://created", () => resolve());
    void webview.once<unknown>("tauri://error", (event) =>
      reject(new Error(String(event.payload ?? "failed to create embedded webview"))),
    );
  });

  let closed = false;
  return {
    async sync(nextBounds) {
      if (closed) {
        return;
      }
      const normalizedBounds = normalizeEmbeddedBounds(nextBounds);
      await Promise.all([
        webview.setPosition(
          new LogicalPosition(normalizedBounds.x, normalizedBounds.y),
        ),
        webview.setSize(
          new LogicalSize(normalizedBounds.width, normalizedBounds.height),
        ),
      ]);
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      await webview.close();
    },
  };
}

function normalizeEmbeddedBounds(
  bounds: EmbeddedExternalWebviewBounds,
): EmbeddedExternalWebviewBounds {
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

function createWebviewDataDirectory(storageNamespace?: string): string | undefined {
  const namespace = storageNamespace?.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return namespace || undefined;
}

function createExternalWebviewLabel(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `workspace-external-${random.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}
