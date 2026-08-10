import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Eraser,
  FolderOpen,
  Minus,
  Plus,
  RefreshCcw,
  RefreshCw,
  Shield,
  ShieldOff,
  Sparkles,
  X,
} from "lucide-react";
import type {
  AppStatus,
  BridgeConnectorConfig,
  BridgePlatform,
  BridgeSettings,
  ControlSectionId,
  ContextMenuLabelsInput,
  InstallTaskId,
  OnboardingStatus,
  RuntimePanelId,
} from "@/app/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ControlCenterActionMenu } from "@/components/control-center/ControlCenterActionMenu";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterToggleField } from "@/components/control-center/ControlCenterToggleField";
import { BridgeRuntimePanel } from "@/features/bridge/BridgeRuntimePanel";
import {
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
import {
  FEISHU_REPLY_RENDERER_OPTIONS,
  bridgePlatformLabel,
  controlSections,
  createEmptyBridgeConnectorSecretDraft,
  defaultBridgeConnectorLabel,
  createExplorerContextMenuSteps,
  findBridgeConnectorRecentError,
  focusDomId,
  formatBridgeConnectorStateLabel,
  formatBridgeConnectorStateTone,
  formatBridgeTimestamp,
  formatFeishuOnboardingStateLabel,
  formatFeishuOnboardingTone,
  formatKimiDoctorOutput,
  formatWeixinOnboardingStateLabel,
  formatWeixinOnboardingTone,
  generateUniqueBridgeConnectorId,
  getKimiDoctorSummary,
  getKimiCodeUpdatePresentation,
  getLegacySettingsCard,
  getStartupFailureMessage,
  getKimiInstallPrerequisiteIssues,
  hasBridgeConnectorSecretsConfigured,
  isAssistantSettingsSection,
  isFeishuOnboardingActive,
  isWeixinOnboardingActive,
  shouldShowStartupFailureDiagnostics,
  type BridgeConnectorSecretDraft,
  type BridgeDeleteConfirmState,
  type ControlCenterViewProps,
  type OnboardingCardId,
} from "@/features/control-center/controlCenterViewModel";

const DEFAULT_CONTEXT_MENU_LABELS: ContextMenuLabelsInput = {
  openDirBackground: "在此处打开 Kimi 小助手",
  openDir: "在 Kimi 小助手中打开",
  openFile: "复制到工作区并用 Kimi 小助手打开",
  openFilesystemObject: "在 Kimi 小助手中打开",
  moveToWorkspace: "复制到 Kimi 小助手工作区",
  importToDefaultWorkspace: "导入到默认工作区",
  importWithWorkspacePicker: "选择其他工作区",
};

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

function formatAppUpdateProgress(progress: import("@/app/types").AppUpdateProgress | null) {
  if (!progress) return "正在下载";
  if (progress.total && progress.total > 0) {
    return `正在下载 ${Math.min(100, Math.round((progress.downloaded / progress.total) * 100))}%`;
  }
  return `已下载 ${(progress.downloaded / 1024 / 1024).toFixed(1)} MB`;
}

const CONTEXT_MENU_LABEL_FIELDS: Array<{
  key: keyof ContextMenuLabelsInput;
  label: string;
}> = [
  { key: "openDirBackground", label: "目录空白处" },
  { key: "openDir", label: "文件夹" },
  { key: "openFile", label: "文件" },
  { key: "moveToWorkspace", label: "复制父菜单" },
  { key: "importToDefaultWorkspace", label: "导入默认工作区" },
  { key: "importWithWorkspacePicker", label: "选择其他工作区" },
];


export function ControlCenterView({
  surface,
  supportsExplorerContextMenu,
  kimiInstallMode,
  status,
  diagnostics,
  kimiDoctorResult,
  onboarding,
  contextMenuStatus,
  activeControlSection,
  stepCompletion,
  actionBusy,
  actionError,
  diagnosticsBusy,
  kimiDoctorBusy,
  contextMenuBusy,
  installBusy,
  appUpdateSupported,
  appUpdateStatus,
  appUpdateInfo,
  appUpdateProgress,
  appUpdateError,
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
  kimiCodeAccessView,
  installProbe,
  installProbeBusy,
  kimiCodeUpdateStatus,
  kimiCodeUpdateInfo,
  kimiCodeUpdateError,
  installSource,
  installSettings,
  installSettingsBusy,
  installMirrorHealthReport,
  installMirrorHealthBusy,
  powershellPreflight,
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
  onPickKimiPath,
  onSavePathAndRetry,
  onEnableContextMenu,
  onDisableContextMenu,
  onSaveContextMenuLabels,
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
  onSkillCenterFilterChange,
  onSkillCenterSectionChange,
  onSkillCenterGitRepoUrlChange,
  onSkillCenterGitRefChange,
  onSelectSkill,
  onClearSkillSelection,
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
  onInstallSourceChange,
  onSaveInstallSettings,
  onRefreshPowerShellPreflight,
  onInstallDependencies,
  onInstallKimi,
  onUpgradeKimi,
  onInstallNodejs,
  onStartInstallTask,
  onCancelInstallTask,
  onCheckAppUpdate,
  onInstallAppUpdate,
  onCompleteOnboarding,
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
  const [contextMenuLabelsDraft, setContextMenuLabelsDraft] =
    useState<ContextMenuLabelsInput>(DEFAULT_CONTEXT_MENU_LABELS);
  const [expandedUnifiedRailGroups, setExpandedUnifiedRailGroups] = useState<Set<string>>(
    () => new Set(activeControlSection === "overview" ? [] : [activeControlSection]),
  );
  const [activeFocusId, setActiveFocusId] = useState<string | null>(null);
  const bridgeCreateMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsTaskReturnCardRef = useRef<OnboardingCardId | null>(null);
  const focusClearTimerRef = useRef<number | null>(null);
  void bridgeOnboardingDraft;
  void bridgeOnboardingValidation;
  void onBridgeOnboardingDraftChange;
  void onCancelInstallTask;
  void onInstallDependencies;
  void onInstallKimi;
  void onUpgradeKimi;
  void onInstallNodejs;
  void onRefreshSkillCenterState;
  void onRefreshSkillDiscoveryState;
  const appUpdateBusy =
    appUpdateStatus === "checking" ||
    appUpdateStatus === "downloading" ||
    appUpdateStatus === "installing";
  const appUpdateAvailable = appUpdateStatus === "available" && Boolean(appUpdateInfo?.version);
  const externalGuidedInstall = kimiInstallMode === "externalGuided";
  const appUpdateActionLabel = !appUpdateSupported
    ? "仅安装版支持"
    : appUpdateStatus === "checking"
      ? "正在检测"
      : appUpdateStatus === "downloading"
        ? formatAppUpdateProgress(appUpdateProgress)
        : appUpdateStatus === "installing"
          ? "正在安装"
          : appUpdateAvailable
            ? `v${appUpdateInfo?.version} 可更新`
            : appUpdateStatus === "up_to_date"
              ? `v${appUpdateInfo?.currentVersion} · 已是最新版本`
              : appUpdateStatus === "error"
                ? "检测失败"
                : "检测新版本";
  const appUpdateStatusTone = appUpdateStatus === "error"
    ? "danger"
    : appUpdateAvailable
      ? "warning"
      : "neutral";
  const installPathDisplay =
    onboarding?.detectedKimiPath?.trim() ?? kimiPathInput.trim();
  const effectiveWorkDir = status?.effectiveWorkDir ?? onboarding?.workDir ?? "";
  const runtimeContextMenuSupported =
    contextMenuStatus?.supported ?? onboarding?.contextMenuSupported ?? false;
  const runtimeContextMenuEnabled =
    contextMenuStatus?.enabled ?? onboarding?.contextMenuEnabled ?? false;
  const assistantSettingsSectionActive = isAssistantSettingsSection(activeControlSection);
  const isOnboardingSection = assistantSettingsSectionActive;
  const isBridgeRunning =
    bridgeStatus.state === "running" ||
    bridgeStatus.state === "starting" ||
    bridgeStatus.state === "degraded";
  const appLogText = diagnostics?.appLogTail?.length
    ? diagnostics.appLogTail.join("\n")
    : "暂无应用日志。";
  const backendLogText = diagnostics?.backendLogTail?.length
    ? diagnostics.backendLogTail.join("\n")
    : "暂无后端日志。";
  const bridgeLogText = bridgeLogTail.length ? bridgeLogTail.join("\n") : "暂无 Bridge 日志。";
  const bridgeTaskConnectorId =
    activeTask === "bridge_connector_secrets" || activeTask === "bridge_runtime"
      ? activeTaskPayload?.connectorId ?? null
      : null;
  const effectiveSelectedBridgeConnectorId = bridgeTaskConnectorId ?? selectedBridgeConnectorId;
  const isBridgeConnectorSecretsTask = activeTask === "bridge_connector_secrets";
  const isBridgeRuntimeTask = activeTask === "bridge_runtime";
  const isSkillGitImportTask = activeTask === "skill_git_import";
  const isSkillImportTask = activeTask === "skill_import";
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
    () => sortedBridgeConnectors.filter((connector) => connector.platform !== "telegram"),
    [sortedBridgeConnectors],
  );
  const kimiCodeUpdatePresentation = getKimiCodeUpdatePresentation(
    kimiCodeUpdateStatus,
    kimiCodeUpdateInfo,
  );
  const installStatusTone = kimiCodeUpdatePresentation.tone ?? (!onboarding?.kimiInstalled
    ? "warning"
    : status?.state === "running"
      ? "success"
      : "neutral");
  const contextMenuStatusTone = !runtimeContextMenuSupported
    ? "neutral"
    : runtimeContextMenuEnabled
      ? "success"
      : "warning";
  const providerApiHealth = onboarding?.providerApiHealth ?? status?.providerApiHealth;
  const kimiLoginHealth = onboarding?.kimiLoginHealth ?? status?.kimiLoginHealth;
  const authMode = onboarding?.authMode ?? status?.authMode;
  const activeProvider =
    onboarding?.providerApiActiveProvider ?? status?.providerApiActiveProvider;
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
  const optionalApiStatusTone = providerApiReady
    ? "success"
    : providerApiConfigured
      ? "danger"
      : "neutral";
  const workDirStatusTone = effectiveWorkDir ? "success" : "warning";

  useEffect(() => {
    const legacyCard = getLegacySettingsCard(activeControlSection);
    if (!legacyCard) return;
    setExpandedOnboardingCard(legacyCard);
    setActiveControlSection("onboarding");
    void onRefreshDiagnostics();
  }, [activeControlSection, onRefreshDiagnostics, setActiveControlSection]);

  useEffect(() => {
    if (
      (activeTask !== "bridge_connector_secrets" && expandedOnboardingCard !== "bridge") ||
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
    activeTask,
    expandedOnboardingCard,
    onRefreshFeishuConnectorOnboardingStatus,
    selectedFeishuOnboarding,
  ]);

  useEffect(() => {
    if (
      (activeTask !== "bridge_connector_secrets" && expandedOnboardingCard !== "bridge") ||
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
    activeTask,
    expandedOnboardingCard,
    onRefreshWeixinConnectorOnboardingStatus,
    selectedWeixinOnboarding,
  ]);

  useEffect(() => {
    setBridgeConnectorTaskError(null);
  }, [activeTask, effectiveSelectedBridgeConnectorId]);

  useEffect(() => {
    setContextMenuLabelsDraft(contextMenuStatus?.labels ?? DEFAULT_CONTEXT_MENU_LABELS);
  }, [contextMenuStatus?.labels]);

  const contextMenuReady = !runtimeContextMenuSupported || runtimeContextMenuEnabled;
  const installReady = onboarding?.kimiInstalled ?? stepCompletion.install_kimi;
  const installPrerequisiteIssues = getKimiInstallPrerequisiteIssues(installProbe);
  const installPrerequisitesReady = installPrerequisiteIssues.length === 0;
  const workDirReady = Boolean(effectiveWorkDir);
  const providerApiStatusLabel = !providerApiConfigured
    ? "未配置"
    : providerApiHealth?.state === "auth_required"
      ? `认证失败${onboarding?.providerApiActiveProvider ? ` · ${onboarding.providerApiActiveProvider}` : ""}`
      : providerApiHealth?.state === "error"
        ? `运行异常${onboarding?.providerApiActiveProvider ? ` · ${onboarding.providerApiActiveProvider}` : ""}`
        : `已配置${onboarding?.providerApiActiveProvider ? ` · ${onboarding.providerApiActiveProvider}` : ""}`;
  const contextMenuLabelsDirty = CONTEXT_MENU_LABEL_FIELDS.some(
    ({ key }) =>
      contextMenuLabelsDraft[key] !==
      (contextMenuStatus?.labels ?? DEFAULT_CONTEXT_MENU_LABELS)[key],
  );
  const workDirDirty = workDirInput.trim() !== effectiveWorkDir.trim();
  const bridgeHasError = Boolean(
    bridgeStatus.state === "degraded" ||
      bridgeStatus.state === "crashed" ||
      bridgeStatus.lastError ||
      bridgeRecentErrors[0],
  );
  const bridgeStatusTone = bridgeHasError
    ? "danger"
    : visibleBridgeConnectors.length === 0
      ? "warning"
      : isBridgeRunning
        ? "success"
        : "neutral";
  useEffect(() => {
    if (!assistantSettingsSectionActive) {
      setExpandedOnboardingCard(null);
      return;
    }
    if (installBusy && expandedOnboardingCard !== "install") {
      setExpandedOnboardingCard("install");
    }
  }, [assistantSettingsSectionActive, expandedOnboardingCard, installBusy]);

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
    if (!assistantSettingsSectionActive || expandedOnboardingCard !== "bridge") {
      setBridgeCreateMenuOpen(false);
    }
  }, [assistantSettingsSectionActive, expandedOnboardingCard]);

  const installSecondaryAction = (
    <Button
      type="button"
      variant="ghost"
      icon={<RefreshCcw size={15} />}
      className="cc-action-btn"
      onClick={() => void onRefreshInstallProbe()}
      disabled={installBusy || installProbeBusy}
    >
      重新检测
    </Button>
  );
  const appUpdatePrimaryAction = (
    <Button
      type="button"
      icon={appUpdateAvailable ? <Download size={15} /> : <RefreshCcw size={15} />}
      className="cc-action-btn"
      onClick={() => void (appUpdateAvailable ? onInstallAppUpdate() : onCheckAppUpdate())}
      disabled={!appUpdateSupported || appUpdateBusy}
    >
      {appUpdateAvailable ? "下载并更新" : "检测更新"}
    </Button>
  );
  const installPrimaryTaskId: InstallTaskId = installReady ? "upgrade_kimi" : "quick_install_core";
  const installPrimaryActionLabel = externalGuidedInstall
    ? installReady
      ? "查看升级说明"
      : "查看安装说明"
    : !installReady
      ? "一键安装 Kimi Code"
      : kimiCodeUpdatePresentation.primaryLabel;
  const installBarActionLabel = !installReady
    ? installPrimaryActionLabel
    : kimiCodeUpdatePresentation.barLabel;
  async function handleStartOnboardingInstallTask(taskId: InstallTaskId) {
    setExpandedOnboardingCard("install");
    if (!installPrerequisitesReady && (taskId === "quick_install_core" || taskId === "upgrade_kimi")) {
      return;
    }
    await onStartInstallTask(taskId);
  }
  const installPrimaryAction = (
    <Button
      type="button"
      icon={installReady ? <RefreshCcw size={15} /> : <Plus size={15} />}
      className="cc-action-btn"
      onClick={() =>
        void (externalGuidedInstall
          ? onOpenExternalUrl(
              "https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/guides/getting-started.md#installation",
            )
          : handleStartOnboardingInstallTask(installPrimaryTaskId))
      }
      disabled={
        installBusy ||
        installProbeBusy ||
        (!externalGuidedInstall &&
          ((installReady && kimiCodeUpdatePresentation.disabled) || !installPrerequisitesReady))
      }
      title={externalGuidedInstall ? undefined : installPrerequisiteIssues.join("；") || undefined}
    >
      {installPrimaryActionLabel}
    </Button>
  );

  const contextMenuPrimaryAction = (
    <Button
      type="button"
      icon={runtimeContextMenuEnabled ? <Minus size={15} /> : <Plus size={15} />}
      className="cc-action-btn"
      onClick={() =>
        void (runtimeContextMenuEnabled ? onDisableContextMenu() : onEnableContextMenu())
      }
      disabled={contextMenuBusy || !runtimeContextMenuSupported}
    >
      {runtimeContextMenuEnabled ? "禁用菜单" : "启用菜单"}
    </Button>
  );

  const workDirPrimaryAction = (
    <Button
      type="button"
      icon={workDirDirty ? <Check size={15} /> : <FolderOpen size={15} />}
      className="cc-action-btn"
      onClick={() =>
        void (workDirDirty
          ? onSaveWorkDirAndRestart()
          : effectiveWorkDir.trim()
            ? onOpenFolder(effectiveWorkDir.trim())
            : onPickWorkDir())
      }
      disabled={actionBusy}
    >
      {workDirDirty ? "保存并重启" : effectiveWorkDir ? "打开文件夹" : "选择目录"}
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
      icon={<Plus size={15} />}
      className="cc-action-btn"
      onClick={() => {
        setExpandedOnboardingCard("bridge");
        if (visibleBridgeConnectors.length === 0) {
          setBridgeCreateMenuOpen(true);
        }
      }}
      disabled={bridgeBusy}
    >
      {visibleBridgeConnectors.length === 0 ? "新建机器人" : "管理通道"}
    </Button>
  );

  const logsPrimaryAction = (
    <Button
      type="button"
      icon={<FolderOpen size={15} />}
      className="cc-action-btn"
      onClick={() => void onOpenLogs()}
    >
      打开日志目录
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
      setExpandedOnboardingCard("doctor");
      setActiveControlSection("onboarding");
      setActiveRuntimePanel(panel);
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
    openSettingsTask("bridge_connector_secrets", "bridge", { connectorId });
  }

  function openBridgeConnectorRuntimeModal(connectorId: string) {
    setSelectedBridgeConnectorId(connectorId);
    openSettingsTask("bridge_runtime", "bridge", { connectorId });
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
      closeSettingsTask();
    } catch (error) {
      setBridgeConnectorTaskError(`保存并应用机器人配置失败：${String(error)}`);
    }
  }

  async function handleStartConnectorOnboarding(connector: BridgeConnectorConfig) {
    if (connector.platform === "telegram") return;
    setSelectedBridgeConnectorId(connector.id);
    setBridgeConnectorTaskError(null);
    const shouldPersistBeforeOnboarding =
      bridgeSettingsDirty || !bridgePersistedConnectorIds.includes(connector.id);

    if (shouldPersistBeforeOnboarding) {
      try {
        await onPersistBridgeSettings({ showRestartNotice: false });
      } catch (error) {
        setBridgeConnectorTaskError(
          `保存当前机器人配置失败，未启动扫码流程：${String(error)}`,
        );
        return;
      }
    }

    try {
      if (connector.platform === "feishu") {
        await onStartFeishuConnectorOnboarding(connector.id);
      } else {
        await onStartWeixinConnectorOnboarding(connector.id);
      }
    } catch (error) {
      setBridgeConnectorTaskError(`启动扫码流程失败：${String(error)}`);
    }
  }

  async function handleStartSelectedFeishuOnboarding() {
    if (selectedBridgeConnector?.platform === "feishu") {
      await handleStartConnectorOnboarding(selectedBridgeConnector);
    }
  }

  async function handleCancelSelectedFeishuOnboarding() {
    if (!selectedFeishuOnboarding) {
      return;
    }
    await onCancelFeishuConnectorOnboarding(selectedFeishuOnboarding.sessionId);
  }

  async function handleStartSelectedWeixinOnboarding() {
    if (selectedBridgeConnector?.platform === "weixin") {
      await handleStartConnectorOnboarding(selectedBridgeConnector);
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
      <div className="cc-settings-detail-stack">
        <div className="cc-settings-live-row" aria-live="polite">
          <span>{contextMenuBusy ? "正在更新资源管理器右键菜单" : "右键菜单状态已同步"}</span>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCcw size={15} />}
            className="cc-action-btn"
            onClick={() => void onRefreshContextMenuStatus()}
            disabled={contextMenuBusy}
          >
            重新检测
          </Button>
        </div>
        {onboarding?.contextMenuMessage ? (
          <p className="hint cc-step-meta">{onboarding.contextMenuMessage}</p>
        ) : null}
        {contextMenuStatus?.message && contextMenuStatus.message !== onboarding?.contextMenuMessage ? (
          <p className="hint cc-step-meta">{contextMenuStatus.message}</p>
        ) : null}
        <div className="cc-settings-direct-detail">
          <div className="cc-context-menu-label-grid">
            {CONTEXT_MENU_LABEL_FIELDS.map((field) => (
              <label key={field.key} className="cc-context-menu-label-field">
                <span>{field.label}</span>
                <Input
                  value={contextMenuLabelsDraft[field.key]}
                  onChange={(event) =>
                    setContextMenuLabelsDraft((current) => ({
                      ...current,
                      [field.key]: event.currentTarget.value,
                    }))
                  }
                  disabled={contextMenuBusy || !runtimeContextMenuSupported}
                />
              </label>
            ))}
          </div>
          <div className="cc-context-menu-preview-list">
            {(contextMenuStatus?.items ?? []).length ? (
              (contextMenuStatus?.items ?? []).map((item) => (
                <article key={item.id} className="cc-context-menu-preview-item">
                  <div>
                    <strong>{contextMenuLabelsDraft[item.labelKey] ?? item.label}</strong>
                    <span>{item.scope}</span>
                  </div>
                  <code>{item.command || item.registryKey}</code>
                </article>
              ))
            ) : (
              <p className="hint">启用右键菜单后显示命令预览。</p>
            )}
          </div>
          <div className="cc-settings-more-actions">
            <Button
              type="button"
              variant="outline"
              icon={<Check size={15} />}
              className="cc-action-btn"
              onClick={() => void onSaveContextMenuLabels(contextMenuLabelsDraft)}
              disabled={contextMenuBusy || !runtimeContextMenuSupported || !contextMenuLabelsDirty}
            >
              保存名称
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function openSettingsTask(
    task: "bridge_connector_secrets" | "bridge_runtime",
    card: OnboardingCardId,
    payload?: { connectorId?: string },
  ) {
    settingsTaskReturnCardRef.current = card;
    void onOpenTask(task, payload);
  }

  function closeSettingsTask() {
    const returnCard = settingsTaskReturnCardRef.current;
    const closed = onCloseTask();
    if (closed && returnCard) {
      settingsTaskReturnCardRef.current = null;
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            `#${focusDomId(`onboarding:${returnCard}`)} .cc-settings-bar-toggle`,
          )
          ?.focus();
      });
    }
    return closed;
  }

  function renderWorkDirStepContent() {
    return (
      <div className="cc-settings-detail-stack">
        <div className="cc-settings-live-row" aria-live="polite">
          {actionBusy ? "正在应用默认工作目录" : workDirDirty ? "目录存在未保存修改" : "目录设置已同步"}
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
          {workDirSecondaryAction}
        </div>
      </div>
    );
  }

  const showStartupFailureDiagnostics = shouldShowStartupFailureDiagnostics(status, diagnostics);
  const startupFailureMessage = getStartupFailureMessage(status, diagnostics);
  const doctorSummary = getKimiDoctorSummary(kimiDoctorResult, showStartupFailureDiagnostics);
  type OnboardingStepView = {
    id: OnboardingCardId;
    index: string;
    title: string;
    actionLabel: string;
    statusTone: "neutral" | "success" | "warning" | "danger";
    complete: boolean;
    primaryAction: ReactNode;
  };
  const onboardingSteps: OnboardingStepView[] = [
    {
      id: "app_update",
      index: "01",
      title: "小助手更新",
      actionLabel: appUpdateActionLabel,
      statusTone: appUpdateStatusTone,
      complete: appUpdateStatus === "up_to_date",
      primaryAction: appUpdatePrimaryAction,
    },
    {
      id: "install",
      index: "02",
      title: "安装 / 升级 Kimi Code",
      actionLabel: installBarActionLabel,
      statusTone: installStatusTone,
      complete: installReady,
      primaryAction: installPrimaryAction,
    },
    ...createExplorerContextMenuSteps<OnboardingStepView>(
      supportsExplorerContextMenu,
      () => ({
        id: "context_menu" as const,
        index: "03",
        title: "资源管理器右键菜单",
        actionLabel: runtimeContextMenuEnabled ? "已启用" : "启用右键菜单",
        statusTone: contextMenuStatusTone,
        complete: contextMenuReady,
        primaryAction: contextMenuPrimaryAction,
      }),
    ),
    {
      id: "auth",
      index: "04",
      title: "认证与 API 设置",
      actionLabel: providerApiStatusLabel,
      statusTone: optionalApiStatusTone,
      complete: true,
      primaryAction: null,
    },
    {
      id: "work_dir",
      index: "05",
      title: "默认工作目录",
      actionLabel: workDirReady ? "已设置" : "设置默认工作目录",
      statusTone: workDirStatusTone,
      complete: workDirReady,
      primaryAction: workDirPrimaryAction,
    },
    {
      id: "bridge",
      index: "06",
      title: "外部 IM 通道",
      actionLabel:
        visibleBridgeConnectors.length === 0
          ? "连接微信或飞书"
          : `${visibleBridgeConnectors.length} 个机器人 · ${bridgeStatus.pendingApprovals} 个待审批`,
      statusTone: bridgeStatusTone,
      complete: visibleBridgeConnectors.length > 0 && !bridgeHasError,
      primaryAction: bridgePrimaryAction,
    },
    {
      id: "doctor",
      index: "07",
      title: "Kimi Doctor",
      actionLabel: doctorSummary.label,
      statusTone: doctorSummary.tone,
      complete: Boolean(kimiDoctorResult?.succeeded) && !showStartupFailureDiagnostics,
      primaryAction: null,
    },
    {
      id: "logs",
      index: "08",
      title: "日志",
      actionLabel: "app.log · backend.log · bridge.log",
      statusTone: "neutral",
      complete: true,
      primaryAction: logsPrimaryAction,
    },
  ];
  const unifiedRailGroups = useMemo<UnifiedRailGroup[]>(() => {
    const topLevelItems: UnifiedRailItem[] = controlSections.map((section) => ({
      id: section.id,
      label: section.label,
      icon: section.icon,
      active:
        section.id === "onboarding"
          ? assistantSettingsSectionActive
          : activeControlSection === section.id,
      onSelect: () => {
        void handleSelectControlSection(section.id);
      },
    }));

    return [
      {
        id: "sections",
        label: "页面",
        items: topLevelItems,
      },
    ];
  }, [
    activeControlSection,
    handleSelectControlSection,
    assistantSettingsSectionActive,
  ]);

  function renderOnboardingSection() {
    function renderStepDetail(stepId: OnboardingCardId) {
      if (stepId === "app_update") {
        return (
          <div className="cc-settings-detail-stack">
            <div className="cc-settings-live-row" aria-live="polite">
              {appUpdateActionLabel}
            </div>
            <dl className="cc-app-update-meta">
              <div>
                <dt>当前版本</dt>
                <dd>{appUpdateInfo?.currentVersion ? `v${appUpdateInfo.currentVersion}` : "检测后显示"}</dd>
              </div>
              {appUpdateInfo?.version ? (
                <div>
                  <dt>最新版本</dt>
                  <dd>v{appUpdateInfo.version}</dd>
                </div>
              ) : null}
            </dl>
            {appUpdateInfo?.body ? (
              <pre className="cc-app-update-notes">{appUpdateInfo.body}</pre>
            ) : null}
            {appUpdateError ? <p className="cc-config-error">{appUpdateError}</p> : null}
            <p className="hint">安装时小助手将退出，下载或校验失败不会改变当前安装。</p>
            <div className="cc-step-secondary-actions">
              <Button
                type="button"
                variant="ghost"
                icon={<RefreshCcw size={15} />}
                className="cc-action-btn"
                onClick={() => void onCheckAppUpdate()}
                disabled={!appUpdateSupported || appUpdateBusy}
              >
                重新检测
              </Button>
              {appUpdateAvailable ? appUpdatePrimaryAction : null}
            </div>
          </div>
        );
      }
      if (stepId === "install") {
        return (
          <div className="cc-onboarding-install-stack">
            {kimiCodeUpdateInfo ? (
              <dl className="cc-app-update-meta">
                <div>
                  <dt>当前版本</dt>
                  <dd>v{kimiCodeUpdateInfo.currentVersion}</dd>
                </div>
                <div>
                  <dt>最新版本</dt>
                  <dd>v{kimiCodeUpdateInfo.latestVersion}</dd>
                </div>
              </dl>
            ) : null}
            {kimiCodeUpdateError ? (
              <p className="cc-config-error">{kimiCodeUpdateError}</p>
            ) : null}
            <div className="cc-step-secondary-actions">{installSecondaryAction}</div>
            {externalGuidedInstall ? (
              <div className="cc-config-grid">
                <p className="hint">
                  macOS 版不会在后台执行远程安装脚本。请复制官方命令到 Terminal，完成后回到这里重新检测。
                </p>
                <pre className="cc-install-command-code">
                  curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
                </pre>
                <div className="cc-step-secondary-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    className="cc-action-btn"
                    onClick={() =>
                      copyText("curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash")
                    }
                  >
                    复制安装命令
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="cc-action-btn"
                    onClick={() => copyText("kimi upgrade")}
                  >
                    复制升级命令
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="cc-action-btn"
                    onClick={() =>
                      void onOpenExternalUrl(
                        "https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/guides/getting-started.md#installation",
                      )
                    }
                  >
                    打开官方文档
                  </Button>
                </div>
                <p className="hint">
                  默认原生安装位置为 ~/.kimi-code/bin/kimi；也可以通过“选择 Kimi 路径”使用其他受信任的安装。
                </p>
                <div className="cc-step-secondary-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    className="cc-action-btn"
                    onClick={() => void onPickKimiPath()}
                  >
                    选择 Kimi 路径
                  </Button>
                  <Button
                    type="button"
                    className="cc-action-btn"
                    onClick={() => void onSavePathAndRetry()}
                    disabled={!kimiPathInput.trim() || actionBusy}
                  >
                    保存并重试
                  </Button>
                </div>
              </div>
            ) : (
              <InstallFlowTaskContent
                session={installSessionSnapshot}
                probe={installProbe}
                probeBusy={installProbeBusy}
                probeMessage={installMessage}
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
                onStartTask={handleStartOnboardingInstallTask}
                onRestartBackend={onRetry}
                onPickKimiPath={onPickKimiPath}
                onSavePathAndRetry={onSavePathAndRetry}
                restartBusy={actionBusy}
              />
            )}
          </div>
        );
      }
      if (stepId === "context_menu") {
        return renderContextMenuStepContent();
      }
      if (stepId === "auth") {
        return (
          <KimiCodeAccessTaskContent
            authMode={authMode}
            activeProvider={activeProvider}
            providerApiConfigured={providerApiConfigured}
            kimiLoginHealth={kimiLoginHealth}
            providerApiHealth={providerApiHealth}
            onOpenKimiCodeSettings={onClose}
          />
        );
      }
      if (stepId === "bridge") {
        return renderBridgeStepContent();
      }
      if (stepId === "doctor") {
        const startupTraceRows = diagnostics?.startupTrace ?? [];
        return (
          <div className="cc-settings-detail-stack cc-doctor-detail">
            {startupFailureMessage ? (
              <p className="cc-settings-error" role="alert">
                {startupFailureMessage}
              </p>
            ) : null}
            <div className="cc-settings-more-actions">
              <Button
                type="button"
                className="cc-action-btn"
                onClick={() => void onRunKimiDoctor()}
                disabled={kimiDoctorBusy}
              >
                {kimiDoctorBusy ? "正在运行" : "运行 Kimi Doctor"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="cc-action-btn"
                onClick={() => void onRefreshDiagnostics()}
                disabled={diagnosticsBusy}
              >
                {diagnosticsBusy ? "正在刷新" : "刷新诊断"}
              </Button>
              {kimiDoctorResult ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="cc-action-btn"
                  onClick={() => copyText(formatKimiDoctorOutput(kimiDoctorResult))}
                >
                  复制结果
                </Button>
              ) : null}
            </div>
            <table className="cc-image-table cc-doctor-trace-table">
              <thead>
                <tr><th>#</th><th>阶段</th><th>状态</th></tr>
              </thead>
              <tbody>
                {(startupTraceRows.length > 0 ? startupTraceRows : ["暂无启动轨迹"]).map((line, index) => (
                  <tr key={`${index}-${line}`}>
                    <td>{String(index + 1).padStart(2, "0")}</td>
                    <td>{line}</td>
                    <td>{index === startupTraceRows.length - 1 && showStartupFailureDiagnostics ? "需要关注" : "ok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {kimiDoctorResult ? (
              <div className="cc-image-code-card">
                <div className="cc-image-code-toolbar"><span>Kimi Doctor</span></div>
                <pre>{formatKimiDoctorOutput(kimiDoctorResult)}</pre>
              </div>
            ) : null}
          </div>
        );
      }
      if (stepId === "logs") {
        return renderLogsStepContent();
      }
      return renderWorkDirStepContent();
    }

    return (
      <section
        id={focusDomId("onboarding")}
        className={`cc-image-detail-page cc-settings-page ${activeFocusId === "onboarding" ? "is-focus" : ""}`}
      >
        <section className="cc-onboarding-steps cc-settings-bars">
          <ul className="cc-image-row-list">
            {onboardingSteps.map((step) => {
              const expanded = expandedOnboardingCard === step.id;
              return (
                <li
                  key={step.id}
                  id={focusDomId(`onboarding:${step.id}`)}
                  className={`cc-image-row cc-settings-bar ${expanded ? "is-expanded" : ""} ${activeFocusId === `onboarding:${step.id}` ? "is-focus" : ""}`}
                >
                  <div className="cc-settings-bar-head">
                    <button
                      type="button"
                      className="cc-settings-bar-toggle"
                      onClick={() => {
                        const next = expanded ? null : step.id;
                        setExpandedOnboardingCard(next);
                        if (next === "auth") void onRefreshOnboarding();
                        if (next === "doctor") void onRefreshDiagnostics();
                        if (next === "logs") {
                          void Promise.all([onRefreshDiagnostics(), onRefreshBridgeLogTail()]);
                        }
                      }}
                      aria-expanded={expanded}
                      aria-controls={`cc-settings-detail-${step.id}`}
                    >
                      <div>
                        <div className="cc-image-row-title">
                          <span className={`cc-dot ${step.statusTone}`} />
                          {step.title}
                        </div>
                        <div className="cc-image-row-desc">{step.actionLabel}</div>
                      </div>
                      <ChevronRight
                        size={16}
                        className={`cc-settings-bar-chevron ${expanded ? "is-expanded" : ""}`}
                      />
                    </button>
                    <div className="cc-image-row-actions">
                      {step.primaryAction}
                    </div>
                  </div>
                  {expanded ? (
                    <div id={`cc-settings-detail-${step.id}`} className="cc-settings-bar-detail">{renderStepDetail(step.id)}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </section>
    );
  }

  function renderInlineConnectorOnboarding(connector: BridgeConnectorConfig) {
    const session = connector.platform === "feishu"
      ? feishuConnectorOnboarding?.connectorId === connector.id ? feishuConnectorOnboarding : null
      : weixinConnectorOnboarding?.connectorId === connector.id ? weixinConnectorOnboarding : null;
    if (!session) return null;
    const isFeishu = connector.platform === "feishu";
    const active = isFeishu
      ? isFeishuOnboardingActive(session as NonNullable<typeof feishuConnectorOnboarding>)
      : isWeixinOnboardingActive(session as NonNullable<typeof weixinConnectorOnboarding>);
    const stateLabel = isFeishu
      ? formatFeishuOnboardingStateLabel(session.state)
      : formatWeixinOnboardingStateLabel(session.state);
    const stateTone = isFeishu
      ? formatFeishuOnboardingTone(session.state)
      : formatWeixinOnboardingTone(session.state);

    return (
      <div className="cc-inline-onboarding" aria-live="polite">
        <div className="cc-inline-onboarding-head">
          <ControlCenterStatusBadge tone={stateTone}>{stateLabel}</ControlCenterStatusBadge>
          <div className="cc-image-row-actions">
            {session.verificationUrl ? (
              <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => void onOpenExternalUrl(session.verificationUrl ?? "")}>浏览器打开</Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="cc-action-btn"
              onClick={() => void (isFeishu
                ? onRefreshFeishuConnectorOnboardingStatus(session.sessionId)
                : onRefreshWeixinConnectorOnboardingStatus(session.sessionId))}
            >
              刷新
            </Button>
            {active ? (
              <Button
                type="button"
                variant="ghost"
                className="cc-action-btn danger"
                onClick={() => void (isFeishu
                  ? onCancelFeishuConnectorOnboarding(session.sessionId)
                  : onCancelWeixinConnectorOnboarding(session.sessionId))}
              >
                取消扫码
              </Button>
            ) : null}
          </div>
        </div>
        {session.qrSvg ? (
          <div className="cc-inline-onboarding-qr" dangerouslySetInnerHTML={{ __html: session.qrSvg }} />
        ) : null}
        {session.detailMessage ? <p className="hint">{session.detailMessage}</p> : null}
        {session.errorMessage ? <p className="cc-settings-error">{session.errorMessage}</p> : null}
      </div>
    );
  }

  function renderBridgeStepContent() {
    return (
      <div className="cc-settings-detail-stack">
        <div className="cc-settings-live-row" aria-live="polite">
          <span>{bridgeBusy ? "正在更新外部 IM 通道" : `通道${isBridgeRunning ? "正在运行" : "已停止"}`}</span>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCw size={15} />}
            className="cc-action-btn"
            onClick={() => void Promise.all([onRefreshBridgeSettings(), onRefreshBridgeStatus(), onRefreshBridgeSecretsMask()])}
            disabled={bridgeBusy}
          >
            刷新
          </Button>
        </div>
        {bridgeHasError ? (
          <p className="cc-settings-error" role="alert">
            {bridgeStatus.lastError || bridgeRecentErrors[0] || "外部 IM 通道运行异常，请检查机器人配置。"}
          </p>
        ) : null}
        <div className="cc-settings-more-actions">
          <Button
            type="button"
            variant="outline"
            className="cc-action-btn"
            onClick={() => void onRunBridgePrimaryAction(isBridgeRunning ? "apply_restart" : "start")}
            disabled={bridgeBusy || visibleBridgeConnectors.length === 0}
          >
            {isBridgeRunning ? "应用并重启" : "启动通道"}
          </Button>
          <div className="cc-bridge-create-menu" ref={bridgeCreateMenuRef}>
            <Button
              type="button"
              variant="ghost"
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
                {(["weixin", "feishu"] as BridgePlatform[]).map((platform) => (
                  <button key={platform} type="button" className="cc-bridge-create-menu-item" onClick={() => handleCreateBridgeConnector(platform)} disabled={bridgeBusy} role="menuitem">
                    <strong>{bridgePlatformLabel(platform)}</strong>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        {visibleBridgeConnectors.length ? (
          <ul className="cc-settings-connector-list">
            {visibleBridgeConnectors.map((connector) => {
              const connectorStatus = bridgeStatus.connectors.find((item) => item.connectorId === connector.id) ?? null;
              const connectorSecrets = bridgeSecretsMask.connectors.find((item) => item.connectorId === connector.id) ?? null;
              const configured = hasBridgeConnectorSecretsConfigured(connector, connectorSecrets);
              const recentError = findBridgeConnectorRecentError(connector, connectorStatus, bridgeRecentErrors);
              const pending = bridgeOverviewPendingConnectorId === connector.id;
              const enabled = pending ? (bridgeOverviewPendingEnabled[connector.id] ?? connector.enabled) : connector.enabled;
              return (
                <li key={connector.id} className="cc-settings-connector-row">
                  <div className="cc-settings-connector-copy">
                    <strong>{connector.label}</strong>
                    <span>{bridgePlatformLabel(connector.platform)} · {configured ? "凭据已配置" : "待配置凭据"}{recentError ? ` · ${recentError}` : ""}</span>
                  </div>
                  <div className="cc-image-row-actions">
                    <ControlCenterStatusBadge tone={formatBridgeConnectorStateTone(connectorStatus?.state ?? "idle")}>
                      {formatBridgeConnectorStateLabel(connectorStatus?.state ?? "idle")}
                    </ControlCenterStatusBadge>
                    <Button type="button" variant="outline" className="cc-action-btn" onClick={() => openBridgeConnectorSecretsModal(connector.id)} disabled={bridgeBusy}>
                      连接与凭据
                    </Button>
                    <Button type="button" variant="outline" className="cc-action-btn" onClick={() => void handleStartConnectorOnboarding(connector)} disabled={bridgeBusy}>
                      扫码连接
                    </Button>
                    <ControlCenterToggleField label="启用" checked={enabled} onChange={(checked) => void handleImmediateBridgeConnectorToggle(connector.id, checked)} disabled={bridgeBusy || pending} busy={pending} />
                    {configured ? <ControlCenterActionMenu disabled={bridgeBusy} items={[{ label: "运行面板", onSelect: () => openBridgeConnectorRuntimeModal(connector.id) }]} /> : null}
                  </div>
                  {renderInlineConnectorOnboarding(connector)}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">还没有机器人。新建一个机器人即可连接外部 IM。</p>
        )}
        <details className="cc-settings-more">
          <summary>更多选项</summary>
          <div className="cc-settings-more-actions">
            <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => void onOpenLogs()}>打开日志目录</Button>
            {isBridgeRunning ? (
              <Button type="button" variant="ghost" className="cc-action-btn danger" onClick={() => void onStopBridge()} disabled={bridgeBusy}>停止通道</Button>
            ) : null}
          </div>
        </details>
      </div>
    );
  }

  function renderLogsStepContent() {
    return (
      <div className="cc-settings-detail-stack">
        <div className="cc-settings-live-row" aria-live="polite">
          <span>{diagnosticsBusy ? "正在刷新日志" : "显示最近日志"}</span>
          <Button
            type="button"
            variant="ghost"
            icon={<RefreshCw size={15} />}
            className="cc-action-btn"
            onClick={() => void Promise.all([onRefreshDiagnostics(), onRefreshBridgeLogTail()])}
            disabled={diagnosticsBusy}
          >
            刷新
          </Button>
        </div>
        <div className="cc-image-code-grid">
          {[
            ["app.log", appLogText],
            ["backend.log", backendLogText],
            ["bridge.log", bridgeLogText],
          ].map(([label, content]) => (
            <div key={label} className="cc-image-code-card">
              <div className="cc-image-code-toolbar">
                <span>{label}</span>
                <Button type="button" variant="ghost" className="cc-action-btn" onClick={() => copyText(content)}>复制</Button>
              </div>
              <pre>{content}</pre>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderSkillCenterSection() {
    const selectedInstalledSkill =
      selectedSkillDetail?.skill ??
      installedSkills.find((skill) => skill.id === selectedSkillId) ??
      null;
    const selectedDiscoveredRecord =
      selectedInstalledSkill
        ? null
        : selectedDiscoveryDetail?.record ??
          skillDiscoverySnapshot?.records.find(
            (record) => record.discoveryId === selectedDiscoveryId,
          ) ??
          null;
    const showSkillDetailHeader =
      skillCenterSection === "manage" &&
      Boolean(selectedInstalledSkill || selectedDiscoveredRecord);
    const selectedInstalledState = selectedInstalledSkill
      ? {
          userGlobalApplied: globalSkillProjections.some(
            (projection) =>
              projection.skillId === selectedInstalledSkill.id &&
              projection.scope === "user_global_kimi",
          ),
          kimiCodeHomeApplied: globalSkillProjections.some(
            (projection) =>
              projection.skillId === selectedInstalledSkill.id &&
              projection.scope === "kimi_code_home",
          ),
          sessionApplied: activeSessionSkillState.appliedSkillIds.includes(
            selectedInstalledSkill.id,
          ),
        }
      : null;
    const selectedInstalledPinned =
      selectedInstalledSkill && workspaceSkillProfile
        ? workspaceSkillProfile.pinnedSkillIds.includes(selectedInstalledSkill.id)
        : false;
    const skillCenterTitle = showSkillDetailHeader
      ? (selectedInstalledSkill?.name ?? selectedDiscoveredRecord?.name ?? "Skill")
      : "Skill 中心";
    const skillCenterActions = showSkillDetailHeader ? (
      <div className="skill-center-header-actions skill-center-detail-top-actions">
        {selectedInstalledSkill && selectedInstalledState ? (
          <>
            <ControlCenterStatusBadge
              tone={selectedInstalledSkill.trusted ? "success" : "warning"}
            >
              {selectedInstalledSkill.trusted ? "已信任" : "未信任"}
            </ControlCenterStatusBadge>
            <Button
              type="button"
              onClick={() => onApplySkill(selectedInstalledSkill.id, "session_kimi")}
              disabled={
                skillCenterBusy ||
                !selectedInstalledSkill.trusted ||
                selectedInstalledState.sessionApplied
              }
            >
              投影到当前工作区 .agents
            </Button>
            <ControlCenterActionMenu
              label={`${selectedInstalledSkill.name} 操作`}
              disabled={skillCenterBusy}
              items={[
                {
                  label: "投影到用户全局 ~/.agents",
                  disabled:
                    !selectedInstalledSkill.trusted ||
                    selectedInstalledState.userGlobalApplied,
                  onSelect: () =>
                    onApplySkill(selectedInstalledSkill.id, "user_global_kimi"),
                },
                {
                  label: "投影到 KIMI_CODE_HOME",
                  disabled:
                    !selectedInstalledSkill.trusted ||
                    selectedInstalledState.kimiCodeHomeApplied,
                  onSelect: () =>
                    onApplySkill(selectedInstalledSkill.id, "kimi_code_home"),
                },
                {
                  label: selectedInstalledPinned ? "取消固定" : "固定到工作区",
                  onSelect: () =>
                    onSetWorkspaceSkillPin(selectedInstalledSkill.id, !selectedInstalledPinned),
                },
                {
                  label: "更新技能",
                  onSelect: () => onUpdateSkill(selectedInstalledSkill.id),
                },
                {
                  label: selectedInstalledSkill.trusted ? "取消信任" : "信任技能",
                  icon: selectedInstalledSkill.trusted ? (
                    <ShieldOff size={14} />
                  ) : (
                    <Shield size={14} />
                  ),
                  onSelect: () =>
                    onSetSkillTrust(selectedInstalledSkill.id, !selectedInstalledSkill.trusted),
                },
                ...(selectedInstalledState.userGlobalApplied
                  ? [
                      {
                        label: "从 ~/.agents 移除",
                        onSelect: () =>
                          onRemoveSkill(selectedInstalledSkill.id, "user_global_kimi"),
                      },
                    ]
                  : []),
                ...(selectedInstalledState.kimiCodeHomeApplied
                  ? [
                      {
                        label: "从 KIMI_CODE_HOME 移除",
                        onSelect: () =>
                          onRemoveSkill(selectedInstalledSkill.id, "kimi_code_home"),
                      },
                    ]
                  : []),
                ...(selectedInstalledState.sessionApplied
                  ? [
                      {
                        label: "从当前工作区移除",
                        onSelect: () =>
                          onRemoveSkill(selectedInstalledSkill.id, "session_kimi"),
                      },
                    ]
                  : []),
                {
                  label: "卸载技能",
                  tone: "danger",
                  onSelect: () => onUninstallSkill(selectedInstalledSkill.id),
                },
              ]}
            />
          </>
        ) : null}
        {selectedDiscoveredRecord ? (
          <>
            <ControlCenterStatusBadge tone="warning">待导入</ControlCenterStatusBadge>
            {selectedDiscoveredRecord.hasScripts ? (
              <ControlCenterStatusBadge tone="neutral">包含 scripts/</ControlCenterStatusBadge>
            ) : null}
            <Button
              type="button"
              onClick={() => onImportDiscoveredSkill(selectedDiscoveredRecord.discoveryId)}
              disabled={skillCenterBusy}
            >
              导入到受管 Skill
            </Button>
          </>
        ) : null}
      </div>
    ) : skillCenterSection === "manage" ? (
        <div className="skill-center-header-actions">
          <ControlCenterActionMenu
            label="添加 Skill"
            triggerContent="添加 Skill"
            triggerIcon={<Plus size={14} />}
            disabled={skillCenterBusy}
            items={[
              {
                label: "从 Git 安装",
                description: "输入仓库地址安装 Skill",
                onSelect: () => void onOpenTask("skill_git_import"),
              },
              {
                label: "导入本地 Skill",
                description: "从本机目录选择 Skill",
                onSelect: () => void onOpenTask("skill_import"),
              },
            ]}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="cc-action-btn"
            onClick={() => onSkillCenterSectionChange("workspace_insights")}
            disabled={skillCenterBusy}
          >
            工作区目标
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            icon={<RefreshCcw size={14} />}
            onClick={() => {
              void (async () => {
                await onRefreshSkillCenterState();
                await onRefreshSkillDiscoveryState();
              })();
            }}
            disabled={skillCenterBusy}
            aria-label="刷新 Skill 中心"
            title="刷新 Skill 中心"
          />
        </div>
      ) : (
        <div className="skill-center-header-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="cc-action-btn"
            onClick={() => onSkillCenterSectionChange("manage")}
            disabled={skillCenterBusy}
          >
            返回技能库
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            icon={<RefreshCcw size={14} />}
            onClick={() => {
              void onRefreshWorkspaceSkillManagementState();
            }}
            disabled={skillCenterBusy}
            aria-label="刷新工作区目标"
            title="刷新工作区目标"
          />
        </div>
      );

    return (
      <section className="cc-image-detail-page skill-center-page">
        <div
          id={focusDomId("skill_center")}
          className={`cc-image-detail-top ${
            showSkillDetailHeader ? "skill-center-detail-top" : ""
          } ${activeFocusId === "skill_center" ? "is-focus" : ""}`}
        >
          <div className="skill-center-top-title">
            {showSkillDetailHeader ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<ChevronLeft size={14} />}
                onClick={onClearSkillSelection}
                disabled={skillCenterBusy}
              >
                返回
              </Button>
            ) : null}
            <h1>{skillCenterTitle}</h1>
          </div>
          <div className="cc-image-top-controls">{skillCenterActions}</div>
        </div>
        <div
          id={focusDomId(activeFocusId?.startsWith("skill-") ? activeFocusId : "skill_center:list")}
          className={`skill-center-page-surface ${activeFocusId?.startsWith("skill-") ? "is-focus" : ""}`}
        >
          <div className="cc-skill-center-body">
            <SkillCenterPanel
              surface="page"
              busy={skillCenterBusy}
              actionError={actionError}
              onRetryActionError={() => {
                void (async () => {
                  if (skillCenterSection === "workspace_insights") {
                    await onRefreshWorkspaceSkillManagementState();
                    return;
                  }
                  await onRefreshSkillCenterState();
                  if (skillCenterSection === "manage") {
                    await onRefreshSkillDiscoveryState();
                  }
                })();
              }}
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
            onBackToDirectory={onClearSkillSelection}
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
            onFilterChange={onSkillCenterFilterChange}
            detailOnly
            activeFocusId={activeFocusId}
          />
          </div>
        </div>
      </section>
    );
  }

  function closeBridgeConnectorSecretsTask() {
    const hasPendingDraft = Object.values(bridgeConnectorSecretDraft).some((value) => value.trim());
    if (hasPendingDraft && !window.confirm("当前凭据草稿尚未保存，确定返回上一层吗？")) {
      return;
    }
    setBridgeConnectorSecretDraft(createEmptyBridgeConnectorSecretDraft());
    closeSettingsTask();
  }

  function renderActiveTask() {
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
          onBack={closeSettingsTask}
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

  function renderUnifiedRailFooter() {
    const installConsoleText =
      installSessionSnapshot.logs
        .slice(-6)
        .map((chunk) => `[${chunk.stream}] ${chunk.text}`)
        .join("\n")
        .trim() ||
      installSessionSnapshot.message?.trim() ||
      installMessage.trim() ||
      "还没有安装输出。";
    return (
      <div className="cc-unified-rail-footer-stack">
        {assistantSettingsSectionActive && expandedOnboardingCard === "install" ? (
          <div className="cc-rail-install-terminal">
            <div className="cc-rail-install-terminal-head">
              <strong>内置终端</strong>
              <span>{installSessionSnapshot.status}</span>
            </div>
            <pre>{installConsoleText}</pre>
          </div>
        ) : null}
        <WorkspaceEntryButton
          status={status}
          onboarding={onboarding}
          actionBusy={actionBusy}
          onEnter={onCompleteOnboarding}
        />
        <Button
          type="button"
          variant="outline"
          className="cc-rail-restart-btn"
          icon={<RefreshCcw size={15} />}
          onClick={() => void onRetry()}
          disabled={actionBusy}
        >
          {status?.runtimeOwnership === "reused_external" ? "重新连接后端" : "重启后端"}
        </Button>
      </div>
    );
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
        footer={renderUnifiedRailFooter()}
      />

      <div className="cc-control-stage cc-control-stage-no-topbar">
        <div className="cc-layout cc-layout-dashboard">
          <div
            className={`cc-main ${
              isOnboardingSection ? "cc-main-onboarding" : ""
            }`}
          >
            {activeTask ? (
              renderActiveTask()
            ) : (
              <>
                {activeControlSection === "workspace_hub" ? (
                  <WorkspaceHubPanel
                    onOpenWorkspace={onOpenFolder}
                    onOpenSchedule={() => setActiveControlSection("schedule")}
                    onOpenSkill={(skillId) => {
                      onSkillCenterSectionChange("manage");
                      setActiveControlSection("skill_center");
                      void onSelectSkill(skillId);
                    }}
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
                {assistantSettingsSectionActive ? (
                  renderOnboardingSection()
                ) : null}
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

export function WorkspaceEntryButton({
  status,
  onboarding,
  actionBusy,
  onEnter,
}: {
  status: Pick<AppStatus, "state"> | null;
  onboarding: Pick<OnboardingStatus, "shouldShowOnboarding"> | null;
  actionBusy: boolean;
  onEnter: () => Promise<void>;
}) {
  if (status?.state !== "running" || !onboarding?.shouldShowOnboarding) {
    return null;
  }

  return (
    <Button
      type="button"
      icon={<Check size={15} />}
      onClick={() => void onEnter()}
      disabled={actionBusy}
    >
      进入工作区
    </Button>
  );
}
