import type {
  WorkspaceGridPresetId,
  WorkspaceGridSlot,
  WorkspaceGridTemplate,
} from "./gridTypes";

function slot(id: string): { id: string; area: string } {
  return { id, area: id };
}

export const GRID_PRESETS: Record<WorkspaceGridPresetId, WorkspaceGridTemplate> = {
  single: {
    id: "single",
    label: "单窗",
    columns: "minmax(0, 1fr)",
    rows: "minmax(0, 1fr)",
    areas: '"main"',
    slots: [slot("main")],
  },
  "1x2": {
    id: "1x2",
    label: "左右双窗",
    columns: "repeat(2, minmax(0, 1fr))",
    rows: "minmax(0, 1fr)",
    areas: '"left right"',
    slots: [slot("left"), slot("right")],
  },
  "1x3": {
    id: "1x3",
    label: "三列",
    columns: "repeat(3, minmax(0, 1fr))",
    rows: "minmax(0, 1fr)",
    areas: '"left middle right"',
    slots: [slot("left"), slot("middle"), slot("right")],
  },
  "2x2": {
    id: "2x2",
    label: "四宫格",
    columns: "repeat(2, minmax(0, 1fr))",
    rows: "repeat(2, minmax(0, 1fr))",
    areas: '"top-left top-right" "bottom-left bottom-right"',
    slots: [
      slot("top-left"),
      slot("top-right"),
      slot("bottom-left"),
      slot("bottom-right"),
    ],
  },
  "2x3-5": {
    id: "2x3-5",
    label: "五窗",
    columns: "repeat(3, minmax(0, 1fr))",
    rows: "repeat(2, minmax(0, 1fr))",
    areas: '"primary top middle" "primary bottom tail"',
    slots: [
      slot("primary"),
      slot("top"),
      slot("middle"),
      slot("bottom"),
      slot("tail"),
    ],
  },
  "2x3": {
    id: "2x3",
    label: "六窗",
    columns: "repeat(3, minmax(0, 1fr))",
    rows: "repeat(2, minmax(0, 1fr))",
    areas: '"top-left top-middle top-right" "bottom-left bottom-middle bottom-right"',
    slots: [
      slot("top-left"),
      slot("top-middle"),
      slot("top-right"),
      slot("bottom-left"),
      slot("bottom-middle"),
      slot("bottom-right"),
    ],
  },
};

export function materializeGridSlots(
  presetId: WorkspaceGridPresetId,
  paneIds: readonly string[] = [],
): WorkspaceGridSlot[] {
  return GRID_PRESETS[presetId].slots.map((presetSlot, index) => ({
    ...presetSlot,
    paneId: paneIds[index],
  }));
}
