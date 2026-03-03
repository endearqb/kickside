import type { RefObject } from "react";
import { FileText, FolderOpen, RefreshCcw } from "lucide-react";
import type { WorkspaceEmbedState } from "@/app/types";
import { IconButton } from "@/components/common/IconButton";
import { Button } from "@/components/ui/button";

type WorkspaceViewProps = {
  remoteUrl: string | null;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  workspaceEmbedState: WorkspaceEmbedState;
  actionBusy: boolean;
  onRetry: () => void;
  onOpenLogs: () => void;
  onOpenExternalUrl: (url: string) => void;
  onFrameLoad: () => void;
  onFrameError: () => void;
};

export function WorkspaceView({
  remoteUrl,
  workspaceIframeRef,
  workspaceEmbedState,
  actionBusy,
  onRetry,
  onOpenLogs,
  onOpenExternalUrl,
  onFrameLoad,
  onFrameError,
}: WorkspaceViewProps) {
  return (
    <section className="workspace-stage">
      {remoteUrl ? (
        <div className="workspace-embed">
          <iframe
            ref={workspaceIframeRef}
            key={remoteUrl}
            src={remoteUrl}
            title="Kimi Web Workspace"
            className="workspace-iframe"
            onLoad={onFrameLoad}
            onError={onFrameError}
          />

          {workspaceEmbedState === "loading" && (
            <div className="workspace-overlay">
              <div className="spinner" aria-hidden />
              <p className="status-line">Loading Kimi Web workspace...</p>
            </div>
          )}

          {workspaceEmbedState === "blocked" && (
            <div className="workspace-overlay">
              <div className="workspace-fallback">
                <h3>Embedded view is unavailable</h3>
                <p>
                  Kimi Web refused to render in the embedded frame. You can open
                  it manually in your browser.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  icon={<FileText size={14} />}
                  className="cc-action-btn cc-doc-btn"
                  onClick={() => onOpenExternalUrl(remoteUrl)}
                >
                  Open in Browser
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="workspace-empty">
          <p className="hint">Workspace URL is unavailable. Restart backend to retry.</p>
          <div className="actions">
            <IconButton
              icon={<RefreshCcw size={15} />}
              label="Restart Backend"
              onClick={onRetry}
              disabled={actionBusy}
            />
            <IconButton
              icon={<FolderOpen size={15} />}
              label="Open Logs Folder"
              onClick={onOpenLogs}
              className="ghost"
            />
          </div>
        </div>
      )}
    </section>
  );
}
