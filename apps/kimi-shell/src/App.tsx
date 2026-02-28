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

type Screen = "loading" | "missing-kimi" | "error" | "diagnostics";

const POLL_MS = 1000;

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const loadingReportCycleRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [contextMenuBusy, setContextMenuBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [contextMenuStatus, setContextMenuStatus] = useState<ContextMenuStatus | null>(null);
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

  useEffect(() => {
    void refreshStatus();
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

  const screen: Screen = useMemo(() => {
    const hashRoute = window.location.hash.replace(/^#\/?/, "");
    if (hashRoute === "diagnostics") return "diagnostics";

    if (status?.state === "missing_kimi") return "missing-kimi";
    if (status?.state === "crashed") return "error";

    if (hashRoute === "missing-kimi" || hashRoute === "error" || hashRoute === "loading") {
      return hashRoute as Screen;
    }

    return "loading";
  }, [status]);

  useEffect(() => {
    if (screen === "diagnostics") {
      void refreshDiagnostics();
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
      await refreshStatus();
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
      await refreshStatus();
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
      await refreshStatus();
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
      await refreshStatus();
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
    } catch (error) {
      setActionError(String(error));
    } finally {
      setContextMenuBusy(false);
    }
  }

  function openDiagnostics() {
    window.location.hash = "/diagnostics";
  }

  function backToStatus() {
    window.location.hash = "/loading";
  }

  const remoteUrl = status?.activePort ? `http://127.0.0.1:${status.activePort}` : null;
  const statusText = status?.state ?? "starting";
  const hotkeyOwnerLabel = status?.isHotkeyOwner ? "This instance owns global hotkey." : "Global hotkey is owned by another running instance.";

  return (
    <main className="shell-root">
      <section className="panel">
        <header className="panel-header">
          <div className="header-top">
            <span className="eyebrow">Kimi Desktop Shell</span>
            <div className="header-actions">
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
            {screen === "missing-kimi" && "Kimi CLI Not Found"}
            {screen === "error" && "Backend Error"}
            {screen === "diagnostics" && "Diagnostics"}
          </h1>
          <p>
            {screen === "loading" &&
              "The desktop shell is waiting for `kimi web` to become ready."}
            {screen === "missing-kimi" &&
              "Install Kimi CLI or provide an executable path to continue."}
            {screen === "error" &&
              "The backend process exited or failed to start."}
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

        {screen === "missing-kimi" && (
          <>
            <div className="block">
              <label htmlFor="kimi-path">Kimi executable path</label>
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
              <p className="hint">
                Current hotkey: <strong>{status?.hotkey ?? "CmdOrCtrl+Shift+K"}</strong>
              </p>
              <div className="actions">
                <button onClick={handleSavePathAndRetry} disabled={actionBusy || !kimiPathInput.trim()}>
                  Save Path & Retry
                </button>
                <button onClick={handleRetry} className="ghost" disabled={actionBusy}>
                  Retry Detection
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

        {screen === "error" && (
          <>
            <div className="block">
              <p className="error-message">{status?.message ?? "Unknown backend error."}</p>
              <div className="actions">
                <button onClick={handleRetry} disabled={actionBusy}>
                  Retry Start
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

        {screen === "diagnostics" && (
          <div className="block">
            <div className="actions">
              <button onClick={refreshDiagnostics} disabled={diagnosticsBusy}>
                Refresh Diagnostics
              </button>
              <button onClick={refreshContextMenuStatus} className="ghost" disabled={contextMenuBusy}>
                Refresh Context Menu
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
              {(diagnostics?.appLogTail && diagnostics.appLogTail.length > 0
                ? diagnostics.appLogTail.join("\n")
                : "No app log lines available.")}
            </pre>
            <h3 className="log-tail-title">Recent Backend Log Tail</h3>
            <pre className="log-tail">
              {(diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0
                ? diagnostics.backendLogTail.join("\n")
                : "No log lines available.")}
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
  value: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  onSaveAndRestart: () => void;
  onClear: () => void;
  actionBusy: boolean;
  effectiveWorkDir?: string;
};

function WorkDirBlock({
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

export default App;
