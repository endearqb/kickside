import { describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY,
  WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY_V1,
  WORKSPACE_GRID_STATE_STORAGE_KEY,
  WORKSPACE_GRID_STATE_STORAGE_KEY_V1,
  loadWorkspaceGridSavedLayouts,
  loadWorkspaceGridState,
} from "./gridStore";

function storageWith(values: Record<string, string>) {
  const data = new Map(Object.entries(values));
  return {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    data,
  };
}

function v1State() {
  return {
    version: 1,
    preset: "single",
    panes: [
      {
        id: "pane-code",
        kind: "code",
        carrier: "iframe",
        title: "Kimi Code",
        sessionId: "session-1",
        workDir: "D:/repo",
        theme: "dark",
        storageNamespace: "workspace-grid-pane-code",
        mountPolicy: "eager",
        loadState: "ready",
        createdAt: 10,
        updatedAt: 20,
      },
    ],
    slots: [{ id: "single-main", area: "main", paneId: "pane-code" }],
    activePaneId: "pane-code",
    maximizedPaneId: "pane-code",
    trackSizes: { columns: [1] },
    updatedAt: 30,
  };
}

describe("workspace grid v1 to v2 migration", () => {
  it("prefers valid v2 and never mutates the v1 rollback key", () => {
    const v2 = { ...v1State(), version: 2, activePaneId: "pane-code" };
    const rawV1 = JSON.stringify(v1State());
    const storage = storageWith({
      [WORKSPACE_GRID_STATE_STORAGE_KEY]: JSON.stringify(v2),
      [WORKSPACE_GRID_STATE_STORAGE_KEY_V1]: rawV1,
    });

    const loaded = loadWorkspaceGridState(storage, 100);

    expect(loaded.version).toBe(2);
    expect(loaded.panes[0]?.sessionId).toBe("session-1");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.get(WORKSPACE_GRID_STATE_STORAGE_KEY_V1)).toBe(rawV1);
  });

  it("migrates v1 in memory when v2 is absent or damaged", () => {
    const rawV1 = JSON.stringify(v1State());
    const storage = storageWith({
      [WORKSPACE_GRID_STATE_STORAGE_KEY]: "{damaged",
      [WORKSPACE_GRID_STATE_STORAGE_KEY_V1]: rawV1,
    });

    const loaded = loadWorkspaceGridState(storage, 100);

    expect(loaded).toMatchObject({
      version: 2,
      preset: "single",
      activePaneId: "pane-code",
      maximizedPaneId: "pane-code",
      trackSizes: undefined,
    });
    expect(loaded.panes[0]).toMatchObject({
      id: "pane-code",
      carrier: "iframe",
      sessionId: "session-1",
      workDir: "D:/repo",
    });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.get(WORKSPACE_GRID_STATE_STORAGE_KEY_V1)).toBe(rawV1);
  });

  it("migrates saved-layout embedded states but respects an explicit empty v2 list", () => {
    const rawV1 = JSON.stringify([
      { id: "layout-1", name: "旧布局", state: v1State(), createdAt: 1, updatedAt: 2 },
    ]);
    const migratedStorage = storageWith({
      [WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY_V1]: rawV1,
    });

    const migrated = loadWorkspaceGridSavedLayouts(migratedStorage);

    expect(migrated).toHaveLength(1);
    expect(migrated[0]?.state.version).toBe(2);
    expect(migratedStorage.setItem).not.toHaveBeenCalled();
    expect(
      migratedStorage.data.get(WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY_V1),
    ).toBe(rawV1);

    const clearedStorage = storageWith({
      [WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY]: "[]",
      [WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY_V1]: rawV1,
    });
    expect(loadWorkspaceGridSavedLayouts(clearedStorage)).toEqual([]);
  });

  it("falls back to the saved-layout v1 key when v2 is damaged", () => {
    const rawV1 = JSON.stringify([
      { id: "layout-1", name: "旧布局", state: v1State(), createdAt: 1, updatedAt: 2 },
    ]);
    const storage = storageWith({
      [WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY]: "{damaged",
      [WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY_V1]: rawV1,
    });

    expect(loadWorkspaceGridSavedLayouts(storage)[0]?.state.version).toBe(2);
    expect(storage.data.get(WORKSPACE_GRID_SAVED_LAYOUTS_STORAGE_KEY_V1)).toBe(rawV1);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("normalizes local Agent Room panes and removes duplicate room references", () => {
    const roomPane = {
      id: "pane-room-1",
      kind: "agent_room",
      carrier: "iframe",
      title: "Room",
      roomId: " room-1 ",
      sessionId: "must-clear",
      url: "https://example.com",
      workDir: "D:/must-clear",
      storageNamespace: "must-clear",
      mountPolicy: "eager",
      loadState: "ready",
      createdAt: 1,
      updatedAt: 1,
    };
    const storage = storageWith({
      [WORKSPACE_GRID_STATE_STORAGE_KEY]: JSON.stringify({
        version: 2,
        preset: "1x2",
        panes: [roomPane, { ...roomPane, id: "pane-room-duplicate" }],
        slots: [
          { id: "split-left", area: "left", paneId: "pane-room-1" },
          { id: "split-right", area: "right", paneId: "pane-room-duplicate" },
        ],
        activePaneId: "pane-room-duplicate",
        maximizedPaneId: null,
        updatedAt: 1,
      }),
    });

    const loaded = loadWorkspaceGridState(storage);

    expect(loaded.panes).toHaveLength(1);
    expect(loaded.panes[0]).toMatchObject({
      id: "pane-room-1",
      kind: "agent_room",
      carrier: "local",
      roomId: "room-1",
    });
    expect(loaded.panes[0]?.sessionId).toBeUndefined();
    expect(loaded.panes[0]?.url).toBeUndefined();
    expect(loaded.panes[0]?.workDir).toBeUndefined();
    expect(loaded.panes[0]?.storageNamespace).toBeUndefined();
  });
});
