import { useEffect, useMemo, useState } from "react";
import { ChevronRight, RefreshCw } from "lucide-react";
import type {
  BackendState,
  InstallMirrorHealthCategory,
  InstallMirrorHealthReport,
  InstallSettingsView,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallSource,
  InstallTaskId,
  PowerShellPreflightSummary,
} from "@/app/types";
import { Button } from "@/components/ui/button";

type InstallFlowTaskContentProps = {
  session: InstallSessionSnapshot;
  probe: InstallProbeStatus | null;
  probeBusy: boolean;
  probeMessage: string;
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
    case "running":
    case "succeeded":
      return "success";
    case "failed":
    case "fallback_required":
      return "danger";
    default:
      return "neutral";
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

function linesToText(lines: string[]) {
  return lines.join("\n");
}

function textToLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getTaskAvailability(
  taskId: "install_git" | "install_nodejs" | "install_uv" | "install_python313" | "uninstall_kimi",
  probe: InstallProbeStatus | null,
  isBusy: boolean,
  source: InstallSource = "official",
): TaskAvailability {
  if (isBusy) {
    return { disabled: true, reason: "任务执行中" };
  }
  if (!probe) {
    return { disabled: true, reason: "等待环境检测" };
  }

  switch (taskId) {
    case "uninstall_kimi":
      return probe.kimiReady
        ? { disabled: false }
        : { disabled: true, reason: "当前未安装 Kimi Code" };
    case "install_git":
      return probe.gitReady && probe.gitBashReady
        ? { disabled: true, reason: "已安装" }
        : { disabled: false };
    case "install_nodejs":
      return probe.nodeReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_uv":
      return probe.uvReady ? { disabled: true, reason: "已安装" } : { disabled: false };
    case "install_python313":
      if (probe.python313Ready) return { disabled: true, reason: "已安装" };
      if (source === "official" && !probe.uvReady) {
        return { disabled: true, reason: "请先安装 uv" };
      }
      return { disabled: false };
  }
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
  session,
  probe,
  probeBusy,
  probeMessage,
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
  const [mirrorDraft, setMirrorDraft] = useState<InstallSettingsView>(installSettings);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
  const isBusy =
    session.status === "starting" ||
    session.status === "running" ||
    session.status === "cancelling";
  const taskBusy = isBusy || probeBusy;
  const installGitAvailability = getTaskAvailability("install_git", probe, taskBusy);
  const installNodejsAvailability = getTaskAvailability("install_nodejs", probe, taskBusy);
  const installUvAvailability = getTaskAvailability("install_uv", probe, taskBusy);
  const installPythonAvailability = getTaskAvailability(
    "install_python313",
    probe,
    taskBusy,
    installSource,
  );
  const uninstallAvailability = getTaskAvailability("uninstall_kimi", probe, isBusy);
  const activePreflight = session.powershellDiagnostic ?? powershellPreflight;
  const preflightKindMeta = getPreflightKindMeta(activePreflight?.kind);
  const sessionStatusLabel = formatInstallSessionStatus(session.status);
  const sessionTone = formatInstallSessionTone(session.status);
  const showRestartAction =
    session.taskId === "upgrade_kimi" &&
    !isBusy &&
    session.status !== "idle" &&
    backendState !== "running" &&
    backendState !== "starting";
  const errorSummary =
    session.status === "failed"
      ? session.failureSummary?.trim() || session.message?.trim()
      : session.status === "fallback_required"
        ? session.fallbackReason?.trim() || session.message?.trim()
        : "";
  const attentionMessages = [
    activePreflight && !activePreflight.smokeTestOk
      ? "PowerShell 预检未通过，建议先处理执行策略。"
      : "",
    !probe?.kimiReady && kimiPathInput.trim()
      ? "已填写本地 Kimi 路径，点击“保存路径并重试”后重新探测。"
      : "",
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
      <section className="cc-install-minimal" aria-label="Kimi Code 安装环境">
        {probeBusy || session.status !== "idle" ? (
          <div
            className={`cc-install-live-state is-${probeBusy ? "neutral" : sessionTone}`}
            role="status"
            aria-live="polite"
          >
            <span className="cc-install-live-dot" aria-hidden="true" />
            <div>
              <strong>
                {probeBusy
                  ? "正在检测安装环境…"
                  : `${sessionStatusLabel}${session.currentStepTitle ? ` · ${session.currentStepTitle}` : ""}`}
              </strong>
              {!probeBusy && session.message?.trim() && !errorSummary ? (
                <small>{session.message}</small>
              ) : null}
            </div>
            {showRestartAction ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon={<RefreshCw size={14} />}
                className="cc-action-btn cc-install-row-action"
                onClick={() => void onRestartBackend()}
                disabled={restartBusy}
              >
                重启后端
              </Button>
            ) : null}
          </div>
        ) : null}

        {errorSummary || (!probeBusy && probeMessage.trim()) ? (
          <p className="cc-install-inline-error" role="alert">
            {errorSummary || probeMessage.trim()}
          </p>
        ) : null}

        <dl className="cc-install-requirement-list">
          <div className="cc-install-requirement-row">
            <dt>Kimi Code</dt>
            <dd>
              <strong>{probeBusy ? "检测中" : probe ? (probe.kimiReady ? "已安装" : "缺失") : "等待检测"}</strong>
              <code>{detectedKimiPath || "尚未探测到可用路径"}</code>
            </dd>
          </div>
          <div className="cc-install-requirement-row">
            <dt>Node.js</dt>
            <dd>
              <strong>{probeBusy ? "检测中" : probe ? (probe.nodeReady ? "已就绪" : "缺失") : "等待检测"}</strong>
              <small>需要 22.19.0 或更新版本</small>
            </dd>
            {probe && !probe.nodeReady ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cc-action-btn cc-install-row-action"
                onClick={() => void onStartTask("install_nodejs")}
                disabled={installNodejsAvailability.disabled}
                title={installNodejsAvailability.reason}
              >
                安装 Node.js
              </Button>
            ) : null}
          </div>
          <div className="cc-install-requirement-row">
            <dt>Git Bash</dt>
            <dd>
              <strong>{probeBusy ? "检测中" : probe ? (probe.gitBashReady ? "已配置" : "缺失") : "等待检测"}</strong>
              <code>{probe?.kimiShellPath || "需要 Git for Windows / Git Bash"}</code>
            </dd>
            {probe && !probe.gitBashReady ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cc-action-btn cc-install-row-action"
                onClick={() => void onStartTask("install_git")}
                disabled={installGitAvailability.disabled}
                title={installGitAvailability.reason}
              >
                安装 Git
              </Button>
            ) : null}
          </div>
        </dl>

        {attentionMessages.length ? (
          <p className="cc-install-inline-note">{attentionMessages.join("；")}</p>
        ) : null}

        <button
          type="button"
          className="cc-install-more-toggle"
          onClick={() => setAdvancedOpen((current) => !current)}
          aria-expanded={advancedOpen}
          aria-controls="cc-install-advanced-options"
        >
          <span>更多选项</span>
          <ChevronRight size={16} className={advancedOpen ? "is-expanded" : ""} />
        </button>
      </section>

      {advancedOpen ? (
        <div
          id="cc-install-advanced-options"
          className="cc-install-advanced-panel"
          role="region"
          aria-label="Kimi Code 安装高级选项"
        >
          <section className="cc-install-advanced-section">
            <div className="cc-install-section-head">
              <div>
                <h4>安装来源</h4>
                <p>{formatSourceSummary(installSource, mirrorHealthSummary, installMirrorHealthBusy)}</p>
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
          </section>

          {installSource === "mirror" ? (
            <section className="cc-install-advanced-section">
              <div className="cc-install-section-head">
                <div>
                  <h4>镜像策略</h4>
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

              <div className="cc-install-mirror-health-list" aria-label="镜像健康状态">
                {groupedMirrorHealth.map(({ category, entries }) => {
                  const healthy = entries.filter((entry) => entry.healthy).length;
                  const total = entries.length;
                  const tone =
                    total > 0 && healthy === total ? "success" : healthy > 0 ? "warning" : "danger";
                  return (
                    <div key={category} className="cc-install-mirror-health-row">
                      <div className="cc-install-mirror-health-summary">
                        <strong>{formatMirrorCategoryLabel(category)}</strong>
                        <span className={`is-${tone}`}>
                          {installMirrorHealthBusy && !total ? "检测中" : total ? `${healthy}/${total} 可用` : "未检测"}
                        </span>
                      </div>
                      {entries.map((entry) => (
                        <small key={`${entry.category}-${entry.url}`}>
                          <span className={entry.healthy ? "is-success" : "is-danger"}>
                            {entry.healthy ? "可用" : "不可用"}
                          </span>
                          <code>{entry.statusCode ?? "-"}</code>
                          <code>{entry.url}</code>
                          <span>{formatHealthDetail(entry.detail)}</span>
                        </small>
                      ))}
                    </div>
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
            </section>
          ) : null}

          <section className="cc-install-advanced-section">
            <div className="cc-install-section-head">
              <div>
                <h4>兼容修复</h4>
                <p>仅用于旧 Python 版 Kimi Code 环境。</p>
              </div>
              <div className="cc-install-flow-actions">
                <Button
                  type="button"
                  variant="outline"
                  className="cc-action-btn"
                  onClick={() => void onStartTask("install_uv")}
                  disabled={installUvAvailability.disabled}
                  title={installUvAvailability.reason}
                >
                  {probe?.uvReady ? "uv 已安装" : "安装 uv"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="cc-action-btn"
                  onClick={() => void onStartTask("install_python313")}
                  disabled={installPythonAvailability.disabled}
                  title={installPythonAvailability.reason}
                >
                  {probe?.python313Ready ? "Python 3.13 已安装" : "安装 Python 3.13"}
                </Button>
              </div>
            </div>
          </section>

          <section className="cc-install-advanced-section">
            <div className="cc-install-section-head">
              <div>
                <h4>PowerShell 预检</h4>
              </div>
              <div className="cc-install-flow-actions">
                <Button
                  type="button"
                  variant="outline"
                  icon={<RefreshCw size={14} />}
                  className="cc-action-btn"
                  onClick={() => void onRefreshPowerShellPreflight()}
                  disabled={isBusy}
                >
                  重新预检
                </Button>
              </div>
            </div>
            <dl className="cc-install-detail-list" aria-label="PowerShell 预检摘要">
              <div>
                <dt>诊断</dt>
                <dd className={`is-${preflightKindMeta.tone}`}>{preflightKindMeta.label}</dd>
              </div>
              <div>
                <dt>启动探测</dt>
                <dd>{activePreflight ? (activePreflight.smokeTestOk ? "通过" : "未通过") : "未检测"}</dd>
              </div>
              <div>
                <dt>语言模式</dt>
                <dd>{activePreflight?.languageMode ?? "未知"}</dd>
              </div>
              {(activePreflight?.executionPolicies ?? []).map((item) => (
                <div key={`${item.scope}-${item.policy}`}>
                  <dt>{item.scope}</dt>
                  <dd>{item.policy}</dd>
                </div>
              ))}
              {activePreflight?.suggestedFix ? (
                <div>
                  <dt>建议</dt>
                  <dd><code>{activePreflight.suggestedFix}</code></dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="cc-install-advanced-section">
              <div className="cc-install-section-head">
                <div>
                  <h4>手动路径</h4>
                </div>
                <div className="cc-install-flow-actions">
                  <Button
                    type="button"
                    variant="outline"
                    className="cc-action-btn"
                    onClick={() => void onPickKimiPath()}
                    disabled={isBusy}
                  >
                    选择路径
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="cc-action-btn"
                    onClick={() => void onSavePathAndRetry()}
                    disabled={isBusy || !kimiPathInput.trim()}
                  >
                    保存路径并重试
                  </Button>
                </div>
              </div>
              <dl className="cc-install-detail-list">
                <div>
                  <dt>当前输入</dt>
                  <dd><code>{kimiPathInput.trim() || "未填写"}</code></dd>
                </div>
                <div>
                  <dt>最近探测</dt>
                  <dd><code>{detectedKimiPath || "未探测到路径"}</code></dd>
                </div>
              </dl>
          </section>

          <section className="cc-install-advanced-section cc-install-danger-section">
            <div className="cc-install-section-head">
              <div>
                <h4>卸载</h4>
                <p>仅移除托管的 Kimi Code，完成后后端保持停止。</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                className="cc-action-btn cc-install-danger-button"
                onClick={() => setUninstallConfirmOpen(true)}
                disabled={uninstallAvailability.disabled}
                title={uninstallAvailability.reason}
              >
                卸载 Kimi Code
              </Button>
            </div>
          </section>
        </div>
      ) : null}

      {uninstallConfirmOpen ? (
        <div className="main-close-decision-overlay" role="presentation">
          <div
            className="main-close-decision-card"
            role="dialog"
            aria-modal="true"
            aria-label="卸载 Kimi Code"
          >
            <h3>卸载 Kimi Code</h3>
            <p>仅卸载托管的 Kimi Code。卸载前会先停止后端，完成后后端保持停止。</p>
            <div className="main-close-decision-actions">
              <Button
                type="button"
                variant="outline"
                onClick={() => setUninstallConfirmOpen(false)}
                disabled={isBusy}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  void onStartTask("uninstall_kimi");
                }}
                disabled={uninstallAvailability.disabled}
                title={uninstallAvailability.reason}
              >
                确认卸载
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
