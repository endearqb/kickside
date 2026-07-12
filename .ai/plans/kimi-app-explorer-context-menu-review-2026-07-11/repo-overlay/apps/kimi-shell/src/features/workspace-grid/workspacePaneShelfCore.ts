/**
 * Pure placement/reveal reducer for Kimi Sidekick's Workspace Grid.
 *
 * Design goals:
 * - at most six visible panes;
 * - keep additional panes in a shelf (default total limit: twelve);
 * - a new Explorer request is always made visible;
 * - when all six slots are occupied, the new pane replaces the active slot and
 *   the displaced pane becomes hidden, without deleting its server session;
 * - duplicate delivery for the same session is idempotent.
 *
 * This module intentionally has no React/Zustand dependencies so it can be
 * tested in isolation and adapted into gridStore.ts.
 */

export type WorkspaceGridPresetId =
  | "single"
  | "1x2"
  | "1x3"
  | "2x2"
  | "2x3-5"
  | "2x3";

export type WorkspacePaneMountPolicy =
  | "eager"
  | "on-focus"
  | "manual"
  | "suspended";

export interface ShelfPane {
  id: string;
  kind: "code" | "chat" | "external";
  title: string;
  sessionId?: string;
  workDir?: string;
  mountPolicy: WorkspacePaneMountPolicy;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface ShelfSlot {
  id: string;
  area: string;
  paneId?: string;
  [key: string]: unknown;
}

export interface ShelfGridState<TPane extends ShelfPane = ShelfPane> {
  preset: WorkspaceGridPresetId;
  panes: TPane[];
  slots: ShelfSlot[];
  activePaneId: string | null;
  maximizedPaneId: string | null;
  trackSizes?: unknown;
  updatedAt: number;
  [key: string]: unknown;
}

export interface ShelfLimits {
  maxVisible: number;
  maxTotal: number;
}

export const DEFAULT_SHELF_LIMITS: Readonly<ShelfLimits> = Object.freeze({
  maxVisible: 6,
  maxTotal: 12,
});

export type OpenPanePlacementKind =
  | "added_visible"
  | "added_swapped"
  | "reused_visible"
  | "reused_swapped"
  | "limit_reached";

export interface OpenPanePlacementResult<TState> {
  state: TState;
  kind: OpenPanePlacementKind;
  paneId: string | null;
  displacedPaneId?: string | undefined;
  targetSlotId?: string | undefined;
  visibleCount: number;
  shelfCount: number;
}

export interface ShowPaneResult<TState> {
  state: TState;
  changed: boolean;
  paneId: string | null;
  displacedPaneId?: string | undefined;
  targetSlotId?: string | undefined;
  visibleCount: number;
  shelfCount: number;
}

const PRESET_SEQUENCE: readonly WorkspaceGridPresetId[] = [
  "single",
  "1x2",
  "1x3",
  "2x2",
  "2x3-5",
  "2x3",
];

const PRESET_SLOT_IDS: Readonly<Record<WorkspaceGridPresetId, readonly string[]>> = {
  single: ["main"],
  "1x2": ["left", "right"],
  "1x3": ["left", "top", "bottom"],
  "2x2": ["top-left", "top-right", "bottom-left", "bottom-right"],
  "2x3-5": ["primary", "top", "middle", "bottom", "tail"],
  "2x3": [
    "top-left",
    "top-middle",
    "top-right",
    "bottom-left",
    "bottom-middle",
    "bottom-right",
  ],
};

export function getVisiblePaneIds(state: Pick<ShelfGridState, "panes" | "slots">): string[] {
  const paneIds = new Set(state.panes.map((pane) => pane.id));
  const seen = new Set<string>();
  const result: string[] = [];

  for (const slot of state.slots) {
    const paneId = slot.paneId;
    if (paneId && paneIds.has(paneId) && !seen.has(paneId)) {
      seen.add(paneId);
      result.push(paneId);
    }
  }
  return result;
}

export function getShelfPanes<TPane extends ShelfPane>(
  state: Pick<ShelfGridState<TPane>, "panes" | "slots">,
): TPane[] {
  const visible = new Set(getVisiblePaneIds(state));
  return state.panes
    .filter((pane) => !visible.has(pane.id))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function getVisiblePanes<TPane extends ShelfPane>(
  state: Pick<ShelfGridState<TPane>, "panes" | "slots">,
): TPane[] {
  const byId = new Map(state.panes.map((pane) => [pane.id, pane] as const));
  return getVisiblePaneIds(state)
    .map((paneId) => byId.get(paneId))
    .filter((pane): pane is TPane => Boolean(pane));
}

/**
 * Adds or reveals a pane. The caller should pass a fully sanitized pane object
 * with a unique pane id and storage namespace.
 */
export function openPaneFromExplorer<
  TPane extends ShelfPane,
  TState extends ShelfGridState<TPane>,
>(
  state: TState,
  incomingPane: TPane,
  options: {
    now?: number;
    limits?: Partial<ShelfLimits>;
    /** Reuse a pane that already points at this session. Defaults to true. */
    reuseSession?: boolean;
  } = {},
): OpenPanePlacementResult<TState> {
  const now = options.now ?? Date.now();
  const limits = normalizeLimits(options.limits);
  const existing =
    options.reuseSession === false || !incomingPane.sessionId
      ? undefined
      : state.panes.find(
          (pane) => pane.sessionId && pane.sessionId === incomingPane.sessionId,
        );

  if (existing) {
    const visible = new Set(getVisiblePaneIds(state));
    if (visible.has(existing.id)) {
      const nextState = updatePaneAndActivate(state, existing.id, incomingPane, now);
      return result(nextState, "reused_visible", existing.id);
    }

    const updatedState = updatePaneWithoutPlacement(state, existing.id, incomingPane, now);
    const shown = showPaneFromShelf(updatedState, existing.id, { now });
    return {
      state: shown.state,
      kind: "reused_swapped",
      paneId: existing.id,
      displacedPaneId: shown.displacedPaneId,
      targetSlotId: shown.targetSlotId,
      visibleCount: shown.visibleCount,
      shelfCount: shown.shelfCount,
    };
  }

  if (state.panes.length >= limits.maxTotal) {
    return result(state, "limit_reached", null);
  }

  const visiblePaneIds = getVisiblePaneIds(state);
  const emptySlot = state.slots.find((slot) => !slot.paneId);
  const pane = {
    ...incomingPane,
    mountPolicy: "eager" as const,
    updatedAt: now,
  };

  if (visiblePaneIds.length < limits.maxVisible && emptySlot) {
    const nextState = {
      ...state,
      panes: [...state.panes, pane],
      slots: state.slots.map((slot) =>
        slot.id === emptySlot.id ? { ...slot, paneId: pane.id } : slot,
      ),
      activePaneId: pane.id,
      maximizedPaneId: null,
      updatedAt: now,
    } as TState;
    return result(nextState, "added_visible", pane.id, undefined, emptySlot.id);
  }

  if (visiblePaneIds.length < limits.maxVisible) {
    const targetVisibleCount = Math.max(1, visiblePaneIds.length + 1);
    const nextPreset = presetForVisibleCount(targetVisibleCount);
    const nextSlots = materializeSlots(nextPreset, [...visiblePaneIds, pane.id]);
    const targetSlotId = nextSlots.find((slot) => slot.paneId === pane.id)?.id;
    const nextState = {
      ...state,
      preset: nextPreset,
      panes: [...state.panes, pane],
      slots: nextSlots,
      activePaneId: pane.id,
      maximizedPaneId: null,
      trackSizes: undefined,
      updatedAt: now,
    } as TState;
    return result(nextState, "added_visible", pane.id, undefined, targetSlotId);
  }

  const targetSlot = resolveTargetSlot(state);
  if (!targetSlot) {
    // Corrupt state: do not create a pane that the user cannot see or recover.
    // The caller should surface an actionable error and repair the grid state.
    return result(state, "limit_reached", null);
  }

  const displacedPaneId = targetSlot.paneId;
  const nextState = {
    ...state,
    panes: [
      ...state.panes.map((existingPane) =>
        existingPane.id === displacedPaneId
          ? ({ ...existingPane, mountPolicy: "on-focus", updatedAt: now } as TPane)
          : existingPane,
      ),
      pane,
    ],
    slots: state.slots.map((slot) =>
      slot.id === targetSlot.id ? { ...slot, paneId: pane.id } : slot,
    ),
    activePaneId: pane.id,
    maximizedPaneId: null,
    updatedAt: now,
  } as TState;

  return result(
    nextState,
    "added_swapped",
    pane.id,
    displacedPaneId,
    targetSlot.id,
  );
}

/**
 * Makes an existing shelf pane visible. If all slots are occupied, it swaps
 * into the active slot and shelves the displaced pane.
 */
export function showPaneFromShelf<
  TPane extends ShelfPane,
  TState extends ShelfGridState<TPane>,
>(
  state: TState,
  paneId: string,
  options: { now?: number; targetSlotId?: string } = {},
): ShowPaneResult<TState> {
  const now = options.now ?? Date.now();
  const pane = state.panes.find((candidate) => candidate.id === paneId);
  if (!pane) {
    return showResult(state, false, null);
  }

  const alreadyVisibleSlot = state.slots.find((slot) => slot.paneId === paneId);
  if (alreadyVisibleSlot) {
    const nextState = {
      ...state,
      panes: state.panes.map((candidate) =>
        candidate.id === paneId
          ? ({ ...candidate, mountPolicy: "eager", updatedAt: now } as TPane)
          : candidate,
      ),
      activePaneId: paneId,
      maximizedPaneId: null,
      updatedAt: now,
    } as TState;
    return showResult(nextState, true, paneId, undefined, alreadyVisibleSlot.id);
  }

  const explicitTarget = options.targetSlotId
    ? state.slots.find((slot) => slot.id === options.targetSlotId)
    : undefined;
  const emptySlot = state.slots.find((slot) => !slot.paneId);
  const targetSlot = explicitTarget ?? emptySlot ?? resolveTargetSlot(state);
  if (!targetSlot) {
    return showResult(state, false, paneId);
  }

  const displacedPaneId = targetSlot.paneId;
  const nextState = {
    ...state,
    panes: state.panes.map((candidate) => {
      if (candidate.id === paneId) {
        return { ...candidate, mountPolicy: "eager", updatedAt: now } as TPane;
      }
      if (candidate.id === displacedPaneId) {
        return { ...candidate, mountPolicy: "on-focus", updatedAt: now } as TPane;
      }
      return candidate;
    }),
    slots: state.slots.map((slot) =>
      slot.id === targetSlot.id ? { ...slot, paneId } : slot,
    ),
    activePaneId: paneId,
    maximizedPaneId: null,
    updatedAt: now,
  } as TState;

  return showResult(
    nextState,
    true,
    paneId,
    displacedPaneId,
    targetSlot.id,
  );
}

export function presetForVisibleCount(count: number): WorkspaceGridPresetId {
  const safeCount = Number.isFinite(count) ? Math.trunc(count) : 1;
  const normalized = Math.min(PRESET_SEQUENCE.length, Math.max(1, safeCount));
  return PRESET_SEQUENCE[normalized - 1]!;
}

export function materializeSlots(
  preset: WorkspaceGridPresetId,
  paneIds: readonly string[],
): ShelfSlot[] {
  return PRESET_SLOT_IDS[preset].map((id, index) => {
    const paneId = paneIds[index];
    return paneId ? { id, area: id, paneId } : { id, area: id };
  });
}

function resolveTargetSlot(state: Pick<ShelfGridState, "slots" | "activePaneId">): ShelfSlot | undefined {
  return (
    state.slots.find((slot) => slot.paneId === state.activePaneId) ??
    state.slots.find((slot) => Boolean(slot.paneId)) ??
    state.slots[0]
  );
}

function updatePaneAndActivate<
  TPane extends ShelfPane,
  TState extends ShelfGridState<TPane>,
>(state: TState, paneId: string, incoming: TPane, now: number): TState {
  return {
    ...state,
    panes: state.panes.map((pane) =>
      pane.id === paneId
        ? ({
            ...pane,
            ...incoming,
            id: paneId,
            createdAt: pane.createdAt,
            storageNamespace: pane.storageNamespace ?? incoming.storageNamespace,
            mountPolicy: "eager",
            updatedAt: now,
          } as TPane)
        : pane,
    ),
    activePaneId: paneId,
    maximizedPaneId: null,
    updatedAt: now,
  } as TState;
}

function updatePaneWithoutPlacement<
  TPane extends ShelfPane,
  TState extends ShelfGridState<TPane>,
>(state: TState, paneId: string, incoming: TPane, now: number): TState {
  return {
    ...state,
    panes: state.panes.map((pane) =>
      pane.id === paneId
        ? ({
            ...pane,
            ...incoming,
            id: paneId,
            createdAt: pane.createdAt,
            storageNamespace: pane.storageNamespace ?? incoming.storageNamespace,
            updatedAt: now,
          } as TPane)
        : pane,
    ),
    updatedAt: now,
  } as TState;
}

function normalizeLimits(input?: Partial<ShelfLimits>): ShelfLimits {
  const requestedVisible = input?.maxVisible;
  const requestedTotal = input?.maxTotal;
  const maxVisible = Math.min(
    6,
    Math.max(
      1,
      Number.isFinite(requestedVisible)
        ? Math.trunc(requestedVisible as number)
        : DEFAULT_SHELF_LIMITS.maxVisible,
    ),
  );
  const maxTotal = Math.max(
    maxVisible,
    Number.isFinite(requestedTotal)
      ? Math.trunc(requestedTotal as number)
      : DEFAULT_SHELF_LIMITS.maxTotal,
  );
  return { maxVisible, maxTotal };
}

function counts(state: Pick<ShelfGridState, "panes" | "slots">) {
  const visibleCount = getVisiblePaneIds(state).length;
  return {
    visibleCount,
    shelfCount: Math.max(0, state.panes.length - visibleCount),
  };
}

function result<TState extends ShelfGridState>(
  state: TState,
  kind: OpenPanePlacementKind,
  paneId: string | null,
  displacedPaneId?: string,
  targetSlotId?: string,
): OpenPanePlacementResult<TState> {
  return {
    state,
    kind,
    paneId,
    displacedPaneId,
    targetSlotId,
    ...counts(state),
  };
}

function showResult<TState extends ShelfGridState>(
  state: TState,
  changed: boolean,
  paneId: string | null,
  displacedPaneId?: string,
  targetSlotId?: string,
): ShowPaneResult<TState> {
  return {
    state,
    changed,
    paneId,
    displacedPaneId,
    targetSlotId,
    ...counts(state),
  };
}
