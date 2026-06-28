export type WorkspacePaneKind = "code" | "chat" | "external";

export type WorkspacePaneCarrier = "iframe";

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
  url?: string;
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
  panes: WorkspacePane[];
  slots: WorkspaceGridSlot[];
  activePaneId: string | null;
  maximizedPaneId: string | null;
  legacySplitRatio?: number;
  trackSizes?: WorkspaceGridTrackSizes;
  updatedAt: number;
}

export type WorkspaceGridPersistedState = WorkspaceGridStateV1;

export interface WorkspaceGridSavedLayout {
  id: string;
  name: string;
  state: WorkspaceGridPersistedState;
  createdAt: number;
  updatedAt: number;
}
