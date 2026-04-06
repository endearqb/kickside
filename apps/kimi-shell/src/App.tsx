import { useEffect, useState } from "react";
import { Check, Settings } from "lucide-react";
import { useShellController } from "@/app/useShellController";
import {
  formatBackendState,
  formatKimiLoginHealthSource,
  formatKimiLoginHealthState,
} from "@/app/types";
import { IconButton } from "@/components/common/IconButton";
import { ControlCenterView } from "@/features/control-center/ControlCenterView";
import { LoadingView } from "@/features/loading/LoadingView";
import { ShellTitlebar } from "@/features/window/ShellTitlebar";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import { pickRandomAgentTip, type AgentTip } from "@/lib/agentTips";
import "./App.css";
import "./components/control-center/control-center.css";

function formatLoginCheckTimestamp(value?: number) {
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

function App() {
  const shell = useShellController();
  const [shutdownTip, setShutdownTip] = useState<AgentTip | null>(null);
  const [rememberMainCloseDecision, setRememberMainCloseDecision] = useState(false);
  const bridgeState = shell.bridgeStatus.state;
  const bridgeStateLabel =
    bridgeState === "running"
      ? "IM Running"
      : bridgeState === "starting" || bridgeState === "stopping"
        ? "IM Working"
        : bridgeState === "degraded"
          ? "IM Error"
          : bridgeState === "crashed"
            ? "IM Error"
            : "IM Pending";
  const bridgeStateTone =
    bridgeState === "running"
      ? "ready"
      : bridgeState === "starting" || bridgeState === "stopping"
        ? "progress"
        : bridgeState === "degraded" || bridgeState === "crashed"
          ? "error"
          : "todo";
  const bridgeStartable = bridgeState === "stopped" || bridgeState === "crashed";
  const statusChipClass =
    shell.uiBackendState === "running"
      ? "saved"
      : shell.uiBackendState === "crashed"
        ? "error"
        : "unsaved";
  const kimiLoginBannerVisible = Boolean(
    shell.status?.authMode === "kimi_login" &&
      shell.status.kimiLoginHealth?.needsAttention &&
      shell.screen === "workspace" &&
      !shell.controlCenterModalOpen,
  );
  const kimiLoginBannerTitle =
    shell.status?.kimiLoginHealth.state === "error"
      ? "Kimi 登录检测异常"
      : "Kimi 登录需要重新验证";
  const kimiLoginBannerSummary =
    shell.status?.kimiLoginHealth.message?.trim() || "最近一次检测表明当前登录状态不可用。";
  const kimiLoginBannerMeta = [
    `状态：${formatKimiLoginHealthState(shell.status?.kimiLoginHealth.state)}`,
    `来源：${formatKimiLoginHealthSource(shell.status?.kimiLoginHealth.source)}`,
    `时间：${formatLoginCheckTimestamp(shell.status?.kimiLoginHealth.checkedAtMs)}`,
    shell.status?.kimiLoginHealth.exitCode != null
      ? `退出码：${shell.status.kimiLoginHealth.exitCode}`
      : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  useEffect(() => {
    if (!shell.controlCenterModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        shell.requestCloseControlCenter();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shell.controlCenterModalOpen, shell.requestCloseControlCenter, shell.activeControlTask]);

  useEffect(() => {
    if (shell.shutdownProgress) {
      setShutdownTip((current) => current ?? pickRandomAgentTip());
      return;
    }

    setShutdownTip(null);
  }, [shell.shutdownProgress]);

  useEffect(() => {
    if (!shell.mainWindowCloseDecisionRequest) {
      setRememberMainCloseDecision(false);
    }
  }, [shell.mainWindowCloseDecisionRequest]);

  const controlCenterProps = {
    status: shell.status,
    diagnostics: shell.diagnostics,
    onboarding: shell.onboarding,
    contextMenuStatus: shell.contextMenuStatus,
    activeControlSection: shell.activeControlSection,
    activeRuntimePanel: shell.activeRuntimePanel,
    stepCompletion: shell.stepCompletion,
    actionBusy: shell.actionBusy,
    diagnosticsBusy: shell.diagnosticsBusy,
    contextMenuBusy: shell.contextMenuBusy,
    loginProbeBusy: shell.loginProbeBusy,
    mainWindowCloseBehavior: shell.mainWindowCloseBehavior,
    bridgeSettings: shell.bridgeSettings,
    bridgeStatus: shell.bridgeStatus,
    bridgeOnboardingDraft: shell.bridgeOnboardingDraft,
    bridgeOnboardingDirty: shell.bridgeOnboardingDirty,
    bridgeOnboardingValidation: shell.bridgeOnboardingValidation,
    bridgeSettingsDirty: shell.bridgeSettingsDirty,
    bridgePersistedConnectorIds: shell.bridgePersistedConnectorIds,
    bridgeSessions: shell.bridgeSessions,
    bridgeBindings: shell.bridgeBindings,
    bridgeApprovals: shell.bridgeApprovals,
    bridgeLogTail: shell.bridgeLogTail,
    bridgeRecentErrors: shell.bridgeRecentErrors,
    bridgeSecretsMask: shell.bridgeSecretsMask,
    feishuConnectorOnboarding: shell.feishuConnectorOnboarding,
    feishuConnectorOnboardingBusy: shell.feishuConnectorOnboardingBusy,
    weixinConnectorOnboarding: shell.weixinConnectorOnboarding,
    weixinConnectorOnboardingBusy: shell.weixinConnectorOnboardingBusy,
    bridgeBusy: shell.bridgeBusy,
    installedSkills: shell.installedSkills,
    skillCenterBusy: shell.skillCenterBusy,
    skillCenterSearch: shell.skillCenterSearch,
    skillCenterFilter: shell.skillCenterFilter,
    skillCenterSection: shell.skillCenterSection,
    skillCenterGitRepoUrl: shell.skillCenterGitRepoUrl,
    skillCenterGitRef: shell.skillCenterGitRef,
    selectedSkillId: shell.selectedSkillId,
    selectedSkillDetail: shell.selectedSkillDetail,
    globalSkillProjections: shell.globalSkillProjections,
    activeSessionSkillState: shell.activeSessionSkillState,
    workspaceSkillProfile: shell.workspaceSkillProfile,
    workspaceRecentSkillIds: shell.workspaceRecentSkillIds,
    workspaceSkillRecommendations: shell.workspaceSkillRecommendations,
    workspaceSkillRestoreResults: shell.workspaceSkillRestoreResults,
    skillDiscoverySnapshot: shell.skillDiscoverySnapshot,
    selectedDiscoveryId: shell.selectedDiscoveryId,
    selectedDiscoveryDetail: shell.selectedDiscoveryDetail,
    workspaceSkillTargets: shell.workspaceSkillTargets,
    selectedWorkspaceSkillTargetId: shell.selectedWorkspaceSkillTargetId,
    workspaceSkillInventory: shell.workspaceSkillInventory,
    selectedWorkspaceSkillContainerKind: shell.selectedWorkspaceSkillContainerKind,
    kimiPathInput: shell.kimiPathInput,
    workDirInput: shell.workDirInput,
    setActiveControlSection: shell.setActiveControlSection,
    setActiveRuntimePanel: shell.setActiveRuntimePanel,
    onWorkDirInputChange: shell.setWorkDirInput,
    configCenterView: shell.configCenterView,
    configCenterDraft: shell.configCenterDraft,
    configCenterBusy: shell.configCenterBusy,
    configCenterDirty: shell.configCenterDirty,
    installProbe: shell.installProbe,
    installSource: shell.installSource,
    installSettings: shell.installSettings,
    installSettingsBusy: shell.installSettingsBusy,
    powershellPreflight: shell.powershellPreflight,
    installFlowCatalog: shell.installFlowCatalog,
    installSessionSnapshot: shell.installSessionSnapshot,
    activeTask: shell.activeControlTask,
    activeTaskPayload: shell.activeControlTaskPayload,
    installBusy: shell.installBusy,
    installAction: shell.installAction,
    installMessage: shell.installMessage,
    onClose: shell.dismissControlCenter,
    onRefreshCoreState: shell.refreshCoreState,
    onRefreshDiagnostics: shell.refreshDiagnostics,
    onRefreshContextMenuStatus: shell.refreshContextMenuStatus,
    onRefreshBridgeSettings: shell.refreshBridgeSettings,
    onRefreshBridgeStatus: shell.refreshBridgeStatus,
    onRefreshBridgeSessions: shell.refreshBridgeSessions,
    onRefreshBridgeBindings: shell.refreshBridgeBindings,
    onRefreshBridgeApprovals: shell.refreshBridgeApprovals,
    onRefreshBridgeLogTail: shell.refreshBridgeLogTail,
    onRefreshBridgeSecretsMask: shell.refreshBridgeSecretsMask,
    onSaveBridgeConnectorSecrets: shell.handleSaveBridgeConnectorSecrets,
    onStartFeishuConnectorOnboarding: shell.handleStartFeishuConnectorOnboarding,
    onRefreshFeishuConnectorOnboardingStatus:
      shell.handleRefreshFeishuConnectorOnboardingStatus,
    onCancelFeishuConnectorOnboarding: shell.handleCancelFeishuConnectorOnboarding,
    onStartWeixinConnectorOnboarding: shell.handleStartWeixinConnectorOnboarding,
    onRefreshWeixinConnectorOnboardingStatus:
      shell.handleRefreshWeixinConnectorOnboardingStatus,
    onCancelWeixinConnectorOnboarding: shell.handleCancelWeixinConnectorOnboarding,
    onRefreshSkillCenterState: () => shell.refreshSkillCenterState(shell.selectedSkillId),
    onRefreshSkillDiscoveryState: () =>
      shell.refreshSkillDiscoveryState(shell.selectedDiscoveryId),
    onRefreshWorkspaceSkillManagementState: () =>
      shell.refreshWorkspaceSkillManagementState(shell.selectedWorkspaceSkillTargetId),
    onRefreshInstallProbe: shell.refreshInstallProbe,
    onRefreshOnboarding: shell.refreshOnboarding,
    onRetry: shell.handleRuntimeOnlyRetry,
    onOpenLogs: shell.handleOpenLogs,
    onOpenFolder: shell.handleOpenFolder,
    onOpenKimiConfigDir: shell.handleOpenKimiConfigDir,
    onPickKimiPath: shell.handlePickKimiPath,
    onSavePathAndRetry: shell.handleSavePathAndRetry,
    onEnableContextMenu: shell.handleEnableContextMenu,
    onDisableContextMenu: shell.handleDisableContextMenu,
    onProbeLogin: shell.handleProbeLogin,
    onPickWorkDir: shell.handlePickWorkDir,
    onPickBridgeConnectorDefaultWorkDir: shell.handlePickBridgeConnectorDefaultWorkDir,
    onSaveWorkDirAndRestart: shell.handleSaveWorkDirAndRestart,
    onClearWorkDir: shell.handleClearWorkDir,
    onBridgeSettingsChange: shell.handleBridgeSettingsChange,
    onBridgeOnboardingDraftChange: shell.handleBridgeOnboardingDraftChange,
    onToggleBridgeConnectorEnabled: shell.handleToggleBridgeConnectorEnabled,
    onDeleteBridgeConnector: shell.handleDeleteBridgeConnector,
    onPersistBridgeSettings: shell.handlePersistBridgeSettings,
    onRunBridgePrimaryAction: shell.handleRunBridgePrimaryAction,
    onStopBridge: shell.handleStopBridge,
    onRestartBridge: shell.handleRestartBridge,
    onImportBridgeSession: shell.handleImportBridgeSession,
    onClearBridgeBinding: shell.handleClearBridgeBinding,
    onResetBridgeBindingSession: shell.handleResetBridgeBindingSession,
    onResetBridgeBindingToDefaultWorkDir:
      shell.handleResetBridgeBindingToDefaultWorkDir,
    onResolveBridgeApproval: shell.handleResolveBridgeApproval,
    onSkillCenterSearchChange: shell.setSkillCenterSearch,
    onSkillCenterFilterChange: shell.setSkillCenterFilter,
    onSkillCenterSectionChange: shell.setSkillCenterSection,
    onSkillCenterGitRepoUrlChange: shell.setSkillCenterGitRepoUrl,
    onSkillCenterGitRefChange: shell.setSkillCenterGitRef,
    onSelectSkill: shell.handleSelectSkill,
    onOpenSkillFromInsights: shell.handleOpenSkillFromInsights,
    onSelectDiscoveredSkill: shell.handleSelectDiscoveredSkill,
    onScanDiscoveredSkills: shell.handleScanDiscoveredSkills,
    onImportDiscoveredSkill: shell.handleImportDiscoveredSkill,
    onSelectWorkspaceSkillTarget: shell.handleSelectWorkspaceSkillTarget,
    onSelectWorkspaceSkillContainer: shell.handleSelectWorkspaceSkillContainer,
    onAddInstalledSkillToWorkspaceTarget:
      shell.handleAddInstalledSkillToWorkspaceTarget,
    onOpenTask: shell.handleOpenControlTask,
    onCloseTask: shell.handleCloseControlTask,
    onConfirmInstallSkillFromGit: shell.handleConfirmInstallSkillFromGit,
    onConfirmImportSkillFromPath: shell.handleConfirmImportSkillFromPath,
    onSetSkillTrust: shell.handleSetSkillTrust,
    onApplySkill: shell.handleApplySkill,
    onRemoveSkill: shell.handleRemoveSkill,
    onSetWorkspaceSkillPin: shell.handleSetWorkspaceSkillPin,
    onUpdateSkill: shell.handleUpdateSkill,
    onUninstallSkill: shell.handleUninstallSkill,
    onRecoverWorkspaceSkill: shell.handleRecoverWorkspaceSkill,
    onConfigCenterDraftChange: shell.handleConfigCenterDraftChange,
    onResetConfigCenterDraft: shell.handleResetConfigCenterDraft,
    onSaveKimiCliConfigCenter: shell.handleSaveKimiCliConfigCenter,
    onSaveMainWindowCloseBehavior: shell.handleSaveMainWindowCloseBehavior,
    onInstallSourceChange: shell.handleInstallSourceChange,
    onSaveInstallSettings: shell.handleSaveInstallSettings,
    onRefreshPowerShellPreflight: shell.refreshPowerShellPreflight,
    onInstallDependencies: shell.handleInstallDependencies,
    onInstallKimi: shell.handleInstallKimi,
    onUpgradeKimi: shell.handleUpgradeKimi,
    onInstallNodejs: shell.handleInstallNodejs,
    onStartInstallTask: shell.handleStartInstallTask,
    onCancelInstallTask: shell.handleCancelInstallTask,
    onCompleteOnboarding: shell.handleCompleteOnboarding,
    onSkipOnboarding: shell.handleSkipOnboarding,
    onOpenExternalUrl: shell.handleOpenExternalUrl,
  };

  return (
    <main
      className={`shell-root theme-${shell.themeMode} ${shell.screen === "workspace" ? "workspace-shell" : ""}`}
    >
      <ShellTitlebar
        screen={shell.screen}
        backendState={shell.uiBackendState}
        themeMode={shell.themeMode}
        activeWorkspaceView={shell.activeWorkspaceView}
        workspaceLayoutMode={shell.workspaceLayoutMode}
        workspaceSplitOrder={shell.workspaceSplitOrder}
        statusText={shell.statusText}
        shellScreenLabel={shell.shellScreenLabel}
        actionBusy={shell.actionBusy}
        tauriRuntime={shell.tauriRuntime}
        isWindowMaximized={shell.isWindowMaximized}
        canOpenWorkspace={shell.canOpenWorkspace}
        sessionSkillCount={shell.sessionSkillCount}
        activeSessionWorkDir={shell.status?.activeSessionWorkDir}
        effectiveWorkDir={shell.status?.effectiveWorkDir}
        onRetry={shell.handleRuntimeOnlyRetry}
        onBackToStatus={shell.backToStatus}
        onOpenSkillCenter={shell.openSkillCenter}
        onOpenFolder={(path) => {
          void shell.handleOpenFolder(path);
        }}
        onToggleWorkspaceView={shell.handleToggleWorkspaceView}
        onToggleWorkspaceSplit={shell.handleToggleWorkspaceSplit}
        onSwapWorkspaceSplitOrder={shell.handleSwapWorkspaceSplitOrder}
        onToggleTheme={shell.handleToggleThemeMode}
        onStartWindowDrag={shell.handleStartWindowDrag}
        onMinimizeWindow={shell.handleMinimizeWindow}
        onToggleMaximizeWindow={shell.handleToggleMaximizeWindow}
        onCloseWindow={shell.handleCloseWindow}
        onTitlebarDoubleClick={shell.handleTitlebarDoubleClick}
      />

      {shell.actionError && <div className="shell-alert">{shell.actionError}</div>}
      {kimiLoginBannerVisible ? (
        <div className="shell-login-banner" role="status" aria-live="polite">
          <div className="shell-login-banner-copy">
            <strong>{kimiLoginBannerTitle}</strong>
            <p>{kimiLoginBannerSummary}</p>
            <span>{kimiLoginBannerMeta}</span>
          </div>
          <div className="shell-login-banner-actions">
            <button
              type="button"
              className="shell-login-banner-btn primary"
              onClick={() => void shell.handleProbeLogin()}
              disabled={shell.loginProbeBusy}
            >
              重新登录 / 检测
            </button>
            <button
              type="button"
              className="shell-login-banner-btn"
              onClick={() => {
                shell.setActiveControlSection("onboarding");
                shell.openControlCenter();
              }}
            >
              打开控制中心
            </button>
          </div>
        </div>
      ) : null}

      <div className="shell-stage">
        <div
          className={`workspace-layer ${shell.screen === "workspace" ? "workspace-layer-visible" : "workspace-layer-hidden"} ${shell.isWorkspaceSplit ? "workspace-layer-split" : "workspace-layer-single"}`}
        >
          <WorkspaceView
            activeWorkspaceView={shell.activeWorkspaceView}
            workspaceLayoutMode={shell.workspaceLayoutMode}
            workspaceSplitOrder={shell.workspaceSplitOrder}
            workspaceSplitRatio={shell.workspaceSplitRatio}
            isSplitDragging={shell.isWorkspaceSplitDragging}
            codeRemoteUrl={shell.remoteUrl}
            chatRemoteUrl={shell.chatRemoteUrl}
            workspaceIframeRef={shell.workspaceIframeRef}
            chatIframeRef={shell.chatIframeRef}
            codePaneState={shell.workspaceEmbedState}
            chatPaneState={shell.chatEmbedState}
            actionBusy={shell.actionBusy}
            onRetry={shell.handleRuntimeOnlyRetry}
            onOpenLogs={shell.handleOpenLogs}
            onOpenExternalUrl={shell.handleOpenExternalUrl}
            onSplitRatioChange={shell.handleWorkspaceSplitRatioChange}
            onSplitDragStateChange={shell.handleWorkspaceSplitDragStateChange}
            onCodeFrameLoad={shell.handleWorkspaceFrameLoad}
            onCodeFrameError={shell.handleWorkspaceFrameError}
            onChatFrameLoad={shell.handleChatFrameLoad}
            onChatFrameError={shell.handleChatFrameError}
          />
        </div>

        {shell.showLoadingView ? (
          <div className="shell-overlay-layer">
            <LoadingView
              status={shell.status}
              statusText={shell.statusText}
              remoteUrl={shell.remoteUrl}
              actionBusy={shell.actionBusy}
              hotkeyOwnerLabel={shell.hotkeyOwnerLabel}
              onRetry={shell.handleRuntimeOnlyRetry}
              onRecoverMainWindowBoot={shell.handleRecoverMainWindowBoot}
              onOpenLogs={shell.handleOpenLogs}
              onQuitAppGracefully={shell.handleQuitAppGracefully}
              onOpenExternalUrl={shell.handleOpenExternalUrl}
            />
          </div>
        ) : null}

        {shell.screen === "control_center" ? (
          <div className="shell-overlay-layer">
            <ControlCenterView surface="fullscreen" {...controlCenterProps} />
          </div>
        ) : null}
      </div>

      {shell.controlCenterModalOpen && shell.screen === "workspace" ? (
        <div
          className="cc-shell-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              shell.dismissControlCenter();
            }
          }}
        >
          <div className="cc-shell-modal" role="dialog" aria-modal="true" aria-label="控制中心">
            <ControlCenterView surface="modal" {...controlCenterProps} />
          </div>
        </div>
      ) : null}

      {shell.mainWindowCloseDecisionRequest ? (
        <div className="main-close-decision-overlay" role="presentation">
          <div
            className="main-close-decision-card"
            role="dialog"
            aria-modal="true"
            aria-label={
              shell.mainWindowCloseDecisionRequest.title.trim() || "关闭主窗口"
            }
          >
            <h3>{shell.mainWindowCloseDecisionRequest.title || "关闭主窗口"}</h3>
            <p>
              {shell.mainWindowCloseDecisionRequest.message ||
                "关闭主窗口时，选择退出应用或最小化到系统托盘。"}
            </p>
            <div className="main-close-decision-remember">
              <button
                type="button"
                className={`main-close-decision-remember-btn ${
                  rememberMainCloseDecision ? "is-active" : ""
                }`}
                aria-pressed={rememberMainCloseDecision}
                aria-label={
                  shell.mainWindowCloseDecisionRequest.rememberLabel || "记住我的选择"
                }
                title={shell.mainWindowCloseDecisionRequest.rememberLabel || "记住我的选择"}
                onClick={() => {
                  setRememberMainCloseDecision((current) => !current);
                }}
              >
                <Check size={14} />
              </button>
              <span className="main-close-decision-remember-label">
                {shell.mainWindowCloseDecisionRequest.rememberLabel || "记住我的选择"}
              </span>
            </div>
            <div className="main-close-decision-actions">
              <button
                type="button"
                className="ui-btn ui-btn-destructive ui-btn-size-default"
                onClick={() => {
                  void shell.handleSubmitMainWindowCloseDecision({
                    decision: "exit",
                    remember: rememberMainCloseDecision,
                  });
                }}
              >
                {shell.mainWindowCloseDecisionRequest.exitLabel || "退出应用"}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-default ui-btn-size-default"
                autoFocus
                onClick={() => {
                  void shell.handleSubmitMainWindowCloseDecision({
                    decision: "minimize_to_tray",
                    remember: rememberMainCloseDecision,
                  });
                }}
              >
                {shell.mainWindowCloseDecisionRequest.minimizeLabel || "最小化到系统托盘"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {shell.shutdownProgress && (
        <div className="shutdown-overlay" role="status" aria-live="assertive">
          <div className="shutdown-card">
            <div className="shutdown-card-status">
              <div className="spinner" aria-hidden />
              <h3>正在关闭应用</h3>
              <p>{shell.shutdownProgress.detail ?? shell.shutdownProgress.stage}</p>
              {typeof shell.shutdownElapsedMs === "number" && (
                <small>耗时 {shell.shutdownElapsedMs} ms</small>
              )}
            </div>

            {shutdownTip ? (
              <div className="shutdown-tip-card">
                <div className="shutdown-tip-meta">
                  <span className="shutdown-tip-badge">随机提示</span>
                  <span className="shutdown-tip-number">{shutdownTip.numberLabel}</span>
                </div>
                <strong className="shutdown-tip-title">{shutdownTip.title}</strong>
                <p className="shutdown-tip-body">{shutdownTip.body}</p>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <footer className="statusbar" aria-live="polite">
        <div className="statusbar-left">
          {shell.screen === "workspace" ? (
            <IconButton
              icon={<Settings size={14} />}
              label="打开控制中心"
              onClick={shell.openControlCenter}
              className="ghost mini status-nav-btn status-settings-btn"
            />
          ) : null}
          <span className={`status-indicator ${statusChipClass}`}>
            {formatBackendState(shell.uiBackendState)}
          </span>
          <button
            type="button"
            className={`status-bridge-chip tone-${bridgeStateTone} ${bridgeStartable ? "is-action" : "is-static"}`}
            onClick={() => {
              if (!bridgeStartable) return;
              void shell.handleStartBridge();
            }}
            disabled={!bridgeStartable || shell.bridgeBusy || shell.actionBusy}
            aria-label={
              bridgeStartable
                ? "一键启动 IM Bridge"
                : `IM Bridge 当前状态：${bridgeStateLabel}`
            }
            title={
              bridgeStartable
                ? "IM Bridge 未启动，点击一键启动"
                : `IM Bridge 当前状态：${bridgeStateLabel}`
            }
          >
            {bridgeStateLabel}
          </button>
          {shell.isLoading && (
            <span className="status-text">Checking backend status...</span>
          )}
          {!shell.isLoading && shell.actionError && (
            <span className="status-text status-error">{shell.actionError}</span>
          )}
          {!shell.isLoading && !shell.actionError && shell.status?.message && (
            <span className="status-text">{shell.status.message}</span>
          )}
        </div>
        <div className="statusbar-right">
          <span className="status-meta">
            Theme: {shell.themeMode === "light" ? "Light" : "Dark"}
          </span>
          <span className="status-meta">Port: {shell.status?.activePort ?? "-"}</span>
          <span className="status-meta">PID: {shell.status?.pid ?? "-"}</span>
        </div>
      </footer>
    </main>
  );
}

export default App;
