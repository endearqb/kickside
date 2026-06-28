import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
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
  Moon,
  RefreshCcw,
  RefreshCwOff,
  Sun,
  Trash2,
} from "lucide-react";
import { THEME_SYNC_SOURCE } from "@/app/theme";
import type { Theme, WorkspacePaneState } from "@/app/types";
import { Button } from "@/components/ui/button";
import {
  createEmbeddedExternalWebview,
  type EmbeddedExternalWebviewBounds,
  type EmbeddedExternalWebviewController,
} from "@/services/externalWebviewService";
import { buildCodePaneUrl } from "./paneUrl";
import type { WorkspacePane, WorkspacePaneKind } from "./gridTypes";

const EXTERNAL_FRAME_TIMEOUT_MS = 8_000;

interface PaneFrameProps {
  pane: WorkspacePane | null;
  slotLabel: string;
  active: boolean;
  maximized: boolean;
  canAddPane: boolean;
  effectiveWorkDir?: string;
  themeMode: Theme;
  codeRemoteUrl: string | null;
  codeFrameKey: string;
  chatRemoteUrl: string;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  chatIframeRef: RefObject<HTMLIFrameElement | null>;
  codePaneState: WorkspacePaneState;
  chatPaneState: WorkspacePaneState;
  actionBusy: boolean;
  onRetry: () => void;
  onOpenLogs: () => void;
  onOpenFolder: (path: string) => void;
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
  onAddPane: (kind: WorkspacePaneKind) => void;
  onConfigurePane: (kind: WorkspacePaneKind) => void;
  onRemovePane: () => void;
  onSuspendPane: () => void;
  onResumePane: () => void;
  onPaneThemeChange: (theme: Theme) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onToggleMaximize: () => void;
}

export function PaneFrame({
  pane,
  slotLabel,
  active,
  maximized,
  canAddPane,
  effectiveWorkDir,
  themeMode,
  codeRemoteUrl,
  codeFrameKey,
  chatRemoteUrl,
  workspaceIframeRef,
  chatIframeRef,
  codePaneState,
  chatPaneState,
  actionBusy,
  onRetry,
  onOpenLogs,
  onOpenFolder,
  onOpenExternalUrl,
  onOpenTauriWebviewUrl,
  onCodeFrameLoad,
  onCodeFrameError,
  onChatFrameLoad,
  onChatFrameError,
  onActivate,
  onAddPane,
  onConfigurePane,
  onRemovePane,
  onSuspendPane,
  onResumePane,
  onPaneThemeChange,
  onDragStart,
  onDragEnd,
  onToggleMaximize,
}: PaneFrameProps) {
  if (!pane) {
    return (
      <div className="workspace-grid-pane workspace-grid-pane-empty">
        <div className="workspace-grid-empty-copy">
          <span>{slotLabel}</span>
          <strong>空窗格</strong>
        </div>
        <div className="workspace-grid-empty-actions">
          <button
            type="button"
            className="workspace-grid-empty-btn"
            onClick={() => onAddPane("code")}
            disabled={!canAddPane}
          >
            <Code2 size={14} aria-hidden />
            Code
          </button>
          <button
            type="button"
            className="workspace-grid-empty-btn"
            onClick={() => onAddPane("chat")}
            disabled={!canAddPane}
          >
            <MessageCircle size={14} aria-hidden />
            Chat
          </button>
        </div>
      </div>
    );
  }

  const source = resolvePaneSource({
    pane,
    codeRemoteUrl,
    codeFrameKey,
    chatRemoteUrl,
    workspaceIframeRef,
    chatIframeRef,
    codePaneState,
    chatPaneState,
    onCodeFrameLoad,
    onCodeFrameError,
    onChatFrameLoad,
    onChatFrameError,
  });
  const paneTheme = pane.theme ?? themeMode;
  const paneWorkDir =
    pane.kind === "code" ? pane.workDir?.trim() || effectiveWorkDir?.trim() || "" : "";
  const nextPaneTheme = paneTheme === "dark" ? "light" : "dark";

  return (
    <article
      className={`workspace-grid-pane${active ? " is-active" : ""}`}
      onFocus={onActivate}
      onPointerDown={onActivate}
    >
      <header
        className="workspace-grid-pane-header"
        draggable
        onDragStart={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) {
            event.preventDefault();
            return;
          }
          onDragStart(event);
        }}
        onDragEnd={onDragEnd}
      >
        <div className="workspace-grid-pane-title">
          {pane.kind === "code" ? <Code2 size={14} aria-hidden /> : null}
          {pane.kind === "chat" ? <MessageCircle size={14} aria-hidden /> : null}
          {pane.kind === "external" ? <Globe2 size={14} aria-hidden /> : null}
          <span>{pane.title}</span>
        </div>
        <div className="workspace-grid-pane-actions">
          {pane.kind === "code" ? (
            <IconButton
              label="打开此窗格目录"
              onClick={() => onOpenFolder(paneWorkDir)}
              disabled={!paneWorkDir}
            >
              <FolderOpen size={14} aria-hidden />
            </IconButton>
          ) : null}
          <IconButton
            label={nextPaneTheme === "dark" ? "切换此窗格为深色主题" : "切换此窗格为浅色主题"}
            onClick={() => onPaneThemeChange(nextPaneTheme)}
          >
            {paneTheme === "dark" ? (
              <Sun size={14} aria-hidden />
            ) : (
              <Moon size={14} aria-hidden />
            )}
          </IconButton>
          <IconButton
            label="切换为 Code"
            onClick={() => onConfigurePane("code")}
            active={pane.kind === "code"}
          >
            <Code2 size={14} aria-hidden />
          </IconButton>
          <IconButton
            label="切换为 Chat"
            onClick={() => onConfigurePane("chat")}
            active={pane.kind === "chat"}
          >
            <MessageCircle size={14} aria-hidden />
          </IconButton>
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
          {pane.mountPolicy === "suspended" ? (
            <IconButton label="恢复挂载" onClick={onResumePane}>
              <RefreshCcw size={14} aria-hidden />
            </IconButton>
          ) : (
            <IconButton label="挂起窗格" onClick={onSuspendPane}>
              <RefreshCwOff size={14} aria-hidden />
            </IconButton>
          )}
          <IconButton label="关闭窗格" onClick={onRemovePane}>
            <Trash2 size={14} aria-hidden />
          </IconButton>
        </div>
      </header>
      <PaneContent
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
      />
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
}: PaneContentProps) {
  const embedHostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const embeddedControllerRef =
    useRef<EmbeddedExternalWebviewController | null>(null);
  const [externalState, setExternalState] =
    useState<WorkspacePaneState>("loading");
  const [embeddedStatus, setEmbeddedStatus] = useState<
    "idle" | "opening" | "active" | "failed"
  >("idle");
  const [embeddedError, setEmbeddedError] = useState("");
  const sourceUrl = source.url ?? "";

  useEffect(() => {
    postThemeToFrame(iframeRef.current, sourceUrl, paneTheme);
  }, [paneTheme, sourceUrl, themeSignal]);

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

    const sync = () => {
      const nextHost = embedHostRef.current;
      const nextController = embeddedControllerRef.current;
      if (!nextHost || !nextController) {
        return;
      }
      void nextController
        .sync(rectToEmbeddedBounds(nextHost.getBoundingClientRect()))
        .catch((error) => {
          setEmbeddedStatus("failed");
          setEmbeddedError(`嵌入式 Webview 同步失败：${formatError(error)}`);
        });
    };

    sync();
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    resizeObserver?.observe(host);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [embeddedStatus, pane.id, sourceUrl]);

  async function handleOpenEmbeddedWebview() {
    const host = embedHostRef.current;
    if (!host || !sourceUrl) {
      return;
    }

    setEmbeddedStatus("opening");
    setEmbeddedError("");

    try {
      await closeEmbeddedController(embeddedControllerRef);
      embeddedControllerRef.current = await createEmbeddedExternalWebview({
        url: sourceUrl,
        title: source.title,
        bounds: rectToEmbeddedBounds(host.getBoundingClientRect()),
        storageNamespace: pane.storageNamespace,
      });
      setExternalState("ready");
      setEmbeddedStatus("active");
    } catch (error) {
      setEmbeddedStatus("failed");
      setEmbeddedError(`嵌入式 Webview 打开失败：${formatError(error)}`);
    }
  }

  if (!source.url) {
    return (
      <div className="workspace-empty">
        <div className="workspace-empty-copy">
          <h3>窗格尚未准备完成</h3>
          <p>当前窗格没有可用地址。优先重试后端；如果依然没有恢复，再打开日志目录继续排查。</p>
        </div>
        <div className="workspace-empty-actions">
          <Button
            type="button"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            onClick={onRetry}
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
          <Button
            type="button"
            variant="outline"
            icon={<ExternalLink size={14} />}
            className="cc-action-btn cc-doc-btn"
            onClick={() => onOpenExternalUrl(sourceUrl)}
          >
            在浏览器打开
          </Button>
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
            className="workspace-iframe"
            onLoad={() => {
              postThemeToFrame(iframeRef.current, sourceUrl, paneTheme);
              if (pane.kind === "external") {
                setExternalState("ready");
                return;
              }
              source.onLoad();
            }}
            onError={source.onError}
          />

          {loadState === "loading" && (
            <div className="workspace-overlay">
              <div className="spinner" aria-hidden />
              <p className="status-line">正在加载 {source.title}…</p>
            </div>
          )}

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
                    onClick={onRetry}
                    disabled={actionBusy}
                  >
                    重试加载
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<ExternalLink size={14} />}
                    className="cc-action-btn cc-doc-btn"
                    onClick={() => onOpenExternalUrl(sourceUrl)}
                  >
                    在浏览器打开
                  </Button>
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

function postThemeToFrame(
  frame: HTMLIFrameElement | null,
  sourceUrl: string,
  theme: Theme,
): void {
  if (!frame?.contentWindow || !sourceUrl) {
    return;
  }

  try {
    frame.contentWindow.postMessage(
      { source: THEME_SYNC_SOURCE, theme },
      new URL(sourceUrl).origin,
    );
  } catch {
    // The iframe may still be navigating or temporarily at about:blank.
  }
}

interface PaneSourceInput {
  pane: WorkspacePane;
  codeRemoteUrl: string | null;
  codeFrameKey: string;
  chatRemoteUrl: string;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  chatIframeRef: RefObject<HTMLIFrameElement | null>;
  codePaneState: WorkspacePaneState;
  chatPaneState: WorkspacePaneState;
  onCodeFrameLoad: () => void;
  onCodeFrameError: () => void;
  onChatFrameLoad: () => void;
  onChatFrameError: () => void;
}

interface PaneSource {
  url: string | null;
  title: string;
  frameKey: string;
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
  chatIframeRef,
  codePaneState,
  chatPaneState,
  onCodeFrameLoad,
  onCodeFrameError,
  onChatFrameLoad,
  onChatFrameError,
}: PaneSourceInput): PaneSource {
  if (pane.kind === "code") {
    const sessionUrl =
      pane.sessionId && codeRemoteUrl
        ? buildCodePaneUrl(codeRemoteUrl, pane.sessionId)
        : null;
    return {
      url: sessionUrl ?? codeRemoteUrl,
      title: "Kimi Code Web",
      frameKey: `${pane.id}:${sessionUrl ?? codeFrameKey}`,
      iframeRef: pane.id === "pane-code" ? workspaceIframeRef : undefined,
      loadState: codePaneState,
      onLoad: onCodeFrameLoad,
      onError: onCodeFrameError,
    };
  }

  if (pane.kind === "chat") {
    return {
      url: chatRemoteUrl,
      title: "Kimi Chat",
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
