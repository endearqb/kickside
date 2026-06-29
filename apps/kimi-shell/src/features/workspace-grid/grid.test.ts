import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ACTIVE_VIEW_STORAGE_KEY,
  WORKSPACE_LAYOUT_MODE_STORAGE_KEY,
  WORKSPACE_SPLIT_ORDER_STORAGE_KEY,
  WORKSPACE_SPLIT_RATIO_STORAGE_KEY,
} from "@/app/theme";
import { GRID_PRESETS, getGridTrackCounts, resizeGridTrackSizes } from "./gridPresets";
import { buildCodePaneUrl } from "./paneUrl";
import { migrateLegacyWorkspaceGridState } from "./gridMigration";
import {
  WORKSPACE_GRID_MAX_PANES,
  WORKSPACE_GRID_STATE_STORAGE_KEY,
  createWorkspaceGridStore,
  loadWorkspaceGridState,
  loadWorkspaceGridSavedLayouts,
  saveWorkspaceGridSavedLayouts,
  toPersistedWorkspaceGridState,
  upsertWorkspaceGridSavedLayout,
} from "./gridStore";
import { normalizeEmbeddableUrl } from "./urlSafety";

function storage(values: Record<string, string>) {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
  };
}

function writableStorage(values: Record<string, string> = {}) {
  return {
    getItem(key: string) {
      return values[key] ?? null;
    },
    setItem(key: string, value: string) {
      values[key] = value;
    },
  };
}

describe("workspace grid presets", () => {
  it("keeps the five-pane preset as explicit slots and areas", () => {
    const preset = GRID_PRESETS["2x3-5"];

    expect(preset.slots).toHaveLength(5);
    expect(preset.areas).toContain("primary");
    expect(preset.areas).toContain("tail");
  });

  it("uses a left-plus-stacked-right layout for the three-pane preset", () => {
    const preset = GRID_PRESETS["1x3"];

    expect(preset.label).toBe("三窗布局");
    expect(preset.areas).toBe('"left top" "left bottom"');
    expect(preset.slots.map((slot) => slot.id)).toEqual([
      "left",
      "top",
      "bottom",
    ]);
    expect(getGridTrackCounts("1x3")).toEqual({ columns: 2, rows: 2 });
  });
});

describe("legacy workspace migration", () => {
  it("turns split chat-left state into a two-slot grid without dropping panes", () => {
    const state = migrateLegacyWorkspaceGridState(
      storage({
        [WORKSPACE_ACTIVE_VIEW_STORAGE_KEY]: "chat",
        [WORKSPACE_LAYOUT_MODE_STORAGE_KEY]: "split",
        [WORKSPACE_SPLIT_ORDER_STORAGE_KEY]: "chat_left",
        [WORKSPACE_SPLIT_RATIO_STORAGE_KEY]: "0.6",
      }),
      100,
    );

    expect(state.preset).toBe("1x2");
    expect(state.panes.map((pane) => pane.id)).toEqual(["pane-code", "pane-chat"]);
    expect(state.slots.map((slot) => slot.paneId)).toEqual([
      "pane-chat",
      "pane-code",
    ]);
    expect(state.activePaneId).toBe("pane-chat");
    expect(state.legacySplitRatio).toBe(0.6);
  });

  it("keeps both legacy panes while showing only the active single pane", () => {
    const state = migrateLegacyWorkspaceGridState(
      storage({
        [WORKSPACE_ACTIVE_VIEW_STORAGE_KEY]: "chat",
        [WORKSPACE_LAYOUT_MODE_STORAGE_KEY]: "single",
      }),
      100,
    );

    expect(state.preset).toBe("single");
    expect(state.panes).toHaveLength(2);
    expect(state.slots).toEqual([
      { id: "main", area: "main", paneId: "pane-chat" },
    ]);
  });
});

describe("workspace grid store", () => {
  it("moves a pane into one slot and clears its previous slot", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().movePane("pane-code", "right");

    expect(store.getState().slots.map((slot) => slot.paneId)).toEqual([
      undefined,
      "pane-code",
    ]);
    expect(store.getState().activePaneId).toBe("pane-code");
  });

  it("adds a pane directly to the requested empty slot", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPreset("2x2");
    const paneId = store.getState().addPane({ kind: "chat" }, "bottom-right");
    const state = store.getState();

    expect(paneId).toEqual(expect.stringContaining("pane-chat-"));
    expect(state.slots.map((slot) => [slot.id, slot.paneId])).toEqual([
      ["top-left", "pane-code"],
      ["top-right", "pane-chat"],
      ["bottom-left", undefined],
      ["bottom-right", paneId],
    ]);
  });

  it("restores hidden panes when expanding the grid preset", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPreset("2x3");
    while (store.getState().panes.length < WORKSPACE_GRID_MAX_PANES) {
      store.getState().addPane({ kind: "chat" });
    }
    const paneIds = store.getState().panes.map((pane) => pane.id);

    store.getState().setPreset("single");
    expect(store.getState().slots.map((slot) => slot.paneId)).toEqual([
      paneIds[0],
    ]);

    store.getState().setPreset("2x3");
    expect(store.getState().slots.map((slot) => slot.paneId)).toEqual(paneIds);
  });

  it("swaps occupied slots and moves panes into empty slots", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().swapSlots("left", "right");
    expect(store.getState().slots.map((slot) => slot.paneId)).toEqual([
      "pane-chat",
      "pane-code",
    ]);

    store.getState().setPreset("1x3");
    store.getState().swapSlots("top", "bottom");
    expect(store.getState().slots.map((slot) => slot.paneId)).toEqual([
      "pane-chat",
      undefined,
      "pane-code",
    ]);
  });

  it("reconfigures a pane to Code without adding a session id", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().configurePane("pane-chat", {
      kind: "code",
      workDir: "D:/work",
    });

    const pane = store.getState().panes.find((item) => item.id === "pane-chat");
    expect(pane).toMatchObject({
      kind: "code",
      title: "Kimi Code",
      sessionId: undefined,
      workDir: "D:/work",
    });
  });

  it("reconfigures a pane to a server session", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().configurePane("pane-code", {
      kind: "code",
      sessionId: "ses_123",
      workDir: "D:/work",
    });

    const pane = store.getState().panes.find((item) => item.id === "pane-code");
    expect(pane).toMatchObject({
      kind: "code",
      sessionId: "ses_123",
      workDir: "D:/work",
    });
  });

  it("does not persist URL fragments", () => {
    const store = createWorkspaceGridStore(undefined, null);
    const paneId = store.getState().addPane({
      kind: "external",
      url: "https://kimi.com/chat#token=secret",
    });

    expect(paneId).toBeNull();

    store.getState().setPreset("1x3");
    const createdPaneId = store.getState().addPane({
      kind: "external",
      url: "https://kimi.com/chat#token=secret",
    });
    const persisted = toPersistedWorkspaceGridState(store.getState());
    const lastPane = persisted.panes[persisted.panes.length - 1];

    expect(createdPaneId).toEqual(expect.stringContaining("pane-external-"));
    expect(lastPane?.url).toBe("https://kimi.com/chat");
    expect(lastPane?.storageNamespace).toEqual(
      expect.stringContaining("workspace-grid-pane-external-"),
    );
  });

  it("keeps pane workDir/theme optional while loading persisted panes", () => {
    const state = loadWorkspaceGridState(
      writableStorage({
        [WORKSPACE_GRID_STATE_STORAGE_KEY]: JSON.stringify({
          version: 1,
          preset: "single",
          panes: [
            {
              id: "pane-code",
              kind: "code",
              carrier: "iframe",
              title: "Kimi Code",
              workDir: " D:/work ",
              theme: "dark",
              mountPolicy: "eager",
              loadState: "idle",
              createdAt: 100,
              updatedAt: 100,
            },
          ],
          slots: [{ id: "main", area: "main", paneId: "pane-code" }],
          activePaneId: "pane-code",
          maximizedPaneId: null,
          updatedAt: 100,
        }),
      }),
      100,
    );
    const persisted = toPersistedWorkspaceGridState(state);

    expect(persisted.panes[0]?.storageNamespace).toBe("workspace-grid-pane-code");
    expect(persisted.panes[0]?.workDir).toBe("D:/work");
    expect(persisted.panes[0]?.theme).toBe("dark");
  });

  it("caps panes at the v1 resource limit", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPreset("2x3");
    for (let index = 0; index < WORKSPACE_GRID_MAX_PANES; index += 1) {
      store.getState().addPane({ kind: "external", url: "https://kimi.com/" });
    }

    expect(store.getState().panes).toHaveLength(WORKSPACE_GRID_MAX_PANES);
    expect(
      store.getState().addPane({ kind: "external", url: "https://kimi.com/" }),
    ).toBeNull();
  });

  it("mounts newly added panes eagerly", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPreset("1x3");
    const paneId = store.getState().addPane({
      kind: "external",
      url: "https://kimi.com/",
    });
    const pane = store.getState().panes.find((item) => item.id === paneId);

    expect(pane?.mountPolicy).toBe("eager");
  });

  it("persists pane mount policy changes", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPaneMountPolicy("pane-chat", "suspended");

    const pane = store.getState().panes.find((item) => item.id === "pane-chat");
    expect(pane?.mountPolicy).toBe("suspended");
  });

  it("reconfigures external panes through URL safety", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().configurePane("pane-chat", {
      kind: "external",
      title: "Unsafe",
      url: "javascript:alert(1)",
    });

    const pane = store.getState().panes.find((item) => item.id === "pane-chat");
    expect(pane?.kind).toBe("external");
    expect(pane?.url).toBeUndefined();
  });

  it("saves and restores named layouts without URL fragments", () => {
    const storage = writableStorage();
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPreset("1x3");
    store.getState().addPane({
      kind: "external",
      title: "Docs",
      url: "https://example.com/docs#token=secret",
    });
    const layouts = upsertWorkspaceGridSavedLayout(
      [],
      "Docs layout",
      store.getState(),
      200,
    );
    saveWorkspaceGridSavedLayouts(layouts, storage);

    const saved = loadWorkspaceGridSavedLayouts(storage);
    const savedPanes = saved[0]?.state.panes ?? [];
    expect(saved).toHaveLength(1);
    expect(saved[0]?.state.maximizedPaneId).toBeNull();
    expect(savedPanes[savedPanes.length - 1]?.url).toBe("https://example.com/docs");

    store.getState().setPreset("single");
    store.getState().restoreGridState(saved[0]!.state);
    expect(store.getState().preset).toBe("1x3");
  });

  it("normalizes damaged persisted grid state before rendering", () => {
    const persistedPanes = Array.from(
      { length: WORKSPACE_GRID_MAX_PANES + 2 },
      (_, index) => persistedPane(`pane-${index}`),
    );
    const state = loadWorkspaceGridState(
      writableStorage({
        [WORKSPACE_GRID_STATE_STORAGE_KEY]: JSON.stringify({
          version: 1,
          preset: "missing",
          panes: persistedPanes,
          slots: [
            { id: "ghost", area: "ghost", paneId: "ghost-pane" },
            { id: "left", area: "left", paneId: "pane-1" },
            { id: "duplicate", area: "duplicate", paneId: "pane-1" },
            { id: "right", area: "right", paneId: "pane-0" },
          ],
          activePaneId: "ghost-pane",
          maximizedPaneId: "pane-7",
          trackSizes: { columns: [1, 2, 3] },
          updatedAt: 100,
        }),
      }),
      100,
    );

    expect(state.preset).toBe("1x2");
    expect(state.panes).toHaveLength(WORKSPACE_GRID_MAX_PANES);
    expect(state.slots).toEqual([
      { id: "left", area: "left", paneId: "pane-1" },
      { id: "right", area: "right", paneId: "pane-0" },
    ]);
    expect(state.activePaneId).toBe("pane-0");
    expect(state.maximizedPaneId).toBeNull();
    expect(state.trackSizes).toBeUndefined();
  });

  it("persists custom track sizes and clears them when changing presets", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPreset("1x3");
    store.getState().setGridTrackSizes({ columns: [1.8, 0.8] });

    expect(toPersistedWorkspaceGridState(store.getState()).trackSizes?.columns).toEqual([
      1.8,
      0.8,
    ]);

    store.getState().setPreset("2x2");
    expect(store.getState().trackSizes).toBeUndefined();
  });
});

describe("workspace grid track resizing", () => {
  it("resizes adjacent tracks while preserving their combined size", () => {
    expect(resizeGridTrackSizes([1, 1, 1], 0, 150, 900)).toEqual([
      1.5,
      0.5,
      1,
    ]);
    expect(resizeGridTrackSizes([1, 1], 0, 900, 900)).toEqual([1.8, 0.2]);
  });
});

describe("pane URL helpers", () => {
  it("builds session URLs from the origin and server session id", () => {
    expect(
      buildCodePaneUrl("http://127.0.0.1:1234/#token=secret", "a/b c"),
    ).toBe("http://127.0.0.1:1234/sessions/a%2Fb%20c#token=secret");
  });
});

describe("URL safety", () => {
  it("allows only http URLs and strips fragments", () => {
    expect(normalizeEmbeddableUrl("https://kimi.com/#token=secret")).toEqual({
      ok: true,
      url: "https://kimi.com/",
    });
    expect(normalizeEmbeddableUrl("javascript:alert(1)")).toEqual({
      ok: false,
      reason: "unsupported_protocol",
    });
    expect(normalizeEmbeddableUrl("")).toEqual({
      ok: false,
      reason: "empty",
    });
  });
});

function persistedPane(id: string) {
  return {
    id,
    kind: "external" as const,
    carrier: "iframe" as const,
    title: id,
    url: "https://example.com/#token=secret",
    storageNamespace: "",
    mountPolicy: "eager" as const,
    loadState: "idle" as const,
    createdAt: 100,
    updatedAt: 100,
  };
}
