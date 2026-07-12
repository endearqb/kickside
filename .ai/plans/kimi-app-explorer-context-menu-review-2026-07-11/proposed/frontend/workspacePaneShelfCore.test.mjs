import assert from "node:assert/strict";
import test from "node:test";
import {
  getShelfPanes,
  getVisiblePaneIds,
  materializeSlots,
  openPaneFromExplorer,
  showPaneFromShelf,
} from "./dist/workspacePaneShelfCore.js";
import { RequestIdDeduper } from "./dist/requestIdDeduper.js";
import { resolveDisposition, resolvePaneForSessionUpdate } from "./dist/sessionPaneRouting.js";

function pane(id, sessionId = id, updatedAt = 1) {
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

function state(count, preset) {
  const panes = Array.from({ length: count }, (_, index) => pane(`p${index + 1}`));
  const sequence = ["single", "1x2", "1x3", "2x2", "2x3-5", "2x3"];
  const resolvedPreset = preset ?? sequence[Math.max(0, Math.min(5, count - 1))];
  return {
    preset: resolvedPreset,
    panes,
    slots: materializeSlots(resolvedPreset, panes.map((item) => item.id)),
    activePaneId: panes.at(-1)?.id ?? null,
    maximizedPaneId: null,
    updatedAt: 1,
  };
}

test("grows the layout by one when all current slots are occupied", () => {
  const current = state(3, "1x3");
  const result = openPaneFromExplorer(current, pane("p4", "s4"), { now: 10 });
  assert.equal(result.kind, "added_visible");
  assert.equal(result.state.preset, "2x2");
  assert.equal(result.visibleCount, 4);
  assert.equal(result.shelfCount, 0);
  assert.equal(result.state.activePaneId, "p4");
});

test("uses an existing empty slot without shrinking a larger preset", () => {
  const current = state(2, "2x3");
  const result = openPaneFromExplorer(current, pane("p3", "s3"), { now: 10 });
  assert.equal(result.state.preset, "2x3");
  assert.equal(result.visibleCount, 3);
  assert.equal(result.state.slots[2]?.paneId, "p3");
});

test("six visible panes: new pane swaps into active slot and old pane is shelved", () => {
  const current = state(6, "2x3");
  current.activePaneId = "p4";
  const result = openPaneFromExplorer(current, pane("p7", "s7"), { now: 10 });
  assert.equal(result.kind, "added_swapped");
  assert.equal(result.displacedPaneId, "p4");
  assert.equal(result.state.activePaneId, "p7");
  assert.equal(result.visibleCount, 6);
  assert.equal(result.shelfCount, 1);
  assert.deepEqual(getShelfPanes(result.state).map((item) => item.id), ["p4"]);
  assert.equal(result.state.panes.find((item) => item.id === "p4")?.mountPolicy, "on-focus");
});

test("reveals a hidden pane by swapping it into the active slot", () => {
  const current = state(7, "2x3");
  current.slots = materializeSlots("2x3", ["p1", "p2", "p3", "p4", "p5", "p6"]);
  current.activePaneId = "p2";
  const result = showPaneFromShelf(current, "p7", { now: 20 });
  assert.equal(result.changed, true);
  assert.equal(result.displacedPaneId, "p2");
  assert.equal(result.state.activePaneId, "p7");
  assert.deepEqual(getShelfPanes(result.state).map((item) => item.id), ["p2"]);
});

test("duplicate session delivery is idempotent", () => {
  const current = state(2, "1x2");
  const duplicate = pane("new-id-that-must-not-be-used", "p2");
  const result = openPaneFromExplorer(current, duplicate, { now: 10 });
  assert.equal(result.kind, "reused_visible");
  assert.equal(result.state.panes.length, 2);
  assert.equal(result.state.activePaneId, "p2");
});

test("rejects a thirteenth pane but permits reuse of an existing session", () => {
  const current = state(12, "2x3");
  current.slots = materializeSlots("2x3", current.panes.slice(0, 6).map((item) => item.id));
  const rejected = openPaneFromExplorer(current, pane("p13", "s13"), { now: 10 });
  assert.equal(rejected.kind, "limit_reached");
  assert.equal(rejected.state.panes.length, 12);
  const reused = openPaneFromExplorer(current, pane("replacement-id", "p12"), { now: 11 });
  assert.equal(reused.kind, "reused_swapped");
  assert.equal(reused.state.panes.length, 12);
  assert.ok(getVisiblePaneIds(reused.state).includes("p12"));
});

test("request id deduper rejects the second event and accepts after TTL", () => {
  const deduper = new RequestIdDeduper({ ttlMs: 1_000, maxEntries: 32 });
  assert.equal(deduper.accept("req-1", 1_000), true);
  assert.equal(deduper.accept("req-1", 1_500), false);
  assert.equal(deduper.accept("req-1", 2_001), true);
});

test("session workDir updates are matched by session id", () => {
  const panes = [
    { id: "a", kind: "code", sessionId: "session-a" },
    { id: "b", kind: "code", sessionId: "session-b" },
  ];
  assert.equal(resolvePaneForSessionUpdate(panes, "session-b")?.id, "b");
  assert.equal(resolvePaneForSessionUpdate(panes, "unknown"), null);
});

test("Explorer sources default to new_pane", () => {
  assert.equal(resolveDisposition({ action: "navigate_session", source: "open_dir_request" }), "new_pane");
  assert.equal(resolveDisposition({ action: "navigate_session", source: "backend_ready_bootstrap" }), "replace_active");
  assert.equal(resolveDisposition({ action: "navigate_session", source: "x", disposition: "new_pane" }), "new_pane");
});
