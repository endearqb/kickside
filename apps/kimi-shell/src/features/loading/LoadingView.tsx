import { FolderOpen, RefreshCcw, X } from "lucide-react";
import type { AppStatus } from "@/app/types";
import { IconButton } from "@/components/common/IconButton";

type LoadingViewProps = {
  status: AppStatus | null;
  statusText: string;
  remoteUrl: string | null;
  displayUrl: string | null;
  actionBusy: boolean;
  hotkeyOwnerLabel: string;
  onRetry: () => void;
  onRecoverMainWindowBoot: () => void;
  onOpenLogs: () => void;
  onQuitAppGracefully: () => void;
  onOpenExternalUrl: (url: string) => void;
};

export function LoadingView({
  status,
  statusText,
  remoteUrl,
  displayUrl,
  actionBusy,
  hotkeyOwnerLabel,
  onRetry,
  onRecoverMainWindowBoot,
  onOpenLogs,
  onQuitAppGracefully,
  onOpenExternalUrl,
}: LoadingViewProps) {
  const startupFailed = status?.startupPhase === "failed";
  const failureDetail =
    status?.startupFailureDetail ??
    "Main shell failed to open. Please retry or inspect the logs.";

  return (
    <section className="loading-view">
      <div className="block loading-main">
        {!startupFailed && <div className="spinner" aria-hidden />}
        <p className="status-line">
          {startupFailed ? "Main shell failed to open" : `State: ${statusText}`}
        </p>
        {startupFailed && <p className="hint">{failureDetail}</p>}
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
            If embedded mode is blocked, open{" "}
            <button
              type="button"
              className="inline-link-btn"
              onClick={() => onOpenExternalUrl(remoteUrl)}
            >
              {displayUrl ?? remoteUrl}
            </button>
            .
          </p>
        )}
        <p className="hint">{hotkeyOwnerLabel}</p>
        <div className="actions">
          {startupFailed ? (
            <IconButton
              icon={<RefreshCcw size={15} />}
              label="Retry opening main shell"
              onClick={onRecoverMainWindowBoot}
              disabled={actionBusy}
            />
          ) : (
            <IconButton
              icon={<RefreshCcw size={15} />}
              label="Restart Backend"
              onClick={onRetry}
              disabled={actionBusy}
            />
          )}
          <IconButton
            icon={<FolderOpen size={15} />}
            label="Open Logs Folder"
            onClick={onOpenLogs}
            className="ghost"
          />
          {startupFailed && (
            <IconButton
              icon={<X size={15} />}
              label="Quit Application"
              onClick={onQuitAppGracefully}
              className="ghost"
              disabled={actionBusy}
            />
          )}
        </div>
      </div>
    </section>
  );
}
