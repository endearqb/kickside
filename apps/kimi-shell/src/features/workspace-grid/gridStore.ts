import { create, type StateCreator } from "zustand";
import { createStore, type StoreApi } from "zustand/vanilla";
import { materializeGridSlots } from "./gridPresets";
import {
  createDefaultWorkspaceGridState,
  migrateLegacyWorkspaceGridState,
} from "./gridMigration";
import { normalizeEmbeddableUrl } from "./urlSafety";
import type {
  WorkspaceGridPersistedState,
  WorkspaceGridPresetId,
  WorkspaceGridSavedLayout,
  WorkspaceGridStateV1,
  WorkspacePane,
  WorkspacePaneKind,
} from "./gridTypes";

export const WORKSPACE_GRID_STATE_STORAGE_KEY = "kimi-workspace-grid-state-v1";
export const WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY =
  "kimi-workspace-grid-saved-layouts-v1";
export const WORKSPACE_GRID_MAX_PANES = 6;

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export interface WorkspaceGridActions {
  setPreset: (preset: WorkspaceGridPresetId) => void;
  addPane: (pane: AddWorkspacePaneInput) => string | null;
  removePane: (paneId: string) => void;
  movePane: (paneId: string, slotId: string) => void;
  maximizePane: (paneId: string | null) => void;
  setActivePane: (paneId: string | null) => void;
  setPaneMountPolicy: (
    paneId: string,
    mountPolicy: WorkspacePane["mountPolicy"],
  ) => void;
  changePaneKind: (paneId: string, kind: WorkspacePaneKind) => void;
  configurePane: (paneId: string, input: AddWorkspacePaneInput) => void;
  restoreGridState: (state: WorkspaceGridPersistedState) => void;
}

export type WorkspaceGridStore = WorkspaceGridStateV1 & WorkspaceGridActions;

export interface AddWorkspacePaneInput {
  kind: WorkspacePaneKind;
  title?: string;
  sessionId?: string;
  url?: string;
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
        const assignedPaneIds = state.slots
          .map((slot) => slot.paneId)
          .filter((paneId): paneId is string => Boolean(paneId));
        return {
          ...state,
          preset,
          slots: materializeGridSlots(preset, assignedPaneIds),
          maximizedPaneId: null,
          updatedAt: Date.now(),
        };
      });
    },
    addPane(input) {
      const state = get();
      if (state.panes.length >= WORKSPACE_GRID_MAX_PANES) {
        return null;
      }
      const firstEmptySlot = state.slots.find((slot) => !slot.paneId);
      if (!firstEmptySlot) {
        return null;
      }

      const now = Date.now();
      const paneId = createPaneId(input.kind);
      const pane: WorkspacePane = {
        id: paneId,
        kind: input.kind,
        carrier: "iframe",
        title: input.title ?? defaultPaneTitle(input.kind),
        sessionId: input.sessionId,
        url: sanitizeUrl(input.url),
        mountPolicy: "on-focus",
        loadState: "idle",
        createdAt: now,
        updatedAt: now,
      };

      update(set, storage, (current) => ({
        ...current,
        panes: [...current.panes, pane],
        slots: current.slots.map((slot) =>
          slot.id === firstEmptySlot.id ? { ...slot, paneId } : slot,
        ),
        activePaneId: paneId,
        updatedAt: now,
      }));

      return paneId;
    },
    removePane(paneId) {
      update(set, storage, (state) => {
        const panes = state.panes.filter((pane) => pane.id !== paneId);
        const slots = state.slots.map((slot) =>
          slot.paneId === paneId ? { ...slot, paneId: undefined } : slot,
        );
        const activePaneId =
          state.activePaneId === paneId ? (panes[0]?.id ?? null) : state.activePaneId;
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
                updatedAt: Date.now(),
              }
            : pane,
        ),
        activePaneId: paneId,
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
    !parsed.preset ||
    !Array.isArray(parsed.panes) ||
    !Array.isArray(parsed.slots)
  ) {
    return null;
  }
  return {
    version: 1,
    preset: parsed.preset,
    panes: parsed.panes.map(sanitizePane),
    slots: parsed.slots,
    activePaneId: parsed.activePaneId ?? null,
    maximizedPaneId: parsed.maximizedPaneId ?? null,
    legacySplitRatio: parsed.legacySplitRatio,
    updatedAt: parsed.updatedAt ?? Date.now(),
  };
}

function sanitizePane(pane: WorkspacePane): WorkspacePane {
  return {
    ...pane,
    url: sanitizeUrl(pane.url),
  };
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

function defaultPaneTitle(kind: WorkspacePaneKind): string {
  if (kind === "code") return "Kimi Code";
  if (kind === "chat") return "Kimi Chat";
  return "外部网页";
}

function createPaneId(kind: WorkspacePaneKind): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `pane-${kind}-${random}`;
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
  return window.localStorage;
}
