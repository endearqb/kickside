import type { ReactNode } from "react";
import { Boxes, CalendarClock, SlidersHorizontal, Sparkles } from "lucide-react";
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
  ContextMenuLabelsInput,
  ControlSectionId,
  DiagnosticsInfo,
  KimiDoctorResult,
  InstallMirrorHealthReport,
  InstallSettingsView,
  InstallProbeStatus,
  InstallSessionSnapshot,
  InstallTaskId,
  DiscoveredSkillDetail,
  SkillDiscoverySnapshot,
  InstalledSkill,
  KimiCodeAccessConfigInput,
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

export const FEISHU_REPLY_RENDERER_OPTIONS = [
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

export function focusDomId(id: string) {
  return `cc-focus-${id}`;
}

export type StepCompletion = Record<ActionableOnboardingStep, boolean>;
export type BridgePrimaryActionMode = "save_enable" | "start" | "apply_restart";
export type OnboardingCardId =
  | "install"
  | "context_menu"
  | "auth"
  | "work_dir"
  | "bridge"
  | "logs";

export type BridgeConnectorSecretDraft = {
  botToken: string;
  appId: string;
  appSecret: string;
  verificationToken: string;
  encryptKey: string;
  weixinBaseUrl: string;
  weixinAccountId: string;
  weixinOwnerUserId: string;
};

export type BridgeDeleteConfirmState = {
  connectorId: string;
  connectorLabel: string;
};

export type ControlCenterViewProps = {
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
  actionError: string | null;
  diagnosticsBusy: boolean;
  kimiDoctorBusy: boolean;
  contextMenuBusy: boolean;
  mainWindowCloseBehavior: MainWindowCloseBehavior;
  installBusy: boolean;
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
  kimiCodeAccessView: KimiCodeAccessConfigView | null;
  kimiCodeAccessDraft: KimiCodeAccessConfigInput;
  kimiCodeAccessBusy: boolean;
  kimiCodeAccessDirty: boolean;
  kimiCodeAccessTesting: boolean;
  kimiCodeAccessTestResult: KimiCodeAccessConfigTestResult | null;
  installProbe: InstallProbeStatus | null;
  installProbeBusy: boolean;
  installSource: "official" | "mirror";
  installSettings: InstallSettingsView;
  installSettingsBusy: boolean;
  installMirrorHealthReport: InstallMirrorHealthReport | null;
  installMirrorHealthBusy: boolean;
  powershellPreflight: PowerShellPreflightSummary | null;
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
  onSaveContextMenuLabels: (input: ContextMenuLabelsInput) => Promise<void>;
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
  onClearSkillSelection: () => void;
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
  onRefreshKimiCodeAccessConfig: () => Promise<void>;
  onKimiCodeAccessDraftChange: (next: KimiCodeAccessConfigInput) => void;
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

export const controlSections: Array<{
  id: ControlSectionId;
  label: string;
  group: "core" | "setup";
  icon: ReactNode;
}> = [
  {
    id: "onboarding",
    label: "小助手设置",
    group: "setup",
    icon: <SlidersHorizontal size={15} />,
  },
  {
    id: "skill_center",
    label: "Skill 中心",
    group: "core",
    icon: <Sparkles size={15} />,
  },
  {
    id: "workspace_hub",
    label: "WorkspaceHub",
    group: "core",
    icon: <Boxes size={15} />,
  },
  {
    id: "schedule",
    label: "调度",
    group: "core",
    icon: <CalendarClock size={15} />,
  },
];

export function createEmptyBridgeConnectorSecretDraft(): BridgeConnectorSecretDraft {
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

export function getKimiInstallPrerequisiteIssues(
  probe: InstallProbeStatus | null,
): string[] {
  if (!probe) {
    return ["等待环境检测"];
  }
  return [
    probe.nodeReady ? null : "需要 Node.js 22.19+",
    probe.gitBashReady ? null : "需要 Git for Windows / Git Bash",
  ].filter((item): item is string => Boolean(item));
}

export function bridgePlatformLabel(platform: BridgePlatform): string {
  if (platform === "telegram") {
    return "Telegram";
  }
  if (platform === "weixin") {
    return "微信";
  }
  return "飞书";
}

export function defaultBridgeConnectorLabel(platform: BridgePlatform, index: number): string {
  if (platform === "telegram") {
    return `Telegram 机器人 ${String(index).padStart(2, "0")}`;
  }
  if (platform === "weixin") {
    return `微信机器人 ${String(index).padStart(2, "0")}`;
  }
  return `飞书机器人 ${String(index).padStart(2, "0")}`;
}

export function generateUniqueBridgeConnectorId(
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

export function findBridgeConnectorRecentError(
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

export function formatBridgeConnectorStateLabel(
  value: BridgeStatus["connectors"][number]["state"] | "idle",
): string {
  switch (value) {
    case "connecting":
      return "运行中";
    case "ready":
      return "运行中";
    case "degraded":
      return "错误";
    case "error":
      return "错误";
    default:
      return "已停止";
  }
}

export function formatBridgeConnectorStateTone(
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

export function hasBridgeConnectorSecretsConfigured(
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

export function formatBridgeTimestamp(value?: string): string {
  if (!value) {
    return "未记录";
  }
  return Number.isNaN(Date.parse(value))
    ? value
    : new Date(value).toLocaleString("zh-CN", { hour12: false });
}

export function formatKimiDoctorOutput(result: KimiDoctorResult): string {
  const chunks = [
    result.stdout ? `stdout\n${result.stdout}` : "",
    result.stderr ? `stderr\n${result.stderr}` : "",
  ].filter(Boolean);
  return chunks.join("\n\n") || "Kimi Code Doctor 未返回输出。";
}

export function isFeishuOnboardingActive(
  session: FeishuConnectorOnboardingSession | null,
): boolean {
  return (
    session?.state === "awaiting_scan" || session?.state === "polling"
  );
}

export function formatFeishuOnboardingStateLabel(
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

export function formatFeishuOnboardingTone(
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

export function isWeixinOnboardingActive(
  session: WeixinConnectorOnboardingSession | null,
): boolean {
  return session?.state === "awaiting_scan" || session?.state === "polling";
}

export function formatWeixinOnboardingStateLabel(
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

export function formatWeixinOnboardingTone(
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
