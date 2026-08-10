import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  isExpectedWorkspaceBridgeNonce,
  isTrustedWorkspaceIframeSource,
  normalizeExternalOpenUrl,
  queryWorkspaceFrameSessionId,
} from "@/app/linkBridge";
import { getKimiAssistantDisplayName } from "@/lib/appBrand";
import {
  buildSkillUninstallConfirmMessage,
  cloneKimiCodeAccessInput,
  createBridgeOnboardingValidation,
  createDefaultBridgeOnboardingConfigInput,
  createDefaultWorkspaceWebSettings,
  createEmptyKimiCodeAccessInput,
  formatKimiCodeAccessSaveError,
  formatBridgeErrorEntry,
  getBridgeChannelEnabled,
  hasBridgeDraftSecretValue,
  parseHashRoute,
  toKimiCodeAccessInput,
} from "@/app/shellControllerDefaults";

import {
  CHAT_EXTERNAL_LINK_BRIDGE_SOURCE,
  clampWorkspaceSplitRatio,
  EXTERNAL_LINK_BRIDGE_SOURCE,
  getInitialThemeMode,
  getInitialWorkspaceLayoutMode,
  getInitialWorkspaceSplitOrder,
  getInitialWorkspaceSplitRatio,
  getInitialWorkspaceView,
  LEGACY_THEME_MODE_STORAGE_KEY,
  PREFILL_BRIDGE_SOURCE,
  PREFILL_SYNC_SOURCE,
  SESSION_BRIDGE_SOURCE,
  SESSION_SYNC_SOURCE,
  THEME_STORAGE_KEY,
  WORKSPACE_ACTIVE_VIEW_STORAGE_KEY,
  WORKSPACE_LAYOUT_MODE_STORAGE_KEY,
  WORKSPACE_SPLIT_ORDER_STORAGE_KEY,
  WORKSPACE_SPLIT_RATIO_STORAGE_KEY,
} from "@/app/theme";
import type {
  ActionableOnboardingStep,
  AppStatus,
  BridgeConnectorSecretsInput,
  FeishuConnectorOnboardingSession,
  WeixinConnectorOnboardingSession,
  BridgeOnboardingConfigInput,
  BridgeApprovalResolveInput,
  BridgeSessionImportInput,
  BridgeSessionRecord,
  BridgeSecretsMaskView,
  BridgeSettings,
  BridgeStatus,
  ContextMenuLabelsInput,
  ContextMenuStatus,
  ControlCenterTaskId,
  ControlCenterTaskPayload,
  ControlSectionId,
  DiagnosticsInfo,
  FrontendReadyAck,
  KimiCodeAccessConfigInput,
  KimiCodeAccessConfigTestResult,
  KimiCodeAccessConfigView,
  KimiDoctorResult,
  MainWindowCloseBehavior,
  MainWindowCloseDecisionInput,
  MainWindowCloseDecisionRequestPayload,
  OnboardingStatus,
  OpenRequestErrorPayload,
  PrefillBridgeAck,
  PrefillChatPayload,
  ShutdownProgressPayload,
  RuntimePanelId,
  Screen,
  ShellRoutePayload,
  SkillCenterSectionId,
  StartFeishuConnectorOnboardingInput,
  StartWeixinConnectorOnboardingInput,
  Theme,
  SkillApplyScope,
  SkillDiscoveryContainerKind,
  WorkspaceImportRequestPayload,
  WorkspaceImportResult,
  WorkspaceSkillRestoreResult,
  WorkspaceSessionBridgePayload,
  WorkspaceEmbedState,
  WorkspaceLayoutMode,
  WorkspacePaneState,
  WorkspaceSplitOrder,
  WorkspaceViewKind,
  WorkspaceWebSettingsView,
} from "@/app/types";
import { useWorkspaceThemeBridge } from "@/app/useWorkspaceThemeBridge";
import { useBridgeRuntimeController } from "@/app/useBridgeRuntimeController";
import { useAppUpdateController } from "@/app/useAppUpdateController";
import { useInstallController } from "@/app/useInstallController";
import { useSkillCenterController } from "@/app/useSkillCenterController";
import { useShellPollingController } from "@/app/useShellPollingController";
import { useWorkspaceEmbedUrl } from "@/app/useWorkspaceEmbedUrl";
import { useWorkspaceImportController } from "@/app/useWorkspaceImportController";
import { useWorkspaceGridStore } from "@/features/workspace-grid/gridStore";
import { usePlatformCapabilities } from "@/platform/usePlatformCapabilities";
import {
  getGridSession,
  resolveCurrentPaneWorkDir,
} from "@/services/workspaceGridService";
import {
  applySkill,
  addInstalledSkillToWorkspaceTarget,
  importDiscoveredSkill,
  importSkillFromPath,
  installSkillFromGit,
  removeSkill,
  removeWorkspaceTargetSkill,
  setWorkspaceSkillPin,
  setSkillTrust,
  uninstallSkill,
  updateSkill,
} from "@/services/skillCenterService";

const SHELL_ROUTE_EVENT = "shell-route";
const PREFILL_CHAT_EVENT = "prefill-chat";
const SHUTDOWN_PROGRESS_EVENT = "shutdown-progress";
const OPEN_REQUEST_ERROR_EVENT = "open-request-error";
const WORKSPACE_SESSION_BOOTSTRAP_EVENT = "workspace-session-bootstrap";
const WORKSPACE_SESSION_BRIDGE_EVENT = "workspace-session-bridge";
const WORKSPACE_IMPORT_REQUEST_EVENT = "workspace-import-request";
const WORKSPACE_IMPORT_RESULT_EVENT = "workspace-import-result";
const MAIN_WINDOW_CLOSE_DECISION_REQUEST_EVENT = "main-window-close-decision-request";
const PREFILL_ACK_TIMEOUT_MS = 2600;
const PREFILL_RETRY_DELAY_MS = 1600;
const PREFILL_MAX_ATTEMPTS = 12;
const SESSION_NAVIGATE_TIMEOUT_MS = 6000;
const WORKSPACE_PANE_TIMEOUT_MS = 8_000;
const KIMI_CHAT_REMOTE_URL = "https://www.kimi.com/";
const ENHANCED_WEB_READY_SOURCE = "kimi-app-enhanced-web-ready";

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type BridgePrimaryActionMode = "save_enable" | "start" | "apply_restart";
type BootHint = Pick<
  FrontendReadyAck,
  "backendState" | "startCycleId"
>;

export function useShellController() {
  const platform = usePlatformCapabilities();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [kimiDoctorBusy, setKimiDoctorBusy] = useState(false);
  const [contextMenuBusy, setContextMenuBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [contextMenuStatus, setContextMenuStatus] =
    useState<ContextMenuStatus | null>(null);
  const [kimiDoctorResult, setKimiDoctorResult] =
    useState<KimiDoctorResult | null>(null);
  const [kimiPathInput, setKimiPathInput] = useState("");
  const [workDirInput, setWorkDirInput] = useState("");
  const [kimiCodeAccessView, setKimiCodeAccessView] =
    useState<KimiCodeAccessConfigView | null>(null);
  const [kimiCodeAccessDraft, setKimiCodeAccessDraft] = useState<KimiCodeAccessConfigInput>(
    () => createEmptyKimiCodeAccessInput(),
  );
  const [kimiCodeAccessSnapshot, setKimiCodeAccessSnapshot] =
    useState<KimiCodeAccessConfigInput>(() => createEmptyKimiCodeAccessInput());
  const [kimiCodeAccessBusy, setKimiCodeAccessBusy] = useState(false);
  const [kimiCodeAccessTesting, setKimiCodeAccessTesting] = useState(false);
  const [kimiCodeAccessTestResult, setKimiCodeAccessTestResult] =
    useState<KimiCodeAccessConfigTestResult | null>(null);
  const [workspaceWebSettings, setWorkspaceWebSettings] =
    useState<WorkspaceWebSettingsView>(() => createDefaultWorkspaceWebSettings());
  const {
    bridgeSettings,
    setBridgeSettings,
    bridgeSettingsSnapshot,
    setBridgeSettingsSnapshot,
    bridgeStatus,
    setBridgeStatus,
    bridgeSessions,
    setBridgeSessions,
    bridgeBindings,
    setBridgeBindings,
    bridgeApprovals,
    setBridgeApprovals,
    bridgeLogTail,
    bridgeSecretsMask,
    setBridgeSecretsMask,
    refreshBridgeSettings,
    refreshBridgeStatus,
    refreshBridgeSessions,
    refreshBridgeBindings,
    refreshBridgeApprovals,
    refreshBridgeLogTail,
    refreshBridgeSecretsMask,
  } = useBridgeRuntimeController({ setActionError });
  const {
    installedSkills,
    skillCenterBusy,
    setSkillCenterBusy,
    skillCenterSearch,
    setSkillCenterSearch,
    skillCenterFilter,
    setSkillCenterFilter,
    skillCenterSection,
    setSkillCenterSection,
    skillCenterGitRepoUrl,
    setSkillCenterGitRepoUrl,
    skillCenterGitRef,
    setSkillCenterGitRef,
    selectedSkillId,
    setSelectedSkillId,
    selectedSkillDetail,
    setSelectedSkillDetail,
    globalSkillProjections,
    activeSessionSkillState,
    workspaceSkillProfile,
    setWorkspaceSkillProfile,
    workspaceRecentSkillIds,
    setWorkspaceRecentSkillIds,
    workspaceSkillRecommendations,
    workspaceSkillRestoreResults,
    setWorkspaceSkillRestoreResults,
    skillDiscoverySnapshot,
    skillDiscoveryWorkspaces,
    selectedDiscoveryId,
    setSelectedDiscoveryId,
    selectedDiscoveryDetail,
    setSelectedDiscoveryDetail,
    workspaceSkillTargets,
    selectedWorkspaceSkillTargetId,
    setSelectedWorkspaceSkillTargetId,
    workspaceSkillInventory,
    selectedWorkspaceSkillContainerKind,
    setSelectedWorkspaceSkillContainerKind,
    refreshActiveSessionSkills,
    refreshSkillCenterState,
    refreshSkillDiscoveryState,
    refreshWorkspaceSkillManagementState,
    refreshSelectedSkillDetail,
    refreshSelectedDiscoveryDetail,
    refreshWorkspaceSkillRecommendationsState,
    refreshWorkspaceSkillInventoryState,
  } = useSkillCenterController({ setActionError });
  const workspaceSkillAutoRestoreKeyRef = useRef<string | null>(null);
  const [feishuConnectorOnboarding, setFeishuConnectorOnboarding] =
    useState<FeishuConnectorOnboardingSession | null>(null);
  const [feishuConnectorOnboardingBusy, setFeishuConnectorOnboardingBusy] =
    useState(false);
  const [weixinConnectorOnboarding, setWeixinConnectorOnboarding] =
    useState<WeixinConnectorOnboardingSession | null>(null);
  const [weixinConnectorOnboardingBusy, setWeixinConnectorOnboardingBusy] =
    useState(false);
  const [bridgeOnboardingDraft, setBridgeOnboardingDraft] =
    useState<BridgeOnboardingConfigInput>(() =>
      createDefaultBridgeOnboardingConfigInput(),
    );
  const [bridgeOnboardingDraftTouched, setBridgeOnboardingDraftTouched] =
    useState(false);
  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const [activeWorkspaceView, setActiveWorkspaceView] =
    useState<WorkspaceViewKind>(() => getInitialWorkspaceView());
  const [workspaceLayoutMode, setWorkspaceLayoutMode] =
    useState<WorkspaceLayoutMode>(() => getInitialWorkspaceLayoutMode());
  const [workspaceSplitOrder, setWorkspaceSplitOrder] =
    useState<WorkspaceSplitOrder>(() => getInitialWorkspaceSplitOrder());
  const [workspaceSplitRatio, setWorkspaceSplitRatio] =
    useState<number>(() => getInitialWorkspaceSplitRatio());
  const [isWorkspaceSplitDragging, setIsWorkspaceSplitDragging] = useState(false);
  const [workspaceFrameReloadToken, setWorkspaceFrameReloadToken] = useState(0);
  const [workspaceEmbedState, setWorkspaceEmbedState] =
    useState<WorkspaceEmbedState>("idle");
  const [chatEmbedState, setChatEmbedState] = useState<WorkspacePaneState>("idle");
  const [mainWindowCloseBehavior, setMainWindowCloseBehavior] =
    useState<MainWindowCloseBehavior>("ask");
  const [mainWindowCloseDecisionRequest, setMainWindowCloseDecisionRequest] =
    useState<MainWindowCloseDecisionRequestPayload | null>(null);
  const [themeMode, setThemeMode] = useState<Theme>(() => getInitialThemeMode());
  const [activeControlSection, setActiveControlSection] =
    useState<ControlSectionId>("onboarding");
  const [activeRuntimePanel, setActiveRuntimePanel] =
    useState<RuntimePanelId>("paths");
  const [controlCenterModalOpen, setControlCenterModalOpen] = useState(false);
  const [activeControlTask, setActiveControlTask] =
    useState<ControlCenterTaskId | null>(null);
  const [activeControlTaskPayload, setActiveControlTaskPayload] =
    useState<ControlCenterTaskPayload | null>(null);
  const [routeHash, setRouteHash] = useState(() => window.location.hash);
  const hashRoute = parseHashRoute(routeHash);
  const isWorkspaceImportPickerRoute = hashRoute === "workspace-import-picker";
  const [listenersReady, setListenersReady] = useState(false);
  const [pendingPrefill, setPendingPrefill] = useState<PrefillChatPayload | null>(
    null,
  );
  const [shutdownProgress, setShutdownProgress] =
    useState<ShutdownProgressPayload | null>(null);
  const [shutdownElapsedMs, setShutdownElapsedMs] = useState<number | null>(null);
  const [bootHint, setBootHint] = useState<BootHint | null>(null);
  const [shellBootPending, setShellBootPending] = useState(
    () => parseHashRoute(window.location.hash) === "loading",
  );
  const [pendingWorkspaceEntryAfterOnboarding, setPendingWorkspaceEntryAfterOnboarding] =
    useState(false);
  const workspaceGridPreset = useWorkspaceGridStore((state) => state.preset);
  const workspaceGridPanes = useWorkspaceGridStore((state) => state.panes);
  const workspaceGridSlots = useWorkspaceGridStore((state) => state.slots);
  const workspaceGridActivePaneId = useWorkspaceGridStore(
    (state) => state.activePaneId,
  );
  const setWorkspaceGridPreset = useWorkspaceGridStore((state) => state.setPreset);
  const setWorkspaceGridActivePane = useWorkspaceGridStore(
    (state) => state.setActivePane,
  );
  const openSessionInWorkspaceGrid = useWorkspaceGridStore(
    (state) => state.openSessionInWorkspaceGrid,
  );
  const configureWorkspaceGridPane = useWorkspaceGridStore(
    (state) => state.configurePane,
  );
  const setWorkspaceGridSessionWorkDir = useWorkspaceGridStore(
    (state) => state.setSessionWorkDir,
  );
  const setWorkspaceGridPaneActiveSession = useWorkspaceGridStore(
    (state) => state.setPaneActiveSession,
  );
  const moveWorkspaceGridPane = useWorkspaceGridStore((state) => state.movePane);

  const tauriRuntime = useMemo(() => isTauri(), []);
  const {
    appUpdateSupported,
    appUpdateStatus,
    appUpdateInfo,
    appUpdateProgress,
    appUpdateError,
    checkAppUpdate,
    installAppUpdate,
  } = useAppUpdateController({
    tauriRuntime,
    enabled: !isWorkspaceImportPickerRoute,
  });
  const {
    installProbe,
    installProbeBusy,
    kimiCodeUpdateStatus,
    kimiCodeUpdateInfo,
    kimiCodeUpdateError,
    installSource,
    installSettings,
    installSettingsBusy,
    powershellPreflight,
    installBusy,
    installMessage,
    installSessionSnapshot,
    installMirrorHealthReport,
    installMirrorHealthBusy,
    installCommandsOpen,
    installCommandsBusy,
    installCommandCatalog,
    refreshInstallProbe,
    refreshInstallSettings,
    refreshInstallMirrorHealth,
    refreshPowerShellPreflight,
    handleInstallSourceChange,
    handleSaveInstallSettings,
    handleInstallDependencies,
    handleInstallKimi,
    handleUpgradeKimi,
    handleInstallNodejs,
    handleStartInstallTask,
    handleCancelInstallTask,
    handleOpenInstallCommands,
    handleCloseInstallCommands,
  } = useInstallController({
    tauriRuntime,
    enabled: !isWorkspaceImportPickerRoute,
    refreshOnboarding,
    setActionError,
  });
  const loadingReportCycleRef = useRef<number | null>(null);
  const workspaceIframeRef = useRef<HTMLIFrameElement | null>(null);
  const chatIframeRef = useRef<HTMLIFrameElement | null>(null);
  const pendingPrefillRef = useRef<PrefillChatPayload | null>(null);
  const prefillRetryTimerRef = useRef<number | null>(null);
  const prefillAckTimerRef = useRef<number | null>(null);
  const frontendReadyReportTimerRef = useRef<number | null>(null);
  const prefillDispatchRef = useRef<((source: string) => void) | null>(null);
  const prefillAttemptsRef = useRef<Record<string, number>>({});
  const handledPrefillIdsRef = useRef<Set<string>>(new Set());
  const inFlightPrefillRequestRef = useRef<string | null>(null);
  const prefillLastFailureReasonRef = useRef<string | null>(null);
  const pendingSessionBridgeRef =
    useRef<WorkspaceSessionBridgePayload | null>(null);
  const handledSessionNavigationIdsRef = useRef<Set<string>>(new Set());
  const sessionRouteTemplateRef = useRef<string | null>(null);
  const sessionNavigateTimerRef = useRef<number | null>(null);
  const shutdownElapsedBaseRef = useRef<number>(0);
  const shutdownElapsedStartedAtRef = useRef<number>(0);
  const shutdownElapsedTimerRef = useRef<number | null>(null);
  const frontendReadyHandshakeSentRef = useRef(false);
  const workspaceFrameLoadIdentityRef = useRef<string | null>(null);
  const {
    hasWorkspaceEmbedUrl,
    remoteUrl,
    workspaceBridgeNonce,
    workspaceDisplayUrl,
    setWorkspaceEmbedUrl,
    refreshWorkspaceEmbedUrlForStatus,
  } = useWorkspaceEmbedUrl(status);
  const chatRemoteUrlRef = useRef<string | null>(null);
  const useBootHintWorkspace =
    hashRoute === "loading" &&
    !status &&
    bootHint?.backendState === "running" &&
    hasWorkspaceEmbedUrl;
  const keepControlCenterForUpgrade =
    installSessionSnapshot.taskId === "upgrade_kimi" &&
    installSessionSnapshot.status !== "idle" &&
    status?.state !== "running";

  const screen: Screen = useMemo(() => {
    if (hashRoute === "control-center") return "control_center";
    if (
      hashRoute === "diagnostics" ||
      hashRoute === "logs_paths" ||
      hashRoute === "onboarding" ||
      hashRoute === "error" ||
      hashRoute === "missing-kimi"
    ) {
      return "control_center";
    }

    if (status?.state === "missing_kimi" || status?.state === "crashed") {
      return "control_center";
    }

    if (onboarding?.shouldShowOnboarding) {
      return "control_center";
    }

    if (keepControlCenterForUpgrade) {
      return "control_center";
    }

    if (useBootHintWorkspace) {
      return "workspace";
    }

    if (status?.state === "running" && typeof status.activePort === "number") {
      return "workspace";
    }

    return "loading";
  }, [hashRoute, keepControlCenterForUpgrade, onboarding, status, useBootHintWorkspace]);

  const workspaceFrameKey = remoteUrl
    ? `${remoteUrl}::${workspaceWebSettings.mode}::${workspaceFrameReloadToken}`
    : "workspace-empty";
  const chatRemoteUrl = KIMI_CHAT_REMOTE_URL;
  const isWorkspaceSplit = workspaceLayoutMode === "split";
  const chatOrigin = useMemo(() => {
    try {
      return new URL(chatRemoteUrl).origin;
    } catch {
      return null;
    }
  }, [chatRemoteUrl]);
  const workspaceOrigin = useMemo(() => {
    if (!remoteUrl) return null;
    try {
      return new URL(remoteUrl).origin;
    } catch {
      return null;
    }
  }, [remoteUrl]);

  const {
    workspaceImportBusy,
    workspaceImportTargets,
    workspaceImportRequest,
    workspaceImportResult,
    refreshWorkspaceImportTargets,
    refreshActiveWorkspaceImportRequest,
    handleWorkspaceImportRequest,
    handleWorkspaceImportResult,
    handleSelectWorkspaceImportTarget,
    handleImportToBrowsedWorkspace,
    handleCancelWorkspaceImportPicker,
    handleDismissWorkspaceImportResult,
  } = useWorkspaceImportController({
    tauriRuntime,
    listenersReady,
    isWorkspaceImportPickerRoute,
    setActionError,
    refreshStatus,
    handleCloseWindow,
  });

  useEffect(() => {
    const handleHashChange = () => setRouteHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  useEffect(() => {
    if (hashRoute === "loading") {
      return;
    }
    setShellBootPending(false);
    setBootHint(null);
  }, [hashRoute]);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_ACTIVE_VIEW_STORAGE_KEY,
        activeWorkspaceView,
      );
    } catch {
      // Best-effort persistence.
    }
  }, [activeWorkspaceView]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_LAYOUT_MODE_STORAGE_KEY,
        workspaceLayoutMode,
      );
    } catch {
      // Best-effort persistence.
    }
  }, [workspaceLayoutMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_SPLIT_ORDER_STORAGE_KEY,
        workspaceSplitOrder,
      );
    } catch {
      // Best-effort persistence.
    }
  }, [workspaceSplitOrder]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        WORKSPACE_SPLIT_RATIO_STORAGE_KEY,
        String(clampWorkspaceSplitRatio(workspaceSplitRatio)),
      );
    } catch {
      // Best-effort persistence.
    }
  }, [workspaceSplitRatio]);

  useEffect(() => {
    const nextLayoutMode = workspaceGridPreset === "single" ? "single" : "split";
    setWorkspaceLayoutMode((current) =>
      current === nextLayoutMode ? current : nextLayoutMode,
    );
  }, [workspaceGridPreset]);

  useEffect(() => {
    const activePane = workspaceGridPanes.find(
      (pane) => pane.id === workspaceGridActivePaneId,
    );
    if (activePane?.kind === "code" || activePane?.kind === "chat") {
      const nextView: WorkspaceViewKind = activePane.kind;
      setActiveWorkspaceView((current) =>
        current === nextView ? current : nextView,
      );
    }
  }, [workspaceGridActivePaneId, workspaceGridPanes]);

  useEffect(() => {
    if (workspaceGridPreset !== "1x2") {
      return;
    }

    const firstSlotPane = workspaceGridPanes.find(
      (pane) => pane.id === workspaceGridSlots[0]?.paneId,
    );
    if (firstSlotPane?.kind === "code" || firstSlotPane?.kind === "chat") {
      const nextOrder =
        firstSlotPane.kind === "code" ? "code_left" : "chat_left";
      setWorkspaceSplitOrder((current) =>
        current === nextOrder ? current : nextOrder,
      );
    }
  }, [workspaceGridPanes, workspaceGridPreset, workspaceGridSlots]);

  useEffect(() => {
    pendingPrefillRef.current = pendingPrefill;
  }, [pendingPrefill]);

  function clearPrefillTimers() {
    if (prefillRetryTimerRef.current !== null) {
      window.clearTimeout(prefillRetryTimerRef.current);
      prefillRetryTimerRef.current = null;
    }
    if (prefillAckTimerRef.current !== null) {
      window.clearTimeout(prefillAckTimerRef.current);
      prefillAckTimerRef.current = null;
    }
  }

  function clearFrontendReadyReportTimer() {
    if (frontendReadyReportTimerRef.current !== null) {
      window.clearTimeout(frontendReadyReportTimerRef.current);
      frontendReadyReportTimerRef.current = null;
    }
  }

  function clearSessionNavigateTimer() {
    if (sessionNavigateTimerRef.current !== null) {
      window.clearTimeout(sessionNavigateTimerRef.current);
      sessionNavigateTimerRef.current = null;
    }
  }

  const applySessionBridgeToGrid = useCallback(
    (payload: WorkspaceSessionBridgePayload) => {
      const sessionId = payload.sessionId?.trim();
      if (!sessionId) {
        return false;
      }

      const requestId = payload.requestId?.trim();
      if (requestId && handledSessionNavigationIdsRef.current.has(requestId)) {
        return true;
      }
      const rememberRequest = () => {
        if (!requestId) return;
        const handled = handledSessionNavigationIdsRef.current;
        handled.add(requestId);
        if (handled.size > 512) handled.delete(handled.values().next().value!);
      };

      const disposition =
        payload.disposition ??
        (payload.source === "open_dir_request" || payload.source === "open_files_request"
          ? "new_pane"
          : "replace_active");
      const placement = openSessionInWorkspaceGrid({
        sessionId,
        workDir: payload.workDir?.trim() || undefined,
        disposition,
        targetPaneId: workspaceGridActivePaneId ?? undefined,
        title: getKimiAssistantDisplayName(),
      });
      rememberRequest();
      if (placement.kind !== "limit_reached") {
        return placement.paneId !== null;
      }
      const activePane = workspaceGridPanes.find(
        (pane) => pane.id === workspaceGridActivePaneId,
      );
      if (
        activePane &&
        window.confirm(
          "窗格库已达 12 个上限。是否用新工作区替换当前窗格？\n选择“取消”后可打开窗格库关闭或切换窗格。",
        )
      ) {
        configureWorkspaceGridPane(activePane.id, {
          kind: "code",
          title: getKimiAssistantDisplayName(),
          sessionId,
          workDir: payload.workDir?.trim() || undefined,
        });
        setWorkspaceGridActivePane(activePane.id);
      } else {
        setActionError("未打开新工作区；请在窗格库中关闭一个窗格后重试。");
      }
      return true;
    },
    [
      configureWorkspaceGridPane,
      openSessionInWorkspaceGrid,
      setWorkspaceGridActivePane,
      workspaceGridActivePaneId,
      workspaceGridPanes,
    ],
  );

  const handlePaneSessionObserved = useCallback(
    (paneId: string, sessionId: string | null) => {
      const normalizedSessionId = sessionId?.trim() || null;
      // 先记录观测到的会话(即便目录还未知),供 store 侧做过期回写判断。
      setWorkspaceGridPaneActiveSession(paneId, normalizedSessionId);
      if (!normalizedSessionId) {
        return;
      }
      void getGridSession(normalizedSessionId)
        .then((session) => {
          const workDir = session.workDir?.trim();
          if (session.sessionId.trim() !== normalizedSessionId || !workDir) {
            return;
          }
          // store 内部会校验 activeSessionId 是否仍等于该会话,过期结果会被丢弃。
          setWorkspaceGridPaneActiveSession(paneId, normalizedSessionId, workDir);
        })
        .catch(() => {
          // 目录暂不可得(会话刚创建/后端未就绪):保留窗格上一次的目录名即可。
        });
    },
    [setWorkspaceGridPaneActiveSession],
  );

  const syncCodePaneWorkDir = useCallback(
    (sessionId?: string, workDir?: string) => {
      const normalizedSessionId = sessionId?.trim();
      const nextWorkDir = workDir?.trim();
      if (!normalizedSessionId || !nextWorkDir) {
        return;
      }

      setWorkspaceGridSessionWorkDir(normalizedSessionId, nextWorkDir);
    },
    [setWorkspaceGridSessionWorkDir],
  );

  function clearShutdownElapsedTimer(resetValue: boolean) {
    if (shutdownElapsedTimerRef.current !== null) {
      window.clearInterval(shutdownElapsedTimerRef.current);
      shutdownElapsedTimerRef.current = null;
    }
    shutdownElapsedBaseRef.current = 0;
    shutdownElapsedStartedAtRef.current = 0;
    if (resetValue) {
      setShutdownElapsedMs(null);
    }
  }

  function startShutdownElapsedTimer(baseElapsedMs?: number) {
    const safeBase = Math.max(0, baseElapsedMs ?? 0);
    clearShutdownElapsedTimer(false);
    shutdownElapsedBaseRef.current = safeBase;
    shutdownElapsedStartedAtRef.current = Date.now();
    setShutdownElapsedMs(safeBase);
    shutdownElapsedTimerRef.current = window.setInterval(() => {
      const delta = Math.max(0, Date.now() - shutdownElapsedStartedAtRef.current);
      setShutdownElapsedMs(shutdownElapsedBaseRef.current + delta);
    }, 100);
  }

  function applyRouteHash(route: string) {
    const normalized = route.replace(/^\/+/, "").trim();
    if (!normalized) {
      return;
    }

    const targetHash = `#/${normalized}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = `/${normalized}`;
    }
    setRouteHash(window.location.hash);
  }

  function resetControlCenterNavigation() {
    setActiveControlSection("onboarding");
    setActiveRuntimePanel("paths");
    setActiveControlTask(null);
    setActiveControlTaskPayload(null);
  }

  function setControlCenterTask(
    task: ControlCenterTaskId | null,
    payload: ControlCenterTaskPayload | null = null,
  ) {
    setActiveControlTask(task);
    setActiveControlTaskPayload(payload);
  }

  function closeActiveControlTask() {
    if (
      (activeControlTask === "skill_git_import" || activeControlTask === "skill_import") &&
      skillCenterBusy
    ) {
      return false;
    }

    setControlCenterTask(null);
    return true;
  }

  function requestCloseControlCenter() {
    if (kimiCodeAccessDirty && !window.confirm("API 配置存在未保存更改，确定关闭控制中心吗？")) {
      return false;
    }
    if (activeControlTask) {
      return closeActiveControlTask();
    }

    if (screen === "workspace") {
      setControlCenterModalOpen(false);
      resetControlCenterNavigation();
      return true;
    }

    resetControlCenterNavigation();
    window.location.hash = "/loading";
    setRouteHash(window.location.hash);
    return true;
  }

  function dismissControlCenter() {
    if (kimiCodeAccessDirty) {
      const confirmed = window.confirm("API 配置存在未保存更改，确定关闭控制中心吗？");
      if (!confirmed) {
        return false;
      }
    }

    if (
      (activeControlTask === "skill_git_import" || activeControlTask === "skill_import") &&
      skillCenterBusy
    ) {
      return false;
    }

    setControlCenterTask(null);

    if (screen === "workspace") {
      setControlCenterModalOpen(false);
      resetControlCenterNavigation();
      return true;
    }

    resetControlCenterNavigation();
    window.location.hash = "/loading";
    setRouteHash(window.location.hash);
    return true;
  }

  function isWorkspaceReady(nextStatus: AppStatus | null | undefined) {
    return nextStatus?.state === "running" && typeof nextStatus.activePort === "number";
  }

  function isOnboardingDismissed(nextOnboarding: OnboardingStatus | null | undefined) {
    return nextOnboarding != null && !nextOnboarding.shouldShowOnboarding;
  }

  function navigateToWorkspaceAfterOnboarding() {
    setPendingWorkspaceEntryAfterOnboarding(false);
    if (controlCenterModalOpen) {
      handleCloseInstallCommands();
      resetControlCenterNavigation();
      setControlCenterModalOpen(false);
      return;
    }
    resetControlCenterNavigation();
    window.location.hash = "";
    setRouteHash(window.location.hash);
  }

  function parkOnControlCenterOverviewAwaitingWorkspace() {
    setPendingWorkspaceEntryAfterOnboarding(true);
    setActiveControlSection("onboarding");
    setActiveRuntimePanel("paths");
    if (!controlCenterModalOpen) {
      applyRouteHash("/control-center");
    }
  }

  function startWorkspacePane(
    nextLoadIdentity: string | null,
    previousLoadIdentity: string | null,
    setPaneState: Dispatch<SetStateAction<WorkspacePaneState>>,
    rememberLoadIdentity: (identity: string | null) => void,
  ) {
    if (!nextLoadIdentity) {
      rememberLoadIdentity(null);
      setPaneState("idle");
      return null;
    }

    if (previousLoadIdentity === nextLoadIdentity) {
      return null;
    }

    rememberLoadIdentity(nextLoadIdentity);
    setPaneState("loading");
    return window.setTimeout(() => {
      setPaneState((current) => (current === "ready" ? current : "blocked"));
    }, WORKSPACE_PANE_TIMEOUT_MS);
  }

  const enqueuePrefillPayload = useCallback(
    (payload: PrefillChatPayload, source: string) => {
      const requestId = payload.requestId?.trim();
      const text = payload.text ?? "";
      if (!requestId || !text.trim()) {
        return;
      }
      if (handledPrefillIdsRef.current.has(requestId)) {
        return;
      }

      clearPrefillTimers();
      inFlightPrefillRequestRef.current = null;
      prefillLastFailureReasonRef.current = null;
      prefillAttemptsRef.current[requestId] = prefillAttemptsRef.current[requestId] ?? 0;
      setPendingPrefill({
        requestId,
        text,
        autoSend: payload.autoSend !== false,
      });
      setActionError(null);
      void source;
    },
    [],
  );

  const dispatchPendingSessionBridge = useCallback(
    (source: string) => {
      const payload = pendingSessionBridgeRef.current;
      if (!payload) {
        return;
      }
      if (payload.action !== "navigate_session") {
        pendingSessionBridgeRef.current = null;
        return;
      }
      if (applySessionBridgeToGrid(payload)) {
        pendingSessionBridgeRef.current = null;
        clearSessionNavigateTimer();
        prefillDispatchRef.current?.("session_navigation_grid");
        return;
      }
      if (status?.state !== "running" || workspaceEmbedState !== "ready") {
        return;
      }
      if (!workspaceOrigin) {
        return;
      }

      const frameWindow = workspaceIframeRef.current?.contentWindow;
      if (!frameWindow) {
        return;
      }

      const routeTemplate =
        payload.routeTemplate?.trim() || sessionRouteTemplateRef.current || undefined;
      try {
        frameWindow.postMessage(
          {
            source: SESSION_SYNC_SOURCE,
            action: "navigate_session",
            requestId: payload.requestId,
            sessionId: payload.sessionId,
            routeTemplate,
          },
          workspaceOrigin,
        );
      } catch (error) {
        setActionError(String(error));
        return;
      }

      clearSessionNavigateTimer();
      sessionNavigateTimerRef.current = window.setTimeout(() => {
        sessionNavigateTimerRef.current = null;
        if (pendingSessionBridgeRef.current?.requestId === payload.requestId) {
          pendingSessionBridgeRef.current = null;
          setActionError(
            `Session navigation timed out (${payload.sessionId ?? "unknown"}).`,
          );
          prefillDispatchRef.current?.("session_navigation_timeout");
        }
      }, SESSION_NAVIGATE_TIMEOUT_MS);

      void source;
    },
    [applySessionBridgeToGrid, status?.state, workspaceEmbedState, workspaceOrigin],
  );

  const dispatchPendingPrefillToWorkspace = useCallback(
    (source: string) => {
      const payload = pendingPrefillRef.current;
      if (!payload) {
        return;
      }
      if (handledPrefillIdsRef.current.has(payload.requestId)) {
        setPendingPrefill(null);
        return;
      }
      if (pendingSessionBridgeRef.current) {
        return;
      }
      if (status?.state !== "running" || workspaceEmbedState !== "ready") {
        return;
      }
      if (!workspaceOrigin) {
        return;
      }

      const frameWindow = workspaceIframeRef.current?.contentWindow;
      if (!frameWindow) {
        return;
      }

      const attempts = (prefillAttemptsRef.current[payload.requestId] ?? 0) + 1;
      prefillAttemptsRef.current[payload.requestId] = attempts;
      if (attempts > PREFILL_MAX_ATTEMPTS) {
        clearPrefillTimers();
        inFlightPrefillRequestRef.current = null;
        setPendingPrefill(null);
        const reason = prefillLastFailureReasonRef.current;
        setActionError(
          reason
            ? `Prefill dispatch exceeded retry limit (${payload.requestId}): ${reason}.`
            : `Prefill dispatch exceeded retry limit (${payload.requestId}).`,
        );
        return;
      }

      try {
        frameWindow.postMessage(
          {
            source: PREFILL_SYNC_SOURCE,
            requestId: payload.requestId,
            text: payload.text,
            autoSend: payload.autoSend !== false,
          },
          workspaceOrigin,
        );
        inFlightPrefillRequestRef.current = payload.requestId;
      } catch (error) {
        if (prefillRetryTimerRef.current === null) {
          prefillRetryTimerRef.current = window.setTimeout(() => {
            prefillRetryTimerRef.current = null;
            prefillDispatchRef.current?.("retry_after_postmessage_error");
          }, PREFILL_RETRY_DELAY_MS);
        }
        setActionError(String(error));
        return;
      }

      if (prefillAckTimerRef.current !== null) {
        window.clearTimeout(prefillAckTimerRef.current);
      }
      prefillAckTimerRef.current = window.setTimeout(() => {
        prefillAckTimerRef.current = null;
        if (pendingPrefillRef.current?.requestId === payload.requestId) {
          if (prefillRetryTimerRef.current === null) {
            prefillRetryTimerRef.current = window.setTimeout(() => {
              prefillRetryTimerRef.current = null;
              prefillDispatchRef.current?.("retry_after_ack_timeout");
            }, PREFILL_RETRY_DELAY_MS);
          }
        }
      }, PREFILL_ACK_TIMEOUT_MS);

      void source;
    },
    [status?.state, workspaceEmbedState, workspaceOrigin],
  );

  prefillDispatchRef.current = dispatchPendingPrefillToWorkspace;

  async function refreshStatus() {
    try {
      const data = await invoke<AppStatus>("get_app_status");
      setStatus(data);
      setBootHint(null);
      void refreshWorkspaceEmbedUrlForStatus(data);
      if (data.state !== "stopping") {
        setShutdownProgress(null);
        clearShutdownElapsedTimer(true);
      }
      setActionError(null);
      return data;
    } catch (error) {
      setActionError(String(error));
      return null;
    } finally {
      setShellBootPending(false);
      setIsLoading(false);
    }
  }

  async function refreshOnboarding() {
    try {
      const data = await invoke<OnboardingStatus>("get_onboarding_status");
      setOnboarding(data);
      setActionError(null);
      return data;
    } catch (error) {
      setActionError(String(error));
      return null;
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

  async function handleRunKimiDoctor() {
    setKimiDoctorBusy(true);
    try {
      const data = await invoke<KimiDoctorResult>("run_kimi_doctor");
      setKimiDoctorResult(data);
      setActionError(null);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setKimiDoctorBusy(false);
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

  async function handleSaveBridgeConnectorSecrets(input: BridgeConnectorSecretsInput) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      const data = await invoke<BridgeSecretsMaskView>("save_bridge_connector_secrets", {
        input,
      });
      setBridgeSecretsMask(data);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleStartFeishuConnectorOnboarding(connectorId: string) {
    setFeishuConnectorOnboardingBusy(true);
    setActionError(null);
    try {
      const data = await invoke<FeishuConnectorOnboardingSession>(
        "start_feishu_connector_onboarding",
        {
          input: {
            connectorId,
          } satisfies StartFeishuConnectorOnboardingInput,
        },
      );
      setFeishuConnectorOnboarding(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    } finally {
      setFeishuConnectorOnboardingBusy(false);
    }
  }

  async function handleRefreshFeishuConnectorOnboardingStatus(sessionId: string) {
    setActionError(null);
    try {
      const data = await invoke<FeishuConnectorOnboardingSession>(
        "get_feishu_connector_onboarding_status",
        { sessionId },
      );
      setFeishuConnectorOnboarding(data);
      if (data.state === "succeeded") {
        await Promise.all([
          refreshBridgeSettings(),
          refreshBridgeStatus(),
          refreshBridgeSessions(),
          refreshBridgeBindings(),
          refreshBridgeApprovals(),
          refreshBridgeLogTail(),
          refreshBridgeSecretsMask(),
        ]);
      }
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  async function handleCancelFeishuConnectorOnboarding(sessionId: string) {
    setFeishuConnectorOnboardingBusy(true);
    setActionError(null);
    try {
      const data = await invoke<FeishuConnectorOnboardingSession>(
        "cancel_feishu_connector_onboarding",
        { sessionId },
      );
      setFeishuConnectorOnboarding(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    } finally {
      setFeishuConnectorOnboardingBusy(false);
    }
  }

  async function handleStartWeixinConnectorOnboarding(connectorId: string) {
    setWeixinConnectorOnboardingBusy(true);
    setActionError(null);
    try {
      const data = await invoke<WeixinConnectorOnboardingSession>(
        "start_weixin_connector_onboarding",
        {
          input: {
            connectorId,
          } satisfies StartWeixinConnectorOnboardingInput,
        },
      );
      setWeixinConnectorOnboarding(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    } finally {
      setWeixinConnectorOnboardingBusy(false);
    }
  }

  async function handleRefreshWeixinConnectorOnboardingStatus(sessionId: string) {
    setActionError(null);
    try {
      const data = await invoke<WeixinConnectorOnboardingSession>(
        "get_weixin_connector_onboarding_status",
        { sessionId },
      );
      setWeixinConnectorOnboarding(data);
      if (data.state === "succeeded") {
        await Promise.all([
          refreshBridgeSettings(),
          refreshBridgeStatus(),
          refreshBridgeSessions(),
          refreshBridgeBindings(),
          refreshBridgeApprovals(),
          refreshBridgeLogTail(),
          refreshBridgeSecretsMask(),
        ]);
      }
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  async function handleCancelWeixinConnectorOnboarding(sessionId: string) {
    setWeixinConnectorOnboardingBusy(true);
    setActionError(null);
    try {
      const data = await invoke<WeixinConnectorOnboardingSession>(
        "cancel_weixin_connector_onboarding",
        { sessionId },
      );
      setWeixinConnectorOnboarding(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    } finally {
      setWeixinConnectorOnboardingBusy(false);
    }
  }

  async function refreshCoreState() {
    return Promise.all([refreshStatus(), refreshOnboarding()]);
  }

  async function refreshMainWindowCloseBehavior() {
    try {
      const behavior = await invoke<MainWindowCloseBehavior>(
        "get_main_window_close_behavior",
      );
      setMainWindowCloseBehavior(behavior);
      return behavior;
    } catch (error) {
      setActionError(String(error));
      return mainWindowCloseBehavior;
    }
  }

  async function handleSaveMainWindowCloseBehavior(behavior: MainWindowCloseBehavior) {
    setActionError(null);
    try {
      const saved = await invoke<MainWindowCloseBehavior>(
        "save_main_window_close_behavior",
        { behavior },
      );
      setMainWindowCloseBehavior(saved);
      return saved;
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  async function handleSubmitMainWindowCloseDecision(
    input: MainWindowCloseDecisionInput,
  ) {
    setActionError(null);
    try {
      await invoke("submit_main_window_close_decision", { input });
      setMainWindowCloseDecisionRequest(null);
      const persisted = await refreshMainWindowCloseBehavior();
      if (!input.remember && persisted !== "ask") {
        setMainWindowCloseBehavior("ask");
      }
    } catch (error) {
      setActionError(String(error));
    }
  }

  useEffect(() => {
    if (!tauriRuntime) {
      setListenersReady(false);
      return;
    }

    let disposed = false;
    let unlistenRoute: (() => void) | undefined;
    let unlistenPrefill: (() => void) | undefined;
    let unlistenShutdownProgress: (() => void) | undefined;
    let unlistenOpenRequestError: (() => void) | undefined;
    let unlistenWorkspaceImportRequest: (() => void) | undefined;
    let unlistenWorkspaceImportResult: (() => void) | undefined;
    let unlistenSessionBootstrap: (() => void) | undefined;
    let unlistenSessionBridge: (() => void) | undefined;
    let unlistenMainCloseDecisionRequest: (() => void) | undefined;

    const bindListeners = async () => {
      try {
        const currentWebviewWindow = getCurrentWebviewWindow();
        const [
          routeOff,
          prefillOff,
          shutdownOff,
          openRequestErrorOff,
          workspaceImportRequestOff,
          workspaceImportResultOff,
          bootstrapOff,
          sessionBridgeOff,
          mainCloseDecisionRequestOff,
        ] =
          await Promise.all([
          currentWebviewWindow.listen<ShellRoutePayload>(
            SHELL_ROUTE_EVENT,
            (event) => {
              const route = event.payload?.route ?? "";
              applyRouteHash(route);
            },
          ),
          currentWebviewWindow.listen<PrefillChatPayload>(
            PREFILL_CHAT_EVENT,
            (event) => {
              enqueuePrefillPayload(event.payload, "event_listener");
            },
          ),
          currentWebviewWindow.listen<ShutdownProgressPayload>(
            SHUTDOWN_PROGRESS_EVENT,
            (event) => {
              setShutdownProgress(event.payload);
              startShutdownElapsedTimer(event.payload?.elapsedMs);
            },
          ),
          currentWebviewWindow.listen<OpenRequestErrorPayload>(
            OPEN_REQUEST_ERROR_EVENT,
            (event) => {
              const payload = event.payload;
              const source = payload.source?.trim() || "unknown";
              const stage = payload.stage?.trim() || "unknown";
              const message = payload.message?.trim() || "Unknown open-request error";
              const argsPart = payload.argsSummary?.trim()
                ? `; args=${payload.argsSummary.trim()}`
                : "";
              setActionError(
                `Open request failed [${source}/${stage}]: ${message}${argsPart}`,
              );
            },
          ),
          currentWebviewWindow.listen<WorkspaceImportRequestPayload>(
            WORKSPACE_IMPORT_REQUEST_EVENT,
            (event) => {
              handleWorkspaceImportRequest(event.payload);
            },
          ),
          currentWebviewWindow.listen<WorkspaceImportResult>(
            WORKSPACE_IMPORT_RESULT_EVENT,
            (event) => {
              handleWorkspaceImportResult(event.payload);
            },
          ),
          currentWebviewWindow.listen<WorkspaceSessionBridgePayload>(
            WORKSPACE_SESSION_BOOTSTRAP_EVENT,
            (event) => {
              const payload = event.payload;
              if (payload.routeTemplate?.trim()) {
                sessionRouteTemplateRef.current = payload.routeTemplate.trim();
              }
              if (payload.action === "active_session_updated") {
                setStatus((current) => {
                  if (!current) {
                    return current;
                  }
                  const nextSessionId = payload.sessionId?.trim() || undefined;
                  const nextWorkDir = payload.workDir?.trim() || undefined;
                  return {
                    ...current,
                    activeSessionId: nextSessionId,
                    activeSessionWorkDir: nextWorkDir,
                    sessionSource: payload.source?.trim() || current.sessionSource,
                  };
                });
                syncCodePaneWorkDir(payload.sessionId, payload.workDir);
              }
              if (payload.action === "navigate_session") {
                pendingSessionBridgeRef.current = payload;
                dispatchPendingSessionBridge("bootstrap_event");
              }
            },
          ),
          currentWebviewWindow.listen<WorkspaceSessionBridgePayload>(
            WORKSPACE_SESSION_BRIDGE_EVENT,
            (event) => {
              const payload = event.payload;
              if (payload.routeTemplate?.trim()) {
                sessionRouteTemplateRef.current = payload.routeTemplate.trim();
              }
              if (payload.action === "active_session_updated") {
                setStatus((current) => {
                  if (!current) {
                    return current;
                  }
                  const nextSessionId = payload.sessionId?.trim() || undefined;
                  const nextWorkDir = payload.workDir?.trim() || undefined;
                  return {
                    ...current,
                    activeSessionId: nextSessionId,
                    activeSessionWorkDir: nextWorkDir,
                    sessionSource: payload.source?.trim() || current.sessionSource,
                  };
                });
                syncCodePaneWorkDir(payload.sessionId, payload.workDir);
              }
              if (payload.action === "navigate_session") {
                pendingSessionBridgeRef.current = payload;
                dispatchPendingSessionBridge("bridge_event");
              }
            },
          ),
          currentWebviewWindow.listen<MainWindowCloseDecisionRequestPayload>(
            MAIN_WINDOW_CLOSE_DECISION_REQUEST_EVENT,
            (event) => {
              setMainWindowCloseDecisionRequest(event.payload);
            },
          ),
        ]);

        if (disposed) {
          routeOff();
          prefillOff();
          shutdownOff();
          openRequestErrorOff();
          workspaceImportRequestOff();
          workspaceImportResultOff();
          bootstrapOff();
          sessionBridgeOff();
          mainCloseDecisionRequestOff();
          return;
        }

        unlistenRoute = routeOff;
        unlistenPrefill = prefillOff;
        unlistenShutdownProgress = shutdownOff;
        unlistenOpenRequestError = openRequestErrorOff;
        unlistenWorkspaceImportRequest = workspaceImportRequestOff;
        unlistenWorkspaceImportResult = workspaceImportResultOff;
        unlistenSessionBootstrap = bootstrapOff;
        unlistenSessionBridge = sessionBridgeOff;
        unlistenMainCloseDecisionRequest = mainCloseDecisionRequestOff;
        setListenersReady(true);
      } catch (error) {
        setActionError(String(error));
      }
    };

    void bindListeners();

    return () => {
      disposed = true;
      setListenersReady(false);
      if (unlistenRoute) {
        unlistenRoute();
      }
      if (unlistenPrefill) {
        unlistenPrefill();
      }
      if (unlistenShutdownProgress) {
        unlistenShutdownProgress();
      }
      if (unlistenOpenRequestError) {
        unlistenOpenRequestError();
      }
      if (unlistenWorkspaceImportRequest) {
        unlistenWorkspaceImportRequest();
      }
      if (unlistenWorkspaceImportResult) {
        unlistenWorkspaceImportResult();
      }
      if (unlistenSessionBootstrap) {
        unlistenSessionBootstrap();
      }
      if (unlistenSessionBridge) {
        unlistenSessionBridge();
      }
      if (unlistenMainCloseDecisionRequest) {
        unlistenMainCloseDecisionRequest();
      }
    };
  }, [
    dispatchPendingSessionBridge,
    enqueuePrefillPayload,
    handleWorkspaceImportRequest,
    handleWorkspaceImportResult,
    syncCodePaneWorkDir,
    tauriRuntime,
  ]);

  useEffect(() => {
    if (!tauriRuntime || !listenersReady || frontendReadyHandshakeSentRef.current) {
      return;
    }
    if (isWorkspaceImportPickerRoute) {
      setShellBootPending(false);
      return;
    }

    frontendReadyHandshakeSentRef.current = true;
    void invoke<FrontendReadyAck>("notify_frontend_ready")
      .then((ack) => {
        if (ack.backendState === "running" && ack.workspaceUrl?.trim()) {
          setWorkspaceEmbedUrl(ack.workspaceUrl, ack.startCycleId);
          setBootHint({
            backendState: ack.backendState,
            startCycleId: ack.startCycleId,
          });
        }
        if (ack.pendingPrefill) {
          enqueuePrefillPayload(ack.pendingPrefill, "ready_ack");
        }
        const reportVisibleRender = () => {
          if (loadingReportCycleRef.current !== ack.startCycleId) {
            loadingReportCycleRef.current = ack.startCycleId;
            void invoke("report_loading_rendered", {
              startCycleId: ack.startCycleId,
            }).catch(() => {
              // Best-effort metric reporting.
            });
          }
          setShellBootPending(false);
        };
        // Hidden startup windows can stall requestAnimationFrame entirely,
        // which deadlocks the Rust-side show() handoff.
        clearFrontendReadyReportTimer();
        frontendReadyReportTimerRef.current = window.setTimeout(() => {
          frontendReadyReportTimerRef.current = null;
          reportVisibleRender();
        }, 0);
        void refreshCoreState();
      })
      .catch(() => {
        // Best-effort startup handshake.
        clearFrontendReadyReportTimer();
        setShellBootPending(false);
      });
  }, [enqueuePrefillPayload, isWorkspaceImportPickerRoute, listenersReady, tauriRuntime]);

  useEffect(() => {
    const handleWorkspaceBridgeMessage = (event: MessageEvent) => {
      const payload = event.data as
        | (PrefillBridgeAck & {
            source?: string;
            action?: string;
            url?: string;
            bridgeNonce?: string;
            routeTemplate?: string;
            sessionId?: string;
          })
        | null;
      if (!payload || typeof payload.source !== "string") {
        return;
      }

      if (payload.source === CHAT_EXTERNAL_LINK_BRIDGE_SOURCE) {
        if (!chatOrigin || event.origin !== chatOrigin) {
          return;
        }
        const externalUrl = normalizeExternalOpenUrl(payload.url ?? "");
        if (!externalUrl) {
          console.debug("Ignored unsafe chat external URL bridge payload.");
          return;
        }
        void handleOpenExternalUrl(externalUrl);
        return;
      }

      if (payload.source === EXTERNAL_LINK_BRIDGE_SOURCE) {
        if (
          !workspaceOrigin ||
          event.origin !== workspaceOrigin ||
          !isTrustedWorkspaceIframeSource(event.source, workspaceIframeRef.current) ||
          !isExpectedWorkspaceBridgeNonce(
            payload.bridgeNonce,
            workspaceBridgeNonce,
          )
        ) {
          return;
        }
        const externalUrl = normalizeExternalOpenUrl(payload.url ?? "");
        if (!externalUrl) {
          console.debug("Ignored unsafe workspace external URL bridge payload.");
          return;
        }
        void handleOpenExternalUrl(externalUrl);
        return;
      }

      if (!workspaceOrigin || event.origin !== workspaceOrigin) {
        return;
      }

      if (payload.source === ENHANCED_WEB_READY_SOURCE) {
        if (workspaceWebSettings.mode === "enhanced_local") {
          void invoke<WorkspaceWebSettingsView>("mark_enhanced_web_ready")
            .then((nextSettings) => {
              setWorkspaceWebSettings(nextSettings);
            })
            .catch(() => {
              // Health persistence is best-effort; the iframe itself is already usable.
            });
        }
        return;
      }

      if (payload.source === SESSION_BRIDGE_SOURCE) {
        if (payload.routeTemplate?.trim()) {
          sessionRouteTemplateRef.current = payload.routeTemplate.trim();
        }
        if (payload.action === "navigate_session_ack") {
          clearSessionNavigateTimer();
          const currentRequestId = pendingSessionBridgeRef.current?.requestId?.trim();
          if (
            currentRequestId &&
            payload.requestId?.trim() &&
            payload.requestId?.trim() !== currentRequestId
          ) {
            return;
          }

          pendingSessionBridgeRef.current = null;
          if (!payload.applied) {
            const reason = payload.reason?.trim() || "unknown";
            setActionError(
              `Session navigation failed (${payload.sessionId ?? "unknown"}): ${reason}`,
            );
          }
          prefillDispatchRef.current?.("session_navigation_ack");
        }
        return;
      }

      if (payload.source !== PREFILL_BRIDGE_SOURCE) {
        return;
      }

      const requestId = payload.requestId?.trim();
      if (!requestId) {
        return;
      }
      if (
        pendingPrefillRef.current?.requestId !== requestId &&
        inFlightPrefillRequestRef.current !== requestId
      ) {
        return;
      }

      if (prefillAckTimerRef.current !== null) {
        window.clearTimeout(prefillAckTimerRef.current);
        prefillAckTimerRef.current = null;
      }

      if (payload.applied) {
        handledPrefillIdsRef.current.add(requestId);
        delete prefillAttemptsRef.current[requestId];
        inFlightPrefillRequestRef.current = null;
        prefillLastFailureReasonRef.current = null;
        setPendingPrefill((current) =>
          current?.requestId === requestId ? null : current,
        );
        return;
      }

      prefillLastFailureReasonRef.current = payload.reason?.trim() || "workspace_ack_failed";

      if (prefillRetryTimerRef.current === null) {
        prefillRetryTimerRef.current = window.setTimeout(() => {
          prefillRetryTimerRef.current = null;
          prefillDispatchRef.current?.("retry_after_ack_failed");
        }, PREFILL_RETRY_DELAY_MS);
      }
    };

    window.addEventListener("message", handleWorkspaceBridgeMessage);
    return () => window.removeEventListener("message", handleWorkspaceBridgeMessage);
  }, [
    chatOrigin,
    tauriRuntime,
    workspaceBridgeNonce,
    workspaceOrigin,
    workspaceWebSettings.mode,
  ]);

  useEffect(() => {
    if (!pendingPrefill) {
      clearPrefillTimers();
      inFlightPrefillRequestRef.current = null;
      prefillLastFailureReasonRef.current = null;
      return;
    }

    prefillDispatchRef.current?.("pending_prefill_state_change");
  }, [pendingPrefill, status?.state, workspaceEmbedState, workspaceOrigin]);

  useEffect(() => {
    if (!pendingSessionBridgeRef.current) {
      clearSessionNavigateTimer();
      return;
    }

    dispatchPendingSessionBridge("workspace_state_change");
  }, [dispatchPendingSessionBridge, status?.state, workspaceEmbedState, workspaceOrigin]);

  useEffect(() => {
    if (
      workspaceWebSettings.mode !== "enhanced_local" ||
      !workspaceWebSettings.autoFallback ||
      workspaceEmbedState !== "blocked"
    ) {
      return;
    }

    void handleFallbackWorkspaceWebToOfficial("enhanced_web_load_blocked").then(() => {
      void refreshStatus();
      void refreshDiagnostics();
    });
  }, [workspaceEmbedState, workspaceWebSettings.autoFallback, workspaceWebSettings.mode]);

  useEffect(() => {
    if (status?.state === "running") {
      return;
    }
    pendingSessionBridgeRef.current = null;
    clearSessionNavigateTimer();
  }, [status?.state]);

  useEffect(
    () => () => {
      clearFrontendReadyReportTimer();
      clearPrefillTimers();
      clearSessionNavigateTimer();
      clearShutdownElapsedTimer(true);
      prefillLastFailureReasonRef.current = null;
    },
    [],
  );

  async function loadKimiCodeAccessConfig() {
    try {
      const data = await invoke<KimiCodeAccessConfigView>("load_kimi_code_access_config");
      setKimiCodeAccessView(data);
      const nextInput = toKimiCodeAccessInput(data);
      setKimiCodeAccessDraft(nextInput);
      setKimiCodeAccessSnapshot(cloneKimiCodeAccessInput(nextInput));
      setKimiCodeAccessTestResult(null);
      setActionError(null);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  async function refreshWorkspaceWebSettings() {
    const data = await invoke<WorkspaceWebSettingsView>("get_workspace_web_settings");
    if (data.mode === "enhanced_local") {
      const officialData = await invoke<WorkspaceWebSettingsView>(
        "fallback_workspace_web_to_official",
        { reason: "official_web_i18n_available" },
      );
      setWorkspaceWebSettings(officialData);
      setWorkspaceFrameReloadToken((current) => current + 1);
      setWorkspaceEmbedState("loading");
      return officialData;
    }
    setWorkspaceWebSettings(data);
    return data;
  }

  async function handleFallbackWorkspaceWebToOfficial(reason = "manual_fallback") {
    try {
      const data = await invoke<WorkspaceWebSettingsView>(
        "fallback_workspace_web_to_official",
        { reason },
      );
      setWorkspaceWebSettings(data);
      setWorkspaceFrameReloadToken((current) => current + 1);
      setWorkspaceEmbedState("loading");
      setActionError(null);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  useShellPollingController({
    tauriRuntime,
    enabled: !isWorkspaceImportPickerRoute,
    screen,
    controlCenterModalOpen,
    activeControlSection,
    activeControlTask,
    activeRuntimePanel,
    bridgeState: bridgeStatus.state,
    refreshStatus,
    refreshOnboarding,
    refreshInstallSettings,
    refreshWorkspaceWebSettings,
    refreshPowerShellPreflight,
    refreshBridgeSettings,
    refreshBridgeStatus,
    refreshBridgeSecretsMask,
    refreshBridgeBindings,
    refreshBridgeApprovals,
    refreshBridgeLogTail,
    refreshMainWindowCloseBehavior,
  });

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

  const bridgeOnboardingDirty = useMemo(() => {
    return (
      bridgeOnboardingDraft.enabled !== bridgeSettings.enabled ||
      bridgeOnboardingDraft.autoStart !== bridgeSettings.autoStart ||
      bridgeOnboardingDraft.feishuEnabled !==
        getBridgeChannelEnabled(bridgeSettings, "feishu") ||
      hasBridgeDraftSecretValue(bridgeOnboardingDraft.feishu.appId) ||
      hasBridgeDraftSecretValue(bridgeOnboardingDraft.feishu.appSecret) ||
      hasBridgeDraftSecretValue(bridgeOnboardingDraft.feishu.verificationToken) ||
      hasBridgeDraftSecretValue(bridgeOnboardingDraft.feishu.encryptKey)
    );
  }, [bridgeOnboardingDraft, bridgeSettings]);

  const bridgeOnboardingValidation = useMemo(
    () =>
      createBridgeOnboardingValidation(
        bridgeOnboardingDraft,
        bridgeSecretsMask,
        bridgeOnboardingDirty,
      ),
    [bridgeOnboardingDirty, bridgeOnboardingDraft, bridgeSecretsMask],
  );
  const bridgeSettingsDirty = useMemo(
    () => JSON.stringify(bridgeSettingsSnapshot) !== JSON.stringify(bridgeSettings),
    [bridgeSettings, bridgeSettingsSnapshot],
  );
  const bridgeIsRunning =
    bridgeStatus.state === "running" ||
    bridgeStatus.state === "starting" ||
    bridgeStatus.state === "degraded";

  useEffect(() => {
    // Keep onboarding draft synced with persisted settings unless the user is actively editing.
    if (bridgeOnboardingDirty && bridgeOnboardingDraftTouched) {
      return;
    }
    setBridgeOnboardingDraft(createDefaultBridgeOnboardingConfigInput(bridgeSettings));
    setBridgeOnboardingDraftTouched(false);
  }, [bridgeOnboardingDirty, bridgeOnboardingDraftTouched, bridgeSettings]);

  useEffect(() => {
    if (isWorkspaceImportPickerRoute) return;
    void refreshActiveSessionSkills();
  }, [isWorkspaceImportPickerRoute, status?.activeSessionId, status?.activeSessionWorkDir]);

  useEffect(() => {
    if (isWorkspaceImportPickerRoute) {
      return;
    }
    const visible =
      activeControlSection === "skill_center" &&
      (screen === "control_center" || controlCenterModalOpen);
    if (!visible) {
      return;
    }
    void refreshSkillCenterState();
  }, [
      activeControlSection,
      controlCenterModalOpen,
      isWorkspaceImportPickerRoute,
      screen,
      status?.activeSessionId,
      status?.activeSessionWorkDir,
      status?.effectiveWorkDir,
  ]);

  useEffect(() => {
    if (isWorkspaceImportPickerRoute) {
      return;
    }
    const visible =
      activeControlSection === "skill_center" &&
      (screen === "control_center" || controlCenterModalOpen);
    if (!visible) {
      return;
    }
    void refreshSkillDiscoveryState(selectedDiscoveryId);
  }, [
    activeControlSection,
    controlCenterModalOpen,
    isWorkspaceImportPickerRoute,
    screen,
    status?.activeSessionId,
    status?.activeSessionWorkDir,
    status?.effectiveWorkDir,
  ]);

  useEffect(() => {
    if (isWorkspaceImportPickerRoute) {
      return;
    }
    const visible =
      activeControlSection === "skill_center" &&
      skillCenterSection === "workspace_insights" &&
      (screen === "control_center" || controlCenterModalOpen);
    if (!visible) {
      return;
    }
    void refreshWorkspaceSkillManagementState(selectedWorkspaceSkillTargetId);
  }, [
    activeControlSection,
    controlCenterModalOpen,
    isWorkspaceImportPickerRoute,
    screen,
    selectedWorkspaceSkillTargetId,
    skillCenterSection,
    status?.activeSessionId,
    status?.activeSessionWorkDir,
    status?.effectiveWorkDir,
  ]);

  useEffect(() => {
    if (isWorkspaceImportPickerRoute) {
      return;
    }
    const workspaceKey =
      status?.activeSessionWorkDir?.trim() || status?.effectiveWorkDir?.trim() || "";
    const sessionId = status?.activeSessionId?.trim() || "";
    const pinnedSkillIds = workspaceSkillProfile?.pinnedSkillIds ?? [];
    const statusSignature = pinnedSkillIds
      .map((skillId) => {
        const installed = installedSkills.find((skill) => skill.id === skillId);
        const applied = activeSessionSkillState.appliedSkillIds.includes(skillId);
        return `${skillId}:${installed?.trusted ? "trusted" : "untrusted"}:${applied ? "applied" : "idle"}`;
      })
      .join("|");

    if (!workspaceKey || !sessionId) {
      workspaceSkillAutoRestoreKeyRef.current = null;
      setWorkspaceSkillRestoreResults([]);
      return;
    }
    if (pinnedSkillIds.length === 0) {
      workspaceSkillAutoRestoreKeyRef.current = `${sessionId}::${workspaceKey}::empty`;
      setWorkspaceSkillRestoreResults([]);
      return;
    }

    const runKey = `${sessionId}::${workspaceKey}::${statusSignature}`;
    if (workspaceSkillAutoRestoreKeyRef.current === runKey) {
      return;
    }
    workspaceSkillAutoRestoreKeyRef.current = runKey;

    let cancelled = false;
    void (async () => {
      const results: WorkspaceSkillRestoreResult[] = [];
      let appliedCount = 0;
      for (const skillId of pinnedSkillIds) {
        const skill = installedSkills.find((item) => item.id === skillId);
        if (!skill) {
          results.push({
            skillId,
            status: "missing_skill",
            detail: "已固定的 Skill 不再存在，无法自动恢复。",
          });
          continue;
        }
        if (activeSessionSkillState.appliedSkillIds.includes(skillId)) {
          results.push({
            skillId,
            status: "skipped_already_applied",
            detail: "这个 Skill 已经应用到当前工作区。",
          });
          continue;
        }
        if (!skill.trusted) {
          results.push({
            skillId,
            status: "skipped_untrusted",
            detail: "这个 Skill 尚未信任，只加入推荐，不会自动应用。",
          });
          continue;
        }

        try {
          await applySkill(skillId, "session_kimi");
          appliedCount += 1;
          results.push({
            skillId,
            status: "applied",
            detail: "已自动恢复到当前工作区。",
          });
        } catch (error) {
          results.push({
            skillId,
            status: "failed",
            detail: String(error),
          });
        }
      }

      if (cancelled) {
        return;
      }
      setWorkspaceSkillRestoreResults(results);
      if (appliedCount > 0) {
        try {
          await refreshSkillCenterState(selectedSkillId);
        } catch {
          // keep per-skill restore results visible even if the follow-up refresh fails
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeSessionSkillState.appliedSkillIds,
    installedSkills,
    isWorkspaceImportPickerRoute,
    selectedSkillId,
    status?.activeSessionId,
    status?.activeSessionWorkDir,
    status?.effectiveWorkDir,
    workspaceSkillProfile?.pinnedSkillIds,
  ]);

  useEffect(() => {
    if (screen === "workspace" || keepControlCenterForUpgrade) {
      return;
    }
    setControlCenterModalOpen(false);
    handleCloseInstallCommands();
    if (screen !== "control_center") {
      resetControlCenterNavigation();
    }
  }, [keepControlCenterForUpgrade, screen]);

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

  useEffect(() => {
    if (screen !== "control_center") return;

    const hashRoute = parseHashRoute(routeHash);
    if (hashRoute === "control-center") {
      resetControlCenterNavigation();
      return;
    }

    if (hashRoute === "onboarding") {
      setActiveControlSection("onboarding");
      void refreshOnboarding();
      return;
    }

    if (hashRoute === "diagnostics") {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel("core");
      void refreshDiagnostics();
      return;
    }

    if (hashRoute === "logs_paths") {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel("paths");
      void Promise.all([refreshDiagnostics(), refreshContextMenuStatus()]);
      return;
    }
  }, [routeHash, screen]);

  useEffect(() => {
    if (!pendingWorkspaceEntryAfterOnboarding) {
      return;
    }
    if (!isWorkspaceReady(status) || !isOnboardingDismissed(onboarding)) {
      return;
    }
    navigateToWorkspaceAfterOnboarding();
  }, [controlCenterModalOpen, onboarding, pendingWorkspaceEntryAfterOnboarding, status]);

  useEffect(() => {
    if (isWorkspaceImportPickerRoute) return;
    if (!status) return;
    if (status.state !== "starting") return;
    if (loadingReportCycleRef.current === status.startCycleId) return;

    loadingReportCycleRef.current = status.startCycleId;
    void invoke("report_loading_rendered", {
      startCycleId: status.startCycleId,
    }).catch(() => {
      // Best-effort metric reporting.
    });
  }, [isWorkspaceImportPickerRoute, status]);

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

  async function handleRuntimeOnlyRetry() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("restart_backend_runtime_only");
      await refreshCoreState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleRecoverMainWindowBoot() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("recover_main_window_boot");
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

  async function handleQuitAppGracefully() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("quit_app_gracefully");
    } catch (error) {
      setActionBusy(false);
      setActionError(String(error));
    }
  }

  async function handleOpenExternalUrl(url: string) {
    const normalized = normalizeExternalOpenUrl(url);
    if (!normalized) {
      console.debug("Ignored unsafe external URL open request.");
      return;
    }

    if (tauriRuntime) {
      try {
        await invoke("open_external_url", { url: normalized });
        return;
      } catch (error) {
        setActionError(String(error));
      }
    }

    try {
      const opened = window.open(normalized, "_blank", "noopener,noreferrer");
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

  async function handleOpenPaneFolder(frame: HTMLIFrameElement | null) {
    try {
      setActionError(null);
      if (!workspaceOrigin) {
        throw new Error("Kimi Code workspace 尚未就绪。");
      }

      const workDir = await resolveCurrentPaneWorkDir(() =>
        queryWorkspaceFrameSessionId(frame, workspaceOrigin),
      );
      await handleOpenFolder(workDir);
    } catch (error) {
      setActionError(`无法打开当前会话目录：${String(error)}`);
    }
  }

  async function handleOpenKimiConfigDir() {
    try {
      await invoke("open_kimi_config_dir");
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleOpenKimiCodeAccessPanel() {
    setActionError(null);
    setKimiCodeAccessBusy(true);
    try {
      await loadKimiCodeAccessConfig();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setKimiCodeAccessBusy(false);
    }
  }

  function handleKimiCodeAccessDraftChange(next: KimiCodeAccessConfigInput) {
    setKimiCodeAccessDraft(next);
  }

  async function handleSaveKimiCodeAccessConfig() {
    setActionBusy(true);
    setKimiCodeAccessBusy(true);
    setActionError(null);
    try {
      const data = await invoke<KimiCodeAccessConfigView>("save_kimi_code_access_config", {
        input: kimiCodeAccessDraft,
      });
      setKimiCodeAccessView({
        ...data,
        warnings: [
          ...data.warnings,
          "API 配置已保存；新建或重新打开的会话将使用新配置。",
        ],
      });
      const nextInput = toKimiCodeAccessInput(data);
      setKimiCodeAccessDraft(nextInput);
      setKimiCodeAccessSnapshot(cloneKimiCodeAccessInput(nextInput));
      setKimiCodeAccessTestResult(null);
      await refreshCoreState();
    } catch (error) {
      const message = formatKimiCodeAccessSaveError(error);
      setKimiCodeAccessView((current) =>
        current ? { ...current, configError: message } : current,
      );
    } finally {
      setActionBusy(false);
      setKimiCodeAccessBusy(false);
    }
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
      await invoke("restart_backend_runtime_only");
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

  async function handlePickBridgeDefaultWorkDir() {
    try {
      const selected = await open({
        title: "Select IM bridge default work directory",
        multiple: false,
        directory: true,
      });
      if (typeof selected === "string") {
        setBridgeSettings((current) => ({
          ...current,
          defaultWorkDir: selected,
        }));
      }
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handlePickBridgeConnectorDefaultWorkDir(connectorId: string) {
    try {
      const connector = bridgeSettings.connectors.find((item) => item.id === connectorId);
      const selected = await open({
        title: `Select default work directory for ${connector?.label ?? connectorId}`,
        multiple: false,
        directory: true,
      });
      if (typeof selected === "string") {
        return selected;
      }
      return null;
    } catch (error) {
      setActionError(String(error));
      return null;
    }
  }

  async function handleSaveWorkDirAndRestart() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("save_work_dir", { path: workDirInput.trim() });
      await invoke("restart_backend_runtime_only");
      await refreshCoreState();
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
      await invoke("restart_backend_runtime_only");
      await refreshCoreState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  function handleBridgeSettingsChange(next: BridgeSettings) {
    setBridgeSettings(next);
  }

  function handleBridgeOnboardingDraftChange(next: BridgeOnboardingConfigInput) {
    setBridgeOnboardingDraft(next);
    setBridgeOnboardingDraftTouched(true);
  }

  async function saveBridgeOnboardingInternal() {
    if (!bridgeOnboardingValidation.canSave) {
      throw new Error(
        bridgeOnboardingValidation.message ?? "当前外部 IM 通道配置不完整，无法保存。",
      );
    }

    const input: BridgeOnboardingConfigInput = {
      ...bridgeOnboardingDraft,
      enabled: true,
      feishuEnabled: true,
    };
    const saved = await invoke<BridgeSettings>("save_bridge_onboarding_config", {
      input,
    });
    setBridgeSettings(saved);
    setBridgeSettingsSnapshot(saved);
    setBridgeOnboardingDraft(createDefaultBridgeOnboardingConfigInput(saved));
    setBridgeOnboardingDraftTouched(false);
    return saved;
  }

  async function handleSaveBridgeOnboarding() {
    setBridgeBusy(true);
    setActionError(null);
    try {
      await saveBridgeOnboardingInternal();
      await Promise.all([refreshBridgeStatus(), refreshBridgeSecretsMask()]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function saveBridgeSettingsInternal(options?: {
    showRestartNotice?: boolean;
  }): Promise<BridgeSettings> {
    const showRestartNotice = options?.showRestartNotice ?? true;
    const presetsChanged =
      JSON.stringify(bridgeSettingsSnapshot.workDirPresets ?? []) !==
      JSON.stringify(bridgeSettings.workDirPresets ?? []);
    const feishuAutoApproveChanged =
      bridgeSettingsSnapshot.feishuAutoApprove !== bridgeSettings.feishuAutoApprove;
    const saved = await invoke<BridgeSettings>("save_bridge_settings", {
      input: bridgeSettings,
    });
    setBridgeSettings(saved);
    setBridgeSettingsSnapshot(saved);
    await refreshBridgeStatus();
    if (
      showRestartNotice &&
      bridgeIsRunning &&
      (presetsChanged || feishuAutoApproveChanged)
    ) {
      window.alert(
        "Bridge 配置已保存。重启 bridge 后，飞书工作目录预设和 Auto Approve 变更才会生效。",
      );
    }
    return saved;
  }

  async function handleSaveBridgeSettings() {
    try {
      await handlePersistBridgeSettings();
    } catch {
      return;
    }
  }

  async function handlePersistBridgeSettings(options?: {
    showRestartNotice?: boolean;
  }) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      return await saveBridgeSettingsInternal(options);
    } catch (error) {
      setActionError(`保存 Bridge 配置失败：${String(error)}`);
      throw error;
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleToggleBridgeConnectorEnabled(
    connectorId: string,
    enabled: boolean,
  ) {
    setBridgeBusy(true);
    setActionError(null);
    const previousSettings = JSON.parse(JSON.stringify(bridgeSettings)) as BridgeSettings;
    const nextSettings = {
      ...previousSettings,
      connectors: previousSettings.connectors.map((connector) =>
        connector.id === connectorId ? { ...connector, enabled } : connector,
      ),
    };
    const shouldRestart =
      bridgeStatus.state === "running" ||
      bridgeStatus.state === "starting" ||
      bridgeStatus.state === "degraded";

    setBridgeSettings(nextSettings);

    try {
      const saved = await invoke<BridgeSettings>("save_bridge_settings", {
        input: nextSettings,
      });
      setBridgeSettings(saved);
      setBridgeSettingsSnapshot(saved);

      let restartError: string | null = null;
      if (shouldRestart) {
        try {
          const restarted = await invoke<BridgeStatus>("restart_bridge");
          setBridgeStatus(restarted);
        } catch (error) {
          restartError = String(error);
        }
      }

      let refreshError: string | null = null;
      try {
        await Promise.all([
          refreshBridgeStatus(),
          refreshBridgeSessions(),
          refreshBridgeBindings(),
          refreshBridgeApprovals(),
          refreshBridgeLogTail(),
          refreshBridgeSecretsMask(),
        ]);
      } catch (error) {
        refreshError = String(error);
      }

      if (restartError || refreshError) {
        const details = [
          restartError ? `重启 Bridge 失败：${restartError}` : null,
          refreshError ? `刷新 Bridge 状态失败：${refreshError}` : null,
        ]
          .filter(Boolean)
          .join("；");
        setActionError(`机器人开关已保存。${details}`);
      }
    } catch (error) {
      setBridgeSettings(previousSettings);
      setActionError(`切换机器人开关失败：${String(error)}`);
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleDeleteBridgeConnector(connectorId: string) {
    setBridgeBusy(true);
    setActionError(null);
    const deleteFailureMessage = "删除机器人失败，请稍后重试或查看日志。";
    const shouldRestart =
      bridgeStatus.state === "running" ||
      bridgeStatus.state === "starting" ||
      bridgeStatus.state === "degraded";

    try {
      const saved = await invoke<BridgeSettings>("delete_bridge_connector", {
        connectorId,
      });
      setBridgeSettings(saved);
      setBridgeSettingsSnapshot(saved);

      let restartError: string | null = null;
      if (shouldRestart) {
        try {
          const restarted = await invoke<BridgeStatus>("restart_bridge");
          setBridgeStatus(restarted);
        } catch (error) {
          restartError = String(error);
        }
      }

      let refreshError: string | null = null;
      try {
        await Promise.all([
          refreshBridgeStatus(),
          refreshBridgeSessions(),
          refreshBridgeBindings(),
          refreshBridgeApprovals(),
          refreshBridgeLogTail(),
          refreshBridgeSecretsMask(),
        ]);
      } catch (error) {
        refreshError = String(error);
      }

      if (restartError || refreshError) {
        setActionError("机器人已删除，但刷新运行状态失败，请查看日志后手动重启外部 IM 通道。");
      }
      return saved;
    } catch (error) {
      setActionError(deleteFailureMessage);
      throw new Error(deleteFailureMessage);
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleRunBridgePrimaryAction(mode: BridgePrimaryActionMode) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      if (mode === "save_enable" || bridgeOnboardingDirty) {
        await saveBridgeOnboardingInternal();
      }
      if (bridgeSettingsDirty) {
        await saveBridgeSettingsInternal({ showRestartNotice: false });
      }

      if (mode === "start") {
        const data = await invoke<BridgeStatus>("start_bridge");
        setBridgeStatus(data);
      } else if (mode === "apply_restart") {
        const data = await invoke<BridgeStatus>("restart_bridge");
        setBridgeStatus(data);
      }

      await Promise.all([
        refreshBridgeStatus(),
        refreshBridgeSessions(),
        refreshBridgeBindings(),
        refreshBridgeApprovals(),
        refreshBridgeLogTail(),
        refreshBridgeSecretsMask(),
      ]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleStartBridge() {
    setBridgeBusy(true);
    setActionError(null);
    try {
      const data = await invoke<BridgeStatus>("start_bridge");
      setBridgeStatus(data);
      await Promise.all([
        refreshBridgeSessions(),
        refreshBridgeBindings(),
        refreshBridgeApprovals(),
        refreshBridgeLogTail(),
        refreshBridgeSecretsMask(),
      ]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleStopBridge() {
    setBridgeBusy(true);
    setActionError(null);
    try {
      const data = await invoke<BridgeStatus>("stop_bridge");
      setBridgeStatus(data);
      setBridgeSessions([]);
      setBridgeBindings([]);
      setBridgeApprovals([]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleRestartBridge() {
    setBridgeBusy(true);
    setActionError(null);
    try {
      const data = await invoke<BridgeStatus>("restart_bridge");
      setBridgeStatus(data);
      await Promise.all([
        refreshBridgeSessions(),
        refreshBridgeBindings(),
        refreshBridgeApprovals(),
        refreshBridgeLogTail(),
        refreshBridgeSecretsMask(),
      ]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleClearBridgeBinding(bindingId: string) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      await invoke("clear_bridge_binding", { bindingId });
      await Promise.all([refreshBridgeBindings(), refreshBridgeStatus()]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleResetBridgeBindingSession(bindingId: string) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      await invoke("reset_bridge_binding_session", { bindingId });
      await Promise.all([
        refreshBridgeBindings(),
        refreshBridgeSessions(),
        refreshBridgeStatus(),
      ]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleResetBridgeBindingToDefaultWorkDir(bindingId: string) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      await invoke("reset_bridge_binding_to_default_work_dir", { bindingId });
      await Promise.all([
        refreshBridgeBindings(),
        refreshBridgeSessions(),
        refreshBridgeStatus(),
        refreshBridgeLogTail(),
      ]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleImportBridgeSession(input: BridgeSessionImportInput) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      await invoke<BridgeSessionRecord>("import_bridge_session", { input });
      await Promise.all([refreshBridgeSessions(), refreshBridgeLogTail()]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
    }
  }

  async function handleResolveBridgeApproval(
    approvalId: string,
    status: BridgeApprovalResolveInput["status"],
  ) {
    setBridgeBusy(true);
    setActionError(null);
    try {
      await invoke("resolve_bridge_approval", {
        input: {
          approvalId,
          status,
        } satisfies BridgeApprovalResolveInput,
      });
      await Promise.all([
        refreshBridgeApprovals(),
        refreshBridgeStatus(),
        refreshBridgeLogTail(),
      ]);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setBridgeBusy(false);
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

  async function handleSaveContextMenuLabels(input: ContextMenuLabelsInput) {
    setContextMenuBusy(true);
    setActionError(null);
    try {
      const data = await invoke<ContextMenuStatus>("save_context_menu_labels", { input });
      setContextMenuStatus(data);
      await refreshOnboarding();
    } catch (error) {
      setActionError(String(error));
      throw error;
    } finally {
      setContextMenuBusy(false);
    }
  }

  async function handleCompleteOnboarding() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("complete_onboarding");
      const [nextStatus, nextOnboarding] = await refreshCoreState();
      if (isWorkspaceReady(nextStatus) && isOnboardingDismissed(nextOnboarding)) {
        navigateToWorkspaceAfterOnboarding();
      } else {
        parkOnControlCenterOverviewAwaitingWorkspace();
      }
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
      const [nextStatus, nextOnboarding] = await refreshCoreState();
      if (isWorkspaceReady(nextStatus) && isOnboardingDismissed(nextOnboarding)) {
        navigateToWorkspaceAfterOnboarding();
      } else {
        parkOnControlCenterOverviewAwaitingWorkspace();
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  function closeControlCenterModal() {
    setControlCenterModalOpen(false);
    handleCloseInstallCommands();
    resetControlCenterNavigation();
  }

  async function handleSelectSkill(skillId: string) {
    setSelectedSkillId(skillId);
    setSelectedDiscoveryId(null);
    setSelectedDiscoveryDetail(null);
    try {
      await refreshSelectedSkillDetail(skillId);
    } catch (error) {
      setActionError(String(error));
    }
  }

  function handleClearSkillSelection() {
    setSelectedSkillId(null);
    setSelectedSkillDetail(null);
    setSelectedDiscoveryId(null);
    setSelectedDiscoveryDetail(null);
    setActionError(null);
  }

  function openSkillCenter() {
    setActionError(null);
    handleCloseInstallCommands();
    setSelectedSkillId(null);
    setSelectedSkillDetail(null);
    setSelectedDiscoveryId(null);
    setSelectedDiscoveryDetail(null);
    setActiveControlSection("skill_center");
    setControlCenterTask(null);
    if (screen === "workspace") {
      setControlCenterModalOpen(true);
      return;
    }
    if (screen !== "control_center") {
      window.location.hash = "/control-center";
      setRouteHash(window.location.hash);
    }
    void refreshSkillCenterState();
  }

  async function handleInstallSkillFromGit() {
    setActionError(null);
    setControlCenterTask("skill_git_import");
  }

  async function handleConfirmInstallSkillFromGit() {
    const repoUrl = skillCenterGitRepoUrl.trim();
    const gitRef = skillCenterGitRef.trim();
    if (!repoUrl) {
      setActionError("请输入 Skill Git 仓库地址。");
      return;
    }
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      const installed = await installSkillFromGit(repoUrl, gitRef || undefined);
      await refreshSkillCenterState(installed.id);
      setControlCenterTask(null);
      setSkillCenterGitRepoUrl("");
      setSkillCenterGitRef("");
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleImportSkillFromPath() {
    setActionError(null);
    setControlCenterTask("skill_import");
  }

  async function handleConfirmImportSkillFromPath(mode: "directory" | "zip") {
    setControlCenterTask(null);
    setActionError(null);
    try {
      const selected = await open({
        title: mode === "directory" ? "选择本地 Skill 目录" : "选择 Skill ZIP",
        multiple: false,
        directory: mode === "directory",
        filters: mode === "zip" ? [{ name: "ZIP files", extensions: ["zip"] }] : undefined,
      });
      if (typeof selected !== "string") {
        return;
      }
      setSkillCenterBusy(true);
      try {
        const installed = await importSkillFromPath(selected);
        await refreshSkillCenterState(installed.id);
      } catch (error) {
        setActionError(String(error));
      } finally {
        setSkillCenterBusy(false);
      }
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleOpenControlTask(
    task: ControlCenterTaskId,
    payload: ControlCenterTaskPayload | null = null,
  ) {
    switch (task) {
      case "skill_git_import":
        await handleInstallSkillFromGit();
        return;
      case "skill_import":
        await handleImportSkillFromPath();
        return;
      case "bridge_connector_secrets":
      case "bridge_runtime":
        if (!payload?.connectorId) {
          setActionError("缺少 connector 上下文，无法打开任务面。");
          return;
        }
        setActionError(null);
        setControlCenterTask(task, payload);
        return;
      default:
        return;
    }
  }

  function handleCloseControlTask() {
    return closeActiveControlTask();
  }

  async function handleSetSkillTrust(skillId: string, trusted: boolean) {
    if (!trusted) {
      const confirmed = window.confirm(
        "取消信任会移除这个 Skill 当前所有受管投影，确定继续吗？",
      );
      if (!confirmed) {
        return;
      }
    }
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      await setSkillTrust(skillId, trusted);
      await refreshSkillCenterState(skillId);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function ensureSkillTrusted(skillId: string) {
    const target =
      installedSkills.find((skill) => skill.id === skillId) ?? selectedSkillDetail?.skill;
    if (target?.trusted) {
      return;
    }
    const confirmed = window.confirm(
      "首次应用前需要先信任这个 Skill。确认后将执行“信任并应用”。",
    );
    if (!confirmed) {
      throw new Error("已取消信任并应用");
    }
    await setSkillTrust(skillId, true);
  }

  async function handleApplySkill(skillId: string, scope: SkillApplyScope) {
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      await ensureSkillTrusted(skillId);
      await applySkill(skillId, scope);
      await refreshSkillCenterState(skillId);
    } catch (error) {
      const message = String(error);
      if (message !== "Error: 已取消信任并应用" && message !== "已取消信任并应用") {
        setActionError(message);
      }
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleRemoveSkill(skillId: string, scope: SkillApplyScope) {
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      await removeSkill(skillId, scope);
      await refreshSkillCenterState(skillId);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleSetWorkspaceSkillPin(skillId: string, pinned: boolean) {
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      const profile = await setWorkspaceSkillPin(skillId, pinned);
      setWorkspaceSkillProfile(profile);
      setWorkspaceRecentSkillIds(profile.recentSkillIds ?? []);
      await refreshWorkspaceSkillRecommendationsState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleUpdateSkill(skillId: string) {
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      const updated = await updateSkill(skillId);
      await refreshSkillCenterState(updated.id);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleUninstallSkill(skillId: string) {
    const target =
      installedSkills.find((skill) => skill.id === skillId) ?? selectedSkillDetail?.skill;
    const label = target?.name || "这个 Skill";
    const globalProjectionCount = globalSkillProjections.filter(
      (projection) => projection.skillId === skillId,
    ).length;
    const sessionProjectionCount =
      activeSessionSkillState.projections.filter(
        (projection) => projection.skillId === skillId,
      ).length || (activeSessionSkillState.appliedSkillIds.includes(skillId) ? 1 : 0);
    const confirmed = window.confirm(
      buildSkillUninstallConfirmMessage(label, globalProjectionCount + sessionProjectionCount),
    );
    if (!confirmed) {
      return;
    }

    setActionError(null);
    setSkillCenterBusy(true);
    try {
      await uninstallSkill(skillId);
      await refreshSkillCenterState(selectedSkillId === skillId ? null : selectedSkillId);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleSelectWorkspaceSkillTarget(targetId: string) {
    setSelectedWorkspaceSkillTargetId(targetId);
    try {
      await refreshWorkspaceSkillInventoryState(targetId);
    } catch (error) {
      setActionError(String(error));
    }
  }

  function handleSelectWorkspaceSkillContainer(containerKind: SkillDiscoveryContainerKind) {
    setSelectedWorkspaceSkillContainerKind(containerKind);
  }

  async function handleAddInstalledSkillToWorkspaceTarget(
    skillId: string,
    targetId?: string | null,
    containerKind?: SkillDiscoveryContainerKind,
  ) {
    const nextTargetId = targetId ?? selectedWorkspaceSkillTargetId;
    const nextContainerKind = containerKind ?? selectedWorkspaceSkillContainerKind;
    if (!nextTargetId) {
      setActionError("缺少工作区目标，暂时无法导入 Skill。");
      return;
    }

    setActionError(null);
    setSkillCenterBusy(true);
    try {
      await ensureSkillTrusted(skillId);
      await addInstalledSkillToWorkspaceTarget(nextTargetId, nextContainerKind, skillId);
      await refreshWorkspaceSkillInventoryState(nextTargetId);
      await refreshSkillDiscoveryState(selectedDiscoveryId);
      await refreshSkillCenterState(selectedSkillId);
    } catch (error) {
      const message = String(error);
      if (message !== "Error: 已取消信任并应用" && message !== "已取消信任并应用") {
        setActionError(message);
      }
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleRemoveWorkspaceTargetSkill(
    skillPathOrKey: string,
    targetId?: string | null,
    containerKind?: SkillDiscoveryContainerKind,
  ) {
    const nextTargetId = targetId ?? selectedWorkspaceSkillTargetId;
    const nextContainerKind = containerKind ?? selectedWorkspaceSkillContainerKind;
    if (!nextTargetId) {
      setActionError("缺少工作区目标，暂时无法删除 Skill。");
      return;
    }

    setActionError(null);
    setSkillCenterBusy(true);
    try {
      await removeWorkspaceTargetSkill(nextTargetId, nextContainerKind, skillPathOrKey);
      await refreshWorkspaceSkillInventoryState(nextTargetId);
      await refreshSkillDiscoveryState(selectedDiscoveryId);
      await refreshSkillCenterState(selectedSkillId);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleRecoverWorkspaceSkill(skillId: string) {
    setSkillCenterSection("manage");
    await handleApplySkill(skillId, "session_kimi");
  }

  async function handleOpenSkillFromInsights(skillId: string) {
    setSkillCenterSection("manage");
    await handleSelectSkill(skillId);
  }

  async function handleSelectDiscoveredSkill(discoveryId: string) {
    setSelectedDiscoveryId(discoveryId);
    setSelectedSkillId(null);
    setSelectedSkillDetail(null);
    try {
      await refreshSelectedDiscoveryDetail(discoveryId);
    } catch (error) {
      setActionError(String(error));
    }
  }

  async function handleScanDiscoveredSkills() {
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      await refreshSkillDiscoveryState(selectedDiscoveryId);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  async function handleImportDiscoveredSkill(discoveryId: string) {
    setActionError(null);
    setSkillCenterBusy(true);
    try {
      const installed = await importDiscoveredSkill(discoveryId);
      await refreshSkillCenterState(installed.id);
      await refreshSkillDiscoveryState(discoveryId);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSkillCenterBusy(false);
    }
  }

  function openControlCenter() {
    if (screen === "workspace") {
      resetControlCenterNavigation();
      setControlCenterModalOpen(true);
      return;
    }
    window.location.hash = "/control-center";
    setRouteHash(window.location.hash);
  }

  function handleSkillCenterSectionChange(section: SkillCenterSectionId) {
    setSkillCenterSection(section);
    if (section === "workspace_insights") {
      void refreshWorkspaceSkillManagementState(selectedWorkspaceSkillTargetId);
      return;
    }
    void refreshSkillDiscoveryState(selectedDiscoveryId);
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

  async function handleStartWindowDrag() {
    if (!tauriRuntime) return;
    try {
      await getCurrentWindow().startDragging();
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

  function handleSelectWorkspaceView(view: WorkspaceViewKind) {
    setActiveWorkspaceView(view);
    const pane = workspaceGridPanes.find((item) => item.kind === view);
    if (!pane) {
      return;
    }
    setWorkspaceGridActivePane(pane.id);
    if (workspaceGridPreset === "single") {
      moveWorkspaceGridPane(pane.id, "main");
    }
  }

  async function handleTestKimiCodeAccessConfig() {
    setKimiCodeAccessTesting(true);
    setActionError(null);
    try {
      const result = await invoke<KimiCodeAccessConfigTestResult>(
        "test_kimi_code_access_config",
        {
          input: {
            providerBaseUrl: kimiCodeAccessDraft.providerBaseUrl,
            providerApiKey: kimiCodeAccessDraft.providerApiKey?.trim() || undefined,
            searchBaseUrl: kimiCodeAccessDraft.searchBaseUrl,
            searchApiKey:
              kimiCodeAccessDraft.searchApiKeyMode === "custom"
                ? kimiCodeAccessDraft.searchApiKey?.trim() || undefined
                : undefined,
            fetchBaseUrl: kimiCodeAccessDraft.fetchBaseUrl,
            fetchApiKey:
              kimiCodeAccessDraft.fetchApiKeyMode === "custom"
                ? kimiCodeAccessDraft.fetchApiKey?.trim() || undefined
                : undefined,
          },
        },
      );
      setKimiCodeAccessTestResult(result);
      if (
        result.provider.state === "verified" &&
        result.models.length > 0 &&
        !result.models.some((model) => model.id === kimiCodeAccessDraft.defaultModel)
      ) {
        setKimiCodeAccessDraft((current) => ({
          ...current,
          defaultModel:
            result.models.find((model) => model.id === "kimi-code/k3")?.id ??
            result.models[0]?.id,
        }));
      }
    } catch (error) {
      setActionError(String(error));
    } finally {
      setKimiCodeAccessTesting(false);
    }
  }

  function handleToggleWorkspaceView() {
    handleSelectWorkspaceView(activeWorkspaceView === "code" ? "chat" : "code");
  }

  function handleToggleWorkspaceSplit() {
    const nextPreset = workspaceGridPreset === "single" ? "1x2" : "single";
    setWorkspaceGridPreset(nextPreset);
    setWorkspaceLayoutMode((current) =>
      current === "single" ? "split" : "single",
    );
  }

  function handleSwapWorkspaceSplitOrder() {
    const codePane = workspaceGridPanes.find((pane) => pane.kind === "code");
    const chatPane = workspaceGridPanes.find((pane) => pane.kind === "chat");
    if (codePane && chatPane) {
      setWorkspaceGridPreset("1x2");
      if (workspaceSplitOrder === "code_left") {
        moveWorkspaceGridPane(chatPane.id, "left");
        moveWorkspaceGridPane(codePane.id, "right");
      } else {
        moveWorkspaceGridPane(codePane.id, "left");
        moveWorkspaceGridPane(chatPane.id, "right");
      }
    }
    setWorkspaceSplitOrder((current) =>
      current === "code_left" ? "chat_left" : "code_left",
    );
  }

  function handleWorkspaceSplitRatioChange(nextRatio: number) {
    setWorkspaceSplitRatio(clampWorkspaceSplitRatio(nextRatio));
  }

  function handleWorkspaceSplitDragStateChange(isDragging: boolean) {
    setIsWorkspaceSplitDragging(isDragging);
  }

  const { pushThemeToWorkspace } = useWorkspaceThemeBridge();

  useEffect(() => {
    const timer = startWorkspacePane(
      remoteUrl ? workspaceFrameKey : null,
      workspaceFrameLoadIdentityRef.current,
      setWorkspaceEmbedState,
      (identity) => {
        workspaceFrameLoadIdentityRef.current = identity;
      },
    );

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [remoteUrl, workspaceFrameKey]);

  useEffect(() => {
    const timer = startWorkspacePane(
      chatRemoteUrl,
      chatRemoteUrlRef.current,
      setChatEmbedState,
      (url) => {
        chatRemoteUrlRef.current = url;
      },
    );

    return () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [chatRemoteUrl]);


  const stepCompletion = useMemo<StepCompletion>(
    () => ({
      install_kimi: onboarding?.kimiInstalled ?? false,
      context_menu: onboarding
        ? !onboarding.contextMenuSupported || onboarding.contextMenuEnabled
        : false,
      login_kimi: onboarding?.kimiCodeAuthState === "logged_in",
      work_dir: onboarding?.workDirConfigured ?? false,
      api_config: onboarding?.apiConfigAck ?? false,
    }),
    [onboarding],
  );

  const kimiCodeAccessDirty = useMemo(
    () =>
      JSON.stringify(kimiCodeAccessDraft) !== JSON.stringify(kimiCodeAccessSnapshot),
    [kimiCodeAccessDraft, kimiCodeAccessSnapshot],
  );
  const bridgeRecentErrors = useMemo(() => {
    const items: string[] = [];
    const seen = new Set<string>();
    const push = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed) || items.length >= 5) {
        return;
      }
      seen.add(trimmed);
      items.push(trimmed);
    };

    push(formatBridgeErrorEntry(bridgeStatus.lastErrorCode, bridgeStatus.lastError));
    for (const channel of bridgeStatus.connectors) {
      push(
        formatBridgeErrorEntry(
          channel.lastErrorCode,
          channel.lastError,
          `[${channel.platform}]`,
        ),
      );
    }
    for (const line of [...bridgeLogTail].reverse()) {
      if (!/\b(ERROR|WARN|FATAL)\b/i.test(line)) {
        continue;
      }
      push(line);
      if (items.length >= 5) {
        break;
      }
    }

    return items;
  }, [
    bridgeLogTail,
    bridgeStatus.connectors,
    bridgeStatus.lastError,
    bridgeStatus.lastErrorCode,
  ]);
  const sessionSkillCount = activeSessionSkillState.appliedSkillIds.length;

  const uiBackendState =
    status?.state ?? (useBootHintWorkspace ? bootHint?.backendState : undefined);
  const canOpenWorkspace =
    (status?.state === "running" &&
      typeof status.activePort === "number" &&
      !onboarding?.shouldShowOnboarding) ||
    useBootHintWorkspace;

  const statusText = uiBackendState ?? "starting";
  const shellScreenLabel =
    screen === "workspace"
      ? "Workspace"
      : screen === "control_center"
        ? "Control Center"
        : "Loading";
  const hotkeyOwnerLabel = status?.isHotkeyOwner
    ? "This instance owns global hotkey."
    : "Global hotkey is owned by another running instance.";
  const showLoadingView = screen === "loading" && !(shellBootPending && !status);

  function handleWorkspaceFrameLoad() {
    setWorkspaceEmbedState("ready");
    pushThemeToWorkspace();
    dispatchPendingSessionBridge("workspace_frame_load");
    prefillDispatchRef.current?.("workspace_frame_load");
  }

  function handleWorkspaceFrameError() {
    setWorkspaceEmbedState("blocked");
  }

  function handleChatFrameLoad() {
    setChatEmbedState("ready");
  }

  function handleChatFrameError() {
    setChatEmbedState("blocked");
  }

  return {
    platformCapabilities: platform.capabilities,
    platformCapabilitiesStatus: platform.status,
    platformCapabilitiesError: platform.error,
    status,
    diagnostics,
    kimiDoctorResult,
    onboarding,
    isLoading,
    actionBusy,
    diagnosticsBusy,
    kimiDoctorBusy,
    contextMenuBusy,
    workspaceImportBusy,
    actionError,
    workspaceImportTargets,
    workspaceImportRequest,
    workspaceImportResult,
    shutdownProgress,
    shutdownElapsedMs,
    contextMenuStatus,
    bridgeSettings,
    bridgeStatus,
    bridgeSessions,
    bridgeBindings,
    bridgeApprovals,
    bridgeLogTail,
    bridgeRecentErrors,
    bridgeSecretsMask,
    feishuConnectorOnboarding,
    feishuConnectorOnboardingBusy,
    weixinConnectorOnboarding,
    weixinConnectorOnboardingBusy,
    installedSkills,
    skillCenterBusy,
    skillCenterSection,
    setSkillCenterSection: handleSkillCenterSectionChange,
    skillCenterGitRepoUrl,
    setSkillCenterGitRepoUrl,
    skillCenterGitRef,
    setSkillCenterGitRef,
    skillCenterSearch,
    setSkillCenterSearch,
    skillCenterFilter,
    setSkillCenterFilter,
    selectedSkillId,
    selectedSkillDetail,
    globalSkillProjections,
    activeSessionSkillState,
    workspaceSkillProfile,
    workspaceRecentSkillIds,
    workspaceSkillRecommendations,
    workspaceSkillRestoreResults,
    skillDiscoverySnapshot,
    skillDiscoveryWorkspaces,
    selectedDiscoveryId,
    selectedDiscoveryDetail,
    workspaceSkillTargets,
    selectedWorkspaceSkillTargetId,
    workspaceSkillInventory,
    selectedWorkspaceSkillContainerKind,
    sessionSkillCount,
    bridgeOnboardingDraft,
    bridgeOnboardingDirty,
    bridgeOnboardingValidation,
    bridgeSettingsDirty,
    bridgePersistedConnectorIds: bridgeSettingsSnapshot.connectors.map(
      (connector) => connector.id,
    ),
    bridgeBusy,
    mainWindowCloseBehavior,
    mainWindowCloseDecisionRequest,
    kimiPathInput,
    setKimiPathInput,
    workDirInput,
    setWorkDirInput,
    isWindowMaximized,
    workspaceEmbedState,
    themeMode,
    workspaceSplitOrder,
    workspaceSplitRatio,
    isWorkspaceSplitDragging,
    activeControlSection,
    setActiveControlSection,
    activeRuntimePanel,
    setActiveRuntimePanel,
    controlCenterModalOpen,
    activeControlTask,
    activeControlTaskPayload,
    tauriRuntime,
    screen,
    uiBackendState,
    showLoadingView,
    statusText,
    shellScreenLabel,
    hotkeyOwnerLabel,
    canOpenWorkspace,
    remoteUrl,
    workspaceDisplayUrl,
    workspaceFrameKey,
    workspaceBridgeNonce,
    workspaceIframeRef,
    stepCompletion,
    kimiCodeAccessView,
    kimiCodeAccessDraft,
    kimiCodeAccessBusy,
    kimiCodeAccessDirty,
    kimiCodeAccessTesting,
    kimiCodeAccessTestResult,
    installProbe,
    installProbeBusy,
    kimiCodeUpdateStatus,
    kimiCodeUpdateInfo,
    kimiCodeUpdateError,
    installSource,
    installSettings,
    installSettingsBusy,
    powershellPreflight,
    installBusy,
    installMessage,
    installSessionSnapshot,
    installMirrorHealthReport,
    installMirrorHealthBusy,
    appUpdateSupported,
    appUpdateStatus,
    appUpdateInfo,
    appUpdateProgress,
    appUpdateError,
    installCommandsOpen,
    installCommandsBusy,
    installCommandCatalog,
    refreshCoreState: async () => {
      await refreshCoreState();
    },
    refreshDiagnostics,
    handleRunKimiDoctor,
    refreshContextMenuStatus,
    refreshBridgeSettings,
    refreshBridgeStatus,
    refreshBridgeSessions,
    refreshBridgeBindings,
    refreshBridgeApprovals,
    refreshBridgeLogTail,
    refreshBridgeSecretsMask,
    refreshActiveWorkspaceImportRequest,
    refreshWorkspaceImportTargets,
    refreshSkillCenterState,
    refreshSkillDiscoveryState,
    refreshWorkspaceSkillManagementState,
    refreshInstallProbe,
    refreshInstallSettings,
    refreshWorkspaceWebSettings,
    refreshInstallMirrorHealth,
    refreshPowerShellPreflight,
    refreshOnboarding: async () => {
      await refreshOnboarding();
    },
    handleRetry,
    handleRuntimeOnlyRetry,
    handleRecoverMainWindowBoot,
    handleOpenLogs,
    handleQuitAppGracefully,
    handleOpenExternalUrl,
    handleOpenFolder,
    handleOpenPaneFolder,
    handlePaneSessionObserved,
    handleOpenKimiConfigDir,
    handleOpenKimiCodeAccessPanel,
    handleOpenControlTask,
    handleCloseControlTask,
    handleKimiCodeAccessDraftChange,
    handleSaveKimiCodeAccessConfig,
    handleTestKimiCodeAccessConfig,
    handlePickKimiPath,
    handleSavePathAndRetry,
    handlePickWorkDir,
    handlePickBridgeDefaultWorkDir,
    handlePickBridgeConnectorDefaultWorkDir,
    handleSelectWorkspaceImportTarget,
    handleImportToBrowsedWorkspace,
    handleCancelWorkspaceImportPicker,
    handleDismissWorkspaceImportResult,
    handleSaveWorkDirAndRestart,
    handleClearWorkDir,
    handleBridgeSettingsChange,
    handleBridgeOnboardingDraftChange,
    handleToggleBridgeConnectorEnabled,
    handleDeleteBridgeConnector,
    handleSaveBridgeOnboarding,
    handleSaveBridgeSettings,
    handlePersistBridgeSettings,
    handleSaveBridgeConnectorSecrets,
    handleStartFeishuConnectorOnboarding,
    handleRefreshFeishuConnectorOnboardingStatus,
    handleCancelFeishuConnectorOnboarding,
    handleStartWeixinConnectorOnboarding,
    handleRefreshWeixinConnectorOnboardingStatus,
    handleCancelWeixinConnectorOnboarding,
    handleRunBridgePrimaryAction,
    handleStartBridge,
    handleStopBridge,
    handleRestartBridge,
    handleImportBridgeSession,
    handleClearBridgeBinding,
    handleResetBridgeBindingSession,
    handleResetBridgeBindingToDefaultWorkDir,
    handleResolveBridgeApproval,
    handleInstallSourceChange,
    handleSaveInstallSettings,
    handleInstallDependencies,
    handleInstallKimi,
    handleUpgradeKimi,
    handleInstallNodejs,
    handleStartInstallTask,
    handleCancelInstallTask,
    checkAppUpdate,
    installAppUpdate,
    handleOpenInstallCommands,
    handleEnableContextMenu,
    handleDisableContextMenu,
    handleSaveContextMenuLabels,
    handleSelectSkill,
    handleClearSkillSelection,
    handleOpenSkillFromInsights,
    handleSelectDiscoveredSkill,
    handleScanDiscoveredSkills,
    handleImportDiscoveredSkill,
    handleSelectWorkspaceSkillTarget,
    handleSelectWorkspaceSkillContainer,
    handleAddInstalledSkillToWorkspaceTarget,
    handleRemoveWorkspaceTargetSkill,
    handleConfirmInstallSkillFromGit,
    handleConfirmImportSkillFromPath,
    handleSetSkillTrust,
    handleApplySkill,
    handleRemoveSkill,
    handleSetWorkspaceSkillPin,
    handleUpdateSkill,
    handleUninstallSkill,
    handleRecoverWorkspaceSkill,
    handleCompleteOnboarding,
    handleSkipOnboarding,
    openControlCenter,
    closeControlCenterModal,
    requestCloseControlCenter,
    dismissControlCenter,
    openSkillCenter,
    backToStatus,
    handleStartWindowDrag,
    handleMinimizeWindow,
    handleToggleMaximizeWindow,
    handleCloseWindow,
    handleSaveMainWindowCloseBehavior,
    handleSubmitMainWindowCloseDecision,
    handleTitlebarDoubleClick,
    handleToggleThemeMode,
    activeWorkspaceView,
    workspaceLayoutMode,
    isWorkspaceSplit,
    chatRemoteUrl,
    chatIframeRef,
    chatEmbedState,
    handleSelectWorkspaceView,
    handleToggleWorkspaceView,
    handleToggleWorkspaceSplit,
    handleSwapWorkspaceSplitOrder,
    handleWorkspaceSplitRatioChange,
    handleWorkspaceSplitDragStateChange,
    handleWorkspaceFrameLoad,
    handleWorkspaceFrameError,
    handleChatFrameLoad,
    handleChatFrameError,
  };
}
