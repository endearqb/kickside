import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Boxes,
  CalendarClock,
  Check,
  ChevronRight,
  Eraser,
  FolderOpen,
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
  KimiDoctorResult,
  InstallFlowCatalog,
  InstallMirrorHealthReport,
  InstallSettingsView,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallTaskId,
  DiscoveredSkillDetail,
  SkillDiscoverySnapshot,
  InstalledSkill,
  KimiCodeAccessConfigInput,
  KimiCodeAccessSummaryView,
  KimiCodeAccessConfigTestResult,
  KimiCodeAccessConfigView,
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
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ControlCenterActionMenu } from "@/components/control-center/ControlCenterActionMenu";
import { ControlCenterDescList } from "@/components/control-center/ControlCenterDescList";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterToggleField } from "@/components/control-center/ControlCenterToggleField";
import { BridgeRuntimePanel } from "@/features/bridge/BridgeRuntimePanel";
import {
  buildBlockingErrors,
  buildWarnings,
  KimiCodeAccessTaskContent,
} from "@/features/control-center/KimiCodeAccessPanel";
import { ControlCenterTaskSurface } from "@/features/control-center/ControlCenterTaskSurface";
import {
  InstallFlowTaskContent,
} from "@/features/control-center/InstallFlowModal";
import { WorkspaceHubPanel } from "@/features/control-center/WorkspaceHubPanel";
import { WorkspaceSchedulePanel } from "@/features/control-center/WorkspaceSchedulePanel";
import {
  ControlCenterUnifiedRail,
  type UnifiedRailGroup,
  type UnifiedRailItem,
} from "@/features/control-center/ControlCenterUnifiedRail";
import { SkillCenterPanel } from "@/features/skill-center/SkillCenterPanel";

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

function focusDomId(id: string) {
  return `cc-focus-${id}`;
}

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
  kimiDoctorResult: KimiDoctorResult | null;
  onboarding: OnboardingStatus | null;
  contextMenuStatus: ContextMenuStatus | null;
  activeControlSection: ControlSectionId;
  activeRuntimePanel: RuntimePanelId;
  stepCompletion: StepCompletion;
  actionBusy: boolean;
  diagnosticsBusy: boolean;
  kimiDoctorBusy: boolean;
  contextMenuBusy: boolean;
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
  kimiCodeAccessSummary: KimiCodeAccessSummaryView | null;
  kimiCodeAccessView: KimiCodeAccessConfigView | null;
  kimiCodeAccessDraft: KimiCodeAccessConfigInput;
  kimiCodeAccessBusy: boolean;
  kimiCodeAccessDirty: boolean;
  kimiCodeAccessTesting: boolean;
  kimiCodeAccessTestResult: KimiCodeAccessConfigTestResult | null;
  installProbe: InstallProbeStatus | null;
  installSource: "official" | "mirror";
  installSettings: InstallSettingsView;
  installSettingsBusy: boolean;
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
  onRunKimiDoctor: () => Promise<void>;
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
  onPickKimiPath: () => Promise<void>;
  onSavePathAndRetry: () => Promise<void>;
  onEnableContextMenu: () => Promise<void>;
  onDisableContextMenu: () => Promise<void>;
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
  onSkillCenterSectionChange: (value: SkillCenterSectionId) => void;
  onSkillCenterGitRepoUrlChange: (value: string) => void;
  onSkillCenterGitRefChange: (value: string) => void;
  onSelectSkill: (skillId: string) => Promise<void>;
  onOpenTask: (
    task: ControlCenterTaskId,
    payload?: ControlCenterTaskPayload | null,
  ) => Promise<void>;
  onCloseTask: () => boolean;
  onSelectDiscoveredSkill: (discoveryId: string) => Promise<void>;
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
  onKimiCodeAccessDraftChange: (next: KimiCodeAccessConfigInput) => void;
  onResetKimiCodeAccessDraft: () => void;
  onSaveKimiCodeAccessConfig: () => Promise<void>;
  onTestKimiCodeAccessConfig: () => Promise<void>;
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
  description: string;
  group: "core" | "setup";
  icon: ReactNode;
}> = [
  {
    id: "onboarding",
    label: "小助手设置",
    description: "安装、认证、右键菜单、默认工作目录和运行诊断。",
    group: "setup",
    icon: <SlidersHorizontal size={15} />,
  },
  {
    id: "bridge_center",
    label: "外部 IM 通道",
    description: "Telegram、飞书、微信、会话和审批。",
    group: "setup",
    icon: <Play size={15} />,
  },
  {
    id: "skill_center",
    label: "Skill 投影",
    description: "已安装 Skill、投影状态和工作区 target。",
    group: "core",
    icon: <Sparkles size={15} />,
  },
  {
    id: "workspace_hub",
    label: "WorkspaceHub",
    description: "Harness 模板、已注册工作区和创建预览。",
    group: "core",
    icon: <Boxes size={15} />,
  },
  {
    id: "schedule",
    label: "调度",
    description: "工作区心跳、计划任务和运行记录。",
    group: "core",
    icon: <CalendarClock size={15} />,
  },
];

function getBridgeDisplayName(settings: BridgeSettings): string {
  const weixinEnabled = settings.connectors.some(
    (connector) => connector.platform === "weixin" && connector.enabled,
  );
  const feishuEnabled = settings.connectors.some(
    (connector) => connector.platform === "feishu" && connector.enabled,
  );
  const telegramEnabled = settings.connectors.some(
    (connector) => connector.platform === "telegram" && connector.enabled,
  );
  if (weixinEnabled) {
    return "微信";
  }
  if (feishuEnabled) {
    return "飞书";
  }
  if (telegramEnabled) {
    return "Telegram";
  }
  return "外部 IM 通道";
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

function formatKimiDoctorOutput(result: KimiDoctorResult): string {
  const chunks = [
    result.stdout ? `stdout\n${result.stdout}` : "",
    result.stderr ? `stderr\n${result.stderr}` : "",
  ].filter(Boolean);
  return chunks.join("\n\n") || "Kimi Code Doctor 未返回输出。";
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
  kimiDoctorResult,
  onboarding,
  contextMenuStatus,
  activeControlSection,
  stepCompletion,
  actionBusy,
  diagnosticsBusy,
  kimiDoctorBusy,
  contextMenuBusy,
  installBusy,
  installAction,
  bridgeSettings,
  bridgeStatus,
  bridgeOnboardingDraft,
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
  kimiCodeAccessSummary,
  kimiCodeAccessView,
  kimiCodeAccessDraft,
  kimiCodeAccessBusy,
  kimiCodeAccessDirty,
  kimiCodeAccessTesting,
  kimiCodeAccessTestResult,
  installProbe,
  installSource,
  installSettings,
  installSettingsBusy,
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
  onRefreshDiagnostics,
  onRunKimiDoctor,
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
  onPickKimiPath,
  onSavePathAndRetry,
  onEnableContextMenu,
  onDisableContextMenu,
  onPickWorkDir,
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
  onSkillCenterSectionChange,
  onSkillCenterGitRepoUrlChange,
  onSkillCenterGitRefChange,
  onSelectSkill,
  onOpenTask,
  onCloseTask,
  onSelectDiscoveredSkill,
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
  onKimiCodeAccessDraftChange,
  onResetKimiCodeAccessDraft,
  onSaveKimiCodeAccessConfig,
  onTestKimiCodeAccessConfig,
  onInstallSourceChange,
  onSaveInstallSettings,
  onRefreshPowerShellPreflight,
  onInstallDependencies,
  onInstallKimi,
  onUpgradeKimi,
  onInstallNodejs,
  onStartInstallTask,
  onCancelInstallTask,
  onSkipOnboarding,
  onOpenExternalUrl,
  installMessage,
}: ControlCenterViewProps) {
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
  const [expandedUnifiedRailGroups, setExpandedUnifiedRailGroups] = useState<Set<string>>(
    () => new Set(activeControlSection === "overview" ? [] : [activeControlSection]),
  );
  const [activeFocusId, setActiveFocusId] = useState<string | null>(null);
  const bridgeCreateMenuRef = useRef<HTMLDivElement | null>(null);
  const focusClearTimerRef = useRef<number | null>(null);
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
  const isAssistantSettingsSection =
    activeControlSection === "overview" ||
    activeControlSection === "onboarding" ||
    activeControlSection === "runtime_center";
  const isOnboardingSection = isAssistantSettingsSection;
  const isBridgeRunning =
    bridgeStatus.state === "running" ||
    bridgeStatus.state === "starting" ||
    bridgeStatus.state === "degraded";
  const bridgeDisplayName = getBridgeDisplayName(bridgeSettings);
  const bridgeTaskConnectorId =
    activeTask === "bridge_connector_secrets" || activeTask === "bridge_runtime"
      ? activeTaskPayload?.connectorId ?? null
      : null;
  const effectiveSelectedBridgeConnectorId = bridgeTaskConnectorId ?? selectedBridgeConnectorId;
  const isBridgeConnectorSecretsTask = activeTask === "bridge_connector_secrets";
  const isBridgeRuntimeTask = activeTask === "bridge_runtime";
  const isKimiCodeAccessTask = activeTask === "kimi_code_access";
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
  const selectedFeishuAutoApprove = Boolean(
    selectedBridgeConnector?.platform === "feishu"
      ? (selectedBridgeConnector.feishuAutoApprove ?? bridgeSettings.feishuAutoApprove)
      : false,
  );
  const selectedWeixinSecretsConfigured = Boolean(
    selectedBridgeConnectorSecrets?.weixin?.botToken.configured &&
      selectedBridgeConnectorSecrets?.weixin?.ownerUserId,
  );
  const selectedBridgeConnectorPersisted = Boolean(
    selectedBridgeConnector &&
      bridgePersistedConnectorIds.includes(selectedBridgeConnector.id),
  );
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
  const providerApiHealth = onboarding?.providerApiHealth ?? status?.providerApiHealth;
  const providerApiConfigured =
    onboarding?.providerApiConfigured ??
    status?.providerApiConfigured ??
    Boolean(
      kimiCodeAccessView &&
        (kimiCodeAccessView.provider.apiKeyConfigured ||
          kimiCodeAccessView.services.search.apiKeyConfigured ||
          kimiCodeAccessView.services.fetch.apiKeyConfigured),
    );
  const providerApiReady = providerApiConfigured && !providerApiHealth?.needsAttention;
  const optionalApiStatusLabel = providerApiConfigured
    ? providerApiReady
      ? "已配置"
      : "可选配置异常"
    : "可选";
  const optionalApiStatusTone = providerApiReady
    ? "success"
    : providerApiConfigured
      ? "warning"
      : "neutral";
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

  const contextMenuReady = !runtimeContextMenuSupported || runtimeContextMenuEnabled;
  const installReady = onboarding?.kimiInstalled ?? stepCompletion.install_kimi;
  const workDirReady = Boolean(effectiveWorkDir);
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
      : "work_dir";
  const defaultOnboardingCard: OnboardingCardId =
    installSessionSnapshot.taskId === "upgrade_kimi" && installSessionSnapshot.status !== "idle"
      ? "install"
      : recommendedOnboardingCard;

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
  const installPrimaryActionLabel = installReady ? "升级 Kimi" : "一键安装 Kimi Code";
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

  const optionalApiPrimaryAction = (
    <Button
      type="button"
      icon={<SlidersHorizontal size={15} />}
      className="cc-action-btn"
      onClick={() => void onOpenTask("kimi_code_access")}
      disabled={kimiCodeAccessBusy}
    >
      按需配置
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
      await handleOpenOnboardingEntry();
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
    if (section === "workspace_hub" || section === "schedule") {
      setActiveControlSection(section);
      return;
    }
    await handleSelectRuntimePanel("core");
  }

  const handleToggleUnifiedRailGroup = useCallback((groupId: string) => {
    setExpandedUnifiedRailGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleRailItemActivate = useCallback((itemId: string) => {
    setActiveFocusId(itemId);
    if (focusClearTimerRef.current !== null) {
      window.clearTimeout(focusClearTimerRef.current);
    }
    focusClearTimerRef.current = window.setTimeout(() => {
      setActiveFocusId(null);
      focusClearTimerRef.current = null;
    }, 1500);
  }, []);

  useEffect(() => {
    if (!activeFocusId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(focusDomId(activeFocusId))?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeControlSection, activeFocusId]);

  useEffect(
    () => () => {
      if (focusClearTimerRef.current !== null) {
        window.clearTimeout(focusClearTimerRef.current);
      }
    },
    [],
  );

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
      feishuAutoApprove: platform === "feishu" ? false : undefined,
      feishuReplyRenderer: platform === "feishu" ? "streaming" : undefined,
      weixinReplyMode: platform === "weixin" ? "status_only" : undefined,
    };
    onBridgeSettingsChange({
      ...bridgeSettings,
      connectors: [...bridgeSettings.connectors, nextConnector],
    });
    setSelectedBridgeConnectorId(nextConnector.id);
  }

  function handleCreateBridgeConnector(platform: BridgePlatform) {
    setBridgeCreateMenuOpen(false);
    addBridgeConnector(platform);
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
      title: "安装 / 升级 Kimi Code",
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
      title: "Provider API（可选）",
      actionLabel: providerApiConfigured ? "查看配置" : "按需配置",
      statusLabel: optionalApiStatusLabel,
      statusTone: optionalApiStatusTone,
      complete: true,
      primaryAction: optionalApiPrimaryAction,
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
  const activeOnboardingCard = expandedOnboardingCard ?? recommendedOnboardingCard;
  const activeOnboardingStep =
    onboardingSteps.find((step) => step.id === activeOnboardingCard) ?? onboardingSteps[0];
  const runtimeIssues = [
    diagnostics?.lastError ? `最近错误：${diagnostics.lastError}` : null,
    diagnostics?.startupFailureDetail ? `启动失败详情：${diagnostics.startupFailureDetail}` : null,
    diagnostics?.versionError ? `版本检查：${diagnostics.versionError}` : null,
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
  const skillDiscoveryRecords = skillDiscoverySnapshot?.records ?? [];
  const unifiedRailGroups = useMemo<UnifiedRailGroup[]>(() => {
    const topLevelItems: UnifiedRailItem[] = controlSections.map((section) => ({
      id: section.id,
      label: section.id === "bridge_center" ? bridgeDisplayName : section.label,
      icon: section.icon,
      active:
        section.id === "onboarding"
          ? isAssistantSettingsSection
          : activeControlSection === section.id,
      onSelect: () => {
        void handleSelectControlSection(section.id);
      },
    }));

    return [
      {
        id: "sections",
        label: "当前源码里的一级视图",
        items: topLevelItems,
      },
    ];
  }, [
    activeControlSection,
    bridgeDisplayName,
    handleSelectControlSection,
    isAssistantSettingsSection,
  ]);

  function renderOnboardingSection() {
    return (
      <section className="cc-image-detail-page">
        <div
          id={focusDomId("onboarding")}
          className={`cc-image-detail-top ${activeFocusId === "onboarding" ? "is-focus" : ""}`}
        >
          <div>
            <h1>快速设置</h1>
            <p>把 onboarding、安装、登录、右键菜单、工作目录与 Provider API 配置收敛到一个详情页。</p>
          </div>
          <div className="cc-image-top-controls">
            <Button type="button" className="cc-action-btn" onClick={() => void onSavePathAndRetry()} disabled={actionBusy}>
              保存并重试
            </Button>
            <ControlCenterActionMenu
              items={[
                {
                  label: "刷新状态",
                  icon: <RefreshCw size={15} />,
                  onSelect: () => {
                    void onRefreshOnboarding();
                    void onRefreshDiagnostics();
                    void onRefreshContextMenuStatus();
                    void onRefreshBridgeSettings();
                    void onRefreshBridgeStatus();
                    void onRefreshBridgeSecretsMask();
                  },
                },
                {
                  label: "重启后端",
                  icon: <RefreshCcw size={15} />,
                  onSelect: () => void onRetry(),
                },
                {
                  label: "暂时跳过",
                  icon: <ChevronRight size={15} />,
                  onSelect: () => void onSkipOnboarding(),
                },
              ]}
            />
          </div>
        </div>

        <ControlCenterDescList
          columns={4}
          className="cc-image-meta-grid"
          items={[
            { label: "Recommended step", value: activeOnboardingStep.id },
            { label: "Kimi installed", value: onboarding?.kimiInstalled ? "detected" : "missing" },
            { label: "Context menu", value: runtimeContextMenuEnabled ? "supported" : contextMenuStatusLabel },
            { label: "Auth mode", value: status?.authMode ?? "provider_api" },
          ]}
        />

        <section className="cc-image-card">
          <h2>引导步骤</h2>
          <ul className="cc-image-row-list">
            {onboardingSteps.map((step) => (
              <li
                key={step.id}
                id={focusDomId(`onboarding:${step.id}`)}
                className={`cc-image-row ${activeFocusId === `onboarding:${step.id}` ? "is-focus" : ""}`}
              >
                <div>
                  <div className="cc-image-row-title">
                    <span className={`cc-dot ${step.statusTone}`} />
                    {step.title}
                  </div>
                  <div className="cc-image-row-desc">{step.actionLabel}</div>
                </div>
                <div className="cc-image-row-actions">
                  <ControlCenterStatusBadge tone={step.statusTone}>{step.statusLabel}</ControlCenterStatusBadge>
                  {step.primaryAction}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="cc-image-card">
          <h2>{activeOnboardingStep.title}</h2>
          <div className="cc-step-body cc-step-body-single cc-step-detail-scroll">
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
                      {recentInstallSummary ? <p className="hint cc-step-meta">{recentInstallSummary}</p> : null}
                      {installMessage ? <p className="hint cc-step-meta">{installMessage}</p> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeOnboardingStep.id === "context_menu" ? renderContextMenuStepContent() : null}

              {activeOnboardingStep.id === "auth" ? (
                <div className="cc-auth-panel">
                  <p className="hint cc-step-summary">
                    Provider API 是可选配置；未配置也不会阻塞控制中心、工作区或 onboarding。
                  </p>
                  <div className="cc-brief-list">
                    <article className="cc-brief-item">
                      <strong>Provider API</strong>
                      <ControlCenterStatusBadge tone={providerApiStatusTone}>
                        {providerApiStatusLabel}
                      </ControlCenterStatusBadge>
                    </article>
                    <article className="cc-brief-item">
                      <strong>配置文件</strong>
                      <span>
                        {kimiCodeAccessSummary?.configPath ||
                          kimiCodeAccessView?.configPath ||
                          "~/.kimi-code/config.toml"}
                      </span>
                    </article>
                  </div>
                  <div className="cc-api-inline-actions">
                    <Button type="button" variant="outline" icon={<SlidersHorizontal size={14} />} className="cc-action-btn" onClick={() => void onOpenTask("kimi_code_access")} disabled={kimiCodeAccessBusy}>
                      打开 API 配置
                    </Button>
                    <Button type="button" variant="outline" icon={<FolderOpen size={14} />} className="cc-action-btn" onClick={() => void onOpenKimiConfigDir()}>
                      打开配置目录
                    </Button>
                  </div>
                  {kimiCodeAccessDirty ? (
                    <p className="hint cc-step-meta">
                      API 配置存在未保存修改；这不会阻塞继续使用控制中心。
                    </p>
                  ) : null}
                  {kimiCodeAccessView?.warnings?.length ? (
                    <p className="hint cc-step-meta">当前警告：{kimiCodeAccessView.warnings[0]}</p>
                  ) : null}
                </div>
              ) : null}

              {activeOnboardingStep.id === "work_dir" ? renderWorkDirStepContent() : null}
            </div>
          </div>
        </section>

        <section className="cc-image-card">
          <h2>安装源与镜像健康</h2>
          <ControlCenterDescList
            columns={3}
            className="cc-image-meta-grid compact"
            items={[
              { label: "Install source", value: installSource, meta: "可切换官方源或自定义镜像" },
              { label: "PowerShell preflight", value: powershellPreflight?.kind ?? "unchecked", meta: "Windows 安装前置检查" },
              {
                label: "Mirror health",
                value: installMirrorHealthReport
                  ? `${installMirrorHealthReport.entries.filter((entry) => entry.healthy).length}/${installMirrorHealthReport.entries.length} ready`
                  : "unchecked",
                meta: "可刷新镜像可用性",
              },
            ]}
          />
        </section>
      </section>
    );
  }

  function renderRuntimeSection() {
    const appLogText =
      diagnostics?.appLogTail && diagnostics.appLogTail.length > 0
        ? diagnostics.appLogTail.join("\n")
        : "暂无应用日志。";
    const backendLogText =
      diagnostics?.backendLogTail && diagnostics.backendLogTail.length > 0
        ? diagnostics.backendLogTail.join("\n")
        : "暂无后端日志。";
    const startupTraceRows = diagnostics?.startupTrace ?? [];
    const copyText = (value: string) => {
      void navigator.clipboard?.writeText(value);
    };

    return (
      <section className="cc-image-detail-page">
        <div
          id={focusDomId("runtime_center")}
          className={`cc-image-detail-top ${activeFocusId === "runtime_center" ? "is-focus" : ""}`}
        >
          <div>
            <h1>运行诊断</h1>
            <p>PID、startup trace、Kimi Doctor、WebView runtime 和日志尾部集中查看。</p>
          </div>
          <div className="cc-image-top-controls">
            <Button
              type="button"
              className="cc-action-btn"
              onClick={() => void onRunKimiDoctor()}
              disabled={kimiDoctorBusy}
            >
              运行 Kimi Doctor
            </Button>
            <Button
              type="button"
              variant="outline"
              className="cc-action-btn"
              onClick={() => void onRefreshDiagnostics()}
              disabled={diagnosticsBusy}
            >
              刷新诊断
            </Button>
          </div>
        </div>

        <ControlCenterDescList
          columns={4}
          className="cc-image-meta-grid"
          items={[
            { label: "Backend state", value: diagnostics?.state ?? "-" },
            { label: "PID", value: String(diagnostics?.pid ?? "-") },
            { label: "Startup phase", value: diagnostics?.startupPhase ?? "-" },
            { label: "WebView", value: diagnostics?.webviewRuntimeVersion ?? diagnostics?.webviewRuntimeKind ?? "-" },
          ]}
        />

        <section
          id={focusDomId("runtime:core")}
          className={`cc-image-card ${activeFocusId === "runtime:core" ? "is-focus" : ""}`}
        >
          <h2>启动链路</h2>
          <table className="cc-image-table">
            <thead>
              <tr><th>#</th><th>阶段</th><th>状态</th></tr>
            </thead>
            <tbody>
              {(startupTraceRows.length > 0 ? startupTraceRows : ["暂无启动轨迹"]).map((line, index) => (
                <tr key={`${index}-${line}`}>
                  <td>{String(index + 1).padStart(2, "0")}</td>
                  <td>{line}</td>
                  <td>{index === startupTraceRows.length - 1 && runtimeIssues.length > 0 ? "需要关注" : "ok"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {kimiDoctorResult ? (
            <div className="cc-image-code-card">
              <div className="cc-image-code-toolbar">
                <span>Kimi Doctor</span>
                <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => copyText(formatKimiDoctorOutput(kimiDoctorResult))}>复制</Button>
              </div>
              <pre>{formatKimiDoctorOutput(kimiDoctorResult)}</pre>
            </div>
          ) : null}
        </section>

        <section
          id={focusDomId("runtime:paths")}
          className={`cc-image-card ${activeFocusId === "runtime:paths" ? "is-focus" : ""}`}
        >
          <h2>路径与菜单</h2>
          <div className="cc-image-row-list">
            <div className="cc-image-row">
              <div>
                <div className="cc-image-row-title"><span className={`cc-dot ${contextMenuStatusTone}`} />右键菜单</div>
                <div className="cc-image-row-desc">{contextMenuStatus?.message ?? contextMenuStatusLabel}</div>
              </div>
              <div className="cc-image-row-actions">
                <Button type="button" variant="outline" className="cc-action-btn" onClick={() => void onEnableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>启用</Button>
                <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => void onDisableContextMenu()} disabled={contextMenuBusy || !runtimeContextMenuSupported}>禁用</Button>
              </div>
            </div>
          </div>
          <ControlCenterDescList
            columns={3}
            className="cc-image-meta-grid compact"
            items={[
              { label: "Kimi path", value: diagnostics?.detectedKimiPath ?? diagnostics?.configuredKimiPath ?? "-" },
              { label: "Work dir", value: diagnostics?.effectiveWorkDir ?? diagnostics?.configuredWorkDir ?? "-" },
              { label: "Logs dir", value: diagnostics?.logsDir ?? "-" },
            ]}
          />
        </section>

        <section
          id={focusDomId("runtime:logs")}
          className={`cc-image-card ${activeFocusId === "runtime:logs" ? "is-focus" : ""}`}
        >
          <h2>日志与 Doctor</h2>
          <div className="cc-image-code-card">
            <div className="cc-image-code-toolbar">
              <span>recent.log</span>
              <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => copyText(condensedLogPreview)}>复制</Button>
            </div>
            <pre>{condensedLogPreview}</pre>
          </div>
          <div className="cc-image-code-grid">
            <div className="cc-image-code-card">
              <div className="cc-image-code-toolbar">
                <span>app.log</span>
                <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => copyText(appLogText)}>复制</Button>
              </div>
              <pre>{appLogText}</pre>
            </div>
            <div className="cc-image-code-card">
              <div className="cc-image-code-toolbar">
                <span>backend.log</span>
                <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => copyText(backendLogText)}>复制</Button>
              </div>
              <pre>{backendLogText}</pre>
            </div>
          </div>
        </section>
      </section>
    );
  }

  function renderBridgeSection() {
    return (
      <section className="cc-image-detail-page">
        <div
          id={focusDomId("bridge_center")}
          className={`cc-image-detail-top ${activeFocusId === "bridge_center" ? "is-focus" : ""}`}
        >
          <div>
            <h1>外部 IM 通道</h1>
            <p>Telegram、飞书、微信 connector，运行态、密钥、sessions、bindings、approvals 与日志。</p>
          </div>
          <div className="cc-image-top-controls">
            <span className={`cc-image-switch ${bridgeSettings.enabled ? "" : "off"}`} aria-label="Bridge enabled" />
            <Button type="button" variant="outline" className="cc-action-btn" onClick={() => void onRestartBridge()} disabled={bridgeBusy}>
              重启 Bridge
            </Button>
            <ControlCenterActionMenu
              disabled={bridgeBusy}
              items={[
                {
                  label: "刷新状态",
                  icon: <RefreshCw size={15} />,
                  onSelect: () => {
                    void Promise.all([
                      onRefreshBridgeSettings(),
                      onRefreshBridgeStatus(),
                      onRefreshBridgeBindings(),
                      onRefreshBridgeApprovals(),
                      onRefreshBridgeSecretsMask(),
                    ]);
                  },
                },
                { label: "打开日志目录", icon: <FolderOpen size={15} />, onSelect: () => void onOpenLogs() },
                { label: "停止 Bridge", icon: <X size={15} />, tone: "danger", onSelect: () => void onStopBridge() },
              ]}
            />
          </div>
        </div>

        <ControlCenterDescList
          columns={4}
          className="cc-image-meta-grid"
          items={[
            { label: "Bridge state", value: bridgeStatus.state },
            { label: "Admin port", value: String(bridgeStatus.adminPort ?? "-") },
            { label: "Auto start", value: bridgeSettings.autoStart ? "enabled" : "disabled" },
            { label: "Pending approvals", value: String(bridgeApprovals.length) },
          ]}
        />

        {shouldRenderInlineBridgeTask ? renderActiveTask() : null}

        <section className="cc-image-card">
          <div className="cc-image-card-title-row">
            <h2>Connectors</h2>
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
                <div className="cc-bridge-create-menu-popover" role="menu" aria-label="选择机器人平台">
                  {(["telegram", "weixin", "feishu"] as BridgePlatform[]).map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      className="cc-bridge-create-menu-item"
                      onClick={() => handleCreateBridgeConnector(platform)}
                      disabled={bridgeBusy}
                      role="menuitem"
                    >
                      <strong>{bridgePlatformLabel(platform)}</strong>
                      <small>创建并配置 {bridgePlatformLabel(platform)} connector</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {visibleBridgeConnectors.length > 0 ? (
            <ul className="cc-image-row-list">
              {visibleBridgeConnectors.map((connector) => {
                const connectorStatus =
                  bridgeStatus.connectors.find((item) => item.connectorId === connector.id) ?? null;
                const connectorSecrets =
                  bridgeSecretsMask.connectors.find((item) => item.connectorId === connector.id) ?? null;
                const connectorSecretsConfigured = hasBridgeConnectorSecretsConfigured(connector, connectorSecrets);
                const connectorRecentError = findBridgeConnectorRecentError(connector, connectorStatus, bridgeRecentErrors);
                const connectorPending = bridgeOverviewPendingConnectorId === connector.id;
                const enabledValue = connectorPending
                  ? (bridgeOverviewPendingEnabled[connector.id] ?? connector.enabled)
                  : connector.enabled;
                return (
                  <li
                    key={connector.id}
                    id={focusDomId(`bridge:${connector.id}`)}
                    className={`cc-image-row ${activeFocusId === `bridge:${connector.id}` ? "is-focus" : ""}`}
                  >
                    <div>
                      <div className="cc-image-row-title">
                        <span className={`cc-dot ${formatBridgeConnectorStateTone(connectorStatus?.state ?? "idle")}`} />
                        {connector.label}
                      </div>
                      <div className="cc-image-row-desc">
                        {bridgePlatformLabel(connector.platform)} · {connectorSecretsConfigured ? "凭据已配置" : "待配置凭据"}
                        {connectorRecentError ? ` · ${connectorRecentError}` : ""}
                      </div>
                    </div>
                    <div className="cc-image-row-actions">
                      <ControlCenterStatusBadge tone={formatBridgeConnectorStateTone(connectorStatus?.state ?? "idle")}>
                        {formatBridgeConnectorStateLabel(connectorStatus?.state ?? "idle")}
                      </ControlCenterStatusBadge>
                      <ControlCenterToggleField
                        label="启用"
                        checked={enabledValue}
                        onChange={(checked) => void handleImmediateBridgeConnectorToggle(connector.id, checked)}
                        disabled={bridgeBusy || connectorPending}
                        busy={connectorPending}
                      />
                      <Button type="button" variant="outline" className="cc-action-btn" onClick={() => openBridgeConnectorSecretsModal(connector.id)} disabled={bridgeBusy}>
                        连接与凭据
                      </Button>
                      <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => openBridgeConnectorRuntimeModal(connector.id)} disabled={bridgeBusy}>
                        运行面板
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="cc-image-muted">还没有机器人。使用“新建机器人”添加 Telegram、微信或飞书 connector。</p>
          )}
        </section>

        <section className="cc-image-card">
          <h2>Sessions / Bindings / Approvals</h2>
          <table className="cc-image-table">
            <thead>
              <tr><th>类型</th><th>内容</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Session</td>
                <td>{bridgeSessions.length} 个外部会话，最近导入后绑定到工作区默认目录。</td>
                <td>
                  <Button
                    type="button"
                    variant="outline"
                    className="cc-action-btn"
                    onClick={() => {
                      const connectorId = effectiveSelectedBridgeConnectorId ?? visibleBridgeConnectors[0]?.id;
                      if (connectorId) openBridgeConnectorRuntimeModal(connectorId);
                    }}
                    disabled={visibleBridgeConnectors.length === 0}
                  >
                    管理 Session
                  </Button>
                </td>
              </tr>
              <tr>
                <td>Binding</td>
                <td>{bridgeBindings.length} 条绑定，可在 connector 运行面板中清除、重置或切换工作目录。</td>
                <td><Button type="button" variant="outline" className="cc-action-btn" onClick={() => void onRefreshBridgeBindings()}>刷新绑定</Button></td>
              </tr>
              <tr>
                <td>Approval</td>
                <td>{bridgeApprovals.length} 个待审批动作。</td>
                <td><Button type="button" className="cc-action-btn" onClick={() => void onRefreshBridgeApprovals()}>打开审批</Button></td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
    );
  }

  function renderSkillCenterSection() {
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
      <section className="cc-image-detail-page">
        <div
          id={focusDomId("skill_center")}
          className={`cc-image-detail-top ${activeFocusId === "skill_center" ? "is-focus" : ""}`}
        >
          <div>
            <h1>Skill 投影</h1>
            <p>安装、导入、扫描、信任、更新、卸载，并投影到用户全局、KIMI_CODE_HOME 或当前 Session。</p>
          </div>
          <div className="cc-image-top-controls">{skillCenterActions}</div>
        </div>
        <ControlCenterDescList
          columns={4}
          className="cc-image-meta-grid"
          items={[
            { label: "Installed skills", value: String(installedSkills.length) },
            { label: "Discovered", value: String(skillDiscoveryRecords.length) },
            { label: "Workspace target", value: workspaceSkillTargets.find((target) => target.isCurrent)?.label ?? "当前工作区" },
            { label: "Container", value: selectedWorkspaceSkillContainerKind },
          ]}
        />
        <div className="cc-image-description">
          <div className="cc-image-meta-label">Description</div>
          <p>当前 Skill 中心管理已安装 skill、发现外部 skill，并把已安装 skill 加入某个工作区目标容器。</p>
        </div>
        <div className="cc-image-tags">
          <span>Scope user_global_kimi</span>
          <span>Scope kimi_code_home</span>
          <span>Scope session_kimi</span>
          <span>Container .agents / .kimi-code / .codex / .claude</span>
        </div>
        <section
          id={focusDomId(activeFocusId?.startsWith("skill-") ? activeFocusId : "skill_center:list")}
          className={`cc-image-card ${activeFocusId?.startsWith("skill-") ? "is-focus" : ""}`}
        >
          <h2>Manage skills</h2>
          <div className="cc-skill-center-body">
            <SkillCenterPanel
              surface="page"
              busy={skillCenterBusy}
              section={skillCenterSection}
              railActions={null}
              onSectionChange={onSkillCenterSectionChange}
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
            onSelectDiscoveredSkill={(discoveryId) => {
              void onSelectDiscoveredSkill(discoveryId);
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
            detailOnly
            activeFocusId={activeFocusId}
          />
          </div>
        </section>
      </section>
    );
  }

  const configBlockingErrors = useMemo(
    () => buildBlockingErrors(kimiCodeAccessDraft),
    [kimiCodeAccessDraft],
  );
  const configWarnings = useMemo(
    () => buildWarnings(kimiCodeAccessDraft, kimiCodeAccessView?.warnings ?? []),
    [kimiCodeAccessDraft, kimiCodeAccessView?.warnings],
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
    if (isKimiCodeAccessTask) {
      return (
        <ControlCenterTaskSurface
          title="Kimi Code 接入配置"
          description="仅维护 Kimi API、Search/Fetch 服务和 App 启动时的子 Agent 并发上限。"
          className="cc-config-modal"
          bodyClassName="cc-config-modal-scroll"
          onBack={onCloseTask}
          onClose={onClose}
          footer={
            <>
              <div className="cc-config-footer-meta">
                <span>校验错误：{configBlockingErrors.length}</span>
                <span>告警：{configWarnings.length}</span>
                {kimiCodeAccessDirty ? (
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
                  onClick={onResetKimiCodeAccessDraft}
                  disabled={kimiCodeAccessBusy || !kimiCodeAccessDirty}
                >
                  重置
                </Button>
                <Button
                  type="button"
                  className="cc-action-btn"
                  icon={<Check size={14} />}
                  onClick={() => void onSaveKimiCodeAccessConfig()}
                  disabled={kimiCodeAccessBusy || configBlockingErrors.length > 0}
                >
                  保存接入配置
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
          <KimiCodeAccessTaskContent
            dirty={kimiCodeAccessDirty}
            view={kimiCodeAccessView}
            draft={kimiCodeAccessDraft}
            testResult={kimiCodeAccessTestResult}
            testing={kimiCodeAccessTesting}
            onDraftChange={onKimiCodeAccessDraftChange}
            onOpenConfigDir={onOpenKimiConfigDir}
            onTestConnection={onTestKimiCodeAccessConfig}
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
                  <ControlCenterToggleField
                    label="自动审批"
                    description="跳过手动确认，直接批准飞书侧 approval。"
                    checked={selectedFeishuAutoApprove}
                    onChange={(checked) =>
                      updateBridgeConnector(selectedBridgeConnector.id, {
                        feishuAutoApprove: checked,
                      })
                    }
                    tone={selectedFeishuAutoApprove ? "danger" : "default"}
                  />
                  {selectedFeishuAutoApprove ? (
                    <p className="hint bridge-error-text">
                      自动审批会让飞书触发的敏感操作绕过人工确认，只建议在可信测试环境短时开启。
                    </p>
                  ) : null}
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
                        type="password"
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
                          type="password"
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
                      <div className="bridge-secret-row">
                        <div className="bridge-secret-copy">
                          <strong>飞书 verificationToken</strong>
                          <small>
                            {selectedBridgeConnectorSecrets.feishu.verificationToken.configured
                              ? selectedBridgeConnectorSecrets.feishu.verificationToken.maskedValue ??
                                "***"
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
                              ? selectedBridgeConnectorSecrets.feishu.encryptKey.maskedValue ?? "***"
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
      <ControlCenterUnifiedRail
        title="控制中心"
        groups={unifiedRailGroups}
        expandedGroups={expandedUnifiedRailGroups}
        onToggleGroup={handleToggleUnifiedRailGroup}
        onExit={onClose}
        onItemActivate={handleRailItemActivate}
      />

      <div className="cc-control-stage cc-control-stage-no-topbar">
        <div className="cc-layout cc-layout-dashboard">
          <div
            className={`cc-main ${
              isOnboardingSection ? "cc-main-onboarding" : ""
            }`}
          >
            {activeTask && !shouldRenderInlineBridgeTask ? (
              renderActiveTask()
            ) : (
              <>
                {activeControlSection === "workspace_hub" ? (
                  <WorkspaceHubPanel
                    onOpenWorkspace={onOpenFolder}
                    detailOnly
                    activeFocusId={activeFocusId}
                  />
                ) : null}
                {activeControlSection === "schedule" ? (
                  <WorkspaceSchedulePanel
                    detailOnly
                    activeFocusId={activeFocusId}
                  />
                ) : null}
                {isAssistantSettingsSection ? (
                  <>
                    {renderOnboardingSection()}
                    {renderRuntimeSection()}
                  </>
                ) : null}
                {activeControlSection === "bridge_center" ? renderBridgeSection() : null}
                {activeControlSection === "skill_center" ? renderSkillCenterSection() : null}
              </>
            )}
          </div>
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
                isBridgeRunning ? "并重启外部 IM 通道" : ""
              }。`}
            </p>
            <div className="main-close-decision-actions">
              <Button
                type="button"
                variant="outline"
                onClick={closeBridgeDeleteConfirm}
                disabled={bridgeBusy}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  void handleConfirmDeleteBridgeRobot();
                }}
                disabled={bridgeBusy}
              >
                删除机器人
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
