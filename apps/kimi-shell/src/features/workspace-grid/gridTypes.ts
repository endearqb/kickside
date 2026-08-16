export type WorkspacePaneKind = "code" | "chat" | "external" | "agent_room" | "dsh";
export type WorkspacePaneKindV1 = Exclude<WorkspacePaneKind, "agent_room" | "dsh">;
export type WorkspacePaneTheme = "light" | "dark";

export type WorkspacePaneCarrier = "iframe" | "local";

export type WorkspacePaneMountPolicy =
  | "eager"
  | "on-focus"
  | "manual"
  | "suspended";

export type WorkspacePaneLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "blocked"
  | "empty"
  | "suspended";

export type WorkspaceGridPresetId =
  | "single"
  | "1x2"
  | "1x3"
  | "2x2"
  | "2x3-5"
  | "2x3";

export interface WorkspacePane {
  id: string;
  kind: WorkspacePaneKind;
  carrier: WorkspacePaneCarrier;
  title: string;
  sessionId?: string;
  /**
   * 运行期由 iframe 桥(pane_session_changed)观测到的当前会话。
   * 仅存在于内存,不持久化;不参与 frameKey/导航,避免触发 iframe 重挂载。
   */
  activeSessionId?: string;
  roomId?: string;
  url?: string;
  workDir?: string;
  theme?: WorkspacePaneTheme;
  storageNamespace?: string;
  mountPolicy: WorkspacePaneMountPolicy;
  loadState: WorkspacePaneLoadState;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceGridTemplateSlot {
  id: string;
  area: string;
  row?: number;
  column?: number;
  rowSpan?: number;
  columnSpan?: number;
}

export interface WorkspaceGridSlot extends WorkspaceGridTemplateSlot {
  paneId?: string;
}

export interface WorkspaceGridTemplate {
  id: WorkspaceGridPresetId;
  label: string;
  columns: string;
  rows: string;
  areas?: string;
  slots: WorkspaceGridTemplateSlot[];
}

export interface WorkspaceGridTrackSizes {
  columns?: number[];
  rows?: number[];
}

export interface WorkspaceGridStateV1 {
  version: 1;
  preset: WorkspaceGridPresetId;
  panes: Array<
    Omit<WorkspacePane, "kind" | "carrier" | "roomId"> & {
      kind: WorkspacePaneKindV1;
      carrier: "iframe";
      storageNamespace: string;
    }
  >;
  slots: WorkspaceGridSlot[];
  activePaneId: string | null;
  maximizedPaneId: string | null;
  legacySplitRatio?: number;
  trackSizes?: WorkspaceGridTrackSizes;
  updatedAt: number;
}

export interface WorkspaceGridStateV2 {
  version: 2;
  preset: WorkspaceGridPresetId;
  panes: WorkspacePane[];
  slots: WorkspaceGridSlot[];
  activePaneId: string | null;
  maximizedPaneId: string | null;
  legacySplitRatio?: number;
  trackSizes?: WorkspaceGridTrackSizes;
  updatedAt: number;
}

export type WorkspaceGridPersistedState = WorkspaceGridStateV2;

export interface WorkspaceGridSavedLayout {
  id: string;
  name: string;
  state: WorkspaceGridPersistedState;
  createdAt: number;
  updatedAt: number;
}
