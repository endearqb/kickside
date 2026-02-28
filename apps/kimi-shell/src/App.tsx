import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";

type BackendState =
  | "stopped"
  | "starting"
  | "running"
  | "crashed"
  | "stopping"
  | "missing_kimi";

type LoginProbeState = "logged_in" | "login_required" | "unknown";
type OnboardingStep = "install_kimi" | "context_menu" | "login_kimi" | "work_dir" | "api_config" | "done";
type ActionableOnboardingStep = Exclude<OnboardingStep, "done">;

interface AppStatus {
  instanceId: string;
  pid: number;
  startedAt: string;
  isHotkeyOwner: boolean;
  startCycleId: number;
  state: BackendState;
  activePort?: number;
  basePort?: number;
  loadingStartupMs?: number;
  backendReadyMs?: number;
  loadingSlaMet?: boolean;
  message?: string;
  detectedKimiPath?: string;
  configuredKimiPath?: string;
  configuredWorkDir?: string;
  effectiveWorkDir?: string;
  logsDir: string;
  hotkey: string;
}

interface DiagnosticsInfo {
  instanceId: string;
  pid: number;
  startedAt: string;
  isHotkeyOwner: boolean;
  startCycleId: number;
  state: BackendState;
  activePort?: number;
  basePort?: number;
  loadingStartupMs?: number;
  backendReadyMs?: number;
  loadingSlaMet?: boolean;
  configuredKimiPath?: string;
  detectedKimiPath?: string;
  configuredWorkDir?: string;
  effectiveWorkDir?: string;
  launchCommand?: string;
  cliContractOk?: boolean;
  cliContractError?: string;
  kimiVersion?: string;
  versionError?: string;
  lastError?: string;
  lastExitReason?: string;
  appLogPath: string;
  backendLogPath: string;
  appLogTail: string[];
  backendLogTail: string[];
  logTail: string[];
  logsDir: string;
}

interface ContextMenuStatus {
  supported: boolean;
  enabled: boolean;
  message?: string;
}

interface OnboardingStatus {
  currentVersion: number;
  completedVersion: number;
  shouldShowOnboarding: boolean;
  launchBlockedByOnboarding: boolean;
  startupOpenRequestApplied: boolean;
  recommendedStep: OnboardingStep;
  kimiInstalled: boolean;
  detectedKimiPath?: string;
  contextMenuSupported: boolean;
  contextMenuEnabled: boolean;
  contextMenuMessage?: string;
  loginState: LoginProbeState;
  loginMessage?: string;
  workDirConfigured: boolean;
  workDir?: string;
  apiConfigAck: boolean;
}

interface LoginProbeResult {
  state: LoginProbeState;
  message: string;
  kimiPath?: string;
  exitCode?: number;
}

type Screen = "loading" | "onboarding" | "diagnostics";

const POLL_MS = 1000;
const ONBOARDING_STEP_ORDER: ActionableOnboardingStep[] = [
  "install_kimi",
  "context_menu",
  "login_kimi",
  "work_dir",
  "api_config",
];

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const loadingReportCycleRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [contextMenuBusy, setContextMenuBusy] = useState(false);
  const [loginProbeBusy, setLoginProbeBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [contextMenuStatus, setContextMenuStatus] = useState<ContextMenuStatus | null>(null);
  const [loginProbeResult, setLoginProbeResult] = useState<LoginProbeResult | null>(null);
  const [kimiPathInput, setKimiPathInput] = useState("");
  const [workDirInput, setWorkDirInput] = useState("");

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

  const screen: Screen = useMemo(() => {
    const hashRoute = window.location.hash.replace(/^#\/?/, "");
    if (hashRoute === "diagnostics") return "diagnostics";
    if (hashRoute === "onboarding") return "onboarding";

    if (status?.state === "missing_kimi" || status?.state === "crashed") {
      return "onboarding";
    }
    if (onboarding?.shouldShowOnboarding) {
      return "onboarding";
    }

    return "loading";
  }, [status, onboarding]);

  useEffect(() => {
    if (screen === "diagnostics") {
      void refreshDiagnostics();
      void refreshContextMenuStatus();
    }
    if (screen === "onboarding") {
      void refreshOnboarding();
      void refreshContextMenuStatus();
    }
  }, [screen]);

  useEffect(() => {
    if (!status) return;
    if (status.state !== "starting") return;
    if (loadingReportCycleRef.current === status.startCycleId) return;

    loadingReportCycleRef.current = status.startCycleId;
    void invoke("report_loading_rendered", { startCycleId: status.startCycleId }).catch(() => {
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
      if (screen === "diagnostics") {
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
      if (screen === "diagnostics") {
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

  async function handleCompleteOnboarding() {
    setActionBusy(true);
    setActionError(null);
    try {
      await invoke("complete_onboarding");
      window.location.hash = "/loading";
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
      await refreshCoreState();
    } catch (error) {
      setActionError(String(error));
    } finally {
      setActionBusy(false);
    }
  }

  function openDiagnostics() {
    window.location.hash = "/diagnostics";
  }

  function openOnboarding() {
    window.location.hash = "/onboarding";
  }

  function backToStatus() {
    window.location.hash = "/loading";
  }

  const remoteUrl = status?.activePort ? `http://127.0.0.1:${status.activePort}` : null;
  const statusText = status?.state ?? "starting";
  const hotkeyOwnerLabel = status?.isHotkeyOwner
    ? "This instance owns global hotkey."
    : "Global hotkey is owned by another running instance.";

  const onboardingStep = useMemo<OnboardingStep>(() => {
    if (status?.state === "missing_kimi") return "install_kimi";
    if (!onboarding) return "install_kimi";
    return onboarding.recommendedStep === "done" ? "api_config" : onboarding.recommendedStep;
  }, [onboarding, status]);

  const stepCompletion = useMemo<Record<ActionableOnboardingStep, boolean>>(
    () => ({
      install_kimi: onboarding?.kimiInstalled ?? false,
      context_menu: onboarding ? !onboarding.contextMenuSupported || onboarding.contextMenuEnabled : false,
      login_kimi: onboarding?.loginState === "logged_in",
      work_dir: onboarding?.workDirConfigured ?? false,
      api_config: onboarding?.apiConfigAck ?? false,
    }),
    [onboarding],
  );

  return (
    <main className="shell-root">
      <section className="panel">
        <header className="panel-header">
          <div className="header-top">
            <span className="eyebrow">Kimi Desktop Shell</span>
            <div className="header-actions">
              {screen !== "onboarding" && (
                <button onClick={openOnboarding} className="ghost mini">
                  Onboarding
                </button>
              )}
              {screen !== "diagnostics" && (
                <button onClick={openDiagnostics} className="ghost mini">
                  Diagnostics
                </button>
              )}
              {screen === "diagnostics" && (
                <button onClick={backToStatus} className="ghost mini">
                  Back
                </button>
              )}
            </div>
          </div>
          <h1>
            {screen === "loading" && "Starting Kimi Web UI"}
            {screen === "onboarding" && "Setup Guide"}
            {screen === "diagnostics" && "Diagnostics"}
          </h1>
          <p>
            {screen === "loading" &&
              "The desktop shell is waiting for `kimi web` to become ready."}
            {screen === "onboarding" &&
              "Complete or skip onboarding steps for install, context menu, login, work directory, and provider API setup."}
            {screen === "diagnostics" &&
              "Inspect startup details, runtime state, and recent logs."}
          </p>
          {status && <p className="hint">{hotkeyOwnerLabel}</p>}
        </header>

        {screen === "loading" && (
          <>
            <div className="block">
              <div className="spinner" aria-hidden />
              <p className="status-line">State: {statusText}</p>
              {typeof status?.loadingStartupMs === "number" && (
                <p className="hint">
                  Shell to Loading: <strong>{status.loadingStartupMs} ms</strong>{" "}
                  ({status.loadingSlaMet ? "SLA met" : "SLA exceeded"})
                </p>
              )}
              {typeof status?.backendReadyMs === "number" && (
                <p className="hint">
                  Backend ready: <strong>{status.backendReadyMs} ms</strong>
                </p>
              )}
              {remoteUrl && (
                <p className="hint">
                  If auto-navigation is blocked, open{" "}
                  <a href={remoteUrl} target="_blank" rel="noreferrer">
                    {remoteUrl}
                  </a>
                  .
                </p>
              )}
              <div className="actions">
                <button onClick={handleRetry} disabled={actionBusy}>
                  Restart Backend
                </button>
                <button onClick={handleOpenLogs} className="ghost">
                  Open Logs Folder
                </button>
              </div>
            </div>
            <WorkDirBlock
              value={workDirInput}
              onChange={setWorkDirInput}
              onBrowse={handlePickWorkDir}
              onSaveAndRestart={handleSaveWorkDirAndRestart}
              onClear={handleClearWorkDir}
              actionBusy={actionBusy}
              effectiveWorkDir={status?.effectiveWorkDir}
            />
          </>
        )}

        {screen === "onboarding" && (
          <>
            <div className="block">
              <p className="hint">
                Onboarding version {onboarding?.currentVersion ?? "-"}, completed version {onboarding?.completedVersion ?? "-"}.
              </p>
              {onboarding?.launchBlockedByOnboarding && (
                <p className="hint">
                  Backend is ready and waiting. Complete or skip onboarding to enter the Kimi Web UI.
                </p>
              )}
              {onboarding?.startupOpenRequestApplied && (
                <p className="hint">
                  This run was started by Explorer open request; onboarding will not auto-block startup next time.
                </p>
              )}
              <ol className="onboarding-list" aria-label="Onboarding steps">
                {ONBOARDING_STEP_ORDER.map((step) => {
                  const complete = stepCompletion[step];
                  const active = onboardingStep === step;
                  return (
                    <li
                      key={step}
                      className={`onboarding-item ${active ? "active" : ""} ${
                        complete ? "done" : ""
                      }`}
                    >
                      <span className="onboarding-index">{ONBOARDING_STEP_ORDER.indexOf(step) + 1}</span>
                      <div>
                        <strong>{stepTitle(step)}</strong>
                        <p>{complete ? "Completed" : active ? "Current step" : "Pending"}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="block">
              <h3 className="log-tail-title">1. Install Kimi CLI</h3>
              <p className="hint">
                {onboarding?.kimiInstalled
                  ? `Detected: ${onboarding.detectedKimiPath ?? "kimi"}`
                  : "Kimi CLI not detected. Install first or set executable path manually."}
              </p>
              <div className="path-row">
                <input
                  id="kimi-path"
                  value={kimiPathInput}
                  onChange={(event) => setKimiPathInput(event.currentTarget.value)}
                  placeholder="C:\\Users\\you\\AppData\\...\\kimi.exe"
                />
                <button type="button" className="ghost" onClick={handlePickKimiPath}>
                  Browse
                </button>
              </div>
              <div className="actions">
                <button onClick={handleSavePathAndRetry} disabled={actionBusy || !kimiPathInput.trim()}>
                  Save Path & Retry
                </button>
                <button onClick={handleRetry} className="ghost" disabled={actionBusy}>
                  Retry Detection
                </button>
                <a
                  className="doc-link"
                  href="https://kimi.com/code/docs/zh-hans/kimi-cli/getting-started"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Install Docs
                </a>
              </div>
            </div>

            <div className="block">
              <h3 className="log-tail-title">2. Enable Explorer Context Menu</h3>
              <p className="hint">
                {onboarding?.contextMenuSupported
                  ? `Status: ${onboarding.contextMenuEnabled ? "Enabled" : "Disabled"}`
                  : "Not supported on this platform."}
              </p>
              {onboarding?.contextMenuMessage && <p className="hint">{onboarding.contextMenuMessage}</p>}
              <div className="actions">
                <button
                  onClick={handleEnableContextMenu}
                  disabled={contextMenuBusy || !onboarding?.contextMenuSupported}
                >
                  Enable
                </button>
                <button
                  onClick={handleDisableContextMenu}
                  className="ghost"
                  disabled={contextMenuBusy || !onboarding?.contextMenuSupported}
                >
                  Disable
                </button>
              </div>
            </div>

            <div className="block">
              <h3 className="log-tail-title">3. Login Kimi</h3>
              <p className="hint">Current status: {formatLoginState(onboarding?.loginState)}</p>
              {onboarding?.loginMessage && <p className="hint">{onboarding.loginMessage}</p>}
              {loginProbeResult?.message && <pre className="probe-output">{loginProbeResult.message}</pre>}
              <div className="actions">
                <button onClick={handleProbeLogin} disabled={loginProbeBusy}>
                  Detect / Run Login
                </button>
                <a
                  className="doc-link"
                  href="https://kimi.com/code/docs/zh-hans/kimi-code/cli/slash-command"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Login Docs
                </a>
              </div>
            </div>

            <WorkDirBlock
              title="4. Set Default Work Directory"
              value={workDirInput}
              onChange={setWorkDirInput}
              onBrowse={handlePickWorkDir}
              onSaveAndRestart={handleSaveWorkDirAndRestart}
              onClear={handleClearWorkDir}
              actionBusy={actionBusy}
              effectiveWorkDir={status?.effectiveWorkDir ?? onboarding?.workDir}
            />

            <div className="block">
              <h3 className="log-tail-title">5. Configure Provider API</h3>
              <p className="hint">
                Update provider/model/base URL/API key in your Kimi config, then confirm this step.
              </p>
              <p className="hint">
                Config path: <strong>%USERPROFILE%\\.kimi\\config.toml</strong> (Windows) or <strong>~/.kimi/config.toml</strong>.
              </p>
              <div className="actions">
                <button onClick={handleAckApiConfig} disabled={actionBusy}>
                  Mark API Config Complete
                </button>
                <a
                  className="doc-link"
                  href="https://kimi.com/code/docs/zh-hans/kimi-cli/guides/providers"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Provider Docs
                </a>
                <a
                  className="doc-link"
                  href="https://kimi.com/code/docs/zh-hans/kimi-cli/reference/web-subcommand"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open `kimi web` Options
                </a>
              </div>
              <p className="hint">
                Step status: <strong>{onboarding?.apiConfigAck ? "Completed" : "Pending"}</strong>
              </p>
            </div>

            <div className="block">
              <div className="actions">
                <button onClick={handleCompleteOnboarding} disabled={actionBusy}>
                  Complete Onboarding
                </button>
                <button onClick={handleSkipOnboarding} className="ghost" disabled={actionBusy}>
                  Skip For Now
                </button>
                <button onClick={handleRetry} className="ghost" disabled={actionBusy}>
                  Restart Backend
                </button>
                <button onClick={openDiagnostics} className="ghost">
                  Open Diagnostics
                </button>
              </div>
            </div>
          </>
        )}

        {screen === "diagnostics" && (
          <div className="block">
            <div className="actions">
              <button onClick={refreshDiagnostics} disabled={diagnosticsBusy}>
                Refresh Diagnostics
              </button>
              <button onClick={refreshContextMenuStatus} className="ghost" disabled={contextMenuBusy}>
                Refresh Context Menu
              </button>
              <button onClick={openOnboarding} className="ghost">
                Open Onboarding Center
              </button>
              <button onClick={handleOpenLogs} className="ghost">
                Open Logs Folder
              </button>
            </div>
            <h3 className="log-tail-title">Explorer Context Menu</h3>
            <p className="hint">
              {contextMenuStatus?.supported
                ? `Status: ${contextMenuStatus.enabled ? "Enabled" : "Disabled"}`
                : "Status: Not supported on this platform"}
            </p>
            {contextMenuStatus?.message && <p className="hint">{contextMenuStatus.message}</p>}
            <div className="actions">
              <button
                onClick={handleEnableContextMenu}
                disabled={contextMenuBusy || !contextMenuStatus?.supported}
              >
                Enable
              </button>
              <button
                onClick={handleDisableContextMenu}
                className="ghost"
                disabled={contextMenuBusy || !contextMenuStatus?.supported}
              >
                Disable
              </button>
            </div>
            <div className="diagnostics-grid">
              <DiagnosticItem label="Instance ID" value={diagnostics?.instanceId ?? "-"} />
              <DiagnosticItem label="PID" value={String(diagnostics?.pid ?? "-")} />
              <DiagnosticItem label="Started At (Epoch UTC)" value={diagnostics?.startedAt ?? "-"} />
              <DiagnosticItem label="Hotkey Owner" value={String(diagnostics?.isHotkeyOwner ?? false)} />
              <DiagnosticItem label="State" value={diagnostics?.state ?? "-"} />
              <DiagnosticItem label="Active Port" value={String(diagnostics?.activePort ?? "-")} />
              <DiagnosticItem label="Base Port" value={String(diagnostics?.basePort ?? "-")} />
              <DiagnosticItem label="Start Cycle ID" value={String(diagnostics?.startCycleId ?? "-")} />
              <DiagnosticItem label="Shell to Loading (ms)" value={String(diagnostics?.loadingStartupMs ?? "-")} />
              <DiagnosticItem label="Backend Ready (ms)" value={String(diagnostics?.backendReadyMs ?? "-")} />
              <DiagnosticItem label="Loading SLA Met" value={String(diagnostics?.loadingSlaMet ?? "-")} />
              <DiagnosticItem label="CLI Contract OK" value={String(diagnostics?.cliContractOk ?? "-")} />
              <DiagnosticItem label="CLI Contract Error" value={diagnostics?.cliContractError ?? "-"} />
              <DiagnosticItem label="Kimi Version" value={diagnostics?.kimiVersion ?? "-"} />
              <DiagnosticItem label="Version Check Error" value={diagnostics?.versionError ?? "-"} />
              <DiagnosticItem label="Configured Kimi Path" value={diagnostics?.configuredKimiPath ?? "-"} />
              <DiagnosticItem label="Detected Kimi Path" value={diagnostics?.detectedKimiPath ?? "-"} />
              <DiagnosticItem label="Configured Work Dir" value={diagnostics?.configuredWorkDir ?? "-"} />
              <DiagnosticItem label="Effective Work Dir" value={diagnostics?.effectiveWorkDir ?? "-"} />
              <DiagnosticItem label="Launch Command" value={diagnostics?.launchCommand ?? "-"} />
              <DiagnosticItem label="Last Error" value={diagnostics?.lastError ?? "-"} />
              <DiagnosticItem label="Last Exit Reason" value={diagnostics?.lastExitReason ?? "-"} />
              <DiagnosticItem label="App Log Path" value={diagnostics?.appLogPath ?? "-"} />
              <DiagnosticItem label="Backend Log Path" value={diagnostics?.backendLogPath ?? "-"} />
              <DiagnosticItem label="Logs Directory" value={diagnostics?.logsDir ?? "-"} />
            </div>
            <h3 className="log-tail-title">Recent App Log Tail</h3>
            <pre className="log-tail">
              {diagnostics?.appLogTail && diagnostics.appLogTail.length > 0
                ? diagnostics.appLogTail.join("\n")
                : "No app log lines available."}
            </pre>
            <h3 className="log-tail-title">Recent Backend Log Tail</h3>
            <pre className="log-tail">
              {diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0
                ? diagnostics.backendLogTail.join("\n")
                : "No log lines available."}
            </pre>
          </div>
        )}

        {(isLoading || actionError || status?.message) && (
          <footer className="panel-footer">
            {isLoading && <span>Checking backend status...</span>}
            {!isLoading && actionError && <span className="error-message">{actionError}</span>}
            {!isLoading && !actionError && !status?.message && status?.logsDir && (
              <span>Logs: {status.logsDir}</span>
            )}
          </footer>
        )}
      </section>
    </main>
  );
}

type WorkDirBlockProps = {
  title?: string;
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  onSaveAndRestart: () => void;
  onClear: () => void;
  actionBusy: boolean;
  effectiveWorkDir?: string;
};

function WorkDirBlock({
  title,
  value,
  onChange,
  onBrowse,
  onSaveAndRestart,
  onClear,
  actionBusy,
  effectiveWorkDir,
}: WorkDirBlockProps) {
  return (
    <div className="block">
      {title && <h3 className="log-tail-title">{title}</h3>}
      <label htmlFor="work-dir">Kimi work directory</label>
      <div className="path-row">
        <input
          id="work-dir"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="D:\\Projects\\your-repo"
        />
        <button type="button" className="ghost" onClick={onBrowse}>
          Browse
        </button>
      </div>
      <p className="hint">
        Effective directory: <strong>{effectiveWorkDir ?? "-"}</strong>
      </p>
      <div className="actions">
        <button onClick={onSaveAndRestart} disabled={actionBusy}>
          Save & Restart Backend
        </button>
        <button onClick={onClear} className="ghost" disabled={actionBusy}>
          Clear & Use Default
        </button>
      </div>
    </div>
  );
}

function DiagnosticItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="diag-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function stepTitle(step: OnboardingStep): string {
  switch (step) {
    case "install_kimi":
      return "Install Kimi CLI";
    case "context_menu":
      return "Enable Context Menu";
    case "login_kimi":
      return "Login Kimi";
    case "work_dir":
      return "Set Work Directory";
    case "api_config":
      return "Configure Provider API";
    default:
      return "Done";
  }
}

function formatLoginState(state?: LoginProbeState): string {
  if (state === "logged_in") return "Logged In";
  if (state === "login_required") return "Login Required";
  return "Unknown";
}

export default App;
