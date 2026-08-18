import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createWorkspaceBridgeNonce,
  redactWorkspaceUrlForDisplay,
} from "@/app/linkBridge";
import type { AppStatus } from "@/app/types";

export function buildWorkspaceFrameKey(
  remoteUrl: string | null,
  mode: string,
  reloadToken: number,
  startCycleId: number | null | undefined,
) {
  if (!remoteUrl) return "workspace-empty";
  return `${remoteUrl}::${mode}::${reloadToken}::cycle-${startCycleId ?? "unknown"}`;
}

export function useWorkspaceEmbedUrl(status: AppStatus | null) {
  const [workspaceEmbedUrl, setWorkspaceEmbedUrlState] = useState<string | null>(null);
  const workspaceEmbedUrlRef = useRef<string | null>(null);
  const workspaceEmbedStartCycleIdRef = useRef<number | null>(null);
  const workspaceBridgeNonceRef = useRef<string | null>(null);

  if (!workspaceBridgeNonceRef.current) {
    workspaceBridgeNonceRef.current = createWorkspaceBridgeNonce();
  }

  const workspacePort = status?.workspacePort ?? status?.activePort;
  const remoteUrl = workspaceEmbedUrl?.trim()
    ? workspaceEmbedUrl.trim()
    : workspacePort
      ? `http://127.0.0.1:${workspacePort}`
      : null;
  const workspaceDisplayUrl =
    status?.workspaceUrlRedacted?.trim() ||
    redactWorkspaceUrlForDisplay(status?.workspaceUrl) ||
    redactWorkspaceUrlForDisplay(remoteUrl);

  function setWorkspaceEmbedUrl(
    nextUrl: string | null | undefined,
    startCycleId: number | null,
  ) {
    const normalized = nextUrl?.trim() || null;
    workspaceEmbedUrlRef.current = normalized;
    workspaceEmbedStartCycleIdRef.current = normalized ? startCycleId : null;
    setWorkspaceEmbedUrlState(normalized);
  }

  async function refreshWorkspaceEmbedUrlForStatus(nextStatus: AppStatus) {
    if (nextStatus.state !== "running") {
      setWorkspaceEmbedUrl(null, null);
      return;
    }

    if (
      workspaceEmbedUrlRef.current &&
      workspaceEmbedStartCycleIdRef.current === nextStatus.startCycleId
    ) {
      return;
    }

    try {
      const nextUrl = await invoke<string | null>("get_workspace_embed_url");
      setWorkspaceEmbedUrl(nextUrl, nextStatus.startCycleId);
    } catch {
      setWorkspaceEmbedUrl(null, null);
    }
  }

  return {
    hasWorkspaceEmbedUrl: Boolean(workspaceEmbedUrl?.trim()),
    remoteUrl,
    workspaceBridgeNonce: workspaceBridgeNonceRef.current ?? "",
    workspaceDisplayUrl,
    setWorkspaceEmbedUrl,
    refreshWorkspaceEmbedUrlForStatus,
  };
}
