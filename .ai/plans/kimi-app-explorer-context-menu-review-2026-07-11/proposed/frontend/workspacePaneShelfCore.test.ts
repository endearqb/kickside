import { describe, expect, it } from "vitest";
import {
  getShelfPanes,
  getVisiblePaneIds,
  materializeSlots,
  openPaneFromExplorer,
  showPaneFromShelf,
  type ShelfGridState,
  type ShelfPane,
  type WorkspaceGridPresetId,
} from "./workspacePaneShelfCore";
import { RequestIdDeduper } from "./requestIdDeduper";
import { resolveDisposition, resolvePaneForSessionUpdate } from "./sessionPaneRouting";

function pane(id: string, sessionId = id, updatedAt = 1): ShelfPane {
  return {
    id,
    kind: "code",
    title: id,
    sessionId,
    mountPolicy: "eager",
    createdAt: updatedAt,
    updatedAt,
  };
}

function state(count: number, preset?: WorkspaceGridPresetId): ShelfGridState {
  const panes = Array.from({ length: count }, (_, index) => pane(`p${index + 1}`));
  const sequence: WorkspaceGridPresetId[] = [
    "single",
    "1x2",
    "1x3",
    "2x2",
    "2x3-5",
    "2x3",
  ];
  const resolvedPreset = preset ?? sequence[Math.max(0, Math.min(5, count - 1))]!;
  return {
    preset: resolvedPreset,
    panes,
    slots: materializeSlots(resolvedPreset, panes.map((item) => item.id)),
    activePaneId: panes.at(-1)?.id ?? null,
    maximizedPaneId: null,
    updatedAt: 1,
  };
}

describe("Explorer pane placement", () => {
  it("grows an occupied layout by one", () => {
    const result = openPaneFromExplorer(state(3, "1x3"), pane("p4", "s4"), {
      now: 10,
    });
    expect(result.kind).toBe("added_visible");
    expect(result.state.preset).toBe("2x2");
    expect(result.visibleCount).toBe(4);
    expect(result.state.activePaneId).toBe("p4");
  });

  it("uses an existing empty slot without shrinking a larger preset", () => {
    const result = openPaneFromExplorer(state(2, "2x3"), pane("p3", "s3"), {
      now: 10,
    });
    expect(result.state.preset).toBe("2x3");
    expect(result.state.slots[2]?.paneId).toBe("p3");
  });

  it("swaps a seventh pane into the active slot and shelves the displaced pane", () => {
    const current = state(6, "2x3");
    current.activePaneId = "p4";
    const result = openPaneFromExplorer(current, pane("p7", "s7"), { now: 10 });
    expect(result.kind).toBe("added_swapped");
    expect(result.displacedPaneId).toBe("p4");
    expect(result.visibleCount).toBe(6);
    expect(result.shelfCount).toBe(1);
    expect(getShelfPanes(result.state).map((item) => item.id)).toEqual(["p4"]);
  });

  it("reveals a shelf pane by swapping it into the active slot", () => {
    const current = state(7, "2x3");
    current.slots = materializeSlots("2x3", ["p1", "p2", "p3", "p4", "p5", "p6"]);
    current.activePaneId = "p2";
    const result = showPaneFromShelf(current, "p7", { now: 20 });
    expect(result.displacedPaneId).toBe("p2");
    expect(result.state.activePaneId).toBe("p7");
    expect(getShelfPanes(result.state).map((item) => item.id)).toEqual(["p2"]);
  });

  it("is idempotent for the same session", () => {
    const result = openPaneFromExplorer(
      state(2, "1x2"),
      pane("unused-new-id", "p2"),
      { now: 10 },
    );
    expect(result.kind).toBe("reused_visible");
    expect(result.state.panes).toHaveLength(2);
    expect(result.state.activePaneId).toBe("p2");
  });

  it("rejects a thirteenth pane but permits reuse", () => {
    const current = state(12, "2x3");
    current.slots = materializeSlots(
      "2x3",
      current.panes.slice(0, 6).map((item) => item.id),
    );
    expect(openPaneFromExplorer(current, pane("p13", "s13")).kind).toBe(
      "limit_reached",
    );
    const reused = openPaneFromExplorer(current, pane("unused", "p12"));
    expect(reused.kind).toBe("reused_swapped");
    expect(getVisiblePaneIds(reused.state)).toContain("p12");
  });
});

describe("session event safety", () => {
  it("dedupes repeated request ids", () => {
    const deduper = new RequestIdDeduper({ ttlMs: 1_000 });
    expect(deduper.accept("req-1", 1_000)).toBe(true);
    expect(deduper.accept("req-1", 1_500)).toBe(false);
    expect(deduper.accept("req-1", 2_001)).toBe(true);
  });

  it("matches workDir updates by session id", () => {
    const panes = [
      { id: "a", kind: "code" as const, sessionId: "session-a" },
      { id: "b", kind: "code" as const, sessionId: "session-b" },
    ];
    expect(resolvePaneForSessionUpdate(panes, "session-b")?.id).toBe("b");
    expect(resolvePaneForSessionUpdate(panes, "unknown")).toBeNull();
  });

  it("defaults Explorer events to new_pane", () => {
    expect(resolveDisposition({ action: "navigate_session", source: "open_dir_request" })).toBe(
      "new_pane",
    );
    expect(
      resolveDisposition({ action: "navigate_session", source: "backend_ready_bootstrap" }),
    ).toBe("replace_active");
  });
});
