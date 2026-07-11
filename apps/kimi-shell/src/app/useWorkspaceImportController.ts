import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  WorkspaceImportRequestPayload,
  WorkspaceImportResult,
  WorkspaceImportTarget,
} from "@/app/types";
import {
  cancelWorkspaceImportRequest,
  completeWorkspaceImportRequest,
  getActiveWorkspaceImportRequest,
  listWorkspaceImportTargets,
} from "@/services/workspaceImportService";

type WorkspaceImportControllerInput = {
  tauriRuntime: boolean;
  listenersReady: boolean;
  isWorkspaceImportPickerRoute: boolean;
  setActionError: Dispatch<SetStateAction<string | null>>;
  refreshStatus: () => Promise<unknown>;
  handleCloseWindow: () => Promise<void> | void;
};

export function useWorkspaceImportController({
  tauriRuntime,
  listenersReady,
  isWorkspaceImportPickerRoute,
  setActionError,
  refreshStatus,
  handleCloseWindow,
}: WorkspaceImportControllerInput) {
  const [workspaceImportBusy, setWorkspaceImportBusy] = useState(false);
  const [workspaceImportTargets, setWorkspaceImportTargets] = useState<
    WorkspaceImportTarget[]
  >([]);
  const [workspaceImportRequest, setWorkspaceImportRequest] =
    useState<WorkspaceImportRequestPayload | null>(null);
  const [workspaceImportResult, setWorkspaceImportResult] =
    useState<WorkspaceImportResult | null>(null);

  const refreshWorkspaceImportTargets = useCallback(async () => {
    try {
      const targets = await listWorkspaceImportTargets();
      setWorkspaceImportTargets(targets);
      return targets;
    } catch (error) {
      setActionError(String(error));
      return [];
    }
  }, [setActionError]);

  const refreshActiveWorkspaceImportRequest = useCallback(async () => {
    try {
      const request = await getActiveWorkspaceImportRequest();
      setWorkspaceImportRequest(request);
      return request;
    } catch (error) {
      setActionError(String(error));
      return null;
    }
  }, [setActionError]);

  useEffect(() => {
    if (!tauriRuntime || !listenersReady || !isWorkspaceImportPickerRoute) {
      return;
    }

    void refreshWorkspaceImportTargets();
    void refreshActiveWorkspaceImportRequest();
  }, [
    isWorkspaceImportPickerRoute,
    listenersReady,
    refreshActiveWorkspaceImportRequest,
    refreshWorkspaceImportTargets,
    tauriRuntime,
  ]);

  const handleWorkspaceImportRequest = useCallback(
    (payload: WorkspaceImportRequestPayload) => {
      setActionError(null);
      setWorkspaceImportResult(null);
      setWorkspaceImportBusy(false);
      void refreshWorkspaceImportTargets();
      setWorkspaceImportRequest(payload);
    },
    [refreshWorkspaceImportTargets, setActionError],
  );

  const handleWorkspaceImportResult = useCallback(
    (payload: WorkspaceImportResult) => {
      setActionError(null);
      setWorkspaceImportBusy(false);
      setWorkspaceImportRequest((current) =>
        current?.requestId === payload.requestId ? null : current,
      );
      setWorkspaceImportResult(payload);
      void refreshWorkspaceImportTargets();
    },
    [refreshWorkspaceImportTargets, setActionError],
  );

  async function handleBrowseWorkspaceImportTarget() {
    try {
      const selected = await open({
        title: "选择目标工作区目录",
        multiple: false,
        directory: true,
      });
      if (typeof selected === "string") {
        return selected;
      }
      return null;
    } catch (error) {
      setActionError(String(error));
      return null;
    }
  }

  async function handleSelectWorkspaceImportTarget(target: WorkspaceImportTarget) {
    if (!workspaceImportRequest?.requestId?.trim()) {
      return null;
    }

    setWorkspaceImportBusy(true);
    setActionError(null);
    try {
      const result = await completeWorkspaceImportRequest(workspaceImportRequest.requestId, {
        rootPath: target.rootPath,
        label: target.label,
      });
      setWorkspaceImportRequest(null);
      setWorkspaceImportResult(result);
      if (!isWorkspaceImportPickerRoute) {
        await refreshStatus();
      }
      return result;
    } catch (error) {
      setActionError(String(error));
      return null;
    } finally {
      setWorkspaceImportBusy(false);
    }
  }

  async function handleImportToBrowsedWorkspace() {
    if (!workspaceImportRequest?.requestId?.trim()) {
      return null;
    }

    const selected = await handleBrowseWorkspaceImportTarget();
    if (!selected?.trim()) {
      return null;
    }

    setWorkspaceImportBusy(true);
    setActionError(null);
    try {
      const result = await completeWorkspaceImportRequest(workspaceImportRequest.requestId, {
        rootPath: selected.trim(),
        label: "手动选择的工作区",
      });
      setWorkspaceImportRequest(null);
      setWorkspaceImportResult(result);
      if (!isWorkspaceImportPickerRoute) {
        await refreshStatus();
      }
      return result;
    } catch (error) {
      setActionError(String(error));
      return null;
    } finally {
      setWorkspaceImportBusy(false);
    }
  }

  async function handleCancelWorkspaceImportPicker() {
    if (!workspaceImportRequest?.requestId?.trim()) {
      setWorkspaceImportRequest(null);
      if (isWorkspaceImportPickerRoute) {
        await handleCloseWindow();
      }
      return;
    }

    setWorkspaceImportBusy(true);
    setActionError(null);
    try {
      await cancelWorkspaceImportRequest(workspaceImportRequest.requestId);
      setWorkspaceImportRequest(null);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setWorkspaceImportBusy(false);
    }
  }

  function handleDismissWorkspaceImportResult() {
    setWorkspaceImportResult(null);
  }

  return {
    workspaceImportBusy,
    workspaceImportTargets,
    workspaceImportRequest,
    workspaceImportResult,
    refreshWorkspaceImportTargets,
    refreshActiveWorkspaceImportRequest,
    handleWorkspaceImportRequest,
    handleWorkspaceImportResult,
    handleSelectWorkspaceImportTarget,
    handleImportToBrowsedWorkspace,
    handleCancelWorkspaceImportPicker,
    handleDismissWorkspaceImportResult,
  };
}
