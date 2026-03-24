import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type {
  BackendState,
  InstallFlowCatalog,
  InstallSettingsView,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallSource,
  InstallTaskDefinition,
  InstallTaskId,
  PowerShellPreflightSummary,
} from "@/app/types";
import { Button } from "@/components/ui/button";

type InstallFlowTaskContentProps = {
  catalog: InstallFlowCatalog | null;
  session: InstallSessionSnapshot;
  probe: InstallProbeStatus | null;
  backendState: BackendState | null;
  installSource: InstallSource;
  installSettings: InstallSettingsView;
  installSettingsBusy: boolean;
  powershellPreflight: PowerShellPreflightSummary | null;
  onRefreshPowerShellPreflight: () => Promise<unknown>;
  onSourceChange: (source: InstallSource) => void;
  onSaveInstallSettings: (input: InstallSettingsView) => Promise<unknown>;
  onStartTask: (taskId: InstallTaskId) => Promise<void>;
  onRestartBackend: () => Promise<void>;
  restartBusy: boolean;
};

type TaskAvailability = {
  disabled: boolean;
  reason?: string;
};

type PreflightBadgeTone = "neutral" | "success" | "warning" | "danger";

export function formatInstallSessionStatus(status: InstallSessionSnapshot["status"]): string {
  switch (status) {
    case "starting":
      return "准备中";
    case "running":
      return "执行中";
    case "cancelling":
      return "取消中";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "fallback_required":
      return "需要手动处理";
    default:
      return "待开始";
  }
}

export function formatInstallSessionTone(
  status: InstallSessionSnapshot["status"],
): PreflightBadgeTone {
  switch (status) {
    case "succeeded":
      return "success";
    case "failed":
    case "fallback_required":
      return "danger";
    case "starting":
    case "running":
    case "cancelling":
      return "warning";
    default:
      return "neutral";
  }
}

export function formatInstallStage(stage: InstallSessionSnapshot["stage"]): string {
  switch (stage) {
    case "prepare":
      return "准备";
    case "execute_step":
      return "执行步骤";
    case "probe":
      return "探测";
    case "done":
      return "完成";
    default:
      return "空闲";
  }
}

function formatBackendStateLabel(state: BackendState | null): string {
  switch (state) {
    case "running":
      return "运行中";
    case "starting":
      return "启动中";
    case "stopping":
      return "停止中";
    case "crashed":
      return "异常";
    case "missing_kimi":
      return "缺少 Kimi";
    default:
      return "未启动";
  }
}

function formatInstallSourceLabel(source: InstallSource): string {
  return source === "mirror" ? "镜像源" : "官方源";
}

function getPreflightKindMeta(kind?: PowerShellPreflightSummary["kind"]): {
  label: string;
  tone: PreflightBadgeTone;
} {
  switch (kind) {
    case "ok":
      return { label: "脚本启动正常", tone: "success" };
    case "execution_policy":
      return { label: "执行策略限制", tone: "warning" };
    case "group_policy":
      return { label: "组策略限制", tone: "danger" };
    case "applocker_or_wdac":
      return { label: "安全策略限制", tone: "danger" };
    case "constrained_language":
      return { label: "受限语言模式", tone: "warning" };
    case "command_launch":
      return { label: "脚本启动失败", tone: "warning" };
    default:
      return { label: "结果未知", tone: "neutral" };
  }
}

function getExecutionPolicyTone(policy: string): PreflightBadgeTone {
  const normalized = policy.trim().toLowerCase();
  if (normalized === "bypass" || normalized === "remotesigned" || normalized === "unrestricted") {
    return "success";
  }
  if (normalized === "allsigned" || normalized === "restricted") {
    return "warning";
  }
  return "neutral";
}

function copyText(value: string) {
  return navigator.clipboard.writeText(value);
}

function linesToText(lines: string[]) {
  return lines.join("\n");
}

function textToLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function taskSteps(task: InstallTaskDefinition | undefined, source: InstallSource) {
  if (!task) return [];
  return source === "mirror" && task.mirrorSteps.length ? task.mirrorSteps : task.officialSteps;
}

function buildTaskCommands(task: InstallTaskDefinition | undefined, source: InstallSource) {
  return taskSteps(task, source)
    .map(
      (step, index) =>
        `# ${index + 1}. ${step.title}\n# ${step.description}\n${step.command.trim()}`,
    )
    .join("\n\n")
    .trim();
}

function statusLabel(value?: boolean) {
  if (value === true) return "已就绪";
  if (value === false) return "缺失";
  return "-";
}

function getTaskAvailability(
  taskId: InstallTaskId,
  probe: InstallProbeStatus | null,
  isBusy: boolean,
): TaskAvailability {
  if (isBusy) {
    return { disabled: true, reason: "任务执行中" };
  }
  if (!probe) {
    return { disabled: true, reason: "等待环境检测" };
  }

  switch (taskId) {
    case "quick_install_core":
      return probe.coreReady
        ? { disabled: true, reason: "基础环境已就绪" }
        : { disabled: false };
    case "install_uv":
      return probe.uvReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_python313":
      return probe.python313Ready ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_kimi":
      return probe.kimiReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "upgrade_kimi":
      return probe.kimiReady
        ? { disabled: false }
        : { disabled: true, reason: "需先安装 Kimi CLI" };
    case "install_git":
      return probe.gitReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_nodejs":
      return probe.nodeReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    default:
      return { disabled: false };
  }
}

function buildLogsText(session: InstallSessionSnapshot) {
  const lines: string[] = [];

  const pushUnique = (value?: string) => {
    const trimmed = value?.trim();
    if (!trimmed || lines.includes(trimmed)) {
      return;
    }
    lines.push(trimmed);
  };

  if (session.status === "failed" && session.failureSummary) {
    pushUnique(`[failure] ${session.failureSummary}`);
  }

  if (!session.logs.length) {
    if (session.lastStderr) {
      pushUnique(`[stderr] ${session.lastStderr}`);
    }
    if (session.lastStdout) {
      pushUnique(`[stdout] ${session.lastStdout}`);
    }
  }

  for (const chunk of session.logs) {
    pushUnique(`[${chunk.stream}] ${chunk.text}`);
  }

  return lines.join("\n");
}

export function InstallFlowTaskContent({
  catalog,
  session,
  probe,
  backendState,
  installSource,
  installSettings,
  installSettingsBusy,
  powershellPreflight,
  onRefreshPowerShellPreflight,
  onSourceChange,
  onSaveInstallSettings,
  onStartTask,
  onRestartBackend,
  restartBusy,
}: InstallFlowTaskContentProps) {
  const consoleRef = useRef<HTMLPreElement | null>(null);
  const [mirrorDraft, setMirrorDraft] = useState<InstallSettingsView>(installSettings);
  const activeTask = useMemo(
    () => catalog?.tasks.find((task) => task.id === session.taskId),
    [catalog, session.taskId],
  );
  const isBusy =
    session.status === "starting" ||
    session.status === "running" ||
    session.status === "cancelling";
  const coreTasks = catalog?.tasks.filter((task) => task.group === "core") ?? [];
  const optionalTasks = catalog?.tasks.filter((task) => task.group === "optional") ?? [];
  const upgradeTasks = catalog?.tasks.filter((task) => task.group === "upgrade") ?? [];
  const currentStepCommand =
    taskSteps(activeTask, installSource).find((step) => step.id === session.currentStepId)
      ?.command ?? "";
  const fullTaskCommands = buildTaskCommands(activeTask, installSource);
  const logsText = buildLogsText(session);
  const activePreflight = session.powershellDiagnostic ?? powershellPreflight;
  const preflightKindMeta = getPreflightKindMeta(activePreflight?.kind);
  const sessionStatusLabel = formatInstallSessionStatus(session.status);
  const sessionTone = formatInstallSessionTone(session.status);
  const sessionStageLabel = formatInstallStage(session.stage);
  const showRestartAction =
    session.taskId === "upgrade_kimi" &&
    !isBusy &&
    session.status !== "idle" &&
    backendState !== "running" &&
    backendState !== "starting";
  const restartHint = showRestartAction
    ? session.status === "succeeded"
      ? "升级前已停止应用后端以释放 kimi.exe。升级完成后请点击重启后端。"
      : "升级前已停止应用后端以释放 kimi.exe。如需恢复使用，请点击重启后端。"
    : "";
  const failureSummary =
    session.status === "failed" ? session.failureSummary?.trim() || session.message?.trim() : "";
  const overviewMessage =
    failureSummary ||
    restartHint ||
    session.message?.trim() ||
    activeTask?.description ||
    "先完成环境检测，再选择基础安装或升级任务。";

  useEffect(() => {
    setMirrorDraft(installSettings);
  }, [installSettings]);

  useEffect(() => {
    const node = consoleRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [session.logs.length, failureSummary, restartHint]);

  const renderTaskButton = (
    task: InstallTaskDefinition,
    variant: "default" | "outline" | "ghost",
  ) => {
    const availability = getTaskAvailability(task.id, probe, isBusy);
    return (
      <div key={task.id} className="cc-install-task-item">
        <Button
          type="button"
          variant={variant}
          className="cc-action-btn"
          onClick={() => void onStartTask(task.id)}
          disabled={availability.disabled}
          title={availability.reason}
        >
          {task.title}
        </Button>
        <p className="hint cc-install-task-hint">{availability.reason ?? " "}</p>
      </div>
    );
  };

  const renderMirrorTextarea = (
    label: string,
    value: string[],
    onChange: (next: string) => void,
  ) => (
    <label className="cc-install-mirror-field">
      <span>{label}</span>
      <textarea
        className="cc-install-mirror-textarea"
        value={linesToText(value)}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        disabled={installSettingsBusy || isBusy}
      />
    </label>
  );

  return (
    <>
      <section className="cc-install-overview">
        <div className="cc-install-overview-head">
          <div className="cc-install-overview-copy">
            <span className={`cc-status-badge tone-${sessionTone}`}>
              {sessionStatusLabel}
            </span>
            <h4>{session.title ?? "当前没有安装任务"}</h4>
            <p>{overviewMessage}</p>
          </div>
          <div className="cc-install-overview-actions">
            {showRestartAction ? (
              <Button
                type="button"
                icon={<RefreshCw size={14} />}
                className="cc-action-btn"
                onClick={() => void onRestartBackend()}
                disabled={restartBusy}
              >
                重启后端
              </Button>
            ) : null}
            <div className="cc-install-flow-source" role="group" aria-label="安装来源">
              <button
                type="button"
                className={`cc-source-switch-btn ${installSource === "official" ? "active" : ""}`}
                onClick={() => onSourceChange("official")}
                disabled={isBusy}
              >
                官方源
              </button>
              <button
                type="button"
                className={`cc-source-switch-btn ${installSource === "mirror" ? "active" : ""}`}
                onClick={() => onSourceChange("mirror")}
                disabled={isBusy}
              >
                镜像源
              </button>
            </div>
          </div>
        </div>
        <div className="cc-install-overview-grid">
          <article className="cc-install-overview-card">
            <span>当前阶段</span>
            <strong>{sessionStageLabel}</strong>
            <small>{session.currentStepTitle ?? "等待选择任务"}</small>
          </article>
          <article className="cc-install-overview-card">
            <span>后端状态</span>
            <strong>{formatBackendStateLabel(backendState)}</strong>
            <small>{showRestartAction ? "升级后需恢复后端" : "用于判断是否需要恢复运行环境"}</small>
          </article>
          <article className="cc-install-overview-card">
            <span>当前来源</span>
            <strong>{formatInstallSourceLabel(installSource)}</strong>
            <small>{installSource === "mirror" ? "适合国内网络环境" : "优先使用官方地址"}</small>
          </article>
          <article className="cc-install-overview-card">
            <span>当前任务</span>
            <strong>{activeTask?.title ?? "尚未开始"}</strong>
            <small>{activeTask?.description ?? "可先从基础安装开始"}</small>
          </article>
        </div>
      </section>
      <section className="cc-install-flow-section">
          <div className="cc-install-console-head">
            <div>
              <h4>PowerShell 预检</h4>
              <p>使用摘要标签展示脚本启动限制与语言模式。</p>
            </div>
            <div className="cc-install-flow-actions">
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw size={14} />}
                className="cc-action-btn"
                onClick={() => void onRefreshPowerShellPreflight()}
              >
                重新预检
              </Button>
            </div>
          </div>
          <div className="cc-install-preflight-tags" aria-label="PowerShell 预检摘要">
            <span className={`cc-install-preflight-tag is-${preflightKindMeta.tone}`}>
              诊断: {preflightKindMeta.label}
            </span>
            <span
              className={`cc-install-preflight-tag is-${activePreflight?.smokeTestOk ? "success" : "warning"}`}
            >
              启动探测: {activePreflight?.smokeTestOk ? "通过" : "未通过"}
            </span>
            <span className="cc-install-preflight-tag is-neutral">
              语言模式: {activePreflight?.languageMode ?? "未知"}
            </span>
            {(activePreflight?.executionPolicies ?? []).map((item) => (
              <span
                key={`${item.scope}-${item.policy}`}
                className={`cc-install-preflight-tag is-${getExecutionPolicyTone(item.policy)}`}
              >
                {item.scope}: {item.policy}
              </span>
            ))}
            {activePreflight?.suggestedFix ? (
              <span className="cc-install-preflight-tag is-warning cc-install-preflight-tag-code">
                建议: <code>{activePreflight.suggestedFix}</code>
              </span>
            ) : null}
          </div>
      </section>

      <section className="cc-install-flow-section">
          <h4>环境状态</h4>
          <div className="cc-install-status-grid">
            <span>winget: {statusLabel(probe?.wingetReady)}</span>
            <span>uv: {statusLabel(probe?.uvReady)}</span>
            <span>Python 3.13: {statusLabel(probe?.python313Ready)}</span>
            <span>Kimi CLI: {statusLabel(probe?.kimiReady)}</span>
            <span>Git: {statusLabel(probe?.gitReady)}</span>
            <span>Node.js: {statusLabel(probe?.nodeReady)}</span>
            <span>基础环境: {statusLabel(probe?.coreReady)}</span>
          </div>
      </section>

      {installSource === "mirror" ? (
        <section className="cc-install-flow-section">
            <div className="cc-install-console-head">
              <div>
                <h4>镜像策略</h4>
                <p>先选预设来源，再按需填写自定义 HTTPS 地址。</p>
              </div>
              <div className="cc-install-flow-actions">
                <Button
                  type="button"
                  variant="outline"
                  className="cc-action-btn"
                  onClick={() => void onSaveInstallSettings(mirrorDraft)}
                  disabled={installSettingsBusy || isBusy}
                >
                  保存来源策略
                </Button>
              </div>
            </div>
            <label className="cc-install-mirror-field">
              <span>镜像预设</span>
              <select
                className="cc-install-mirror-select"
                value={mirrorDraft.mirrorPreset}
                onChange={(event) =>
                  setMirrorDraft((current) => ({
                    ...current,
                    mirrorPreset: event.target.value as InstallSettingsView["mirrorPreset"],
                    preferredSource: "mirror",
                  }))
                }
                disabled={installSettingsBusy || isBusy}
              >
                <option value="mixed">清华后阿里</option>
                <option value="tuna">仅清华</option>
                <option value="aliyun">仅阿里</option>
                <option value="custom">自定义</option>
              </select>
            </label>
            {mirrorDraft.mirrorPreset === "custom" ? (
              <div className="cc-install-mirror-config-card">
                <div className="cc-install-mirror-grid">
                {renderMirrorTextarea("Git 发布页", mirrorDraft.customMirrorConfig.gitReleasePages, (next) =>
                  setMirrorDraft((current) => ({
                    ...current,
                    customMirrorConfig: {
                      ...current.customMirrorConfig,
                      gitReleasePages: textToLines(next),
                    },
                  }))
                )}
                {renderMirrorTextarea("uv 发布页", mirrorDraft.customMirrorConfig.uvReleasePages, (next) =>
                  setMirrorDraft((current) => ({
                    ...current,
                    customMirrorConfig: {
                      ...current.customMirrorConfig,
                      uvReleasePages: textToLines(next),
                    },
                  }))
                )}
                {renderMirrorTextarea(
                  "Python 安装器",
                  mirrorDraft.customMirrorConfig.pythonInstallerUrls,
                  (next) =>
                    setMirrorDraft((current) => ({
                      ...current,
                      customMirrorConfig: {
                        ...current.customMirrorConfig,
                        pythonInstallerUrls: textToLines(next),
                      },
                    }))
                )}
                {renderMirrorTextarea("PyPI 索引", mirrorDraft.customMirrorConfig.pypiIndexUrls, (next) =>
                  setMirrorDraft((current) => ({
                    ...current,
                    customMirrorConfig: {
                      ...current.customMirrorConfig,
                      pypiIndexUrls: textToLines(next),
                    },
                  }))
                )}
                </div>
              </div>
            ) : (
              <p className="hint">当前使用内置预设镜像列表；切到“自定义”后可编辑具体 URL。</p>
            )}
        </section>
      ) : null}

      <section className="cc-install-flow-section">
          <h4>基础安装</h4>
          <div className="cc-install-task-list">
            {coreTasks.map((task) => renderTaskButton(task, task.recommended ? "default" : "outline"))}
          </div>
      </section>

      <section className="cc-install-flow-section">
          <h4>升级与可选增强</h4>
          <div className="cc-install-task-list">
            {upgradeTasks.map((task) => renderTaskButton(task, "outline"))}
            {optionalTasks.map((task) => renderTaskButton(task, "ghost"))}
          </div>
          {optionalTasks.length ? (
            <p className="hint">Git / Node.js 为可选增强项，可能需要管理员权限。</p>
          ) : null}
      </section>

      <section className="cc-install-flow-section">
          <div className="cc-install-console-head">
            <div>
              <h4>控制台</h4>
              <p>
                {session.title ?? "当前没有安装任务"} · {sessionStatusLabel} · {sessionStageLabel}
              </p>
            </div>
            <div className="cc-install-console-toolbar">
              <Button
                type="button"
                variant="ghost"
                icon={<Copy size={14} />}
                className="cc-action-btn"
                onClick={() => void copyText(currentStepCommand)}
                disabled={!currentStepCommand}
              >
                复制当前步骤
              </Button>
              <Button
                type="button"
                variant="ghost"
                icon={<Copy size={14} />}
                className="cc-action-btn"
                onClick={() => void copyText(fullTaskCommands)}
                disabled={!fullTaskCommands}
              >
                复制任务命令
              </Button>
              <Button
                type="button"
                variant="ghost"
                icon={<Copy size={14} />}
                className="cc-action-btn"
                onClick={() => void copyText(logsText)}
                disabled={!logsText}
              >
                复制日志
              </Button>
            </div>
          </div>
          {failureSummary ? <p className="hint cc-install-error-summary">{failureSummary}</p> : null}
          {restartHint ? <p className="hint">{restartHint}</p> : null}
          <div className="cc-install-console-summary-grid">
            <article className="cc-install-console-summary-card">
              <span>当前步骤</span>
              <strong>{session.currentStepTitle ?? "暂无"}</strong>
            </article>
            <article className="cc-install-console-summary-card">
              <span>日志状态</span>
              <strong>{logsText ? "已有输出" : "等待输出"}</strong>
            </article>
            <article className="cc-install-console-summary-card">
              <span>回退原因</span>
              <strong>{session.fallbackReason ? "需要处理" : "无"}</strong>
            </article>
          </div>
          <pre ref={consoleRef} className="cc-install-console">
            {logsText || session.message || "还没有采集到输出日志。"}
          </pre>
          {session.fallbackReason ? <p className="hint">{session.fallbackReason}</p> : null}
      </section>
    </>
  );
}
