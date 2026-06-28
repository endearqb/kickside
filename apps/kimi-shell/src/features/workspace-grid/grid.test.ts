import { describe, expect, it } from "vitest";
import {
  WORKSPACE_ACTIVE_VIEW_STORAGE_KEY,
  WORKSPACE_LAYOUT_MODE_STORAGE_KEY,
  WORKSPACE_SPLIT_ORDER_STORAGE_KEY,
  WORKSPACE_SPLIT_RATIO_STORAGE_KEY,
} from "@/app/theme";
import { GRID_PRESETS, resizeGridTrackSizes } from "./gridPresets";
import { buildCodePaneUrl } from "./paneUrl";
import { migrateLegacyWorkspaceGridState } from "./gridMigration";
import {
  WORKSPACE_GRID_MAX_PANES,
  createWorkspaceGridStore,
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

  it("persists custom track sizes and clears them when changing presets", () => {
    const store = createWorkspaceGridStore(undefined, null);

    store.getState().setPreset("1x3");
    store.getState().setGridTrackSizes({ columns: [1.8, 0.8, 1] });

    expect(toPersistedWorkspaceGridState(store.getState()).trackSizes?.columns).toEqual([
      1.8,
      0.8,
      1,
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
    ).toBe("http://127.0.0.1:1234/sessions/a%2Fb%20c");
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
