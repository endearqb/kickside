import { Check, Eraser, FolderOpen, RefreshCcw, X } from "lucide-react";
import type { AppStatus } from "@/app/types";
import { IconButton } from "@/components/common/IconButton";
import { PathField } from "@/components/common/PathField";

type LoadingViewProps = {
  status: AppStatus | null;
  statusText: string;
  remoteUrl: string | null;
  actionBusy: boolean;
  workDirInput: string;
  hotkeyOwnerLabel: string;
  onWorkDirChange: (value: string) => void;
  onRetry: () => void;
  onRecoverMainWindowBoot: () => void;
  onOpenLogs: () => void;
  onQuitAppGracefully: () => void;
  onOpenExternalUrl: (url: string) => void;
  onPickWorkDir: () => void;
  onSaveWorkDirAndRestart: () => void;
  onClearWorkDir: () => void;
};

export function LoadingView({
  status,
  statusText,
  remoteUrl,
  actionBusy,
  workDirInput,
  hotkeyOwnerLabel,
  onWorkDirChange,
  onRetry,
  onRecoverMainWindowBoot,
  onOpenLogs,
  onQuitAppGracefully,
  onOpenExternalUrl,
  onPickWorkDir,
  onSaveWorkDirAndRestart,
  onClearWorkDir,
}: LoadingViewProps) {
  const startupFailed = status?.startupPhase === "failed";
  const failureDetail = status?.startupFailureDetail ?? "主界面打开失败，请重试或打开日志排查。";

  return (
    <section className="loading-view">
      <div className="block loading-main">
        {!startupFailed && <div className="spinner" aria-hidden />}
        <p className="status-line">
          {startupFailed ? "主界面启动失败" : `State: ${statusText}`}
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
              {remoteUrl}
            </button>
            .
          </p>
        )}
        <p className="hint">{hotkeyOwnerLabel}</p>
        <div className="actions">
          {startupFailed ? (
            <IconButton
              icon={<RefreshCcw size={15} />}
              label="重试打开主界面"
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
              label="退出应用"
              onClick={onQuitAppGracefully}
              className="ghost"
              disabled={actionBusy}
            />
          )}
        </div>
      </div>

      {!startupFailed && (
        <div className="block">
        <label htmlFor="work-dir">Kimi work directory</label>
        <PathField
          id="work-dir"
          value={workDirInput}
          placeholder="D:\\Projects\\your-repo"
          onChange={onWorkDirChange}
          onBrowse={onPickWorkDir}
          browseLabel="浏览"
        />
        <p className="hint">
          Effective directory: <strong>{status?.effectiveWorkDir ?? "-"}</strong>
        </p>
        <div className="actions">
          <IconButton
            icon={<Check size={15} />}
            label="Save and Restart Backend"
            onClick={onSaveWorkDirAndRestart}
            disabled={actionBusy}
          />
          <IconButton
            icon={<Eraser size={15} />}
            label="Clear and Use Default"
            onClick={onClearWorkDir}
            className="ghost"
            disabled={actionBusy}
          />
        </div>
        </div>
      )}
    </section>
  );
}
