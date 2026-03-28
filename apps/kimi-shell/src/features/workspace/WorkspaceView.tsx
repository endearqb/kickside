import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { FileText, FolderOpen, RefreshCcw } from "lucide-react";
import { clampWorkspaceSplitRatio } from "@/app/theme";
import type {
  WorkspaceLayoutMode,
  WorkspacePaneState,
  WorkspaceSplitOrder,
  WorkspaceViewKind,
} from "@/app/types";
import { Button } from "@/components/ui/button";

type WorkspaceViewProps = {
  activeWorkspaceView: WorkspaceViewKind;
  workspaceLayoutMode: WorkspaceLayoutMode;
  workspaceSplitOrder: WorkspaceSplitOrder;
  workspaceSplitRatio: number;
  isSplitDragging: boolean;
  codeRemoteUrl: string | null;
  chatRemoteUrl: string;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  chatIframeRef: RefObject<HTMLIFrameElement | null>;
  codePaneState: WorkspacePaneState;
  chatPaneState: WorkspacePaneState;
  actionBusy: boolean;
  onRetry: () => void;
  onOpenLogs: () => void;
  onOpenExternalUrl: (url: string) => void;
  onSplitRatioChange: (nextRatio: number) => void;
  onSplitDragStateChange: (isDragging: boolean) => void;
  onCodeFrameLoad: () => void;
  onCodeFrameError: () => void;
  onChatFrameLoad: () => void;
  onChatFrameError: () => void;
};

export function WorkspaceView({
  activeWorkspaceView,
  workspaceLayoutMode,
  workspaceSplitOrder,
  workspaceSplitRatio,
  isSplitDragging,
  codeRemoteUrl,
  chatRemoteUrl,
  workspaceIframeRef,
  chatIframeRef,
  codePaneState,
  chatPaneState,
  actionBusy,
  onRetry,
  onOpenLogs,
  onOpenExternalUrl,
  onSplitRatioChange,
  onSplitDragStateChange,
  onCodeFrameLoad,
  onCodeFrameError,
  onChatFrameLoad,
  onChatFrameError,
}: WorkspaceViewProps) {
  const splitLayout = workspaceLayoutMode === "split";
  const codePanePositionClass =
    workspaceSplitOrder === "code_left"
      ? "workspace-pane-left"
      : "workspace-pane-right";
  const chatPanePositionClass =
    workspaceSplitOrder === "code_left"
      ? "workspace-pane-right"
      : "workspace-pane-left";
  const stageRef = useRef<HTMLElement | null>(null);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const pendingRatioRef = useRef<number | null>(null);
  const ratioRafRef = useRef<number | null>(null);

  const codePaneClassName = `workspace-pane workspace-pane-code ${
    splitLayout
      ? "workspace-pane-split"
      : activeWorkspaceView === "code"
        ? "workspace-pane-active"
        : "workspace-pane-inactive"
  } ${codePanePositionClass}`;
  const chatPaneClassName = `workspace-pane workspace-pane-chat ${
    splitLayout
      ? "workspace-pane-split"
      : activeWorkspaceView === "chat"
        ? "workspace-pane-active"
        : "workspace-pane-inactive"
  } ${chatPanePositionClass}`;

  const leftPaneRatio =
    workspaceSplitOrder === "code_left"
      ? workspaceSplitRatio
      : 1 - workspaceSplitRatio;
  const rightPaneRatio = 1 - leftPaneRatio;
  const workspaceStyle = splitLayout
    ? ({
        gridTemplateColumns: `minmax(0, ${leftPaneRatio * 100}%) var(--workspace-divider-size, 12px) minmax(0, ${rightPaneRatio * 100}%)`,
      } satisfies CSSProperties)
    : undefined;

  function flushPendingRatio() {
    if (ratioRafRef.current !== null) {
      window.cancelAnimationFrame(ratioRafRef.current);
      ratioRafRef.current = null;
    }
    if (pendingRatioRef.current === null) {
      return;
    }
    onSplitRatioChange(pendingRatioRef.current);
    pendingRatioRef.current = null;
  }

  function queueRatioUpdate(nextRatio: number) {
    pendingRatioRef.current = clampWorkspaceSplitRatio(nextRatio);
    if (ratioRafRef.current !== null) {
      return;
    }
    ratioRafRef.current = window.requestAnimationFrame(() => {
      ratioRafRef.current = null;
      if (pendingRatioRef.current === null) {
        return;
      }
      onSplitRatioChange(pendingRatioRef.current);
      pendingRatioRef.current = null;
    });
  }

  function updateSplitRatioFromPointer(clientX: number) {
    const stageRect = stageRef.current?.getBoundingClientRect();
    if (!stageRect || stageRect.width <= 0) {
      return;
    }

    const leftFraction = (clientX - stageRect.left) / stageRect.width;
    const nextCodeRatio =
      workspaceSplitOrder === "code_left" ? leftFraction : 1 - leftFraction;
    queueRatioUpdate(nextCodeRatio);
  }

  function finishSplitDrag() {
    dragPointerIdRef.current = null;
    flushPendingRatio();
    onSplitDragStateChange(false);
  }

  function handleDividerPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!splitLayout || event.button !== 0) {
      return;
    }

    dragPointerIdRef.current = event.pointerId;
    dividerRef.current?.setPointerCapture(event.pointerId);
    onSplitDragStateChange(true);
    updateSplitRatioFromPointer(event.clientX);
    event.preventDefault();
  }

  function handleDividerPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }
    updateSplitRatioFromPointer(event.clientX);
  }

  function handleDividerPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    dividerRef.current?.releasePointerCapture(event.pointerId);
    finishSplitDrag();
  }

  function handleDividerPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return;
    }

    finishSplitDrag();
  }

  useEffect(() => {
    return () => {
      if (ratioRafRef.current !== null) {
        window.cancelAnimationFrame(ratioRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (splitLayout) {
      return;
    }

    if (dragPointerIdRef.current !== null || isSplitDragging) {
      finishSplitDrag();
    }
  }, [isSplitDragging, splitLayout]);

  const codePane = (
    <div className={codePaneClassName}>
      {codeRemoteUrl ? (
        <div className="workspace-embed">
          <iframe
            ref={workspaceIframeRef}
            src={codeRemoteUrl}
            title="Kimi Code Web Workspace"
            className="workspace-iframe"
            onLoad={onCodeFrameLoad}
            onError={onCodeFrameError}
          />

          {codePaneState === "loading" && (
            <div className="workspace-overlay">
              <div className="spinner" aria-hidden />
              <p className="status-line">正在加载 Kimi Code Web…</p>
            </div>
          )}

          {codePaneState === "blocked" && (
            <div className="workspace-overlay">
              <div className="workspace-fallback">
                <h3>Kimi Code Web 暂时无法在应用内显示</h3>
                <p>
                  当前嵌入页面没有完成加载。先重试当前视图；如果问题持续，再查看日志或改用浏览器打开。
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
                    icon={<FileText size={14} />}
                    className="cc-action-btn cc-doc-btn"
                    onClick={() => onOpenExternalUrl(codeRemoteUrl)}
                  >
                    在浏览器打开
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<FolderOpen size={14} />}
                    className="cc-action-btn"
                    onClick={onOpenLogs}
                  >
                    打开日志目录
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="workspace-empty">
          <div className="workspace-empty-copy">
            <h3>工作区尚未准备完成</h3>
            <p>当前没有可用的工作区地址。优先重试后端启动；如果依然没有恢复，再打开日志目录继续排查。</p>
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
              icon={<FolderOpen size={14} />}
              className="cc-action-btn"
              onClick={onOpenLogs}
            >
              打开日志目录
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  const chatPane = (
    <div className={chatPaneClassName}>
      <div className="workspace-embed">
        <iframe
          ref={chatIframeRef}
          src={chatRemoteUrl}
          title="Kimi Chat"
          className="workspace-iframe"
          onLoad={onChatFrameLoad}
          onError={onChatFrameError}
        />

        {chatPaneState === "loading" && (
          <div className="workspace-overlay">
            <div className="spinner" aria-hidden />
            <p className="status-line">正在加载 Kimi Chat…</p>
          </div>
        )}

        {chatPaneState === "blocked" && (
          <div className="workspace-overlay">
            <div className="workspace-fallback">
              <h3>Kimi Chat 暂时无法在应用内显示</h3>
              <p>
                当前聊天页没有完成渲染。先重试当前视图；如果问题持续，可以改用浏览器打开，或先继续使用 Kimi Code Web。
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
                  icon={<FileText size={14} />}
                  className="cc-action-btn cc-doc-btn"
                  onClick={() => onOpenExternalUrl(chatRemoteUrl)}
                >
                  在浏览器打开
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const divider = (
    <div
      ref={dividerRef}
      className={`workspace-split-divider${isSplitDragging ? " is-dragging" : ""}`}
      role="separator"
      aria-label="Resize workspace split panes"
      aria-orientation="vertical"
      onPointerDown={handleDividerPointerDown}
      onPointerMove={handleDividerPointerMove}
      onPointerUp={handleDividerPointerUp}
      onPointerCancel={handleDividerPointerCancel}
    >
      <span className="workspace-split-divider-handle" aria-hidden />
    </div>
  );

  return (
    <section
      ref={stageRef}
      className={`workspace-stage ${
        splitLayout ? "workspace-stage-split" : "workspace-stage-single"
      }${isSplitDragging ? " workspace-stage-dragging" : ""}`}
      style={workspaceStyle}
    >
      {codePane}
      {divider}
      {chatPane}
    </section>
  );
}
