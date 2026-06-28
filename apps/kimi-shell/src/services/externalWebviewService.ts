import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { normalizeEmbeddableUrl } from "@/features/workspace-grid/urlSafety";

interface OpenExternalWebviewWindowInput {
  url: string;
  title: string;
}

export async function openExternalWebviewWindow({
  url,
  title,
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
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once("tauri://created", () => resolve());
    void webview.once<unknown>("tauri://error", (event) =>
      reject(new Error(String(event.payload ?? "failed to create webview window"))),
    );
  });
}

function createExternalWebviewLabel(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `workspace-external-${random.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}
