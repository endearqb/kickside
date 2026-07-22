import { describe, expect, it } from "vitest";
import { buildCandidates } from "./AgentRoomAddMemberDialog";

describe("buildCandidates", () => {
  it("groups active, visible, shelf, and observation-only sessions without inventing IDs", () => {
    const candidates = buildCandidates([
      { paneId: "p1", effectiveSessionId: "s1", visible: true, active: true, maximized: false, mountPolicy: "always", loadState: "ready", generation: 1, updatedAt: "" },
      { paneId: "p2", effectiveSessionId: "s2", visible: true, active: false, maximized: false, mountPolicy: "always", loadState: "ready", generation: 1, updatedAt: "" },
      { paneId: "p3", effectiveSessionId: "s3", visible: false, active: false, maximized: false, mountPolicy: "always", loadState: "ready", generation: 1, updatedAt: "" },
      { paneId: "empty", visible: true, active: false, maximized: false, mountPolicy: "always", loadState: "ready", generation: 1, updatedAt: "" },
    ], [{ sessionId: "s4", generation: 1, lastSeq: 0, sessionState: "idle", controlOrigin: "runtime_external", pendingApprovals: 0, updatedAt: "" }]);
    expect(candidates.map((item) => [item.sessionId, item.group])).toEqual([["s1", "current"], ["s2", "visible"], ["s3", "stored"], ["s4", "stored"]]);
  });
});
