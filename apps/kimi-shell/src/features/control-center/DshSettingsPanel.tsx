import { useEffect, useRef, useState } from "react";
import { Download, FileText, Play, RefreshCcw, Square } from "lucide-react";
import type { DshControllerModel } from "@/app/useDshController";
import { BackendBrandIcon } from "@/components/BackendBrandIcon";
import { ControlCenterSettingsRow } from "@/components/control-center/ControlCenterSettingsRow";
import { Button } from "@/components/ui/button";
import {
  getDshLogTail,
  type DshInstallStage,
  type DshPreflight,
  type DshSettings,
  type DshStatus,
} from "@/services/dshService";

type DshSettingsPanelProps = {
  dsh: DshControllerModel;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  defaultWorkspaceDir?: string | null;
};

export function DshSettingsPanel({
  dsh,
  expanded,
  onExpandedChange,
  defaultWorkspaceDir,
}: DshSettingsPanelProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [installProgress, setInstallProgress] = useState<{
    stage: DshInstallStage | "completed";
    message: string;
  } | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);
  const keepLogPinnedRef = useRef(true);
  const { settings, preflight, status, error, busy, busyAction } = dsh;
  const displayedError = error ?? panelError;

  useEffect(() => {
    if (!keepLogPinnedRef.current || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!expanded) return;
    void dsh.refresh({ preflight: "cached" });
  }, [dsh.refresh, expanded]);

  async function toggle(enabled: boolean) {
    setPanelError(null);
    await dsh.toggle(enabled);
  }

  async function install() {
    setPanelError(null);
    setLogs([]);
    keepLogPinnedRef.current = true;
    setInstallProgress({ stage: "preflight", message: "正在检测 Node.js 与 npm" });
    const nextPreflight = await dsh.install((event) => {
      if (event.type === "stage") {
        setInstallProgress({ stage: event.stage, message: event.message });
      } else if (event.type === "output") {
        setLogs((current) => [...current, event.line].slice(-160));
      } else if (event.type === "completed") {
        setInstallProgress({
          stage: "completed",
          message: `DeepSeek Harness ${event.version} 安装完成`,
        });
      } else {
        setPanelError(event.message);
      }
    });
    if (!nextPreflight) {
      setLogs(await getDshLogTail(160).catch(() => []));
    }
  }

  async function stop() {
    setPanelError(null);
    await dsh.stop();
  }

  async function start() {
    const workspaceDir = defaultWorkspaceDir?.trim();
    if (!workspaceDir) return;
    setPanelError(null);
    await dsh.start(workspaceDir);
  }

  const running =
    status?.state === "running" ||
    status?.state === "degraded" ||
    status?.state === "starting";
  const canStart =
    settings?.enabled === true &&
    preflight?.runtimeReady === true &&
    Boolean(defaultWorkspaceDir?.trim()) &&
    (status?.state === "stopped" || status?.state === "crashed");
  const statusTone = status?.state === "crashed"
    ? "danger"
    : status?.state === "running"
      ? "success"
      : status?.state === "degraded"
        ? "warning"
      : preflight?.runtimeReady
        ? "neutral"
        : "warning";

  return (
    <ControlCenterSettingsRow
      id="dsh"
      title="DeepSeek Harness"
      summary={formatSummary(settings, preflight, status)}
      statusTone={statusTone}
      icon={<BackendBrandIcon brand="dsh" size={18} />}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      className="cc-runtime-settings-row cc-dsh-settings"
      action={
        <label className="cc-dsh-toggle" title="启用后随 KickSide 启动">
          <span className="cc-toggle-field-control">
            <input
              type="checkbox"
              className="cc-switch-input"
              aria-label="启用 DeepSeek Harness"
              checked={settings?.enabled === true}
              onChange={(event) => void toggle(event.currentTarget.checked)}
              disabled={!settings || busy}
            />
            <span className="cc-switch-track" aria-hidden />
          </span>
        </label>
      }
    >
      <div className="cc-settings-detail-stack">
        <div className="cc-settings-live-row" aria-live="polite">
          {preflight?.runtimeReady
            ? `已就绪 · Node ${preflight.nodeVersion ?? "已检测"} · DSH ${preflight.installedVersion}`
            : preflight?.issues.join(" ") ?? "正在检测 Node 与 DSH 私有安装…"}
        </div>
        <p className="hint">运行状态：{formatState(status?.state)}。启用后随应用启动默认工作区。</p>
        {status?.lastError ? <p className="cc-config-error">{status.lastError}</p> : null}
        {displayedError ? (
          <p className="cc-config-error" role="alert">{displayedError}</p>
        ) : null}
        <div className="cc-step-secondary-actions">
          <Button
            type="button"
            variant="outline"
            icon={<Download size={14} />}
            className="cc-action-btn"
            disabled={busy || !preflight?.installReady}
            onClick={() => void install()}
          >
            {busyAction === "install"
              ? "安装中"
              : preflight?.installValid
                ? "重新安装固定版本"
                : "安装固定版本"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            disabled={busy}
            onClick={() => void dsh.refresh({ preflight: "force" })}
          >
            重新检测
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<FileText size={14} />}
            className="cc-action-btn"
            onClick={() => {
              setInstallProgress(null);
              void getDshLogTail().then(setLogs);
            }}
          >
            查看日志尾部
          </Button>
          {running ? (
            <Button
              type="button"
              variant="outline"
              icon={<Square size={13} />}
              className="cc-action-btn"
              disabled={busy}
              onClick={() => void stop()}
            >
              {busyAction === "stop" ? "停止中" : "停止实例"}
            </Button>
          ) : canStart ? (
            <Button
              type="button"
              variant="outline"
              icon={<Play size={13} />}
              className="cc-action-btn"
              disabled={busy}
              onClick={() => void start()}
            >
              {busyAction === "start"
                ? "启动中"
                : status?.state === "crashed"
                  ? "重试启动"
                  : "启动实例"}
            </Button>
          ) : null}
        </div>
        {installProgress ? (
          <div
            className="cc-dsh-install-progress"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {installProgress.message}
          </div>
        ) : null}
        {busyAction === "install" || logs.length > 0 ? (
          <div className="cc-dsh-install-output">
            <span className="cc-dsh-install-log-label">安装日志</span>
            <pre
              ref={logRef}
              className="cc-dsh-install-log"
              role="log"
              aria-label="DeepSeek Harness 安装日志"
              aria-live="polite"
              aria-relevant="additions text"
              aria-atomic="false"
              onScroll={(event) => {
                const target = event.currentTarget;
                keepLogPinnedRef.current =
                  target.scrollHeight - target.scrollTop - target.clientHeight < 24;
              }}
            >
              {logs.length > 0 ? logs.join("\n") : "等待安装输出…"}
            </pre>
          </div>
        ) : null}
      </div>
    </ControlCenterSettingsRow>
  );
}

function formatSummary(
  settings: DshSettings | null,
  preflight: DshPreflight | null,
  status: DshStatus | null,
) {
  if (status?.state === "running") return `运行中 · ${directoryName(status.workspaceDir)}`;
  if (status?.state === "degraded") return "运行异常 · 展开查看详情";
  if (status?.state === "starting") return "正在加载默认工作区";
  if (status?.state === "crashed") return "启动失败 · 展开查看详情";
  if (!preflight) return "展开后检测";
  if (!preflight.runtimeReady) return preflight.issues[0] ?? "尚未安装";
  return settings?.enabled ? "已启用 · 随 KickSide 启动" : "已就绪 · 当前未启用";
}

function directoryName(value?: string | null) {
  if (!value) return "默认工作区";
  return value.split(/[\\/]+/).filter(Boolean).pop() || value;
}

function formatState(state?: DshStatus["state"]) {
  if (state === "starting") return "正在启动";
  if (state === "running") return "运行中";
  if (state === "degraded") return "服务异常";
  if (state === "stopping") return "正在停止";
  if (state === "crashed") return "异常退出";
  return "已停止";
}
