import { useEffect, useState } from "react";
import { Download, FileText, Play, RefreshCcw, Square } from "lucide-react";
import { BackendBrandIcon } from "@/components/BackendBrandIcon";
import { ControlCenterSettingsRow } from "@/components/control-center/ControlCenterSettingsRow";
import { Button } from "@/components/ui/button";
import {
  getDshLogTail,
  getDshPreflight,
  getDshSettings,
  getDshStatus,
  installDsh,
  saveDshSettings,
  startDsh,
  stopDsh,
  type DshPreflight,
  type DshSettings,
  type DshStatus,
} from "@/services/dshService";

type DshSettingsPanelProps = {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  defaultWorkspaceDir?: string | null;
};

export function DshSettingsPanel({
  expanded,
  onExpandedChange,
  defaultWorkspaceDir,
}: DshSettingsPanelProps) {
  const [settings, setSettings] = useState<DshSettings | null>(null);
  const [preflight, setPreflight] = useState<DshPreflight | null>(null);
  const [status, setStatus] = useState<DshStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<
    "toggle" | "install" | "start" | "stop" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const busy = busyAction !== null;

  async function refresh() {
    setError(null);
    try {
      const [nextSettings, nextPreflight, nextStatus] = await Promise.all([
        getDshSettings(),
        getDshPreflight(),
        getDshStatus(),
      ]);
      setSettings(nextSettings);
      setPreflight(nextPreflight);
      setStatus(nextStatus);
    } catch (cause) {
      setError(formatError(cause));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!settings?.enabled) return;
    const timer = window.setInterval(() => {
      void getDshStatus()
        .then(setStatus)
        .catch((cause) => setError(formatError(cause)));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [settings?.enabled]);

  async function toggle(enabled: boolean) {
    if (!settings) return;
    setBusyAction("toggle");
    setError(null);
    try {
      setSettings(
        await saveDshSettings({
          enabled,
          portRange: settings.portRange,
          startTimeoutSec: settings.startTimeoutSec,
        }),
      );
      setStatus(await getDshStatus());
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyAction(null);
    }
  }

  async function install() {
    setBusyAction("install");
    setError(null);
    try {
      setPreflight(await installDsh());
      setStatus(await getDshStatus());
    } catch (cause) {
      setError(formatError(cause));
      setLogs(await getDshLogTail().catch(() => []));
    } finally {
      setBusyAction(null);
    }
  }

  async function stop() {
    setBusyAction("stop");
    setError(null);
    try {
      setStatus(await stopDsh());
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyAction(null);
    }
  }

  async function start() {
    const workspaceDir = defaultWorkspaceDir?.trim();
    if (!workspaceDir) return;
    setBusyAction("start");
    setError(null);
    try {
      setStatus(await startDsh(workspaceDir));
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      setBusyAction(null);
    }
  }

  const running =
    status?.state === "running" ||
    status?.state === "degraded" ||
    status?.state === "starting";
  const canStart =
    settings?.enabled === true &&
    preflight?.ready === true &&
    Boolean(defaultWorkspaceDir?.trim()) &&
    (status?.state === "stopped" || status?.state === "crashed");
  const statusTone = status?.state === "crashed"
    ? "danger"
    : status?.state === "running"
      ? "success"
      : status?.state === "degraded"
        ? "warning"
      : preflight?.ready
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
          {preflight?.ready
            ? `已就绪 · Node ${preflight.nodeVersion ?? "已检测"} · DSH ${preflight.installedVersion}`
            : preflight?.issues.join(" ") ?? "正在检测 Node 与 DSH 私有安装…"}
        </div>
        <p className="hint">
          运行状态：{formatState(status?.state)}。启用后随 KickSide 启动，并自动加载默认工作区。API key 与工作区权限仍由 DSH 自身界面管理。
        </p>
        {status?.lastError ? <p className="cc-config-error">{status.lastError}</p> : null}
        {error ? <p className="cc-config-error">{error}</p> : null}
        <div className="cc-step-secondary-actions">
          <Button
            type="button"
            variant="outline"
            icon={<Download size={14} />}
            className="cc-action-btn"
            disabled={busy || !preflight?.npmPath}
            onClick={() => void install()}
          >
            {busyAction === "install"
              ? "安装中"
              : preflight?.ready
                ? "重新安装固定版本"
                : "安装固定版本"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            disabled={busy}
            onClick={() => void refresh()}
          >
            重新检测
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<FileText size={14} />}
            className="cc-action-btn"
            onClick={() => void getDshLogTail().then(setLogs)}
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
        {logs.length > 0 ? <pre className="cc-app-update-notes">{logs.join("\n")}</pre> : null}
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
  if (!preflight) return "正在检测";
  if (!preflight.ready) return preflight.issues[0] ?? "尚未安装";
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

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
