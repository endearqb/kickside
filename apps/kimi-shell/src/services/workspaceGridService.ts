import { invoke } from "@tauri-apps/api/core";

export interface GridWorkspaceSession {
  sessionId: string;
  workDir?: string;
  isRunning: boolean;
  lastUpdated?: string;
}

export function listGridSessions(): Promise<GridWorkspaceSession[]> {
  return invoke<GridWorkspaceSession[]>("grid_list_sessions");
}

export function createGridSession(
  workspaceRoot: string,
): Promise<GridWorkspaceSession> {
  return invoke<GridWorkspaceSession>("grid_create_session", { workspaceRoot });
}
