import { useCallback, useEffect, useState } from "react";
import {
  getDshSettings,
  getDshStatus,
  startDsh,
  type DshSettings,
  type DshStatus,
} from "@/services/dshService";

export function useDshController(tauriRuntime: boolean) {
  const [settings, setSettings] = useState<DshSettings | null>(null);
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!tauriRuntime) return null;
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
  }, [tauriRuntime]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!tauriRuntime || !settings?.enabled) return;
    const timer = window.setInterval(() => void refresh(), 1_000);
    return () => window.clearInterval(timer);
  }, [refresh, settings?.enabled, tauriRuntime]);

  const start = useCallback(async (workspaceDir: string) => {
    setBusy(true);
    setError(null);
    try {
      const next = await startDsh(workspaceDir);
      setStatus(next);
      return next;
    } catch (cause) {
      const message = formatError(cause);
      setError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { settings, status, error, busy, refresh, start };
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
