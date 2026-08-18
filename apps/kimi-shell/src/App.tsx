import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { useShellController } from "@/app/useShellController";
import { useDshController } from "@/app/useDshController";
import { useLanAccessController } from "@/app/useLanAccessController";
import { Button } from "@/components/ui/button";
import { useDialogFocusBoundary } from "@/components/control-center/useDialogFocusBoundary";
import { ControlCenterView } from "@/features/control-center/ControlCenterView";
import { LoadingView } from "@/features/loading/LoadingView";
import {
  WorkspaceImportModal,
  WorkspaceImportStandaloneWindow,
  WorkspaceImportResultNotice,
} from "@/features/workspace-import/WorkspaceImportModal";
import { ShellTitlebar } from "@/features/window/ShellTitlebar";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import {
  addDshPaneToWorkspaceGrid,
  useWorkspaceGridStore,
} from "@/features/workspace-grid/gridStore";
import { getTrustedDshRuntimeUrl } from "@/services/dshService";
import "./App.css";
import "./components/control-center/control-center.css";
import "./features/directory/directory.css";

function App() {
  const shell = useShellController();
  const dshPaneVisible = useWorkspaceGridStore((state) => {
    const visiblePaneIds = state.maximizedPaneId
      ? [state.maximizedPaneId]
      : state.slots.flatMap((slot) => (slot.paneId ? [slot.paneId] : []));
    return visiblePaneIds.some((paneId) =>
      state.panes.some((pane) => pane.id === paneId && pane.kind === "dsh"),
    );
  });
  const controlCenterVisible =
    shell.screen === "control_center" || shell.controlCenterModalOpen;
  const dshForeground =
    controlCenterVisible || (shell.screen === "workspace" && dshPaneVisible);
  const dsh = useDshController(shell.tauriRuntime, dshForeground);
  const lanAccess = useLanAccessController(
    shell.tauriRuntime,
    shell.refreshCoreState,
  );
  const [rememberMainCloseDecision, setRememberMainCloseDecision] = useState(false);
  const currentHashRoute = window.location.hash.replace(/^#\/?/, "");
  const isWorkspaceImportPickerRoute = currentHashRoute === "workspace-import-picker";
  const controlCenterDialogRef = useDialogFocusBoundary(
    shell.controlCenterModalOpen && shell.screen === "workspace",
  );
  useEffect(() => {
    if (!controlCenterVisible) return;
    void dsh.refresh({
      preflight: dsh.settings?.enabled === true ? "cached" : "none",
    });
  }, [controlCenterVisible, dsh.refresh, dsh.settings?.enabled]);
  useEffect(() => {
    if (!shell.controlCenterModalOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        shell.requestCloseControlCenter();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shell.controlCenterModalOpen, shell.requestCloseControlCenter, shell.activeControlTask]);

  useEffect(() => {
    if (!shell.controlCenterModalOpen || shell.screen !== "workspace") return;
    const overlay = controlCenterDialogRef.current?.parentElement;
    const root = overlay?.parentElement;
    if (!overlay || !root) return;
    const siblings = Array.from(root.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== overlay,
    );
    const previous = siblings.map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    siblings.forEach((element) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });
    return () => {
      previous.forEach(({ element, inert, ariaHidden }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
    };
  }, [controlCenterDialogRef, shell.controlCenterModalOpen, shell.screen]);

  useEffect(() => {
    if (!shell.mainWindowCloseDecisionRequest) {
      setRememberMainCloseDecision(false);
    }
  }, [shell.mainWindowCloseDecisionRequest]);

  useEffect(() => {
    if (!isWorkspaceImportPickerRoute) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (shell.workspaceImportRequest?.requestId?.trim()) {
        void shell.handleCancelWorkspaceImportPicker();
        return;
      }
      void shell.handleCloseWindow();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    isWorkspaceImportPickerRoute,
    shell.handleCancelWorkspaceImportPicker,
    shell.handleCloseWindow,
    shell.workspaceImportRequest,
  ]);

  if (isWorkspaceImportPickerRoute) {
    return (
      <WorkspaceImportStandaloneWindow
        request={shell.workspaceImportRequest}
        targets={shell.workspaceImportTargets}
        busy={shell.workspaceImportBusy}
        errorMessage={shell.actionError}
        onSelectTarget={shell.handleSelectWorkspaceImportTarget}
        onBrowse={shell.handleImportToBrowsedWorkspace}
        onCancel={shell.handleCancelWorkspaceImportPicker}
      />
    );
  }

  const controlCenterProps = {
    supportsExplorerContextMenu:
      shell.platformCapabilities?.supportsExplorerContextMenu === true,
    kimiInstallMode: shell.platformCapabilities?.kimiInstallMode ?? "externalGuided",
    status: shell.status,
    diagnostics: shell.diagnostics,
    kimiDoctorResult: shell.kimiDoctorResult,
    onboarding: shell.onboarding,
    contextMenuStatus: shell.contextMenuStatus,
    activeControlSection: shell.activeControlSection,
    activeRuntimePanel: shell.activeRuntimePanel,
    stepCompletion: shell.stepCompletion,
    actionBusy: shell.actionBusy,
    actionError: shell.actionError,
    diagnosticsBusy: shell.diagnosticsBusy,
    kimiDoctorBusy: shell.kimiDoctorBusy,
    contextMenuBusy: shell.contextMenuBusy,
    mainWindowCloseBehavior: shell.mainWindowCloseBehavior,
    lanAccess,
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
    kimiCodeAccessView: shell.kimiCodeAccessView,
    kimiCodeAccessDraft: shell.kimiCodeAccessDraft,
    kimiCodeAccessBusy: shell.kimiCodeAccessBusy,
    kimiCodeAccessDirty: shell.kimiCodeAccessDirty,
    kimiCodeAccessTesting: shell.kimiCodeAccessTesting,
    kimiCodeAccessTestResult: shell.kimiCodeAccessTestResult,
    installProbe: shell.installProbe,
    installProbeBusy: shell.installProbeBusy,
    kimiCodeUpdateStatus: shell.kimiCodeUpdateStatus,
    kimiCodeUpdateInfo: shell.kimiCodeUpdateInfo,
    kimiCodeUpdateError: shell.kimiCodeUpdateError,
    installSource: shell.installSource,
    installSettings: shell.installSettings,
    installSettingsBusy: shell.installSettingsBusy,
    installMirrorHealthReport: shell.installMirrorHealthReport,
    installMirrorHealthBusy: shell.installMirrorHealthBusy,
    powershellPreflight: shell.powershellPreflight,
    installSessionSnapshot: shell.installSessionSnapshot,
    activeTask: shell.activeControlTask,
    activeTaskPayload: shell.activeControlTaskPayload,
    dsh,
    installBusy: shell.installBusy,
    appUpdateSupported: shell.appUpdateSupported,
    appUpdateStatus: shell.appUpdateStatus,
    appUpdateInfo: shell.appUpdateInfo,
    appUpdateProgress: shell.appUpdateProgress,
    appUpdateError: shell.appUpdateError,
    installMessage: shell.installMessage,
    onClose: shell.dismissControlCenter,
    onRefreshCoreState: shell.refreshCoreState,
    onRefreshDiagnostics: shell.refreshDiagnostics,
    onRunKimiDoctor: shell.handleRunKimiDoctor,
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
    onRefreshInstallMirrorHealth: shell.refreshInstallMirrorHealth,
    onRefreshOnboarding: shell.refreshOnboarding,
    onRetry: shell.handleRuntimeOnlyRetry,
    onOpenLogs: shell.handleOpenLogs,
    onOpenFolder: shell.handleOpenFolder,
    onOpenKimiConfigDir: shell.handleOpenKimiConfigDir,
    onPickKimiPath: shell.handlePickKimiPath,
    onSavePathAndRetry: shell.handleSavePathAndRetry,
    onEnableContextMenu: shell.handleEnableContextMenu,
    onDisableContextMenu: shell.handleDisableContextMenu,
    onSaveContextMenuLabels: shell.handleSaveContextMenuLabels,
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
    onClearSkillSelection: shell.handleClearSkillSelection,
    onSelectDiscoveredSkill: shell.handleSelectDiscoveredSkill,
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
    onRefreshKimiCodeAccessConfig: shell.handleOpenKimiCodeAccessPanel,
    onKimiCodeAccessDraftChange: shell.handleKimiCodeAccessDraftChange,
    onSaveKimiCodeAccessConfig: shell.handleSaveKimiCodeAccessConfig,
    onTestKimiCodeAccessConfig: shell.handleTestKimiCodeAccessConfig,
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
    onCheckAppUpdate: shell.checkAppUpdate,
    onInstallAppUpdate: shell.installAppUpdate,
    onCompleteOnboarding: shell.handleCompleteOnboarding,
    onSkipOnboarding: shell.handleSkipOnboarding,
    onOpenExternalUrl: shell.handleOpenExternalUrl,
    onOpenSystemTerminal: shell.handleOpenSystemTerminal,
  };

  async function handleCreateDshPane() {
    const defaultWorkDir = shell.status?.effectiveWorkDir?.trim();
    if (!defaultWorkDir) return;
    const paneId = addDshPaneToWorkspaceGrid(defaultWorkDir);
    if (!paneId) return;
    if (
      dsh.status?.state !== "running" &&
      dsh.status?.state !== "starting"
    ) {
      await dsh.start(defaultWorkDir);
    }
  }

  async function handleRecoverDsh(workspaceDir?: string) {
    const targetWorkDir = workspaceDir?.trim() || shell.status?.effectiveWorkDir?.trim();
    if (!targetWorkDir) return null;
    return dsh.start(targetWorkDir);
  }

  return (
    <main
      className={`shell-root theme-${shell.themeMode} platform-${shell.platformCapabilities?.os ?? "loading"} ${shell.screen === "workspace" ? "workspace-shell" : ""}`}
    >
      <ShellTitlebar
        screen={shell.screen}
        backendState={shell.uiBackendState}
        themeMode={shell.themeMode}
        codeRemoteUrl={shell.remoteUrl}
        chatRemoteUrl={shell.chatRemoteUrl}
        effectiveWorkDir={shell.status?.effectiveWorkDir}
        statusText={shell.statusText}
        shellScreenLabel={shell.shellScreenLabel}
        actionBusy={shell.actionBusy}
        tauriRuntime={shell.tauriRuntime}
        nativeWindowControls={shell.platformCapabilities?.nativeWindowControls === true}
        isWindowMaximized={shell.isWindowMaximized}
        canOpenWorkspace={shell.canOpenWorkspace}
        onRetry={shell.handleRuntimeOnlyRetry}
        onBackToStatus={shell.backToStatus}
        onOpenControlCenter={shell.openControlCenter}
        onOpenExternalUrl={shell.handleOpenExternalUrl}
        onToggleTheme={shell.handleToggleThemeMode}
        onStartWindowDrag={shell.handleStartWindowDrag}
        onMinimizeWindow={shell.handleMinimizeWindow}
        onToggleMaximizeWindow={shell.handleToggleMaximizeWindow}
        onCloseWindow={shell.handleCloseWindow}
        onTitlebarDoubleClick={shell.handleTitlebarDoubleClick}
        dshEnabled={dsh.settings?.enabled === true}
        dshBusy={dsh.busy}
        dshRemoteUrl={getTrustedDshRuntimeUrl(dsh.status)}
        onCreateDshPane={handleCreateDshPane}
      />

      {shell.actionError && <div className="shell-alert">{shell.actionError}</div>}
      <WorkspaceImportResultNotice
        result={shell.workspaceImportResult}
        onDismiss={shell.handleDismissWorkspaceImportResult}
      />

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
            codeFrameKey={shell.workspaceFrameKey}
            workspaceBridgeNonce={shell.workspaceBridgeNonce}
            chatRemoteUrl={shell.chatRemoteUrl}
            effectiveWorkDir={shell.status?.effectiveWorkDir}
            themeMode={shell.themeMode}
            workspaceIframeRef={shell.workspaceIframeRef}
            chatIframeRef={shell.chatIframeRef}
            codePaneState={shell.workspaceEmbedState}
            chatPaneState={shell.chatEmbedState}
            actionBusy={shell.actionBusy}
            onRetry={shell.handleRuntimeOnlyRetry}
            onOpenLogs={shell.handleOpenLogs}
            onOpenFolder={shell.handleOpenFolder}
            onOpenPaneFolder={shell.handleOpenPaneFolder}
            onPaneSessionObserved={shell.handlePaneSessionObserved}
            onOpenExternalUrl={shell.handleOpenExternalUrl}
            onSplitRatioChange={shell.handleWorkspaceSplitRatioChange}
            onSplitDragStateChange={shell.handleWorkspaceSplitDragStateChange}
            onCodeFrameLoad={shell.handleWorkspaceFrameLoad}
            onCodeFrameError={shell.handleWorkspaceFrameError}
            onChatFrameLoad={shell.handleChatFrameLoad}
            onChatFrameError={shell.handleChatFrameError}
            dshStatus={dsh.status}
            dshError={dsh.error}
            dshBusy={dsh.busy}
            onRefreshDsh={dsh.refresh}
            onRecoverDsh={handleRecoverDsh}
          />
        </div>

        {shell.showLoadingView ? (
          <div className="shell-overlay-layer">
            <LoadingView
              status={shell.status}
              statusText={shell.statusText}
              remoteUrl={shell.remoteUrl}
              displayUrl={shell.workspaceDisplayUrl}
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
          <div
            ref={controlCenterDialogRef}
            className="cc-shell-modal"
            role="dialog"
            aria-modal="true"
            aria-label="控制中心"
            tabIndex={-1}
          >
            <ControlCenterView surface="modal" {...controlCenterProps} />
          </div>
        </div>
      ) : null}

      <WorkspaceImportModal
        request={shell.workspaceImportRequest}
        targets={shell.workspaceImportTargets}
        busy={shell.workspaceImportBusy}
        onSelectTarget={shell.handleSelectWorkspaceImportTarget}
        onBrowse={shell.handleImportToBrowsedWorkspace}
        onCancel={shell.handleCancelWorkspaceImportPicker}
      />

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
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  void shell.handleSubmitMainWindowCloseDecision({
                    decision: "exit",
                    remember: rememberMainCloseDecision,
                  });
                }}
              >
                {shell.mainWindowCloseDecisionRequest.exitLabel || "退出应用"}
              </Button>
              <Button
                type="button"
                autoFocus
                onClick={() => {
                  void shell.handleSubmitMainWindowCloseDecision({
                    decision: "minimize_to_tray",
                    remember: rememberMainCloseDecision,
                  });
                }}
              >
                {shell.mainWindowCloseDecisionRequest.minimizeLabel || "最小化到系统托盘"}
              </Button>
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

          </div>
        </div>
      )}

    </main>
  );
}

export default App;
