import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Check,
  ChevronRight,
  Eraser,
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
  FeishuConnectorOnboardingSession,
  WeixinConnectorOnboardingSession,
  BridgeOnboardingConfigInput,
  BridgeOnboardingValidation,
  BridgePlatform,
  BridgeSessionImportInput,
  BridgeSessionRecord,
  BridgeSecretsMaskView,
  BridgeSettings,
  BridgeStatus,
  ControlCenterTaskId,
  ControlCenterTaskPayload,
  ControlCenterSurface,
  ContextMenuStatus,
  ControlSectionId,
  DiagnosticsInfo,
  InstallFlowCatalog,
  InstallMirrorHealthReport,
  InstallSettingsView,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallTaskId,
  DiscoveredSkillDetail,
  SkillDiscoverySnapshot,
  InstalledSkill,
  KimiCliApiConfigView,
  KimiCliConfigCenterInput,
  KimiCliConfigCenterView,
  MainWindowCloseBehavior,
  OnboardingStatus,
  PowerShellPreflightSummary,
  RuntimePanelId,
  SessionSkillState,
  SkillApplyScope,
  SkillCenterFilter,
  SkillCenterSectionId,
  SkillDetail,
  SkillDiscoveryContainerKind,
  SkillProjectionRecord,
  SkillRecommendation,
  WorkspaceSkillInventory,
  WorkspaceSkillProfile,
  WorkspaceSkillRestoreResult,
  WorkspaceSkillTarget,
  WorkspaceWebMode,
  WorkspaceWebSettingsView,
} from "@/app/types";
import {
  formatAuthMode,
  formatKimiLoginHealthSource,
  formatKimiLoginHealthState,
  formatProviderApiHealthSource,
  formatProviderApiHealthState,
} from "@/app/types";
import { DiagnosticItem } from "@/components/common/DiagnosticItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ControlCenterEmptyState } from "@/components/control-center/ControlCenterEmptyState";
import { ControlCenterMetricCard } from "@/components/control-center/ControlCenterMetricCard";
import { ControlCenterSegmentedControl } from "@/components/control-center/ControlCenterSegmentedControl";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterToggleField } from "@/components/control-center/ControlCenterToggleField";
import { ControlCenterWorkbenchLayout } from "@/components/control-center/ControlCenterWorkbenchLayout";
import { BridgeRuntimePanel } from "@/features/bridge/BridgeRuntimePanel";
import { ControlCenterCardHeader } from "@/features/control-center/ControlCenterCardHeader";
import {
  buildBlockingErrors,
  buildWarnings,
  ConfigCenterTaskContent,
} from "@/features/control-center/ConfigCenterModal";
import { ControlCenterTaskSurface } from "@/features/control-center/ControlCenterTaskSurface";
import {
  InstallFlowTaskContent,
} from "@/features/control-center/InstallFlowModal";
import { SkillCenterPanel } from "@/features/skill-center/SkillCenterPanel";
import { pickRandomAgentTip, type AgentTip } from "@/lib/agentTips";

const FEISHU_REPLY_RENDERER_OPTIONS = [
  {
    value: "streaming",
    label: "Streaming",
    description: "在同一张飞书卡片里持续更新内容。",
  },
  {
    value: "interactive",
    label: "Interactive",
    description: "生成完成后发送交互卡片。",
  },
  {
    value: "post",
    label: "Post",
    description: "生成完成后发送普通富文本消息。",
  },
] as const;

type StepCompletion = Record<ActionableOnboardingStep, boolean>;
type BridgePrimaryActionMode = "save_enable" | "start" | "apply_restart";
type OnboardingCardId =
  | "install"
  | "context_menu"
  | "auth"
  | "work_dir";

type BridgeConnectorSecretDraft = {
  botToken: string;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  weixinBaseUrl: string;
  weixinAccountId: string;
  weixinOwnerUserId: string;
};

type BridgeDeleteConfirmState = {
  connectorId: string;
  connectorLabel: string;
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
  installAction:
    | "dependencies"
    | "kimi"
    | "upgrade_kimi"
    | "uninstall_kimi"
    | "nodejs"
    | null;
  bridgeSettings: BridgeSettings;
  bridgeStatus: BridgeStatus;
  bridgeOnboardingDraft: BridgeOnboardingConfigInput;
  bridgeOnboardingDirty: boolean;
  bridgeOnboardingValidation: BridgeOnboardingValidation;
  bridgeSettingsDirty: boolean;
  bridgePersistedConnectorIds: string[];
  bridgeSessions: BridgeSessionRecord[];
  bridgeBindings: BindingRecord[];
  bridgeApprovals: BridgeApprovalRecord[];
  bridgeLogTail: string[];
  bridgeRecentErrors: string[];
  bridgeSecretsMask: BridgeSecretsMaskView;
  feishuConnectorOnboarding: FeishuConnectorOnboardingSession | null;
  feishuConnectorOnboardingBusy: boolean;
  weixinConnectorOnboarding: WeixinConnectorOnboardingSession | null;
  weixinConnectorOnboardingBusy: boolean;
  bridgeBusy: boolean;
  installedSkills: InstalledSkill[];
  skillCenterBusy: boolean;
  skillCenterSearch: string;
  skillCenterFilter: SkillCenterFilter;
  skillCenterSection: SkillCenterSectionId;
  skillCenterGitRepoUrl: string;
  skillCenterGitRef: string;
  selectedSkillId: string | null;
  selectedSkillDetail: SkillDetail | null;
  globalSkillProjections: SkillProjectionRecord[];
  activeSessionSkillState: SessionSkillState;
  workspaceSkillProfile: WorkspaceSkillProfile | null;
  workspaceRecentSkillIds: string[];
  workspaceSkillRecommendations: SkillRecommendation[];
  workspaceSkillRestoreResults: WorkspaceSkillRestoreResult[];
  skillDiscoverySnapshot: SkillDiscoverySnapshot | null;
  selectedDiscoveryId: string | null;
  selectedDiscoveryDetail: DiscoveredSkillDetail | null;
  workspaceSkillTargets: WorkspaceSkillTarget[];
  selectedWorkspaceSkillTargetId: string | null;
  workspaceSkillInventory: WorkspaceSkillInventory | null;
  selectedWorkspaceSkillContainerKind: SkillDiscoveryContainerKind;
  kimiPathInput: string;
  workDirInput: string;
  kimiApiConfigView: KimiCliApiConfigView | null;
  kimiApiKeyInput: string;
  onKimiApiKeyInputChange: (value: string) => void;
  configCenterView: KimiCliConfigCenterView | null;
  configCenterDraft: KimiCliConfigCenterInput;
  configCenterBusy: boolean;
  configCenterDirty: boolean;
  installProbe: InstallProbeStatus | null;
  installSource: "official" | "mirror";
  installSettings: InstallSettingsView;
  installSettingsBusy: boolean;
  workspaceWebSettings: WorkspaceWebSettingsView;
  workspaceWebSettingsBusy: boolean;
  installMirrorHealthReport: InstallMirrorHealthReport | null;
  installMirrorHealthBusy: boolean;
  powershellPreflight: PowerShellPreflightSummary | null;
  installFlowCatalog: InstallFlowCatalog | null;
  installSessionSnapshot: InstallSessionSnapshot;
  activeTask: ControlCenterTaskId | null;
  activeTaskPayload: ControlCenterTaskPayload | null;
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
  onRefreshSkillDiscoveryState: () => Promise<unknown>;
  onRefreshWorkspaceSkillManagementState: () => Promise<unknown>;
  onSaveBridgeConnectorSecrets: (input: BridgeConnectorSecretsInput) => Promise<void>;
  onStartFeishuConnectorOnboarding: (
    connectorId: string,
  ) => Promise<FeishuConnectorOnboardingSession>;
  onRefreshFeishuConnectorOnboardingStatus: (
    sessionId: string,
  ) => Promise<FeishuConnectorOnboardingSession>;
  onCancelFeishuConnectorOnboarding: (
    sessionId: string,
  ) => Promise<FeishuConnectorOnboardingSession>;
  onStartWeixinConnectorOnboarding: (
    connectorId: string,
  ) => Promise<WeixinConnectorOnboardingSession>;
  onRefreshWeixinConnectorOnboardingStatus: (
    sessionId: string,
  ) => Promise<WeixinConnectorOnboardingSession>;
  onCancelWeixinConnectorOnboarding: (
    sessionId: string,
  ) => Promise<WeixinConnectorOnboardingSession>;
  onRefreshSkillCenterState: () => Promise<unknown>;
  onRefreshInstallProbe: () => Promise<InstallProbeStatus>;
  onRefreshInstallMirrorHealth: (input?: InstallSettingsView) => Promise<InstallMirrorHealthReport>;
  onRefreshOnboarding: () => Promise<void>;
  onClose: () => void;
  onRetry: () => Promise<void>;
  onOpenLogs: () => Promise<void>;
  onOpenFolder: (path: string) => Promise<void>;
  onOpenKimiConfigDir: () => Promise<void>;
  onSaveKimiCliApiConfig: () => Promise<void>;
  onSetKimiCliApiAsDefault: () => Promise<void>;
  onSetKimiLoginAsDefault: () => Promise<void>;
  onPickKimiPath: () => Promise<void>;
  onSavePathAndRetry: () => Promise<void>;
  onEnableContextMenu: () => Promise<void>;
  onDisableContextMenu: () => Promise<void>;
  onProbeLogin: () => Promise<void>;
  onLogoutKimiLogin: () => Promise<void>;
  onPickWorkDir: () => Promise<void>;
  onPickBridgeConnectorDefaultWorkDir: (connectorId: string) => Promise<string | null>;
  onSaveWorkDirAndRestart: () => Promise<void>;
  onClearWorkDir: () => Promise<void>;
  onBridgeSettingsChange: (next: BridgeSettings) => void;
  onBridgeOnboardingDraftChange: (next: BridgeOnboardingConfigInput) => void;
  onToggleBridgeConnectorEnabled: (connectorId: string, enabled: boolean) => Promise<void>;
  onDeleteBridgeConnector: (connectorId: string) => Promise<BridgeSettings>;
  onPersistBridgeSettings: (options?: {
    showRestartNotice?: boolean;
  }) => Promise<BridgeSettings>;
  onRunBridgePrimaryAction: (mode: BridgePrimaryActionMode) => Promise<void>;
  onStopBridge: () => Promise<void>;
  onRestartBridge: () => Promise<void>;
  onImportBridgeSession: (input: BridgeSessionImportInput) => Promise<void>;
  onClearBridgeBinding: (bindingId: string) => Promise<void>;
  onResetBridgeBindingSession: (bindingId: string) => Promise<void>;
  onResetBridgeBindingToDefaultWorkDir: (bindingId: string) => Promise<void>;
  onResolveBridgeApproval: (approvalId: string, status: string) => Promise<void>;
  onSkillCenterSearchChange: (value: string) => void;
  onSkillCenterFilterChange: (value: SkillCenterFilter) => void;
  onSkillCenterSectionChange: (value: SkillCenterSectionId) => void;
  onSkillCenterGitRepoUrlChange: (value: string) => void;
  onSkillCenterGitRefChange: (value: string) => void;
  onSelectSkill: (skillId: string) => Promise<void>;
  onOpenSkillFromInsights: (skillId: string) => Promise<void>;
  onOpenTask: (
    task: ControlCenterTaskId,
    payload?: ControlCenterTaskPayload | null,
  ) => Promise<void>;
  onCloseTask: () => boolean;
  onSelectDiscoveredSkill: (discoveryId: string) => Promise<void>;
  onScanDiscoveredSkills: () => Promise<void>;
  onImportDiscoveredSkill: (discoveryId: string) => Promise<void>;
  onSelectWorkspaceSkillTarget: (targetId: string) => Promise<void> | void;
  onSelectWorkspaceSkillContainer: (containerKind: SkillDiscoveryContainerKind) => void;
  onAddInstalledSkillToWorkspaceTarget: (
    skillId: string,
    targetId?: string | null,
    containerKind?: SkillDiscoveryContainerKind,
  ) => Promise<void> | void;
  onConfirmInstallSkillFromGit: () => Promise<void>;
  onConfirmImportSkillFromPath: (mode: "directory" | "zip") => Promise<void>;
  onSetSkillTrust: (skillId: string, trusted: boolean) => Promise<void>;
  onApplySkill: (skillId: string, scope: SkillApplyScope) => Promise<void>;
  onRemoveSkill: (skillId: string, scope: SkillApplyScope) => Promise<void>;
  onSetWorkspaceSkillPin: (skillId: string, pinned: boolean) => Promise<void>;
  onUpdateSkill: (skillId: string) => Promise<void>;
  onUninstallSkill: (skillId: string) => Promise<void>;
  onRecoverWorkspaceSkill: (skillId: string) => Promise<void>;
  onConfigCenterDraftChange: (next: KimiCliConfigCenterInput) => void;
  onResetConfigCenterDraft: () => void;
  onSaveKimiCliConfigCenter: () => Promise<void>;
  onSaveMainWindowCloseBehavior: (
    behavior: MainWindowCloseBehavior,
  ) => Promise<MainWindowCloseBehavior>;
  onInstallSourceChange: (source: "official" | "mirror") => void;
  onSaveInstallSettings: (input: InstallSettingsView) => Promise<unknown>;
  onWorkspaceWebModeChange: (mode: WorkspaceWebMode) => Promise<unknown>;
  onWorkspaceWebAutoFallbackChange: (enabled: boolean) => Promise<unknown>;
  onFallbackWorkspaceWebToOfficial: (reason?: string) => Promise<unknown>;
  onRefreshPowerShellPreflight: () => Promise<PowerShellPreflightSummary>;
  onInstallDependencies: () => Promise<void>;
  onInstallKimi: () => Promise<void>;
  onUpgradeKimi: () => Promise<void>;
  onInstallNodejs: () => Promise<void>;
  onStartInstallTask: (taskId: InstallTaskId) => Promise<void>;
  onCancelInstallTask: () => Promise<void>;
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

function hasLatinLetters(value: string): boolean {
  return /[A-Za-z]/.test(value);
}

function getBridgeDisplayName(settings: BridgeSettings): string {
  const weixinEnabled = settings.connectors.some(
    (connector) => connector.platform === "weixin" && connector.enabled,
  );
  const feishuEnabled = settings.connectors.some(
    (connector) => connector.platform === "feishu" && connector.enabled,
  );
  if (weixinEnabled) {
    return "微信";
  }
  if (feishuEnabled) {
    return "飞书";
  }
  return "IM Bridge";
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
    weixinBaseUrl: "",
    weixinAccountId: "",
    weixinOwnerUserId: "",
  };
}

function bridgePlatformLabel(platform: BridgePlatform): string {
  if (platform === "telegram") {
    return "Telegram";
  }
  if (platform === "weixin") {
    return "微信";
  }
  return "飞书";
}

function formatWorkspaceWebMode(mode: WorkspaceWebMode): string {
  return mode === "enhanced_local" ? "本地增强版" : "官方 Web";
}

function formatEnhancedWebHealth(state: WorkspaceWebSettingsView["health"]["state"]): string {
  switch (state) {
    case "ready":
      return "可用";
    case "fallback_active":
      return "已回退";
    case "missing_assets":
      return "资源缺失";
    case "error":
      return "异常";
    default:
      return "未配置";
  }
}

function formatEnhancedWebHealthTone(
  state: WorkspaceWebSettingsView["health"]["state"],
): "neutral" | "success" | "warning" | "danger" {
  switch (state) {
    case "ready":
      return "success";
    case "fallback_active":
    case "missing_assets":
      return "warning";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

function defaultBridgeConnectorLabel(platform: BridgePlatform, index: number): string {
  if (platform === "telegram") {
    return `Telegram 机器人 ${String(index).padStart(2, "0")}`;
  }
  if (platform === "weixin") {
    return `微信机器人 ${String(index).padStart(2, "0")}`;
  }
  return `飞书机器人 ${String(index).padStart(2, "0")}`;
}

function generateUniqueBridgeConnectorId(
  platform: BridgePlatform,
  existingIds: Set<string>,
): string {
  const idBase =
    platform === "telegram" ? "telegram" : platform === "weixin" ? "weixin" : "feishu";

  while (true) {
    const randomPart =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 12);
    const nextId = `${idBase}-${randomPart.toLowerCase()}`;
    if (!existingIds.has(nextId)) {
      return nextId;
    }
  }
}

function findBridgeConnectorRecentError(
  connector: BridgeConnectorConfig,
  connectorStatus: BridgeStatus["connectors"][number] | null,
  recentErrors: string[],
) {
  return (
    connectorStatus?.lastError ||
    connectorStatus?.lastErrorCode ||
    recentErrors.find(
      (entry) =>
        entry.includes(connector.id) ||
        entry.includes(connector.label) ||
        entry.includes(connector.platform),
    ) ||
    ""
  );
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

function formatBridgeConnectorStateTone(
  value: BridgeStatus["connectors"][number]["state"] | "idle",
): "success" | "warning" | "danger" | "neutral" {
  switch (value) {
    case "ready":
      return "success";
    case "degraded":
      return "warning";
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

function hasBridgeConnectorSecretsConfigured(
  connector: BridgeConnectorConfig,
  connectorSecrets:
    | BridgeSecretsMaskView["connectors"][number]
    | null,
): boolean {
  if (connector.platform === "telegram") {
    return Boolean(connectorSecrets?.telegram?.botToken.configured);
  }
  if (connector.platform === "weixin") {
    return Boolean(
      connectorSecrets?.weixin?.botToken.configured &&
        connectorSecrets?.weixin?.ownerUserId,
    );
  }
  return Boolean(
    connectorSecrets?.feishu?.appId.configured &&
      connectorSecrets?.feishu?.appSecret.configured,
  );
}

function formatBridgeTimestamp(value?: string): string {
  if (!value) {
    return "未记录";
  }
  return Number.isNaN(Date.parse(value))
    ? value
    : new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatLoginCheckTimestamp(value?: number): string {
  if (!value) {
    return "未记录";
  }
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isFeishuOnboardingActive(
  session: FeishuConnectorOnboardingSession | null,
): boolean {
  return (
    session?.state === "awaiting_scan" || session?.state === "polling"
  );
}

function formatFeishuOnboardingStateLabel(
  state: FeishuConnectorOnboardingSession["state"],
): string {
  switch (state) {
    case "awaiting_scan":
      return "等待扫码";
    case "polling":
      return "等待授权";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "expired":
      return "已过期";
    case "cancelled":
      return "已取消";
    default:
      return "未开始";
  }
}

function formatFeishuOnboardingTone(
  state: FeishuConnectorOnboardingSession["state"],
): "success" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "succeeded":
      return "success";
    case "awaiting_scan":
    case "polling":
      return "warning";
    case "failed":
    case "expired":
      return "danger";
    default:
      return "neutral";
  }
}

function isWeixinOnboardingActive(
  session: WeixinConnectorOnboardingSession | null,
): boolean {
  return session?.state === "awaiting_scan" || session?.state === "polling";
}

function formatWeixinOnboardingStateLabel(
  state: WeixinConnectorOnboardingSession["state"],
): string {
  switch (state) {
    case "awaiting_scan":
      return "等待扫码";
    case "polling":
      return "等待登录";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "expired":
      return "已过期";
    case "cancelled":
      return "已取消";
    default:
      return "未开始";
  }
}

function formatWeixinOnboardingTone(
  state: WeixinConnectorOnboardingSession["state"],
): "success" | "warning" | "danger" | "neutral" {
  switch (state) {
    case "succeeded":
      return "success";
    case "awaiting_scan":
    case "polling":
      return "warning";
    case "failed":
    case "expired":
      return "danger";
    default:
      return "neutral";
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
  bridgePersistedConnectorIds,
  bridgeSessions,
  bridgeBindings,
  bridgeApprovals,
  bridgeLogTail,
  bridgeRecentErrors,
  bridgeSecretsMask,
  feishuConnectorOnboarding,
  feishuConnectorOnboardingBusy,
  weixinConnectorOnboarding,
  weixinConnectorOnboardingBusy,
  bridgeBusy,
  installedSkills,
  skillCenterBusy,
  skillCenterSearch,
  skillCenterFilter,
  skillCenterSection,
  skillCenterGitRepoUrl,
  skillCenterGitRef,
  selectedSkillId,
  selectedSkillDetail,
  globalSkillProjections,
  activeSessionSkillState,
  workspaceSkillProfile,
  workspaceRecentSkillIds,
  workspaceSkillRecommendations,
  workspaceSkillRestoreResults,
  skillDiscoverySnapshot,
  selectedDiscoveryId,
  selectedDiscoveryDetail,
  workspaceSkillTargets,
  selectedWorkspaceSkillTargetId,
  workspaceSkillInventory,
  selectedWorkspaceSkillContainerKind,
  kimiPathInput,
  workDirInput,
  kimiApiConfigView,
  kimiApiKeyInput,
  onKimiApiKeyInputChange,
  configCenterView,
  configCenterDraft,
  configCenterBusy,
  configCenterDirty,
  installProbe,
  installSource,
  installSettings,
  installSettingsBusy,
  workspaceWebSettings,
  workspaceWebSettingsBusy,
  installMirrorHealthReport,
  installMirrorHealthBusy,
  powershellPreflight,
  installFlowCatalog,
  installSessionSnapshot,
  activeTask,
  activeTaskPayload,
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
  onRefreshSkillDiscoveryState,
  onRefreshWorkspaceSkillManagementState,
  onSaveBridgeConnectorSecrets,
  onStartFeishuConnectorOnboarding,
  onRefreshFeishuConnectorOnboardingStatus,
  onCancelFeishuConnectorOnboarding,
  onStartWeixinConnectorOnboarding,
  onRefreshWeixinConnectorOnboardingStatus,
  onCancelWeixinConnectorOnboarding,
  onRefreshSkillCenterState,
  onRefreshInstallProbe,
  onRefreshInstallMirrorHealth,
  onRefreshOnboarding,
  onClose,
  onRetry,
  onOpenLogs,
  onOpenFolder,
  onOpenKimiConfigDir,
  onSaveKimiCliApiConfig,
  onSetKimiCliApiAsDefault,
  onSetKimiLoginAsDefault,
  onPickKimiPath,
  onSavePathAndRetry,
  onEnableContextMenu,
  onDisableContextMenu,
  onProbeLogin,
  onLogoutKimiLogin,
  onPickWorkDir,
  onPickBridgeConnectorDefaultWorkDir,
  onSaveWorkDirAndRestart,
  onClearWorkDir,
  onBridgeSettingsChange,
  onBridgeOnboardingDraftChange,
  onToggleBridgeConnectorEnabled,
  onDeleteBridgeConnector,
  onPersistBridgeSettings,
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
  onSkillCenterGitRepoUrlChange,
  onSkillCenterGitRefChange,
  onSelectSkill,
  onOpenSkillFromInsights,
  onOpenTask,
  onCloseTask,
  onSelectDiscoveredSkill,
  onScanDiscoveredSkills,
  onImportDiscoveredSkill,
  onSelectWorkspaceSkillTarget,
  onSelectWorkspaceSkillContainer,
  onAddInstalledSkillToWorkspaceTarget,
  onConfirmInstallSkillFromGit,
  onConfirmImportSkillFromPath,
  onSetSkillTrust,
  onApplySkill,
  onRemoveSkill,
  onSetWorkspaceSkillPin,
  onUpdateSkill,
  onUninstallSkill,
  onRecoverWorkspaceSkill,
  onConfigCenterDraftChange,
  onResetConfigCenterDraft,
  onSaveKimiCliConfigCenter,
  onSaveMainWindowCloseBehavior,
  onInstallSourceChange,
  onSaveInstallSettings,
  onWorkspaceWebModeChange,
  onWorkspaceWebAutoFallbackChange,
  onFallbackWorkspaceWebToOfficial,
  onRefreshPowerShellPreflight,
  onInstallDependencies,
  onInstallKimi,
  onUpgradeKimi,
  onInstallNodejs,
  onStartInstallTask,
  onCancelInstallTask,
  onCompleteOnboarding,
  onSkipOnboarding,
  onOpenExternalUrl,
  installMessage,
}: ControlCenterViewProps) {
  const [authCardView, setAuthCardView] = useState<"login" | "api">("login");
  const [selectedBridgeConnectorId, setSelectedBridgeConnectorId] = useState<string | null>(null);
  const [bridgeOverviewPendingConnectorId, setBridgeOverviewPendingConnectorId] =
    useState<string | null>(null);
  const [bridgeOverviewPendingEnabled, setBridgeOverviewPendingEnabled] = useState<
    Record<string, boolean>
  >({});
  const [bridgeConnectorSecretDraft, setBridgeConnectorSecretDraft] =
    useState<BridgeConnectorSecretDraft>(() => createEmptyBridgeConnectorSecretDraft());
  const [bridgeConnectorLabelDraft, setBridgeConnectorLabelDraft] = useState("");
  const [bridgeConnectorTaskError, setBridgeConnectorTaskError] = useState<string | null>(null);
  const [bridgeCreateMenuOpen, setBridgeCreateMenuOpen] = useState(false);
  const [bridgeDeleteConfirm, setBridgeDeleteConfirm] =
    useState<BridgeDeleteConfirmState | null>(null);
  const [expandedOnboardingCard, setExpandedOnboardingCard] =
    useState<OnboardingCardId | null>(null);
  const [runtimePanelExpanded, setRuntimePanelExpanded] = useState(true);
  const [mainCloseBehaviorSaving, setMainCloseBehaviorSaving] = useState(false);
  const [briefTip, setBriefTip] = useState<AgentTip>(() => pickRandomAgentTip());
  const bridgeCreateMenuRef = useRef<HTMLDivElement | null>(null);
  void installAction;
  void bridgeOnboardingDraft;
  void bridgeOnboardingValidation;
  void onBridgeOnboardingDraftChange;
  void onRunBridgePrimaryAction;
  void onStopBridge;
  void onCancelInstallTask;
  void onInstallDependencies;
  void onInstallKimi;
  void onUpgradeKimi;
  void onInstallNodejs;
  void onRefreshSkillCenterState;
  void onRefreshSkillDiscoveryState;
  const installPathDisplay =
    onboarding?.detectedKimiPath?.trim() ?? kimiPathInput.trim();
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
  const bridgeEnabled = bridgeSettings.enabled;
  const feishuEnabled = bridgeSettings.connectors.some(
    (connector) => connector.platform === "feishu" && connector.enabled,
  );
  const bridgeDisplayName = getBridgeDisplayName(bridgeSettings);
  const bridgeFinalStatusTitle = "IM机器人";
  const openBridgeTitle = formatOpenBridgeDisplayName(bridgeDisplayName);
  const bridgeTaskConnectorId =
    activeTask === "bridge_connector_secrets" || activeTask === "bridge_runtime"
      ? activeTaskPayload?.connectorId ?? null
      : null;
  const effectiveSelectedBridgeConnectorId = bridgeTaskConnectorId ?? selectedBridgeConnectorId;
  const isBridgeConnectorSecretsTask = activeTask === "bridge_connector_secrets";
  const isBridgeRuntimeTask = activeTask === "bridge_runtime";
  const isConfigCenterTask = activeTask === "config_center";
  const isSkillGitImportTask = activeTask === "skill_git_import";
  const isSkillImportTask = activeTask === "skill_import";
  const shouldRenderInlineBridgeTask =
    activeControlSection === "bridge_center" &&
    (isBridgeConnectorSecretsTask || isBridgeRuntimeTask);
  const selectedBridgeConnector =
    bridgeSettings.connectors.find(
      (connector) => connector.id === effectiveSelectedBridgeConnectorId,
    ) ?? null;
  const selectedBridgeConnectorStatus =
    bridgeStatus.connectors.find(
      (connector) => connector.connectorId === effectiveSelectedBridgeConnectorId,
    ) ?? null;
  const selectedBridgeConnectorSecrets =
    bridgeSecretsMask.connectors.find(
      (connector) => connector.connectorId === effectiveSelectedBridgeConnectorId,
    ) ?? null;
  const selectedFeishuOnboarding =
    selectedBridgeConnector?.platform === "feishu" &&
    feishuConnectorOnboarding?.connectorId === selectedBridgeConnector.id
      ? feishuConnectorOnboarding
      : null;
  const selectedWeixinOnboarding =
    selectedBridgeConnector?.platform === "weixin" &&
    weixinConnectorOnboarding?.connectorId === selectedBridgeConnector.id
      ? weixinConnectorOnboarding
      : null;
  const selectedFeishuSecretsConfigured = Boolean(
    selectedBridgeConnectorSecrets?.feishu?.appId.configured &&
      selectedBridgeConnectorSecrets?.feishu?.appSecret.configured,
  );
  const selectedWeixinSecretsConfigured = Boolean(
    selectedBridgeConnectorSecrets?.weixin?.botToken.configured &&
      selectedBridgeConnectorSecrets?.weixin?.ownerUserId,
  );
  const selectedBridgeConnectorPersisted = Boolean(
    selectedBridgeConnector &&
      bridgePersistedConnectorIds.includes(selectedBridgeConnector.id),
  );
  const selectedBridgeConnectorBindings = useMemo(
    () =>
      selectedBridgeConnector
        ? bridgeBindings.filter((item) => item.connectorId === selectedBridgeConnector.id)
        : [],
    [bridgeBindings, selectedBridgeConnector],
  );
  const selectedBridgeConnectorApprovals = useMemo(
    () =>
      selectedBridgeConnector
        ? bridgeApprovals.filter((item) => item.connectorId === selectedBridgeConnector.id)
        : [],
    [bridgeApprovals, selectedBridgeConnector],
  );
  const selectedBridgeConnectorRecentError = selectedBridgeConnector
    ? findBridgeConnectorRecentError(
        selectedBridgeConnector,
        selectedBridgeConnectorStatus,
        bridgeRecentErrors,
      )
    : "";
  const selectedBridgeConnectorSecretsConfigured = selectedBridgeConnector
    ? hasBridgeConnectorSecretsConfigured(
        selectedBridgeConnector,
        selectedBridgeConnectorSecrets,
      )
    : false;
  const selectedBridgeConnectorEffectiveWorkDir = selectedBridgeConnector
    ? selectedBridgeConnector.defaultWorkDir?.trim() ||
      bridgeSettings.defaultWorkDir?.trim() ||
      status?.effectiveWorkDir?.trim() ||
      ""
    : bridgeSettings.defaultWorkDir?.trim() || status?.effectiveWorkDir?.trim() || "";
  const selectedBridgeConnectorUsesCustomWorkDir = Boolean(
    selectedBridgeConnector?.defaultWorkDir?.trim(),
  );
  const selectedBridgeConnectorPendingToggle = Boolean(
    selectedBridgeConnector &&
      bridgeOverviewPendingConnectorId === selectedBridgeConnector.id,
  );
  const selectedBridgeConnectorEnabledValue = selectedBridgeConnector
    ? selectedBridgeConnectorPendingToggle
      ? (bridgeOverviewPendingEnabled[selectedBridgeConnector.id] ??
        selectedBridgeConnector.enabled)
      : selectedBridgeConnector.enabled
    : false;
  const sortedBridgeConnectors = useMemo(() => {
    const platformPriority: Record<BridgePlatform, number> = {
      weixin: 0,
      feishu: 1,
      telegram: 2,
    };
    return [...bridgeSettings.connectors].sort((left, right) => {
      const leftStatus =
        bridgeStatus.connectors.find((item) => item.connectorId === left.id) ?? null;
      const rightStatus =
        bridgeStatus.connectors.find((item) => item.connectorId === right.id) ?? null;
      const leftHasIssue = Boolean(
        findBridgeConnectorRecentError(left, leftStatus, bridgeRecentErrors) ||
          leftStatus?.state === "error" ||
          leftStatus?.state === "degraded",
      );
      const rightHasIssue = Boolean(
        findBridgeConnectorRecentError(right, rightStatus, bridgeRecentErrors) ||
          rightStatus?.state === "error" ||
          rightStatus?.state === "degraded",
      );
      if (left.enabled !== right.enabled) {
        return left.enabled ? -1 : 1;
      }
      if (leftHasIssue !== rightHasIssue) {
        return leftHasIssue ? -1 : 1;
      }
      if (left.platform !== right.platform) {
        return platformPriority[left.platform] - platformPriority[right.platform];
      }
      return left.label.localeCompare(right.label, "zh-CN");
    });
  }, [bridgeRecentErrors, bridgeSettings.connectors, bridgeStatus.connectors]);
  const visibleBridgeConnectors = useMemo(
    () => sortedBridgeConnectors,
    [sortedBridgeConnectors],
  );
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
  const kimiLoginReady = onboarding?.kimiLoginHealth.state === "verified";
  const providerApiHealth = onboarding?.providerApiHealth ?? status?.providerApiHealth;
  const providerApiConfigured =
    onboarding?.providerApiConfigured ??
    status?.providerApiConfigured ??
    Boolean(
      configCenterView &&
        ((configCenterView.defaultProvider &&
          configCenterView.providers.some(
            (entry) =>
              entry.key.trim() === configCenterView.defaultProvider?.trim() &&
              (Boolean(entry.apiKey?.trim()) || Boolean(entry.authToken?.trim())),
          )) ||
          configCenterView.providers.some(
            (entry) =>
              Boolean(entry.key.trim()) &&
              (Boolean(entry.apiKey?.trim()) || Boolean(entry.authToken?.trim())),
          )),
    );
  const providerApiReady = providerApiConfigured && !providerApiHealth?.needsAttention;
  const authStatusLabel = kimiLoginReady || providerApiReady ? "就绪" : providerApiConfigured ? "异常" : "待办";
  const authStatusTone = kimiLoginReady || providerApiReady ? "success" : providerApiConfigured ? "warning" : "neutral";
  const workDirStatusLabel = effectiveWorkDir ? "就绪" : "待办";
  const workDirStatusTone = effectiveWorkDir ? "success" : "warning";

  useEffect(() => {
    if (
      !isBridgeConnectorSecretsTask ||
      !selectedFeishuOnboarding ||
      !isFeishuOnboardingActive(selectedFeishuOnboarding)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void onRefreshFeishuConnectorOnboardingStatus(selectedFeishuOnboarding.sessionId);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [
    isBridgeConnectorSecretsTask,
    onRefreshFeishuConnectorOnboardingStatus,
    selectedFeishuOnboarding,
  ]);

  useEffect(() => {
    if (
      !isBridgeConnectorSecretsTask ||
      !selectedWeixinOnboarding ||
      !isWeixinOnboardingActive(selectedWeixinOnboarding)
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      void onRefreshWeixinConnectorOnboardingStatus(selectedWeixinOnboarding.sessionId);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [
    isBridgeConnectorSecretsTask,
    onRefreshWeixinConnectorOnboardingStatus,
    selectedWeixinOnboarding,
  ]);

  useEffect(() => {
    setBridgeConnectorTaskError(null);
  }, [activeTask, effectiveSelectedBridgeConnectorId]);

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
  const contextMenuReady = !runtimeContextMenuSupported || runtimeContextMenuEnabled;
  const installReady = onboarding?.kimiInstalled ?? stepCompletion.install_kimi;
  const authReady = Boolean(kimiLoginReady || providerApiReady);
  const workDirReady = Boolean(effectiveWorkDir);
  const authMode = onboarding?.authMode ?? status?.authMode ?? "unknown";
  const canLogoutKimi = (onboarding?.kimiLoginHealth.state ?? status?.kimiLoginHealth.state) === "verified";
  const authBannerVisible = Boolean(
    authMode === "kimi_login" && onboarding?.kimiLoginHealth.needsAttention,
  );
  const authBannerTitle =
    onboarding?.kimiLoginHealth.state === "error"
      ? "Kimi 登录检测异常"
      : "Kimi 登录需要重新验证";
  const authBannerMeta = [
    `当前入口：${formatAuthMode(authMode)}`,
    `来源：${formatKimiLoginHealthSource(onboarding?.kimiLoginHealth.source)}`,
    `时间：${formatLoginCheckTimestamp(onboarding?.kimiLoginHealth.checkedAtMs)}`,
    onboarding?.kimiLoginHealth.exitCode != null
      ? `退出码：${onboarding.kimiLoginHealth.exitCode}`
      : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");
  const kimiLoginStatusLabel = formatKimiLoginHealthState(onboarding?.kimiLoginHealth.state);
  const kimiLoginStatusTone =
    onboarding?.kimiLoginHealth.state === "verified"
      ? "success"
      : onboarding?.kimiLoginHealth.state === "auth_required"
        ? "warning"
        : onboarding?.kimiLoginHealth.state === "error"
          ? "danger"
          : "neutral";
  const providerApiStatusLabel = !providerApiConfigured
    ? "未配置"
    : providerApiHealth?.state === "auth_required"
      ? `认证失败${onboarding?.providerApiActiveProvider ? ` · ${onboarding.providerApiActiveProvider}` : ""}`
      : providerApiHealth?.state === "error"
        ? `运行异常${onboarding?.providerApiActiveProvider ? ` · ${onboarding.providerApiActiveProvider}` : ""}`
        : `已配置${onboarding?.providerApiActiveProvider ? ` · ${onboarding.providerApiActiveProvider}` : ""}`;
  const providerApiStatusTone = !providerApiConfigured
    ? "neutral"
    : providerApiHealth?.state === "error"
      ? "danger"
      : providerApiHealth?.state === "auth_required"
        ? "warning"
        : "success";
  const recommendedOnboardingCard: OnboardingCardId = !installReady
    ? "install"
    : !contextMenuReady
      ? "context_menu"
      : !authReady
        ? "auth"
        : "work_dir";
  const defaultOnboardingCard: OnboardingCardId =
    installSessionSnapshot.taskId === "upgrade_kimi" && installSessionSnapshot.status !== "idle"
      ? "install"
      : recommendedOnboardingCard;

  function toggleOnboardingCard(cardId: OnboardingCardId) {
    setExpandedOnboardingCard(cardId);
  }

  useEffect(() => {
    if (activeControlSection !== "onboarding") {
      setExpandedOnboardingCard(null);
      return;
    }
    if (!expandedOnboardingCard) {
      setExpandedOnboardingCard(defaultOnboardingCard);
    }
  }, [activeControlSection, defaultOnboardingCard, expandedOnboardingCard]);

  useEffect(() => {
    if (activeControlSection === "runtime_center") {
      setRuntimePanelExpanded(true);
      return;
    }
    setRuntimePanelExpanded(false);
  }, [activeControlSection]);

  useEffect(() => {
    if (
      !selectedBridgeConnectorId ||
      !visibleBridgeConnectors.some((item) => item.id === selectedBridgeConnectorId)
    ) {
      setSelectedBridgeConnectorId(visibleBridgeConnectors[0]?.id ?? null);
    }
  }, [selectedBridgeConnectorId, visibleBridgeConnectors]);

  useEffect(() => {
    setBridgeConnectorLabelDraft(selectedBridgeConnector?.label ?? "");
  }, [selectedBridgeConnector?.id, selectedBridgeConnector?.label]);

  useEffect(() => {
    if (!bridgeCreateMenuOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        bridgeCreateMenuRef.current &&
        target instanceof Node &&
        !bridgeCreateMenuRef.current.contains(target)
      ) {
        setBridgeCreateMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [bridgeCreateMenuOpen]);

  useEffect(() => {
    if (activeControlSection !== "bridge_center" || shouldRenderInlineBridgeTask) {
      setBridgeCreateMenuOpen(false);
    }
  }, [activeControlSection, shouldRenderInlineBridgeTask]);

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
  const installPrimaryTaskId: InstallTaskId = installReady ? "upgrade_kimi" : "quick_install_core";
  const installPrimaryActionLabel = installReady ? "升级 Kimi" : "一键安装 Kimi CLI";
  const installPrimaryAction = (
    <Button
      type="button"
      icon={installReady ? <RefreshCcw size={15} /> : <Plus size={15} />}
      className="cc-action-btn"
      onClick={() => void onStartInstallTask(installPrimaryTaskId)}
      disabled={installBusy}
    >
      {installPrimaryActionLabel}
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
        onClick={() => void onSaveKimiCliApiConfig()}
        disabled={
          actionBusy ||
          configCenterBusy ||
          configCenterDirty ||
          (!kimiApiConfigView?.hasApiKey && !kimiApiKeyInput.trim())
        }
      >
        保存
      </Button>
    );

  const authSecondaryAction =
    authCardView === "login" ? (
      <>
        <Button
          type="button"
          variant="outline"
          icon={<Check size={14} />}
          className="cc-action-btn"
          onClick={() => void onSetKimiLoginAsDefault()}
          disabled={actionBusy || configCenterBusy || configCenterDirty}
        >
          设为默认登录
        </Button>
        <Button
          type="button"
          variant="ghost"
          icon={<Minus size={15} />}
          className="cc-action-btn"
          onClick={() => void onLogoutKimiLogin()}
          disabled={loginProbeBusy || !canLogoutKimi}
        >
          退出登录
        </Button>
      </>
    ) : (
      <Button
        type="button"
        variant="outline"
        icon={<Check size={14} />}
        className="cc-action-btn"
        onClick={() => void onSetKimiCliApiAsDefault()}
        disabled={
          actionBusy ||
          configCenterBusy ||
          configCenterDirty ||
          !kimiApiConfigView?.templateConfigured
        }
      >
        设为默认 API
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
    if (activeTask && section !== activeControlSection) {
      const closed = onCloseTask();
      if (!closed) {
        return;
      }
    }
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

  async function handleStartInstallFlowTask(taskId: InstallTaskId) {
    if (taskId === "upgrade_kimi") {
      setExpandedOnboardingCard("install");
    }
    await onStartInstallTask(taskId);
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

  function addBridgeConnector(platform: BridgePlatform) {
    const existingIds = new Set(bridgeSettings.connectors.map((connector) => connector.id));
    let index = 1;
    while (
      bridgeSettings.connectors.some(
        (connector) =>
          connector.platform === platform &&
          connector.label === defaultBridgeConnectorLabel(platform, index),
      )
    ) {
      index += 1;
    }
    const nextConnector: BridgeConnectorConfig = {
      id: generateUniqueBridgeConnectorId(platform, existingIds),
      platform,
      enabled: false,
      mode: platform === "feishu" ? "websocket" : "polling",
      label: defaultBridgeConnectorLabel(platform, index),
      defaultWorkDir: bridgeSettings.defaultWorkDir,
      resetBindingSessionOnStart: true,
      feishuAutoApprove: platform === "feishu" ? true : undefined,
      feishuReplyRenderer: platform === "feishu" ? "streaming" : undefined,
      weixinReplyMode: platform === "weixin" ? "status_only" : undefined,
    };
    onBridgeSettingsChange({
      ...bridgeSettings,
      connectors: [...bridgeSettings.connectors, nextConnector],
    });
    setSelectedBridgeConnectorId(nextConnector.id);
  }

  function handleCreateBridgeConnector(platform: Extract<BridgePlatform, "feishu" | "weixin">) {
    setBridgeCreateMenuOpen(false);
    addBridgeConnector(platform);
  }

  async function handleApplyBridgeRobotSettings(nextSelectedConnectorId?: string | null) {
    setBridgeConnectorTaskError(null);
    await onPersistBridgeSettings({ showRestartNotice: false });
    if (isBridgeRunning) {
      await onRestartBridge();
      await Promise.all([
        onRefreshBridgeStatus(),
        onRefreshBridgeBindings(),
        onRefreshBridgeApprovals(),
        onRefreshBridgeSessions({ silent: true }),
      ]);
    }
    if (nextSelectedConnectorId !== undefined) {
      setSelectedBridgeConnectorId(nextSelectedConnectorId);
    }
  }

  async function handleDeleteBridgeRobot(connectorId: string) {
    const connector = bridgeSettings.connectors.find((item) => item.id === connectorId);
    if (!connector) {
      return;
    }
    setSelectedBridgeConnectorId(connectorId);
    setBridgeConnectorTaskError(null);
    setBridgeDeleteConfirm({
      connectorId,
      connectorLabel: connector.label,
    });
  }

  function closeBridgeDeleteConfirm() {
    setBridgeDeleteConfirm(null);
  }

  async function handleConfirmDeleteBridgeRobot() {
    if (!bridgeDeleteConfirm) {
      return;
    }
    const { connectorId } = bridgeDeleteConfirm;
    const nextConnectors = bridgeSettings.connectors.filter((item) => item.id !== connectorId);
    const nextSelectedConnectorId =
      selectedBridgeConnectorId === connectorId
        ? nextConnectors[0]?.id ?? null
        : selectedBridgeConnectorId;
    setBridgeConnectorTaskError(null);

    try {
      await onDeleteBridgeConnector(connectorId);
      setSelectedBridgeConnectorId(nextSelectedConnectorId);
      setBridgeDeleteConfirm(null);
    } catch {
      setBridgeConnectorTaskError("删除机器人失败，请稍后重试或查看日志。");
    }
  }

  async function handleBridgeConnectorWorkDirChange(
    connectorId: string,
    nextWorkDir: string | undefined,
  ) {
    const connector = bridgeSettings.connectors.find((item) => item.id === connectorId);
    if (!connector) {
      return;
    }
    const normalizedWorkDir = nextWorkDir?.trim() || undefined;
    const currentWorkDir = connector.defaultWorkDir?.trim() || undefined;
    if (normalizedWorkDir === currentWorkDir) {
      return;
    }

    const previousSettings = bridgeSettings;
    setSelectedBridgeConnectorId(connectorId);
    setBridgeOverviewPendingConnectorId(connectorId);
    setBridgeConnectorTaskError(null);
    updateBridgeConnector(connectorId, { defaultWorkDir: normalizedWorkDir });

    try {
      await handleApplyBridgeRobotSettings(connectorId);
    } catch (error) {
      onBridgeSettingsChange(previousSettings);
      setSelectedBridgeConnectorId(selectedBridgeConnectorId);
      setBridgeConnectorTaskError(`保存机器人工作区失败：${String(error)}`);
    } finally {
      setBridgeOverviewPendingConnectorId((current) =>
        current === connectorId ? null : current,
      );
    }
  }

  async function handlePickBridgeConnectorWorkDir(connectorId: string) {
    const selected = await onPickBridgeConnectorDefaultWorkDir(connectorId);
    if (typeof selected !== "string") {
      return;
    }
    await handleBridgeConnectorWorkDirChange(connectorId, selected);
  }

  function openBridgeConnectorSecretsModal(connectorId: string) {
    setSelectedBridgeConnectorId(connectorId);
    setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
    void onOpenTask("bridge_connector_secrets", { connectorId });
  }

  function openBridgeConnectorRuntimeModal(connectorId: string) {
    setSelectedBridgeConnectorId(connectorId);
    void onOpenTask("bridge_runtime", { connectorId });
  }

  async function handleImmediateBridgeConnectorToggle(
    connectorId: string,
    enabled: boolean,
  ) {
    setSelectedBridgeConnectorId(connectorId);
    setBridgeOverviewPendingConnectorId(connectorId);
    setBridgeOverviewPendingEnabled((current) => ({ ...current, [connectorId]: enabled }));
    try {
      await onToggleBridgeConnectorEnabled(connectorId, enabled);
    } finally {
      setBridgeOverviewPendingConnectorId((current) =>
        current === connectorId ? null : current,
      );
      setBridgeOverviewPendingEnabled((current) => {
        const next = { ...current };
        delete next[connectorId];
        return next;
      });
    }
  }

  async function handleSaveBridgeConnectorSecretDraft() {
    if (!selectedBridgeConnector) {
      return;
    }
    const normalizedLabel = bridgeConnectorLabelDraft.trim();
    if (!normalizedLabel) {
      setBridgeConnectorTaskError("机器人名称不能为空。");
      return;
    }
    if (normalizedLabel.length > 32) {
      setBridgeConnectorTaskError("机器人名称不能超过 32 个字符。");
      return;
    }

    setBridgeConnectorTaskError(null);

    try {
      const shouldNormalizeLabel = selectedBridgeConnector.label !== normalizedLabel;
      const shouldPersistSettings =
        bridgeSettingsDirty || !selectedBridgeConnectorPersisted || shouldNormalizeLabel;

      if (shouldNormalizeLabel) {
        updateBridgeConnector(selectedBridgeConnector.id, { label: normalizedLabel });
        setBridgeConnectorLabelDraft(normalizedLabel);
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 0);
        });
      }

      if (shouldPersistSettings) {
        await onPersistBridgeSettings({ showRestartNotice: false });
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
        weixin: {
          botToken: bridgeConnectorSecretDraft.botToken.trim() || undefined,
          baseUrl: bridgeConnectorSecretDraft.weixinBaseUrl.trim() || undefined,
          accountId: bridgeConnectorSecretDraft.weixinAccountId.trim() || undefined,
          ownerUserId: bridgeConnectorSecretDraft.weixinOwnerUserId.trim() || undefined,
        },
      });

      if (isBridgeRunning) {
        await onRestartBridge();
      }

      await Promise.all([
        onRefreshBridgeSettings(),
        onRefreshBridgeStatus(),
        onRefreshBridgeBindings(),
        onRefreshBridgeApprovals(),
        onRefreshBridgeSecretsMask(),
        onRefreshBridgeSessions({ silent: true }),
      ]);

      setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
      onCloseTask();
    } catch (error) {
      setBridgeConnectorTaskError(`保存并应用机器人配置失败：${String(error)}`);
    }
  }

  async function handleStartSelectedFeishuOnboarding() {
    if (!selectedBridgeConnector || selectedBridgeConnector.platform !== "feishu") {
      return;
    }
    setBridgeConnectorTaskError(null);
    const connectorId = selectedBridgeConnector.id;
    const shouldPersistBeforeOnboarding =
      bridgeSettingsDirty || !selectedBridgeConnectorPersisted;

    if (shouldPersistBeforeOnboarding) {
      try {
        await onPersistBridgeSettings({ showRestartNotice: false });
      } catch (error) {
        setBridgeConnectorTaskError(
          `保存当前机器人配置失败，未启动飞书创建流程：${String(error)}`,
        );
        return;
      }
    }

    try {
      await onStartFeishuConnectorOnboarding(connectorId);
    } catch (error) {
      setBridgeConnectorTaskError(`启动飞书创建流程失败：${String(error)}`);
    }
  }

  async function handleCancelSelectedFeishuOnboarding() {
    if (!selectedFeishuOnboarding) {
      return;
    }
    await onCancelFeishuConnectorOnboarding(selectedFeishuOnboarding.sessionId);
  }

  async function handleStartSelectedWeixinOnboarding() {
    if (!selectedBridgeConnector || selectedBridgeConnector.platform !== "weixin") {
      return;
    }
    setBridgeConnectorTaskError(null);
    const connectorId = selectedBridgeConnector.id;
    const shouldPersistBeforeOnboarding =
      bridgeSettingsDirty || !selectedBridgeConnectorPersisted;

    if (shouldPersistBeforeOnboarding) {
      try {
        await onPersistBridgeSettings({ showRestartNotice: false });
      } catch (error) {
        setBridgeConnectorTaskError(
          `保存当前机器人配置失败，未启动微信扫码流程：${String(error)}`,
        );
        return;
      }
    }

    try {
      await onStartWeixinConnectorOnboarding(connectorId);
    } catch (error) {
      setBridgeConnectorTaskError(`启动微信扫码流程失败：${String(error)}`);
    }
  }

  async function handleCancelSelectedWeixinOnboarding() {
    if (!selectedWeixinOnboarding) {
      return;
    }
    await onCancelWeixinConnectorOnboarding(selectedWeixinOnboarding.sessionId);
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
    title: string;
    actionLabel: string;
    statusLabel: string;
    statusTone: "neutral" | "success" | "warning" | "danger";
    complete: boolean;
    primaryAction: ReactNode;
  }> = [
    {
      id: "install",
      index: "01",
      title: "安装 / 升级 Kimi CLI",
      actionLabel: installPrimaryActionLabel,
      statusLabel: installStatusLabel,
      statusTone: installStatusTone,
      complete: installReady,
      primaryAction: installPrimaryAction,
    },
    {
      id: "context_menu",
      index: "02",
      title: "资源管理器右键菜单",
      actionLabel: runtimeContextMenuEnabled ? "已启用" : "启用右键菜单",
      statusLabel: contextMenuStatusLabel,
      statusTone: contextMenuStatusTone,
      complete: contextMenuReady,
      primaryAction: contextMenuPrimaryAction,
    },
    {
      id: "auth",
      index: "03",
      title: "登录与 Provider API",
      actionLabel: authReady ? "已就绪" : "完成登录或配置 API",
      statusLabel: authStatusLabel,
      statusTone: authStatusTone,
      complete: authReady,
      primaryAction: authPrimaryAction,
    },
    {
      id: "work_dir",
      index: "04",
      title: "默认工作目录",
      actionLabel: workDirReady ? "已设置" : "设置默认工作目录",
      statusLabel: workDirStatusLabel,
      statusTone: workDirStatusTone,
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
    authMode === "kimi_login" && onboarding?.kimiLoginHealth.needsAttention
      ? `Kimi 登录：${onboarding.kimiLoginHealth.message || kimiLoginStatusLabel}`
      : null,
    authMode === "provider_api" && onboarding?.providerApiHealth.needsAttention
      ? `Provider API：${onboarding.providerApiHealth.message || providerApiStatusLabel}`
      : null,
    bridgeRecentErrors[0] ? `Bridge：${bridgeRecentErrors[0]}` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .filter((item) => !/telegram/i.test(item));
  const condensedLogPreview =
    diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0
      ? diagnostics.backendLogTail.slice(-2).join("\n")
      : diagnostics?.appLogTail && diagnostics.appLogTail.length > 0
        ? diagnostics.appLogTail.slice(-2).join("\n")
        : "暂无最新日志摘录。";
  const totalBridgeRobotCount = bridgeSettings.connectors.length;
  const skillDiscoveryRecords = skillDiscoverySnapshot?.records ?? [];
  const externalDiscoveryCount = skillDiscoveryRecords.length;
  const imFinalStatusLabel = `${totalBridgeRobotCount} 个`;
  const overviewBriefs = [
    !installReady ? "Kimi CLI 仍未就绪，建议先完成安装与探测。" : null,
    !contextMenuReady && runtimeContextMenuSupported ? "资源管理器右键菜单尚未启用。" : null,
    !authReady ? "尚未建立登录或 Provider API 入口。" : null,
    authMode === "kimi_login" && onboarding?.kimiLoginHealth.needsAttention
      ? "当前入口依赖 Kimi 登录，建议立即重新验证。"
      : null,
    authMode === "provider_api" && onboarding?.providerApiHealth.needsAttention
      ? "当前入口依赖 Provider API，最近一次请求认证失败。"
      : null,
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
                  <span>发现技能</span>
                  <strong>{externalDiscoveryCount} 个</strong>
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
                    <strong>{step.title}</strong>
                    <small>{step.actionLabel}</small>
                    <span
                      className={`cc-status-badge cc-onboarding-step-status tone-${step.statusTone}`}
                    >
                      {step.statusLabel}
                    </span>
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
                variant="outline"
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
                刷新状态
              </Button>
              <Button
                type="button"
                variant="ghost"
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
                icon={<ChevronRight size={15} />}
                className="cc-action-btn"
                onClick={() => void onSkipOnboarding()}
                disabled={actionBusy}
              >
                暂时跳过
              </Button>
            </div>
          </section>
        </aside>

        <section className="cc-card cc-onboarding-detail-shell">
          <section className="cc-card cc-step-detail-card">
            <ControlCenterCardHeader
              eyebrow={`步骤 ${activeOnboardingStep.index}`}
              title="操作与详情"
              description={activeOnboardingStep.title}
              statusLabel={activeOnboardingStep.statusLabel}
              statusTone={selectedStepTone}
              primaryAction={activeOnboardingStep.primaryAction}
            />
            <div className="cc-card-body cc-step-body cc-step-body-single cc-step-detail-scroll">
              <div className="cc-step-main">
                {activeOnboardingStep.id === "install" ? (
                  <div className="cc-onboarding-install-stack">
                    <div className="cc-step-secondary-actions">{installSecondaryAction}</div>
                    <InstallFlowTaskContent
                      catalog={installFlowCatalog}
                      session={installSessionSnapshot}
                      probe={installProbe}
                      backendState={status?.state ?? null}
                      installSource={installSource}
                      installSettings={installSettings}
                      installSettingsBusy={installSettingsBusy}
                      installMirrorHealthReport={installMirrorHealthReport}
                      installMirrorHealthBusy={installMirrorHealthBusy}
                      powershellPreflight={powershellPreflight}
                      kimiPathInput={kimiPathInput}
                      detectedKimiPath={installPathDisplay}
                      onRefreshPowerShellPreflight={onRefreshPowerShellPreflight}
                      onRefreshMirrorHealth={onRefreshInstallMirrorHealth}
                      onSourceChange={onInstallSourceChange}
                      onSaveInstallSettings={onSaveInstallSettings}
                      onStartTask={handleStartInstallFlowTask}
                      onRestartBackend={onRetry}
                      onPickKimiPath={onPickKimiPath}
                      onSavePathAndRetry={onSavePathAndRetry}
                      restartBusy={actionBusy}
                    />
                    {recentInstallSummary || installMessage ? (
                      <div className="cc-onboarding-install-meta">
                        {recentInstallSummary ? (
                          <p className="hint cc-step-meta">{recentInstallSummary}</p>
                        ) : null}
                        {installMessage ? (
                          <p className="hint cc-step-meta">{installMessage}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
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
                          当前入口：<strong>{formatAuthMode(authMode)}</strong>
                        </p>
                        <div className="cc-brief-list">
                          <article className="cc-brief-item">
                            <strong>Kimi 登录</strong>
                            <span className={`cc-status-badge tone-${kimiLoginStatusTone}`}>
                              {kimiLoginStatusLabel}
                            </span>
                          </article>
                          <article className="cc-brief-item">
                            <strong>Provider API</strong>
                            <span className={`cc-status-badge tone-${providerApiStatusTone}`}>
                              {providerApiStatusLabel}
                            </span>
                          </article>
                        </div>
                        <p className="hint cc-step-meta">
                          最近来源：{formatKimiLoginHealthSource(onboarding?.kimiLoginHealth.source)}；
                          最近时间：{formatLoginCheckTimestamp(onboarding?.kimiLoginHealth.checkedAtMs)}
                          {onboarding?.kimiLoginHealth.exitCode != null
                            ? `；退出码：${onboarding.kimiLoginHealth.exitCode}`
                            : ""}
                        </p>
                        {onboarding?.kimiLoginHealth.message ? (
                          <p className="hint cc-step-meta">
                            最近摘要：{onboarding.kimiLoginHealth.message}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="cc-auth-panel">
                        <p className="hint cc-step-summary">
                          当前入口：<strong>{formatAuthMode(authMode)}</strong>；
                          Provider API：<strong>{providerApiStatusLabel}</strong>
                          {kimiApiConfigView?.isDefault ? "；Kimi Coding Plan 已设为默认" : ""}
                        </p>
                        <div className="cc-brief-list">
                          <article className="cc-brief-item">
                            <strong>供应商</strong>
                            <span>Kimi</span>
                          </article>
                          <article className="cc-brief-item">
                            <strong>接口地址</strong>
                            <span>Kimi Coding Plan</span>
                            <span>https://api.kimi.com/coding/v1</span>
                          </article>
                          <article className="cc-brief-item">
                            <strong>API Key</strong>
                            <span>{kimiApiConfigView?.hasApiKey ? "已保存" : "待填写"}</span>
                            <Input
                              id="kimi-api-key-onboarding"
                              className="cc-brief-inline-input"
                              type="password"
                              value={kimiApiKeyInput}
                              onChange={(event) =>
                                onKimiApiKeyInputChange(event.currentTarget.value)
                              }
                              placeholder={
                                kimiApiConfigView?.hasApiKey
                                  ? "已保存，如需替换请重新输入"
                                  : "sk-..."
                              }
                            />
                          </article>
                        </div>
                        <p className="hint cc-step-meta">
                          保存时会把同一个 API Key 同步写入 provider、search、fetch 三处配置。
                        </p>
                        <div className="cc-api-inline-actions">
                          <Button
                            type="button"
                            variant="outline"
                            icon={<SlidersHorizontal size={14} />}
                            className="cc-action-btn"
                            onClick={() => void onOpenTask("config_center")}
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
                            {kimiApiConfigView?.configPath || configCenterView?.configPath || "~/.kimi/config.toml"}
                          </strong>
                        </p>
                        <p className="hint cc-step-meta">
                          Provider API 状态：{formatProviderApiHealthState(onboarding?.providerApiHealth.state)}；
                          最近来源：{formatProviderApiHealthSource(onboarding?.providerApiHealth.source)}；
                          最近时间：{formatLoginCheckTimestamp(onboarding?.providerApiHealth.checkedAtMs)}
                          {onboarding?.providerApiHealth.exitCode != null
                            ? `；退出码：${onboarding.providerApiHealth.exitCode}`
                            : ""}
                        </p>
                        {onboarding?.providerApiHealth.message ? (
                          <p className="hint cc-step-meta">
                            最近摘要：{onboarding.providerApiHealth.message}
                          </p>
                        ) : null}
                        {!kimiApiConfigView?.templateConfigured ? (
                          <p className="hint cc-step-meta">
                            当前尚未写入完整的 Kimi Coding Plan 模板，点击“保存”后会自动补齐。
                          </p>
                        ) : null}
                        {configCenterDirty ? (
                          <p className="hint cc-step-meta">
                            配置中心弹窗内存在未保存修改，请先处理高级草稿。
                          </p>
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
          <section className="cc-card cc-web-experience-card">
            <ControlCenterCardHeader
              title="Web 体验"
              titleMeta="Kimi Web"
              titleMetaPlacement="below"
              statusLabel={formatWorkspaceWebMode(workspaceWebSettings.mode)}
              statusTone={
                workspaceWebSettings.mode === "enhanced_local" ? "accent" : "neutral"
              }
            />
            <div className="cc-card-body cc-web-experience-body">
              <ControlCenterSegmentedControl
                ariaLabel="Kimi Web 体验模式"
                className="cc-web-mode-switch"
                value={workspaceWebSettings.mode}
                onChange={(value) => {
                  void onWorkspaceWebModeChange(value);
                }}
                disabled={workspaceWebSettingsBusy}
                items={[
                  {
                    value: "official",
                    label: "官方 Web",
                    description: "稳定兜底",
                  },
                  {
                    value: "enhanced_local",
                    label: "本地增强版",
                    description: "i18n 与桌面优化",
                  },
                ]}
              />
              <div className="cc-web-experience-grid">
                <ControlCenterMetricCard
                  label="增强版健康"
                  value={formatEnhancedWebHealth(workspaceWebSettings.health.state)}
                  meta={workspaceWebSettings.health.message}
                />
                <ControlCenterMetricCard
                  label="上游来源"
                  value={
                    workspaceWebSettings.sourceCommit
                      ? workspaceWebSettings.sourceCommit.slice(0, 12)
                      : "-"
                  }
                  meta="MoonshotAI/kimi-cli web/"
                />
                <ControlCenterMetricCard
                  label="最近可用版本"
                  value={
                    workspaceWebSettings.lastKnownGoodCommit
                      ? workspaceWebSettings.lastKnownGoodCommit.slice(0, 12)
                      : "-"
                  }
                  meta={workspaceWebSettings.lastFallbackReason ?? "暂无回退记录"}
                />
              </div>
              <ControlCenterToggleField
                label="增强版失败时自动回退"
                description="加载失败或入口超时时自动切回官方 Web，避免阻塞工作区。"
                checked={workspaceWebSettings.autoFallback}
                onChange={(checked) => {
                  void onWorkspaceWebAutoFallbackChange(checked);
                }}
                disabled={workspaceWebSettingsBusy}
              />
              <div className="cc-web-experience-footer">
                <ControlCenterStatusBadge
                  tone={formatEnhancedWebHealthTone(workspaceWebSettings.health.state)}
                >
                  {formatEnhancedWebHealth(workspaceWebSettings.health.state)}
                </ControlCenterStatusBadge>
                <p className="hint">{workspaceWebSettings.disclaimer}</p>
              </div>
              <div className="cc-actions">
                <Button
                  type="button"
                  variant="outline"
                  icon={<RefreshCcw size={15} />}
                  className="cc-action-btn"
                  onClick={() => void onWorkspaceWebModeChange("enhanced_local")}
                  disabled={workspaceWebSettingsBusy}
                >
                  使用本地增强版
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon={<RefreshCw size={15} />}
                  className="cc-action-btn"
                  onClick={() => void onFallbackWorkspaceWebToOfficial("manual_fallback")}
                  disabled={workspaceWebSettingsBusy}
                >
                  回退官方 Web
                </Button>
              </div>
            </div>
          </section>

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
              <DiagnosticItem label="Auth Mode" value={formatAuthMode(diagnostics?.authMode)} />
              <DiagnosticItem
                label="Workspace Web Mode"
                value={formatWorkspaceWebMode(diagnostics?.workspaceWebMode ?? "official")}
              />
              <DiagnosticItem
                label="Enhanced Web Health"
                value={formatEnhancedWebHealth(
                  diagnostics?.enhancedWebHealth.state ?? "not_configured",
                )}
              />
              <DiagnosticItem
                label="Enhanced Web Source"
                value={diagnostics?.enhancedWebSourceCommit ?? "-"}
              />
              <DiagnosticItem
                label="Enhanced Web Fallback"
                value={diagnostics?.enhancedWebLastFallbackReason ?? "-"}
              />
              <DiagnosticItem
                label="Provider API Health"
                value={formatProviderApiHealthState(diagnostics?.providerApiHealth.state)}
              />
              <DiagnosticItem
                label="Last Provider API Check"
                value={formatLoginCheckTimestamp(diagnostics?.providerApiHealth.checkedAtMs)}
              />
              <DiagnosticItem
                label="Last Provider API Source"
                value={formatProviderApiHealthSource(diagnostics?.providerApiHealth.source)}
              />
              <DiagnosticItem
                label="Kimi Login Health"
                value={formatKimiLoginHealthState(diagnostics?.kimiLoginHealth.state)}
              />
              <DiagnosticItem
                label="Last Kimi Login Check"
                value={formatLoginCheckTimestamp(diagnostics?.kimiLoginHealth.checkedAtMs)}
              />
              <DiagnosticItem
                label="Last Kimi Login Source"
                value={formatKimiLoginHealthSource(diagnostics?.kimiLoginHealth.source)}
              />
              <DiagnosticItem
                label="Last Kimi Login Exit Code"
                value={String(diagnostics?.kimiLoginHealth.exitCode ?? "-")}
              />
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
    const bridgeHeaderControls = (
      <div className="cc-bridge-title-controls">
        <Button
          type="button"
          variant="outline"
          icon={<RefreshCw size={15} />}
          className="cc-action-btn"
          onClick={() => {
            void Promise.all([
              onRefreshBridgeSettings(),
              onRefreshBridgeStatus(),
              onRefreshBridgeBindings(),
              onRefreshBridgeApprovals(),
              onRefreshBridgeSecretsMask(),
            ]);
          }}
          disabled={bridgeBusy}
        >
          刷新状态
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
        <Button
          type="button"
          variant="outline"
          icon={<RefreshCcw size={15} />}
          className="cc-action-btn"
          onClick={() => void onRestartBridge()}
          disabled={bridgeBusy}
        >
          一键重启
        </Button>
        <Button
          type="button"
          variant="destructive"
          icon={<X size={15} />}
          className="cc-action-btn"
          onClick={() => void onStopBridge()}
          disabled={bridgeBusy}
        >
          一键停止
        </Button>
      </div>
    );

    return (
      <div className="cc-bridge-shell">
        <section className="cc-card">
          <ControlCenterCardHeader
            title="IM Bridge"
            titleControls={bridgeHeaderControls}
            statusLabel={bridgeStatusLabel}
            statusTone={bridgeRuntimeTone}
            primaryAction={
              <div className="cc-bridge-create-menu" ref={bridgeCreateMenuRef}>
                <Button
                  type="button"
                  icon={<Plus size={14} />}
                  className="cc-action-btn cc-bridge-create-menu-trigger"
                  onClick={() => setBridgeCreateMenuOpen((current) => !current)}
                  disabled={bridgeBusy}
                  aria-haspopup="menu"
                  aria-expanded={bridgeCreateMenuOpen}
                >
                  新建机器人
                </Button>
                {bridgeCreateMenuOpen ? (
                  <div
                    className="cc-bridge-create-menu-popover"
                    role="menu"
                    aria-label="选择机器人平台"
                  >
                    <button
                      type="button"
                      className="cc-bridge-create-menu-item"
                      onClick={() => handleCreateBridgeConnector("weixin")}
                      disabled={bridgeBusy}
                      role="menuitem"
                    >
                      <strong>微信</strong>
                      <small>扫码绑定 owner 私聊机器人</small>
                    </button>
                    <button
                      type="button"
                      className="cc-bridge-create-menu-item"
                      onClick={() => handleCreateBridgeConnector("feishu")}
                      disabled={bridgeBusy}
                      role="menuitem"
                    >
                      <strong>飞书</strong>
                      <small>通过官方流程创建并保存凭据</small>
                    </button>
                  </div>
                ) : null}
              </div>
            }
          />
          <div className="cc-card-body cc-step-body cc-step-body-single">
            <ControlCenterWorkbenchLayout
              mode="stack-on-mobile"
              railClassName="bridge-workbench-rail"
              railBodyClassName="bridge-workbench-rail-list"
              detailClassName="bridge-workbench-detail"
              detailBodyClassName="bridge-workbench-detail-body"
              railHeader={
                <div className="bridge-workbench-rail-head">
                  <div>
                    <h4>机器人列表</h4>
                  </div>
                  <ControlCenterStatusBadge tone="neutral">
                    {visibleBridgeConnectors.length} 个机器人
                  </ControlCenterStatusBadge>
                </div>
              }
              rail={
                visibleBridgeConnectors.length > 0 ? (
                  <>
                    {visibleBridgeConnectors.map((connector) => {
                      const connectorStatus =
                        bridgeStatus.connectors.find((item) => item.connectorId === connector.id) ??
                        null;
                      const connectorSecrets =
                        bridgeSecretsMask.connectors.find(
                          (item) => item.connectorId === connector.id,
                        ) ?? null;
                      const connectorRecentError = findBridgeConnectorRecentError(
                        connector,
                        connectorStatus,
                        bridgeRecentErrors,
                      );
                      const connectorSecretsConfigured = hasBridgeConnectorSecretsConfigured(
                        connector,
                        connectorSecrets,
                      );
                      const isSelected = connector.id === effectiveSelectedBridgeConnectorId;
                      return (
                        <button
                          key={connector.id}
                          type="button"
                          className={`bridge-workbench-list-item ${isSelected ? "active" : ""}`}
                          onClick={() => {
                            if (isBridgeConnectorSecretsTask) {
                              openBridgeConnectorSecretsModal(connector.id);
                              return;
                            }
                            if (isBridgeRuntimeTask) {
                              openBridgeConnectorRuntimeModal(connector.id);
                              return;
                            }
                            setSelectedBridgeConnectorId(connector.id);
                          }}
                        >
                          <div className="bridge-workbench-list-item-header">
                            <div className="bridge-workbench-list-item-copy">
                              <strong>{connector.label}</strong>
                              <small>{bridgePlatformLabel(connector.platform)}</small>
                            </div>
                            <ControlCenterStatusBadge
                              tone={formatBridgeConnectorStateTone(
                                connectorStatus?.state ?? "idle",
                              )}
                            >
                              {formatBridgeConnectorStateLabel(connectorStatus?.state ?? "idle")}
                            </ControlCenterStatusBadge>
                          </div>
                          <div className="bridge-workbench-list-item-meta">
                            <span>{connector.enabled ? "已启用" : "未启用"}</span>
                            <span>{connectorSecretsConfigured ? "凭据已配置" : "待配置凭据"}</span>
                          </div>
                          {connectorRecentError ? (
                            <p className="bridge-workbench-list-item-error">
                              {connectorRecentError}
                            </p>
                          ) : null}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <ControlCenterEmptyState
                    className="bridge-workbench-empty"
                    title="还没有机器人"
                    description="使用右上角“新建机器人”开始添加微信或飞书机器人。"
                    icon={<Sparkles size={18} />}
                  />
                )
              }
              detail={
                shouldRenderInlineBridgeTask ? (
                  renderActiveTask()
                ) : selectedBridgeConnector ? (
                  <div className="cc-control-detail-stack">
                    <div className="bridge-workbench-card">
                      <div className="bridge-workbench-card-head">
                        <div className="bridge-workbench-card-copy">
                          <div className="bridge-workbench-card-title-row">
                            <strong>{selectedBridgeConnector.label}</strong>
                            <div className="bridge-robot-chip-row">
                              <ControlCenterStatusBadge
                                tone={selectedBridgeConnectorEnabledValue ? "success" : "neutral"}
                              >
                                {selectedBridgeConnectorEnabledValue ? "已启用" : "未启用"}
                              </ControlCenterStatusBadge>
                              <ControlCenterStatusBadge
                                tone={formatBridgeConnectorStateTone(
                                  selectedBridgeConnectorStatus?.state ?? "idle",
                                )}
                              >
                                {formatBridgeConnectorStateLabel(
                                  selectedBridgeConnectorStatus?.state ?? "idle",
                                )}
                              </ControlCenterStatusBadge>
                              <ControlCenterStatusBadge
                                tone={
                                  selectedBridgeConnectorSecretsConfigured ? "success" : "warning"
                                }
                              >
                                {selectedBridgeConnectorSecretsConfigured
                                  ? "凭据已配置"
                                  : "待配置凭据"}
                              </ControlCenterStatusBadge>
                            </div>
                          </div>
                          <div className="bridge-workbench-card-meta">
                            <span>平台：{bridgePlatformLabel(selectedBridgeConnector.platform)}</span>
                            <span>Connector ID：{selectedBridgeConnector.id}</span>
                            <span>绑定：{selectedBridgeConnectorBindings.length}</span>
                            <span>审批：{selectedBridgeConnectorApprovals.length}</span>
                            <span>
                              最近就绪：
                              {formatBridgeTimestamp(selectedBridgeConnectorStatus?.lastReadyAt)}
                            </span>
                          </div>
                        </div>
                        <ControlCenterToggleField
                          className="bridge-workbench-card-toggle"
                          label="机器人启用"
                          description={
                            selectedBridgeConnectorPendingToggle
                              ? "正在应用配置..."
                              : undefined
                          }
                          checked={selectedBridgeConnectorEnabledValue}
                          onChange={(checked) => {
                            void handleImmediateBridgeConnectorToggle(
                              selectedBridgeConnector.id,
                              checked,
                            );
                          }}
                          disabled={bridgeBusy || selectedBridgeConnectorPendingToggle}
                          busy={selectedBridgeConnectorPendingToggle}
                        />
                      </div>

                      <div className="bridge-workbench-card-summary">
                        <ControlCenterMetricCard
                          label="绑定摘要"
                          value={
                            selectedBridgeConnectorBindings.length > 0
                              ? `${selectedBridgeConnectorBindings.length} 个会话`
                              : "暂无绑定"
                          }
                        />
                        <ControlCenterMetricCard
                          label="审批摘要"
                          value={
                            selectedBridgeConnectorApprovals.length > 0
                              ? `${selectedBridgeConnectorApprovals.length} 条待处理`
                              : "无待处理审批"
                          }
                        />
                        <ControlCenterMetricCard
                          label="凭据状态"
                          value={selectedBridgeConnectorSecretsConfigured ? "已配置" : "待配置"}
                        />
                      </div>

                      {selectedBridgeConnectorRecentError ? (
                        <p className="bridge-workbench-card-error">
                          {selectedBridgeConnectorRecentError}
                        </p>
                      ) : null}

                      <div className="bridge-port-card bridge-robot-workdir-card">
                        <span>工作区目录</span>
                        <strong>
                          {selectedBridgeConnectorEffectiveWorkDir || "跟随应用默认目录"}
                        </strong>
                        <div className="bridge-inline-path-actions">
                          <Button
                            type="button"
                            variant="outline"
                            icon={<FolderOpen size={14} />}
                            className="cc-action-btn"
                            onClick={() =>
                              void handlePickBridgeConnectorWorkDir(selectedBridgeConnector.id)
                            }
                            disabled={bridgeBusy || selectedBridgeConnectorPendingToggle}
                          >
                            {selectedBridgeConnectorPendingToggle
                              ? "正在保存目录..."
                              : "选择工作区"}
                          </Button>
                          {selectedBridgeConnectorUsesCustomWorkDir ? (
                            <Button
                              type="button"
                              variant="ghost"
                              className="cc-action-btn"
                              onClick={() =>
                                void handleBridgeConnectorWorkDirChange(
                                  selectedBridgeConnector.id,
                                  undefined,
                                )
                              }
                              disabled={bridgeBusy || selectedBridgeConnectorPendingToggle}
                            >
                              跟随应用默认目录
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            icon={<FolderOpen size={14} />}
                            className="cc-action-btn"
                            onClick={() =>
                              void onOpenFolder(selectedBridgeConnectorEffectiveWorkDir)
                            }
                            disabled={
                              !selectedBridgeConnectorEffectiveWorkDir ||
                              selectedBridgeConnectorPendingToggle
                            }
                          >
                            打开目录
                          </Button>
                        </div>
                      </div>

                      <div className="bridge-workbench-card-actions">
                        <Button
                          type="button"
                          variant="outline"
                          icon={<KeyRound size={15} />}
                          className="cc-action-btn"
                          onClick={() => openBridgeConnectorSecretsModal(selectedBridgeConnector.id)}
                          disabled={bridgeBusy}
                        >
                          {selectedBridgeConnectorSecretsConfigured ? "连接与凭据" : "创建机器人"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<LayoutDashboard size={15} />}
                          className="cc-action-btn"
                          onClick={() => openBridgeConnectorRuntimeModal(selectedBridgeConnector.id)}
                          disabled={bridgeBusy}
                        >
                          高级运行面板
                        </Button>
                      </div>
                    </div>

                    <div className="bridge-danger-group">
                      <div className="bridge-panel-group-label is-danger">
                        <span>危险操作</span>
                      </div>
                      <div className="cc-actions">
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<X size={14} />}
                          className="cc-action-btn"
                          onClick={() => void handleDeleteBridgeRobot(selectedBridgeConnector.id)}
                          disabled={bridgeBusy}
                        >
                          删除机器人
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null
              }
              emptyDetail={
                <ControlCenterEmptyState
                  className="bridge-workbench-empty bridge-workbench-empty-detail"
                  title={visibleBridgeConnectors.length > 0 ? "选择一个机器人" : "先创建一个机器人"}
                  description={
                    visibleBridgeConnectors.length > 0
                      ? "从左侧列表选择机器人。"
                      : "创建后会出现在左侧列表。"
                  }
                  icon={<Sparkles size={18} />}
                />
              }
            />
          </div>
        </section>
      </div>
    );
  }

  function renderSkillCenterSection() {
    const selectedWorkspaceTarget =
      workspaceSkillTargets.find((target) => target.id === selectedWorkspaceSkillTargetId) ?? null;
    const skillCenterActions =
      skillCenterSection === "manage" ? (
        <div className="skill-center-header-actions">
          <Button
            type="button"
            icon={<Plus size={14} />}
            className="cc-action-btn"
            onClick={() => {
              void onOpenTask("skill_git_import");
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
              void onOpenTask("skill_import");
            }}
            disabled={skillCenterBusy}
          >
            导入本地 Skill
          </Button>
        </div>
      ) : (
        <div className="skill-center-header-actions">
          <Button
            type="button"
            icon={<RefreshCcw size={14} />}
            className="cc-action-btn"
            onClick={() => {
              void onRefreshWorkspaceSkillManagementState();
            }}
            disabled={skillCenterBusy}
          >
            刷新工作区
          </Button>
        </div>
      );

    return (
      <section className="cc-card skill-center-card">
        <ControlCenterCardHeader
          title="技能中心"
          titleMeta="Skill Center"
          titleControls={
            <div className="skill-center-title-controls">
              <ControlCenterSegmentedControl
                ariaLabel="技能中心分区切换"
                className="cc-inline-switch"
                itemClassName="cc-inline-switch-btn"
                value={skillCenterSection}
                onChange={(value) => onSkillCenterSectionChange(value)}
                disabled={skillCenterBusy}
                items={[
                  { value: "manage", label: "技能管理" },
                  { value: "workspace_insights", label: "工作区洞察" },
                ]}
              />
            </div>
          }
          titleMetaPlacement="below"
          className="skill-center-card-header"
          statusLabel={
            skillCenterSection === "manage"
              ? `${activeSessionSkillState.appliedSkillIds.length} 个当前工作区技能`
              : selectedWorkspaceTarget
                ? `${selectedWorkspaceTarget.label}${selectedWorkspaceTarget.readOnly ? " · 只读" : " · 可编辑"}`
                : `工作区目标 ${workspaceSkillTargets.length}`
          }
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
            workspaceSkillRecommendations={workspaceSkillRecommendations}
            workspaceSkillRestoreResults={workspaceSkillRestoreResults}
            skillDiscoverySnapshot={skillDiscoverySnapshot}
            selectedDiscoveryId={selectedDiscoveryId}
            selectedDiscoveryDetail={selectedDiscoveryDetail}
            workspaceSkillTargets={workspaceSkillTargets}
            selectedWorkspaceSkillTargetId={selectedWorkspaceSkillTargetId}
            workspaceSkillInventory={workspaceSkillInventory}
            selectedWorkspaceSkillContainerKind={selectedWorkspaceSkillContainerKind}
            currentWorkspaceLabel={status?.activeSessionWorkDir || effectiveWorkDir}
            onSelectSkill={(skillId) => {
              void onSelectSkill(skillId);
            }}
            onOpenSkillFromInsights={(skillId) => {
              void onOpenSkillFromInsights(skillId);
            }}
            onSelectDiscoveredSkill={(discoveryId) => {
              void onSelectDiscoveredSkill(discoveryId);
            }}
            onScanDiscoveredSkills={() => {
              void onScanDiscoveredSkills();
            }}
            onImportDiscoveredSkill={(discoveryId) => {
              void onImportDiscoveredSkill(discoveryId);
            }}
            onSelectWorkspaceSkillTarget={(targetId) => {
              void onSelectWorkspaceSkillTarget(targetId);
            }}
            onSelectWorkspaceSkillContainer={(containerKind) => {
              onSelectWorkspaceSkillContainer(containerKind);
            }}
            onOpenFolder={onOpenFolder}
            onAddInstalledSkillToWorkspaceTarget={(skillId, targetId, containerKind) => {
              void onAddInstalledSkillToWorkspaceTarget(skillId, targetId, containerKind);
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
            onSetPin={(skillId, pinned) => {
              void onSetWorkspaceSkillPin(skillId, pinned);
            }}
            onUpdateSkill={(skillId) => {
              void onUpdateSkill(skillId);
            }}
            onUninstallSkill={(skillId) => {
              void onUninstallSkill(skillId);
            }}
            onRecoverWorkspaceSkill={(skillId) => {
              void onRecoverWorkspaceSkill(skillId);
            }}
            search={skillCenterSearch}
            filter={skillCenterFilter}
            onSearchChange={onSkillCenterSearchChange}
            onFilterChange={onSkillCenterFilterChange}
          />
        </div>
      </section>
    );
  }

  const configBlockingErrors = useMemo(
    () => buildBlockingErrors(configCenterDraft),
    [configCenterDraft],
  );
  const configWarnings = useMemo(
    () =>
      buildWarnings(
        configCenterDraft,
        configCenterView?.envOverrides ?? [],
        configCenterView?.warnings ?? [],
      ),
    [configCenterDraft, configCenterView?.envOverrides, configCenterView?.warnings],
  );
  function closeBridgeConnectorSecretsTask() {
    const hasPendingDraft = Object.values(bridgeConnectorSecretDraft).some((value) => value.trim());
    if (hasPendingDraft && !window.confirm("当前凭据草稿尚未保存，确定返回上一层吗？")) {
      return;
    }
    setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
    onCloseTask();
  }

  function renderActiveTask() {
    if (isConfigCenterTask) {
      return (
        <ControlCenterTaskSurface
          title="Kimi CLI 配置中心"
          description="按结构编辑 `config.toml`，优先查看摘要，再进入具体配置块。"
          className="cc-config-modal"
          bodyClassName="cc-config-modal-scroll"
          onBack={onCloseTask}
          onClose={onClose}
          footer={
            <>
              <div className="cc-config-footer-meta">
                <span>校验错误：{configBlockingErrors.length}</span>
                <span>告警：{configWarnings.length}</span>
                {configCenterDirty ? (
                  <span className="unsaved">存在未保存变更</span>
                ) : (
                  <span className="saved">已同步</span>
                )}
              </div>
              <div className="cc-actions">
                <Button
                  type="button"
                  variant="outline"
                  className="cc-action-btn"
                  icon={<RefreshCcw size={14} />}
                  onClick={onResetConfigCenterDraft}
                  disabled={configCenterBusy || !configCenterDirty}
                >
                  重置草稿
                </Button>
                <Button
                  type="button"
                  className="cc-action-btn"
                  icon={<Check size={14} />}
                  onClick={() => void onSaveKimiCliConfigCenter()}
                  disabled={configCenterBusy || configBlockingErrors.length > 0}
                >
                  保存配置
                </Button>
              </div>
              {configBlockingErrors.length > 0 ? (
                <ul className="cc-config-error-list">
                  {configBlockingErrors.slice(0, 8).map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : null}
            </>
          }
        >
          <ConfigCenterTaskContent
            dirty={configCenterDirty}
            view={configCenterView}
            draft={configCenterDraft}
            onDraftChange={onConfigCenterDraftChange}
            onOpenConfigDir={onOpenKimiConfigDir}
          />
        </ControlCenterTaskSurface>
      );
    }

    if (isBridgeConnectorSecretsTask) {
      return (
        <ControlCenterTaskSurface
          title={
            selectedBridgeConnector
              ? `${selectedBridgeConnector.label} 连接与凭据`
              : "连接与凭据"
          }
          className="cc-bridge-task-surface cc-bridge-connector-modal"
          bodyClassName="cc-bridge-connector-body"
          onBack={closeBridgeConnectorSecretsTask}
          onClose={onClose}
          showCloseButton={false}
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
                {bridgeSettingsDirty ? <span className="unsaved">存在未应用修改</span> : null}
              </div>
              <div className="cc-actions">
                <Button
                  type="button"
                  icon={<Check size={15} />}
                  className="cc-action-btn"
                  onClick={() => void handleSaveBridgeConnectorSecretDraft()}
                  disabled={bridgeBusy || !selectedBridgeConnector}
                >
                  保存并应用
                </Button>
              </div>
            </>
          }
        >
          {selectedBridgeConnector ? (
            <div className="bridge-panel">
              <div className="bridge-panel-subsection">
                <div className="bridge-panel-subheader">
                  <h5>状态摘要</h5>
                  <span
                    className={`cc-status-badge tone-${
                      selectedBridgeConnectorStatus?.state === "error"
                        ? "danger"
                        : selectedBridgeConnectorStatus?.state === "degraded"
                          ? "warning"
                          : selectedBridgeConnector.enabled
                            ? "success"
                            : "neutral"
                    }`}
                  >
                    {formatBridgeConnectorStateLabel(selectedBridgeConnectorStatus?.state ?? "idle")}
                  </span>
                </div>
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
                    <span className="diag-label">最近就绪</span>
                    <strong>{formatBridgeTimestamp(selectedBridgeConnectorStatus?.lastReadyAt)}</strong>
                  </article>
                </div>
                {findBridgeConnectorRecentError(
                  selectedBridgeConnector,
                  selectedBridgeConnectorStatus,
                  bridgeRecentErrors,
                ) ? (
                  <p className="hint">
                    {findBridgeConnectorRecentError(
                      selectedBridgeConnector,
                      selectedBridgeConnectorStatus,
                      bridgeRecentErrors,
                    )}
                  </p>
                ) : null}
              </div>

              <div className="bridge-panel-subsection">
                <div className="bridge-panel-subheader">
                  <h5>机器人名称</h5>
                  <span className="cc-status-badge tone-neutral">最多 32 字</span>
                </div>
                <label className="bridge-port-card bridge-connector-name-field">
                  <span>显示名称</span>
                  <Input
                    value={bridgeConnectorLabelDraft}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value.slice(0, 32);
                      setBridgeConnectorLabelDraft(nextValue);
                      updateBridgeConnector(selectedBridgeConnector.id, { label: nextValue });
                    }}
                    onBlur={() => {
                      const normalized = bridgeConnectorLabelDraft.trim();
                      if (!normalized || normalized === bridgeConnectorLabelDraft) {
                        return;
                      }
                      setBridgeConnectorLabelDraft(normalized);
                      updateBridgeConnector(selectedBridgeConnector.id, { label: normalized });
                    }}
                    maxLength={32}
                    aria-label="机器人名称"
                    placeholder={
                      selectedBridgeConnector.platform === "telegram"
                        ? "Telegram 机器人名称"
                        : selectedBridgeConnector.platform === "weixin"
                          ? "微信机器人名称"
                          : "飞书机器人名称"
                    }
                  />
                </label>
              </div>

              {selectedBridgeConnector.platform === "feishu" ? (
                <div className="bridge-panel-subsection">
                  <div className="bridge-panel-subheader">
                    <h5>回复呈现</h5>
                    <span className="cc-status-badge tone-warning">默认 Streaming</span>
                  </div>
                  <label className="bridge-port-card">
                    <span>飞书 renderer</span>
                    <select
                      className="ui-input cc-config-select"
                      value={
                        selectedBridgeConnector.feishuReplyRenderer ??
                        bridgeSettings.feishuReplyRenderer ??
                        "streaming"
                      }
                      onChange={(event) =>
                        updateBridgeConnector(selectedBridgeConnector.id, {
                          feishuReplyRenderer: event.currentTarget.value as
                            | "post"
                            | "interactive"
                            | "streaming",
                        })
                      }
                      aria-label="飞书回复呈现方式"
                    >
                      {FEISHU_REPLY_RENDERER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              <div className="bridge-panel-subsection">
                <div className="bridge-panel-subheader">
                  <h5>连接凭据</h5>
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
                  ) : selectedBridgeConnector.platform === "weixin" ? (
                    <>
                      <label className="bridge-port-card">
                        <span>botToken</span>
                        <Input
                          type="password"
                          value={bridgeConnectorSecretDraft.botToken}
                          onChange={(event) =>
                            setBridgeConnectorSecretDraft((current) => ({
                              ...current,
                              botToken: event.currentTarget.value,
                            }))
                          }
                          placeholder="输入新的微信 bot token"
                        />
                        <small>扫码成功后会自动回填；手动保存时可覆盖。</small>
                      </label>
                      <label className="bridge-port-card">
                        <span>baseUrl</span>
                        <Input
                          value={bridgeConnectorSecretDraft.weixinBaseUrl}
                          onChange={(event) =>
                            setBridgeConnectorSecretDraft((current) => ({
                              ...current,
                              weixinBaseUrl: event.currentTarget.value,
                            }))
                          }
                          placeholder="https://ilinkai.weixin.qq.com"
                        />
                      </label>
                      <label className="bridge-port-card">
                        <span>accountId</span>
                        <Input
                          value={bridgeConnectorSecretDraft.weixinAccountId}
                          onChange={(event) =>
                            setBridgeConnectorSecretDraft((current) => ({
                              ...current,
                              weixinAccountId: event.currentTarget.value,
                            }))
                          }
                          placeholder="扫码后自动写入"
                        />
                      </label>
                      <label className="bridge-port-card">
                        <span>ownerUserId</span>
                        <Input
                          value={bridgeConnectorSecretDraft.weixinOwnerUserId}
                          onChange={(event) =>
                            setBridgeConnectorSecretDraft((current) => ({
                              ...current,
                              weixinOwnerUserId: event.currentTarget.value,
                            }))
                          }
                          placeholder="扫码后自动写入 owner 用户 ID"
                        />
                        <small>V1 仅允许这个 owner 的私聊消息进入 bridge。</small>
                      </label>
                    </>
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
                  {selectedBridgeConnector.platform === "weixin" &&
                  selectedBridgeConnectorSecrets?.weixin ? (
                    <>
                      <div className="bridge-secret-row">
                        <div className="bridge-secret-copy">
                          <strong>微信 botToken</strong>
                          <small>
                            {selectedBridgeConnectorSecrets.weixin.botToken.configured
                              ? selectedBridgeConnectorSecrets.weixin.botToken.maskedValue ?? "***"
                              : "未配置"}
                          </small>
                        </div>
                        <span
                          className={`bridge-secret-chip ${
                            selectedBridgeConnectorSecrets.weixin.botToken.configured
                              ? "configured"
                              : "empty"
                          }`}
                        >
                          {selectedBridgeConnectorSecrets.weixin.botToken.configured
                            ? "已配置"
                            : "未配置"}
                        </span>
                      </div>
                      <div className="bridge-secret-row">
                        <div className="bridge-secret-copy">
                          <strong>微信账号元数据</strong>
                          <small>
                            baseUrl：
                            {selectedBridgeConnectorSecrets.weixin.baseUrl ?? "未配置"} ·
                            accountId：
                            {selectedBridgeConnectorSecrets.weixin.accountId ?? "未配置"} ·
                            owner：
                            {selectedBridgeConnectorSecrets.weixin.ownerUserId ?? "未配置"}
                          </small>
                        </div>
                        <span
                          className={`bridge-secret-chip ${
                            selectedWeixinSecretsConfigured ? "configured" : "empty"
                          }`}
                        >
                          {selectedWeixinSecretsConfigured ? "已配置" : "未配置"}
                        </span>
                      </div>
                    </>
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
                              ? selectedBridgeConnectorSecrets.feishu.appSecret.maskedValue ?? "***"
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
                    </>
                  ) : null}
                </div>
              </div>

              {selectedBridgeConnector.platform === "feishu" ? (
                <div className="bridge-panel-subsection">
                  <div className="bridge-panel-subheader">
                    <h5>飞书开通卡</h5>
                    <span
                      className={`cc-status-badge tone-${
                        selectedFeishuOnboarding
                          ? formatFeishuOnboardingTone(selectedFeishuOnboarding.state)
                          : selectedFeishuSecretsConfigured
                            ? "success"
                            : "warning"
                      }`}
                    >
                      {selectedFeishuOnboarding
                        ? formatFeishuOnboardingStateLabel(selectedFeishuOnboarding.state)
                        : selectedFeishuSecretsConfigured
                          ? "已配置"
                          : "待开通"}
                    </span>
                  </div>
                  <div className="bridge-onboarding-card">
                    <div className="bridge-onboarding-actions">
                      <Button
                        type="button"
                        variant="outline"
                        icon={<Sparkles size={15} />}
                        className="cc-action-btn"
                        onClick={() => void handleStartSelectedFeishuOnboarding()}
                        disabled={
                          bridgeBusy ||
                          feishuConnectorOnboardingBusy ||
                          (Boolean(selectedFeishuOnboarding) &&
                            isFeishuOnboardingActive(selectedFeishuOnboarding))
                        }
                      >
                        {selectedFeishuOnboarding &&
                        isFeishuOnboardingActive(selectedFeishuOnboarding)
                          ? "等待扫码中"
                          : selectedFeishuOnboarding &&
                              selectedFeishuOnboarding.state !== "succeeded"
                            ? "重新开始"
                            : selectedFeishuSecretsConfigured
                              ? "重新创建机器人"
                              : "创建机器人"}
                      </Button>
                      {selectedFeishuOnboarding?.verificationUrl ? (
                        <Button
                          type="button"
                          variant="outline"
                          icon={<ChevronRight size={15} />}
                          className="cc-action-btn"
                          onClick={() =>
                            void onOpenExternalUrl(selectedFeishuOnboarding.verificationUrl ?? "")
                          }
                          disabled={feishuConnectorOnboardingBusy}
                        >
                          在浏览器打开
                        </Button>
                      ) : null}
                      {selectedFeishuOnboarding ? (
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<RefreshCw size={15} />}
                          className="cc-action-btn"
                          onClick={() =>
                            void onRefreshFeishuConnectorOnboardingStatus(
                              selectedFeishuOnboarding.sessionId,
                            )
                          }
                          disabled={feishuConnectorOnboardingBusy}
                        >
                          刷新开通状态
                        </Button>
                      ) : null}
                      {selectedFeishuOnboarding &&
                      isFeishuOnboardingActive(selectedFeishuOnboarding) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<Eraser size={15} />}
                          className="cc-action-btn"
                          onClick={() => void handleCancelSelectedFeishuOnboarding()}
                          disabled={feishuConnectorOnboardingBusy}
                        >
                          取消开通
                        </Button>
                      ) : null}
                    </div>
                    {selectedFeishuOnboarding?.qrSvg ? (
                      <div className="bridge-onboarding-qr-shell">
                        <div
                          className="bridge-onboarding-qr"
                          aria-label="飞书机器人开通二维码"
                          dangerouslySetInnerHTML={{ __html: selectedFeishuOnboarding.qrSvg }}
                        />
                        <div className="bridge-onboarding-meta">
                          <span>
                            会话开始：{formatBridgeTimestamp(selectedFeishuOnboarding.startedAt)}
                          </span>
                          <span>
                            截止时间：{formatBridgeTimestamp(selectedFeishuOnboarding.expiresAt)}
                          </span>
                          {selectedFeishuOnboarding.lastConfiguredAt ? (
                            <span>
                              最近配置：
                              {formatBridgeTimestamp(selectedFeishuOnboarding.lastConfiguredAt)}
                            </span>
                          ) : null}
                          {selectedFeishuOnboarding.appIdMasked ? (
                            <span>已保存 appId：{selectedFeishuOnboarding.appIdMasked}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {selectedFeishuOnboarding?.detailMessage ? (
                      <p className="hint">{selectedFeishuOnboarding.detailMessage}</p>
                    ) : null}
                    {selectedFeishuOnboarding?.errorMessage ? (
                      <p className="hint bridge-error-text">
                        {selectedFeishuOnboarding.errorMessage}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {selectedBridgeConnector.platform === "weixin" ? (
                <div className="bridge-panel-subsection">
                  <div className="bridge-panel-subheader">
                    <h5>微信扫码开通</h5>
                    <span
                      className={`cc-status-badge tone-${
                        selectedWeixinOnboarding
                          ? formatWeixinOnboardingTone(selectedWeixinOnboarding.state)
                          : selectedWeixinSecretsConfigured
                            ? "success"
                            : "warning"
                      }`}
                    >
                      {selectedWeixinOnboarding
                        ? formatWeixinOnboardingStateLabel(selectedWeixinOnboarding.state)
                        : selectedWeixinSecretsConfigured
                          ? "已配置"
                          : "待开通"}
                    </span>
                  </div>
                  <div className="bridge-onboarding-card">
                    <div className="bridge-onboarding-actions">
                      <Button
                        type="button"
                        variant="outline"
                        icon={<Sparkles size={15} />}
                        className="cc-action-btn"
                        onClick={() => void handleStartSelectedWeixinOnboarding()}
                        disabled={
                          bridgeBusy ||
                          weixinConnectorOnboardingBusy ||
                          (Boolean(selectedWeixinOnboarding) &&
                            isWeixinOnboardingActive(selectedWeixinOnboarding))
                        }
                      >
                        {selectedWeixinOnboarding &&
                        isWeixinOnboardingActive(selectedWeixinOnboarding)
                          ? "等待扫码中"
                          : selectedWeixinOnboarding &&
                              selectedWeixinOnboarding.state !== "succeeded"
                            ? "重新开始"
                            : selectedWeixinSecretsConfigured
                              ? "重新扫码"
                              : "开始扫码"}
                      </Button>
                      {selectedWeixinOnboarding?.verificationUrl ? (
                        <Button
                          type="button"
                          variant="outline"
                          icon={<ChevronRight size={15} />}
                          className="cc-action-btn"
                          onClick={() =>
                            void onOpenExternalUrl(selectedWeixinOnboarding.verificationUrl ?? "")
                          }
                          disabled={weixinConnectorOnboardingBusy}
                        >
                          在浏览器打开
                        </Button>
                      ) : null}
                      {selectedWeixinOnboarding ? (
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<RefreshCw size={15} />}
                          className="cc-action-btn"
                          onClick={() =>
                            void onRefreshWeixinConnectorOnboardingStatus(
                              selectedWeixinOnboarding.sessionId,
                            )
                          }
                          disabled={weixinConnectorOnboardingBusy}
                        >
                          刷新开通状态
                        </Button>
                      ) : null}
                      {selectedWeixinOnboarding &&
                      isWeixinOnboardingActive(selectedWeixinOnboarding) ? (
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<Eraser size={15} />}
                          className="cc-action-btn"
                          onClick={() => void handleCancelSelectedWeixinOnboarding()}
                          disabled={weixinConnectorOnboardingBusy}
                        >
                          取消开通
                        </Button>
                      ) : null}
                    </div>
                    {selectedWeixinOnboarding?.qrSvg ? (
                      <div className="bridge-onboarding-qr-shell">
                        <div
                          className="bridge-onboarding-qr"
                          aria-label="微信机器人开通二维码"
                          dangerouslySetInnerHTML={{ __html: selectedWeixinOnboarding.qrSvg }}
                        />
                        <div className="bridge-onboarding-meta">
                          <span>
                            会话开始：{formatBridgeTimestamp(selectedWeixinOnboarding.startedAt)}
                          </span>
                          <span>
                            截止时间：{formatBridgeTimestamp(selectedWeixinOnboarding.expiresAt)}
                          </span>
                          {selectedWeixinOnboarding.lastConfiguredAt ? (
                            <span>
                              最近配置：
                              {formatBridgeTimestamp(selectedWeixinOnboarding.lastConfiguredAt)}
                            </span>
                          ) : null}
                          {selectedWeixinOnboarding.accountId ? (
                            <span>accountId：{selectedWeixinOnboarding.accountId}</span>
                          ) : null}
                          {selectedWeixinOnboarding.ownerUserId ? (
                            <span>ownerUserId：{selectedWeixinOnboarding.ownerUserId}</span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {selectedWeixinOnboarding?.detailMessage ? (
                      <p className="hint">{selectedWeixinOnboarding.detailMessage}</p>
                    ) : null}
                    {selectedWeixinOnboarding?.errorMessage ? (
                      <p className="hint bridge-error-text">
                        {selectedWeixinOnboarding.errorMessage}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {bridgeConnectorTaskError ? (
                <p className="hint bridge-error-text">{bridgeConnectorTaskError}</p>
              ) : null}

              <div className="bridge-danger-group">
                <div className="cc-danger-group-label">
                  <strong>危险操作</strong>
                </div>
                <div className="cc-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    icon={<X size={15} />}
                    className="cc-action-btn"
                    onClick={() => void handleDeleteBridgeRobot(selectedBridgeConnector.id)}
                    disabled={bridgeBusy}
                  >
                    删除机器人
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="hint">当前没有选中的机器人，无法编辑凭据。</p>
          )}
        </ControlCenterTaskSurface>
      );
    }

    if (isBridgeRuntimeTask) {
      return (
        <ControlCenterTaskSurface
          title={
            selectedBridgeConnector
              ? `${selectedBridgeConnector.label} 高级运行面板`
              : "高级运行面板"
          }
          className="cc-bridge-task-surface cc-bridge-runtime-modal"
          bodyClassName="cc-bridge-runtime-body"
          onBack={onCloseTask}
          onClose={onClose}
          showCloseButton={false}
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
        </ControlCenterTaskSurface>
      );
    }

    if (isSkillGitImportTask) {
      return (
        <ControlCenterTaskSurface
          title="从 Git 安装 Skill"
          description="输入仓库地址；Ref 可选，支持分支、tag 或 commit。"
          className="cc-skill-task-surface"
          onBack={onCloseTask}
          onClose={onClose}
          footer={
            <div className="cc-actions">
              <Button
                type="button"
                onClick={() => void onConfirmInstallSkillFromGit()}
                disabled={skillCenterBusy}
              >
                从 Git 安装
              </Button>
            </div>
          }
        >
          <div className="skill-center-dialog-fields cc-skill-task-fields">
            <label className="skill-center-dialog-field">
              <span>仓库地址</span>
              <Input
                value={skillCenterGitRepoUrl}
                onChange={(event) => onSkillCenterGitRepoUrlChange(event.target.value)}
                placeholder="https://github.com/owner/repo.git"
                autoFocus
              />
            </label>
            <label className="skill-center-dialog-field">
              <span>Ref（可选）</span>
              <Input
                value={skillCenterGitRef}
                onChange={(event) => onSkillCenterGitRefChange(event.target.value)}
                placeholder="main / v1.0.0 / commit sha"
              />
            </label>
          </div>
        </ControlCenterTaskSurface>
      );
    }

    if (isSkillImportTask) {
      return (
        <ControlCenterTaskSurface
          title="导入本地 Skill"
          description="选择要导入的来源类型，然后继续选择目录或 ZIP 文件。"
          className="cc-skill-task-surface"
          onBack={onCloseTask}
          onClose={onClose}
        >
          <div className="skill-center-import-choice-grid">
            <button
              type="button"
              className="skill-center-import-choice"
              onClick={() => {
                void onConfirmImportSkillFromPath("directory");
              }}
              disabled={skillCenterBusy}
            >
              <strong>导入目录</strong>
              <span>选择包含 `SKILL.md` 的本地 Skill 目录。</span>
            </button>
            <button
              type="button"
              className="skill-center-import-choice"
              onClick={() => {
                void onConfirmImportSkillFromPath("zip");
              }}
              disabled={skillCenterBusy}
            >
              <strong>导入 ZIP</strong>
              <span>选择本地 Skill ZIP 压缩包并导入。</span>
            </button>
          </div>
        </ControlCenterTaskSurface>
      );
    }

    return null;
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
          {authBannerVisible ? (
            <div className="shell-login-banner control-center-login-banner" role="status" aria-live="polite">
              <div className="shell-login-banner-copy">
                <strong>{authBannerTitle}</strong>
                <p>
                  {onboarding?.kimiLoginHealth.message?.trim() ||
                    "当前入口依赖 Kimi 登录，最近一次检测表明需要重新处理。"}
                </p>
                <span>{authBannerMeta}</span>
              </div>
              <div className="shell-login-banner-actions">
                <button
                  type="button"
                  className="shell-login-banner-btn primary"
                  onClick={() => void onProbeLogin()}
                  disabled={loginProbeBusy}
                >
                  重新登录 / 检测
                </button>
                <button
                  type="button"
                  className="shell-login-banner-btn"
                  onClick={() => {
                    setAuthCardView("login");
                    setExpandedOnboardingCard("auth");
                    setActiveControlSection("onboarding");
                  }}
                >
                  前往认证步骤
                </button>
              </div>
            </div>
          ) : null}
          {activeTask && !shouldRenderInlineBridgeTask ? (
            renderActiveTask()
          ) : (
            <>
              {activeControlSection === "overview" ? renderOverviewSection() : null}
              {activeControlSection === "onboarding" ? renderOnboardingSection() : null}
              {activeControlSection === "runtime_center" ? renderRuntimeSection() : null}
              {activeControlSection === "bridge_center" ? renderBridgeSection() : null}
              {activeControlSection === "skill_center" ? renderSkillCenterSection() : null}
            </>
          )}
        </div>
      </div>
      {bridgeDeleteConfirm ? (
        <div className="main-close-decision-overlay" role="presentation">
          <div
            className="main-close-decision-card"
            role="dialog"
            aria-modal="true"
            aria-label={`删除机器人 ${bridgeDeleteConfirm.connectorLabel}`}
          >
            <h3>删除机器人</h3>
            <p>
              {`确定删除机器人“${bridgeDeleteConfirm.connectorLabel}”吗？此操作会立即保存配置${
                isBridgeRunning ? "并重启 IM Bridge" : ""
              }。`}
            </p>
            <div className="main-close-decision-actions">
              <button
                type="button"
                className="ui-btn ui-btn-default ui-btn-size-default"
                onClick={closeBridgeDeleteConfirm}
                disabled={bridgeBusy}
              >
                取消
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-destructive ui-btn-size-default"
                onClick={() => {
                  void handleConfirmDeleteBridgeRobot();
                }}
                disabled={bridgeBusy}
              >
                删除机器人
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
