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

export function getGridSession(sessionId: string): Promise<GridWorkspaceSession> {
  return invoke<GridWorkspaceSession>("grid_get_session", { sessionId });
}

export async function resolveCurrentPaneWorkDir(
  querySessionId: () => Promise<string>,
  loadSession: (sessionId: string) => Promise<GridWorkspaceSession> = getGridSession,
): Promise<string> {
  const sessionId = await querySessionId();
  const session = await loadSession(sessionId);
  if (session.sessionId.trim() !== sessionId) {
    throw new Error("会话目录查询返回了不匹配的会话。");
  }

  const workDir = session.workDir?.trim() || "";
  if (!workDir) {
    throw new Error("当前会话没有可用工作目录。");
  }

  if ((await querySessionId()) !== sessionId) {
    throw new Error("查询期间会话已切换，请重试。");
  }
  return workDir;
}

export function createGridSession(
  workspaceRoot: string,
): Promise<GridWorkspaceSession> {
  return invoke<GridWorkspaceSession>("grid_create_session", { workspaceRoot });
}
