import { useEffect, useRef, useState } from "react";
import { Download, FileText, Play, RefreshCcw, Square } from "lucide-react";
import type { DshControllerModel } from "@/app/useDshController";
import { BackendBrandIcon } from "@/components/BackendBrandIcon";
import { ControlCenterDescList } from "@/components/control-center/ControlCenterDescList";
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
    stage: DshInstallStage | "completed" | "failed";
    message: string;
  } | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);
  const keepLogPinnedRef = useRef(true);
  const { settings, preflight, status, updateInfo, updateError, error, busy, busyAction } = dsh;
  const displayedError = error ?? updateError ?? panelError;

  useEffect(() => {
    if (!keepLogPinnedRef.current || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    if (!expanded) return;
    void dsh.refresh({ preflight: "cached" });
    void dsh.checkUpdate(false);
  }, [dsh.checkUpdate, dsh.refresh, expanded]);

  async function toggle(enabled: boolean) {
    setPanelError(null);
    await dsh.toggle(enabled);
  }

  async function install() {
    setPanelError(null);
    setLogs([]);
    keepLogPinnedRef.current = true;
    setInstallProgress({ stage: "preflight", message: "正在检查官方最新版本与安装环境" });
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
        setInstallProgress({ stage: "failed", message: "DeepSeek Harness 安装失败" });
        setPanelError(event.message);
      }
    });
    if (!nextPreflight) {
      setInstallProgress((current) =>
        current?.stage === "failed"
          ? current
          : { stage: "failed", message: "DeepSeek Harness 安装失败" },
      );
      setLogs(await getDshLogTail(160).catch(() => []));
    }
  }

  async function update() {
    setPanelError(null);
    setLogs([]);
    keepLogPinnedRef.current = true;
    setInstallProgress({ stage: "preflight", message: "正在检查 DSH 官方最新版本" });
    const nextPreflight = await dsh.update((event) => {
      if (event.type === "stage") {
        setInstallProgress({ stage: event.stage, message: event.message });
      } else if (event.type === "output") {
        setLogs((current) => [...current, event.line].slice(-160));
      } else if (event.type === "completed") {
        setInstallProgress({
          stage: "completed",
          message: `DeepSeek Harness ${event.version} 升级完成`,
        });
      } else {
        setInstallProgress({ stage: "failed", message: "DeepSeek Harness 升级失败" });
        setPanelError(event.message);
      }
    });
    if (!nextPreflight) {
      setInstallProgress((current) =>
        current?.stage === "failed"
          ? current
          : { stage: "failed", message: "DeepSeek Harness 升级失败" },
      );
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
  const officialVersion =
    updateInfo?.officialVersion ??
    updateInfo?.upstreamVersion ??
    updateInfo?.recommendedVersion;
  const officialState = updateInfo?.officialState ?? updateInfo?.state;
  const officialUpdate =
    (updateInfo?.officialUpdateAvailable ?? updateInfo?.updateAvailable) === true &&
    updateInfo?.installedSupported !== false;
  const installNeedsRepair = preflight?.installValid === false;
  const restoresOfficialVersion =
    installNeedsRepair ||
    updateInfo?.installedSupported === false ||
    officialState === "ahead";
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
      summary={formatSummary(settings, preflight, status, officialUpdate)}
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
          {officialUpdate
            ? `发现可用更新 · ${updateInfo?.installedVersion} → ${officialVersion}`
            : preflight?.runtimeReady
            ? `${formatState(status?.state)} · Node ${preflight.nodeVersion ?? "已检测"} · DSH ${preflight.installedVersion}`
            : preflight?.issues.join(" ") ?? "正在检测 Node 与 DSH 私有安装…"}
        </div>
        {updateInfo ? (
          <ControlCenterDescList
            columns={3}
            items={[
              { label: "当前版本", value: updateInfo.installedVersion ?? "未安装" },
              { label: "官方最新", value: officialVersion ?? "正在检查" },
              { label: "升级策略", value: "用户主动 · npm latest" },
            ]}
          />
        ) : null}
        {updateInfo?.installedVersion && updateInfo.installedSupported === false ? (
          <p className="hint">当前安装低于运行基线，可恢复官方最新版。</p>
        ) : null}
        {officialState === "ahead" ? (
          <p className="hint">当前版本高于官方 latest，恢复操作会替换为官方最新版。</p>
        ) : null}
        {officialUpdate ? (
          <p className="hint">
            升级会在下载和校验完成后短暂中断 DSH 窗格；启动验证失败会尝试自动回滚。
          </p>
        ) : null}
        <p className="hint">运行状态：{formatState(status?.state)}。启用后随应用启动默认工作区。</p>
        {status?.lastError ? <p className="cc-config-error">{status.lastError}</p> : null}
        {displayedError ? (
          <p className="cc-config-error" role="alert">{displayedError}</p>
        ) : null}
        <div className="cc-step-secondary-actions">
          <Button
            type="button"
            variant={officialUpdate || restoresOfficialVersion ? "outline" : "ghost"}
            icon={<Download size={14} />}
            className="cc-action-btn"
            disabled={busy || !preflight?.installReady}
            onClick={() => void (officialUpdate ? update() : install())}
          >
            {busyAction === "install" || busyAction === "update"
              ? busyAction === "update" ? "升级中" : "安装中"
              : officialUpdate
                ? `升级到 ${officialVersion ?? preflight?.pinnedVersion}`
              : restoresOfficialVersion && preflight?.installedVersion
                ? `恢复官方最新版 ${officialVersion ?? preflight.pinnedVersion}`
                : preflight?.installValid
                  ? "重新安装官方最新版"
                  : "安装 DSH"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            disabled={busy}
            onClick={() => void dsh.checkUpdate(true)}
          >
            {busyAction === "check_update" ? "检查中" : "检查更新"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            disabled={busy}
            onClick={() => void dsh.refresh({ preflight: "force" })}
          >
            检测环境
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
        {busyAction === "install" || busyAction === "update" || logs.length > 0 ? (
          <div className="cc-dsh-install-output">
            <span className="cc-dsh-install-log-label">
              {busyAction === "update" ? "升级日志" : "安装日志"}
            </span>
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
  updateAvailable: boolean,
) {
  if (status?.state === "running") {
    return updateAvailable
      ? "运行中 · 发现可用更新"
      : `运行中 · ${directoryName(status.workspaceDir)}`;
  }
  if (status?.state === "degraded") return "错误 · 展开查看详情";
  if (status?.state === "starting") return "运行中 · 正在加载默认工作区";
  if (status?.state === "crashed") return "错误 · 展开查看详情";
  if (!preflight) return "展开后检测";
  if (!preflight.runtimeReady) return preflight.issues[0] ?? "尚未安装";
  if (updateAvailable) return "发现可用更新";
  return settings?.enabled ? "已停止 · 随 KickSide 启动" : "已停止 · 当前未启用";
}

function directoryName(value?: string | null) {
  if (!value) return "默认工作区";
  return value.split(/[\\/]+/).filter(Boolean).pop() || value;
}

function formatState(state?: DshStatus["state"]) {
  if (state === "starting") return "运行中";
  if (state === "running") return "运行中";
  if (state === "degraded") return "错误";
  if (state === "stopping") return "已停止";
  if (state === "crashed") return "错误";
  return "已停止";
}
