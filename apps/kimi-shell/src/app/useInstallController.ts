import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { createEmptyInstallSessionSnapshot } from "@/app/types";
import { createDefaultInstallSettingsView } from "@/app/shellControllerDefaults";
import type {
  InstallCommandCatalog,
  InstallFlowCatalog,
  InstallLogChunk,
  InstallMirrorHealthReport,
  InstallProbeStatus,
  KimiCodeUpdateInfo,
  KimiCodeUpdateStatus,
  InstallSessionEvent,
  InstallSessionSnapshot,
  InstallSettingsView,
  InstallSource,
  InstallTaskId,
  PowerShellPreflightSummary,
} from "@/app/types";

const INSTALL_PROBE_TIMEOUT_MS = 180_000;
const INSTALL_PROBE_INTERVAL_MS = 1500;

type UseInstallControllerOptions = {
  tauriRuntime: boolean;
  enabled: boolean;
  refreshOnboarding: () => Promise<unknown>;
  setActionError: (message: string | null) => void;
};

function mergeInstallLogChunk(
  current: InstallSessionSnapshot,
  chunk: InstallLogChunk,
): InstallSessionSnapshot {
  const nextLogs = [...current.logs, chunk];
  const overflow = Math.max(0, nextLogs.length - 400);
  return {
    ...current,
    logs: overflow > 0 ? nextLogs.slice(overflow) : nextLogs,
    logsTruncated: current.logsTruncated || overflow > 0,
  };
}

export function useInstallController({
  tauriRuntime,
  enabled,
  refreshOnboarding,
  setActionError,
}: UseInstallControllerOptions) {
  const [installSource, setInstallSource] = useState<InstallSource>("official");
  const [installSettings, setInstallSettings] = useState<InstallSettingsView>(
    () => createDefaultInstallSettingsView(),
  );
  const [installSettingsBusy, setInstallSettingsBusy] = useState(false);
  const [powershellPreflight, setPowershellPreflight] =
    useState<PowerShellPreflightSummary | null>(null);
  const [installMessage, setInstallMessage] = useState("");
  const [installProbeBusy, setInstallProbeBusy] = useState(false);
  const [installProbe, setInstallProbe] = useState<InstallProbeStatus | null>(null);
  const [kimiCodeUpdateStatus, setKimiCodeUpdateStatus] =
    useState<KimiCodeUpdateStatus>("idle");
  const [kimiCodeUpdateInfo, setKimiCodeUpdateInfo] =
    useState<KimiCodeUpdateInfo | null>(null);
  const [kimiCodeUpdateError, setKimiCodeUpdateError] = useState<string | null>(null);
  const [installFlowCatalog, setInstallFlowCatalog] =
    useState<InstallFlowCatalog | null>(null);
  const [installSessionSnapshot, setInstallSessionSnapshot] =
    useState<InstallSessionSnapshot>(() => createEmptyInstallSessionSnapshot());
  const [installMirrorHealthReport, setInstallMirrorHealthReport] =
    useState<InstallMirrorHealthReport | null>(null);
  const [installMirrorHealthBusy, setInstallMirrorHealthBusy] = useState(false);
  const [installCommandsOpen, setInstallCommandsOpen] = useState(false);
  const [installCommandsBusy, setInstallCommandsBusy] = useState(false);
  const [installCommandCatalog, setInstallCommandCatalog] =
    useState<InstallCommandCatalog | null>(null);
  const startupProbeStartedRef = useRef(false);
  const refreshedUpgradeRef = useRef<string | null>(null);

  async function refreshInstallProbe() {
    const data = await invoke<InstallProbeStatus>("get_install_probe_status");
    setInstallProbe(data);
    return data;
  }

  const checkKimiCodeUpdate = useCallback(async () => {
    setKimiCodeUpdateStatus("checking");
    setKimiCodeUpdateError(null);
    try {
      const info = await invoke<KimiCodeUpdateInfo>("check_kimi_code_update");
      setKimiCodeUpdateInfo(info);
      setKimiCodeUpdateStatus(info.available ? "available" : "up_to_date");
      return info;
    } catch (error) {
      setKimiCodeUpdateStatus("error");
      setKimiCodeUpdateInfo(null);
      setKimiCodeUpdateError(String(error));
      return null;
    }
  }, []);

  async function handleRefreshInstallProbe() {
    setInstallProbeBusy(true);
    setInstallMessage("正在检测安装环境...");
    setActionError(null);
    try {
      const data = await refreshInstallProbe();
      setInstallMessage("");
      if (data.kimiReady) {
        await checkKimiCodeUpdate();
      } else {
        setKimiCodeUpdateStatus("idle");
        setKimiCodeUpdateInfo(null);
        setKimiCodeUpdateError(null);
      }
      return data;
    } catch (error) {
      const detail = String(error);
      setInstallMessage(detail);
      setActionError(detail);
      throw error;
    } finally {
      setInstallProbeBusy(false);
    }
  }

  useEffect(() => {
    if (!tauriRuntime || !enabled || startupProbeStartedRef.current) {
      return;
    }
    startupProbeStartedRef.current = true;
    setInstallProbeBusy(true);
    void refreshInstallProbe()
      .then(async (probe) => {
        if (probe.kimiReady) {
          await checkKimiCodeUpdate();
        }
      })
      .catch((error) => {
        setInstallMessage(String(error));
      })
      .finally(() => {
        setInstallProbeBusy(false);
      });
  }, [checkKimiCodeUpdate, enabled, tauriRuntime]);

  async function refreshInstallSettings() {
    const data = await invoke<InstallSettingsView>("get_install_settings");
    setInstallSettings(data);
    setInstallSource(data.preferredSource);
    return data;
  }

  async function saveCurrentInstallSettings(input: InstallSettingsView) {
    setInstallSettingsBusy(true);
    try {
      const data = await invoke<InstallSettingsView>("save_install_settings", { input });
      setInstallSettings(data);
      setInstallSource(data.preferredSource);
      return data;
    } finally {
      setInstallSettingsBusy(false);
    }
  }

  async function refreshInstallMirrorHealth(input?: InstallSettingsView) {
    const payload = input ?? installSettings;
    setInstallMirrorHealthBusy(true);
    try {
      const data = await invoke<InstallMirrorHealthReport>(
        "get_install_mirror_health_report",
        {
          input: payload,
        },
      );
      setInstallMirrorHealthReport(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    } finally {
      setInstallMirrorHealthBusy(false);
    }
  }

  async function refreshPowerShellPreflight() {
    const data = await invoke<PowerShellPreflightSummary>("get_powershell_preflight");
    setPowershellPreflight(data);
    return data;
  }

  async function refreshInstallFlowCatalog() {
    const catalog = await invoke<InstallFlowCatalog>("get_install_flow_catalog");
    setInstallFlowCatalog(catalog);
    return catalog;
  }

  useEffect(() => {
    if (!tauriRuntime || !enabled) {
      return;
    }

    const channel = new Channel<InstallSessionEvent>();
    channel.onmessage = (event) => {
      if (event.event === "snapshot") {
        setInstallSessionSnapshot(event.snapshot);
        if (event.snapshot.probe) {
          setInstallProbe(event.snapshot.probe);
        }
        if (event.snapshot.powershellDiagnostic) {
          setPowershellPreflight(event.snapshot.powershellDiagnostic);
        }
        return;
      }

      setInstallSessionSnapshot((current) => mergeInstallLogChunk(current, event.chunk));
    };

    void invoke<InstallSessionSnapshot>("register_install_session_channel", { channel })
      .then((snapshot) => {
        setInstallSessionSnapshot(snapshot);
        if (snapshot.probe) {
          setInstallProbe(snapshot.probe);
        }
        if (snapshot.powershellDiagnostic) {
          setPowershellPreflight(snapshot.powershellDiagnostic);
        }
      })
      .catch((error) => {
        setActionError(String(error));
      });
  }, [enabled, setActionError, tauriRuntime]);

  async function waitForInstallProbe(
    predicate: (probe: InstallProbeStatus) => boolean,
    timeoutMs = INSTALL_PROBE_TIMEOUT_MS,
  ) {
    const startedAt = Date.now();
    let probe = await refreshInstallProbe();
    if (predicate(probe)) {
      return probe;
    }

    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) =>
        window.setTimeout(resolve, INSTALL_PROBE_INTERVAL_MS),
      );
      probe = await refreshInstallProbe();
      if (predicate(probe)) {
        return probe;
      }
    }

    throw new Error("安装复检超时，请检查外置终端输出并确认安装是否完成。");
  }

  function handleInstallSourceChange(source: InstallSource) {
    setInstallSource(source);
    setInstallMessage("");
    const next = {
      ...installSettings,
      preferredSource: source,
    };
    setInstallSettings(next);
    void saveCurrentInstallSettings(next).catch((error) => {
      setActionError(String(error));
    });
  }

  async function handleSaveInstallSettings(input: InstallSettingsView) {
    setActionError(null);
    try {
      const saved = await saveCurrentInstallSettings(input);
      await refreshInstallFlowCatalog();
      await refreshPowerShellPreflight();
      return saved;
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  async function handleStartInstallTask(taskId: InstallTaskId) {
    setActionError(null);
    setInstallMessage("");
    try {
      const catalog = installFlowCatalog ?? (await refreshInstallFlowCatalog());
      const task = catalog.tasks.find((item) => item.id === taskId);
      if (
        taskId === "upgrade_kimi" &&
        !window.confirm("升级将停止当前 Kimi Server 和正在使用它的连接。继续升级吗？")
      ) {
        return;
      }
      if (task?.requiresElevation) {
        const accepted = window.confirm(
          `${task.title} will open an elevated external PowerShell window. Continue?`,
        );
        if (!accepted) {
          return;
        }
      }

      const snapshot = await invoke<InstallSessionSnapshot>("start_install_task", {
        taskId,
        source: installSource,
      });
      setInstallSessionSnapshot(snapshot);
      if (snapshot.probe) {
        setInstallProbe(snapshot.probe);
      }
      if (snapshot.powershellDiagnostic) {
        setPowershellPreflight(snapshot.powershellDiagnostic);
      }
      await refreshOnboarding();
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleCancelInstallTask() {
    setActionError(null);
    try {
      const snapshot = await invoke<InstallSessionSnapshot>("cancel_install_task");
      setInstallSessionSnapshot(snapshot);
      if (snapshot.probe) {
        setInstallProbe(snapshot.probe);
      }
      if (snapshot.powershellDiagnostic) {
        setPowershellPreflight(snapshot.powershellDiagnostic);
      }
    } catch (error) {
      setActionError(String(error));
    }
  }

  useEffect(() => {
    const finishedAt = installSessionSnapshot.finishedAt;
    if (
      installSessionSnapshot.taskId !== "upgrade_kimi" ||
      installSessionSnapshot.status !== "succeeded" ||
      !finishedAt ||
      refreshedUpgradeRef.current === finishedAt
    ) {
      return;
    }
    refreshedUpgradeRef.current = finishedAt;
    void handleRefreshInstallProbe();
  }, [
    installSessionSnapshot.finishedAt,
    installSessionSnapshot.status,
    installSessionSnapshot.taskId,
  ]);

  async function handleQuickInstallCore() {
    await handleStartInstallTask("quick_install_core");
  }

  async function handleInstallKimiTask() {
    await handleStartInstallTask("install_kimi");
  }

  async function handleUpgradeKimiTask() {
    await handleStartInstallTask("upgrade_kimi");
  }

  async function handleInstallNodejsTask() {
    await handleStartInstallTask("install_nodejs");
  }

  async function handleOpenInstallCommands() {
    setInstallCommandsBusy(true);
    setActionError(null);
    try {
      const catalog = await invoke<InstallCommandCatalog>("get_install_command_catalog");
      setInstallCommandCatalog(catalog);
      setInstallCommandsOpen(true);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setInstallCommandsBusy(false);
    }
  }

  function handleCloseInstallCommands() {
    setInstallCommandsOpen(false);
  }

  return {
    installProbe,
    installProbeBusy,
    kimiCodeUpdateStatus,
    kimiCodeUpdateInfo,
    kimiCodeUpdateError,
    installSource,
    installSettings,
    installSettingsBusy,
    powershellPreflight,
    installBusy:
      installSessionSnapshot.status === "starting" ||
      installSessionSnapshot.status === "running" ||
      installSessionSnapshot.status === "cancelling",
    installMessage,
    installSessionSnapshot,
    installMirrorHealthReport,
    installMirrorHealthBusy,
    installCommandsOpen,
    installCommandsBusy,
    installCommandCatalog,
    refreshInstallProbe: handleRefreshInstallProbe,
    refreshInstallSettings,
    refreshInstallMirrorHealth,
    refreshPowerShellPreflight,
    refreshInstallFlowCatalog,
    waitForInstallProbe,
    handleInstallSourceChange,
    handleSaveInstallSettings,
    handleInstallDependencies: handleQuickInstallCore,
    handleInstallKimi: handleInstallKimiTask,
    handleUpgradeKimi: handleUpgradeKimiTask,
    handleInstallNodejs: handleInstallNodejsTask,
    handleStartInstallTask,
    handleCancelInstallTask,
    handleOpenInstallCommands,
    handleCloseInstallCommands,
  };
}
