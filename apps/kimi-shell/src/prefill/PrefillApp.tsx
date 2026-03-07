import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FolderOpen, X } from "lucide-react";
import { getInitialThemeMode } from "@/app/theme";
import type {
  AppStatus,
  PrefillStatusPayload,
  PrefillStatusState,
  StartupMonitorStatus,
} from "@/app/types";
import { KimiCliBrand } from "@/components/kimi-cli-brand";
import { IconButton } from "@/components/common/IconButton";
import { Button } from "@/components/ui/button";
import { pickRandomAgentTip } from "@/lib/agentTips";

const PREFILL_STATUS_EVENT = "prefill-status";
const STARTUP_MONITOR_POLL_MS = 1000;
const DRAG_BLOCK_SELECTOR =
  "button, a, input, textarea, select, [role='button'], [data-no-drag='true']";

function isTitlebarDragTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element && target.closest(DRAG_BLOCK_SELECTOR));
}

function formatElapsed(elapsedMs: number | undefined): string {
  const safeElapsed = Math.max(0, elapsedMs ?? 0);
  if (safeElapsed < 1000) {
    return `${safeElapsed} ms`;
  }
  return `${(safeElapsed / 1000).toFixed(1)} s`;
}

export function PrefillApp() {
  const themeMode = useMemo(() => getInitialThemeMode(), []);
  const selectedTip = useMemo(() => pickRandomAgentTip(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusState, setStatusState] = useState<PrefillStatusState>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<StartupMonitorStatus | null>(null);
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [polling, setPolling] = useState(true);
  const routedRef = useRef(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void getCurrentWebviewWindow()
      .listen<PrefillStatusPayload>(PREFILL_STATUS_EVENT, (event) => {
        const nextState = event.payload?.state ?? "idle";
        const nextDetail = event.payload?.detail?.trim() || null;
        setStatusState(nextState);
        setStatusDetail(nextDetail);
        if (nextState === "startup_failed") {
          setPolling(false);
          routedRef.current = false;
        }
        if (nextState !== "idle") {
          setError(null);
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((listenError) => {
        setError(String(listenError));
      });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (!polling) {
      return;
    }

    let disposed = false;
    let timer: number | undefined;

    const tick = async () => {
      const [monitorResult, appStatusResult] = await Promise.allSettled([
        invoke<StartupMonitorStatus>("get_startup_monitor_status"),
        invoke<AppStatus>("get_app_status"),
      ]);

      if (disposed) {
        return;
      }

      if (appStatusResult.status === "fulfilled") {
        setAppStatus(appStatusResult.value);
      } else {
        setError((current) => current ?? String(appStatusResult.reason));
      }

      if (monitorResult.status !== "fulfilled") {
        setError(String(monitorResult.reason));
        setStatusState("startup_failed");
        setStatusDetail("Failed to read startup status. Please retry or open logs.");
        setPolling(false);
        routedRef.current = false;
        return;
      }

      const nextStatus = monitorResult.value;
      setMonitorStatus(nextStatus);

      if (nextStatus.state === "failed") {
        setStatusState("startup_failed");
        setStatusDetail(
          nextStatus.detail?.trim() ||
            "Backend startup timed out. Please retry or inspect the logs.",
        );
        setPolling(false);
        routedRef.current = false;
        return;
      }

      if (
        (nextStatus.state === "route_workspace" ||
          nextStatus.state === "route_control_center") &&
        nextStatus.targetRoute &&
        !routedRef.current
      ) {
        routedRef.current = true;
        setStatusState("opening_main");
        setStatusDetail(nextStatus.detail?.trim() || "Opening the main shell...");
        setPolling(false);
        await invoke("complete_startup_monitor_route", {
          targetRoute: nextStatus.targetRoute,
        });
        return;
      }

      if (nextStatus.state === "waiting") {
        setStatusState("idle");
        setStatusDetail(nextStatus.detail?.trim() || null);
      }
    };

    void tick();
    timer = window.setInterval(() => {
      void tick();
    }, STARTUP_MONITOR_POLL_MS);

    return () => {
      disposed = true;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, [polling]);

  async function handleRetryStartup() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await invoke("retry_start_backend");
      routedRef.current = false;
      setMonitorStatus(null);
      setStatusState("idle");
      setStatusDetail("Restarting backend...");
      setPolling(true);
    } catch (invokeError) {
      setStatusState("startup_failed");
      setError(String(invokeError));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenLogs() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await invoke("open_logs_folder");
    } catch (invokeError) {
      setError(String(invokeError));
    } finally {
      setBusy(false);
    }
  }

  async function handleQuitApp() {
    if (busy) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await invoke("quit_app_gracefully");
    } catch (invokeError) {
      setBusy(false);
      setError(String(invokeError));
    }
  }

  async function handleStartWindowDrag() {
    try {
      await getCurrentWindow().startDragging();
    } catch (invokeError) {
      setError(String(invokeError));
    }
  }

  async function handleCloseWindow() {
    try {
      await getCurrentWindow().close();
    } catch (invokeError) {
      setError(String(invokeError));
    }
  }

  const handleTitlebarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (!isTitlebarDragTarget(event.target)) return;
    void handleStartWindowDrag();
  };

  const isStartupFailed = statusState === "startup_failed";
  const statusHeadline =
    statusState === "opening_main"
      ? "Opening main window..."
      : statusDetail ?? "Waiting for backend startup to finish...";
  const failureDetail =
    statusDetail ?? "Backend startup timed out. Please retry or inspect the logs.";
  const effectiveWorkDir = appStatus?.effectiveWorkDir?.trim() || "-";

  return (
    <main className={`prefill-page shell-root theme-${themeMode}`}>
      <header className="prefill-titlebar titlebar" onMouseDown={handleTitlebarMouseDown}>
        <div className="prefill-titlebar-left">
          <div className="prefill-titlebar-brand titlebar-drag">
            <KimiCliBrand compact />
          </div>
        </div>

        <div className="prefill-titlebar-right" data-no-drag="true">
          <Button
            type="button"
            variant="ghost"
            className="prefill-open-logs"
            icon={<FolderOpen size={15} />}
            onClick={() => {
              void handleOpenLogs();
            }}
            disabled={busy}
          >
            打开日志
          </Button>
          <div className="titlebar-window-controls">
            <IconButton
              icon={<X size={14} />}
              label="Close window"
              onClick={() => {
                void handleCloseWindow();
              }}
              className="window-control-btn close"
            />
          </div>
        </div>
      </header>

      <section className={`prefill-stage${isStartupFailed ? " is-failed" : ""}`}>
        {!isStartupFailed ? (
          <>
            <article className="prefill-tip-card prefill-tip-card-hero">
              <div className="prefill-tip-meta">
                <span className="prefill-tip-badge">随机提示</span>
                <span className="prefill-tip-number">{selectedTip.numberLabel}</span>
              </div>
              <h1 className="prefill-tip-title">{selectedTip.title}</h1>
              <p className="prefill-tip-body">{selectedTip.body}</p>
            </article>

            <div className="prefill-status-panel" role="status" aria-live="polite">
              <div className="prefill-status-strip">
                <div className="prefill-status-headline">
                  <div className="spinner" aria-hidden />
                  <span>{statusHeadline}</span>
                </div>

                <div className="prefill-status-chips" aria-label="Startup details">
                  <div className="prefill-status-chip">
                    <span className="prefill-status-chip-label">Elapsed</span>
                    <strong>{formatElapsed(monitorStatus?.elapsedMs)}</strong>
                  </div>
                  <div className="prefill-status-chip">
                    <span className="prefill-status-chip-label">Backend</span>
                    <strong>{monitorStatus?.backendState ?? "starting"}</strong>
                  </div>
                  <div className="prefill-status-chip">
                    <span className="prefill-status-chip-label">Route</span>
                    <strong>{monitorStatus?.targetRoute ?? "-"}</strong>
                  </div>
                </div>
              </div>
              <p className="prefill-status-meta" title={effectiveWorkDir}>
                Effective directory: <strong>{effectiveWorkDir}</strong>
              </p>
              {error ? <p className="prefill-error">{error}</p> : null}
            </div>
          </>
        ) : (
          <>
            <div
              className="prefill-status-panel prefill-failure-card"
              role="status"
              aria-live="polite"
            >
              <div className="prefill-failure-badge">启动恢复</div>
              <p className="prefill-status-title">后端启动失败</p>
              <p className="prefill-status-detail">{failureDetail}</p>
              {error ? <p className="prefill-error">{error}</p> : null}

              <div className="prefill-status-actions">
                <Button
                  type="button"
                  variant="default"
                  onClick={() => {
                    void handleRetryStartup();
                  }}
                  disabled={busy}
                >
                  {busy ? "处理中..." : "重试启动"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    void handleQuitApp();
                  }}
                  disabled={busy}
                >
                  退出应用
                </Button>
              </div>
              <p className="prefill-status-meta" title={effectiveWorkDir}>
                Effective directory: <strong>{effectiveWorkDir}</strong>
              </p>
            </div>

            <article className="prefill-tip-card prefill-tip-card-secondary">
              <div className="prefill-tip-meta">
                <span className="prefill-tip-badge">今日提示</span>
                <span className="prefill-tip-number">{selectedTip.numberLabel}</span>
              </div>
              <h2 className="prefill-tip-title">{selectedTip.title}</h2>
              <p className="prefill-tip-body">{selectedTip.body}</p>
            </article>
          </>
        )}
      </section>
    </main>
  );
}
