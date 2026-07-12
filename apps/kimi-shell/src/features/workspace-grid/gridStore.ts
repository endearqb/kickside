import { create, type StateCreator } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  GRID_PRESETS,
  materializeGridSlots,
  normalizeGridTrackSizes,
} from "./gridPresets";
import {
  createDefaultWorkspaceGridState,
  migrateLegacyWorkspaceGridState,
} from "./gridMigration";
import { getKimiAssistantDisplayName } from "@/lib/appBrand";
import { normalizeEmbeddableUrl } from "./urlSafety";
import type {
  WorkspaceGridPersistedState,
  WorkspaceGridPresetId,
  WorkspaceGridSavedLayout,
  WorkspaceGridStateV1,
  WorkspaceGridTrackSizes,
  WorkspacePane,
  WorkspacePaneKind,
  WorkspacePaneTheme,
} from "./gridTypes";

export const WORKSPACE_GRID_STATE_STORAGE_KEY = "kimi-workspace-grid-state-v1";
export const WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY =
  "kimi-workspace-grid-saved-layouts-v1";
export const WORKSPACE_GRID_MAX_VISIBLE_PANES = 6;
export const WORKSPACE_GRID_MAX_TOTAL_PANES = 12;
export const WORKSPACE_GRID_MAX_PANES = WORKSPACE_GRID_MAX_VISIBLE_PANES;

export type ExplorerPanePlacement = {
  kind: "added_visible" | "added_swapped" | "reused_visible" | "reused_swapped" | "limit_reached";
  paneId: string | null;
  displacedPaneId?: string;
};

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export interface WorkspaceGridActions {
  setPreset: (preset: WorkspaceGridPresetId) => void;
  addPane: (pane: AddWorkspacePaneInput, targetSlotId?: string) => string | null;
  openPaneFromExplorer: (pane: AddWorkspacePaneInput) => ExplorerPanePlacement;
  showPane: (paneId: string, targetSlotId?: string) => void;
  removePane: (paneId: string) => void;
  movePane: (paneId: string, slotId: string) => void;
  swapSlots: (sourceSlotId: string, targetSlotId: string) => void;
  maximizePane: (paneId: string | null) => void;
  setActivePane: (paneId: string | null) => void;
  setPaneMountPolicy: (
    paneId: string,
    mountPolicy: WorkspacePane["mountPolicy"],
  ) => void;
  setPaneTheme: (paneId: string, theme: WorkspacePaneTheme | undefined) => void;
  setPaneWorkDir: (paneId: string, workDir: string | undefined) => void;
  setSessionWorkDir: (sessionId: string, workDir: string) => void;
  changePaneKind: (paneId: string, kind: WorkspacePaneKind) => void;
  configurePane: (paneId: string, input: AddWorkspacePaneInput) => void;
  setGridTrackSizes: (trackSizes: WorkspaceGridTrackSizes) => void;
  restoreGridState: (state: WorkspaceGridPersistedState) => void;
}

export type WorkspaceGridStore = WorkspaceGridStateV1 & WorkspaceGridActions;

export interface AddWorkspacePaneInput {
  kind: WorkspacePaneKind;
  title?: string;
  sessionId?: string;
  url?: string;
  workDir?: string;
  theme?: WorkspacePaneTheme;
  storageNamespace?: string;
}

export function loadWorkspaceGridState(
  storage = getBrowserStorage(),
  now = Date.now(),
): WorkspaceGridStateV1 {
  if (!storage) {
    return createDefaultWorkspaceGridState(now);
  }

  const stored = storage.getItem(WORKSPACE_GRID_STATE_STORAGE_KEY);
  if (stored) {
    const parsed = parseWorkspaceGridState(stored);
    if (parsed) {
      return parsed;
    }
  }

  return migrateLegacyWorkspaceGridState(storage, now);
}

export function toPersistedWorkspaceGridState(
  state: WorkspaceGridStateV1,
): WorkspaceGridPersistedState {
  return {
    version: 1,
    preset: state.preset,
    panes: state.panes.map(sanitizePane),
    slots: state.slots,
    activePaneId: state.activePaneId,
    maximizedPaneId: state.maximizedPaneId,
    legacySplitRatio: state.legacySplitRatio,
    trackSizes: normalizeGridTrackSizes(state.trackSizes, state.preset),
    updatedAt: state.updatedAt,
  };
}

export function saveWorkspaceGridState(
  state: WorkspaceGridStateV1,
  storage = getBrowserStorage(),
): void {
  if (!storage) {
    return;
  }
  storage.setItem(
    WORKSPACE_GRID_STATE_STORAGE_KEY,
    JSON.stringify(toPersistedWorkspaceGridState(state)),
  );
}

export function loadWorkspaceGridSavedLayouts(
  storage = getBrowserStorage(),
): WorkspaceGridSavedLayout[] {
  if (!storage) {
    return [];
  }

  try {
    const parsed = JSON.parse(
      storage.getItem(WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY) ?? "[]",
    ) as Partial<WorkspaceGridSavedLayout>[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((layout) => sanitizeSavedLayout(layout))
      .filter((layout): layout is WorkspaceGridSavedLayout => Boolean(layout));
  } catch {
    return [];
  }
}

export function saveWorkspaceGridSavedLayouts(
  layouts: readonly WorkspaceGridSavedLayout[],
  storage = getBrowserStorage(),
): void {
  if (!storage) {
    return;
  }
  storage.setItem(WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY, JSON.stringify(layouts));
}

export function upsertWorkspaceGridSavedLayout(
  layouts: readonly WorkspaceGridSavedLayout[],
  name: string,
  state: WorkspaceGridStateV1,
  now = Date.now(),
): WorkspaceGridSavedLayout[] {
  const trimmedName = name.trim();
  const existing = layouts.find((layout) => layout.name === trimmedName);
  const savedState = {
    ...toPersistedWorkspaceGridState(state),
    maximizedPaneId: null,
    updatedAt: now,
  };

  if (existing) {
    return layouts.map((layout) =>
      layout.id === existing.id
        ? {
            ...layout,
            state: savedState,
            updatedAt: now,
          }
        : layout,
    );
  }

  return [
    ...layouts,
    {
      id: createLayoutId(now),
      name: trimmedName,
      state: savedState,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function createWorkspaceGridStore(
  initialState = createDefaultWorkspaceGridState(),
  storage?: BrowserStorage | null,
): StoreApi<WorkspaceGridStore> {
  return createStore<WorkspaceGridStore>()(
    createWorkspaceGridSlice(initialState, storage ?? null),
  );
}

export const useWorkspaceGridStore = create<WorkspaceGridStore>()(
  createWorkspaceGridSlice(loadWorkspaceGridState()),
);

function createWorkspaceGridSlice(
  initialState: WorkspaceGridStateV1,
  storage: BrowserStorage | null = getBrowserStorage(),
): StateCreator<WorkspaceGridStore> {
  return (set, get) => ({
    ...initialState,
    setPreset(preset) {
      update(set, storage, (state) => {
        const paneIdSet = new Set(state.panes.map((pane) => pane.id));
        const visiblePaneIds = state.slots
          .map((slot) => slot.paneId)
          .filter((paneId): paneId is string => Boolean(paneId));
        const assignedPaneIds: string[] = [];
        const assignedPaneIdSet = new Set<string>();
        const pushPaneId = (paneId: string | null | undefined) => {
          if (paneId && paneIdSet.has(paneId) && !assignedPaneIdSet.has(paneId)) {
            assignedPaneIds.push(paneId);
            assignedPaneIdSet.add(paneId);
          }
        };
        pushPaneId(state.activePaneId);
        for (const paneId of visiblePaneIds) {
          pushPaneId(paneId);
        }
        for (const pane of state.panes) {
          pushPaneId(pane.id);
        }
        return {
          ...state,
          preset,
          slots: materializeGridSlots(preset, assignedPaneIds),
          maximizedPaneId: null,
          trackSizes: undefined,
          updatedAt: Date.now(),
        };
      });
    },
    addPane(input, targetSlotId) {
      const state = get();
      if (state.panes.length >= WORKSPACE_GRID_MAX_TOTAL_PANES) {
        return null;
      }
      const targetSlot = targetSlotId
        ? state.slots.find((slot) => slot.id === targetSlotId && !slot.paneId)
        : state.slots.find((slot) => !slot.paneId);
      if (!targetSlot) {
        return null;
      }

      const now = Date.now();
      const paneId = createPaneId(input.kind);
      const pane = createWorkspacePane(input, paneId, now);

      update(set, storage, (current) => ({
        ...current,
        panes: [...current.panes, pane],
        slots: current.slots.map((slot) =>
          slot.id === targetSlot.id ? { ...slot, paneId } : slot,
        ),
        activePaneId: paneId,
        updatedAt: now,
      }));

      return paneId;
    },
    openPaneFromExplorer(input) {
      let result: ExplorerPanePlacement = { kind: "limit_reached", paneId: null };
      update(set, storage, (state) => {
        const now = Date.now();
        const existing = input.sessionId
          ? state.panes.find((pane) => pane.sessionId === input.sessionId)
          : undefined;
        if (existing) {
          const visibleSlot = state.slots.find((slot) => slot.paneId === existing.id);
          const targetSlot =
            visibleSlot ??
            state.slots.find((slot) => !slot.paneId) ??
            state.slots.find((slot) => slot.paneId === state.activePaneId) ??
            state.slots[0];
          if (!targetSlot) return state;
          const displacedPaneId = visibleSlot ? undefined : targetSlot.paneId;
          result = {
            kind: visibleSlot ? "reused_visible" : "reused_swapped",
            paneId: existing.id,
            displacedPaneId,
          };
          return {
            ...state,
            panes: state.panes.map((pane) =>
              pane.id === existing.id
                ? {
                    ...pane,
                    workDir: sanitizeWorkDir(input.workDir) ?? pane.workDir,
                    updatedAt: now,
                  }
                : pane,
            ),
            slots: visibleSlot
              ? state.slots
              : state.slots.map((slot) =>
                  slot.id === targetSlot.id ? { ...slot, paneId: existing.id } : slot,
                ),
            activePaneId: existing.id,
            maximizedPaneId: null,
            updatedAt: now,
          };
        }
        if (state.panes.length >= WORKSPACE_GRID_MAX_TOTAL_PANES) return state;

        const paneId = createPaneId(input.kind);
        const pane = createWorkspacePane(input, paneId, now);
        const visiblePaneIds = state.slots
          .map((slot) => slot.paneId)
          .filter((id): id is string => Boolean(id));
        const emptySlot = state.slots.find((slot) => !slot.paneId);
        if (emptySlot) {
          result = { kind: "added_visible", paneId };
          return {
            ...state,
            panes: [...state.panes, pane],
            slots: state.slots.map((slot) =>
              slot.id === emptySlot.id ? { ...slot, paneId } : slot,
            ),
            activePaneId: paneId,
            maximizedPaneId: null,
            updatedAt: now,
          };
        }
        if (visiblePaneIds.length < WORKSPACE_GRID_MAX_VISIBLE_PANES) {
          const preset = presetForPaneCount(visiblePaneIds.length + 1);
          result = { kind: "added_visible", paneId };
          return {
            ...state,
            preset,
            panes: [...state.panes, pane],
            slots: materializeGridSlots(preset, [...visiblePaneIds, paneId]),
            activePaneId: paneId,
            maximizedPaneId: null,
            trackSizes: undefined,
            updatedAt: now,
          };
        }

        const targetSlot =
          state.slots.find((slot) => slot.paneId === state.activePaneId) ?? state.slots[0];
        if (!targetSlot) return state;
        result = {
          kind: "added_swapped",
          paneId,
          displacedPaneId: targetSlot.paneId,
        };
        return {
          ...state,
          panes: [...state.panes, pane],
          slots: state.slots.map((slot) =>
            slot.id === targetSlot.id ? { ...slot, paneId } : slot,
          ),
          activePaneId: paneId,
          maximizedPaneId: null,
          updatedAt: now,
        };
      });
      return result;
    },
    showPane(paneId, targetSlotId) {
      update(set, storage, (state) => {
        if (!state.panes.some((pane) => pane.id === paneId)) return state;
        if (state.slots.some((slot) => slot.paneId === paneId)) {
          return { ...state, activePaneId: paneId, maximizedPaneId: null };
        }
        const targetSlot =
          state.slots.find((slot) => slot.id === targetSlotId && !slot.paneId) ??
          state.slots.find((slot) => !slot.paneId) ??
          state.slots.find((slot) => slot.paneId === state.activePaneId) ??
          state.slots[0];
        if (!targetSlot) return state;
        return {
          ...state,
          slots: state.slots.map((slot) =>
            slot.id === targetSlot.id ? { ...slot, paneId } : slot,
          ),
          activePaneId: paneId,
          maximizedPaneId: null,
          updatedAt: Date.now(),
        };
      });
    },
    removePane(paneId) {
      update(set, storage, (state) => {
        const panes = state.panes.filter((pane) => pane.id !== paneId);
        const slots = state.slots.map((slot) =>
          slot.paneId === paneId ? { ...slot, paneId: undefined } : slot,
        );
        const visiblePaneIds = slots
          .map((slot) => slot.paneId)
          .filter((id): id is string => Boolean(id));
        const activePaneId =
          state.activePaneId === paneId
            ? (visiblePaneIds[0] ?? null)
            : state.activePaneId;
        return {
          ...state,
          panes,
          slots,
          activePaneId,
          maximizedPaneId:
            state.maximizedPaneId === paneId ? null : state.maximizedPaneId,
          updatedAt: Date.now(),
        };
      });
    },
    movePane(paneId, slotId) {
      update(set, storage, (state) => {
        if (!state.panes.some((pane) => pane.id === paneId)) {
          return state;
        }
        return {
          ...state,
          slots: state.slots.map((slot) => {
            if (slot.id === slotId) {
              return { ...slot, paneId };
            }
            if (slot.paneId === paneId) {
              return { ...slot, paneId: undefined };
            }
            return slot;
          }),
          activePaneId: paneId,
          updatedAt: Date.now(),
        };
      });
    },
    swapSlots(sourceSlotId, targetSlotId) {
      if (sourceSlotId === targetSlotId) {
        return;
      }
      update(set, storage, (state) => {
        const source = state.slots.find((slot) => slot.id === sourceSlotId);
        const target = state.slots.find((slot) => slot.id === targetSlotId);
        if (!source || !target) {
          return state;
        }
        return {
          ...state,
          slots: state.slots.map((slot) => {
            if (slot.id === sourceSlotId) {
              return { ...slot, paneId: target.paneId };
            }
            if (slot.id === targetSlotId) {
              return { ...slot, paneId: source.paneId };
            }
            return slot;
          }),
          activePaneId: source.paneId ?? state.activePaneId,
          updatedAt: Date.now(),
        };
      });
    },
    maximizePane(paneId) {
      update(set, storage, (state) => ({
        ...state,
        maximizedPaneId: paneId,
        activePaneId: paneId ?? state.activePaneId,
        updatedAt: Date.now(),
      }));
    },
    setActivePane(paneId) {
      update(set, storage, (state) => ({
        ...state,
        activePaneId: paneId,
        updatedAt: Date.now(),
      }));
    },
    setPaneMountPolicy(paneId, mountPolicy) {
      update(set, storage, (state) => ({
        ...state,
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                mountPolicy,
                updatedAt: Date.now(),
              }
            : pane,
        ),
        activePaneId: mountPolicy === "suspended" ? state.activePaneId : paneId,
        updatedAt: Date.now(),
      }));
    },
    setPaneTheme(paneId, theme) {
      update(set, storage, (state) => ({
        ...state,
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                theme: isPaneTheme(theme) ? theme : undefined,
                updatedAt: Date.now(),
              }
            : pane,
        ),
        updatedAt: Date.now(),
      }));
    },
    setPaneWorkDir(paneId, workDir) {
      update(set, storage, (state) => ({
        ...state,
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                workDir: sanitizeWorkDir(workDir),
                updatedAt: Date.now(),
              }
            : pane,
        ),
        updatedAt: Date.now(),
      }));
    },
    setSessionWorkDir(sessionId, workDir) {
      const normalizedSessionId = sessionId.trim();
      const normalizedWorkDir = sanitizeWorkDir(workDir);
      if (!normalizedSessionId || !normalizedWorkDir) {
        return;
      }
      if (
        !get().panes.some(
          (pane) =>
            pane.kind === "code" && pane.sessionId?.trim() === normalizedSessionId,
        )
      ) {
        return;
      }
      update(set, storage, (state) => ({
        ...state,
        panes: state.panes.map((pane) =>
          pane.kind === "code" && pane.sessionId?.trim() === normalizedSessionId
            ? { ...pane, workDir: normalizedWorkDir, updatedAt: Date.now() }
            : pane,
        ),
        updatedAt: Date.now(),
      }));
    },
    changePaneKind(paneId, kind) {
      update(set, storage, (state) => ({
        ...state,
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                kind,
                title: defaultPaneTitle(kind),
                sessionId: undefined,
                url: undefined,
                workDir: undefined,
                storageNamespace:
                  sanitizeStorageNamespace(pane.storageNamespace) ??
                  createPaneStorageNamespace(pane.id),
                updatedAt: Date.now(),
              }
            : pane,
        ),
        updatedAt: Date.now(),
      }));
    },
    configurePane(paneId, input) {
      update(set, storage, (state) => ({
        ...state,
        panes: state.panes.map((pane) =>
          pane.id === paneId
            ? {
                ...pane,
                kind: input.kind,
                title: input.title ?? defaultPaneTitle(input.kind),
                sessionId: input.sessionId,
                url: sanitizeUrl(input.url),
                workDir: sanitizeWorkDir(input.workDir),
                theme: isPaneTheme(input.theme) ? input.theme : pane.theme,
                storageNamespace:
                  sanitizeStorageNamespace(input.storageNamespace) ??
                  sanitizeStorageNamespace(pane.storageNamespace) ??
                  createPaneStorageNamespace(pane.id),
                updatedAt: Date.now(),
              }
            : pane,
        ),
        activePaneId: paneId,
        updatedAt: Date.now(),
      }));
    },
    setGridTrackSizes(trackSizes) {
      update(set, storage, (state) => ({
        ...state,
        trackSizes: normalizeGridTrackSizes(trackSizes, state.preset),
        updatedAt: Date.now(),
      }));
    },
    restoreGridState(restoredState) {
      const sanitized = sanitizeGridState(restoredState);
      if (!sanitized) {
        return;
      }
      update(set, storage, () => ({
        ...sanitized,
        maximizedPaneId: null,
        updatedAt: Date.now(),
      }));
    },
  });
}

function update(
  set: StoreApi<WorkspaceGridStore>["setState"],
  storage: BrowserStorage | null,
  reducer: (state: WorkspaceGridStore) => WorkspaceGridStateV1,
): void {
  set((state) => {
    const next = reducer(state);
    saveWorkspaceGridState(next, storage);
    return next;
  });
}

function parseWorkspaceGridState(raw: string): WorkspaceGridStateV1 | null {
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceGridStateV1>;
    return sanitizeGridState(parsed);
  } catch {
    return null;
  }
}

function sanitizeGridState(
  parsed: Partial<WorkspaceGridStateV1>,
): WorkspaceGridStateV1 | null {
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.panes) ||
    !Array.isArray(parsed.slots)
  ) {
    return null;
  }

  const preset = isGridPresetId(parsed.preset) ? parsed.preset : "1x2";
  const panes = sanitizePanes(parsed.panes);
  const paneIds = new Set(panes.map((pane) => pane.id));
  const assignedPaneIds = parsed.slots
    .map((slot) => slot.paneId)
    .filter((paneId): paneId is string => Boolean(paneId))
    .filter((paneId, index, values) => paneIds.has(paneId) && values.indexOf(paneId) === index)
    .slice(0, GRID_PRESETS[preset].slots.length);
  const slotPaneIds =
    assignedPaneIds.length > 0
      ? assignedPaneIds
      : panes.slice(0, GRID_PRESETS[preset].slots.length).map((pane) => pane.id);
  const visiblePaneIdSet = new Set(slotPaneIds);
  const activePaneId =
    parsed.activePaneId && visiblePaneIdSet.has(parsed.activePaneId)
      ? parsed.activePaneId
      : (slotPaneIds[0] ?? null);
  const maximizedPaneId =
    parsed.maximizedPaneId && visiblePaneIdSet.has(parsed.maximizedPaneId)
      ? parsed.maximizedPaneId
      : null;

  return {
    version: 1,
    preset,
    panes,
    slots: materializeGridSlots(preset, slotPaneIds),
    activePaneId,
    maximizedPaneId,
    legacySplitRatio: parsed.legacySplitRatio,
    trackSizes: normalizeGridTrackSizes(parsed.trackSizes, preset),
    updatedAt: parsed.updatedAt ?? Date.now(),
  };
}

function isGridPresetId(value: unknown): value is WorkspaceGridPresetId {
  return typeof value === "string" && value in GRID_PRESETS;
}

function sanitizePanes(panes: unknown[]): WorkspacePane[] {
  const seenPaneIds = new Set<string>();
  const sanitizedPanes: WorkspacePane[] = [];

  for (const rawPane of panes) {
    const pane = sanitizePaneCandidate(rawPane);
    if (!pane || seenPaneIds.has(pane.id)) {
      continue;
    }
    seenPaneIds.add(pane.id);
    sanitizedPanes.push(pane);
    if (sanitizedPanes.length >= WORKSPACE_GRID_MAX_TOTAL_PANES) {
      break;
    }
  }

  return sanitizedPanes;
}

function sanitizePaneCandidate(value: unknown): WorkspacePane | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const pane = value as Partial<WorkspacePane>;
  if (typeof pane.id !== "string" || !pane.id.trim()) {
    return null;
  }

  const kind = isPaneKind(pane.kind) ? pane.kind : "external";
  const now = Date.now();
  return sanitizePane({
    id: pane.id,
    kind,
    carrier: "iframe",
    title:
      typeof pane.title === "string" && pane.title.trim()
        ? pane.title
        : defaultPaneTitle(kind),
    sessionId: typeof pane.sessionId === "string" ? pane.sessionId : undefined,
    url: typeof pane.url === "string" ? pane.url : undefined,
    workDir: typeof pane.workDir === "string" ? pane.workDir : undefined,
    theme: isPaneTheme(pane.theme) ? pane.theme : undefined,
    storageNamespace:
      typeof pane.storageNamespace === "string" ? pane.storageNamespace : "",
    mountPolicy: isMountPolicy(pane.mountPolicy) ? pane.mountPolicy : "eager",
    loadState: isLoadState(pane.loadState) ? pane.loadState : "idle",
    createdAt: typeof pane.createdAt === "number" ? pane.createdAt : now,
    updatedAt: typeof pane.updatedAt === "number" ? pane.updatedAt : now,
  });
}

function isPaneKind(value: unknown): value is WorkspacePaneKind {
  return value === "code" || value === "chat" || value === "external";
}

function isPaneTheme(value: unknown): value is WorkspacePaneTheme {
  return value === "light" || value === "dark";
}

function isMountPolicy(value: unknown): value is WorkspacePane["mountPolicy"] {
  return (
    value === "eager" ||
    value === "on-focus" ||
    value === "manual" ||
    value === "suspended"
  );
}

function isLoadState(value: unknown): value is WorkspacePane["loadState"] {
  return (
    value === "idle" ||
    value === "loading" ||
    value === "ready" ||
    value === "blocked" ||
    value === "empty" ||
    value === "suspended"
  );
}

function sanitizePane(pane: WorkspacePane): WorkspacePane {
  return {
    ...pane,
    title: normalizePaneTitle(pane.kind, pane.title),
    url: sanitizeUrl(pane.url),
    workDir: sanitizeWorkDir(pane.workDir),
    theme: isPaneTheme(pane.theme) ? pane.theme : undefined,
    storageNamespace:
      sanitizeStorageNamespace(pane.storageNamespace) ??
      createPaneStorageNamespace(pane.id),
  };
}

function normalizePaneTitle(kind: WorkspacePaneKind, title: string): string {
  const trimmed = title.trim();
  if (kind === "code" && (trimmed === "Kimi Code" || trimmed === "Kimi Code Web")) {
    return defaultPaneTitle(kind);
  }
  return trimmed || defaultPaneTitle(kind);
}

function sanitizeSavedLayout(
  layout: Partial<WorkspaceGridSavedLayout>,
): WorkspaceGridSavedLayout | null {
  if (!layout.id || !layout.name || !layout.state) {
    return null;
  }
  const state = sanitizeGridState(layout.state);
  if (!state) {
    return null;
  }
  return {
    id: layout.id,
    name: layout.name,
    state,
    createdAt: layout.createdAt ?? Date.now(),
    updatedAt: layout.updatedAt ?? Date.now(),
  };
}

function sanitizeUrl(url?: string): string | undefined {
  if (!url) {
    return undefined;
  }
  const result = normalizeEmbeddableUrl(url);
  return result.ok ? result.url : undefined;
}

function sanitizeWorkDir(workDir?: string): string | undefined {
  const trimmed = workDir?.trim();
  return trimmed || undefined;
}

function defaultPaneTitle(kind: WorkspacePaneKind): string {
  if (kind === "code") return getKimiAssistantDisplayName();
  if (kind === "chat") return "Kimi Chat";
  return "外部网页";
}

function createWorkspacePane(
  input: AddWorkspacePaneInput,
  paneId: string,
  now: number,
): WorkspacePane {
  return {
    id: paneId,
    kind: input.kind,
    carrier: "iframe",
    title: input.title ?? defaultPaneTitle(input.kind),
    sessionId: input.sessionId,
    url: sanitizeUrl(input.url),
    workDir: sanitizeWorkDir(input.workDir),
    theme: isPaneTheme(input.theme) ? input.theme : undefined,
    storageNamespace:
      sanitizeStorageNamespace(input.storageNamespace) ?? createPaneStorageNamespace(paneId),
    mountPolicy: "eager",
    loadState: "idle",
    createdAt: now,
    updatedAt: now,
  };
}

function presetForPaneCount(count: number): WorkspaceGridPresetId {
  return (["single", "1x2", "1x3", "2x2", "2x3-5", "2x3"] as const)[
    Math.max(0, Math.min(WORKSPACE_GRID_MAX_VISIBLE_PANES - 1, count - 1))
  ];
}

function createPaneId(kind: WorkspacePaneKind): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `pane-${kind}-${random}`;
}

function createPaneStorageNamespace(paneId: string): string {
  return `workspace-grid-${sanitizeStorageNamespace(paneId) ?? "pane"}`;
}

function sanitizeStorageNamespace(namespace?: string): string | undefined {
  const sanitized = namespace?.trim().replace(/[^a-zA-Z0-9._-]/g, "-");
  return sanitized || undefined;
}

function createLayoutId(now: number): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `layout-${now}-${random}`;
}

function getBrowserStorage(): BrowserStorage | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage;
  return storage &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function"
    ? storage
    : null;
}
