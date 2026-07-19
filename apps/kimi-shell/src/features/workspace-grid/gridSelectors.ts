import type {
  WorkspaceGridPresetId,
  WorkspaceGridStateV2,
  WorkspaceGridTemplate,
  WorkspacePane,
} from "./gridTypes";
import { GRID_PRESETS } from "./gridPresets";

export function selectGridPreset(
  state: WorkspaceGridStateV2,
): WorkspaceGridTemplate {
  return GRID_PRESETS[state.preset];
}

export function selectPaneById(
  state: WorkspaceGridStateV2,
  paneId: string | null,
): WorkspacePane | null {
  if (!paneId) {
    return null;
  }
  return state.panes.find((pane) => pane.id === paneId) ?? null;
}

export function selectVisiblePanes(state: WorkspaceGridStateV2): WorkspacePane[] {
  const paneIds = new Set(state.slots.map((slot) => slot.paneId).filter(Boolean));
  return state.panes.filter((pane) => paneIds.has(pane.id));
}

export function selectPresetCapacity(presetId: WorkspaceGridPresetId): number {
  return GRID_PRESETS[presetId].slots.length;
}
