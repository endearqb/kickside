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

function formatBackendStateLabel(state: AppStatus["state"] | undefined): string {
  switch (state) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopping":
      return "停止中";
    case "crashed":
      return "异常";
    case "missing_kimi":
      return "缺少 Kimi";
    default:
      return "-";
  }
}

function formatTargetRouteLabel(route: StartupMonitorStatus["targetRoute"] | undefined): string {
  switch (route) {
    case "workspace":
      return "工作区";
    case "onboarding":
      return "引导页";
    case "diagnostics":
      return "诊断页";
    case "control_center":
      return "控制中心";
    default:
      return "-";
  }
}

function formatStartupPhaseLabel(phase: AppStatus["startupPhase"] | undefined): string {
  switch (phase) {
    case "prefill_surface_shown":
      return "Prefill 已展示";
    case "main_boot_requested":
      return "请求启动主窗口";
    case "main_build_task_posted":
      return "主线程任务已投递";
    case "main_build_task_entered":
      return "主线程任务已进入";
    case "main_config_loaded":
      return "窗口配置已加载";
    case "main_builder_constructed":
      return "窗口构建器已创建";
    case "main_build_started":
      return "窗口创建中";
    case "main_window_created":
      return "主窗口已创建";
    case "main_page_load_started":
      return "页面开始加载";
    case "main_page_load_finished":
      return "页面加载完成";
    case "frontend_ready":
      return "前端已就绪";
    case "failed":
      return "启动失败";
    case "idle":
    default:
      return "-";
  }
}

function formatStartupFailureKindLabel(
  kind: AppStatus["startupFailureKind"] | undefined,
): string {
  switch (kind) {
    case "main_thread_task_stalled":
      return "主线程任务未及时进入";
    case "main_webview_build_hung":
      return "主窗口创建超时";
    case "frontend_ready_timeout":
      return "前端就绪超时";
    case "main_navigation_failed":
      return "主窗口导航失败";
    case "main_window_missing":
      return "主窗口缺失";
    case "main_destroyed_during_startup":
      return "启动过程中窗口被销毁";
    case "main_close_requested_during_startup":
      return "启动过程中收到关闭请求";
    default:
      return "-";
  }
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
  const [openingMainStartedAtMs, setOpeningMainStartedAtMs] = useState<number | null>(null);
  const [openingMainBaseElapsedMs, setOpeningMainBaseElapsedMs] = useState<number | null>(null);
  const [openingMainElapsedMs, setOpeningMainElapsedMs] = useState<number | null>(null);
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
          setOpeningMainStartedAtMs(null);
          setOpeningMainBaseElapsedMs(null);
          setOpeningMainElapsedMs(null);
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
    if (
      statusState !== "opening_main" ||
      openingMainStartedAtMs === null ||
      openingMainBaseElapsedMs === null
    ) {
      return;
    }

    const updateElapsed = () => {
      const delta = Math.max(0, Date.now() - openingMainStartedAtMs);
      setOpeningMainElapsedMs(openingMainBaseElapsedMs + delta);
    };

    updateElapsed();
    const timer = window.setInterval(updateElapsed, 100);
    return () => {
      window.clearInterval(timer);
    };
  }, [openingMainBaseElapsedMs, openingMainStartedAtMs, statusState]);

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
        setOpeningMainStartedAtMs(null);
        setOpeningMainBaseElapsedMs(null);
        setOpeningMainElapsedMs(null);
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
        setOpeningMainStartedAtMs(null);
        setOpeningMainBaseElapsedMs(null);
        setOpeningMainElapsedMs(null);
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
        setOpeningMainStartedAtMs(Date.now());
        setOpeningMainBaseElapsedMs(nextStatus.elapsedMs);
        setOpeningMainElapsedMs(nextStatus.elapsedMs);
        try {
          await invoke("complete_startup_monitor_route", {
            targetRoute: nextStatus.targetRoute,
          });
          setPolling(false);
        } catch (invokeError) {
          routedRef.current = false;
          setOpeningMainStartedAtMs(null);
          setOpeningMainBaseElapsedMs(null);
          setOpeningMainElapsedMs(null);
          setStatusState("idle");
          setStatusDetail("主窗口接管失败，继续等待启动状态。");
          setError(String(invokeError));
        }
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
      setOpeningMainStartedAtMs(null);
      setOpeningMainBaseElapsedMs(null);
      setOpeningMainElapsedMs(null);
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
  const displayedElapsedMs =
    statusState === "opening_main"
      ? openingMainElapsedMs ?? openingMainBaseElapsedMs ?? monitorStatus?.elapsedMs
      : monitorStatus?.elapsedMs;
  const statusHeadline =
    statusState === "opening_main"
      ? "正在打开主窗口…"
      : statusDetail ?? "正在等待后端启动完成…";
  const failureDetail =
    statusDetail ?? "后端启动超时。请先重试；如果仍失败，再打开日志继续排查。";
  const effectiveWorkDir = appStatus?.effectiveWorkDir?.trim() || "-";
  const startupPhaseLabel = formatStartupPhaseLabel(appStatus?.startupPhase);
  const startupFailureKindLabel = formatStartupFailureKindLabel(appStatus?.startupFailureKind);

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
              label="关闭窗口"
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
            <div className="prefill-status-panel prefill-status-panel-primary" role="status" aria-live="polite">
              <div className="prefill-status-head">
                <div className="prefill-failure-badge">启动中</div>
                <p className="prefill-status-title">正在准备 Kimi App 工作区</p>
                <p className="prefill-status-detail">{statusHeadline}</p>
              </div>
              <div className="prefill-status-strip">
                <div className="prefill-status-headline">
                  <div className="spinner" aria-hidden />
                  <span>启动状态会在这里持续更新</span>
                </div>

                <div className="prefill-status-chips" aria-label="Startup details">
                  <div className="prefill-status-chip">
                    <span className="prefill-status-chip-label">已耗时</span>
                    <strong>{formatElapsed(displayedElapsedMs)}</strong>
                  </div>
                  <div className="prefill-status-chip">
                    <span className="prefill-status-chip-label">后端</span>
                    <strong>{formatBackendStateLabel(monitorStatus?.backendState)}</strong>
                  </div>
                  <div className="prefill-status-chip">
                    <span className="prefill-status-chip-label">目标界面</span>
                    <strong>{formatTargetRouteLabel(monitorStatus?.targetRoute)}</strong>
                  </div>
                  <div className="prefill-status-chip">
                    <span className="prefill-status-chip-label">当前阶段</span>
                    <strong>{startupPhaseLabel}</strong>
                  </div>
                </div>
              </div>
              <p className="prefill-status-meta" title={effectiveWorkDir}>
                当前工作目录：<strong>{effectiveWorkDir}</strong>
              </p>
              {error ? <p className="prefill-error">{error}</p> : null}
            </div>

            <article className="prefill-tip-card prefill-tip-card-secondary">
              <div className="prefill-tip-meta">
                <span className="prefill-tip-badge">启动提示</span>
                <span className="prefill-tip-number">{selectedTip.numberLabel}</span>
              </div>
              <h2 className="prefill-tip-title">{selectedTip.title}</h2>
              <p className="prefill-tip-body">{selectedTip.body}</p>
            </article>
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
              <p className="prefill-status-meta">
                启动阶段：<strong>{startupPhaseLabel}</strong>
                {" · "}
                失败类型：<strong>{startupFailureKindLabel}</strong>
              </p>
              <p className="prefill-status-meta" title={effectiveWorkDir}>
                当前工作目录：<strong>{effectiveWorkDir}</strong>
              </p>
            </div>

            <article className="prefill-tip-card prefill-tip-card-secondary">
              <div className="prefill-tip-meta">
                <span className="prefill-tip-badge">补充提示</span>
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
