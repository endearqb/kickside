import { create } from "zustand";
import type {
  AgentRoomCapabilities,
  AgentRoomEvent,
  AgentRoomPumpStatus,
  PaneSessionObservation,
  SessionObservation,
} from "@/app/types";

export interface ObservedSessionView {
  sessionId: string;
  paneIds: string[];
  primaryPaneId?: string;
  visible: boolean;
  pinned: boolean;
  workDir?: string;
  observation?: SessionObservation;
  recentEvents: AgentRoomEvent[];
}

interface AgentRoomObservationState {
  panes: PaneSessionObservation[];
  observations: Record<string, SessionObservation>;
  pinnedSessionIds: string[];
  recentEvents: Record<string, AgentRoomEvent[]>;
  lastAppliedSeq: number;
  capabilities: AgentRoomCapabilities | null;
  pump: AgentRoomPumpStatus | null;
  observerRunning: boolean;
  syncErrorCode?: string;
  setPaneSnapshot: (panes: PaneSessionObservation[]) => void;
  setObservationSnapshot: (
    items: SessionObservation[],
    pinnedSessionIds: string[],
    observerRunning: boolean,
  ) => void;
  setCapabilities: (capabilities: AgentRoomCapabilities | null) => void;
  setPump: (pump: AgentRoomPumpStatus) => void;
  setSyncError: (code?: string) => void;
  applyEvents: (events: AgentRoomEvent[]) => void;
}

export const useAgentRoomObservationStore = create<AgentRoomObservationState>()(
  (set) => ({
    panes: [],
    observations: {},
    pinnedSessionIds: [],
    recentEvents: {},
    lastAppliedSeq: 0,
    capabilities: null,
    pump: null,
    observerRunning: false,
    setPaneSnapshot: (panes) => set({ panes }),
    setObservationSnapshot: (items, pinnedSessionIds, observerRunning) =>
      set({
        observations: Object.fromEntries(items.map((item) => [item.sessionId, item])),
        pinnedSessionIds: [...new Set(pinnedSessionIds)].sort(),
        observerRunning,
      }),
    setCapabilities: (capabilities) => set({ capabilities }),
    setPump: (pump) => set({ pump }),
    setSyncError: (syncErrorCode) => set({ syncErrorCode }),
    applyEvents: (events) =>
      set((state) => {
        const ordered = events
          .filter((event) => event.seq > state.lastAppliedSeq)
          .sort((left, right) => left.seq - right.seq);
        if (!ordered.length) {
          return state;
        }
        const recentEvents = { ...state.recentEvents };
        let lastAppliedSeq = state.lastAppliedSeq;
        for (const event of ordered) {
          if (event.seq <= lastAppliedSeq) {
            continue;
          }
          lastAppliedSeq = event.seq;
          if (!event.sessionId) {
            continue;
          }
          recentEvents[event.sessionId] = [
            ...(recentEvents[event.sessionId] ?? []),
            event,
          ].slice(-50);
        }
        return {
          recentEvents,
          lastAppliedSeq,
        };
      }),
  }),
);

export function selectObservedSessions(
  state: Pick<
    AgentRoomObservationState,
    "panes" | "observations" | "pinnedSessionIds" | "recentEvents"
  >,
): ObservedSessionView[] {
  const bySession = new Map<string, ObservedSessionView>();
  for (const pane of state.panes) {
    const sessionId = pane.effectiveSessionId?.trim();
    if (!sessionId) {
      continue;
    }
    const current = bySession.get(sessionId) ?? {
      sessionId,
      paneIds: [],
      visible: false,
      pinned: false,
      recentEvents: [],
    };
    current.paneIds.push(pane.paneId);
    current.visible ||= pane.visible;
    current.workDir ||= pane.workDir;
    if (
      !current.primaryPaneId ||
      panePriority(pane) >
        panePriority(state.panes.find((item) => item.paneId === current.primaryPaneId)!)
    ) {
      current.primaryPaneId = pane.paneId;
    }
    bySession.set(sessionId, current);
  }
  for (const sessionId of [
    ...Object.keys(state.observations),
    ...state.pinnedSessionIds,
  ]) {
    const current = bySession.get(sessionId) ?? {
      sessionId,
      paneIds: [],
      visible: false,
      pinned: false,
      recentEvents: [],
    };
    current.observation = state.observations[sessionId];
    current.pinned = state.pinnedSessionIds.includes(sessionId);
    current.workDir ||= current.observation?.workDir;
    bySession.set(sessionId, current);
  }
  for (const item of bySession.values()) {
    item.paneIds.sort();
    item.primaryPaneId ??= item.paneIds[0];
    item.recentEvents = state.recentEvents[item.sessionId] ?? [];
  }
  return [...bySession.values()].sort((left, right) => {
    const leftActivity = left.observation?.lastEventAt ?? "";
    const rightActivity = right.observation?.lastEventAt ?? "";
    return rightActivity.localeCompare(leftActivity) || left.sessionId.localeCompare(right.sessionId);
  });
}

function panePriority(pane: PaneSessionObservation): number {
  if (pane.active) return 4;
  if (pane.maximized) return 3;
  if (pane.visible) return 2;
  return 1;
}
