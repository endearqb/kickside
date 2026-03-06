import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Copy, FolderOpen, Minus, Square, X } from "lucide-react";
import { getInitialThemeMode } from "@/app/theme";
import type {
  PrefillStatusPayload,
  PrefillStatusState,
  StartupMonitorStatus,
} from "@/app/types";
import { KimiCliBrand } from "@/components/kimi-cli-brand";
import { IconButton } from "@/components/common/IconButton";
import { Button } from "@/components/ui/button";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusState, setStatusState] = useState<PrefillStatusState>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [monitorStatus, setMonitorStatus] = useState<StartupMonitorStatus | null>(null);
  const [polling, setPolling] = useState(true);
  const [windowControlsReady, setWindowControlsReady] = useState(false);
  const [isWindowMaximized, setIsWindowMaximized] = useState(false);
  const routedRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const appWindow = getCurrentWindow();
        const maximized = await appWindow.isMaximized();
        if (disposed) {
          return;
        }
        setIsWindowMaximized(maximized);
        setWindowControlsReady(true);
      } catch {
        if (disposed) {
          return;
        }
        setWindowControlsReady(false);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

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
      try {
        const nextStatus = await invoke<StartupMonitorStatus>(
          "get_startup_monitor_status",
        );
        if (disposed) {
          return;
        }

        setMonitorStatus(nextStatus);
        if (nextStatus.state === "failed") {
          setStatusState("startup_failed");
          setStatusDetail(
            nextStatus.detail?.trim() || "后端启动超时，请重试或打开日志排查。",
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
          setStatusDetail(nextStatus.detail?.trim() || "正在进入主界面…");
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
      } catch (invokeError) {
        if (disposed) {
          return;
        }
        setError(String(invokeError));
        setStatusState("startup_failed");
        setStatusDetail("启动状态获取失败，请重试或打开日志排查。");
        setPolling(false);
        routedRef.current = false;
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
      setStatusDetail("正在重新启动后端…");
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

  async function handleMinimizeWindow() {
    try {
      await getCurrentWindow().minimize();
    } catch (invokeError) {
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

  async function handleToggleMaximizeWindow() {
    try {
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const maximized = await appWindow.isMaximized();
      setIsWindowMaximized(maximized);
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
    if (!windowControlsReady) return;
    if (event.button !== 0) return;
    if (!isTitlebarDragTarget(event.target)) return;
    void handleStartWindowDrag();
  };

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!windowControlsReady) return;
    if (event.button !== 0) return;
    if (!isTitlebarDragTarget(event.target)) return;
    void handleToggleMaximizeWindow();
  };

  const title =
    statusState === "startup_failed"
      ? "后端启动失败"
      : statusState === "opening_main"
        ? "正在进入主界面"
        : "正在等待后端启动完成";
  const detail =
    statusState === "startup_failed"
      ? statusDetail ?? "后端启动超时，请重试或打开日志排查。"
      : null;

  return (
    <main className={`prefill-page shell-root theme-${themeMode}`}>
      <header
        className="prefill-titlebar titlebar"
        onMouseDown={handleTitlebarMouseDown}
        onDoubleClick={handleTitlebarDoubleClick}
      >
        <div className="prefill-titlebar-left">
          <div className="prefill-titlebar-brand titlebar-drag">
            <KimiCliBrand compact />
          </div>
        </div>

        <div className="prefill-titlebar-center titlebar-drag">
          <span className="prefill-titlebar-caption">启动监控</span>
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
          {windowControlsReady ? (
            <div className="titlebar-window-controls">
              <IconButton
                icon={<Minus size={14} />}
                label="Minimize window"
                onClick={() => {
                  void handleMinimizeWindow();
                }}
                className="window-control-btn"
              />
              <IconButton
                icon={isWindowMaximized ? <Copy size={12} /> : <Square size={12} />}
                label={isWindowMaximized ? "Restore window" : "Maximize window"}
                onClick={() => {
                  void handleToggleMaximizeWindow();
                }}
                className="window-control-btn"
              />
              <IconButton
                icon={<X size={14} />}
                label="Close window"
                onClick={() => {
                  void handleCloseWindow();
                }}
                className="window-control-btn close"
              />
            </div>
          ) : null}
        </div>
      </header>

      <section className="prefill-stage">
        <div className="prefill-status-shell">
          <div className="prefill-status-panel" role="status" aria-live="polite">
            {statusState !== "startup_failed" && <div className="spinner" aria-hidden />}
            <p className="prefill-status-title">{title}</p>
            {detail ? <p className="prefill-status-detail">{detail}</p> : null}

            <div className="prefill-metrics" aria-label="启动状态详情">
              <div className="prefill-metric">
                <span className="prefill-metric-label">累计耗时</span>
                <strong>{formatElapsed(monitorStatus?.elapsedMs)}</strong>
              </div>
              <div className="prefill-metric">
                <span className="prefill-metric-label">后端状态</span>
                <strong>{monitorStatus?.backendState ?? "starting"}</strong>
              </div>
              <div className="prefill-metric">
                <span className="prefill-metric-label">分流目标</span>
                <strong>{monitorStatus?.targetRoute ?? "-"}</strong>
              </div>
            </div>

            {error ? <p className="prefill-error">{error}</p> : null}

            {statusState === "startup_failed" ? (
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
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
