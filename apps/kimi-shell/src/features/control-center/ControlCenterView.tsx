import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Eraser,
  FileText,
  FolderOpen,
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
  BridgeSecretsMaskView,
  BridgeSettings,
  BridgeStatus,
  ControlCenterChrome,
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
  OnboardingStatus,
  PowerShellPreflightSummary,
  RuntimePanelId,
} from "@/app/types";
import {
  formatLoginState,
  ONBOARDING_STEP_ORDER,
} from "@/app/types";
import { DiagnosticItem } from "@/components/common/DiagnosticItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BridgeRuntimePanel } from "@/features/bridge/BridgeRuntimePanel";
import { ControlCenterCardHeader } from "@/features/control-center/ControlCenterCardHeader";
import { ConfigCenterModal } from "@/features/control-center/ConfigCenterModal";
import { InstallFlowModal } from "@/features/control-center/InstallFlowModal";
import { ControlCenterModalShell } from "@/features/control-center/ControlCenterModalShell";

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type OnboardingCardId =
  | "install"
  | "context_menu"
  | "auth"
  | "work_dir"
  | "bridge";

type ControlCenterViewProps = {
  surface: ControlCenterSurface;
  chrome: ControlCenterChrome;
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
  installBusy: boolean;
  installAction: "dependencies" | "kimi" | "upgrade_kimi" | "nodejs" | null;
  bridgeSettings: BridgeSettings;
  bridgeStatus: BridgeStatus;
  bridgeOnboardingDraft: BridgeOnboardingConfigInput;
  bridgeOnboardingDirty: boolean;
  bridgeOnboardingValidation: BridgeOnboardingValidation;
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
  onRefreshBridgeBindings: () => Promise<BindingRecord[]>;
  onRefreshBridgeApprovals: () => Promise<BridgeApprovalRecord[]>;
  onRefreshBridgeLogTail: () => Promise<string[]>;
  onRefreshBridgeSecretsMask: () => Promise<BridgeSecretsMaskView>;
  onRefreshInstallProbe: () => Promise<InstallProbeStatus>;
  onRefreshOnboarding: () => Promise<void>;
  onClose: () => void;
  onOpenOnboardingFromDashboard: () => Promise<void>;
  onOpenRuntimePanelFromDashboard: (panel: RuntimePanelId) => Promise<void>;
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
  onSaveWorkDirAndRestart: () => Promise<void>;
  onClearWorkDir: () => Promise<void>;
  onBridgeSettingsChange: (next: BridgeSettings) => void;
  onBridgeOnboardingDraftChange: (next: BridgeOnboardingConfigInput) => void;
  onSaveBridgeOnboarding: () => Promise<void>;
  onSaveBridgeSettings: () => Promise<void>;
  onStartBridge: () => Promise<void>;
  onStopBridge: () => Promise<void>;
  onRestartBridge: () => Promise<void>;
  onClearBridgeBinding: (bindingId: string) => Promise<void>;
  onResolveBridgeApproval: (approvalId: string, status: string) => Promise<void>;
  onOpenConfigCenterModal: () => Promise<void>;
  onCloseConfigCenterModal: () => void;
  onConfigCenterDraftChange: (next: KimiCliConfigCenterInput) => void;
  onResetConfigCenterDraft: () => void;
  onSaveKimiCliConfigCenter: () => Promise<void>;
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
  description: string;
  icon: ReactNode;
}> = [
  {
    id: "overview",
    label: "概览",
    description: "统计与导航入口",
    icon: <LayoutDashboard size={15} />,
  },
  {
    id: "onboarding",
    label: "引导配置",
    description: "安装与初始化流程",
    icon: <SlidersHorizontal size={15} />,
  },
  {
    id: "runtime_center",
    label: "运行与日志",
    description: "诊断、路径、日志",
    icon: <Activity size={15} />,
  },
];

function BridgeConfigModal({
  open,
  busy,
  dirty,
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
      title="Bridge 配置"
      description="在这里维护 Bridge 与 Feishu 长连接配置；保存凭据只代表 sidecar 可以尝试连接，平台是否检测到应用连接仍要看长连接和权限是否真正建立。"
      ariaLabel="Bridge 配置"
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
          <strong>{draft.enabled ? "已启用（Enabled）" : "未启用（Disabled）"}</strong>
        </div>
        <div className="diag-item">
          <span className="diag-label">Feishu 开关（Feishu Enabled）</span>
          <strong>{draft.feishuEnabled ? "已启用（Enabled）" : "未启用（Disabled）"}</strong>
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
  description,
  children,
}: {
  active: boolean;
  onOpen: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className={`runtime-panel ${active ? "active" : ""}`}>
      <button type="button" className="runtime-panel-head" onClick={onOpen}>
        <div className="runtime-panel-title">
          <h3>{title}</h3>
          <p>{description}</p>
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
      return "运行中（Running）";
    case "starting":
      return "启动中（Starting）";
    case "degraded":
      return "降级运行（Degraded）";
    case "stopping":
      return "停止中（Stopping）";
    case "crashed":
      return "已崩溃（Crashed）";
    default:
      return "已停止（Stopped）";
  }
}

function formatBridgeChannelStateLabel(state: string): string {
  switch (state) {
    case "ready":
      return "就绪（Ready）";
    case "connecting":
      return "连接中（Connecting）";
    case "degraded":
      return "降级（Degraded）";
    case "error":
      return "错误（Error）";
    default:
      return "空闲（Idle）";
  }
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
  chrome,
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
  installBusy,
  installAction,
  bridgeSettings,
  bridgeStatus,
  bridgeOnboardingDraft,
  bridgeOnboardingDirty,
  bridgeOnboardingValidation,
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
  onRefreshBridgeBindings,
  onRefreshBridgeApprovals,
  onRefreshBridgeLogTail,
  onRefreshBridgeSecretsMask,
  onRefreshInstallProbe,
  onRefreshOnboarding,
  onClose,
  onOpenOnboardingFromDashboard,
  onOpenRuntimePanelFromDashboard,
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
  onSaveWorkDirAndRestart,
  onClearWorkDir,
  onBridgeSettingsChange,
  onBridgeOnboardingDraftChange,
  onSaveBridgeOnboarding,
  onSaveBridgeSettings,
  onStartBridge,
  onStopBridge,
  onRestartBridge,
  onClearBridgeBinding,
  onResolveBridgeApproval,
  onOpenConfigCenterModal,
  onCloseConfigCenterModal,
  onConfigCenterDraftChange,
  onResetConfigCenterDraft,
  onSaveKimiCliConfigCenter,
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
  const [expandedOnboardingCard, setExpandedOnboardingCard] =
    useState<OnboardingCardId | null>(null);
  const [runtimePanelExpanded, setRuntimePanelExpanded] = useState(true);
  const onboardingCardRefs = useRef<Record<OnboardingCardId, HTMLElement | null>>({
    install: null,
    context_menu: null,
    auth: null,
    work_dir: null,
    bridge: null,
  });
  const completedSteps = ONBOARDING_STEP_ORDER.filter(
    (step) => stepCompletion[step],
  ).length;
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
  const showSidebar = surface === "fullscreen" || chrome === "full";
  const isDashboardOnlyModal = surface === "modal" && chrome === "dashboard";
  const runtimeContextMenuSupported =
    contextMenuStatus?.supported ?? onboarding?.contextMenuSupported ?? false;
  const runtimeContextMenuEnabled =
    contextMenuStatus?.enabled ?? onboarding?.contextMenuEnabled ?? false;
  const overviewContextMenuLabel = onboarding?.contextMenuSupported
    ? onboarding.contextMenuEnabled
      ? "已启用"
      : "未启用"
    : onboarding
      ? "不支持"
      : "-";
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
  const bridgeOnboardingStartDisabled =
    bridgeBusy || isBridgeRunning || !bridgeOnboardingValidation.canStart;
  const installHeaderSummary = onboarding?.kimiInstalled
    ? `当前状态：Kimi CLI 已安装${installPathDisplay ? `（${installPathDisplay}）` : ""}；建议按需打开安装与升级查看环境细节。`
    : `当前状态：Kimi CLI 未就绪；建议打开安装与升级弹窗完成依赖检查和安装。`;
  const contextMenuHeaderSummary = !runtimeContextMenuSupported
    ? "当前状态：当前平台不支持资源管理器右键菜单。"
    : runtimeContextMenuEnabled
      ? `当前状态：右键菜单已启用${contextMenuStatus?.message ? `；${contextMenuStatus.message}` : ""}`
      : `当前状态：右键菜单未启用${contextMenuStatus?.message ? `；${contextMenuStatus.message}` : ""}；可直接在卡片内启用。`;
  const authHeaderSummary = `当前状态：登录 ${formatLoginState(onboarding?.loginState)}；providers ${configCenterView?.providers.length ?? 0}，models ${configCenterView?.models.length ?? 0}，API 配置${onboarding?.apiConfigAck ? "已确认" : "未确认"}。`;
  const workDirHeaderSummary = effectiveWorkDir
    ? `当前状态：工作目录已配置为 ${effectiveWorkDir}；可直接在卡片内修改。`
    : "当前状态：尚未配置默认工作目录；可直接在卡片内浏览并保存。";
  const bridgeHeaderSummary = `当前状态：bridge ${bridgeStatus.state}，Feishu ${feishuChannelStatus?.state ?? "idle"}，bridge ${bridgeEnabled ? "已启用" : "未启用"}，Feishu ${feishuEnabled ? "已启用" : "未启用"}。`;
  const installStatusLabel = onboarding?.kimiInstalled ? "已安装" : "待安装";
  const installStatusTone = onboarding?.kimiInstalled ? "success" : "warning";
  const contextMenuStatusLabel = !runtimeContextMenuSupported
    ? "不支持"
    : runtimeContextMenuEnabled
      ? "已启用"
      : "待启用";
  const contextMenuStatusTone = !runtimeContextMenuSupported
    ? "neutral"
    : runtimeContextMenuEnabled
      ? "success"
      : "warning";
  const authStatusLabel =
    onboarding?.loginState === "logged_in"
      ? "已登录"
      : onboarding?.apiConfigAck
        ? "待登录"
        : "待配置";
  const authStatusTone =
    onboarding?.loginState === "logged_in"
      ? "success"
      : onboarding?.apiConfigAck
        ? "warning"
        : "neutral";
  const workDirStatusLabel = effectiveWorkDir ? "已配置" : "待配置";
  const workDirStatusTone = effectiveWorkDir ? "success" : "warning";
  const bridgeStatusLabel =
    bridgeStatus.state === "running" || bridgeStatus.state === "degraded"
      ? "运行中"
      : bridgeStatus.state === "starting"
        ? "启动中"
        : bridgeEnabled || feishuEnabled
          ? "已配置"
          : "未配置";
  const bridgeStatusTone =
    bridgeStatus.state === "running" || bridgeStatus.state === "degraded"
      ? "success"
      : bridgeStatus.state === "starting"
        ? "warning"
        : bridgeEnabled || feishuEnabled
          ? "neutral"
          : "warning";
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

  function toggleOnboardingCard(cardId: OnboardingCardId) {
    setExpandedOnboardingCard((current) => (current === cardId ? null : cardId));
  }

  useEffect(() => {
    if (activeControlSection === "onboarding") {
      return;
    }
    setExpandedOnboardingCard(null);
  }, [activeControlSection]);

  useEffect(() => {
    if (activeControlSection !== "onboarding" || !expandedOnboardingCard) {
      return;
    }
    const target = onboardingCardRefs.current[expandedOnboardingCard];
    if (!target) {
      return;
    }
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start", inline: "nearest" });
    });
  }, [activeControlSection, expandedOnboardingCard]);

  useEffect(() => {
    if (activeControlSection === "runtime_center") {
      setRuntimePanelExpanded(true);
      return;
    }
    setRuntimePanelExpanded(false);
  }, [activeControlSection]);

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

  const bridgePrimaryAction = (
    <Button
      type="button"
      icon={<Play size={15} />}
      className="cc-action-btn"
      onClick={() => void onStartBridge()}
      disabled={bridgeOnboardingStartDisabled}
    >
      启动 Bridge
    </Button>
  );

  async function handleOpenOnboardingEntry() {
    if (isDashboardOnlyModal) {
      await onOpenOnboardingFromDashboard();
      return;
    }
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
    if (isDashboardOnlyModal) {
      await onOpenRuntimePanelFromDashboard(panel);
      return;
    }
    await handleSelectRuntimePanel(panel);
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
    await handleSelectRuntimePanel("paths");
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
            Bridge 开关：{bridgeOnboardingDraft.enabled ? "已启用" : "未启用"}
          </span>
          <span className={`cc-status-badge tone-${bridgeOnboardingDraft.feishuEnabled ? "success" : "neutral"}`}>
            飞书开关：{bridgeOnboardingDraft.feishuEnabled ? "已启用" : "未启用"}
          </span>
        </div>
        <div className="cc-bridge-onboarding-switches">
          <label className="bridge-switch-card">
            <span className="bridge-switch-copy">
              <strong>自动启动（Auto Start）</strong>
              <small>应用启动后自动拉起 Bridge sidecar。</small>
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
        </div>

        <p
          className={`hint cc-step-meta cc-bridge-onboarding-message ${
            bridgeOnboardingValidation.canStart ? "" : "is-error"
          }`}
        >
          {bridgeOnboardingValidation.message ??
            "配置保存后，可直接在这里启动或停止 bridge。"}
        </p>

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
            onClick={() => setBridgeConfigOpen(true)}
            disabled={bridgeBusy}
          >
            打开 Bridge 配置
          </Button>
        </div>
        <div className="cc-danger-group">
          <div className="cc-danger-group-label">
            <span>危险操作</span>
            <small>会停止当前 bridge 或触发重连。</small>
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

  return (
    <section
      className={`control-center-shell ${surface === "modal" ? "control-center-shell-modal" : ""} ${isDashboardOnlyModal ? "control-center-shell-dashboard" : ""}`}
    >
      {surface === "modal" ? (
        <header className="cc-modal-header">
          <div className="cc-modal-title">
            <h3>控制中心</h3>
            <p>{showSidebar ? "引导配置、诊断与日志管理。" : "运行概览与控制中心入口。"}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            icon={<X size={16} />}
            onClick={onClose}
            aria-label="关闭控制中心"
          />
        </header>
      ) : null}
      <div className={`cc-layout ${showSidebar ? "" : "cc-layout-dashboard"}`}>
        {showSidebar ? (
        <aside className="cc-sidebar">
          <nav className="cc-nav" aria-label="Control center sections">
            {controlSections.map((section) => (
              <Button
                key={section.id}
                type="button"
                variant="ghost"
                size="sm"
                className={`cc-nav-btn ${activeControlSection === section.id ? "active" : ""}`}
                icon={section.icon}
                onClick={() => {
                  void handleSelectControlSection(section.id);
                }}
              >
                <span className="cc-nav-text">
                  <span className="cc-nav-label">{section.label}</span>
                  <span className="cc-nav-desc">{section.description}</span>
                </span>
              </Button>
            ))}
          </nav>
        </aside>
        ) : null}

        <div
          className={`cc-main ${isDashboardOnlyModal ? "cc-main-dashboard" : ""} ${
            isOnboardingSection ? "cc-main-onboarding" : ""
          }`}
        >
          {activeControlSection === "overview" && (
            <>
              <section className="cc-card">
                <header className="cc-card-header">
                  <h3>Dashboard</h3>
                  <p>运行统计、健康状态与高频动作入口。</p>
                </header>
                <div className="cc-card-body">
                  <div className="cc-dashboard-grid">
                    <article className="cc-metric-card">
                      <span>后端状态</span>
                      <strong>{diagnostics?.state ?? status?.state ?? "-"}</strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>活动端口</span>
                      <strong>
                        {String(diagnostics?.activePort ?? status?.activePort ?? "-")}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>工作区端口</span>
                      <strong>
                        {String(
                          diagnostics?.workspacePort ?? status?.workspacePort ?? "-",
                        )}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>后端就绪(ms)</span>
                      <strong>
                        {String(
                          diagnostics?.backendReadyMs ?? status?.backendReadyMs ?? "-",
                        )}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>引导完成度</span>
                      <strong>
                        {completedSteps}/{ONBOARDING_STEP_ORDER.length}
                      </strong>
                    </article>
                    <article className="cc-metric-card">
                      <span>右键菜单</span>
                      <strong>{overviewContextMenuLabel}</strong>
                    </article>
                  </div>
                  <div className="cc-actions">
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
                      icon={<FolderOpen size={15} />}
                      className="cc-action-btn"
                      onClick={() => void onOpenLogs()}
                    >
                      打开日志目录
                    </Button>
                  </div>
                </div>
              </section>

              <section className="cc-card">
                <header className="cc-card-header">
                  <h3>模块入口</h3>
                  <p>快速进入引导配置、诊断与日志模块。</p>
                </header>
                <div className="cc-card-body">
                  <div className="cc-entry-actions">
                    <Button
                      type="button"
                      icon={<SlidersHorizontal size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenOnboardingEntry();
                      }}
                    >
                      进入引导配置
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<Activity size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenRuntimeEntry("core");
                      }}
                    >
                      进入核心诊断
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<FileText size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenRuntimeEntry("paths");
                      }}
                    >
                      进入路径与菜单
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={<FileText size={15} />}
                      className="cc-action-btn"
                      onClick={() => {
                        void handleOpenRuntimeEntry("logs");
                      }}
                    >
                      进入最近日志
                    </Button>
                  </div>
                </div>
              </section>
            </>
          )}

          {activeControlSection === "onboarding" && (
            <div className="cc-onboarding-layout">
              <div className="cc-onboarding-scroll">
                <section
                  className="cc-card cc-step-card"
                  ref={(node) => {
                    onboardingCardRefs.current.install = node;
                  }}
                >
                  <ControlCenterCardHeader
                    title="1. 安装 Kimi CLI"
                    description={installHeaderSummary}
                    statusLabel={installStatusLabel}
                    statusTone={installStatusTone}
                    collapsible
                    expanded={expandedOnboardingCard === "install"}
                    onToggle={() => toggleOnboardingCard("install")}
                    primaryAction={
                      <Button
                        type="button"
                        icon={<Plus size={15} />}
                        className="cc-action-btn"
                        onClick={() => void onOpenInstallFlow()}
                        disabled={installBusy}
                      >
                        打开安装与升级
                      </Button>
                    }
                  />
                  {expandedOnboardingCard === "install" && (
                    <div className="cc-card-body cc-step-body cc-step-body-single">
                      <div className="cc-step-main">
                        <div className="cc-step-secondary-actions">
                          {installSecondaryAction}
                        </div>
                        <div className="cc-install-top-row">
                          <p className="hint cc-step-summary cc-inline-path">
                            {installSummary}
                          </p>
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
                        {recentInstallSummary ? (
                          <p className="hint cc-step-meta">{recentInstallSummary}</p>
                        ) : null}
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
                      </div>
                    </div>
                  )}
                </section>

                <section
                  className="cc-card cc-step-card"
                  ref={(node) => {
                    onboardingCardRefs.current.context_menu = node;
                  }}
                >
                  <ControlCenterCardHeader
                    title="2. 资源管理器右键菜单"
                    description={contextMenuHeaderSummary}
                    statusLabel={contextMenuStatusLabel}
                    statusTone={contextMenuStatusTone}
                    collapsible
                    expanded={expandedOnboardingCard === "context_menu"}
                    onToggle={() => toggleOnboardingCard("context_menu")}
                    primaryAction={contextMenuPrimaryAction}
                  />
                  {expandedOnboardingCard === "context_menu" && (
                    <div className="cc-card-body cc-step-body cc-step-body-single">
                      <div className="cc-step-main">{renderContextMenuStepContent()}</div>
                    </div>
                  )}
                </section>

                <section
                  className="cc-card cc-step-card"
                  ref={(node) => {
                    onboardingCardRefs.current.auth = node;
                  }}
                >
                  <ControlCenterCardHeader
                    title="3. Kimi 登录与 Provider API 配置"
                    description={authHeaderSummary}
                    statusLabel={authStatusLabel}
                    statusTone={authStatusTone}
                    collapsible
                    expanded={expandedOnboardingCard === "auth"}
                    onToggle={() => toggleOnboardingCard("auth")}
                    primaryAction={authPrimaryAction}
                  />
                  {expandedOnboardingCard === "auth" && (
                    <div className="cc-card-body cc-step-body cc-step-body-single">
                      <div className="cc-step-main">
                        {authSecondaryAction ? (
                          <div className="cc-step-secondary-actions">
                            {authSecondaryAction}
                          </div>
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
                              <strong>
                                {configCenterView?.configPath || "~/.kimi/config.toml"}
                              </strong>
                            </p>
                            {configCenterDirty ? (
                              <p className="hint cc-step-meta">配置中心弹窗内存在未保存修改。</p>
                            ) : null}
                            {configCenterView?.warnings?.length ? (
                              <p className="hint cc-step-meta">
                                当前警告：{configCenterView.warnings[0]}
                              </p>
                            ) : null}
                            <p className="hint cc-step-meta">保存成功后将自动标记本步骤完成。</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                <section
                  className="cc-card cc-step-card"
                  ref={(node) => {
                    onboardingCardRefs.current.work_dir = node;
                  }}
                >
                  <ControlCenterCardHeader
                    title="4. 默认工作目录"
                    description={workDirHeaderSummary}
                    statusLabel={workDirStatusLabel}
                    statusTone={workDirStatusTone}
                    collapsible
                    expanded={expandedOnboardingCard === "work_dir"}
                    onToggle={() => toggleOnboardingCard("work_dir")}
                    primaryAction={workDirPrimaryAction}
                  />
                  {expandedOnboardingCard === "work_dir" && (
                    <div className="cc-card-body cc-step-body cc-step-body-single">
                      <div className="cc-step-main">{renderWorkDirStepContent()}</div>
                    </div>
                  )}
                </section>

                <section
                  className="cc-card cc-step-card"
                  ref={(node) => {
                    onboardingCardRefs.current.bridge = node;
                  }}
                >
                  <ControlCenterCardHeader
                    title="5. IM Bridge（可选）"
                    description={bridgeHeaderSummary}
                    statusLabel={bridgeStatusLabel}
                    statusTone={bridgeStatusTone}
                    collapsible
                    expanded={expandedOnboardingCard === "bridge"}
                    onToggle={() => toggleOnboardingCard("bridge")}
                    primaryAction={bridgePrimaryAction}
                  />
                  {expandedOnboardingCard === "bridge" && (
                    <div className="cc-card-body cc-step-body cc-step-body-single">
                      <div className="cc-step-main">{renderBridgeStepContent()}</div>
                    </div>
                  )}
                </section>

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
            </div>
          )}

          {activeControlSection === "runtime_center" && (
            <section className="cc-card runtime-accordion">
              <RuntimePanel active={runtimePanelExpanded && activeRuntimePanel === "core"} onOpen={() => { void handleSelectRuntimePanel("core"); }} title="核心运行诊断" description="端口、启动指标、版本与最后错误信息。">
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

              <RuntimePanel active={runtimePanelExpanded && activeRuntimePanel === "paths"} onOpen={() => { void handleSelectRuntimePanel("paths"); }} title="路径与上下文菜单" description="查看路径配置并管理资源管理器右键菜单。">
                <p className="hint">{runtimeContextMenuSupported ? `右键菜单：${runtimeContextMenuEnabled ? "已启用" : "未启用"}` : "右键菜单：当前平台不支持"}</p>
                {contextMenuStatus?.message && <p className="hint">{contextMenuStatus.message}</p>}
                <div className="cc-actions">
                  <Button type="button" icon={<Plus size={15} />} className="cc-action-btn" onClick={() => void onEnableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>启用右键菜单</Button>
                  <Button type="button" variant="ghost" icon={<Minus size={15} />} className="cc-action-btn" onClick={() => void onDisableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>禁用右键菜单</Button>
                  <Button type="button" variant="ghost" icon={<FolderOpen size={15} />} className="cc-action-btn" onClick={() => void onOpenLogs()}>打开日志目录</Button>
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

              <RuntimePanel active={runtimePanelExpanded && activeRuntimePanel === "bridge"} onOpen={() => { void handleSelectRuntimePanel("bridge"); }} title="Bridge sidecar" description="管理 IM bridge sidecar、配置和 bindings。">
                <BridgeRuntimePanel
                  settings={bridgeSettings}
                  status={bridgeStatus}
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
                  onRefreshBindings={onRefreshBridgeBindings}
                  onRefreshApprovals={onRefreshBridgeApprovals}
                  onRefreshLogTail={onRefreshBridgeLogTail}
                  onRefreshSecretsMask={onRefreshBridgeSecretsMask}
                  onOpenLogs={onOpenLogs}
                  onClearBinding={onClearBridgeBinding}
                  onResolveApproval={onResolveBridgeApproval}
                />
              </RuntimePanel>

              <RuntimePanel active={runtimePanelExpanded && activeRuntimePanel === "logs"} onOpen={() => { void handleSelectRuntimePanel("logs"); }} title="最近日志" description="快速查看应用与后端日志尾部内容。">
                <h4 className="log-tail-title">最近应用日志</h4>
                <pre className="log-tail">{diagnostics?.appLogTail && diagnostics.appLogTail.length > 0 ? diagnostics.appLogTail.join("\n") : "暂无应用日志。"}</pre>
                <h4 className="log-tail-title">最近后端日志</h4>
                <pre className="log-tail">{diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0 ? diagnostics.backendLogTail.join("\n") : "暂无后端日志。"}</pre>
              </RuntimePanel>
            </section>
          )}
        </div>
      </div>
      <BridgeConfigModal
        open={bridgeConfigOpen}
        busy={bridgeBusy}
        dirty={bridgeOnboardingDirty}
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
      {showSidebar ? (
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
      ) : null}
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
