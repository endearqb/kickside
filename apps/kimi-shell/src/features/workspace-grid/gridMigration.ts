import {
  WORKSPACE_ACTIVE_VIEW_STORAGE_KEY,
  WORKSPACE_LAYOUT_MODE_STORAGE_KEY,
  WORKSPACE_SPLIT_ORDER_STORAGE_KEY,
  WORKSPACE_SPLIT_RATIO_STORAGE_KEY,
  parseWorkspaceLayoutMode,
  parseWorkspaceSplitOrder,
  parseWorkspaceSplitRatio,
  parseWorkspaceViewKind,
} from "@/app/theme";
import { materializeGridSlots } from "./gridPresets";
import type {
  WorkspaceGridStateV1,
  WorkspaceGridStateV2,
  WorkspacePane,
} from "./gridTypes";

type ReadonlyStorage = Pick<Storage, "getItem">;

export function migrateLegacyWorkspaceGridState(
  storage: ReadonlyStorage,
  now = Date.now(),
): WorkspaceGridStateV2 {
  const activeView =
    parseWorkspaceViewKind(storage.getItem(WORKSPACE_ACTIVE_VIEW_STORAGE_KEY)) ??
    "code";
  const layoutMode =
    parseWorkspaceLayoutMode(storage.getItem(WORKSPACE_LAYOUT_MODE_STORAGE_KEY)) ??
    "single";
  const splitOrder =
    parseWorkspaceSplitOrder(storage.getItem(WORKSPACE_SPLIT_ORDER_STORAGE_KEY)) ??
    "code_left";
  const legacySplitRatio =
    parseWorkspaceSplitRatio(storage.getItem(WORKSPACE_SPLIT_RATIO_STORAGE_KEY)) ??
    undefined;

  const panes = createLegacyPanes(now);
  const activePaneId = activeView === "code" ? "pane-code" : "pane-chat";

  if (layoutMode === "split") {
    const paneIds =
      splitOrder === "code_left"
        ? ["pane-code", "pane-chat"]
        : ["pane-chat", "pane-code"];
    return {
      version: 2,
      preset: "1x2",
      panes,
      slots: materializeGridSlots("1x2", paneIds),
      activePaneId,
      maximizedPaneId: null,
      legacySplitRatio,
      updatedAt: now,
    };
  }

  return {
    version: 2,
    preset: "single",
    panes,
    slots: materializeGridSlots("single", [activePaneId]),
    activePaneId,
    maximizedPaneId: null,
    legacySplitRatio,
    updatedAt: now,
  };
}

export function createDefaultWorkspaceGridState(now = Date.now()): WorkspaceGridStateV2 {
  const panes = createLegacyPanes(now);
  return {
    version: 2,
    preset: "1x2",
    panes,
    slots: materializeGridSlots("1x2", ["pane-code", "pane-chat"]),
    activePaneId: "pane-code",
    maximizedPaneId: null,
    updatedAt: now,
  };
}

export function migrateWorkspaceGridStateV1(
  state: WorkspaceGridStateV1,
): WorkspaceGridStateV2 {
  return {
    ...state,
    version: 2,
    panes: state.panes.map((pane) => ({ ...pane, carrier: "iframe" as const })),
  };
}

function createLegacyPanes(now: number): WorkspacePane[] {
  return [
    {
      id: "pane-code",
      kind: "code",
      carrier: "iframe",
      title: "KimiCode",
      storageNamespace: "workspace-grid-pane-code",
      mountPolicy: "eager",
      loadState: "idle",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "pane-chat",
      kind: "chat",
      carrier: "iframe",
      title: "KimiChat",
      storageNamespace: "workspace-grid-pane-chat",
      mountPolicy: "eager",
      loadState: "idle",
      createdAt: now,
      updatedAt: now,
    },
  ];
}
