import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  AppUpdateInfo,
  AppUpdateProgress,
  AppUpdateSource,
  AppUpdateStatus,
} from "@/app/types";

type UseAppUpdateControllerOptions = {
  tauriRuntime: boolean;
  enabled: boolean;
};

export function useAppUpdateController({
  tauriRuntime,
  enabled,
}: UseAppUpdateControllerOptions) {
  const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus>("idle");
  const [appUpdateInfo, setAppUpdateInfo] = useState<AppUpdateInfo | null>(null);
  const [appUpdateProgress, setAppUpdateProgress] = useState<AppUpdateProgress | null>(null);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  const [appUpdateSource, setAppUpdateSource] = useState<AppUpdateSource>("auto");
  const [appUpdateSourceBusy, setAppUpdateSourceBusy] = useState(false);
  const checkedRef = useRef(false);
  const installInFlightRef = useRef(false);

  const checkAppUpdate = useCallback(async () => {
    if (!tauriRuntime || !enabled) return null;
    setAppUpdateStatus("checking");
    setAppUpdateError(null);
    try {
      const info = await invoke<AppUpdateInfo>("check_app_update");
      setAppUpdateInfo(info);
      setAppUpdateStatus(info.available ? "available" : "up_to_date");
      return info;
    } catch (error) {
      setAppUpdateStatus("error");
      setAppUpdateError(String(error));
      return null;
    }
  }, [enabled, tauriRuntime]);

  useEffect(() => {
    if (!tauriRuntime || !enabled || checkedRef.current) return;
    checkedRef.current = true;
    void (async () => {
      try {
        const source = await invoke<AppUpdateSource>("get_app_update_source");
        setAppUpdateSource(source);
      } catch (error) {
        setAppUpdateError(String(error));
      }
      await checkAppUpdate();
    })();
  }, [checkAppUpdate, enabled, tauriRuntime]);

  const saveAppUpdateSource = useCallback(async (source: AppUpdateSource) => {
    if (!tauriRuntime || !enabled || appUpdateSourceBusy || installInFlightRef.current) return;
    setAppUpdateSourceBusy(true);
    setAppUpdateError(null);
    try {
      const saved = await invoke<AppUpdateSource>("save_app_update_source", { source });
      setAppUpdateSource(saved);
      setAppUpdateInfo(null);
      setAppUpdateProgress(null);
      await checkAppUpdate();
    } catch (error) {
      setAppUpdateError(String(error));
    } finally {
      setAppUpdateSourceBusy(false);
    }
  }, [appUpdateSourceBusy, checkAppUpdate, enabled, tauriRuntime]);

  const installAppUpdate = useCallback(async () => {
    if (!tauriRuntime || !enabled || installInFlightRef.current) return;
    installInFlightRef.current = true;
    setAppUpdateStatus("downloading");
    setAppUpdateProgress({ stage: "downloading", downloaded: 0 });
    setAppUpdateError(null);

    const progress = new Channel<AppUpdateProgress>();
    progress.onmessage = (event) => {
      setAppUpdateProgress(event);
      setAppUpdateStatus(event.stage);
    };

    try {
      await invoke("install_app_update", { progress });
    } catch (error) {
      setAppUpdateStatus("error");
      setAppUpdateError(String(error));
      installInFlightRef.current = false;
    }
  }, [enabled, tauriRuntime]);

  return {
    appUpdateSupported: tauriRuntime,
    appUpdateStatus,
    appUpdateInfo,
    appUpdateProgress,
    appUpdateError,
    appUpdateSource,
    appUpdateSourceBusy,
    checkAppUpdate,
    installAppUpdate,
    saveAppUpdateSource,
  };
}
