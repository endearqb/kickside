import { useEffect, useMemo, useRef, useState } from "react";
import type { PaneSessionObservation } from "@/app/types";
import {
  getAgentRoomCapabilities,
  listAgentRoomObservations,
  subscribeAgentRoomEvents,
  syncAgentRoomPaneSessions,
} from "@/services/agentRoomService";
import { useWorkspaceGridStore } from "./gridStore";
import { useAgentRoomObservationStore } from "./agentRoomObservationStore";

const SYNC_DELAY_MS = 250;
const RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;
let nextGeneration = Date.now() * 1_000;

export function usePaneSessionRegistry() {
  const panes = useWorkspaceGridStore((state) => state.panes);
  const slots = useWorkspaceGridStore((state) => state.slots);
  const activePaneId = useWorkspaceGridStore((state) => state.activePaneId);
  const maximizedPaneId = useWorkspaceGridStore((state) => state.maximizedPaneId);
  const [featureAvailable, setFeatureAvailable] = useState(false);
  const hadDemand = useRef(false);
  const hasDemand = featureAvailable || panes.some((pane) => pane.kind === "agent_room");
  const snapshot = useMemo(
    () => buildPaneSessionSnapshot(panes, slots, activePaneId, maximizedPaneId),
    [activePaneId, maximizedPaneId, panes, slots],
  );

  useEffect(() => {
    let disposed = false;
    void getAgentRoomCapabilities()
      .then((capabilities) => {
        if (!disposed) {
          setFeatureAvailable(capabilities.core);
          useAgentRoomObservationStore.getState().setCapabilities(capabilities);
        }
      })
      .catch(() => {
        if (!disposed) setFeatureAvailable(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!hasDemand && !hadDemand.current) {
      return;
    }
    hadDemand.current = hasDemand;
    let cancelled = false;
    let retryTimer: number | undefined;
    let retryCount = 0;
    let generationRecoveryUsed = false;
    const sync = () => {
      const generation = ++nextGeneration;
      useAgentRoomObservationStore.getState().setPaneSnapshot(snapshot);
      void syncAgentRoomPaneSessions({ generation, panes: hasDemand ? snapshot : [] })
        .then(() => {
          if (!cancelled) {
            retryCount = 0;
            useAgentRoomObservationStore.getState().setSyncError();
            void refreshObservations();
          }
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          const code = commandErrorCode(error);
          useAgentRoomObservationStore.getState().setSyncError(code);
          const acceptedGeneration = commandAcceptedGeneration(error);
          if (
            !generationRecoveryUsed &&
            (code === "stale_generation" || code === "generation_conflict") &&
            acceptedGeneration !== undefined
          ) {
            generationRecoveryUsed = true;
            nextGeneration = Math.max(nextGeneration, acceptedGeneration);
            retryTimer = window.setTimeout(sync, 0);
            return;
          }
          if (isFatalSyncError(code)) {
            return;
          }
          const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)];
          retryCount += 1;
          retryTimer = window.setTimeout(sync, delay);
        });
    };
    const timer = window.setTimeout(sync, SYNC_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [hasDemand, snapshot]);

  useEffect(() => {
    if (!hasDemand) {
      return;
    }
    let disposed = false;
    let refreshTimer: number | undefined;
    let unsubscribe: (() => void) | undefined;
    void refreshObservations()
      .catch((error) => {
        if (!disposed) {
          useAgentRoomObservationStore
            .getState()
            .setSyncError(commandErrorCode(error));
        }
      });
    void subscribeAgentRoomEvents(
      (payload) => {
        if (disposed) {
          return;
        }
        useAgentRoomObservationStore.getState().applyEvents(payload.items);
        if (refreshTimer === undefined) {
          refreshTimer = window.setTimeout(() => {
            refreshTimer = undefined;
            void refreshObservations();
          }, 100);
        }
      },
      (pump) => {
        if (!disposed) {
          useAgentRoomObservationStore.getState().setPump(pump);
        }
      },
    )
      .then((cleanup) => {
        if (disposed) cleanup();
        else unsubscribe = cleanup;
      })
      .catch((error) => {
        if (!disposed) {
          useAgentRoomObservationStore
            .getState()
            .setSyncError(commandErrorCode(error));
        }
      });
    return () => {
      disposed = true;
      unsubscribe?.();
      if (refreshTimer !== undefined) {
        window.clearTimeout(refreshTimer);
      }
    };
  }, [hasDemand]);
}

export function buildPaneSessionSnapshot(
  panes: ReturnType<typeof useWorkspaceGridStore.getState>["panes"],
  slots: ReturnType<typeof useWorkspaceGridStore.getState>["slots"],
  activePaneId: string | null,
  maximizedPaneId: string | null,
): PaneSessionObservation[] {
  const visiblePaneIds = new Set(
    maximizedPaneId
      ? [maximizedPaneId]
      : slots.map((slot) => slot.paneId).filter(Boolean),
  );
  return panes
    .filter((pane) => pane.kind === "code")
    .map((pane) => {
      const persistedSessionId = pane.sessionId?.trim() || undefined;
      const activeSessionId = pane.activeSessionId?.trim() || undefined;
      return {
        paneId: pane.id,
        persistedSessionId,
        activeSessionId,
        effectiveSessionId: activeSessionId || persistedSessionId,
        workDir: pane.workDir?.trim() || undefined,
        visible: visiblePaneIds.has(pane.id),
        active: pane.id === activePaneId,
        maximized: pane.id === maximizedPaneId,
        mountPolicy: pane.mountPolicy,
        loadState: pane.loadState,
        generation: 0,
        updatedAt: "",
      };
    })
    .sort((left, right) => left.paneId.localeCompare(right.paneId));
}

async function refreshObservations() {
  const page = await listAgentRoomObservations();
  useAgentRoomObservationStore
    .getState()
    .setObservationSnapshot(page.items, page.pinnedSessionIds, page.observerRunning);
}

function commandErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) {
      return code;
    }
  }
  return "agent_room_unavailable";
}

function commandAcceptedGeneration(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("details" in error)) {
    return undefined;
  }
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object" || !("acceptedGeneration" in details)) {
    return undefined;
  }
  const generation = (details as { acceptedGeneration?: unknown }).acceptedGeneration;
  return typeof generation === "number" && Number.isSafeInteger(generation)
    ? generation
    : undefined;
}

function isFatalSyncError(code: string): boolean {
  return (
    code === "feature_disabled" ||
    code === "invalid_pane_session" ||
    code === "stale_generation" ||
    code === "generation_conflict"
  );
}
