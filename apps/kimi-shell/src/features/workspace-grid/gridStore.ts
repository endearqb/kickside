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
export const WORKSPACE_GRID_MAX_PANES = 6;

type BrowserStorage = Pick<Storage, "getItem" | "setItem">;

export interface WorkspaceGridActions {
  setPreset: (preset: WorkspaceGridPresetId) => void;
  addPane: (pane: AddWorkspacePaneInput, targetSlotId?: string) => string | null;
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
        const assignedPaneIds = state.slots
          .map((slot) => slot.paneId)
          .filter((paneId): paneId is string => Boolean(paneId));
        const assignedPaneIdSet = new Set(assignedPaneIds);
        for (const pane of state.panes) {
          if (!assignedPaneIdSet.has(pane.id)) {
            assignedPaneIds.push(pane.id);
            assignedPaneIdSet.add(pane.id);
          }
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
      if (state.panes.length >= WORKSPACE_GRID_MAX_PANES) {
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
      const pane: WorkspacePane = {
        id: paneId,
        kind: input.kind,
        carrier: "iframe",
        title: input.title ?? defaultPaneTitle(input.kind),
        sessionId: input.sessionId,
        url: sanitizeUrl(input.url),
        workDir: sanitizeWorkDir(input.workDir),
        theme: isPaneTheme(input.theme) ? input.theme : undefined,
        storageNamespace:
          sanitizeStorageNamespace(input.storageNamespace) ??
          createPaneStorageNamespace(paneId),
        mountPolicy: "eager",
        loadState: "idle",
        createdAt: now,
        updatedAt: now,
      };

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
  const activePaneId =
    parsed.activePaneId && paneIds.has(parsed.activePaneId)
      ? parsed.activePaneId
      : (panes[0]?.id ?? null);
  const maximizedPaneId =
    parsed.maximizedPaneId && paneIds.has(parsed.maximizedPaneId)
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
    if (sanitizedPanes.length >= WORKSPACE_GRID_MAX_PANES) {
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
    url: sanitizeUrl(pane.url),
    workDir: sanitizeWorkDir(pane.workDir),
    theme: isPaneTheme(pane.theme) ? pane.theme : undefined,
    storageNamespace:
      sanitizeStorageNamespace(pane.storageNamespace) ??
      createPaneStorageNamespace(pane.id),
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

function sanitizeWorkDir(workDir?: string): string | undefined {
  const trimmed = workDir?.trim();
  return trimmed || undefined;
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
  return window.localStorage;
}
