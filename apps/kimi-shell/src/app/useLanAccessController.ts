import { useCallback, useEffect, useRef, useState } from "react";
import {
  getKimiLanAccessStatus,
  getKimiLanLaunchUrl,
  setKimiLanAccess,
  type KimiLanAccessStatus,
  type KimiLanLaunchUrl,
} from "@/services/lanAccessService";

export type LanAccessControllerModel = {
  status: KimiLanAccessStatus | null;
  error: string | null;
  busy: boolean;
  refresh: () => Promise<KimiLanAccessStatus | null>;
  toggle: (enabled: boolean) => Promise<KimiLanAccessStatus | null>;
  getLaunchUrl: (ip: string) => Promise<KimiLanLaunchUrl | null>;
};

export function useLanAccessController(
  tauriRuntime: boolean,
  onRuntimeChanged?: () => void | Promise<void>,
): LanAccessControllerModel {
  const [status, setStatus] = useState<KimiLanAccessStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshRef = useRef<Promise<KimiLanAccessStatus | null> | null>(null);

  const refresh = useCallback(async () => {
    if (!tauriRuntime) return null;
    if (refreshRef.current) return refreshRef.current;
    const request = getKimiLanAccessStatus()
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
    if (!tauriRuntime || !status?.switching) return;
    const timer = window.setInterval(() => void refresh(), 750);
    return () => window.clearInterval(timer);
  }, [refresh, status?.switching, tauriRuntime]);

  const toggle = useCallback(async (enabled: boolean) => {
    if (!tauriRuntime || busy) return null;
    setBusy(true);
    setError(null);
    try {
      const next = await setKimiLanAccess(enabled);
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

  return { status, error, busy: busy || status?.switching === true, refresh, toggle, getLaunchUrl };
}

function formatError(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
