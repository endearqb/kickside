import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Eraser,
  FileText,
  FolderOpen,
  Info,
  KeyRound,
  LayoutDashboard,
  Minus,
  Plus,
  Play,
  RefreshCcw,
  RefreshCw,
  SlidersHorizontal,
  Square,
  X,
} from "lucide-react";
import type {
  ActionableOnboardingStep,
  AppStatus,
  BindingRecord,
  BridgeApprovalRecord,
  BridgeOnboardingConfigInput,
  BridgeOnboardingValidation,
  BridgeSessionImportInput,
  BridgeSessionRecord,
  BridgeSecretsMaskView,
  BridgeSettings,
  BridgeStatus,
  ControlCenterSurface,
  ContextMenuStatus,
  ControlSectionId,
  DiagnosticsInfo,
  InstallFlowCatalog,
  InstallCommandCatalog,
  InstallSettingsView,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallTaskId,
  KimiCliConfigCenterInput,
  KimiCliConfigCenterView,
  MainWindowCloseBehavior,
  OnboardingStatus,
  PowerShellPreflightSummary,
  RuntimePanelId,
} from "@/app/types";
import { formatLoginState } from "@/app/types";
import { DiagnosticItem } from "@/components/common/DiagnosticItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BridgeRuntimePanel } from "@/features/bridge/BridgeRuntimePanel";
import { ControlCenterCardHeader } from "@/features/control-center/ControlCenterCardHeader";
import { ConfigCenterModal } from "@/features/control-center/ConfigCenterModal";
import { InstallFlowModal } from "@/features/control-center/InstallFlowModal";
import { ControlCenterModalShell } from "@/features/control-center/ControlCenterModalShell";
import { pickRandomAgentTip, type AgentTip } from "@/lib/agentTips";

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type OnboardingCardId =
  | "install"
  | "context_menu"
  | "auth"
  | "work_dir";

type ControlCenterViewProps = {
  surface: ControlCenterSurface;
  status: AppStatus | null;
  diagnostics: DiagnosticsInfo | null;
  onboarding: OnboardingStatus | null;
  contextMenuStatus: ContextMenuStatus | null;
  activeControlSection: ControlSectionId;
  activeRuntimePanel: RuntimePanelId;
  stepCompletion: StepCompletion;
  actionBusy: boolean;
  diagnosticsBusy: boolean;
  contextMenuBusy: boolean;
  loginProbeBusy: boolean;
  mainWindowCloseBehavior: MainWindowCloseBehavior;
  installBusy: boolean;
  installAction: "dependencies" | "kimi" | "upgrade_kimi" | "nodejs" | null;
  bridgeSettings: BridgeSettings;
  bridgeStatus: BridgeStatus;
  bridgeOnboardingDraft: BridgeOnboardingConfigInput;
  bridgeOnboardingDirty: boolean;
  bridgeOnboardingValidation: BridgeOnboardingValidation;
  bridgeSessions: BridgeSessionRecord[];
  bridgeBindings: BindingRecord[];
  bridgeApprovals: BridgeApprovalRecord[];
  bridgeLogTail: string[];
  bridgeRecentErrors: string[];
  bridgeSecretsMask: BridgeSecretsMaskView;
  bridgeBusy: boolean;
  kimiPathInput: string;
  workDirInput: string;
  configCenterView: KimiCliConfigCenterView | null;
  configCenterDraft: KimiCliConfigCenterInput;
  configCenterOpen: boolean;
  configCenterBusy: boolean;
  configCenterDirty: boolean;
  installProbe: InstallProbeStatus | null;
  installSource: "official" | "mirror";
  installSettings: InstallSettingsView;
  installSettingsBusy: boolean;
  powershellPreflight: PowerShellPreflightSummary | null;
  installFlowOpen: boolean;
  installFlowCatalog: InstallFlowCatalog | null;
  installSessionSnapshot: InstallSessionSnapshot;
  installCommandsOpen: boolean;
  installCommandsBusy: boolean;
  installCommandCatalog: InstallCommandCatalog | null;
  setActiveControlSection: (section: ControlSectionId) => void;
  setActiveRuntimePanel: (panel: RuntimePanelId) => void;
  onWorkDirInputChange: (value: string) => void;
  onRefreshCoreState: () => Promise<void>;
  onRefreshDiagnostics: () => Promise<void>;
  onRefreshContextMenuStatus: () => Promise<void>;
  onRefreshBridgeSettings: () => Promise<BridgeSettings>;
  onRefreshBridgeStatus: () => Promise<BridgeStatus>;
  onRefreshBridgeSessions: () => Promise<BridgeSessionRecord[]>;
  onRefreshBridgeBindings: () => Promise<BindingRecord[]>;
  onRefreshBridgeApprovals: () => Promise<BridgeApprovalRecord[]>;
  onRefreshBridgeLogTail: () => Promise<string[]>;
  onRefreshBridgeSecretsMask: () => Promise<BridgeSecretsMaskView>;
  onRefreshInstallProbe: () => Promise<InstallProbeStatus>;
  onRefreshOnboarding: () => Promise<void>;
  onClose: () => void;
  onRetry: () => Promise<void>;
  onOpenLogs: () => Promise<void>;
  onOpenFolder: (path: string) => Promise<void>;
  onOpenKimiConfigDir: () => Promise<void>;
  onPickKimiPath: () => Promise<void>;
  onSavePathAndRetry: () => Promise<void>;
  onEnableContextMenu: () => Promise<void>;
  onDisableContextMenu: () => Promise<void>;
  onProbeLogin: () => Promise<void>;
  onPickWorkDir: () => Promise<void>;
  onPickBridgeDefaultWorkDir: () => Promise<void>;
  onSaveWorkDirAndRestart: () => Promise<void>;
  onClearWorkDir: () => Promise<void>;
  onBridgeSettingsChange: (next: BridgeSettings) => void;
  onBridgeOnboardingDraftChange: (next: BridgeOnboardingConfigInput) => void;
  onSaveBridgeOnboarding: () => Promise<void>;
  onSaveBridgeSettings: () => Promise<void>;
  onStartBridge: () => Promise<void>;
  onStopBridge: () => Promise<void>;
  onRestartBridge: () => Promise<void>;
  onImportBridgeSession: (input: BridgeSessionImportInput) => Promise<void>;
  onClearBridgeBinding: (bindingId: string) => Promise<void>;
  onResetBridgeBindingSession: (bindingId: string) => Promise<void>;
  onResolveBridgeApproval: (approvalId: string, status: string) => Promise<void>;
  onOpenConfigCenterModal: () => Promise<void>;
  onCloseConfigCenterModal: () => void;
  onConfigCenterDraftChange: (next: KimiCliConfigCenterInput) => void;
  onResetConfigCenterDraft: () => void;
  onSaveKimiCliConfigCenter: () => Promise<void>;
  onSaveMainWindowCloseBehavior: (
    behavior: MainWindowCloseBehavior,
  ) => Promise<MainWindowCloseBehavior>;
  onInstallSourceChange: (source: "official" | "mirror") => void;
  onSaveInstallSettings: (input: InstallSettingsView) => Promise<unknown>;
  onRefreshPowerShellPreflight: () => Promise<PowerShellPreflightSummary>;
  onInstallDependencies: () => Promise<void>;
  onInstallKimi: () => Promise<void>;
  onUpgradeKimi: () => Promise<void>;
  onInstallNodejs: () => Promise<void>;
  onOpenInstallFlow: () => Promise<void>;
  onCloseInstallFlow: () => void;
  onStartInstallTask: (taskId: InstallTaskId) => Promise<void>;
  onCancelInstallTask: () => Promise<void>;
  onOpenInstallCommands: () => Promise<void>;
  onCloseInstallCommands: () => void;
  onCompleteOnboarding: () => Promise<void>;
  onSkipOnboarding: () => Promise<void>;
  onOpenExternalUrl: (url: string) => Promise<void>;
  installMessage: string;
};

const controlSections: Array<{
  id: ControlSectionId;
  label: string;
  icon: ReactNode;
}> = [
  {
    id: "overview",
    label: "概览",
    icon: <LayoutDashboard size={15} />,
  },
  {
    id: "onboarding",
    label: "快速设置",
    icon: <SlidersHorizontal size={15} />,
  },
  {
    id: "runtime_center",
    label: "运行诊断",
    icon: <Activity size={15} />,
  },
  {
    id: "bridge_center",
    label: "IM Bridge",
    icon: <Play size={15} />,
  },
];

function BridgeConfigModal({
  open,
  busy,
  dirty,
  titleLabel,
  draft,
  validation,
  status,
  secretsMask,
  onClose,
  onDraftChange,
  onSave,
  onStartBridge,
  onRefreshStatus,
  onRefreshSecretsMask,
}: {
  open: boolean;
  busy: boolean;
  dirty: boolean;
  titleLabel: string;
  draft: BridgeOnboardingConfigInput;
  validation: BridgeOnboardingValidation;
  status: BridgeStatus;
  secretsMask: BridgeSecretsMaskView;
  onClose: () => void;
  onDraftChange: (next: BridgeOnboardingConfigInput) => void;
  onSave: () => Promise<void>;
  onStartBridge: () => Promise<void>;
  onRefreshStatus: () => Promise<BridgeStatus>;
  onRefreshSecretsMask: () => Promise<BridgeSecretsMaskView>;
}) {
  function requestClose() {
    if (dirty && !window.confirm("Bridge 配置存在未保存更改，确定关闭弹窗吗？")) {
      return;
    }
    onClose();
  }

  const feishuStatus =
    status.channels.find((channel) => channel.platform === "feishu")?.state ?? "idle";

  async function handleSaveAndStartBridge() {
    await onSave();
    await onStartBridge();
    await onRefreshStatus();
  }

  return (
    <ControlCenterModalShell
      open={open}
      title={titleLabel}
      description="在这里维护 Bridge 与 Feishu 长连接配置；保存凭据只代表 sidecar 可以尝试连接，平台是否检测到应用连接仍要看长连接和权限是否真正建立。"
      ariaLabel={titleLabel}
      className="cc-bridge-config-modal"
      bodyClassName="cc-bridge-config-body"
      onRequestClose={requestClose}
      headerActions={
        <Button
          type="button"
          variant="outline"
          icon={<RefreshCw size={14} />}
          className="cc-action-btn"
          onClick={() => {
            void Promise.all([onRefreshStatus(), onRefreshSecretsMask()]);
          }}
          disabled={busy}
        >
          刷新状态
        </Button>
      }
      footer={
        <>
          <div className="cc-config-footer-meta">
            <span>Bridge（网关）: {formatBridgeRuntimeStateLabel(status.state)}</span>
            <span>Feishu（飞书通道）: {formatBridgeChannelStateLabel(feishuStatus)}</span>
            {dirty ? <span className="unsaved">存在未保存变更</span> : <span className="saved">已同步</span>}
          </div>
          <div className="cc-actions">
            <Button
              type="button"
              variant="ghost"
              className="cc-action-btn"
              onClick={requestClose}
              disabled={busy}
            >
              关闭
            </Button>
            <Button
              type="button"
              icon={<Check size={15} />}
              className="cc-action-btn"
              onClick={() => void onSave()}
              disabled={busy || !dirty || !validation.canSave}
            >
              保存配置（Save）
            </Button>
            <Button
              type="button"
              icon={<Play size={15} />}
              className="cc-action-btn"
              onClick={() => void handleSaveAndStartBridge()}
              disabled={busy || !validation.canSave}
            >
              保存并启动（Save & Start）
            </Button>
          </div>
        </>
      }
    >
      <div className="diagnostics-grid cc-bridge-onboarding-status-grid">
        <div className="diag-item">
          <span className="diag-label">Bridge 状态（Bridge State）</span>
          <strong>{formatBridgeRuntimeStateLabel(status.state)}</strong>
        </div>
        <div className="diag-item">
          <span className="diag-label">Feishu 通道（Feishu Channel）</span>
          <strong>{formatBridgeChannelStateLabel(feishuStatus)}</strong>
        </div>
        <div className="diag-item">
          <span className="diag-label">Bridge 开关（Bridge Enabled）</span>
          <strong>{draft.enabled ? "就绪" : "待办"}</strong>
        </div>
        <div className="diag-item">
          <span className="diag-label">Feishu 开关（Feishu Enabled）</span>
          <strong>{draft.feishuEnabled ? "就绪" : "待办"}</strong>
        </div>
      </div>

      <div className="cc-bridge-onboarding-switches">
        <label className="bridge-switch-card">
          <span className="bridge-switch-copy">
            <strong>启用 Bridge（Enable Bridge）</strong>
            <small>保存后写入总开关，启动需点击“保存并启动”。</small>
          </span>
          <input
            type="checkbox"
            className="cc-switch-input"
            checked={draft.enabled}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                enabled: event.currentTarget.checked,
              })
            }
          />
          <span className="cc-switch-track" aria-hidden />
        </label>

        <label className="bridge-switch-card">
          <span className="bridge-switch-copy">
            <strong>启用 Feishu（Enable Feishu）</strong>
            <small>启用时需要有效的 appId 和 appSecret；飞书后台显示已连接还取决于长连接和应用权限。</small>
          </span>
          <input
            type="checkbox"
            className="cc-switch-input"
            checked={draft.feishuEnabled}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                feishuEnabled: event.currentTarget.checked,
                enabled: event.currentTarget.checked || draft.enabled,
              })
            }
          />
          <span className="cc-switch-track" aria-hidden />
        </label>
      </div>

      <div className="cc-bridge-onboarding-grid">
        <label className="cc-bridge-onboarding-field">
          <span>appId</span>
          <Input
            value={draft.feishu.appId ?? ""}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                feishu: {
                  ...draft.feishu,
                  appId: event.currentTarget.value,
                },
              })
            }
            placeholder="cli_a1b2c3d4"
          />
        </label>
        <label className="cc-bridge-onboarding-field">
          <span>appSecret</span>
          <Input
            type="password"
            value={draft.feishu.appSecret ?? ""}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                feishu: {
                  ...draft.feishu,
                  appSecret: event.currentTarget.value,
                },
              })
            }
            placeholder="请输入飞书 app secret"
          />
        </label>
        <label className="cc-bridge-onboarding-field">
          <span>verificationToken（可选）</span>
          <Input
            value={draft.feishu.verificationToken ?? ""}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                feishu: {
                  ...draft.feishu,
                  verificationToken: event.currentTarget.value,
                },
              })
            }
            placeholder="事件订阅 token；当前长连接模式可留空"
          />
        </label>
        <label className="cc-bridge-onboarding-field">
          <span>encryptKey（可选）</span>
          <Input
            type="password"
            value={draft.feishu.encryptKey ?? ""}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                feishu: {
                  ...draft.feishu,
                  encryptKey: event.currentTarget.value,
                },
              })
            }
            placeholder="事件订阅 encrypt key；当前长连接模式可留空"
          />
        </label>
      </div>

      <div className="bridge-panel-subsection">
        <div className="bridge-panel-subheader">
          <h5>密钥掩码视图（Secrets Mask View）</h5>
        </div>
        <div className="bridge-secret-list">
          {renderBridgeOnboardingSecretRow("Feishu appId（应用 ID）", secretsMask.feishu.appId)}
          {renderBridgeOnboardingSecretRow("Feishu appSecret（应用密钥）", secretsMask.feishu.appSecret)}
          {renderBridgeOnboardingSecretRow(
            "Feishu verificationToken（校验令牌）",
            secretsMask.feishu.verificationToken,
          )}
          {renderBridgeOnboardingSecretRow("Feishu encryptKey（加密密钥）", secretsMask.feishu.encryptKey)}
        </div>
      </div>

      <p
        className={`hint cc-step-meta cc-bridge-onboarding-message ${
          validation.canSave ? "" : "is-error"
        }`}
      >
        {validation.message ?? "保存后可回到卡片直接启动或停止 bridge。"}
      </p>
      <p className="hint cc-step-meta">
        当前 Feishu 通道使用长连接模式。`verificationToken` 和 `encryptKey` 仅在你同时接入事件订阅回调时需要，不决定当前长连接能否建连。
      </p>
      {status.state === "stopped" ? (
        <p className="hint cc-step-meta">
          当前 Bridge 为停止态（Stopped）。请点击“保存并启动（Save & Start）”启动服务。
        </p>
      ) : null}
    </ControlCenterModalShell>
  );
}

function RuntimePanel({
  active,
  onOpen,
  title,
  children,
}: {
  active: boolean;
  onOpen: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={`runtime-panel ${active ? "active" : ""}`}>
      <button type="button" className="runtime-panel-head" onClick={onOpen}>
        <div className="runtime-panel-title">
          <h3>{title}</h3>
        </div>
        <ChevronRight size={16} className="runtime-panel-chevron" />
      </button>
      {active && <div className="runtime-panel-body">{children}</div>}
    </section>
  );
}

function getBridgeChannelStatus(status: BridgeStatus, platform: "telegram" | "feishu") {
  return status.channels.find((channel) => channel.platform === platform);
}

function formatBridgeRuntimeStateLabel(state: BridgeStatus["state"]): string {
  switch (state) {
    case "running":
      return "就绪";
    case "starting":
    case "stopping":
      return "进行中";
    case "degraded":
    case "crashed":
      return "异常";
    default:
      return "待办";
  }
}

function formatBridgeChannelStateLabel(state: string): string {
  switch (state) {
    case "ready":
      return "就绪";
    case "connecting":
      return "进行中";
    case "degraded":
    case "error":
      return "异常";
    default:
      return "待办";
  }
}

function formatImFinalStatusLabel(status: BridgeStatus, feishuEnabled: boolean): string {
  if (feishuEnabled) {
    const feishuStatus = getBridgeChannelStatus(status, "feishu")?.state ?? "idle";
    return formatBridgeChannelStateLabel(feishuStatus);
  }
  return formatBridgeRuntimeStateLabel(status.state);
}

function hasLatinLetters(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function getBridgeDisplayName(settings: BridgeSettings): string {
  const feishuEnabled = settings.channels.some(
    (channel) => channel.platform === "feishu" && channel.enabled,
  );
  const telegramEnabled = settings.channels.some(
    (channel) => channel.platform === "telegram" && channel.enabled,
  );
  if (feishuEnabled && !telegramEnabled) {
    return "飞书";
  }
  if (telegramEnabled && !feishuEnabled) {
    return "Telegram";
  }
  return "IM Bridge";
}

function formatBridgeDisplayNameLabel(displayName: string, suffix: string): string {
  return hasLatinLetters(displayName) ? `${displayName} ${suffix}` : `${displayName}${suffix}`;
}

function formatOpenBridgeDisplayName(displayName: string): string {
  return hasLatinLetters(displayName) ? `打开 ${displayName}` : `打开${displayName}`;
}

function formatOpenBridgeDisplayNameLabel(displayName: string, suffix: string): string {
  return hasLatinLetters(displayName)
    ? `打开 ${displayName} ${suffix}`
    : `打开${displayName}${suffix}`;
}

function renderBridgeOnboardingSecretRow(
  label: string,
  value: BridgeSecretsMaskView["telegram"]["botToken"],
) {
  return (
    <div key={label} className="bridge-secret-row">
      <div className="bridge-secret-copy">
        <strong>{label}</strong>
        <small>{value.configured ? value.maskedValue ?? "***" : "未配置"}</small>
      </div>
      <span className={`bridge-secret-chip ${value.configured ? "configured" : "empty"}`}>
        {value.configured ? "Configured" : "Missing"}
      </span>
    </div>
  );
}

export function ControlCenterView({
  surface,
  status,
  diagnostics,
  onboarding,
  contextMenuStatus,
  activeControlSection,
  activeRuntimePanel,
  stepCompletion,
  actionBusy,
  diagnosticsBusy,
  contextMenuBusy,
  loginProbeBusy,
  mainWindowCloseBehavior,
  installBusy,
  installAction,
  bridgeSettings,
  bridgeStatus,
  bridgeOnboardingDraft,
  bridgeOnboardingDirty,
  bridgeOnboardingValidation,
  bridgeSessions,
  bridgeBindings,
  bridgeApprovals,
  bridgeLogTail,
  bridgeRecentErrors,
  bridgeSecretsMask,
  bridgeBusy,
  kimiPathInput,
  workDirInput,
  configCenterView,
  configCenterDraft,
  configCenterOpen,
  configCenterBusy,
  configCenterDirty,
  installProbe,
  installSource,
  installSettings,
  installSettingsBusy,
  powershellPreflight,
  installFlowOpen,
  installFlowCatalog,
  installSessionSnapshot,
  installCommandsOpen,
  installCommandsBusy,
  installCommandCatalog,
  setActiveControlSection,
  setActiveRuntimePanel,
  onWorkDirInputChange,
  onRefreshCoreState,
  onRefreshDiagnostics,
  onRefreshContextMenuStatus,
  onRefreshBridgeSettings,
  onRefreshBridgeStatus,
  onRefreshBridgeSessions,
  onRefreshBridgeBindings,
  onRefreshBridgeApprovals,
  onRefreshBridgeLogTail,
  onRefreshBridgeSecretsMask,
  onRefreshInstallProbe,
  onRefreshOnboarding,
  onClose,
  onRetry,
  onOpenLogs,
  onOpenFolder,
  onOpenKimiConfigDir,
  onPickKimiPath,
  onSavePathAndRetry,
  onEnableContextMenu,
  onDisableContextMenu,
  onProbeLogin,
  onPickWorkDir,
  onPickBridgeDefaultWorkDir,
  onSaveWorkDirAndRestart,
  onClearWorkDir,
  onBridgeSettingsChange,
  onBridgeOnboardingDraftChange,
  onSaveBridgeOnboarding,
  onSaveBridgeSettings,
  onStartBridge,
  onStopBridge,
  onRestartBridge,
  onImportBridgeSession,
  onClearBridgeBinding,
  onResetBridgeBindingSession,
  onResolveBridgeApproval,
  onOpenConfigCenterModal,
  onCloseConfigCenterModal,
  onConfigCenterDraftChange,
  onResetConfigCenterDraft,
  onSaveKimiCliConfigCenter,
  onSaveMainWindowCloseBehavior,
  onInstallSourceChange,
  onSaveInstallSettings,
  onRefreshPowerShellPreflight,
  onInstallDependencies,
  onInstallKimi,
  onUpgradeKimi,
  onInstallNodejs,
  onOpenInstallFlow,
  onCloseInstallFlow,
  onStartInstallTask,
  onCancelInstallTask,
  onOpenInstallCommands,
  onCloseInstallCommands,
  onCompleteOnboarding,
  onSkipOnboarding,
  onOpenExternalUrl,
  installMessage,
}: ControlCenterViewProps) {
  const [authCardView, setAuthCardView] = useState<"login" | "api">("login");
  const [installProbeRequested, setInstallProbeRequested] = useState(false);
  const [bridgeConfigOpen, setBridgeConfigOpen] = useState(false);
  const [selectedBindingId, setSelectedBindingId] = useState("");
  const [bridgeReadyHintOpen, setBridgeReadyHintOpen] = useState(false);
  const [expandedOnboardingCard, setExpandedOnboardingCard] =
    useState<OnboardingCardId | null>(null);
  const [runtimePanelExpanded, setRuntimePanelExpanded] = useState(true);
  const [bridgeRuntimePanelExpanded, setBridgeRuntimePanelExpanded] = useState(false);
  const [mainCloseBehaviorSaving, setMainCloseBehaviorSaving] = useState(false);
  const [briefTip, setBriefTip] = useState<AgentTip>(() => pickRandomAgentTip());
  const bridgeReadyHintRef = useRef<HTMLDivElement | null>(null);
  void installCommandsOpen;
  void installCommandsBusy;
  void installCommandCatalog;
  void onInstallDependencies;
  void onInstallKimi;
  void onUpgradeKimi;
  void onInstallNodejs;
  void onOpenInstallCommands;
  void onCloseInstallCommands;
  const installPathDisplay =
    onboarding?.detectedKimiPath?.trim() ?? kimiPathInput.trim();
  const installSummary = onboarding?.kimiInstalled
    ? `已检测到：${installPathDisplay || "kimi"}`
    : installPathDisplay
      ? `已选择：${installPathDisplay}`
      : "尚未检测到 Kimi CLI，请先安装后点击浏览选择可执行文件路径。";
  const recentInstallSummary = installSessionSnapshot.title
    ? `${installSessionSnapshot.title}: ${installSessionSnapshot.message ?? installSessionSnapshot.status}`
    : null;
  const effectiveWorkDir = status?.effectiveWorkDir ?? onboarding?.workDir ?? "";
  const runtimeContextMenuSupported =
    contextMenuStatus?.supported ?? onboarding?.contextMenuSupported ?? false;
  const runtimeContextMenuEnabled =
    contextMenuStatus?.enabled ?? onboarding?.contextMenuEnabled ?? false;
  const isOnboardingSection = activeControlSection === "onboarding";
  const isBridgeRunning =
    bridgeStatus.state === "running" ||
    bridgeStatus.state === "starting" ||
    bridgeStatus.state === "degraded";
  const feishuChannelStatus = getBridgeChannelStatus(bridgeStatus, "feishu");
  const bridgeEnabled = bridgeSettings.enabled;
  const feishuEnabled = bridgeSettings.channels.find(
    (channel) => channel.platform === "feishu",
  )?.enabled ?? false;
  const bridgeDisplayName = getBridgeDisplayName(bridgeSettings);
  const bridgeFinalStatusTitle = formatBridgeDisplayNameLabel(bridgeDisplayName, "最终状态");
  const openBridgeTitle = formatOpenBridgeDisplayName(bridgeDisplayName);
  const bridgeRuntimePanelTitle = formatBridgeDisplayNameLabel(bridgeDisplayName, "运行面板");
  const bridgeConfigTitle = formatBridgeDisplayNameLabel(bridgeDisplayName, "配置");
  const openBridgeConfigTitle = formatOpenBridgeDisplayNameLabel(bridgeDisplayName, "配置");
  const mainWindowCloseBehaviorOptions: Array<{
    value: MainWindowCloseBehavior;
    label: string;
  }> = [
    { value: "ask", label: "首次询问（可记住）" },
    { value: "exit", label: "直接退出应用" },
    { value: "minimize_to_tray", label: "最小化到系统托盘" },
  ];
  const bridgeOnboardingStartDisabled =
    bridgeBusy || isBridgeRunning || !bridgeOnboardingValidation.canStart;
  const installStatusLabel = onboarding?.kimiInstalled ? "就绪" : "待办";
  const installStatusTone = onboarding?.kimiInstalled ? "success" : "warning";
  const contextMenuStatusLabel = !runtimeContextMenuSupported
    ? "不支持"
    : runtimeContextMenuEnabled
      ? "就绪"
      : "待办";
  const contextMenuStatusTone = !runtimeContextMenuSupported
    ? "neutral"
    : runtimeContextMenuEnabled
      ? "success"
      : "warning";
  const authStatusLabel =
    onboarding?.loginState === "logged_in" || onboarding?.apiConfigAck ? "就绪" : "待办";
  const authStatusTone =
    onboarding?.loginState === "logged_in" || onboarding?.apiConfigAck
      ? "success"
      : "neutral";
  const workDirStatusLabel = effectiveWorkDir ? "就绪" : "待办";
  const workDirStatusTone = effectiveWorkDir ? "success" : "warning";
  const bridgeStatusLabel =
    bridgeStatus.state === "running"
      ? "就绪"
      : bridgeStatus.state === "starting" || bridgeStatus.state === "stopping"
        ? "进行中"
        : bridgeStatus.state === "degraded" || bridgeStatus.state === "crashed"
          ? "异常"
        : bridgeEnabled || feishuEnabled
          ? "待办"
          : "待办";
  const bridgeRuntimeTone =
    bridgeStatus.state === "running" || bridgeStatus.state === "degraded"
      ? "success"
      : bridgeStatus.state === "starting"
        ? "warning"
        : bridgeStatus.state === "crashed"
          ? "danger"
          : "neutral";
  const feishuRuntimeState = feishuChannelStatus?.state ?? "idle";
  const feishuRuntimeTone =
    feishuRuntimeState === "ready"
      ? "success"
      : feishuRuntimeState === "connecting" || feishuRuntimeState === "degraded"
        ? "warning"
        : feishuRuntimeState === "error"
          ? "danger"
          : "neutral";
  const contextMenuReady = !runtimeContextMenuSupported || runtimeContextMenuEnabled;
  const installReady = onboarding?.kimiInstalled ?? stepCompletion.install_kimi;
  const authReady = Boolean(
    onboarding?.loginState === "logged_in" || onboarding?.apiConfigAck,
  );
  const workDirReady = Boolean(effectiveWorkDir);
  const recommendedOnboardingCard: OnboardingCardId = !installReady
    ? "install"
    : !contextMenuReady
      ? "context_menu"
      : !authReady
        ? "auth"
        : "work_dir";

  function toggleOnboardingCard(cardId: OnboardingCardId) {
    setExpandedOnboardingCard(cardId);
  }

  useEffect(() => {
    if (activeControlSection !== "onboarding") {
      setExpandedOnboardingCard(null);
      return;
    }
    if (!expandedOnboardingCard) {
      setExpandedOnboardingCard(recommendedOnboardingCard);
    }
  }, [activeControlSection, expandedOnboardingCard, recommendedOnboardingCard]);

  useEffect(() => {
    if (activeControlSection === "runtime_center") {
      setRuntimePanelExpanded(true);
      return;
    }
    setRuntimePanelExpanded(false);
  }, [activeControlSection]);

  useEffect(() => {
    if (activeControlSection !== "bridge_center") {
      setBridgeRuntimePanelExpanded(false);
    }
  }, [activeControlSection]);

  useEffect(() => {
    if (!bridgeOnboardingValidation.canStart && bridgeReadyHintOpen) {
      setBridgeReadyHintOpen(false);
    }
  }, [bridgeOnboardingValidation.canStart, bridgeReadyHintOpen]);

  useEffect(() => {
    if (!bridgeReadyHintOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (!bridgeReadyHintRef.current?.contains(target)) {
        setBridgeReadyHintOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBridgeReadyHintOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [bridgeReadyHintOpen]);

  useEffect(() => {
    if (bridgeBindings.length === 0) {
      if (selectedBindingId) {
        setSelectedBindingId("");
      }
      return;
    }
    if (
      !selectedBindingId ||
      !bridgeBindings.some((binding) => binding.bindingId === selectedBindingId)
    ) {
      setSelectedBindingId(bridgeBindings[0]?.bindingId ?? "");
    }
  }, [bridgeBindings, selectedBindingId]);

  useEffect(() => {
    if (installProbe) {
      setInstallProbeRequested(true);
      return;
    }
    if (installProbeRequested || activeControlSection !== "onboarding") {
      return;
    }
    setInstallProbeRequested(true);
    void onRefreshInstallProbe().catch(() => {
      // Error state is handled by the caller; keep the one-shot gate latched.
    });
  }, [
    activeControlSection,
    installProbe,
    installProbeRequested,
    onRefreshInstallProbe,
  ]);

  const installSecondaryAction = (
    <Button
      type="button"
      variant="ghost"
      icon={<RefreshCcw size={15} />}
      className="cc-action-btn"
      onClick={() => void onRefreshInstallProbe()}
      disabled={installBusy}
    >
      重新检测
    </Button>
  );

  const contextMenuPrimaryAction = (
    <Button
      type="button"
      icon={<Plus size={15} />}
      className="cc-action-btn"
      onClick={() => void onEnableContextMenu()}
      disabled={contextMenuBusy || !onboarding?.contextMenuSupported}
    >
      启用右键菜单
    </Button>
  );

  const contextMenuSecondaryAction = (
    <Button
      type="button"
      variant="ghost"
      icon={<Minus size={15} />}
      className="cc-action-btn"
      onClick={() => void onDisableContextMenu()}
      disabled={contextMenuBusy || !onboarding?.contextMenuSupported}
    >
      禁用右键菜单
    </Button>
  );

  const authPrimaryAction =
    authCardView === "login" ? (
      <Button
        type="button"
        icon={<KeyRound size={15} />}
        className="cc-action-btn"
        onClick={() => void onProbeLogin()}
        disabled={loginProbeBusy}
      >
        检测或执行登录
      </Button>
    ) : (
      <Button
        type="button"
        icon={<Check size={14} />}
        className="cc-action-btn"
        onClick={() => void onOpenConfigCenterModal()}
        disabled={actionBusy || configCenterBusy}
      >
        打开配置中心弹窗
      </Button>
    );

  const authSecondaryAction =
    authCardView === "login" ? null : (
      <Button
        type="button"
        variant="ghost"
        icon={<FolderOpen size={14} />}
        className="cc-action-btn"
        onClick={() => void onOpenKimiConfigDir()}
        disabled={actionBusy}
      >
        打开配置目录
      </Button>
    );

  const workDirPrimaryAction = (
    <Button
      type="button"
      icon={<Check size={15} />}
      className="cc-action-btn"
      onClick={() => void onSaveWorkDirAndRestart()}
      disabled={actionBusy}
    >
      保存并重启后端
    </Button>
  );

  const workDirSecondaryAction = (
    <Button
      type="button"
      variant="ghost"
      icon={<Eraser size={15} />}
      className="cc-action-btn"
      onClick={() => void onClearWorkDir()}
      disabled={actionBusy}
    >
      清除并使用默认
    </Button>
  );

  async function handleOpenOnboardingEntry() {
    try {
      await onRefreshOnboarding();
    } finally {
      setActiveControlSection("onboarding");
    }
  }

  async function handleSelectRuntimePanel(panel: RuntimePanelId) {
    if (
      activeControlSection === "runtime_center" &&
      runtimePanelExpanded &&
      activeRuntimePanel === panel
    ) {
      setRuntimePanelExpanded(false);
      return;
    }
    try {
      if (panel === "bridge") {
        await Promise.all([
          onRefreshBridgeSettings(),
          onRefreshBridgeStatus(),
          onRefreshBridgeBindings(),
          onRefreshBridgeApprovals(),
          onRefreshBridgeLogTail(),
          onRefreshBridgeSecretsMask(),
        ]);
      } else if (panel === "paths") {
        await Promise.all([onRefreshDiagnostics(), onRefreshContextMenuStatus()]);
      } else {
        await onRefreshDiagnostics();
      }
    } finally {
      setActiveControlSection("runtime_center");
      setActiveRuntimePanel(panel);
      setRuntimePanelExpanded(true);
    }
  }

  async function handleOpenRuntimeEntry(panel: RuntimePanelId) {
    await handleSelectRuntimePanel(panel);
  }

  async function handleSelectMainWindowCloseBehavior(behavior: MainWindowCloseBehavior) {
    if (mainCloseBehaviorSaving || behavior === mainWindowCloseBehavior) {
      return;
    }
    setMainCloseBehaviorSaving(true);
    try {
      await onSaveMainWindowCloseBehavior(behavior);
    } finally {
      setMainCloseBehaviorSaving(false);
    }
  }

  async function handleSelectBridgeSection() {
    try {
      await Promise.all([
        onRefreshBridgeSettings(),
        onRefreshBridgeStatus(),
        onRefreshBridgeSessions(),
        onRefreshBridgeBindings(),
        onRefreshBridgeApprovals(),
        onRefreshBridgeLogTail(),
        onRefreshBridgeSecretsMask(),
      ]);
    } finally {
      setActiveControlSection("bridge_center");
    }
  }

  async function handleSelectControlSection(section: ControlSectionId) {
    if (section === "overview") {
      setActiveControlSection("overview");
      return;
    }
    if (section === "onboarding") {
      await handleOpenOnboardingEntry();
      return;
    }
    if (section === "bridge_center") {
      await handleSelectBridgeSection();
      return;
    }
    await handleSelectRuntimePanel("core");
  }

  function renderContextMenuStepContent() {
    return (
      <div className="cc-step-main">
        <div className="cc-step-secondary-actions">
          {contextMenuSecondaryAction}
          <Button
            type="button"
            variant="outline"
            icon={<RefreshCcw size={15} />}
            className="cc-action-btn"
            onClick={() => void onRefreshContextMenuStatus()}
            disabled={contextMenuBusy}
          >
            刷新状态
          </Button>
        </div>
        {onboarding?.contextMenuMessage ? (
          <p className="hint cc-step-meta">{onboarding.contextMenuMessage}</p>
        ) : null}
        {contextMenuStatus?.message && contextMenuStatus.message !== onboarding?.contextMenuMessage ? (
          <p className="hint cc-step-meta">{contextMenuStatus.message}</p>
        ) : null}
      </div>
    );
  }

  function renderWorkDirStepContent() {
    return (
      <div className="cc-step-main">
        <div className="cc-step-secondary-actions">
          {workDirSecondaryAction}
          <Button
            type="button"
            variant="outline"
            icon={<Check size={15} />}
            className="cc-action-btn"
            onClick={() => void onSaveWorkDirAndRestart()}
            disabled={actionBusy}
          >
            保存并重启后端
          </Button>
        </div>
        <div className="cc-workdir-row">
          <Input
            id="work-dir-onboarding"
            value={workDirInput}
            onChange={(event) => onWorkDirInputChange(event.currentTarget.value)}
            placeholder="D:\\Projects\\your-repo"
          />
          <Button
            type="button"
            variant="outline"
            className="cc-action-btn cc-inline-btn"
            onClick={() => void onPickWorkDir()}
          >
            浏览
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            icon={<FolderOpen size={14} />}
            className="cc-inline-icon-btn"
            onClick={() => void onOpenFolder(effectiveWorkDir.trim())}
            disabled={!effectiveWorkDir.trim()}
            aria-label="打开当前生效目录"
            title="打开当前生效目录"
          />
          <p className="hint cc-inline-meta">
            当前生效目录：
            <strong>{effectiveWorkDir || "-"}</strong>
          </p>
        </div>
      </div>
    );
  }

  function renderBridgeStepContent() {
    const bridgeDefaultWorkDir = bridgeSettings.defaultWorkDir?.trim() ?? "";
    const hasBridgeBindings = bridgeBindings.length > 0;
    const bridgeReadyLongHint =
      "现在只能说明 sidecar 可以尝试建立飞书长连接，是否被平台识别为已连接仍取决于长连接和应用权限。";
    return (
      <div className="cc-step-main">
        <div className="cc-bridge-onboarding-tag-row">
          <span className={`cc-status-badge tone-${bridgeRuntimeTone}`}>
            Bridge 运行：{formatBridgeRuntimeStateLabel(bridgeStatus.state)}
          </span>
          <span className={`cc-status-badge tone-${feishuRuntimeTone}`}>
            飞书通道：{formatBridgeChannelStateLabel(feishuRuntimeState)}
          </span>
          <span className={`cc-status-badge tone-${bridgeOnboardingDraft.enabled ? "success" : "neutral"}`}>
            Bridge 开关：{bridgeOnboardingDraft.enabled ? "就绪" : "待办"}
          </span>
          <span className={`cc-status-badge tone-${bridgeOnboardingDraft.feishuEnabled ? "success" : "neutral"}`}>
            飞书开关：{bridgeOnboardingDraft.feishuEnabled ? "就绪" : "待办"}
          </span>
        </div>
        <div className="cc-bridge-onboarding-switches">
          <label className="bridge-switch-card">
            <span className="bridge-switch-copy">
              <strong>自动启动（Auto Start）</strong>
            </span>
            <input
              type="checkbox"
              className="cc-switch-input"
              checked={bridgeOnboardingDraft.autoStart}
              onChange={(event) =>
                onBridgeOnboardingDraftChange({
                  ...bridgeOnboardingDraft,
                  autoStart: event.currentTarget.checked,
                })
              }
            />
            <span className="cc-switch-track" aria-hidden />
          </label>

          <label className="bridge-switch-card">
            <span className="bridge-switch-copy">
              <strong>飞书自动审批</strong>
            </span>
            <input
              type="checkbox"
              className="cc-switch-input"
              checked={bridgeSettings.feishuAutoApprove}
              onChange={(event) =>
                onBridgeSettingsChange({
                  ...bridgeSettings,
                  feishuAutoApprove: event.currentTarget.checked,
                })
              }
            />
            <span className="cc-switch-track" aria-hidden />
          </label>

          <label className="bridge-switch-card">
            <span className="bridge-switch-copy">
              <strong>每次 Bridge 启动新建会话</strong>
            </span>
            <input
              type="checkbox"
              className="cc-switch-input"
              checked={bridgeSettings.resetBindingSessionOnBridgeStart}
              onChange={(event) =>
                onBridgeSettingsChange({
                  ...bridgeSettings,
                  resetBindingSessionOnBridgeStart: event.currentTarget.checked,
                })
              }
            />
            <span className="cc-switch-track" aria-hidden />
          </label>
        </div>

        <div className="cc-bridge-resource-row">
          <div className="bridge-port-card cc-bridge-binding-card">
            <span>当前绑定</span>
            <div className="cc-bridge-binding-row">
              <select
                className="ui-input"
                value={selectedBindingId}
                onChange={(event) => setSelectedBindingId(event.currentTarget.value)}
                disabled={bridgeBusy || !hasBridgeBindings}
              >
                {hasBridgeBindings ? (
                  bridgeBindings.map((binding) => (
                    <option key={binding.bindingId} value={binding.bindingId}>
                      {binding.bindingId} ({binding.platform})
                    </option>
                  ))
                ) : (
                  <option value="">暂无 binding</option>
                )}
              </select>
              <Button
                type="button"
                variant="outline"
                icon={<Plus size={14} />}
                className="cc-action-btn cc-bridge-binding-reset-btn"
                onClick={() => {
                  if (!selectedBindingId) {
                    return;
                  }
                  void onResetBridgeBindingSession(selectedBindingId);
                }}
                disabled={bridgeBusy || !selectedBindingId}
              >
                新建并切换会话
              </Button>
            </div>
            <small>仅重置当前绑定会话，保持绑定与工作目录不变。</small>
          </div>

          <div className="bridge-port-card cc-bridge-default-workdir-card">
            <span>IM 默认工作目录</span>
            <div className="bridge-inline-path-row">
              <Input
                value={bridgeSettings.defaultWorkDir ?? ""}
                onChange={(event) =>
                  onBridgeSettingsChange({
                    ...bridgeSettings,
                    defaultWorkDir: event.currentTarget.value,
                  })
                }
                placeholder="留空时跟随应用工作目录，例如 D:/workspace"
              />
              <Button
                type="button"
                variant="outline"
                className="cc-action-btn cc-inline-btn"
                onClick={() => void onPickBridgeDefaultWorkDir()}
                disabled={bridgeBusy}
              >
                浏览
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                icon={<FolderOpen size={14} />}
                className="cc-inline-icon-btn"
                onClick={() => void onOpenFolder(bridgeDefaultWorkDir)}
                disabled={bridgeBusy || !bridgeDefaultWorkDir}
                aria-label="打开 IM 默认工作目录"
                title="打开 IM 默认工作目录"
              />
            </div>
            <small>留空时，IM Bridge 会跟随应用设置里的默认工作目录。</small>
          </div>
        </div>

        {bridgeOnboardingValidation.canStart ? (
          <div className="cc-bridge-ready-hint" ref={bridgeReadyHintRef}>
            <p className="hint cc-step-meta cc-bridge-onboarding-message cc-bridge-ready-hint-line">
              配置已就绪
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                icon={<Info size={14} />}
                className="cc-inline-icon-btn cc-bridge-ready-info-btn"
                onClick={() => setBridgeReadyHintOpen((current) => !current)}
                aria-label="查看连接说明"
                aria-expanded={bridgeReadyHintOpen}
                title="查看连接说明"
              />
            </p>
            {bridgeReadyHintOpen ? (
              <div className="cc-bridge-ready-popover" role="status">
                {bridgeReadyLongHint}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="hint cc-step-meta cc-bridge-onboarding-message is-error">
            {bridgeOnboardingValidation.message ??
              "配置保存后，可直接在这里启动或停止 bridge。"}
          </p>
        )}

        <div className="cc-step-secondary-actions">
          <Button
            type="button"
            icon={<Check size={15} />}
            className="cc-action-btn"
            onClick={() => void onSaveBridgeOnboarding()}
            disabled={bridgeBusy || !bridgeOnboardingValidation.canSave}
          >
            保存并启用
          </Button>
          <Button
            type="button"
            icon={<Play size={15} />}
            className="cc-action-btn"
            onClick={() => void onStartBridge()}
            disabled={bridgeOnboardingStartDisabled}
          >
            启动（Start）
          </Button>
          <Button
            type="button"
            variant="outline"
            icon={<RefreshCw size={15} />}
            className="cc-action-btn"
            onClick={() => {
              void Promise.all([
                onRefreshBridgeSettings(),
                onRefreshBridgeStatus(),
                onRefreshBridgeSecretsMask(),
              ]);
            }}
            disabled={bridgeBusy}
          >
            刷新状态
          </Button>
          <Button
            type="button"
            variant="outline"
            className="cc-action-btn"
            onClick={() => void onSaveBridgeSettings()}
            disabled={bridgeBusy}
          >
            保存 IM 目录
          </Button>
          <Button
            type="button"
            variant="outline"
            className="cc-action-btn"
            onClick={() => setBridgeConfigOpen(true)}
            disabled={bridgeBusy}
          >
            {openBridgeConfigTitle}
          </Button>
        </div>
        <div className="cc-danger-group">
          <div className="cc-danger-group-label">
            <span>危险操作</span>
          </div>
          <div className="cc-step-secondary-actions">
            <Button
              type="button"
              variant="ghost"
              icon={<Square size={15} />}
              className="cc-action-btn"
              onClick={() => void onStopBridge()}
              disabled={bridgeBusy || !isBridgeRunning}
            >
              停止（Stop）
            </Button>
            <Button
              type="button"
              variant="outline"
              icon={<RefreshCcw size={15} />}
              className="cc-action-btn"
              onClick={() => void onRestartBridge()}
              disabled={bridgeBusy}
            >
              重启（Restart）
            </Button>
          </div>
        </div>
        {bridgeStatus.state === "stopped" ? (
          <p className="hint cc-step-meta">
            Bridge 仍为停止态（Stopped）。请先确认“Bridge 开关”已启用，再点击“启动（Start）”。
          </p>
        ) : null}
        {bridgeOnboardingDirty ? <p className="hint cc-step-meta">存在未保存配置，请先保存并启用。</p> : null}
      </div>
    );
  }

  const onboardingSteps: Array<{
    id: OnboardingCardId;
    index: string;
    eyebrow: string;
    title: string;
    statusLabel: string;
    statusTone: "neutral" | "success" | "warning" | "danger";
    progressLabel: string;
    complete: boolean;
    primaryAction: ReactNode;
  }> = [
    {
      id: "install",
      index: "01",
      eyebrow: "Base",
      title: "安装 Kimi CLI",
      statusLabel: installStatusLabel,
      statusTone: installStatusTone,
      progressLabel: `${installReady ? 1 : 0}/1`,
      complete: installReady,
      primaryAction: (
        <Button
          type="button"
          icon={<Plus size={15} />}
          className="cc-action-btn"
          onClick={() => void onOpenInstallFlow()}
          disabled={installBusy}
        >
          打开安装与升级
        </Button>
      ),
    },
    {
      id: "context_menu",
      index: "02",
      eyebrow: "Explorer",
      title: "资源管理器右键菜单",
      statusLabel: contextMenuStatusLabel,
      statusTone: contextMenuStatusTone,
      progressLabel: `${contextMenuReady ? 1 : 0}/1`,
      complete: contextMenuReady,
      primaryAction: contextMenuPrimaryAction,
    },
    {
      id: "auth",
      index: "03",
      eyebrow: "Access",
      title: "登录与 Provider API",
      statusLabel: authStatusLabel,
      statusTone: authStatusTone,
      progressLabel: `${authReady ? 1 : 0}/1`,
      complete: authReady,
      primaryAction: authPrimaryAction,
    },
    {
      id: "work_dir",
      index: "04",
      eyebrow: "Workspace",
      title: "默认工作目录",
      statusLabel: workDirStatusLabel,
      statusTone: workDirStatusTone,
      progressLabel: `${workDirReady ? 1 : 0}/1`,
      complete: workDirReady,
      primaryAction: workDirPrimaryAction,
    },
  ];
  const completedOnboardingCards = onboardingSteps.filter((step) => step.complete).length;
  const activeOnboardingCard = expandedOnboardingCard ?? recommendedOnboardingCard;
  const activeOnboardingStep =
    onboardingSteps.find((step) => step.id === activeOnboardingCard) ?? onboardingSteps[0];
  const runtimeIssues = [
    diagnostics?.lastError ? `最近错误：${diagnostics.lastError}` : null,
    diagnostics?.startupFailureDetail ? `启动失败详情：${diagnostics.startupFailureDetail}` : null,
    diagnostics?.versionError ? `版本检查：${diagnostics.versionError}` : null,
    bridgeRecentErrors[0] ? `Bridge：${bridgeRecentErrors[0]}` : null,
  ].filter((item): item is string => Boolean(item));
  const condensedLogPreview =
    diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0
      ? diagnostics.backendLogTail.slice(-2).join("\n")
      : diagnostics?.appLogTail && diagnostics.appLogTail.length > 0
        ? diagnostics.appLogTail.slice(-2).join("\n")
        : "暂无最新日志摘录。";
  const imFinalStatusLabel = formatImFinalStatusLabel(bridgeStatus, feishuEnabled);
  const overviewBriefs = [
    !installReady ? "Kimi CLI 仍未就绪，建议先完成安装与探测。" : null,
    !contextMenuReady && runtimeContextMenuSupported ? "资源管理器右键菜单尚未启用。" : null,
    !authReady ? "尚未建立登录或 Provider API 入口。" : null,
    !workDirReady ? "默认工作目录未设置，跨会话上下文还不稳定。" : null,
    bridgeStatus.state === "crashed" ? "Bridge 最近出现崩溃，需要优先检查。" : null,
    configCenterDirty ? "配置中心存在未保存修改。" : null,
    bridgeOnboardingDirty ? "Bridge 配置仍有未保存更改。" : null,
  ].filter((item): item is string => Boolean(item));

  function renderOverviewSection() {
    return (
      <div className="cc-overview-shell">
        <section className="cc-card cc-hero-card">
          <div className="cc-hero-layout">
            <div className="cc-hero-main">
              <span className="cc-kicker">Control Center</span>
              <div className="cc-hero-status-strip">
                <article className="cc-signal-card">
                  <span>后端状态</span>
                  <strong>{diagnostics?.state ?? status?.state ?? "-"}</strong>
                </article>
                <article className="cc-signal-card">
                  <span>{bridgeFinalStatusTitle}</span>
                  <strong>{imFinalStatusLabel}</strong>
                </article>
              </div>
              <div className="cc-actions cc-hero-actions">
                <Button
                  type="button"
                  icon={<RefreshCw size={15} />}
                  className="cc-action-btn"
                  onClick={() => {
                    void onRefreshCoreState();
                    void onRefreshDiagnostics();
                    void onRefreshContextMenuStatus();
                  }}
                  disabled={diagnosticsBusy || contextMenuBusy}
                >
                  刷新全部状态
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  icon={<SlidersHorizontal size={15} />}
                  className="cc-action-btn"
                  onClick={() => {
                    void handleOpenOnboardingEntry();
                  }}
                >
                  打开快速设置
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<FolderOpen size={15} />}
                  className="cc-action-btn"
                  onClick={() => void onOpenLogs()}
                >
                  打开日志目录
                </Button>
              </div>
            </div>

            <aside className="cc-hero-aside">
              <div className="cc-editorial-note">
                <span className="cc-kicker">Priority Deck</span>
                <h3>{activeOnboardingStep.title}</h3>
                <p>{overviewBriefs[0] ?? "当前无阻塞项"}</p>
                <div className="cc-chip-row">
                  <span className={`cc-status-badge tone-${activeOnboardingStep.statusTone}`}>
                    {activeOnboardingStep.statusLabel}
                  </span>
                  <span className="cc-quiet-chip">推荐步骤 {activeOnboardingStep.index}</span>
                </div>
                <Button
                  type="button"
                  className="cc-action-btn"
                  onClick={() => {
                    void handleOpenOnboardingEntry();
                  }}
                >
                  继续当前设置
                </Button>
              </div>
            </aside>
          </div>
        </section>

        <section className="cc-overview-columns">
          <div className="cc-overview-main-column">
            <section className="cc-card">
              <header className="cc-card-header">
                <h3>优先任务</h3>
              </header>
              <div className="cc-card-body">
                <div className="cc-task-grid">
                  <button
                    type="button"
                    className="cc-task-card"
                    onClick={() => {
                      void handleOpenOnboardingEntry();
                    }}
                  >
                    <span className="cc-task-card-icon"><SlidersHorizontal size={16} /></span>
                    <span className="cc-task-card-copy">
                      <strong>完成快速设置</strong>
                    </span>
                    <span className="cc-task-card-meta">
                      {completedOnboardingCards}/{onboardingSteps.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="cc-task-card"
                    onClick={() => {
                      void handleOpenRuntimeEntry("core");
                    }}
                  >
                    <span className="cc-task-card-icon"><Activity size={16} /></span>
                    <span className="cc-task-card-copy">
                      <strong>查看运行诊断</strong>
                    </span>
                    <span className="cc-task-card-meta">
                      {runtimeIssues.length > 0 ? `${runtimeIssues.length} 条异常` : "稳定"}
                    </span>
                  </button>

                  <button
                    type="button"
                    className="cc-task-card"
                    onClick={() => {
                      void handleSelectBridgeSection();
                    }}
                  >
                    <span className="cc-task-card-icon"><Play size={16} /></span>
                    <span className="cc-task-card-copy">
                      <strong>{openBridgeTitle}</strong>
                    </span>
                    <span className="cc-task-card-meta">{bridgeStatusLabel}</span>
                  </button>

                  <button
                    type="button"
                    className="cc-task-card"
                    onClick={() => {
                      void handleOpenRuntimeEntry("logs");
                    }}
                  >
                    <span className="cc-task-card-icon"><FileText size={16} /></span>
                    <span className="cc-task-card-copy">
                      <strong>查看最近日志</strong>
                    </span>
                    <span className="cc-task-card-meta">Tail</span>
                  </button>
                </div>
              </div>
            </section>
          </div>

          <aside className="cc-overview-side-column">
            <section className="cc-card">
              <header className="cc-card-header">
                <h3>简报</h3>
              </header>
              <div className="cc-card-body">
                {overviewBriefs.length > 0 ? (
                  <div className="cc-brief-list">
                    {overviewBriefs.map((item) => (
                      <article key={item} className="cc-brief-item">
                        <strong>{item}</strong>
                      </article>
                    ))}
                  </div>
                ) : (
                  <article className="cc-brief-tip-card">
                    <div className="cc-brief-tip-head">
                      <div className="cc-brief-tip-meta">
                        <span className="cc-brief-tip-badge">随机提示</span>
                        <span className="cc-brief-tip-number">{briefTip.numberLabel}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        icon={<RefreshCw size={13} />}
                        className="cc-brief-tip-refresh"
                        onClick={() => setBriefTip(pickRandomAgentTip())}
                        aria-label="刷新提示卡片"
                      />
                    </div>
                    <strong className="cc-brief-tip-title">{briefTip.title}</strong>
                    <p className="cc-brief-tip-body">{briefTip.body}</p>
                  </article>
                )}
              </div>
            </section>
          </aside>
        </section>
      </div>
    );
  }

  function renderOnboardingSection() {
    const selectedStepTone = activeOnboardingStep.statusTone;

    return (
      <div className="cc-onboarding-editorial">
        <aside className="cc-card cc-onboarding-rail">
          <div className="cc-onboarding-rail-head">
            <span className="cc-kicker">Quick Setup</span>
            <h3>快速设置</h3>
          </div>

          <div className="cc-onboarding-progress-block">
            <div className="cc-onboarding-progress-label">
              <span>流程进度</span>
              <strong>{completedOnboardingCards}/{onboardingSteps.length}</strong>
            </div>
            <div className="cc-onboarding-progress-track" aria-hidden>
              <span
                className="cc-onboarding-progress-fill"
                style={{
                  width: `${(completedOnboardingCards / onboardingSteps.length) * 100}%`,
                }}
              />
            </div>
          </div>

          <div className="cc-onboarding-step-list" role="tablist" aria-label="快速设置步骤">
            {onboardingSteps.map((step) => {
              const isActive = step.id === activeOnboardingStep.id;
              return (
                <button
                  key={step.id}
                  type="button"
                  className={`cc-onboarding-step-card ${isActive ? "is-active" : ""} ${step.complete ? "is-complete" : ""}`}
                  onClick={() => toggleOnboardingCard(step.id)}
                  aria-current={isActive ? "step" : undefined}
                >
                  <span className="cc-onboarding-step-index">{step.index}</span>
                  <span className="cc-onboarding-step-copy">
                    <small>{step.eyebrow}</small>
                    <strong>{step.title}</strong>
                  </span>
                  <span className="cc-onboarding-step-meta">
                    <span className={`cc-status-badge tone-${step.statusTone}`}>{step.statusLabel}</span>
                    <span className="cc-quiet-chip">{step.progressLabel}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <section className="cc-onboarding-flow-actions">
            <div className="cc-actions">
              <Button
                type="button"
                icon={<Check size={15} />}
                className="cc-action-btn"
                onClick={() => void onCompleteOnboarding()}
                disabled={actionBusy}
              >
                完成引导
              </Button>
              <Button
                type="button"
                variant="ghost"
                icon={<ChevronRight size={15} />}
                className="cc-action-btn"
                onClick={() => void onSkipOnboarding()}
                disabled={actionBusy}
              >
                暂时跳过
              </Button>
              <Button
                type="button"
                variant="outline"
                icon={<RefreshCcw size={15} />}
                className="cc-action-btn"
                onClick={() => void onRetry()}
                disabled={actionBusy}
              >
                重启后端
              </Button>
              <Button
                type="button"
                variant="ghost"
                icon={<RefreshCw size={15} />}
                className="cc-action-btn"
                onClick={() => {
                  void onRefreshOnboarding();
                  void onRefreshDiagnostics();
                  void onRefreshContextMenuStatus();
                  void onRefreshBridgeSettings();
                  void onRefreshBridgeStatus();
                  void onRefreshBridgeSecretsMask();
                }}
                disabled={diagnosticsBusy || contextMenuBusy}
              >
                刷新运行态数据
              </Button>
            </div>
          </section>
        </aside>

        <section className="cc-card cc-onboarding-detail-shell">
          <div className="cc-onboarding-detail-intro">
            <div>
              <span className="cc-kicker">Now Editing</span>
              <h2>{activeOnboardingStep.title}</h2>
            </div>
            <div className="cc-chip-row">
              <span className={`cc-status-badge tone-${selectedStepTone}`}>
                {activeOnboardingStep.statusLabel}
              </span>
              <span className="cc-quiet-chip">{activeOnboardingStep.progressLabel}</span>
            </div>
          </div>

          <section className="cc-card cc-step-detail-card">
            <ControlCenterCardHeader
              title={`${activeOnboardingStep.index}. ${activeOnboardingStep.title}`}
              statusLabel={activeOnboardingStep.statusLabel}
              statusTone={selectedStepTone}
              primaryAction={activeOnboardingStep.primaryAction}
            />
            <div className="cc-card-body cc-step-body cc-step-body-single">
              <div className="cc-step-main">
                {activeOnboardingStep.id === "install" ? (
                  <>
                    <div className="cc-step-secondary-actions">{installSecondaryAction}</div>
                    <div className="cc-install-top-row">
                      <p className="hint cc-step-summary cc-inline-path">{installSummary}</p>
                      <Button
                        type="button"
                        variant="outline"
                        className="cc-action-btn cc-inline-btn"
                        onClick={() => void onPickKimiPath()}
                      >
                        浏览
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        icon={<Check size={15} />}
                        className="cc-action-btn"
                        onClick={() => void onSavePathAndRetry()}
                        disabled={actionBusy || !kimiPathInput.trim()}
                      >
                        保存路径并重启
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        icon={<FileText size={14} />}
                        className="cc-action-btn"
                        onClick={() =>
                          void onOpenExternalUrl(
                            "https://www.kimi.com/code/docs/kimi-cli/guides/getting-started.html",
                          )
                        }
                      >
                        打开官方文档
                      </Button>
                    </div>
                    {recentInstallSummary ? <p className="hint cc-step-meta">{recentInstallSummary}</p> : null}
                    {installBusy && installAction ? (
                      <p className="hint cc-step-meta">
                        当前动作：
                        {installAction === "dependencies"
                          ? "安装依赖"
                          : installAction === "kimi"
                            ? "安装 Kimi"
                            : installAction === "upgrade_kimi"
                              ? "升级 Kimi"
                              : "安装 Node.js"}
                      </p>
                    ) : null}
                    {installMessage ? <p className="hint cc-step-meta">{installMessage}</p> : null}
                  </>
                ) : null}

                {activeOnboardingStep.id === "context_menu" ? renderContextMenuStepContent() : null}

                {activeOnboardingStep.id === "auth" ? (
                  <>
                    {authSecondaryAction ? (
                      <div className="cc-step-secondary-actions">{authSecondaryAction}</div>
                    ) : null}
                    <div className="cc-auth-switch" role="group" aria-label="登录与 API 配置切换">
                      <button
                        type="button"
                        className={`cc-auth-switch-btn ${authCardView === "login" ? "active" : ""}`}
                        onClick={() => setAuthCardView("login")}
                      >
                        Kimi 登录
                      </button>
                      <button
                        type="button"
                        className={`cc-auth-switch-btn ${authCardView === "api" ? "active" : ""}`}
                        onClick={() => setAuthCardView("api")}
                      >
                        Provider API
                      </button>
                    </div>

                    {authCardView === "login" ? (
                      <div className="cc-auth-panel">
                        <p className="hint cc-step-summary">
                          当前状态：{formatLoginState(onboarding?.loginState)}
                        </p>
                      </div>
                    ) : (
                      <div className="cc-auth-panel">
                        <p className="hint cc-step-summary">
                          已配置 providers：<strong>{configCenterView?.providers.length ?? 0}</strong>；
                          models：<strong>{configCenterView?.models.length ?? 0}</strong>；
                          services：<strong>{configCenterView?.services.length ?? 0}</strong>
                        </p>
                        <div className="cc-api-inline-actions">
                          <Button
                            type="button"
                            variant="outline"
                            icon={<Check size={14} />}
                            className="cc-action-btn"
                            onClick={() => void onOpenConfigCenterModal()}
                            disabled={configCenterBusy}
                          >
                            打开配置中心弹窗
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            icon={<FolderOpen size={14} />}
                            className="cc-action-btn"
                            onClick={() => void onOpenKimiConfigDir()}
                          >
                            打开配置目录
                          </Button>
                        </div>
                        <p className="hint cc-step-meta">
                          配置文件：
                          <strong>{configCenterView?.configPath || "~/.kimi/config.toml"}</strong>
                        </p>
                        {configCenterDirty ? (
                          <p className="hint cc-step-meta">配置中心弹窗内存在未保存修改。</p>
                        ) : null}
                        {configCenterView?.warnings?.length ? (
                          <p className="hint cc-step-meta">当前警告：{configCenterView.warnings[0]}</p>
                        ) : null}
                        <p className="hint cc-step-meta">保存成功后将自动标记本步骤完成。</p>
                      </div>
                    )}
                  </>
                ) : null}

                {activeOnboardingStep.id === "work_dir" ? renderWorkDirStepContent() : null}
              </div>
            </div>
          </section>
        </section>
      </div>
    );
  }

  function renderRuntimeSection() {
    return (
      <div className="cc-runtime-shell">
        <section className="cc-card cc-runtime-hero">
          <div className="cc-runtime-summary-grid">
            <article className="cc-runtime-summary-card">
              <span>核心运行</span>
              <strong>{diagnostics?.state ?? "-"}</strong>
              <Button
                type="button"
                variant="ghost"
                className="cc-action-btn"
                onClick={() => {
                  void handleSelectRuntimePanel("core");
                }}
              >
                打开核心诊断
              </Button>
            </article>
            <article className="cc-runtime-summary-card">
              <span>路径与菜单</span>
              <strong>
                {runtimeContextMenuSupported
                  ? runtimeContextMenuEnabled
                    ? "就绪"
                    : "待办"
                  : "不支持"}
              </strong>
              <Button
                type="button"
                variant="ghost"
                className="cc-action-btn"
                onClick={() => {
                  void handleSelectRuntimePanel("paths");
                }}
              >
                打开路径面板
              </Button>
            </article>
            <article className="cc-runtime-summary-card">
              <span>日志尾部</span>
              <strong>
                {diagnostics?.backendLogTail?.length ?? diagnostics?.appLogTail?.length ?? 0} 行
              </strong>
              <Button
                type="button"
                variant="ghost"
                className="cc-action-btn"
                onClick={() => {
                  void handleSelectRuntimePanel("logs");
                }}
              >
                查看最近日志
              </Button>
            </article>
          </div>
        </section>

        <section className="cc-runtime-columns">
          <section className="cc-card">
            <header className="cc-card-header">
              <h3>风险摘要</h3>
            </header>
            <div className="cc-card-body">
              <div className="cc-runtime-issue-list">
                {(runtimeIssues.length > 0 ? runtimeIssues : ["当前无异常"]).map((issue) => (
                  <article key={issue} className="cc-runtime-issue-item">
                    <strong>{issue}</strong>
                  </article>
                ))}
              </div>
              <div className="cc-actions">
                <Button
                  type="button"
                  icon={<RefreshCw size={15} />}
                  className="cc-action-btn"
                  onClick={() => void onRefreshDiagnostics()}
                  disabled={diagnosticsBusy}
                >
                  刷新诊断
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<RefreshCcw size={15} />}
                  className="cc-action-btn"
                  onClick={() => void onRefreshContextMenuStatus()}
                  disabled={contextMenuBusy}
                >
                  刷新右键菜单状态
                </Button>
              </div>
            </div>
          </section>

          <section className="cc-card">
            <header className="cc-card-header">
              <h3>最近输出</h3>
            </header>
            <div className="cc-card-body">
              <pre className="log-tail cc-log-snippet">{condensedLogPreview}</pre>
            </div>
          </section>
        </section>

        <section className="cc-card runtime-accordion cc-runtime-deep-dive">
          <div className="cc-runtime-deep-dive-head">
            <div>
              <span className="cc-kicker">Deep Dive</span>
              <h3>运行面板</h3>
            </div>
          </div>

          <RuntimePanel active={runtimePanelExpanded && activeRuntimePanel === "core"} onOpen={() => { void handleSelectRuntimePanel("core"); }} title="核心运行诊断">
            <div className="cc-actions">
              <Button type="button" icon={<RefreshCw size={15} />} className="cc-action-btn" onClick={() => void onRefreshDiagnostics()} disabled={diagnosticsBusy}>刷新诊断</Button>
              <Button type="button" variant="ghost" icon={<RefreshCcw size={15} />} className="cc-action-btn" onClick={() => void onRefreshContextMenuStatus()} disabled={contextMenuBusy}>刷新右键菜单状态</Button>
            </div>
            <div className="diagnostics-grid">
              <DiagnosticItem label="State" value={diagnostics?.state ?? "-"} />
              <DiagnosticItem label="Active Port" value={String(diagnostics?.activePort ?? "-")} />
              <DiagnosticItem label="Workspace Port" value={String(diagnostics?.workspacePort ?? "-")} />
              <DiagnosticItem label="Base Port" value={String(diagnostics?.basePort ?? "-")} />
              <DiagnosticItem label="Instance ID" value={diagnostics?.instanceId ?? "-"} />
              <DiagnosticItem label="PID" value={String(diagnostics?.pid ?? "-")} />
              <DiagnosticItem label="Start Cycle ID" value={String(diagnostics?.startCycleId ?? "-")} />
              <DiagnosticItem label="Hotkey Owner" value={String(diagnostics?.isHotkeyOwner ?? false)} />
              <DiagnosticItem label="Shell to Loading (ms)" value={String(diagnostics?.loadingStartupMs ?? "-")} />
              <DiagnosticItem label="Backend Ready (ms)" value={String(diagnostics?.backendReadyMs ?? "-")} />
              <DiagnosticItem label="Loading SLA Met" value={String(diagnostics?.loadingSlaMet ?? "-")} />
              <DiagnosticItem label="CLI Contract OK" value={String(diagnostics?.cliContractOk ?? "-")} />
              <DiagnosticItem label="CLI Contract Error" value={diagnostics?.cliContractError ?? "-"} />
              <DiagnosticItem label="Kimi Version" value={diagnostics?.kimiVersion ?? "-"} />
              <DiagnosticItem label="Version Check Error" value={diagnostics?.versionError ?? "-"} />
              <DiagnosticItem label="Last Error" value={diagnostics?.lastError ?? "-"} />
              <DiagnosticItem label="Last Exit Reason" value={diagnostics?.lastExitReason ?? "-"} />
              <DiagnosticItem label="WebView Runtime" value={diagnostics?.webviewRuntimeKind ?? "-"} />
              <DiagnosticItem label="WebView Version" value={diagnostics?.webviewRuntimeVersion ?? "-"} />
              <DiagnosticItem label="Startup Pending" value={String(diagnostics?.startupPending ?? false)} />
              <DiagnosticItem label="Startup Exit Cause" value={diagnostics?.startupExitCause ?? "-"} />
              <DiagnosticItem label="Main Create Mode" value={diagnostics?.mainCreateMode ?? "-"} />
              <DiagnosticItem label="Startup Attempt ID" value={String(diagnostics?.startupAttemptId ?? "-")} />
              <DiagnosticItem label="Startup Phase" value={diagnostics?.startupPhase ?? "-"} />
              <DiagnosticItem label="Startup Failure Kind" value={diagnostics?.startupFailureKind ?? "-"} />
              <DiagnosticItem label="Startup Failure Detail" value={diagnostics?.startupFailureDetail ?? "-"} />
              <DiagnosticItem label="Startup Monitor State" value={diagnostics?.startupMonitorState ?? "-"} />
              <DiagnosticItem label="Startup Monitor Reason" value={diagnostics?.startupMonitorReason ?? "-"} />
              <DiagnosticItem label="Startup Monitor Target" value={diagnostics?.startupMonitorTargetRoute ?? "-"} />
              <DiagnosticItem label="Startup Monitor Detail" value={diagnostics?.startupMonitorDetail ?? "-"} />
            </div>
            <h4 className="log-tail-title">最近启动轨迹</h4>
            <pre className="log-tail">{diagnostics?.startupTrace && diagnostics.startupTrace.length > 0 ? diagnostics.startupTrace.join("\n") : "暂无启动轨迹。"}</pre>
          </RuntimePanel>

          <RuntimePanel active={runtimePanelExpanded && activeRuntimePanel === "paths"} onOpen={() => { void handleSelectRuntimePanel("paths"); }} title="路径与上下文菜单">
            <p className="hint">右键菜单：{contextMenuStatusLabel}</p>
            {contextMenuStatus?.message && <p className="hint">{contextMenuStatus.message}</p>}
            <div className="cc-actions">
              <Button type="button" icon={<Plus size={15} />} className="cc-action-btn" onClick={() => void onEnableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>启用右键菜单</Button>
              <Button type="button" variant="ghost" icon={<Minus size={15} />} className="cc-action-btn" onClick={() => void onDisableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>禁用右键菜单</Button>
              <Button type="button" variant="ghost" icon={<FolderOpen size={15} />} className="cc-action-btn" onClick={() => void onOpenLogs()}>打开日志目录</Button>
            </div>
            <div className="cc-runtime-close-behavior">
              <h4 className="log-tail-title">关闭窗口行为</h4>
              <p className="hint">仅主窗口生效（prefill 不变）</p>
              <div className="cc-auth-switch" role="group" aria-label="关闭窗口行为">
                {mainWindowCloseBehaviorOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`cc-auth-switch-btn ${
                      mainWindowCloseBehavior === option.value ? "active" : ""
                    }`}
                    onClick={() => {
                      void handleSelectMainWindowCloseBehavior(option.value);
                    }}
                    disabled={mainCloseBehaviorSaving || actionBusy}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="diagnostics-grid">
              <DiagnosticItem label="Started At (Epoch UTC)" value={diagnostics?.startedAt ?? "-"} />
              <DiagnosticItem label="Configured Kimi Path" value={diagnostics?.configuredKimiPath ?? "-"} />
              <DiagnosticItem label="Detected Kimi Path" value={diagnostics?.detectedKimiPath ?? "-"} />
              <DiagnosticItem label="Configured Work Dir" value={diagnostics?.configuredWorkDir ?? "-"} />
              <DiagnosticItem label="Effective Work Dir" value={diagnostics?.effectiveWorkDir ?? "-"} />
              <DiagnosticItem label="Launch Command" value={diagnostics?.launchCommand ?? "-"} />
              <DiagnosticItem label="App Log Path" value={diagnostics?.appLogPath ?? "-"} />
              <DiagnosticItem label="Backend Log Path" value={diagnostics?.backendLogPath ?? "-"} />
              <DiagnosticItem label="Logs Directory" value={diagnostics?.logsDir ?? "-"} />
            </div>
          </RuntimePanel>

          <RuntimePanel active={runtimePanelExpanded && activeRuntimePanel === "logs"} onOpen={() => { void handleSelectRuntimePanel("logs"); }} title="最近日志">
            <h4 className="log-tail-title">最近应用日志</h4>
            <pre className="log-tail">{diagnostics?.appLogTail && diagnostics.appLogTail.length > 0 ? diagnostics.appLogTail.join("\n") : "暂无应用日志。"}</pre>
            <h4 className="log-tail-title">最近后端日志</h4>
            <pre className="log-tail">{diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0 ? diagnostics.backendLogTail.join("\n") : "暂无后端日志。"}</pre>
          </RuntimePanel>
        </section>
      </div>
    );
  }

  function renderBridgeSection() {
    return (
      <div className="cc-bridge-shell">
        <section className="cc-card">
          <header className="cc-card-header">
            <h3>{bridgeDisplayName}</h3>
          </header>
          <div className="cc-card-body cc-step-body cc-step-body-single">
            {renderBridgeStepContent()}
          </div>
        </section>

        <section className="cc-card">
          <ControlCenterCardHeader
            title={bridgeRuntimePanelTitle}
            description="展开后查看运行配置、sessions、bindings、审批和日志。"
            statusLabel={bridgeStatusLabel}
            statusTone={bridgeRuntimeTone}
            collapsible
            expanded={bridgeRuntimePanelExpanded}
            onToggle={() => setBridgeRuntimePanelExpanded((current) => !current)}
          />
          {bridgeRuntimePanelExpanded ? (
            <div className="cc-card-body">
              <BridgeRuntimePanel
                settings={bridgeSettings}
                status={bridgeStatus}
                sessions={bridgeSessions}
                bindings={bridgeBindings}
                approvals={bridgeApprovals}
                logTail={bridgeLogTail}
                recentErrors={bridgeRecentErrors}
                secretsMask={bridgeSecretsMask}
                busy={bridgeBusy}
                onSettingsChange={onBridgeSettingsChange}
                onSave={onSaveBridgeSettings}
                onStart={onStartBridge}
                onStop={onStopBridge}
                onRestart={onRestartBridge}
                onRefreshStatus={onRefreshBridgeStatus}
                onRefreshSessions={onRefreshBridgeSessions}
                onRefreshBindings={onRefreshBridgeBindings}
                onRefreshApprovals={onRefreshBridgeApprovals}
                onRefreshLogTail={onRefreshBridgeLogTail}
                onRefreshSecretsMask={onRefreshBridgeSecretsMask}
                onOpenLogs={onOpenLogs}
                onImportSession={onImportBridgeSession}
                onClearBinding={onClearBridgeBinding}
                onResetBindingSession={onResetBridgeBindingSession}
                onResolveApproval={onResolveBridgeApproval}
              />
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <section
      className={`control-center-shell ${surface === "modal" ? "control-center-shell-modal" : ""}`}
    >
      <header className="cc-modal-header">
        <div className="cc-modal-title">
          <h3>控制中心</h3>
        </div>
        <nav className="cc-header-tabs" aria-label="控制中心主导航">
          {controlSections.map((section) => (
            <Button
              key={section.id}
              type="button"
              variant="ghost"
              size="sm"
              className={`cc-header-tab ${activeControlSection === section.id ? "active" : ""}`}
              icon={section.icon}
              onClick={() => {
                void handleSelectControlSection(section.id);
              }}
            >
              {section.id === "bridge_center" ? bridgeDisplayName : section.label}
            </Button>
          ))}
        </nav>
        {surface === "modal" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            icon={<X size={16} />}
            className="cc-modal-close-btn"
            onClick={onClose}
            aria-label="关闭控制中心"
          />
        ) : null}
      </header>

      <div className="cc-layout cc-layout-dashboard">

        <div
          className={`cc-main ${
            isOnboardingSection ? "cc-main-onboarding" : ""
          }`}
        >
          {activeControlSection === "overview" ? renderOverviewSection() : null}
          {activeControlSection === "onboarding" ? renderOnboardingSection() : null}
          {activeControlSection === "runtime_center" ? renderRuntimeSection() : null}
          {activeControlSection === "bridge_center" ? renderBridgeSection() : null}
        </div>
      </div>
      <BridgeConfigModal
        open={bridgeConfigOpen}
        busy={bridgeBusy}
        dirty={bridgeOnboardingDirty}
        titleLabel={bridgeConfigTitle}
        draft={bridgeOnboardingDraft}
        validation={bridgeOnboardingValidation}
        status={bridgeStatus}
        secretsMask={bridgeSecretsMask}
        onClose={() => setBridgeConfigOpen(false)}
        onDraftChange={onBridgeOnboardingDraftChange}
        onSave={onSaveBridgeOnboarding}
        onStartBridge={onStartBridge}
        onRefreshStatus={onRefreshBridgeStatus}
        onRefreshSecretsMask={onRefreshBridgeSecretsMask}
      />
      <ConfigCenterModal
        open={configCenterOpen}
        busy={configCenterBusy || actionBusy}
        dirty={configCenterDirty}
        view={configCenterView}
        draft={configCenterDraft}
        onDraftChange={onConfigCenterDraftChange}
        onClose={onCloseConfigCenterModal}
        onSave={onSaveKimiCliConfigCenter}
        onReset={onResetConfigCenterDraft}
        onOpenConfigDir={onOpenKimiConfigDir}
      />
      <InstallFlowModal
        open={installFlowOpen}
        catalog={installFlowCatalog}
        session={installSessionSnapshot}
        probe={installProbe}
        backendState={status?.state ?? null}
        installSource={installSource}
        installSettings={installSettings}
        installSettingsBusy={installSettingsBusy}
        powershellPreflight={powershellPreflight}
        onClose={onCloseInstallFlow}
        onRefreshProbe={onRefreshInstallProbe}
        onRefreshPowerShellPreflight={onRefreshPowerShellPreflight}
        onSourceChange={onInstallSourceChange}
        onSaveInstallSettings={onSaveInstallSettings}
        onStartTask={onStartInstallTask}
        onCancelTask={onCancelInstallTask}
        onRestartBackend={onRetry}
        restartBusy={actionBusy}
      />
    </section>
  );
}
