import { useCallback, useEffect, useRef, useState } from "react";
import {
  getKimiAccessStatus,
  getKimiLanLaunchUrl,
  getKimiRemoteLaunchUrl,
  setKimiAccessMode,
  type KimiAccessMode,
  type KimiAccessStatus,
  type KimiLanLaunchUrl,
  type KimiRemoteLaunchUrl,
} from "@/services/lanAccessService";

export type LanAccessControllerModel = {
  status: KimiAccessStatus | null;
  error: string | null;
  busy: boolean;
  refresh: () => Promise<KimiAccessStatus | null>;
  setMode: (mode: KimiAccessMode) => Promise<KimiAccessStatus | null>;
  getLaunchUrl: (ip: string) => Promise<KimiLanLaunchUrl | null>;
  getRemoteLaunchUrl: () => Promise<KimiRemoteLaunchUrl | null>;
};

export function useLanAccessController(
  tauriRuntime: boolean,
  onRuntimeChanged?: () => void | Promise<void>,
): LanAccessControllerModel {
  const [status, setStatus] = useState<KimiAccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshRef = useRef<Promise<KimiAccessStatus | null> | null>(null);

  const refresh = useCallback(async () => {
    if (!tauriRuntime) return null;
    if (refreshRef.current) return refreshRef.current;
    const request = getKimiAccessStatus()
      .then((next) => {
        setStatus(next);
        setError(next.lastError ?? null);
        return next;
      })
      .catch((cause) => {
        setError(formatError(cause));
        return null;
      });
    refreshRef.current = request;
    try {
      return await request;
    } finally {
      if (refreshRef.current === request) refreshRef.current = null;
    }
  }, [tauriRuntime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const shouldPoll = status?.switching || status?.mode === "kimi_remote";
    if (!tauriRuntime || !shouldPoll) return;
    const timer = window.setInterval(() => void refresh(), status?.switching ? 750 : 1_500);
    return () => window.clearInterval(timer);
  }, [refresh, status?.mode, status?.switching, tauriRuntime]);

  const setMode = useCallback(async (mode: KimiAccessMode) => {
    if (!tauriRuntime || busy) return null;
    setBusy(true);
    setError(null);
    try {
      const next = await setKimiAccessMode(mode);
      setStatus(next);
      return next;
    } catch (cause) {
      const message = formatError(cause);
      setError(message);
      await refresh();
      setError(message);
      return null;
    } finally {
      try {
        await onRuntimeChanged?.();
      } catch {
        // The LAN command result remains authoritative; Shell refresh is best-effort.
      }
      setBusy(false);
    }
  }, [busy, onRuntimeChanged, refresh, tauriRuntime]);

  const getLaunchUrl = useCallback(async (ip: string) => {
    if (!tauriRuntime) return null;
    setError(null);
    try {
      return await getKimiLanLaunchUrl(ip);
    } catch (cause) {
      setError(formatError(cause));
      await refresh();
      return null;
    }
  }, [refresh, tauriRuntime]);

  const getRemoteLaunchUrl = useCallback(async () => {
    if (!tauriRuntime) return null;
    setError(null);
    try {
      return await getKimiRemoteLaunchUrl();
    } catch (cause) {
      setError(formatError(cause));
      await refresh();
      return null;
    }
  }, [refresh, tauriRuntime]);

  return {
    status,
    error,
    busy: busy || status?.switching === true,
    refresh,
    setMode,
    getLaunchUrl,
    getRemoteLaunchUrl,
  };
}

function formatError(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
