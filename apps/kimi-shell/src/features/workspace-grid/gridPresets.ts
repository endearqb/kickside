import type {
  WorkspaceGridPresetId,
  WorkspaceGridSlot,
  WorkspaceGridTemplate,
  WorkspaceGridTrackSizes,
} from "./gridTypes";

const MIN_TRACK_FR = 0.2;

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

export function getGridTrackCounts(
  presetId: WorkspaceGridPresetId,
): { columns: number; rows: number } {
  const rows = GRID_PRESETS[presetId].areas?.match(/"([^"]+)"/g) ?? [];
  if (rows.length === 0) {
    return { columns: 1, rows: 1 };
  }
  const columns = rows[0]?.replace(/"/g, "").trim().split(/\s+/).length ?? 1;
  return { columns, rows: rows.length };
}

export function normalizeGridTrackSizes(
  sizes: WorkspaceGridTrackSizes | undefined,
  presetId: WorkspaceGridPresetId,
): WorkspaceGridTrackSizes | undefined {
  const counts = getGridTrackCounts(presetId);
  const columns = normalizeTrackSizes(sizes?.columns, counts.columns);
  const rows = normalizeTrackSizes(sizes?.rows, counts.rows);
  if (!columns && !rows) {
    return undefined;
  }
  return { columns, rows };
}

export function createEqualTrackSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1);
}

export function gridTrackSizesToCss(
  sizes: readonly number[] | undefined,
  count: number,
): string | null {
  const normalized = normalizeTrackSizes(sizes, count);
  if (!normalized) {
    return null;
  }
  return normalized.map((size) => `minmax(0, ${size}fr)`).join(" ");
}

export function resizeGridTrackSizes(
  sizes: readonly number[],
  index: number,
  deltaPx: number,
  totalPx: number,
): number[] {
  if (index < 0 || index >= sizes.length - 1 || totalPx <= 0) {
    return [...sizes];
  }
  const next = sizes.map((size) => Math.max(MIN_TRACK_FR, size));
  const pairTotal = next[index] + next[index + 1];
  const totalFr = next.reduce((sum, size) => sum + size, 0);
  const deltaFr = (deltaPx / totalPx) * totalFr;
  const first = Math.min(
    Math.max(next[index] + deltaFr, MIN_TRACK_FR),
    pairTotal - MIN_TRACK_FR,
  );
  next[index] = roundTrack(first);
  next[index + 1] = roundTrack(pairTotal - first);
  return next;
}

function normalizeTrackSizes(
  sizes: readonly number[] | undefined,
  count: number,
): number[] | undefined {
  if (!sizes || sizes.length !== count || count < 2) {
    return undefined;
  }
  return sizes.map((size) => roundTrack(Math.max(MIN_TRACK_FR, size)));
}

function roundTrack(value: number): number {
  return Math.round(value * 1000) / 1000;
}
