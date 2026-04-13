import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceImportRequestPayload,
  WorkspaceImportResult,
  WorkspaceImportTarget,
  WorkspaceImportTargetInput,
} from "@/app/types";

export function listWorkspaceImportTargets() {
  return invoke<WorkspaceImportTarget[]>("list_workspace_import_targets");
}

export function getActiveWorkspaceImportRequest() {
  return invoke<WorkspaceImportRequestPayload | null>("get_active_workspace_import_request");
}

export function completeWorkspaceImportRequest(
  requestId: string,
  input: WorkspaceImportTargetInput,
) {
  return invoke<WorkspaceImportResult>("complete_workspace_import_request", {
    requestId,
    input,
  });
}

export function cancelWorkspaceImportRequest(requestId: string) {
  return invoke<void>("cancel_workspace_import_request", { requestId });
}
