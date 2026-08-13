import { RefreshCw, X } from "lucide-react";
import type { InstallSessionSnapshot } from "@/app/types";
import { Button } from "@/components/ui/button";
import { formatInstallSessionStatus, formatInstallSessionTone } from "./InstallFlowModal";

type MacKimiUpgradePanelProps = {
  session: InstallSessionSnapshot;
  detectedKimiPath: string;
  upgradeLabel: string;
  upgradeDisabled: boolean;
  onUpgrade: () => Promise<void>;
  onCancel: () => Promise<void>;
};

export function MacKimiUpgradePanel({
  session,
  detectedKimiPath,
  upgradeLabel,
  upgradeDisabled,
  onUpgrade,
  onCancel,
}: MacKimiUpgradePanelProps) {
  const isCurrentUpgrade = session.taskId === "upgrade_kimi";
  const isBusy =
    isCurrentUpgrade &&
    (session.status === "starting" ||
      session.status === "running" ||
      session.status === "cancelling");
  const canCancel = isBusy && session.stage === "execute_step";
  const consoleText = isCurrentUpgrade
    ? session.logs
        .map((chunk) => `[${chunk.stream}] ${chunk.text}`)
        .join("\n")
        .trim() || session.message?.trim() || "正在准备升级…"
    : "开始升级后，Kimi Code 的输出会实时显示在这里。";
  const errorSummary =
    isCurrentUpgrade && session.status === "failed"
      ? session.failureSummary?.trim() || session.message?.trim()
      : "";

  return (
    <div className="cc-config-grid" aria-label="macOS Kimi Code 升级">
      {isCurrentUpgrade && session.status !== "idle" ? (
        <div
          className={`cc-install-live-state is-${formatInstallSessionTone(session.status)}`}
          role="status"
          aria-live="polite"
        >
          <span className="cc-install-live-dot" aria-hidden="true" />
          <div>
            <strong>
              {formatInstallSessionStatus(session.status)}
              {session.currentStepTitle ? ` · ${session.currentStepTitle}` : ""}
            </strong>
            {session.message ? <small>{session.message}</small> : null}
          </div>
        </div>
      ) : null}

      <dl className="cc-install-detail-list">
        <div>
          <dt>执行文件</dt>
          <dd>
            <code>{detectedKimiPath || "等待重新检测"}</code>
          </dd>
        </div>
        <div>
          <dt>升级流程</dt>
          <dd>停止受管后端 → 执行升级 → 重新检测 → 自动重启</dd>
        </div>
      </dl>

      <p className="hint">
        小助手只停止自己管理的 Kimi 后端；其他终端启动的 Kimi 实例不会被终止。
      </p>

      <div className="cc-step-secondary-actions">
        <Button
          type="button"
          icon={<RefreshCw size={15} />}
          className="cc-action-btn"
          onClick={() => void onUpgrade()}
          disabled={isBusy || upgradeDisabled}
        >
          {upgradeLabel}
        </Button>
        {canCancel ? (
          <Button
            type="button"
            variant="outline"
            icon={<X size={15} />}
            className="cc-action-btn"
            onClick={() => void onCancel()}
            disabled={session.status === "cancelling"}
          >
            取消升级
          </Button>
        ) : null}
      </div>

      {errorSummary ? (
        <p className="cc-install-inline-error" role="alert">
          {errorSummary}
        </p>
      ) : null}

      <div className="cc-mac-upgrade-console">
        <div className="cc-rail-install-terminal-head">
          <strong>升级日志</strong>
          <span>{isCurrentUpgrade ? session.status : "idle"}</span>
        </div>
        <pre role="log" aria-live="polite" aria-label="Kimi Code 升级日志">
          {consoleText}
        </pre>
      </div>
    </div>
  );
}
