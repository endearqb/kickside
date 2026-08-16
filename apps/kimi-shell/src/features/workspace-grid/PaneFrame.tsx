import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  Code2,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe2,
  Maximize2,
  MessageCircle,
  Minimize2,
  RefreshCcw,
  Trash2,
} from "lucide-react";
import { BackendBrandIcon } from "@/components/BackendBrandIcon";
import { THEME_SYNC_SOURCE } from "@/app/theme";
import {
  parseDshFrameWorkspaceMessage,
  parseWorkspaceFrameSessionMessage,
  queryDshFrameWorkspace,
  queryWorkspaceFrameSessionId,
} from "@/app/linkBridge";
import type { Theme, WorkspacePaneState } from "@/app/types";
import { Button } from "@/components/ui/button";
import {
  createEmbeddedExternalWebview,
  type EmbeddedExternalWebviewBounds,
  type EmbeddedExternalWebviewController,
} from "@/services/externalWebviewService";
import { buildCodePaneUrl } from "./paneUrl";
import type { WorkspacePane, WorkspacePaneKind } from "./gridTypes";
import {
  getTrustedDshRuntimeUrl,
  type DshStatus,
} from "@/services/dshService";

const EXTERNAL_FRAME_TIMEOUT_MS = 8_000;
const DSH_GUIDE_ACK_KEY = "kimi-dsh-first-use-guide-v1";

interface PaneFrameProps {
  pane: WorkspacePane | null;
  active: boolean;
  maximized: boolean;
  dragging: boolean;
  themeMode: Theme;
  codeRemoteUrl: string | null;
  codeFrameKey: string;
  chatRemoteUrl: string;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  workspaceBridgeNonce: string;
  chatIframeRef: RefObject<HTMLIFrameElement | null>;
  codePaneState: WorkspacePaneState;
  chatPaneState: WorkspacePaneState;
  dshStatus: DshStatus | null;
  dshError: string | null;
  actionBusy: boolean;
  onRetry: () => void;
  onOpenLogs: () => void;
  onOpenFolder: (path: string) => Promise<void>;
  onOpenPaneFolder: (frame: HTMLIFrameElement | null) => Promise<void>;
  onPaneSessionObserved: (paneId: string, sessionId: string | null) => void;
  onPaneDshWorkspaceObserved: (
    paneId: string,
    sessionId: string | null,
    workDir: string | null,
  ) => void;
  onOpenExternalUrl: (url: string) => void;
  onOpenTauriWebviewUrl: (
    url: string,
    title: string,
    storageNamespace?: string,
  ) => void;
  onCodeFrameLoad: () => void;
  onCodeFrameError: () => void;
  onChatFrameLoad: () => void;
  onChatFrameError: () => void;
  onActivate: () => void;
  onConfigurePane: (kind: WorkspacePaneKind, roomId?: string) => void;
  onRemovePane: () => void;
  onResumePane: () => void;
  onPaneDragStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onToggleMaximize: () => void;
  onRefreshDsh: () => Promise<DshStatus | null>;
  onRecoverDsh: (workspaceDir?: string) => Promise<DshStatus | null>;
}

export function PaneFrame({
  pane,
  active,
  maximized,
  dragging,
  themeMode,
  codeRemoteUrl,
  codeFrameKey,
  chatRemoteUrl,
  workspaceIframeRef,
  workspaceBridgeNonce,
  chatIframeRef,
  codePaneState,
  chatPaneState,
  dshStatus,
  dshError,
  actionBusy,
  onRetry,
  onOpenLogs,
  onOpenFolder,
  onOpenPaneFolder,
  onPaneSessionObserved,
  onPaneDshWorkspaceObserved,
  onOpenExternalUrl,
  onOpenTauriWebviewUrl,
  onCodeFrameLoad,
  onCodeFrameError,
  onChatFrameLoad,
  onChatFrameError,
  onActivate,
  onConfigurePane,
  onRemovePane,
  onResumePane,
  onPaneDragStart,
  onToggleMaximize,
  onRefreshDsh,
  onRecoverDsh,
}: PaneFrameProps) {
  const paneIframeRef = useRef<HTMLIFrameElement | null>(null);
  const sessionObservationGenerationRef = useRef(0);
  const dshWorkspaceObservationGenerationRef = useRef(0);
  const folderBusyRef = useRef(false);
  const [observedSessionId, setObservedSessionId] = useState<string | null>();
  const [observedDshWorkspace, setObservedDshWorkspace] = useState<
    { sessionId: string; workDir: string } | null | undefined
  >();
  const [folderBusy, setFolderBusy] = useState(false);
  const paneId = pane?.id ?? null;
  const codeOrigin = pane?.kind === "code" ? urlOrigin(codeRemoteUrl) : "";
  const dshRuntimeUrl = pane?.kind === "dsh" ? getTrustedDshRuntimeUrl(dshStatus) : null;
  const dshOrigin = urlOrigin(dshRuntimeUrl);
  const codeFrameMounted = Boolean(
    pane?.kind === "code" && codeRemoteUrl && isPaneContentMounted(pane, active),
  );
  const dshFrameMounted = Boolean(
    pane?.kind === "dsh" && dshRuntimeUrl && isPaneContentMounted(pane, active),
  );

  useLayoutEffect(() => {
    sessionObservationGenerationRef.current += 1;
    setObservedSessionId(undefined);
  }, [codeFrameKey, codeFrameMounted, codeOrigin]);

  useLayoutEffect(() => {
    dshWorkspaceObservationGenerationRef.current += 1;
    setObservedDshWorkspace(undefined);
  }, [dshFrameMounted, dshOrigin, paneId]);

  useEffect(() => {
    if (!codeFrameMounted || !codeOrigin || !paneId) {
      return;
    }
    const handleMessage = (event: MessageEvent) => {
      const message = parseWorkspaceFrameSessionMessage(
        event,
        paneIframeRef.current,
        codeOrigin,
      );
      if (message?.action === "pane_session_changed") {
        sessionObservationGenerationRef.current += 1;
        setObservedSessionId(message.sessionId);
        onPaneSessionObserved(paneId, message.sessionId);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [codeFrameMounted, codeOrigin, onPaneSessionObserved, paneId]);

  useEffect(() => {
    if (!dshFrameMounted || !dshOrigin || !paneId) {
      return;
    }
    const handleMessage = (event: MessageEvent) => {
      const message = parseDshFrameWorkspaceMessage(
        event,
        paneIframeRef.current,
        dshOrigin,
      );
      if (message?.action !== "dsh_workspace_changed") {
        return;
      }
      dshWorkspaceObservationGenerationRef.current += 1;
      const workspace =
        message.applied && message.sessionId && message.workDir
          ? { sessionId: message.sessionId, workDir: message.workDir }
          : null;
      setObservedDshWorkspace(workspace);
      onPaneDshWorkspaceObserved(
        paneId,
        workspace?.sessionId ?? null,
        workspace?.workDir ?? null,
      );
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [dshFrameMounted, dshOrigin, onPaneDshWorkspaceObserved, paneId]);

  if (!pane) {
    return (
      <div className="workspace-grid-pane workspace-grid-pane-empty">
        <div className="workspace-grid-empty-copy">
          <strong>暂无窗格，请使用左上角 + 新建窗格</strong>
        </div>
      </div>
    );
  }

  const source = pane.carrier === "iframe" ? resolvePaneSource({
    pane,
    codeRemoteUrl,
    codeFrameKey,
    chatRemoteUrl,
    workspaceIframeRef,
    workspaceBridgeNonce,
    chatIframeRef,
    codePaneState,
    chatPaneState,
    dshStatus,
    onCodeFrameLoad,
    onCodeFrameError,
    onChatFrameLoad,
    onChatFrameError,
  }) : null;
  const paneTheme = pane.kind === "dsh" ? themeMode : pane.theme ?? themeMode;
  const folderActionLabel = folderBusy
    ? "正在解析当前会话目录"
    : observedSessionId === undefined
      ? "正在识别当前会话"
      : observedSessionId === null
        ? "当前窗格尚未进入会话"
        : "打开当前会话目录";
  const dshFolderActionLabel = folderBusy
    ? "正在打开当前会话目录"
    : observedDshWorkspace === undefined
      ? "正在识别 DeepSeek Harness 当前会话"
      : observedDshWorkspace === null
        ? "DeepSeek Harness 当前窗格尚未进入会话"
        : "打开 DeepSeek Harness 当前会话目录";
  const viewToggle =
    pane.kind === "code"
      ? {
          target: "chat" as const,
          label: "当前 KimiCode，切换为 KimiChat",
          icon: <Code2 size={14} aria-hidden />,
          active: true,
        }
      : pane.kind === "chat"
        ? {
            target: "code" as const,
            label: "当前 KimiChat，切换为 KimiCode",
            icon: <MessageCircle size={14} aria-hidden />,
            active: true,
          }
        : {
            target: "code" as const,
            label: "切换为 KimiCode",
            icon: <Code2 size={14} aria-hidden />,
            active: false,
          };

  return (
    <article
      className={`workspace-grid-pane${active ? " is-active" : ""}${
        dragging ? " is-dragging-source" : ""
      }`}
      data-workspace-pane-id={pane.id}
      tabIndex={-1}
      onFocus={onActivate}
      onPointerDown={onActivate}
    >
      <header
        className="workspace-grid-pane-header"
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) {
            return;
          }
          onPaneDragStart(event);
        }}
      >
        <div className="workspace-grid-pane-title">
          {pane.kind === "code" || pane.kind === "chat" ? (
            <BackendBrandIcon brand="kimi" size={15} />
          ) : null}
          {pane.kind === "external" ? <Globe2 size={14} aria-hidden /> : null}
          {pane.kind === "dsh" ? <BackendBrandIcon brand="dsh" size={15} /> : null}
          <span>{pane.title}</span>
        </div>
        <div className="workspace-grid-pane-actions">
          {pane.kind === "code" ? (
            <IconButton
              label={folderActionLabel}
              onClick={() => {
                if (folderBusyRef.current) {
                  return;
                }
                folderBusyRef.current = true;
                setFolderBusy(true);
                void Promise.resolve()
                  .then(() => onOpenPaneFolder(paneIframeRef.current))
                  .finally(() => {
                    folderBusyRef.current = false;
                    setFolderBusy(false);
                  });
              }}
              disabled={!codeFrameMounted || !observedSessionId || folderBusy}
            >
              <FolderOpen size={14} aria-hidden />
            </IconButton>
          ) : null}
          {pane.kind === "dsh" ? (
            <IconButton
              label={dshFolderActionLabel}
              onClick={() => {
                const workDir = observedDshWorkspace?.workDir;
                if (!workDir || folderBusyRef.current) {
                  return;
                }
                folderBusyRef.current = true;
                setFolderBusy(true);
                void onOpenFolder(workDir).finally(() => {
                  folderBusyRef.current = false;
                  setFolderBusy(false);
                });
              }}
              disabled={!dshFrameMounted || !observedDshWorkspace || folderBusy}
            >
              <FolderOpen size={14} aria-hidden />
            </IconButton>
          ) : null}
          {pane.kind !== "agent_room" && pane.kind !== "dsh" ? (
            <IconButton
              label={viewToggle.label}
              onClick={() => onConfigurePane(viewToggle.target)}
              active={viewToggle.active}
            >
              {viewToggle.icon}
            </IconButton>
          ) : null}
          {pane.kind === "dsh" ? (
            <IconButton
              label="刷新 DeepSeek Harness"
              onClick={() => void onRefreshDsh()}
            >
              <RefreshCcw size={14} aria-hidden />
            </IconButton>
          ) : null}
          <IconButton
            label={maximized ? "还原窗格" : "最大化窗格"}
            onClick={onToggleMaximize}
          >
            {maximized ? (
              <Minimize2 size={14} aria-hidden />
            ) : (
              <Maximize2 size={14} aria-hidden />
            )}
          </IconButton>
          <IconButton label="关闭窗格" onClick={onRemovePane}>
            <Trash2 size={14} aria-hidden />
          </IconButton>
        </div>
      </header>
      {source ? <PaneContent
        pane={pane}
        source={source}
        actionBusy={actionBusy}
        onRetry={onRetry}
        onOpenLogs={onOpenLogs}
        onOpenExternalUrl={onOpenExternalUrl}
        onOpenTauriWebviewUrl={onOpenTauriWebviewUrl}
        paneTheme={paneTheme}
        themeSignal={themeMode}
        active={active}
        onResumePane={onResumePane}
        iframeRef={paneIframeRef}
        onIframeLoad={() => {
          if (dshOrigin && pane.kind === "dsh") {
            const generation = dshWorkspaceObservationGenerationRef.current + 1;
            dshWorkspaceObservationGenerationRef.current = generation;
            setObservedDshWorkspace(undefined);
            void queryDshFrameWorkspace(paneIframeRef.current, dshOrigin)
              .then((message) => {
                if (dshWorkspaceObservationGenerationRef.current !== generation) {
                  return;
                }
                const workspace =
                  message.applied && message.sessionId && message.workDir
                    ? { sessionId: message.sessionId, workDir: message.workDir }
                    : null;
                setObservedDshWorkspace(workspace);
                onPaneDshWorkspaceObserved(
                  pane.id,
                  workspace?.sessionId ?? null,
                  workspace?.workDir ?? null,
                );
              })
              .catch(() => {
                if (dshWorkspaceObservationGenerationRef.current === generation) {
                  setObservedDshWorkspace(null);
                }
              });
            return;
          }
          if (!codeOrigin || pane.kind !== "code") {
            return;
          }
          const generation = sessionObservationGenerationRef.current + 1;
          sessionObservationGenerationRef.current = generation;
          setObservedSessionId(undefined);
          void queryWorkspaceFrameSessionId(paneIframeRef.current, codeOrigin)
            .then((sessionId) => {
              if (sessionObservationGenerationRef.current === generation) {
                setObservedSessionId(sessionId);
              }
            })
            .catch(() => {
              if (sessionObservationGenerationRef.current === generation) {
                setObservedSessionId(null);
              }
            });
        }}
        dshError={dshError}
        onRecoverDsh={onRecoverDsh}
      /> : null}
    </article>
  );
}

interface IconButtonProps {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}

function IconButton({
  label,
  active = false,
  disabled = false,
  children,
  onClick,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`workspace-grid-icon-btn${active ? " is-active" : ""}`}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) {
          return;
        }
        onClick();
      }}
    >
      {children}
    </button>
  );
}

interface PaneContentProps {
  pane: WorkspacePane;
  source: PaneSource;
  actionBusy: boolean;
  active: boolean;
  onRetry: () => void;
  onOpenLogs: () => void;
  onOpenExternalUrl: (url: string) => void;
  onOpenTauriWebviewUrl: (
    url: string,
    title: string,
    storageNamespace?: string,
  ) => void;
  paneTheme: Theme;
  themeSignal: Theme;
  onResumePane: () => void;
  iframeRef: MutableRefObject<HTMLIFrameElement | null>;
  onIframeLoad: () => void;
  dshError: string | null;
  onRecoverDsh: (workspaceDir?: string) => Promise<DshStatus | null>;
}

function PaneContent({
  pane,
  source,
  actionBusy,
  active,
  onRetry,
  onOpenLogs,
  onOpenExternalUrl,
  onOpenTauriWebviewUrl,
  paneTheme,
  themeSignal,
  onResumePane,
  iframeRef,
  onIframeLoad,
  dshError,
  onRecoverDsh,
}: PaneContentProps) {
  const embedHostRef = useRef<HTMLDivElement | null>(null);
  const embeddedControllerRef =
    useRef<EmbeddedExternalWebviewController | null>(null);
  const embeddedOpenGenerationRef = useRef(0);
  const [externalState, setExternalState] =
    useState<WorkspacePaneState>("loading");
  const [embeddedStatus, setEmbeddedStatus] = useState<
    "idle" | "opening" | "active" | "failed"
  >("idle");
  const [embeddedError, setEmbeddedError] = useState("");
  const [showDshGuide, setShowDshGuide] = useState(
    () => pane.kind === "dsh" && window.localStorage.getItem(DSH_GUIDE_ACK_KEY) !== "1",
  );
  const sourceUrl = source.url ?? "";

  useEffect(() => {
    postThemeToFrame(
      iframeRef.current,
      sourceUrl,
      paneTheme,
      pane.kind === "code" ? { surface: "kimi-code", layoutEnhancement: "v2" } : undefined,
    );
  }, [pane.kind, paneTheme, sourceUrl, themeSignal]);

  useEffect(() => {
    if (pane.kind !== "external" || !source.url) {
      return;
    }

    setExternalState("loading");
    const timer = window.setTimeout(() => {
      setExternalState((current) => (current === "ready" ? current : "blocked"));
    }, EXTERNAL_FRAME_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [pane.id, pane.kind, source.url]);

  useEffect(() => {
    setEmbeddedStatus("idle");
    setEmbeddedError("");
    return () => {
      embeddedOpenGenerationRef.current += 1;
      void closeEmbeddedController(embeddedControllerRef).catch(() => undefined);
    };
  }, [pane.id, sourceUrl]);

  useEffect(() => {
    if (
      embeddedStatus === "idle" ||
      pane.mountPolicy === "eager" ||
      (pane.mountPolicy === "on-focus" && active)
    ) {
      return;
    }

    embeddedOpenGenerationRef.current += 1;
    void closeEmbeddedController(embeddedControllerRef)
      .then(() => setEmbeddedStatus("idle"))
      .catch((error) => {
        setEmbeddedStatus("failed");
        setEmbeddedError(`嵌入式 Webview 关闭失败：${formatError(error)}`);
      });
  }, [active, embeddedStatus, pane.mountPolicy]);

  useEffect(() => {
    if (embeddedStatus !== "active") {
      return;
    }

    const host = embedHostRef.current;
    const controller = embeddedControllerRef.current;
    if (!host || !controller) {
      return;
    }

    let disposed = false;
    let frameId: number | null = null;
    let inFlight = false;
    let pending = false;
    let scheduleSync = () => undefined;

    const runSync = () => {
      const nextHost = embedHostRef.current;
      const nextController = embeddedControllerRef.current;
      if (!nextHost || !nextController) {
        return;
      }
      inFlight = true;
      void nextController
        .sync(rectToEmbeddedBounds(nextHost.getBoundingClientRect()))
        .catch((error) => {
          setEmbeddedError(`嵌入式 Webview 同步失败：${formatError(error)}`);
        })
        .finally(() => {
          inFlight = false;
          if (pending && !disposed) {
            pending = false;
            scheduleSync();
          }
        });
    };

    scheduleSync = () => {
      if (disposed || frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        if (inFlight) {
          pending = true;
          return;
        }
        runSync();
      });
    };

    scheduleSync();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleSync) : null;
    resizeObserver?.observe(host);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, true);

    return () => {
      disposed = true;
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
    };
  }, [embeddedStatus, pane.id, sourceUrl]);

  async function handleOpenEmbeddedWebview() {
    const host = embedHostRef.current;
    if (!host || !sourceUrl) {
      return;
    }

    const openGeneration = embeddedOpenGenerationRef.current + 1;
    embeddedOpenGenerationRef.current = openGeneration;
    setEmbeddedStatus("opening");
    setEmbeddedError("");

    let controller: EmbeddedExternalWebviewController | null = null;
    try {
      await closeEmbeddedController(embeddedControllerRef);
      if (embeddedOpenGenerationRef.current !== openGeneration) {
        return;
      }

      controller = await createEmbeddedExternalWebview({
        url: sourceUrl,
        title: source.title,
        bounds: rectToEmbeddedBounds(host.getBoundingClientRect()),
        storageNamespace: pane.storageNamespace,
      });
      if (embeddedOpenGenerationRef.current !== openGeneration) {
        await controller.close().catch(() => undefined);
        return;
      }

      embeddedControllerRef.current = controller;
      setExternalState("ready");
      setEmbeddedStatus("active");
    } catch (error) {
      if (embeddedOpenGenerationRef.current !== openGeneration) {
        await controller?.close().catch(() => undefined);
        return;
      }
      setEmbeddedStatus("failed");
      setEmbeddedError(`嵌入式 Webview 打开失败：${formatError(error)}`);
    }
  }

  if (!source.url) {
    return (
      <div className="workspace-empty">
        <div className="workspace-empty-copy">
          <h3>{pane.kind === "dsh" ? "DeepSeek Harness 尚未就绪" : "窗格尚未准备完成"}</h3>
          <p>{pane.kind === "dsh" ? (dshError ?? "正在等待本地 DSH 服务；可刷新状态或查看日志。") : "当前窗格没有可用地址。优先重试后端；如果依然没有恢复，再打开日志目录继续排查。"}</p>
        </div>
        <div className="workspace-empty-actions">
          <Button
            type="button"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            onClick={() => pane.kind === "dsh" ? void onRecoverDsh(pane.workDir) : onRetry()}
            disabled={actionBusy}
          >
            重试后端启动
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<FileText size={14} />}
            className="cc-action-btn"
            onClick={onOpenLogs}
          >
            打开日志目录
          </Button>
        </div>
      </div>
    );
  }

  if (
    pane.mountPolicy === "suspended" ||
    pane.mountPolicy === "manual" ||
    (pane.mountPolicy === "on-focus" && !active)
  ) {
    return (
      <div className="workspace-empty">
        <div className="workspace-empty-copy">
          <h3>{pane.mountPolicy === "suspended" ? "窗格已挂起" : "窗格待挂载"}</h3>
          <p>当前内容暂未挂载，用于减少多窗资源占用。需要查看时可以恢复。</p>
        </div>
        <div className="workspace-empty-actions">
          <Button
            type="button"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            onClick={onResumePane}
          >
            恢复窗格
          </Button>
          {pane.kind !== "dsh" ? (
            <Button
              type="button"
              variant="outline"
              icon={<ExternalLink size={14} />}
              className="cc-action-btn cc-doc-btn"
              onClick={() => onOpenExternalUrl(sourceUrl)}
            >
              在浏览器打开
            </Button>
          ) : null}
          {pane.kind === "external" ? (
            <Button
              type="button"
              variant="outline"
              icon={<Globe2 size={14} />}
              className="cc-action-btn cc-doc-btn"
              onClick={() =>
                onOpenTauriWebviewUrl(
                  sourceUrl,
                  source.title,
                  pane.storageNamespace,
                )
              }
            >
              在应用窗口打开
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const loadState = pane.kind === "external" ? externalState : source.loadState;

  return (
    <div
      ref={embedHostRef}
      className={`workspace-embed${
        embeddedStatus === "active" ? " is-native-webview" : ""
      }`}
    >
      {embeddedStatus === "active" ? (
        <div className="workspace-native-webview-host" aria-live="polite">
          <p>{source.title} 已由嵌入式 Webview 承载</p>
        </div>
      ) : (
        <>
          <iframe
            key={source.frameKey}
            ref={(node) => {
              iframeRef.current = node;
              if (source.iframeRef) {
                (source.iframeRef as MutableRefObject<HTMLIFrameElement | null>).current =
                  node;
              }
            }}
            src={source.url}
            title={source.title}
            name={source.frameName}
            className="workspace-iframe"
            allow={pane.kind === "external" ? undefined : "clipboard-write"}
            sandbox={
              pane.kind === "external"
                ? "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                : undefined
            }
            referrerPolicy={pane.kind === "external" ? "no-referrer" : undefined}
            onLoad={() => {
              postThemeToFrame(
                iframeRef.current,
                sourceUrl,
                paneTheme,
                pane.kind === "code"
                  ? { surface: "kimi-code", layoutEnhancement: "v2" }
                  : undefined,
              );
              if (pane.kind === "external") {
                setExternalState("ready");
                return;
              }
              source.onLoad();
              onIframeLoad();
            }}
            onError={source.onError}
          />

          {loadState === "loading" && (
            <div className="workspace-overlay">
              <div className="spinner" aria-hidden />
              <p className="status-line">正在加载 {source.title}…</p>
            </div>
          )}

          {pane.kind === "dsh" && showDshGuide && loadState === "ready" ? (
            <div className="workspace-overlay">
              <div className="workspace-fallback">
                <h3>DeepSeek Harness 已在本机运行</h3>
                <p>
                  在 DSH 界面中确认工作区，并在 Settings → Models 完成 DeepSeek API key 设置。凭据由 DSH 自己保存，KickSide 不会读取。
                </p>
                <div className="workspace-fallback-actions">
                  <Button
                    type="button"
                    className="cc-action-btn"
                    onClick={() => {
                      window.localStorage.setItem(DSH_GUIDE_ACK_KEY, "1");
                      setShowDshGuide(false);
                    }}
                  >
                    我知道了
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<ExternalLink size={14} />}
                    className="cc-action-btn cc-doc-btn"
                    onClick={() => onOpenExternalUrl("https://platform.deepseek.com/")}
                  >
                    打开 DeepSeek 开放平台
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {loadState === "blocked" && (
            <div className="workspace-overlay">
              <div className="workspace-fallback">
                <h3>{source.title} 暂时无法在应用内显示</h3>
                <p>
                  当前页面没有完成窗内加载。可以重试当前视图，或在应用窗口/系统浏览器打开。
                </p>
                <div className="workspace-fallback-actions">
                  <Button
                    type="button"
                    icon={<RefreshCcw size={14} />}
                    className="cc-action-btn"
                    onClick={() => pane.kind === "dsh" ? void onRecoverDsh(pane.workDir) : onRetry()}
                    disabled={actionBusy}
                  >
                    重试加载
                  </Button>
                  {pane.kind !== "dsh" ? (
                    <Button
                      type="button"
                      variant="outline"
                      icon={<ExternalLink size={14} />}
                      className="cc-action-btn cc-doc-btn"
                      onClick={() => onOpenExternalUrl(sourceUrl)}
                    >
                      在浏览器打开
                    </Button>
                  ) : null}
                  {pane.kind === "external" ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        icon={<Globe2 size={14} />}
                        className="cc-action-btn cc-doc-btn"
                        onClick={() => {
                          void handleOpenEmbeddedWebview();
                        }}
                        disabled={embeddedStatus === "opening"}
                      >
                        {embeddedStatus === "opening" ? "正在嵌入" : "在窗格内打开"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        icon={<Globe2 size={14} />}
                        className="cc-action-btn cc-doc-btn"
                        onClick={() =>
                          onOpenTauriWebviewUrl(
                            sourceUrl,
                            source.title,
                            pane.storageNamespace,
                          )
                        }
                      >
                        在应用窗口打开
                      </Button>
                    </>
                  ) : null}
                  {pane.kind === "code" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      icon={<FileText size={14} />}
                      className="cc-action-btn"
                      onClick={onOpenLogs}
                    >
                      打开日志目录
                    </Button>
                  ) : null}
                </div>
                {embeddedStatus === "failed" && embeddedError ? (
                  <p className="workspace-fallback-error">{embeddedError}</p>
                ) : null}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function isPaneContentMounted(pane: WorkspacePane, active: boolean): boolean {
  return (
    pane.mountPolicy === "eager" ||
    (pane.mountPolicy === "on-focus" && active)
  );
}

function urlOrigin(value: string | null | undefined): string {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

function rectToEmbeddedBounds(rect: DOMRect | DOMRectReadOnly): EmbeddedExternalWebviewBounds {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

async function closeEmbeddedController(
  controllerRef: MutableRefObject<EmbeddedExternalWebviewController | null>,
): Promise<void> {
  const controller = controllerRef.current;
  controllerRef.current = null;
  await controller?.close();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function postThemeToFrame(
  frame: HTMLIFrameElement | null,
  sourceUrl: string,
  theme: Theme,
  options?: {
    surface: "kimi-code";
    layoutEnhancement: "v2";
  },
): void {
  if (!frame?.contentWindow || !sourceUrl) {
    return;
  }

  try {
    const payload: {
      source: typeof THEME_SYNC_SOURCE;
      theme: Theme;
      accent?: string;
      surface?: "kimi-code";
      layoutEnhancement?: "v2";
    } = { source: THEME_SYNC_SOURCE, theme };
    if (options && isKimiLayoutEnhancementEnabled()) {
      payload.accent = readHostAccentColor();
      payload.surface = options.surface;
      payload.layoutEnhancement = options.layoutEnhancement;
    }
    frame.contentWindow.postMessage(
      payload,
      new URL(sourceUrl).origin,
    );
  } catch {
    // The iframe may still be navigating or temporarily at about:blank.
  }
}

function isKimiLayoutEnhancementEnabled(): boolean {
  try {
    return window.localStorage.getItem("kimi-web-layout-v2") !== "off";
  } catch {
    return true;
  }
}

function readHostAccentColor(): string {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  } catch {
    return "";
  }
}

interface PaneSourceInput {
  pane: WorkspacePane;
  codeRemoteUrl: string | null;
  codeFrameKey: string;
  chatRemoteUrl: string;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  workspaceBridgeNonce: string;
  chatIframeRef: RefObject<HTMLIFrameElement | null>;
  codePaneState: WorkspacePaneState;
  chatPaneState: WorkspacePaneState;
  dshStatus: DshStatus | null;
  onCodeFrameLoad: () => void;
  onCodeFrameError: () => void;
  onChatFrameLoad: () => void;
  onChatFrameError: () => void;
}

interface PaneSource {
  url: string | null;
  title: string;
  frameKey: string;
  frameName?: string;
  iframeRef?: RefObject<HTMLIFrameElement | null>;
  loadState: WorkspacePaneState;
  onLoad: () => void;
  onError: () => void;
}

function resolvePaneSource({
  pane,
  codeRemoteUrl,
  codeFrameKey,
  chatRemoteUrl,
  workspaceIframeRef,
  workspaceBridgeNonce,
  chatIframeRef,
  codePaneState,
  chatPaneState,
  dshStatus,
  onCodeFrameLoad,
  onCodeFrameError,
  onChatFrameLoad,
  onChatFrameError,
}: PaneSourceInput): PaneSource {
  if (pane.kind === "dsh") {
    const trusted = getTrustedDshRuntimeUrl(dshStatus);
    return {
      url: trusted,
      title: "DeepSeek Harness",
      frameKey: `${pane.id}:${trusted ?? dshStatus?.state ?? "stopped"}`,
      loadState:
        dshStatus?.state === "running" || dshStatus?.state === "degraded"
          ? "ready"
          : dshStatus?.state === "crashed"
            ? "blocked"
            : dshStatus?.state === "stopped"
              ? "blocked"
              : "loading",
      onLoad: () => undefined,
      onError: () => undefined,
    };
  }
  if (pane.kind === "code") {
    const sessionUrl =
      pane.sessionId && codeRemoteUrl
        ? buildCodePaneUrl(codeRemoteUrl, pane.sessionId)
        : null;
    return {
      url: sessionUrl ?? codeRemoteUrl,
      title: "KimiCode",
      frameKey: `${pane.id}:${sessionUrl ?? codeFrameKey}`,
      frameName: pane.id === "pane-code" ? workspaceBridgeNonce : undefined,
      iframeRef: pane.id === "pane-code" ? workspaceIframeRef : undefined,
      loadState: codePaneState,
      onLoad: onCodeFrameLoad,
      onError: onCodeFrameError,
    };
  }

  if (pane.kind === "chat") {
    return {
      url: chatRemoteUrl,
      title: "KimiChat",
      frameKey: `${pane.id}:${chatRemoteUrl}`,
      iframeRef: pane.id === "pane-chat" ? chatIframeRef : undefined,
      loadState: chatPaneState,
      onLoad: onChatFrameLoad,
      onError: onChatFrameError,
    };
  }

  return {
    url: pane.url ?? chatRemoteUrl,
    title: pane.title,
    frameKey: `${pane.id}:${pane.url ?? chatRemoteUrl}`,
    loadState: "loading",
    onLoad: () => undefined,
    onError: () => undefined,
  };
}
