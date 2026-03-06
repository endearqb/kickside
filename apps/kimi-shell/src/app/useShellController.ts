import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  EXTERNAL_LINK_BRIDGE_SOURCE,
  getInitialThemeMode,
  LEGACY_THEME_MODE_STORAGE_KEY,
  PREFILL_BRIDGE_SOURCE,
  PREFILL_SYNC_SOURCE,
  SESSION_BRIDGE_SOURCE,
  SESSION_SYNC_SOURCE,
  THEME_STORAGE_KEY,
} from "@/app/theme";
import type {
  ActionableOnboardingStep,
  AppStatus,
  ControlCenterChrome,
  ContextMenuStatus,
  ControlSectionId,
  DiagnosticsInfo,
  FrontendReadyAck,
  InstallProbeStatus,
  KimiCliConfigCenterInput,
  KimiCliConfigCenterView,
  LoginProbeResult,
  OnboardingStatus,
  OpenRequestErrorPayload,
  PrefillBridgeAck,
  PrefillChatPayload,
  ShutdownProgressPayload,
  RuntimePanelId,
  Screen,
  ShellRoutePayload,
  Theme,
  WorkspaceSessionBridgePayload,
  WorkspaceEmbedState,
} from "@/app/types";
import { useWorkspaceThemeBridge } from "@/app/useWorkspaceThemeBridge";

const POLL_MS = 1000;
const SHELL_ROUTE_EVENT = "shell-route";
const PREFILL_CHAT_EVENT = "prefill-chat";
const SHUTDOWN_PROGRESS_EVENT = "shutdown-progress";
const OPEN_REQUEST_ERROR_EVENT = "open-request-error";
const WORKSPACE_SESSION_BOOTSTRAP_EVENT = "workspace-session-bootstrap";
const WORKSPACE_SESSION_BRIDGE_EVENT = "workspace-session-bridge";
const PREFILL_ACK_TIMEOUT_MS = 2600;
const PREFILL_RETRY_DELAY_MS = 1600;
const PREFILL_MAX_ATTEMPTS = 12;
const SESSION_NAVIGATE_TIMEOUT_MS = 6000;
let frontendReadyHandshakeSent = false;

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type InstallSource = "official" | "mirror";

function createEmptyConfigCenterInput(): KimiCliConfigCenterInput {
  return {
    providers: [],
    models: [],
    services: [],
    defaultProvider: undefined,
    model: undefined,
    defaultModel: undefined,
    defaultService: undefined,
    defaultEditor: undefined,
    defaultYolo: undefined,
    defaultYoloMode: undefined,
    defaultThinking: undefined,
    defaultThinkingMode: undefined,
    localModelDisableAutoPull: undefined,
    loopControl: {
      enabled: undefined,
      maxSteps: undefined,
      maxRetries: undefined,
      timeoutMs: undefined,
      extraFields: [],
    },
    mcpServers: [],
  };
}

function toConfigCenterInput(view: KimiCliConfigCenterView): KimiCliConfigCenterInput {
  return {
    providers: view.providers,
    models: view.models,
    services: view.services,
    defaultProvider: view.defaultProvider,
    model: view.model,
    defaultModel: view.defaultModel,
    defaultService: view.defaultService,
    defaultEditor: view.defaultEditor,
    defaultYolo: view.defaultYolo,
    defaultYoloMode: view.defaultYoloMode,
    defaultThinking: view.defaultThinking,
    defaultThinkingMode: view.defaultThinkingMode,
    localModelDisableAutoPull: view.localModelDisableAutoPull,
    loopControl: view.loopControl,
    mcpServers: view.mcpServers,
  };
}

function cloneConfigCenterInput(
  input: KimiCliConfigCenterInput,
): KimiCliConfigCenterInput {
  return JSON.parse(JSON.stringify(input)) as KimiCliConfigCenterInput;
}

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
  const [configCenterView, setConfigCenterView] =
    useState<KimiCliConfigCenterView | null>(null);
  const [configCenterDraft, setConfigCenterDraft] = useState<KimiCliConfigCenterInput>(
    () => createEmptyConfigCenterInput(),
  );
  const [configCenterSnapshot, setConfigCenterSnapshot] =
    useState<KimiCliConfigCenterInput>(() => createEmptyConfigCenterInput());
  const [configCenterOpen, setConfigCenterOpen] = useState(false);
  const [configCenterBusy, setConfigCenterBusy] = useState(false);
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
  const [controlCenterModalOpen, setControlCenterModalOpen] = useState(false);
  const [controlCenterChrome, setControlCenterChrome] =
    useState<ControlCenterChrome>("dashboard");
  const [routeHash, setRouteHash] = useState(() => window.location.hash);
  const [listenersReady, setListenersReady] = useState(false);
  const [pendingPrefill, setPendingPrefill] = useState<PrefillChatPayload | null>(
    null,
  );
  const [shutdownProgress, setShutdownProgress] =
    useState<ShutdownProgressPayload | null>(null);
  const [shutdownElapsedMs, setShutdownElapsedMs] = useState<number | null>(null);

  const tauriRuntime = useMemo(() => isTauri(), []);
  const loadingReportCycleRef = useRef<number | null>(null);
  const workspaceIframeRef = useRef<HTMLIFrameElement | null>(null);
  const pendingPrefillRef = useRef<PrefillChatPayload | null>(null);
  const prefillRetryTimerRef = useRef<number | null>(null);
  const prefillAckTimerRef = useRef<number | null>(null);
  const prefillDispatchRef = useRef<((source: string) => void) | null>(null);
  const prefillAttemptsRef = useRef<Record<string, number>>({});
  const handledPrefillIdsRef = useRef<Set<string>>(new Set());
  const inFlightPrefillRequestRef = useRef<string | null>(null);
  const prefillLastFailureReasonRef = useRef<string | null>(null);
  const pendingSessionBridgeRef =
    useRef<WorkspaceSessionBridgePayload | null>(null);
  const sessionRouteTemplateRef = useRef<string | null>(null);
  const sessionNavigateTimerRef = useRef<number | null>(null);
  const shutdownElapsedBaseRef = useRef<number>(0);
  const shutdownElapsedStartedAtRef = useRef<number>(0);
  const shutdownElapsedTimerRef = useRef<number | null>(null);
  const workspaceRemoteUrlRef = useRef<string | null>(null);

  const screen: Screen = useMemo(() => {
    const hashRoute = parseHashRoute(routeHash);
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

    if (status?.state === "running" && typeof status.activePort === "number") {
      return "workspace";
    }

    return "loading";
  }, [onboarding, routeHash, status]);

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

  function clearSessionNavigateTimer() {
    if (sessionNavigateTimerRef.current !== null) {
      window.clearTimeout(sessionNavigateTimerRef.current);
      sessionNavigateTimerRef.current = null;
    }
  }

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

  function resetControlCenterNavigation(nextChrome: ControlCenterChrome = "dashboard") {
    setActiveControlSection("overview");
    setActiveRuntimePanel("paths");
    setControlCenterChrome(nextChrome);
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
    [status?.state, workspaceEmbedState, workspaceOrigin],
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
      if (data.state !== "stopping") {
        setShutdownProgress(null);
        clearShutdownElapsedTimer(true);
      }
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
    let unlistenSessionBootstrap: (() => void) | undefined;
    let unlistenSessionBridge: (() => void) | undefined;

    const bindListeners = async () => {
      try {
        const currentWebviewWindow = getCurrentWebviewWindow();
        const [
          routeOff,
          prefillOff,
          shutdownOff,
          openRequestErrorOff,
          bootstrapOff,
          sessionBridgeOff,
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
              }
              if (payload.action === "navigate_session") {
                pendingSessionBridgeRef.current = payload;
                dispatchPendingSessionBridge("bridge_event");
              }
            },
          ),
        ]);

        if (disposed) {
          routeOff();
          prefillOff();
          shutdownOff();
          openRequestErrorOff();
          bootstrapOff();
          sessionBridgeOff();
          return;
        }

        unlistenRoute = routeOff;
        unlistenPrefill = prefillOff;
        unlistenShutdownProgress = shutdownOff;
        unlistenOpenRequestError = openRequestErrorOff;
        unlistenSessionBootstrap = bootstrapOff;
        unlistenSessionBridge = sessionBridgeOff;
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
      if (unlistenSessionBootstrap) {
        unlistenSessionBootstrap();
      }
      if (unlistenSessionBridge) {
        unlistenSessionBridge();
      }
    };
  }, [dispatchPendingSessionBridge, enqueuePrefillPayload, tauriRuntime]);

  useEffect(() => {
    if (!tauriRuntime || !listenersReady || frontendReadyHandshakeSent) {
      return;
    }

    frontendReadyHandshakeSent = true;
    void invoke<FrontendReadyAck>("notify_frontend_ready")
      .then((ack) => {
        if (ack.pendingPrefill) {
          enqueuePrefillPayload(ack.pendingPrefill, "ready_ack");
        }
        void refreshCoreState();
      })
      .catch(() => {
        // Best-effort startup handshake.
      });
  }, [enqueuePrefillPayload, listenersReady, tauriRuntime]);

  useEffect(() => {
    const handleWorkspaceBridgeMessage = (event: MessageEvent) => {
      if (!workspaceOrigin || event.origin !== workspaceOrigin) {
        return;
      }

      const payload = event.data as
        | (PrefillBridgeAck & {
            source?: string;
            action?: string;
            url?: string;
            routeTemplate?: string;
            sessionId?: string;
          })
        | null;
      if (!payload || typeof payload.source !== "string") {
        return;
      }

      if (payload.source === EXTERNAL_LINK_BRIDGE_SOURCE) {
        const externalUrl = payload.url?.trim();
        if (!externalUrl) {
          return;
        }
        if (tauriRuntime) {
          void invoke("open_external_url", { url: externalUrl }).catch((error) => {
            setActionError(String(error));
          });
        } else {
          try {
            window.open(externalUrl, "_blank", "noopener,noreferrer");
          } catch (error) {
            setActionError(String(error));
          }
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
  }, [tauriRuntime, workspaceOrigin]);

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
    if (status?.state === "running") {
      return;
    }
    pendingSessionBridgeRef.current = null;
    clearSessionNavigateTimer();
  }, [status?.state]);

  useEffect(
    () => () => {
      clearPrefillTimers();
      clearSessionNavigateTimer();
      clearShutdownElapsedTimer(true);
      prefillLastFailureReasonRef.current = null;
    },
    [],
  );

  async function loadKimiCliConfigCenter() {
    try {
      const data = await invoke<KimiCliConfigCenterView>("load_kimi_cli_config_center");
      setConfigCenterView(data);
      const nextInput = toConfigCenterInput(data);
      setConfigCenterDraft(nextInput);
      setConfigCenterSnapshot(cloneConfigCenterInput(nextInput));
      setActionError(null);
      return data;
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  async function refreshInstallProbe() {
    const data = await invoke<InstallProbeStatus>("get_install_probe_status");
    setInstallProbe(data);
    return data;
  }

  useEffect(() => {
    void refreshStatus();
    void refreshOnboarding();
    const timer = window.setInterval(() => {
      void refreshStatus();
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
    if (screen === "workspace") {
      return;
    }
    setControlCenterModalOpen(false);
    setConfigCenterOpen(false);
    resetControlCenterNavigation();
  }, [screen]);

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
      resetControlCenterNavigation("full");
      return;
    }

    if (hashRoute === "onboarding") {
      setActiveControlSection("onboarding");
      setControlCenterChrome("full");
      void refreshOnboarding();
      return;
    }

    if (hashRoute === "diagnostics") {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel("core");
      setControlCenterChrome("full");
      void refreshDiagnostics();
      return;
    }

    if (hashRoute === "logs_paths") {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel("paths");
      setControlCenterChrome("full");
      void Promise.all([refreshDiagnostics(), refreshContextMenuStatus()]);
      return;
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

  async function handleOpenConfigCenterModal() {
    setConfigCenterBusy(true);
    try {
      await loadKimiCliConfigCenter();
      setConfigCenterOpen(true);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setConfigCenterBusy(false);
    }
  }

  function handleCloseConfigCenterModal() {
    setConfigCenterOpen(false);
  }

  function handleConfigCenterDraftChange(next: KimiCliConfigCenterInput) {
    setConfigCenterDraft(next);
  }

  function handleResetConfigCenterDraft() {
    setConfigCenterDraft(cloneConfigCenterInput(configCenterSnapshot));
  }

  async function handleSaveKimiCliConfigCenter() {
    setActionBusy(true);
    setConfigCenterBusy(true);
    setActionError(null);
    try {
      await invoke("save_kimi_cli_config_center", {
        input: configCenterDraft,
      });
      await loadKimiCliConfigCenter();
      await refreshOnboarding();
      setConfigCenterOpen(false);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
      setConfigCenterBusy(false);
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
      await refreshOnboarding();
      await refreshInstallProbe();
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
      await refreshOnboarding();
      await refreshInstallProbe();
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

  function closeControlCenterModal() {
    setControlCenterModalOpen(false);
    setConfigCenterOpen(false);
    resetControlCenterNavigation();
  }

  async function openOnboardingFromDashboard() {
    try {
      await refreshOnboarding();
    } finally {
      setActiveControlSection("onboarding");
      setControlCenterChrome("full");
    }
  }

  async function openRuntimePanelFromDashboard(panel: RuntimePanelId) {
    try {
      if (panel === "paths") {
        await Promise.all([refreshDiagnostics(), refreshContextMenuStatus()]);
      } else {
        await refreshDiagnostics();
      }
    } finally {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel(panel);
      setControlCenterChrome("full");
    }
  }

  function openControlCenter() {
    if (screen === "workspace") {
      setConfigCenterOpen(false);
      resetControlCenterNavigation("dashboard");
      setControlCenterModalOpen(true);
      return;
    }
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

  const { pushThemeToWorkspace } = useWorkspaceThemeBridge({
    screen,
    workspaceEmbedState,
    workspaceOrigin,
    themeMode,
    workspaceIframeRef,
    setThemeMode,
  });

  useEffect(() => {
    if (!remoteUrl) {
      workspaceRemoteUrlRef.current = null;
      setWorkspaceEmbedState("idle");
      return;
    }

    if (workspaceRemoteUrlRef.current === remoteUrl) {
      return;
    }
    workspaceRemoteUrlRef.current = remoteUrl;

    setWorkspaceEmbedState("loading");
    const timer = window.setTimeout(() => {
      setWorkspaceEmbedState((current) =>
        current === "ready" ? current : "blocked",
      );
    }, 8_000);

    return () => window.clearTimeout(timer);
  }, [remoteUrl]);

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

  const configCenterDirty = useMemo(
    () =>
      JSON.stringify(configCenterDraft) !== JSON.stringify(configCenterSnapshot),
    [configCenterDraft, configCenterSnapshot],
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
    dispatchPendingSessionBridge("workspace_frame_load");
    prefillDispatchRef.current?.("workspace_frame_load");
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
    shutdownProgress,
    shutdownElapsedMs,
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
    controlCenterModalOpen,
    controlCenterChrome,
    tauriRuntime,
    screen,
    statusText,
    shellScreenLabel,
    hotkeyOwnerLabel,
    canOpenWorkspace,
    remoteUrl,
    workspaceIframeRef,
    stepCompletion,
    configCenterView,
    configCenterDraft,
    configCenterOpen,
    configCenterBusy,
    configCenterDirty,
    installProbe,
    installSource,
    installBusy,
    installMessage,
    refreshCoreState,
    refreshDiagnostics,
    refreshContextMenuStatus,
    refreshInstallProbe,
    refreshOnboarding,
    handleRetry,
    handleRecoverMainWindowBoot,
    handleOpenLogs,
    handleQuitAppGracefully,
    handleOpenExternalUrl,
    handleOpenFolder,
    handleOpenKimiConfigDir,
    handleOpenConfigCenterModal,
    handleCloseConfigCenterModal,
    handleConfigCenterDraftChange,
    handleResetConfigCenterDraft,
    handleSaveKimiCliConfigCenter,
    handlePickKimiPath,
    handleSavePathAndRetry,
    handlePickWorkDir,
    handleSaveWorkDirAndRestart,
    handleClearWorkDir,
    handleInstallSourceChange,
    handleInstallDependencies,
    handleInstallKimi,
    handleEnableContextMenu,
    handleDisableContextMenu,
    handleProbeLogin,
    handleCompleteOnboarding,
    handleSkipOnboarding,
    openControlCenter,
    closeControlCenterModal,
    openOnboardingFromDashboard,
    openRuntimePanelFromDashboard,
    backToStatus,
    handleStartWindowDrag,
    handleMinimizeWindow,
    handleToggleMaximizeWindow,
    handleCloseWindow,
    handleTitlebarDoubleClick,
    handleToggleThemeMode,
    handleWorkspaceFrameLoad,
    handleWorkspaceFrameError,
  };
}
