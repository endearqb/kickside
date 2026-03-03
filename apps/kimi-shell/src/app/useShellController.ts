import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getInitialThemeMode, LEGACY_THEME_MODE_STORAGE_KEY, THEME_STORAGE_KEY } from "@/app/theme";
import type {
  AppStatus,
  ContextMenuStatus,
  ControlSectionId,
  DiagnosticsInfo,
  InstallProbeStatus,
  KimiCliApiConfigView,
  LoginProbeResult,
  OnboardingStatus,
  RuntimePanelId,
  Screen,
  Theme,
  WorkspaceEmbedState,
  ActionableOnboardingStep,
} from "@/app/types";
import { useWorkspaceThemeBridge } from "@/app/useWorkspaceThemeBridge";

const POLL_MS = 1000;

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type ApiConfigFormState = {
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey: string;
};
type InstallSource = "official" | "mirror";

function parseHashRoute(hash: string): string {
  return hash.replace(/^#\/?/, "");
}

export function useShellController() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [contextMenuBusy, setContextMenuBusy] = useState(false);
  const [loginProbeBusy, setLoginProbeBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [contextMenuStatus, setContextMenuStatus] =
    useState<ContextMenuStatus | null>(null);
  const [loginProbeResult, setLoginProbeResult] =
    useState<LoginProbeResult | null>(null);
  const [kimiPathInput, setKimiPathInput] = useState("");
  const [workDirInput, setWorkDirInput] = useState("");
  const [apiConfigForm, setApiConfigForm] = useState<ApiConfigFormState>({
    providerId: "moonshot",
    model: "",
    baseUrl: "",
    apiKey: "",
  });
  const [apiConfigPath, setApiConfigPath] = useState("");
  const [apiConfigHasKey, setApiConfigHasKey] = useState(false);
  const [installSource, setInstallSource] = useState<InstallSource>("official");
  const [installBusy, setInstallBusy] = useState(false);
  const [installMessage, setInstallMessage] = useState("");
  const [installProbe, setInstallProbe] = useState<InstallProbeStatus | null>(null);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [workspaceEmbedState, setWorkspaceEmbedState] =
    useState<WorkspaceEmbedState>("idle");
  const [themeMode, setThemeMode] = useState<Theme>(() => getInitialThemeMode());
  const [activeControlSection, setActiveControlSection] =
    useState<ControlSectionId>("overview");
  const [activeRuntimePanel, setActiveRuntimePanel] =
    useState<RuntimePanelId>("paths");
  const [routeHash, setRouteHash] = useState(() => window.location.hash);

  const tauriRuntime = useMemo(() => isTauri(), []);
  const loadingReportCycleRef = useRef<number | null>(null);
  const workspaceIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const handleHashChange = () => setRouteHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode);
      window.localStorage.removeItem(LEGACY_THEME_MODE_STORAGE_KEY);
    } catch {
      // Best-effort persistence.
    }
  }, [themeMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", themeMode === "dark");
    root.style.colorScheme = themeMode;
  }, [themeMode]);

  async function refreshStatus() {
    try {
      const data = await invoke<AppStatus>("get_app_status");
      setStatus(data);
      setActionError(null);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshOnboarding() {
    try {
      const data = await invoke<OnboardingStatus>("get_onboarding_status");
      setOnboarding(data);
      setActionError(null);
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function refreshDiagnostics() {
    setDiagnosticsBusy(true);
    try {
      const data = await invoke<DiagnosticsInfo>("get_diagnostics");
      setDiagnostics(data);
      setActionError(null);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function refreshContextMenuStatus() {
    try {
      const data = await invoke<ContextMenuStatus>("get_context_menu_status");
      setContextMenuStatus(data);
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function refreshCoreState() {
    await Promise.all([refreshStatus(), refreshOnboarding()]);
  }

  async function loadKimiCliApiConfig() {
    try {
      const data = await invoke<KimiCliApiConfigView>("load_kimi_cli_api_config");
      setApiConfigPath(data.configPath);
      setApiConfigHasKey(data.hasApiKey);
      setApiConfigForm((current) => ({
        providerId: data.providerId ?? current.providerId,
        model: data.model ?? current.model,
        baseUrl: data.baseUrl ?? current.baseUrl,
        apiKey: "",
      }));
      setActionError(null);
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function refreshInstallProbe() {
    const data = await invoke<InstallProbeStatus>("get_install_probe_status");
    setInstallProbe(data);
    return data;
  }

  useEffect(() => {
    void refreshCoreState();
    const timer = window.setInterval(() => {
      void refreshCoreState();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!status) return;
    if (status.configuredKimiPath && !kimiPathInput) {
      setKimiPathInput(status.configuredKimiPath);
    }
    if (status.configuredWorkDir && !workDirInput) {
      setWorkDirInput(status.configuredWorkDir);
    }
  }, [status, kimiPathInput, workDirInput]);

  useEffect(() => {
    if (!onboarding) return;
    if (onboarding.workDir && !workDirInput) {
      setWorkDirInput(onboarding.workDir);
    }
  }, [onboarding, workDirInput]);

  useEffect(() => {
    if (!tauriRuntime) {
      setIsWindowMaximized(false);
      return;
    }

    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    const syncMaximizedState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        setIsWindowMaximized(maximized);
      } catch {
        // Best-effort sync.
      }
    };

    void syncMaximizedState();
    void appWindow
      .onResized(() => {
        void syncMaximizedState();
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch(() => {
        // Best-effort listener registration.
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [tauriRuntime]);

  const screen: Screen = useMemo(() => {
    const hashRoute = parseHashRoute(routeHash);
    if (hashRoute === "control-center") return "control_center";
    if (
      hashRoute === "diagnostics" ||
      hashRoute === "logs_paths" ||
      hashRoute === "onboarding"
    ) {
      return "control_center";
    }

    if (status?.state === "missing_kimi" || status?.state === "crashed") {
      return "control_center";
    }

    if (onboarding?.shouldShowOnboarding) {
      return "control_center";
    }

    if (status?.state === "running" && typeof status.activePort === "number") {
      return "workspace";
    }

    return "loading";
  }, [onboarding, routeHash, status]);

  useEffect(() => {
    if (screen !== "control_center") return;
    void refreshOnboarding();
    void refreshDiagnostics();
    void refreshContextMenuStatus();
    void loadKimiCliApiConfig();
    void refreshInstallProbe().catch(() => {
      // Best-effort probe.
    });
  }, [screen]);

  useEffect(() => {
    if (screen !== "control_center") return;

    const hashRoute = parseHashRoute(routeHash);
    if (hashRoute === "onboarding") {
      setActiveControlSection("onboarding");
      return;
    }

    if (hashRoute === "diagnostics") {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel("core");
      return;
    }

    if (hashRoute === "logs_paths") {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel("paths");
    }
  }, [routeHash, screen]);

  useEffect(() => {
    if (!status) return;
    if (status.state !== "starting") return;
    if (loadingReportCycleRef.current === status.startCycleId) return;

    loadingReportCycleRef.current = status.startCycleId;
    void invoke("report_loading_rendered", {
      startCycleId: status.startCycleId,
    }).catch(() => {
      // Best-effort metric reporting.
    });
  }, [status]);

  async function handleRetry() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("retry_start_backend");
      await refreshCoreState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleOpenLogs() {
    try {
      await invoke("open_logs_folder");
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleOpenExternalUrl(url: string) {
    const trimmed = url.trim();
    if (!trimmed) {
      return;
    }

    if (tauriRuntime) {
      try {
        await invoke("open_external_url", { url: trimmed });
        return;
      } catch (error) {
        setActionError(String(error));
      }
    }

    try {
      const opened = window.open(trimmed, "_blank", "noopener,noreferrer");
      if (!opened) {
        setActionError("Could not open external browser window.");
      }
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleOpenFolder(path: string) {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }
    try {
      await invoke("open_folder", { path: trimmed });
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleOpenKimiConfigDir() {
    try {
      await invoke("open_kimi_config_dir");
    } catch (error) {
      setActionError(String(error));
    }
  }

  function handleApiConfigFieldChange(
    field: keyof ApiConfigFormState,
    value: string,
  ) {
    setApiConfigForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function handlePickKimiPath() {
    try {
      const selected = await open({
        title: "Select kimi executable",
        multiple: false,
        directory: false,
      });
      if (typeof selected === "string") {
        setKimiPathInput(selected);
      }
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleSavePathAndRetry() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("save_kimi_path", { path: kimiPathInput.trim() });
      await invoke("retry_start_backend");
      await refreshCoreState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handlePickWorkDir() {
    try {
      const selected = await open({
        title: "Select Kimi work directory",
        multiple: false,
        directory: true,
      });
      if (typeof selected === "string") {
        setWorkDirInput(selected);
      }
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleSaveWorkDirAndRestart() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("save_work_dir", { path: workDirInput.trim() });
      await invoke("retry_start_backend");
      await refreshCoreState();
      if (screen === "control_center") {
        await refreshDiagnostics();
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleClearWorkDir() {
    setWorkDirInput("");
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("save_work_dir", { path: "" });
      await invoke("retry_start_backend");
      await refreshCoreState();
      if (screen === "control_center") {
        await refreshDiagnostics();
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleEnableContextMenu() {
    setContextMenuBusy(true);
    setActionError(null);
    try {
      const data = await invoke<ContextMenuStatus>("enable_context_menu");
      setContextMenuStatus(data);
      await refreshOnboarding();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setContextMenuBusy(false);
    }
  }

  async function handleDisableContextMenu() {
    setContextMenuBusy(true);
    setActionError(null);
    try {
      const data = await invoke<ContextMenuStatus>("disable_context_menu");
      setContextMenuStatus(data);
      await refreshOnboarding();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setContextMenuBusy(false);
    }
  }

  async function handleProbeLogin() {
    setLoginProbeBusy(true);
    setActionError(null);
    try {
      const result = await invoke<LoginProbeResult>("probe_kimi_login");
      setLoginProbeResult(result);
      await refreshOnboarding();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setLoginProbeBusy(false);
    }
  }

  async function handleAckApiConfig() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("ack_api_config_step", { acknowledged: true });
      await refreshOnboarding();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSaveKimiCliApiConfig() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("save_kimi_cli_api_config", {
        input: {
          providerId: apiConfigForm.providerId.trim(),
          model: apiConfigForm.model.trim(),
          baseUrl: apiConfigForm.baseUrl.trim(),
          apiKey: apiConfigForm.apiKey.trim() || undefined,
        },
      });
      setApiConfigForm((current) => ({ ...current, apiKey: "" }));
      await loadKimiCliApiConfig();
      await refreshOnboarding();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  function handleInstallSourceChange(source: InstallSource) {
    setInstallSource(source);
    setInstallMessage("");
  }

  async function handleInstallDependencies() {
    setActionError(null);
    try {
      const probe = await refreshInstallProbe();
      if (probe.gitReady && probe.uvReady && probe.python313Ready) {
        setInstallMessage("检测到依赖已安装。");
        window.alert("依赖已安装，无需重复安装。");
        return;
      }

      setInstallBusy(true);
      const summary = await invoke<string>("install_kimi_dependencies", {
        source: installSource,
      });
      setInstallMessage(summary.trim() || "依赖安装命令执行完成。");
      await refreshCoreState();
      await refreshOnboarding();
      await refreshInstallProbe();
      if (screen === "control_center") {
        await refreshDiagnostics();
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleInstallKimi() {
    setActionError(null);
    try {
      const probe = await refreshInstallProbe();
      if (probe.kimiReady) {
        setInstallMessage("检测到 Kimi CLI 已安装。");
        window.alert("Kimi CLI 已安装，无需重复安装。");
        return;
      }

      setInstallBusy(true);
      const summary = await invoke<string>("install_kimi_cli", {
        source: installSource,
      });
      setInstallMessage(summary.trim() || "Kimi CLI 安装命令执行完成。");
      await refreshCoreState();
      await refreshOnboarding();
      await refreshInstallProbe();
      if (screen === "control_center") {
        await refreshDiagnostics();
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setInstallBusy(false);
    }
  }

  async function handleCompleteOnboarding() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("complete_onboarding");
      window.location.hash = "/loading";
      setRouteHash(window.location.hash);
      await refreshCoreState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSkipOnboarding() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("skip_onboarding");
      window.location.hash = "/loading";
      setRouteHash(window.location.hash);
      await refreshCoreState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  function openControlCenter() {
    window.location.hash = "/control-center";
    setRouteHash(window.location.hash);
  }

  function backToStatus() {
    window.location.hash = "/loading";
    setRouteHash(window.location.hash);
  }

  async function handleMinimizeWindow() {
    if (!tauriRuntime) return;
    try {
      await getCurrentWindow().minimize();
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleToggleMaximizeWindow() {
    if (!tauriRuntime) return;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const maximized = await appWindow.isMaximized();
      setIsWindowMaximized(maximized);
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleCloseWindow() {
    if (!tauriRuntime) return;
    try {
      await getCurrentWindow().close();
    } catch (error) {
      setActionError(String(error));
    }
  }

  function handleTitlebarDoubleClick() {
    void handleToggleMaximizeWindow();
  }

  function handleToggleThemeMode() {
    setThemeMode((current) => (current === "light" ? "dark" : "light"));
  }

  const workspacePort = status?.workspacePort ?? status?.activePort;
  const remoteUrl = workspacePort ? `http://127.0.0.1:${workspacePort}` : null;
  const workspaceOrigin = useMemo(() => {
    if (!remoteUrl) return null;
    try {
      return new URL(remoteUrl).origin;
    } catch {
      return null;
    }
  }, [remoteUrl]);

  const { pushThemeToWorkspace } = useWorkspaceThemeBridge({
    screen,
    workspaceEmbedState,
    workspaceOrigin,
    themeMode,
    workspaceIframeRef,
    setThemeMode,
  });

  useEffect(() => {
    if (screen !== "workspace" || !remoteUrl) {
      setWorkspaceEmbedState("idle");
      return;
    }

    setWorkspaceEmbedState("loading");
    const timer = window.setTimeout(() => {
      setWorkspaceEmbedState((current) =>
        current === "ready" ? current : "blocked",
      );
    }, 8_000);

    return () => window.clearTimeout(timer);
  }, [screen, remoteUrl]);

  const stepCompletion = useMemo<StepCompletion>(
    () => ({
      install_kimi: onboarding?.kimiInstalled ?? false,
      context_menu: onboarding
        ? !onboarding.contextMenuSupported || onboarding.contextMenuEnabled
        : false,
      login_kimi: onboarding?.loginState === "logged_in",
      work_dir: onboarding?.workDirConfigured ?? false,
      api_config: onboarding?.apiConfigAck ?? false,
    }),
    [onboarding],
  );

  const canOpenWorkspace =
    status?.state === "running" &&
    typeof status.activePort === "number" &&
    !onboarding?.shouldShowOnboarding;

  const statusText = status?.state ?? "starting";
  const shellScreenLabel =
    screen === "workspace"
      ? "Workspace"
      : screen === "control_center"
        ? "Control Center"
        : "Loading";
  const hotkeyOwnerLabel = status?.isHotkeyOwner
    ? "This instance owns global hotkey."
    : "Global hotkey is owned by another running instance.";

  function handleWorkspaceFrameLoad() {
    setWorkspaceEmbedState("ready");
    pushThemeToWorkspace();
  }

  function handleWorkspaceFrameError() {
    setWorkspaceEmbedState("blocked");
  }

  return {
    status,
    diagnostics,
    onboarding,
    isLoading,
    actionBusy,
    diagnosticsBusy,
    contextMenuBusy,
    loginProbeBusy,
    actionError,
    contextMenuStatus,
    loginProbeResult,
    kimiPathInput,
    setKimiPathInput,
    workDirInput,
    setWorkDirInput,
    isWindowMaximized,
    workspaceEmbedState,
    themeMode,
    activeControlSection,
    setActiveControlSection,
    activeRuntimePanel,
    setActiveRuntimePanel,
    tauriRuntime,
    screen,
    statusText,
    shellScreenLabel,
    hotkeyOwnerLabel,
    canOpenWorkspace,
    remoteUrl,
    workspaceIframeRef,
    stepCompletion,
    apiConfigForm,
    apiConfigPath,
    apiConfigHasKey,
    installProbe,
    installSource,
    installBusy,
    installMessage,
    refreshCoreState,
    refreshDiagnostics,
    refreshContextMenuStatus,
    refreshOnboarding,
    handleRetry,
    handleOpenLogs,
    handleOpenExternalUrl,
    handleOpenFolder,
    handleOpenKimiConfigDir,
    handlePickKimiPath,
    handleSavePathAndRetry,
    handlePickWorkDir,
    handleSaveWorkDirAndRestart,
    handleClearWorkDir,
    handleApiConfigFieldChange,
    handleSaveKimiCliApiConfig,
    handleInstallSourceChange,
    handleInstallDependencies,
    handleInstallKimi,
    handleEnableContextMenu,
    handleDisableContextMenu,
    handleProbeLogin,
    handleAckApiConfig,
    handleCompleteOnboarding,
    handleSkipOnboarding,
    openControlCenter,
    backToStatus,
    handleMinimizeWindow,
    handleToggleMaximizeWindow,
    handleCloseWindow,
    handleTitlebarDoubleClick,
    handleToggleThemeMode,
    handleWorkspaceFrameLoad,
    handleWorkspaceFrameError,
  };
}
