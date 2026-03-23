import { useEffect, useState, type ReactNode } from "react";
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
  Sparkles,
  X,
} from "lucide-react";
import type {
  ActionableOnboardingStep,
  AppStatus,
  BindingRecord,
  BridgeApprovalRecord,
  BridgeConnectorConfig,
  BridgeConnectorSecretsInput,
  BridgeOnboardingConfigInput,
  BridgeOnboardingValidation,
  BridgePlatform,
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
  InstalledSkill,
  KimiCliConfigCenterInput,
  KimiCliConfigCenterView,
  MainWindowCloseBehavior,
  OnboardingStatus,
  PowerShellPreflightSummary,
  RuntimePanelId,
  SessionSkillState,
  SkillApplyScope,
  SkillCenterSectionId,
  SkillDetail,
  SkillProjectionRecord,
  WorkspaceSkillProfile,
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
import { SkillCenterPanel } from "@/features/skill-center/SkillCenterPanel";
import { pickRandomAgentTip, type AgentTip } from "@/lib/agentTips";

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type BridgePrimaryActionMode = "save_enable" | "start" | "apply_restart";
type OnboardingCardId =
  | "install"
  | "context_menu"
  | "auth"
  | "work_dir";

type BridgeCenterView = "overview" | "feishu_robots";

type BridgeConnectorSecretDraft = {
  botToken: string;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
};

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
  bridgeSettingsDirty: boolean;
  bridgeSessions: BridgeSessionRecord[];
  bridgeBindings: BindingRecord[];
  bridgeApprovals: BridgeApprovalRecord[];
  bridgeLogTail: string[];
  bridgeRecentErrors: string[];
  bridgeSecretsMask: BridgeSecretsMaskView;
  bridgeBusy: boolean;
  installedSkills: InstalledSkill[];
  skillCenterBusy: boolean;
  skillCenterSearch: string;
  skillCenterFilter: "all" | "session" | "global" | "untrusted";
  skillCenterSection: SkillCenterSectionId;
  selectedSkillId: string | null;
  selectedSkillDetail: SkillDetail | null;
  globalSkillProjections: SkillProjectionRecord[];
  activeSessionSkillState: SessionSkillState;
  workspaceSkillProfile: WorkspaceSkillProfile | null;
  workspaceRecentSkillIds: string[];
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
  onRefreshBridgeSessions: (options?: { silent?: boolean }) => Promise<BridgeSessionRecord[]>;
  onRefreshBridgeBindings: () => Promise<BindingRecord[]>;
  onRefreshBridgeApprovals: () => Promise<BridgeApprovalRecord[]>;
  onRefreshBridgeLogTail: () => Promise<string[]>;
  onRefreshBridgeSecretsMask: () => Promise<BridgeSecretsMaskView>;
  onSaveBridgeConnectorSecrets: (input: BridgeConnectorSecretsInput) => Promise<void>;
  onRefreshSkillCenterState: () => Promise<unknown>;
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
  onPickBridgeConnectorDefaultWorkDir: (connectorId: string) => Promise<void>;
  onSaveWorkDirAndRestart: () => Promise<void>;
  onClearWorkDir: () => Promise<void>;
  onBridgeSettingsChange: (next: BridgeSettings) => void;
  onBridgeOnboardingDraftChange: (next: BridgeOnboardingConfigInput) => void;
  onSaveBridgeSettings: () => Promise<void>;
  onRunBridgePrimaryAction: (mode: BridgePrimaryActionMode) => Promise<void>;
  onStopBridge: () => Promise<void>;
  onRestartBridge: () => Promise<void>;
  onImportBridgeSession: (input: BridgeSessionImportInput) => Promise<void>;
  onClearBridgeBinding: (bindingId: string) => Promise<void>;
  onResetBridgeBindingSession: (bindingId: string) => Promise<void>;
  onResetBridgeBindingToDefaultWorkDir: (bindingId: string) => Promise<void>;
  onResolveBridgeApproval: (approvalId: string, status: string) => Promise<void>;
  onSkillCenterSearchChange: (value: string) => void;
  onSkillCenterFilterChange: (value: "all" | "session" | "global" | "untrusted") => void;
  onSkillCenterSectionChange: (value: SkillCenterSectionId) => void;
  onSelectSkill: (skillId: string) => Promise<void>;
  onOpenSkillFromInsights: (skillId: string) => Promise<void>;
  onInstallSkillFromGit: () => Promise<void>;
  onImportSkillFromPath: () => Promise<void>;
  onSetSkillTrust: (skillId: string, trusted: boolean) => Promise<void>;
  onApplySkill: (skillId: string, scope: SkillApplyScope) => Promise<void>;
  onRemoveSkill: (skillId: string, scope: SkillApplyScope) => Promise<void>;
  onRecoverWorkspaceSkill: (skillId: string) => Promise<void>;
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
  {
    id: "skill_center",
    label: "技能中心",
    icon: <Sparkles size={15} />,
  },
];

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
  return status.connectors.find((connector) => connector.platform === platform);
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
  const feishuEnabled = settings.connectors.some(
    (connector) => connector.platform === "feishu" && connector.enabled,
  );
  const telegramEnabled = settings.connectors.some(
    (connector) => connector.platform === "telegram" && connector.enabled,
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

function createEmptyBridgeConnectorSecretDraft(): BridgeConnectorSecretDraft {
  return {
    botToken: "",
    appId: "",
    appSecret: "",
    verificationToken: "",
    encryptKey: "",
  };
}

function bridgePlatformLabel(platform: BridgePlatform): string {
  return platform === "telegram" ? "Telegram" : "飞书";
}

function formatBridgeConnectorStateLabel(
  value: BridgeStatus["connectors"][number]["state"] | "idle",
): string {
  switch (value) {
    case "connecting":
      return "连接中";
    case "ready":
      return "就绪";
    case "degraded":
      return "降级";
    case "error":
      return "异常";
    default:
      return "待机";
  }
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
  bridgeSettingsDirty,
  bridgeSessions,
  bridgeBindings,
  bridgeApprovals,
  bridgeLogTail,
  bridgeRecentErrors,
  bridgeSecretsMask,
  bridgeBusy,
  installedSkills,
  skillCenterBusy,
  skillCenterSearch,
  skillCenterFilter,
  skillCenterSection,
  selectedSkillId,
  selectedSkillDetail,
  globalSkillProjections,
  activeSessionSkillState,
  workspaceSkillProfile,
  workspaceRecentSkillIds,
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
  onSaveBridgeConnectorSecrets,
  onRefreshSkillCenterState,
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
  onPickBridgeConnectorDefaultWorkDir,
  onSaveWorkDirAndRestart,
  onClearWorkDir,
  onBridgeSettingsChange,
  onBridgeOnboardingDraftChange,
  onSaveBridgeSettings,
  onRunBridgePrimaryAction,
  onStopBridge,
  onRestartBridge,
  onImportBridgeSession,
  onClearBridgeBinding,
  onResetBridgeBindingSession,
  onResetBridgeBindingToDefaultWorkDir,
  onResolveBridgeApproval,
  onSkillCenterSearchChange,
  onSkillCenterFilterChange,
  onSkillCenterSectionChange,
  onSelectSkill,
  onOpenSkillFromInsights,
  onInstallSkillFromGit,
  onImportSkillFromPath,
  onSetSkillTrust,
  onApplySkill,
  onRemoveSkill,
  onRecoverWorkspaceSkill,
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
  const [bridgeCenterView, setBridgeCenterView] = useState<BridgeCenterView>("overview");
  const [bridgeConnectorSecretsOpen, setBridgeConnectorSecretsOpen] = useState(false);
  const [bridgeConnectorRuntimeOpen, setBridgeConnectorRuntimeOpen] = useState(false);
  const [selectedBridgeConnectorId, setSelectedBridgeConnectorId] = useState<string | null>(null);
  const [bridgeConnectorSecretDraft, setBridgeConnectorSecretDraft] =
    useState<BridgeConnectorSecretDraft>(() => createEmptyBridgeConnectorSecretDraft());
  const [expandedOnboardingCard, setExpandedOnboardingCard] =
    useState<OnboardingCardId | null>(null);
  const [runtimePanelExpanded, setRuntimePanelExpanded] = useState(true);
  const [mainCloseBehaviorSaving, setMainCloseBehaviorSaving] = useState(false);
  const [briefTip, setBriefTip] = useState<AgentTip>(() => pickRandomAgentTip());
  void installCommandsOpen;
  void installCommandsBusy;
  void installCommandCatalog;
  void onInstallDependencies;
  void onInstallKimi;
  void onUpgradeKimi;
  void onInstallNodejs;
  void onOpenInstallCommands;
  void onCloseInstallCommands;
  void onRefreshSkillCenterState;
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
  const feishuEnabled = bridgeSettings.connectors.find(
    (connector) => connector.platform === "feishu",
  )?.enabled ?? false;
  const feishuConnectors = bridgeSettings.connectors.filter(
    (connector) => connector.platform === "feishu",
  );
  const bridgeDisplayName = getBridgeDisplayName(bridgeSettings);
  const bridgeFinalStatusTitle = formatBridgeDisplayNameLabel(bridgeDisplayName, "最终状态");
  const openBridgeTitle = formatOpenBridgeDisplayName(bridgeDisplayName);
  const selectedBridgeConnector =
    feishuConnectors.find((connector) => connector.id === selectedBridgeConnectorId) ?? null;
  const selectedBridgeConnectorStatus =
    bridgeStatus.connectors.find((connector) => connector.connectorId === selectedBridgeConnectorId) ??
    null;
  const selectedBridgeConnectorSecrets =
    bridgeSecretsMask.connectors.find((connector) => connector.connectorId === selectedBridgeConnectorId) ??
    null;
  const mainWindowCloseBehaviorOptions: Array<{
    value: MainWindowCloseBehavior;
    label: string;
  }> = [
    { value: "ask", label: "首次询问（可记住）" },
    { value: "exit", label: "直接退出应用" },
    { value: "minimize_to_tray", label: "最小化到系统托盘" },
  ];
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
    if (!selectedBridgeConnectorId || !feishuConnectors.some((item) => item.id === selectedBridgeConnectorId)) {
      setSelectedBridgeConnectorId(feishuConnectors[0]?.id ?? null);
    }
  }, [feishuConnectors, selectedBridgeConnectorId]);

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
      await Promise.all([onRefreshBridgeSettings(), onRefreshBridgeStatus()]);
      await Promise.all([
        onRefreshBridgeSessions({ silent: true }),
        onRefreshBridgeBindings(),
        onRefreshBridgeApprovals(),
        onRefreshBridgeLogTail(),
        onRefreshBridgeSecretsMask(),
      ]);
    } finally {
      setActiveControlSection("bridge_center");
    }
  }

  async function handleSelectSkillCenterSection() {
    try {
      await onRefreshSkillCenterState();
    } finally {
      setActiveControlSection("skill_center");
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
    if (section === "skill_center") {
      await handleSelectSkillCenterSection();
      return;
    }
    await handleSelectRuntimePanel("core");
  }

  function updateBridgeConnector(
    connectorId: string,
    patch: Partial<BridgeConnectorConfig>,
  ) {
    const primaryFeishuId =
      bridgeSettings.connectors.find((connector) => connector.platform === "feishu")?.id ?? null;
    const nextConnectors = bridgeSettings.connectors.map((connector) =>
      connector.id === connectorId ? { ...connector, ...patch } : connector,
    );
    const nextSettings: BridgeSettings = {
      ...bridgeSettings,
      connectors: nextConnectors,
    };
    if (primaryFeishuId === connectorId) {
      if (patch.feishuAutoApprove !== undefined) {
        nextSettings.feishuAutoApprove = patch.feishuAutoApprove;
      }
      if (patch.feishuReplyRenderer !== undefined) {
        nextSettings.feishuReplyRenderer = patch.feishuReplyRenderer;
      }
    }
    onBridgeSettingsChange(nextSettings);
  }

  function addFeishuConnector() {
    const existingIds = new Set(bridgeSettings.connectors.map((connector) => connector.id));
    let index = 1;
    let nextId = "feishu-default";
    while (existingIds.has(nextId)) {
      index += 1;
      nextId = `feishu-${index}`;
    }
    const nextConnector: BridgeConnectorConfig = {
      id: nextId,
      platform: "feishu",
      enabled: false,
      mode: "websocket",
      label: index === 1 ? "Feishu" : `Feishu ${index}`,
      defaultWorkDir: bridgeSettings.defaultWorkDir,
      resetBindingSessionOnStart: true,
      feishuAutoApprove: true,
      feishuReplyRenderer: "interactive",
    };
    onBridgeSettingsChange({
      ...bridgeSettings,
      connectors: [...bridgeSettings.connectors, nextConnector],
    });
    setBridgeCenterView("feishu_robots");
    setSelectedBridgeConnectorId(nextConnector.id);
  }

  async function handleSaveBridgeRobot(connectorId: string) {
    await onSaveBridgeSettings();
    if (isBridgeRunning) {
      await onRestartBridge();
      await Promise.all([
        onRefreshBridgeStatus(),
        onRefreshBridgeBindings(),
        onRefreshBridgeApprovals(),
        onRefreshBridgeSessions({ silent: true }),
      ]);
    }
    setSelectedBridgeConnectorId(connectorId);
  }

  function openBridgeConnectorSecretsModal(connectorId: string) {
    setSelectedBridgeConnectorId(connectorId);
    setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
    setBridgeConnectorSecretsOpen(true);
  }

  function openBridgeConnectorRuntimeModal(connectorId: string) {
    setSelectedBridgeConnectorId(connectorId);
    setBridgeConnectorRuntimeOpen(true);
  }

  async function handleSaveBridgeConnectorSecretDraft() {
    if (!selectedBridgeConnector) {
      return;
    }
    await onSaveBridgeConnectorSecrets({
      connectorId: selectedBridgeConnector.id,
      telegram: {
        botToken: bridgeConnectorSecretDraft.botToken.trim() || undefined,
      },
      feishu: {
        appId: bridgeConnectorSecretDraft.appId.trim() || undefined,
        appSecret: bridgeConnectorSecretDraft.appSecret.trim() || undefined,
        verificationToken:
          bridgeConnectorSecretDraft.verificationToken.trim() || undefined,
        encryptKey: bridgeConnectorSecretDraft.encryptKey.trim() || undefined,
      },
    });
    setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
    setBridgeConnectorSecretsOpen(false);
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
  const pendingOverviewCount = overviewBriefs.length;
  const overviewPrimaryMessage =
    overviewBriefs[0] ?? "当前所有核心环节已处于可用状态，可以继续检查运行诊断、IM Bridge 和技能应用。";

  function renderOverviewSection() {
    return (
      <div className="cc-overview-shell">
        <section className="cc-card cc-hero-card">
          <div className="cc-hero-layout">
            <div className="cc-hero-main">
              <span className="cc-kicker">状态总览</span>
              <h2>控制中心当前状态</h2>
              <p className="cc-hero-copy">{overviewPrimaryMessage}</p>
              <div className="cc-hero-status-strip">
                <article className="cc-signal-card">
                  <span>后端状态</span>
                  <strong>{diagnostics?.state ?? status?.state ?? "-"}</strong>
                </article>
                <article className="cc-signal-card">
                  <span>{bridgeFinalStatusTitle}</span>
                  <strong>{imFinalStatusLabel}</strong>
                </article>
                <article className="cc-signal-card">
                  <span>快速设置进度</span>
                  <strong>
                    {completedOnboardingCards}/{onboardingSteps.length}
                  </strong>
                </article>
                <article className="cc-signal-card">
                  <span>待处理项</span>
                  <strong>{pendingOverviewCount === 0 ? "无" : `${pendingOverviewCount} 项`}</strong>
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
                <span className="cc-kicker">当前重点</span>
                <h3>{activeOnboardingStep.title}</h3>
                <p>{overviewPrimaryMessage}</p>
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
                  处理当前重点
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
                      void handleSelectSkillCenterSection();
                    }}
                  >
                    <span className="cc-task-card-icon"><Sparkles size={16} /></span>
                    <span className="cc-task-card-copy">
                      <strong>打开技能中心</strong>
                    </span>
                  </button>
                </div>
              </div>
            </section>
          </div>

          <aside className="cc-overview-side-column">
            <section className="cc-card">
              <header className="cc-card-header">
                <h3>待处理与提醒</h3>
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
                        <span className="cc-brief-tip-badge">Agent 提示</span>
                        <span className="cc-brief-tip-number">{briefTip.numberLabel}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        icon={<RefreshCw size={13} />}
                        className="cc-brief-tip-refresh"
                        onClick={() => setBriefTip(pickRandomAgentTip())}
                        aria-label="刷新 Agent 使用提示"
                      />
                    </div>
                    <div className="cc-brief-tip-article">
                      <strong className="cc-brief-tip-article-title">{briefTip.title}</strong>
                      <p className="cc-brief-tip-body">{briefTip.body}</p>
                    </div>
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
            <span className="cc-kicker">设置流程</span>
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
              <span className="cc-kicker">当前步骤</span>
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
              eyebrow={`步骤 ${activeOnboardingStep.index}`}
              title="操作与详情"
              description={activeOnboardingStep.title}
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
              <span className="cc-kicker">详细面板</span>
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
    const bridgePrimaryAction = (() => {
      if (!bridgeOnboardingValidation.canStart) {
        return {
          label: "保存并启用 IM Bridge",
          mode: "save_enable" as BridgePrimaryActionMode,
          disabled: !bridgeOnboardingValidation.canSave,
        };
      }
      if (!isBridgeRunning) {
        return {
          label: "启动 IM Bridge",
          mode: "start" as BridgePrimaryActionMode,
          disabled: bridgeBusy,
        };
      }
      if (bridgeOnboardingDirty || bridgeSettingsDirty) {
        return {
          label: "应用设置并重启",
          mode: "apply_restart" as BridgePrimaryActionMode,
          disabled: bridgeBusy,
        };
      }
      return null;
    })();

    const bridgeHeaderControls = (
      <div className="cc-inline-switch" role="group" aria-label="IM Bridge 视图切换">
        <button
          type="button"
          className={`cc-inline-switch-btn ${bridgeCenterView === "overview" ? "active" : ""}`}
          onClick={() => setBridgeCenterView("overview")}
          disabled={bridgeBusy}
        >
          总览
        </button>
        <button
          type="button"
          className={`cc-inline-switch-btn ${bridgeCenterView === "feishu_robots" ? "active" : ""}`}
          onClick={() => setBridgeCenterView("feishu_robots")}
          disabled={bridgeBusy}
        >
          飞书机器人
        </button>
      </div>
    );

    return (
      <div className="cc-bridge-shell">
        <section className="cc-card">
          <ControlCenterCardHeader
            title="IM Bridge"
            titleMeta={bridgeDisplayName !== "IM Bridge" ? bridgeDisplayName : undefined}
            titleControls={bridgeHeaderControls}
            description="总览保留 Bridge 全局状态和启动入口；飞书机器人页负责每个机器人的独立配置。"
            statusLabel={bridgeStatusLabel}
            statusTone={bridgeRuntimeTone}
            primaryAction={
              bridgeCenterView === "feishu_robots" ? (
                <Button
                  type="button"
                  variant="outline"
                  icon={<Plus size={14} />}
                  className="cc-action-btn"
                  onClick={() => addFeishuConnector()}
                  disabled={bridgeBusy}
                >
                  新增飞书机器人
                </Button>
              ) : undefined
            }
          />
          <div className="cc-card-body cc-step-body cc-step-body-single">
            {bridgeCenterView === "overview" ? (
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
                </div>

                <div className="cc-runtime-summary-grid">
                  <article className="diag-item">
                    <span className="diag-label">飞书机器人</span>
                    <strong>{feishuConnectors.length}</strong>
                  </article>
                  <article className="diag-item">
                    <span className="diag-label">当前绑定</span>
                    <strong>{bridgeBindings.length}</strong>
                  </article>
                  <article className="diag-item">
                    <span className="diag-label">待处理审批</span>
                    <strong>{bridgeApprovals.length}</strong>
                  </article>
                  <article className="diag-item">
                    <span className="diag-label">最近错误</span>
                    <strong>{bridgeRecentErrors.length > 0 ? "有" : "无"}</strong>
                  </article>
                </div>

                <div className="cc-bridge-onboarding-switches">
                  <label className="bridge-switch-card">
                    <span className="bridge-switch-copy">
                      <strong>应用启动时自动拉起 Bridge</strong>
                      <small>这是 Bridge 全局 autoStart，不等同于单个机器人的启用状态。</small>
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

                {bridgeOnboardingValidation.canStart ? (
                  <p className="hint cc-step-meta cc-bridge-onboarding-message">
                    Bridge 配置已就绪。飞书机器人和凭据现在统一在“飞书机器人”视图中维护。
                  </p>
                ) : (
                  <p className="hint cc-step-meta cc-bridge-onboarding-message is-error">
                    {bridgeOnboardingValidation.message ??
                      "配置保存后，可直接在这里启动 IM Bridge。"}
                  </p>
                )}
                {bridgeOnboardingDirty || bridgeSettingsDirty ? (
                  <p className="hint cc-step-meta">当前存在未应用的 IM Bridge 配置变更。</p>
                ) : null}

                <div className="cc-step-secondary-actions">
                  {bridgePrimaryAction ? (
                    <Button
                      type="button"
                      icon={
                        bridgePrimaryAction.mode === "apply_restart" ? (
                          <RefreshCcw size={15} />
                        ) : bridgePrimaryAction.mode === "start" ? (
                          <Play size={15} />
                        ) : (
                          <Check size={15} />
                        )
                      }
                      className="cc-action-btn"
                      onClick={() => void onRunBridgePrimaryAction(bridgePrimaryAction.mode)}
                      disabled={bridgeBusy || bridgePrimaryAction.disabled}
                    >
                      {bridgePrimaryAction.label}
                    </Button>
                  ) : null}
                  {isBridgeRunning ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="cc-action-btn"
                      onClick={() => void onStopBridge()}
                      disabled={bridgeBusy}
                    >
                      停止 Bridge
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<RefreshCw size={15} />}
                    className="cc-action-btn"
                    onClick={() => {
                      void Promise.all([
                        onRefreshBridgeSettings(),
                        onRefreshBridgeStatus(),
                        onRefreshBridgeBindings(),
                        onRefreshBridgeApprovals(),
                      ]);
                    }}
                    disabled={bridgeBusy}
                  >
                    刷新状态
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    icon={<LayoutDashboard size={15} />}
                    className="cc-action-btn"
                    onClick={() => setBridgeCenterView("feishu_robots")}
                    disabled={bridgeBusy}
                  >
                    打开飞书机器人
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bridge-robot-list">
                {feishuConnectors.length > 0 ? (
                  feishuConnectors.map((connector) => {
                    const connectorStatus =
                      bridgeStatus.connectors.find((item) => item.connectorId === connector.id) ??
                      null;
                    const effectiveWorkDir =
                      connector.defaultWorkDir?.trim() ||
                      bridgeSettings.defaultWorkDir?.trim() ||
                      status?.effectiveWorkDir?.trim() ||
                      "";
                    const recentConnectorError =
                      connectorStatus?.lastError ||
                      connectorStatus?.lastErrorCode ||
                      bridgeRecentErrors.find(
                        (entry) =>
                          entry.includes(connector.id) ||
                          entry.includes(connector.label) ||
                          entry.includes("feishu"),
                      ) ||
                      "";
                    return (
                      <article key={connector.id} className="bridge-robot-card">
                        <div className="bridge-robot-card-header">
                          <div className="bridge-robot-card-copy">
                            <strong>{connector.label}</strong>
                            <span>{connector.id}</span>
                            <small>
                              {bridgePlatformLabel(connector.platform)} |{" "}
                              {formatBridgeConnectorStateLabel(connectorStatus?.state ?? "idle")}
                            </small>
                          </div>
                          <div className="bridge-robot-chip-row">
                            <span className={`cc-status-badge tone-${connector.enabled ? "success" : "neutral"}`}>
                              {connector.enabled ? "已启用" : "未启用"}
                            </span>
                            {recentConnectorError ? (
                              <span className="cc-status-badge tone-warning">最近有错误</span>
                            ) : null}
                          </div>
                        </div>

                        {recentConnectorError ? (
                          <p className="bridge-robot-error">{recentConnectorError}</p>
                        ) : (
                          <p className="hint">当前没有记录到该机器人的最近错误。</p>
                        )}

                        <div className="cc-bridge-onboarding-switches">
                          <label className="bridge-switch-card">
                            <span className="bridge-switch-copy">
                              <strong>机器人启用</strong>
                            </span>
                            <input
                              type="checkbox"
                              className="cc-switch-input"
                              checked={connector.enabled}
                              onChange={(event) =>
                                updateBridgeConnector(connector.id, {
                                  enabled: event.currentTarget.checked,
                                })
                              }
                            />
                            <span className="cc-switch-track" aria-hidden />
                          </label>

                          <label className="bridge-switch-card">
                            <span className="bridge-switch-copy">
                              <strong>自动审批</strong>
                            </span>
                            <input
                              type="checkbox"
                              className="cc-switch-input"
                              checked={connector.feishuAutoApprove ?? true}
                              onChange={(event) =>
                                updateBridgeConnector(connector.id, {
                                  feishuAutoApprove: event.currentTarget.checked,
                                })
                              }
                            />
                            <span className="cc-switch-track" aria-hidden />
                          </label>

                          <label className="bridge-switch-card">
                            <span className="bridge-switch-copy">
                              <strong>每次启动新建对话</strong>
                            </span>
                            <input
                              type="checkbox"
                              className="cc-switch-input"
                              checked={connector.resetBindingSessionOnStart ?? true}
                              onChange={(event) =>
                                updateBridgeConnector(connector.id, {
                                  resetBindingSessionOnStart: event.currentTarget.checked,
                                })
                              }
                            />
                            <span className="cc-switch-track" aria-hidden />
                          </label>
                        </div>

                        <div className="bridge-port-card bridge-robot-workdir-card">
                          <span>默认工作目录</span>
                          <div className="bridge-inline-path-row">
                            <Input
                              value={connector.defaultWorkDir ?? ""}
                              onChange={(event) =>
                                updateBridgeConnector(connector.id, {
                                  defaultWorkDir: event.currentTarget.value,
                                })
                              }
                              placeholder="留空时跟随应用默认工作目录"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="cc-action-btn cc-inline-btn"
                              onClick={() => void onPickBridgeConnectorDefaultWorkDir(connector.id)}
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
                              onClick={() => void onOpenFolder(effectiveWorkDir)}
                              disabled={bridgeBusy || !effectiveWorkDir}
                              aria-label="打开机器人默认工作目录"
                              title="打开机器人默认工作目录"
                            />
                          </div>
                          <small>
                            {effectiveWorkDir
                              ? `当前生效目录：${effectiveWorkDir}`
                              : "留空后将跟随应用默认工作目录。"}
                          </small>
                        </div>

                        <div className="cc-step-secondary-actions">
                          <Button
                            type="button"
                            icon={<Check size={15} />}
                            className="cc-action-btn"
                            onClick={() => void handleSaveBridgeRobot(connector.id)}
                            disabled={bridgeBusy}
                          >
                            {isBridgeRunning ? "保存并重启" : "保存设置"}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            icon={<KeyRound size={15} />}
                            className="cc-action-btn"
                            onClick={() => openBridgeConnectorSecretsModal(connector.id)}
                            disabled={bridgeBusy}
                          >
                            连接与凭据
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            icon={<LayoutDashboard size={15} />}
                            className="cc-action-btn"
                            onClick={() => openBridgeConnectorRuntimeModal(connector.id)}
                            disabled={bridgeBusy}
                          >
                            高级运行面板
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            icon={<Minus size={15} />}
                            className="cc-action-btn"
                            onClick={() => {
                              onBridgeSettingsChange({
                                ...bridgeSettings,
                                connectors: bridgeSettings.connectors.filter(
                                  (item) => item.id !== connector.id,
                                ),
                              });
                              if (selectedBridgeConnectorId === connector.id) {
                                setSelectedBridgeConnectorId(
                                  feishuConnectors.find((item) => item.id !== connector.id)?.id ??
                                    null,
                                );
                              }
                            }}
                            disabled={bridgeBusy}
                          >
                            删除机器人
                          </Button>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="bridge-robot-empty">
                    <p>还没有飞书机器人。点击上方“新增飞书机器人”即可创建第一张机器人卡片。</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    );
  }

  function renderSkillCenterSection() {
    const skillCenterActions = (
      <div className="skill-center-header-actions">
        <Button
          type="button"
          variant={skillCenterFilter === "global" ? "default" : "outline"}
          className="cc-action-btn skill-center-filter-btn"
          onClick={() =>
            onSkillCenterFilterChange(skillCenterFilter === "global" ? "all" : "global")
          }
        >
          全局
        </Button>
        <Button
          type="button"
          variant={skillCenterFilter === "session" ? "default" : "outline"}
          className="cc-action-btn skill-center-filter-btn"
          onClick={() =>
            onSkillCenterFilterChange(skillCenterFilter === "session" ? "all" : "session")
          }
        >
          当前工作区
        </Button>
        <Button
          type="button"
          icon={<Plus size={14} />}
          className="cc-action-btn"
          onClick={() => {
            void onInstallSkillFromGit();
          }}
          disabled={skillCenterBusy}
        >
          从 Git 安装
        </Button>
        <Button
          type="button"
          icon={<FolderOpen size={14} />}
          className="cc-action-btn"
          onClick={() => {
            void onImportSkillFromPath();
          }}
          disabled={skillCenterBusy}
        >
          导入本地 Skill
        </Button>
      </div>
    );

    return (
      <section className="cc-card skill-center-card">
        <ControlCenterCardHeader
          title="技能中心"
          titleMeta="Skill Center"
          titleControls={
            <div className="cc-inline-switch" role="group" aria-label="技能中心分区切换">
              <button
                type="button"
                className={`cc-inline-switch-btn ${skillCenterSection === "manage" ? "active" : ""}`}
                onClick={() => onSkillCenterSectionChange("manage")}
                disabled={skillCenterBusy}
              >
                技能管理
              </button>
              <button
                type="button"
                className={`cc-inline-switch-btn ${skillCenterSection === "workspace_insights" ? "active" : ""}`}
                onClick={() => onSkillCenterSectionChange("workspace_insights")}
                disabled={skillCenterBusy}
              >
                工作区洞察
              </button>
            </div>
          }
          description="先安装到应用私有目录，再按需应用到当前工作区或用户全局。"
          statusLabel={`${activeSessionSkillState.appliedSkillIds.length} 个当前工作区技能`}
          primaryAction={skillCenterActions}
        />
        <div className="cc-card-body cc-skill-center-body">
          <SkillCenterPanel
            surface="page"
            busy={skillCenterBusy}
            section={skillCenterSection}
            installedSkills={installedSkills}
            selectedSkillId={selectedSkillId}
            selectedSkillDetail={selectedSkillDetail}
            globalSkillProjections={globalSkillProjections}
            activeSessionSkillState={activeSessionSkillState}
            workspaceSkillProfile={workspaceSkillProfile}
            workspaceRecentSkillIds={workspaceRecentSkillIds}
            currentWorkspaceLabel={status?.activeSessionWorkDir || effectiveWorkDir}
            onSelectSkill={(skillId) => {
              void onSelectSkill(skillId);
            }}
            onOpenSkillFromInsights={(skillId) => {
              void onOpenSkillFromInsights(skillId);
            }}
            onSetTrust={(skillId, trusted) => {
              void onSetSkillTrust(skillId, trusted);
            }}
            onApplySkill={(skillId, scope) => {
              void onApplySkill(skillId, scope);
            }}
            onRemoveSkill={(skillId, scope) => {
              void onRemoveSkill(skillId, scope);
            }}
            onRecoverWorkspaceSkill={(skillId) => {
              void onRecoverWorkspaceSkill(skillId);
            }}
            search={skillCenterSearch}
            filter={skillCenterFilter}
            onSearchChange={onSkillCenterSearchChange}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      className={`control-center-shell ${surface === "modal" ? "control-center-shell-modal" : ""}`}
    >
      <header className="cc-modal-header">
        <nav className="cc-header-tabs" aria-label="控制中心主导航">
          {controlSections.map((section) => (
            <Button
              key={section.id}
              type="button"
              variant="ghost"
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
          {activeControlSection === "skill_center" ? renderSkillCenterSection() : null}
        </div>
      </div>
      <ControlCenterModalShell
        open={bridgeConnectorSecretsOpen}
        title={
          selectedBridgeConnector
            ? `${selectedBridgeConnector.label} 连接与凭据`
            : "连接与凭据"
        }
        description="这个弹窗只作用于当前机器人。保存后会写入该 connector 的凭据掩码与密钥配置。"
        ariaLabel="Bridge 连接与凭据"
        className="cc-bridge-connector-modal"
        bodyClassName="cc-bridge-connector-body"
        onRequestClose={() => {
          setBridgeConnectorSecretsOpen(false);
          setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
        }}
        headerActions={
          <Button
            type="button"
            variant="outline"
            icon={<RefreshCw size={14} />}
            className="cc-action-btn"
            onClick={() => void onRefreshBridgeSecretsMask()}
            disabled={bridgeBusy}
          >
            刷新掩码
          </Button>
        }
        footer={
          <>
            <div className="cc-config-footer-meta">
              <span>{selectedBridgeConnector?.id ?? "未选择 connector"}</span>
              <span>{selectedBridgeConnector?.label ?? "无机器人"}</span>
            </div>
            <div className="cc-actions">
              <Button
                type="button"
                variant="ghost"
                className="cc-action-btn"
                onClick={() => {
                  setBridgeConnectorSecretsOpen(false);
                  setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
                }}
                disabled={bridgeBusy}
              >
                关闭
              </Button>
              <Button
                type="button"
                icon={<Check size={15} />}
                className="cc-action-btn"
                onClick={() => void handleSaveBridgeConnectorSecretDraft()}
                disabled={bridgeBusy || !selectedBridgeConnector}
              >
                保存凭据
              </Button>
            </div>
          </>
        }
      >
        {selectedBridgeConnector ? (
          <div className="bridge-panel">
            <div className="diagnostics-grid">
              <article className="diag-item">
                <span className="diag-label">机器人</span>
                <strong>{selectedBridgeConnector.label}</strong>
              </article>
              <article className="diag-item">
                <span className="diag-label">Connector ID</span>
                <strong>{selectedBridgeConnector.id}</strong>
              </article>
              <article className="diag-item">
                <span className="diag-label">平台</span>
                <strong>{bridgePlatformLabel(selectedBridgeConnector.platform)}</strong>
              </article>
              <article className="diag-item">
                <span className="diag-label">当前状态</span>
                <strong>
                  {formatBridgeConnectorStateLabel(
                    selectedBridgeConnectorStatus?.state ?? "idle",
                  )}
                </strong>
              </article>
            </div>

            <div className="bridge-panel-subsection">
              <div className="bridge-panel-subheader">
                <h5>已保存凭据掩码</h5>
              </div>
              <div className="bridge-secret-list">
                {selectedBridgeConnector.platform === "telegram" &&
                selectedBridgeConnectorSecrets?.telegram ? (
                  <div className="bridge-secret-row">
                    <div className="bridge-secret-copy">
                      <strong>Telegram botToken</strong>
                      <small>
                        {selectedBridgeConnectorSecrets.telegram.botToken.configured
                          ? selectedBridgeConnectorSecrets.telegram.botToken.maskedValue ?? "***"
                          : "未配置"}
                      </small>
                    </div>
                    <span
                      className={`bridge-secret-chip ${
                        selectedBridgeConnectorSecrets.telegram.botToken.configured
                          ? "configured"
                          : "empty"
                      }`}
                    >
                      {selectedBridgeConnectorSecrets.telegram.botToken.configured
                        ? "已配置"
                        : "未配置"}
                    </span>
                  </div>
                ) : null}
                {selectedBridgeConnector.platform === "feishu" &&
                selectedBridgeConnectorSecrets?.feishu ? (
                  <>
                    <div className="bridge-secret-row">
                      <div className="bridge-secret-copy">
                        <strong>飞书 appId</strong>
                        <small>
                          {selectedBridgeConnectorSecrets.feishu.appId.configured
                            ? selectedBridgeConnectorSecrets.feishu.appId.maskedValue ?? "***"
                            : "未配置"}
                        </small>
                      </div>
                      <span
                        className={`bridge-secret-chip ${
                          selectedBridgeConnectorSecrets.feishu.appId.configured
                            ? "configured"
                            : "empty"
                        }`}
                      >
                        {selectedBridgeConnectorSecrets.feishu.appId.configured
                          ? "已配置"
                          : "未配置"}
                      </span>
                    </div>
                    <div className="bridge-secret-row">
                      <div className="bridge-secret-copy">
                        <strong>飞书 appSecret</strong>
                        <small>
                          {selectedBridgeConnectorSecrets.feishu.appSecret.configured
                            ? selectedBridgeConnectorSecrets.feishu.appSecret.maskedValue ??
                              "***"
                            : "未配置"}
                        </small>
                      </div>
                      <span
                        className={`bridge-secret-chip ${
                          selectedBridgeConnectorSecrets.feishu.appSecret.configured
                            ? "configured"
                            : "empty"
                        }`}
                      >
                        {selectedBridgeConnectorSecrets.feishu.appSecret.configured
                          ? "已配置"
                          : "未配置"}
                      </span>
                    </div>
                    <div className="bridge-secret-row">
                      <div className="bridge-secret-copy">
                        <strong>飞书 verificationToken</strong>
                        <small>
                          {selectedBridgeConnectorSecrets.feishu.verificationToken.configured
                            ? selectedBridgeConnectorSecrets.feishu.verificationToken
                                .maskedValue ?? "***"
                            : "未配置"}
                        </small>
                      </div>
                      <span
                        className={`bridge-secret-chip ${
                          selectedBridgeConnectorSecrets.feishu.verificationToken.configured
                            ? "configured"
                            : "empty"
                        }`}
                      >
                        {selectedBridgeConnectorSecrets.feishu.verificationToken.configured
                          ? "已配置"
                          : "未配置"}
                      </span>
                    </div>
                    <div className="bridge-secret-row">
                      <div className="bridge-secret-copy">
                        <strong>飞书 encryptKey</strong>
                        <small>
                          {selectedBridgeConnectorSecrets.feishu.encryptKey.configured
                            ? selectedBridgeConnectorSecrets.feishu.encryptKey.maskedValue ??
                              "***"
                            : "未配置"}
                        </small>
                      </div>
                      <span
                        className={`bridge-secret-chip ${
                          selectedBridgeConnectorSecrets.feishu.encryptKey.configured
                            ? "configured"
                            : "empty"
                        }`}
                      >
                        {selectedBridgeConnectorSecrets.feishu.encryptKey.configured
                          ? "已配置"
                          : "未配置"}
                      </span>
                    </div>
                  </>
                ) : null}
              </div>
            </div>

            <div className="bridge-settings-grid">
              {selectedBridgeConnector.platform === "telegram" ? (
                <label className="bridge-port-card">
                  <span>botToken</span>
                  <Input
                    value={bridgeConnectorSecretDraft.botToken}
                    onChange={(event) =>
                      setBridgeConnectorSecretDraft((current) => ({
                        ...current,
                        botToken: event.currentTarget.value,
                      }))
                    }
                    placeholder="输入新的 Telegram bot token"
                  />
                  <small>留空则不覆盖现有已保存值。</small>
                </label>
              ) : (
                <>
                  <label className="bridge-port-card">
                    <span>appId</span>
                    <Input
                      value={bridgeConnectorSecretDraft.appId}
                      onChange={(event) =>
                        setBridgeConnectorSecretDraft((current) => ({
                          ...current,
                          appId: event.currentTarget.value,
                        }))
                      }
                      placeholder="cli_xxx"
                    />
                  </label>
                  <label className="bridge-port-card">
                    <span>appSecret</span>
                    <Input
                      type="password"
                      value={bridgeConnectorSecretDraft.appSecret}
                      onChange={(event) =>
                        setBridgeConnectorSecretDraft((current) => ({
                          ...current,
                          appSecret: event.currentTarget.value,
                        }))
                      }
                      placeholder="输入新的 appSecret"
                    />
                  </label>
                  <label className="bridge-port-card">
                    <span>verificationToken</span>
                    <Input
                      value={bridgeConnectorSecretDraft.verificationToken}
                      onChange={(event) =>
                        setBridgeConnectorSecretDraft((current) => ({
                          ...current,
                          verificationToken: event.currentTarget.value,
                        }))
                      }
                      placeholder="事件订阅 token，可留空"
                    />
                  </label>
                  <label className="bridge-port-card">
                    <span>encryptKey</span>
                    <Input
                      type="password"
                      value={bridgeConnectorSecretDraft.encryptKey}
                      onChange={(event) =>
                        setBridgeConnectorSecretDraft((current) => ({
                          ...current,
                          encryptKey: event.currentTarget.value,
                        }))
                      }
                      placeholder="事件订阅 encrypt key，可留空"
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="hint">当前没有选中的机器人，无法编辑凭据。</p>
        )}
      </ControlCenterModalShell>
      <ControlCenterModalShell
        open={bridgeConnectorRuntimeOpen}
        title={
          selectedBridgeConnector
            ? `${selectedBridgeConnector.label} 高级运行面板`
            : "高级运行面板"
        }
        description="这个面板只显示当前机器人相关的状态、绑定、审批、会话、日志和凭据掩码。"
        ariaLabel="Bridge 高级运行面板"
        className="cc-bridge-runtime-modal"
        bodyClassName="cc-bridge-runtime-body"
        onRequestClose={() => setBridgeConnectorRuntimeOpen(false)}
      >
        {selectedBridgeConnector ? (
          <BridgeRuntimePanel
            connector={selectedBridgeConnector}
            status={bridgeStatus}
            sessions={bridgeSessions}
            bindings={bridgeBindings}
            approvals={bridgeApprovals}
            logTail={bridgeLogTail}
            recentErrors={bridgeRecentErrors}
            secretsMask={selectedBridgeConnectorSecrets}
            busy={bridgeBusy}
            onRefreshStatus={onRefreshBridgeStatus}
            onRefreshSessions={() => onRefreshBridgeSessions({ silent: true })}
            onRefreshBindings={onRefreshBridgeBindings}
            onRefreshApprovals={onRefreshBridgeApprovals}
            onRefreshLogTail={onRefreshBridgeLogTail}
            onOpenLogs={onOpenLogs}
            onImportSession={onImportBridgeSession}
            onClearBinding={onClearBridgeBinding}
            onResetBindingSession={onResetBridgeBindingSession}
            onResetBindingToDefaultWorkDir={onResetBridgeBindingToDefaultWorkDir}
            onResolveApproval={onResolveBridgeApproval}
          />
        ) : (
          <p className="hint">当前没有选中的机器人，无法展示运行面板。</p>
        )}
      </ControlCenterModalShell>
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
