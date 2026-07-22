// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspaceGridState } from "./gridMigration";
import { useWorkspaceGridStore } from "./gridStore";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  observations: vi.fn(),
  capabilities: vi.fn(),
  subscribe: vi.fn(),
}));

vi.mock("@/services/agentRoomService", () => ({
  syncAgentRoomPaneSessions: mocks.sync,
  listAgentRoomObservations: mocks.observations,
  getAgentRoomCapabilities: mocks.capabilities,
  subscribeAgentRoomEvents: mocks.subscribe,
}));

import {
  selectObservedSessions,
  useAgentRoomObservationStore,
} from "./agentRoomObservationStore";
import {
  buildPaneSessionSnapshot,
  usePaneSessionRegistry,
} from "./usePaneSessionRegistry";

describe("Pane Session Registry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useWorkspaceGridStore.setState(createDefaultWorkspaceGridState(100));
    useAgentRoomObservationStore.setState({
      panes: [],
      observations: {},
      pinnedSessionIds: [],
      recentEvents: {},
      lastAppliedSeq: 0,
      capabilities: null,
      pump: null,
      observerRunning: false,
      syncErrorCode: undefined,
    });
    mocks.sync.mockImplementation(async ({ generation, panes }) => ({
      acceptedGeneration: generation,
      observedSessionIds: panes.flatMap((pane: { effectiveSessionId?: string }) =>
        pane.effectiveSessionId ? [pane.effectiveSessionId] : [],
      ),
    }));
    mocks.observations.mockResolvedValue({
      items: [],
      panes: [],
      pinnedSessionIds: [],
      observerRunning: true,
    });
    mocks.capabilities.mockResolvedValue({
      runtimeProvider: "fake",
      core: true,
      observer: true,
      multiSessionObservation: true,
      sessionTranscript: true,
      userPromptEvents: true,
      abort: true,
      approval: true,
      nativeFollowUp: false,
      degradations: [],
    });
    mocks.subscribe.mockResolvedValue(() => undefined);
  });

  it("uses the active session and models maximized panes as the only visible pane", () => {
    const state = createDefaultWorkspaceGridState(100);
    state.panes[0]!.sessionId = "persisted";
    state.panes[0]!.activeSessionId = "active";
    state.panes[1]!.sessionId = "chat-session";
    const snapshot = buildPaneSessionSnapshot(
      state.panes,
      state.slots,
      "pane-code",
      "pane-code",
    );

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      effectiveSessionId: "active",
      persistedSessionId: "persisted",
      activeSessionId: "active",
      visible: true,
      active: true,
      maximized: true,
    });
  });

  it("projects six Code panes without inventing sessions for empty panes", () => {
    const panes = Array.from({ length: 6 }, (_, index) => ({
      id: `pane-${index + 1}`,
      kind: "code" as const,
      carrier: "iframe" as const,
      title: `Code ${index + 1}`,
      sessionId: index === 5 ? undefined : `session-${index + 1}`,
      storageNamespace: `pane-${index + 1}`,
      mountPolicy: "eager" as const,
      loadState: "ready" as const,
      createdAt: index,
      updatedAt: index,
    }));
    const slots = panes.map((pane, index) => ({
      id: `slot-${index + 1}`,
      area: `area-${index + 1}`,
      paneId: pane.id,
    }));

    const snapshot = buildPaneSessionSnapshot(panes, slots, "pane-1", null);

    expect(snapshot).toHaveLength(6);
    expect(snapshot.filter((pane) => pane.effectiveSessionId)).toHaveLength(5);
    expect(snapshot.find((pane) => pane.paneId === "pane-6")?.effectiveSessionId).toBeUndefined();
  });

  it("deduplicates sessions while retaining every pane and a stable primary", () => {
    const sessions = selectObservedSessions({
      panes: [
        pane("pane-shelf", "session-1", false, false),
        pane("pane-active", "session-1", true, true),
      ],
      observations: {},
      pinnedSessionIds: ["session-1", "session-closed"],
      recentEvents: {},
    });

    expect(sessions).toHaveLength(2);
    expect(sessions.find((item) => item.sessionId === "session-1")).toMatchObject({
      paneIds: ["pane-active", "pane-shelf"],
      primaryPaneId: "pane-active",
      visible: true,
      pinned: true,
    });
    expect(sessions.find((item) => item.sessionId === "session-closed")).toMatchObject({
      paneIds: [],
      pinned: true,
    });
  });

  it("trailing-debounces sync when the Agent Room capability is available without a Room pane", async () => {
    const store = useWorkspaceGridStore.getState();
    store.setPreset("1x3");
    store.configurePane("pane-code", { kind: "code", sessionId: "session-1" });
    const { unmount } = renderHook(() => usePaneSessionRegistry());
    await act(async () => Promise.resolve());

    await act(async () => vi.advanceTimersByTimeAsync(249));
    expect(mocks.sync).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.sync.mock.calls[0][0].panes[0].effectiveSessionId).toBe("session-1");
    unmount();
  });

  it("recovers a stale generation once from the accepted generation detail", async () => {
    useWorkspaceGridStore.getState().setPreset("1x3");
    useWorkspaceGridStore.getState().addPane({ kind: "agent_room", roomId: "room-1" });
    mocks.sync
      .mockRejectedValueOnce({
        code: "stale_generation",
        details: { acceptedGeneration: 8_000_000_000_000_000 },
      })
      .mockResolvedValueOnce({
        acceptedGeneration: 8_000_000_000_000_001,
        observedSessionIds: [],
      });
    renderHook(() => usePaneSessionRegistry());
    await act(async () => Promise.resolve());

    await act(async () => vi.advanceTimersByTimeAsync(250));
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(mocks.sync).toHaveBeenCalledTimes(2);
    expect(mocks.sync.mock.calls[1][0].generation).toBeGreaterThan(
      mocks.sync.mock.calls[0][0].generation,
    );
    expect(useAgentRoomObservationStore.getState().syncErrorCode).toBeUndefined();
  });

  it("applies event sequence only once and keeps pane-manual events by session", () => {
    const event = {
      seq: 3,
      eventId: "event-3",
      sessionId: "session-1",
      kind: "run.reply_delta",
      textDelta: "A",
      createdAt: "2026-07-18T00:00:00Z",
    };
    useAgentRoomObservationStore.getState().applyEvents([event, event]);

    expect(useAgentRoomObservationStore.getState().lastAppliedSeq).toBe(3);
    expect(useAgentRoomObservationStore.getState().recentEvents["session-1"]).toEqual([
      event,
    ]);
  });
});

function pane(
  paneId: string,
  effectiveSessionId: string,
  visible: boolean,
  active: boolean,
) {
  return {
    paneId,
    effectiveSessionId,
    visible,
    active,
    maximized: false,
    mountPolicy: "eager",
    loadState: "ready",
    generation: 1,
    updatedAt: "2026-07-18T00:00:00Z",
  };
}
