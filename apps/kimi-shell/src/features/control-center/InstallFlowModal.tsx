import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import type {
  BackendState,
  InstallFlowCatalog,
  InstallMirrorHealthCategory,
  InstallMirrorHealthReport,
  InstallSettingsView,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallSource,
  InstallTaskDefinition,
  InstallTaskId,
  PowerShellPreflightSummary,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";

type InstallFlowTaskContentProps = {
  catalog: InstallFlowCatalog | null;
  session: InstallSessionSnapshot;
  probe: InstallProbeStatus | null;
  backendState: BackendState | null;
  installSource: InstallSource;
  installSettings: InstallSettingsView;
  installSettingsBusy: boolean;
  installMirrorHealthReport: InstallMirrorHealthReport | null;
  installMirrorHealthBusy: boolean;
  powershellPreflight: PowerShellPreflightSummary | null;
  kimiPathInput: string;
  detectedKimiPath: string;
  onRefreshPowerShellPreflight: () => Promise<unknown>;
  onRefreshMirrorHealth: (input?: InstallSettingsView) => Promise<unknown>;
  onSourceChange: (source: InstallSource) => void;
  onSaveInstallSettings: (input: InstallSettingsView) => Promise<unknown>;
  onStartTask: (taskId: InstallTaskId) => Promise<void>;
  onRestartBackend: () => Promise<void>;
  onPickKimiPath: () => Promise<unknown>;
  onSavePathAndRetry: () => Promise<unknown>;
  restartBusy: boolean;
};

type TaskAvailability = {
  disabled: boolean;
  reason?: string;
};

type PreflightBadgeTone = "neutral" | "success" | "warning" | "danger";

type MirrorHealthSummary = {
  total: number;
  healthy: number;
};

const MIRROR_CATEGORY_ORDER: InstallMirrorHealthCategory[] = [
  "git_release_page",
  "uv_release_page",
  "python_installer",
  "pypi_index",
];

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

function formatMirrorPresetLabel(preset: InstallSettingsView["mirrorPreset"]) {
  switch (preset) {
    case "mixed":
      return "综合回退";
    case "tuna":
      return "清华优先";
    case "ustc":
      return "中科大优先";
    case "aliyun":
      return "综合回退";
    case "custom":
      return "自定义";
    default:
      return "综合回退";
  }
}

function formatMirrorCategoryLabel(category: InstallMirrorHealthCategory) {
  switch (category) {
    case "git_release_page":
      return "Git";
    case "uv_release_page":
      return "uv";
    case "python_installer":
      return "Python";
    case "pypi_index":
      return "PyPI";
    default:
      return category;
  }
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
    case "uninstall_kimi":
      return probe.kimiReady
        ? { disabled: false }
        : { disabled: true, reason: "当前未安装 Kimi CLI" };
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

function summarizeMirrorHealth(report: InstallMirrorHealthReport | null): MirrorHealthSummary {
  const entries = report?.entries ?? [];
  return {
    total: entries.length,
    healthy: entries.filter((entry) => entry.healthy).length,
  };
}

function formatSourceSummary(
  source: InstallSource,
  healthSummary: MirrorHealthSummary,
  healthBusy: boolean,
) {
  const prefix = source === "mirror" ? "镜像安装" : "官方优先";
  if (healthBusy && healthSummary.total === 0) {
    return `${prefix}；镜像检测中`;
  }
  if (!healthSummary.total) {
    return `${prefix}；尚未检测镜像`;
  }
  return `${prefix}；镜像健康 ${healthSummary.healthy}/${healthSummary.total}`;
}

function formatHealthDetail(detail: string) {
  return detail.trim() || "未返回更多信息";
}

export function InstallFlowTaskContent({
  catalog,
  session,
  probe,
  backendState,
  installSource,
  installSettings,
  installSettingsBusy,
  installMirrorHealthReport,
  installMirrorHealthBusy,
  powershellPreflight,
  kimiPathInput,
  detectedKimiPath,
  onRefreshPowerShellPreflight,
  onRefreshMirrorHealth,
  onSourceChange,
  onSaveInstallSettings,
  onStartTask,
  onRestartBackend,
  onPickKimiPath,
  onSavePathAndRetry,
  restartBusy,
}: InstallFlowTaskContentProps) {
  const consoleRef = useRef<HTMLPreElement | null>(null);
  const [mirrorDraft, setMirrorDraft] = useState<InstallSettingsView>(installSettings);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
  const activeTask = useMemo(
    () => catalog?.tasks.find((task) => task.id === session.taskId),
    [catalog, session.taskId],
  );
  const isBusy =
    session.status === "starting" ||
    session.status === "running" ||
    session.status === "cancelling";
  const primaryTaskId: InstallTaskId = probe?.kimiReady ? "upgrade_kimi" : "quick_install_core";
  const primaryTask = catalog?.tasks.find((task) => task.id === primaryTaskId);
  const quickInstallAvailability = getTaskAvailability("quick_install_core", probe, isBusy);
  const upgradeAvailability = getTaskAvailability("upgrade_kimi", probe, isBusy);
  const installGitAvailability = getTaskAvailability("install_git", probe, isBusy);
  const installNodejsAvailability = getTaskAvailability("install_nodejs", probe, isBusy);
  const uninstallAvailability = getTaskAvailability("uninstall_kimi", probe, isBusy);
  const activeTaskForCommands = activeTask ?? primaryTask;
  const currentStepCommand =
    taskSteps(activeTaskForCommands, installSource).find((step) => step.id === session.currentStepId)
      ?.command ?? "";
  const fullTaskCommands = buildTaskCommands(activeTaskForCommands, installSource);
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
  const failureSummary =
    session.status === "failed" ? session.failureSummary?.trim() || session.message?.trim() : "";
  const blockingMessages = [
    !probe ? "等待环境检测完成后再执行操作。" : "",
    activePreflight && !activePreflight.smokeTestOk
      ? "PowerShell 预检未通过，建议先处理执行策略。"
      : "",
    !probe?.kimiReady && kimiPathInput.trim()
      ? "已填写本地 Kimi 路径，点击“保存路径并重试”后重新探测。"
      : "",
    session.fallbackReason?.trim() || "",
    failureSummary,
  ].filter(Boolean);
  const mirrorHealthSummary = summarizeMirrorHealth(installMirrorHealthReport);
  const groupedMirrorHealth = useMemo(() => {
    const reportEntries = installMirrorHealthReport?.entries ?? [];
    return MIRROR_CATEGORY_ORDER.map((category) => ({
      category,
      entries: reportEntries.filter((entry) => entry.category === category),
    }));
  }, [installMirrorHealthReport]);

  useEffect(() => {
    setMirrorDraft(installSettings);
  }, [installSettings]);

  useEffect(() => {
    if ((activePreflight && !activePreflight.smokeTestOk) || kimiPathInput.trim()) {
      setAdvancedOpen(true);
    }
  }, [activePreflight, kimiPathInput]);

  useEffect(() => {
    const node = consoleRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [session.logs.length, session.message, failureSummary, logsText]);

  useEffect(() => {
    if (session.taskId === "uninstall_kimi" && session.status !== "idle") {
      setUninstallConfirmOpen(false);
    }
  }, [session.taskId, session.status]);

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
            <ControlCenterStatusBadge tone={sessionTone}>{sessionStatusLabel}</ControlCenterStatusBadge>
            <h4>安装 / 管理 Kimi CLI</h4>
            <p>{session.message?.trim() || "先看状态，再执行安装、升级或卸载。"}</p>
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
            <small>{showRestartAction ? "升级完成后需手动恢复后端" : "用于判断是否需要恢复运行环境"}</small>
          </article>
          <article className="cc-install-overview-card">
            <span>当前来源</span>
            <strong>{formatInstallSourceLabel(installSource)}</strong>
            <small>{formatSourceSummary(installSource, mirrorHealthSummary, installMirrorHealthBusy)}</small>
          </article>
          <article className="cc-install-overview-card">
            <span>Kimi CLI</span>
            <strong>{statusLabel(probe?.kimiReady)}</strong>
            <small>{detectedKimiPath || "尚未探测到可用路径"}</small>
          </article>
        </div>

        {blockingMessages.length ? (
          <ul className="cc-install-blocker-list">
            {blockingMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="cc-install-flow-section">
        <div className="cc-install-console-head">
          <div>
            <h4>主操作区</h4>
            <p>保留安装、升级、卸载和详细选项入口。</p>
          </div>
          <div className="cc-install-primary-action-groups">
            <div className="cc-install-primary-action-stack">
              <div className="cc-install-flow-actions">
                <Button
                  type="button"
                  className="cc-action-btn"
                  onClick={() => void onStartTask("quick_install_core")}
                  disabled={quickInstallAvailability.disabled}
                  title={quickInstallAvailability.reason}
                >
                  一键安装 Kimi CLI
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="cc-action-btn"
                  onClick={() => void onStartTask("upgrade_kimi")}
                  disabled={upgradeAvailability.disabled}
                  title={upgradeAvailability.reason}
                >
                  升级 Kimi
                </Button>
              </div>
              <div className="cc-install-flow-actions cc-install-secondary-task-actions">
                <Button
                  type="button"
                  variant="outline"
                  className="cc-action-btn"
                  onClick={() => void onStartTask("install_git")}
                  disabled={installGitAvailability.disabled}
                  title={installGitAvailability.reason}
                >
                  安装 Git
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="cc-action-btn"
                  onClick={() => void onStartTask("install_nodejs")}
                  disabled={installNodejsAvailability.disabled}
                  title={installNodejsAvailability.reason}
                >
                  安装 Node.js
                </Button>
              </div>
            </div>
            <div className="cc-install-flow-actions cc-install-danger-actions">
              <Button
                type="button"
                variant="destructive"
                className="cc-action-btn"
                onClick={() => setUninstallConfirmOpen(true)}
                disabled={uninstallAvailability.disabled}
                title={uninstallAvailability.reason}
              >
                卸载 Kimi CLI
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="cc-action-btn"
                onClick={() => setAdvancedOpen((current) => !current)}
                aria-expanded={advancedOpen}
              >
                {advancedOpen ? "收起详细选项" : "打开详细选项"}
              </Button>
            </div>
          </div>
        </div>

        {advancedOpen ? (
          <div className="cc-install-advanced-panel">
            <div className="cc-install-mirror-config-card">
              <div className="cc-install-console-head">
                <div>
                  <h4>安装来源</h4>
                  <p>切换官方源或镜像源。</p>
                </div>
              </div>
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

            {installSource === "mirror" ? (
            <div className="cc-install-mirror-config-card">
              <div className="cc-install-console-head">
                <div>
                  <h4>镜像策略</h4>
                  <p>当前预设：{formatMirrorPresetLabel(mirrorDraft.mirrorPreset)}</p>
                </div>
                <div className="cc-install-flow-actions">
                  <Button
                    type="button"
                    variant="outline"
                    icon={<RefreshCw size={14} />}
                    className="cc-action-btn"
                    onClick={() =>
                      void onRefreshMirrorHealth({
                        ...mirrorDraft,
                        preferredSource: "mirror",
                      }).catch(() => {})
                    }
                    disabled={installMirrorHealthBusy || isBusy}
                  >
                    检测镜像源
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="cc-action-btn"
                    onClick={() => void onSaveInstallSettings(mirrorDraft)}
                    disabled={installSettingsBusy || isBusy}
                  >
                    保存镜像设置
                  </Button>
                </div>
              </div>
              <label className="cc-install-mirror-field">
                <span>镜像预设</span>
                <select
                  className="cc-install-mirror-select"
                  value={mirrorDraft.mirrorPreset === "aliyun" ? "mixed" : mirrorDraft.mirrorPreset}
                  onChange={(event) =>
                    setMirrorDraft((current) => ({
                      ...current,
                      mirrorPreset: event.target.value as InstallSettingsView["mirrorPreset"],
                      preferredSource: "mirror",
                    }))
                  }
                  disabled={installSettingsBusy || isBusy}
                >
                  <option value="mixed">综合回退</option>
                  <option value="tuna">清华优先</option>
                  <option value="ustc">中科大优先</option>
                  <option value="custom">自定义</option>
                </select>
              </label>

              <div className="cc-install-mirror-health-grid">
                {groupedMirrorHealth.map(({ category, entries }) => {
                  const healthy = entries.filter((entry) => entry.healthy).length;
                  const total = entries.length;
                  const tone =
                    total > 0 && healthy === total ? "success" : healthy > 0 ? "warning" : "danger";
                  return (
                    <article key={category} className="cc-install-mirror-health-card">
                      <div className="cc-install-mirror-health-card-head">
                        <span>{formatMirrorCategoryLabel(category)}</span>
                        <strong className={`is-${tone}`}>
                          {healthy}/{total || 0}
                        </strong>
                      </div>
                      <div className="cc-install-mirror-health-list">
                        {entries.length ? (
                          entries.map((entry) => (
                            <div
                              key={`${entry.category}-${entry.url}`}
                              className="cc-install-mirror-health-item"
                            >
                              <div className="cc-install-mirror-health-item-head">
                                <span className={entry.healthy ? "is-success" : "is-danger"}>
                                  {entry.healthy ? "可用" : "不可用"}
                                </span>
                                <code>{entry.statusCode ?? "-"}</code>
                              </div>
                              <small>{entry.url}</small>
                              <small>{formatHealthDetail(entry.detail)}</small>
                            </div>
                          ))
                        ) : (
                          <div className="cc-install-mirror-health-item">
                            <small>{installMirrorHealthBusy ? "正在检测…" : "当前分类没有地址。"}</small>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {mirrorDraft.mirrorPreset === "custom" ? (
                <div className="cc-install-mirror-grid">
                  {renderMirrorTextarea(
                    "Git 发布页",
                    mirrorDraft.customMirrorConfig.gitReleasePages,
                    (next) =>
                      setMirrorDraft((current) => ({
                        ...current,
                        customMirrorConfig: {
                          ...current.customMirrorConfig,
                          gitReleasePages: textToLines(next),
                        },
                      })),
                  )}
                  {renderMirrorTextarea(
                    "uv 发布页",
                    mirrorDraft.customMirrorConfig.uvReleasePages,
                    (next) =>
                      setMirrorDraft((current) => ({
                        ...current,
                        customMirrorConfig: {
                          ...current.customMirrorConfig,
                          uvReleasePages: textToLines(next),
                        },
                      })),
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
                      })),
                  )}
                  {renderMirrorTextarea(
                    "PyPI Index",
                    mirrorDraft.customMirrorConfig.pypiIndexUrls,
                    (next) =>
                      setMirrorDraft((current) => ({
                        ...current,
                        customMirrorConfig: {
                          ...current.customMirrorConfig,
                          pypiIndexUrls: textToLines(next),
                        },
                      })),
                  )}
                </div>
              ) : null}
            </div>
            ) : null}

            <div className="cc-install-console-head">
              <div>
                <h4>PowerShell 预检</h4>
                <p>只在需要排障时查看。</p>
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
                className={`cc-install-preflight-tag is-${
                  activePreflight?.smokeTestOk ? "success" : "warning"
                }`}
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

            <div className="cc-install-mirror-config-card">
              <div className="cc-install-console-head">
                <div>
                  <h4>手动路径</h4>
                  <p>自动探测不到 Kimi 时再补充。</p>
                </div>
                <div className="cc-install-flow-actions">
                  <Button
                    type="button"
                    variant="outline"
                    className="cc-action-btn"
                    onClick={() => void onPickKimiPath()}
                  >
                    选择路径
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="cc-action-btn"
                    onClick={() => void onSavePathAndRetry()}
                    disabled={!kimiPathInput.trim()}
                  >
                    保存路径并重试
                  </Button>
                </div>
              </div>
              <div className="cc-install-path-grid">
                <article className="cc-install-overview-card">
                  <span>当前输入</span>
                  <strong>{kimiPathInput.trim() || "未填写"}</strong>
                </article>
                <article className="cc-install-overview-card">
                  <span>最近探测</span>
                  <strong>{detectedKimiPath || "未探测到路径"}</strong>
                </article>
              </div>
            </div>

          </div>
        ) : null}
      </section>

      <section className="cc-install-flow-section">
        <div className="cc-install-console-head">
          <div>
            <h4>内置终端</h4>
            <p>
              {session.title ?? "当前没有安装任务"} · {sessionStatusLabel} · {sessionStageLabel}
            </p>
          </div>
          <div className="cc-install-console-toolbar">
            {showRestartAction ? (
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCw size={14} />}
                className="cc-action-btn"
                onClick={() => void onRestartBackend()}
                disabled={restartBusy}
              >
                重启后端
              </Button>
            ) : null}
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
        {showRestartAction ? (
          <p className="hint">升级前已停止应用后端以释放 kimi.exe。升级完成后请点击“重启后端”。</p>
        ) : null}
        <pre ref={consoleRef} className="cc-install-console">
          {logsText || session.message || "还没有采集到输出日志。"}
        </pre>
      </section>

      {uninstallConfirmOpen ? (
        <div className="main-close-decision-overlay" role="presentation">
          <div
            className="main-close-decision-card"
            role="dialog"
            aria-modal="true"
            aria-label="卸载 Kimi CLI"
          >
            <h3>卸载 Kimi CLI</h3>
            <p>仅卸载 Kimi CLI，保留 uv 和 Python 3.13。卸载前会先停止后端，完成后后端保持停止。</p>
            <div className="main-close-decision-actions">
              <button
                type="button"
                className="ui-btn ui-btn-default ui-btn-size-default"
                onClick={() => setUninstallConfirmOpen(false)}
                disabled={isBusy}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-destructive ui-btn-size-default"
                onClick={() => {
                  void onStartTask("uninstall_kimi");
                }}
                disabled={uninstallAvailability.disabled}
                title={uninstallAvailability.reason}
              >
                确认卸载
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
