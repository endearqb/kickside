import { useCallback, useEffect, useRef, useState } from "react";
import {
  getDshPreflight,
  getDshSettings,
  getDshStatus,
  installDsh,
  saveDshSettings,
  startDsh,
  stopDsh,
  type DshInstallEvent,
  type DshPreflight,
  type DshSettings,
  type DshStatus,
} from "@/services/dshService";

const PREFLIGHT_TTL_MS = 60_000;
const ACTIVE_STATUS_POLL_MS = 1_000;
const BACKGROUND_STATUS_POLL_MS = 5_000;

export type DshRefreshOptions = {
  preflight?: "none" | "cached" | "force";
};

export type DshBusyAction = "toggle" | "install" | "start" | "stop" | null;

export type DshControllerModel = {
  settings: DshSettings | null;
  preflight: DshPreflight | null;
  status: DshStatus | null;
  error: string | null;
  busy: boolean;
  busyAction: DshBusyAction;
  refresh: (options?: DshRefreshOptions) => Promise<DshStatus | null>;
  toggle: (enabled: boolean) => Promise<DshSettings | null>;
  install: (
    onEvent?: (event: DshInstallEvent) => void,
  ) => Promise<DshPreflight | null>;
  start: (workspaceDir: string) => Promise<DshStatus | null>;
  stop: () => Promise<DshStatus | null>;
};

export function useDshController(
  tauriRuntime: boolean,
  foreground = false,
): DshControllerModel {
  const [settings, setSettings] = useState<DshSettings | null>(null);
  const [preflight, setPreflight] = useState<DshPreflight | null>(null);
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<DshBusyAction>(null);
  const preflightRef = useRef<DshPreflight | null>(null);
  const preflightCheckedAtRef = useRef(0);
  const preflightPromiseRef = useRef<Promise<DshPreflight | null> | null>(null);
  const refreshPromiseRef = useRef<Promise<DshStatus | null> | null>(null);

  useEffect(() => {
    preflightRef.current = preflight;
  }, [preflight]);

  const refreshPreflight = useCallback(
    async (force = false) => {
      if (!tauriRuntime) return null;

      const cacheIsFresh =
        preflightRef.current !== null &&
        Date.now() - preflightCheckedAtRef.current < PREFLIGHT_TTL_MS;
      if (!force && cacheIsFresh) return preflightRef.current;
      if (preflightPromiseRef.current) return preflightPromiseRef.current;

      const request = (async () => {
        try {
          const nextPreflight = await getDshPreflight();
          preflightRef.current = nextPreflight;
          preflightCheckedAtRef.current = Date.now();
          setPreflight(nextPreflight);
          return nextPreflight;
        } catch (cause) {
          setError(formatError(cause));
          return null;
        }
      })();
      preflightPromiseRef.current = request;
      try {
        return await request;
      } finally {
        if (preflightPromiseRef.current === request) {
          preflightPromiseRef.current = null;
        }
      }
    },
    [tauriRuntime],
  );

  const refresh = useCallback(
    async (options: DshRefreshOptions = {}) => {
      if (!tauriRuntime) return null;

      const request =
        refreshPromiseRef.current ??
        (async () => {
          try {
            const [nextSettings, nextStatus] = await Promise.all([
              getDshSettings(),
              getDshStatus(),
            ]);
            setSettings(nextSettings);
            setStatus(nextStatus);
            setError(nextStatus.lastError ?? null);
            return nextStatus;
          } catch (cause) {
            setError(formatError(cause));
            return null;
          }
        })();
      refreshPromiseRef.current = request;

      try {
        const nextStatus = await request;
        const preflightMode = options.preflight ?? "none";
        if (preflightMode !== "none") {
          await refreshPreflight(preflightMode === "force");
        }
        return nextStatus;
      } finally {
        if (refreshPromiseRef.current === request) {
          refreshPromiseRef.current = null;
        }
      }
    },
    [refreshPreflight, tauriRuntime],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!tauriRuntime || !settings?.enabled) return;
    void refreshPreflight();
  }, [refreshPreflight, settings?.enabled, tauriRuntime]);

  useEffect(() => {
    if (!tauriRuntime || !settings?.enabled) return;
    const pollMs = foreground
      ? ACTIVE_STATUS_POLL_MS
      : BACKGROUND_STATUS_POLL_MS;
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [foreground, refresh, settings?.enabled, tauriRuntime]);

  const toggle = useCallback(
    async (enabled: boolean) => {
      if (!settings) return null;
      setBusyAction("toggle");
      setError(null);
      try {
        const nextSettings = await saveDshSettings({
          enabled,
          portRange: settings.portRange,
          startTimeoutSec: settings.startTimeoutSec,
        });
        setSettings(nextSettings);
        await refresh();
        if (enabled) {
          await refreshPreflight();
        }
        return nextSettings;
      } catch (cause) {
        setError(formatError(cause));
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [refresh, refreshPreflight, settings],
  );

  const install = useCallback(
    async (onEvent?: (event: DshInstallEvent) => void) => {
      setBusyAction("install");
      setError(null);
      try {
        const nextPreflight = await installDsh(onEvent);
        preflightRef.current = nextPreflight;
        preflightCheckedAtRef.current = Date.now();
        setPreflight(nextPreflight);
        await refresh();
        return nextPreflight;
      } catch (cause) {
        setError(formatError(cause));
        return null;
      } finally {
        setBusyAction(null);
      }
    },
    [refresh],
  );

  const start = useCallback(async (workspaceDir: string) => {
    setBusyAction("start");
    setError(null);
    try {
      const next = await startDsh(workspaceDir);
      setStatus(next);
      setError(next.lastError ?? null);
      return next;
    } catch (cause) {
      const message = formatError(cause);
      setError(message);
      return null;
    } finally {
      setBusyAction(null);
    }
  }, []);

  const stop = useCallback(async () => {
    setBusyAction("stop");
    setError(null);
    try {
      const next = await stopDsh();
      setStatus(next);
      setError(next.lastError ?? null);
      return next;
    } catch (cause) {
      setError(formatError(cause));
      return null;
    } finally {
      setBusyAction(null);
    }
  }, []);

  return {
    settings,
    preflight,
    status,
    error,
    busy: busyAction !== null,
    busyAction,
    refresh,
    toggle,
    install,
    start,
    stop,
  };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
