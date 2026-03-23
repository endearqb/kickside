import { useEffect, useState } from "react";
import { Check, Settings } from "lucide-react";
import { useShellController } from "@/app/useShellController";
import { formatBackendState } from "@/app/types";
import { IconButton } from "@/components/common/IconButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ControlCenterView } from "@/features/control-center/ControlCenterView";
import { LoadingView } from "@/features/loading/LoadingView";
import { ShellTitlebar } from "@/features/window/ShellTitlebar";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import { pickRandomAgentTip, type AgentTip } from "@/lib/agentTips";
import "./App.css";

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

  useEffect(() => {
    if (!shell.controlCenterModalOpen || shell.configCenterOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        shell.closeControlCenterModal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    shell.closeControlCenterModal,
    shell.configCenterOpen,
    shell.controlCenterModalOpen,
  ]);

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
            <ControlCenterView
              surface="fullscreen"
              status={shell.status}
              diagnostics={shell.diagnostics}
              onboarding={shell.onboarding}
              contextMenuStatus={shell.contextMenuStatus}
              activeControlSection={shell.activeControlSection}
              activeRuntimePanel={shell.activeRuntimePanel}
              stepCompletion={shell.stepCompletion}
              actionBusy={shell.actionBusy}
              diagnosticsBusy={shell.diagnosticsBusy}
              contextMenuBusy={shell.contextMenuBusy}
              loginProbeBusy={shell.loginProbeBusy}
              mainWindowCloseBehavior={shell.mainWindowCloseBehavior}
              bridgeSettings={shell.bridgeSettings}
              bridgeStatus={shell.bridgeStatus}
              bridgeOnboardingDraft={shell.bridgeOnboardingDraft}
              bridgeOnboardingDirty={shell.bridgeOnboardingDirty}
              bridgeOnboardingValidation={shell.bridgeOnboardingValidation}
              bridgeSettingsDirty={shell.bridgeSettingsDirty}
              bridgeSessions={shell.bridgeSessions}
              bridgeBindings={shell.bridgeBindings}
              bridgeApprovals={shell.bridgeApprovals}
              bridgeLogTail={shell.bridgeLogTail}
              bridgeRecentErrors={shell.bridgeRecentErrors}
              bridgeSecretsMask={shell.bridgeSecretsMask}
              bridgeBusy={shell.bridgeBusy}
              installedSkills={shell.installedSkills}
              skillCenterBusy={shell.skillCenterBusy}
              skillCenterSearch={shell.skillCenterSearch}
              skillCenterFilter={shell.skillCenterFilter}
              skillCenterSection={shell.skillCenterSection}
              selectedSkillId={shell.selectedSkillId}
              selectedSkillDetail={shell.selectedSkillDetail}
              globalSkillProjections={shell.globalSkillProjections}
              activeSessionSkillState={shell.activeSessionSkillState}
              workspaceSkillProfile={shell.workspaceSkillProfile}
              workspaceRecentSkillIds={shell.workspaceRecentSkillIds}
              kimiPathInput={shell.kimiPathInput}
              workDirInput={shell.workDirInput}
              setActiveControlSection={shell.setActiveControlSection}
              setActiveRuntimePanel={shell.setActiveRuntimePanel}
              onWorkDirInputChange={shell.setWorkDirInput}
              configCenterView={shell.configCenterView}
              configCenterDraft={shell.configCenterDraft}
              configCenterOpen={shell.configCenterOpen}
              configCenterBusy={shell.configCenterBusy}
              configCenterDirty={shell.configCenterDirty}
              installProbe={shell.installProbe}
              installSource={shell.installSource}
              installSettings={shell.installSettings}
              installSettingsBusy={shell.installSettingsBusy}
              powershellPreflight={shell.powershellPreflight}
              installFlowOpen={shell.installFlowOpen}
              installFlowCatalog={shell.installFlowCatalog}
              installSessionSnapshot={shell.installSessionSnapshot}
              installBusy={shell.installBusy}
              installAction={shell.installAction}
              installMessage={shell.installMessage}
              installCommandsOpen={shell.installCommandsOpen}
              installCommandsBusy={shell.installCommandsBusy}
              installCommandCatalog={shell.installCommandCatalog}
              onClose={shell.backToStatus}
              onRefreshCoreState={shell.refreshCoreState}
              onRefreshDiagnostics={shell.refreshDiagnostics}
              onRefreshContextMenuStatus={shell.refreshContextMenuStatus}
              onRefreshBridgeSettings={shell.refreshBridgeSettings}
              onRefreshBridgeStatus={shell.refreshBridgeStatus}
              onRefreshBridgeSessions={shell.refreshBridgeSessions}
              onRefreshBridgeBindings={shell.refreshBridgeBindings}
              onRefreshBridgeApprovals={shell.refreshBridgeApprovals}
              onRefreshBridgeLogTail={shell.refreshBridgeLogTail}
              onRefreshBridgeSecretsMask={shell.refreshBridgeSecretsMask}
              onSaveBridgeConnectorSecrets={shell.handleSaveBridgeConnectorSecrets}
              onRefreshSkillCenterState={() =>
                shell.refreshSkillCenterState(shell.selectedSkillId)
              }
              onRefreshInstallProbe={shell.refreshInstallProbe}
              onRefreshOnboarding={shell.refreshOnboarding}
              onRetry={shell.handleRuntimeOnlyRetry}
              onOpenLogs={shell.handleOpenLogs}
              onOpenFolder={shell.handleOpenFolder}
              onOpenKimiConfigDir={shell.handleOpenKimiConfigDir}
              onPickKimiPath={shell.handlePickKimiPath}
              onSavePathAndRetry={shell.handleSavePathAndRetry}
              onEnableContextMenu={shell.handleEnableContextMenu}
              onDisableContextMenu={shell.handleDisableContextMenu}
              onProbeLogin={shell.handleProbeLogin}
              onPickWorkDir={shell.handlePickWorkDir}
              onPickBridgeConnectorDefaultWorkDir={
                shell.handlePickBridgeConnectorDefaultWorkDir
              }
              onSaveWorkDirAndRestart={shell.handleSaveWorkDirAndRestart}
              onClearWorkDir={shell.handleClearWorkDir}
              onBridgeSettingsChange={shell.handleBridgeSettingsChange}
              onBridgeOnboardingDraftChange={shell.handleBridgeOnboardingDraftChange}
              onSaveBridgeSettings={shell.handleSaveBridgeSettings}
              onRunBridgePrimaryAction={shell.handleRunBridgePrimaryAction}
              onStopBridge={shell.handleStopBridge}
              onRestartBridge={shell.handleRestartBridge}
              onImportBridgeSession={shell.handleImportBridgeSession}
              onClearBridgeBinding={shell.handleClearBridgeBinding}
              onResetBridgeBindingSession={shell.handleResetBridgeBindingSession}
              onResetBridgeBindingToDefaultWorkDir={
                shell.handleResetBridgeBindingToDefaultWorkDir
              }
              onResolveBridgeApproval={shell.handleResolveBridgeApproval}
              onSkillCenterSearchChange={shell.setSkillCenterSearch}
              onSkillCenterFilterChange={shell.setSkillCenterFilter}
              onSkillCenterSectionChange={shell.setSkillCenterSection}
              onSelectSkill={shell.handleSelectSkill}
              onOpenSkillFromInsights={shell.handleOpenSkillFromInsights}
              onInstallSkillFromGit={shell.handleInstallSkillFromGit}
              onImportSkillFromPath={shell.handleImportSkillFromPath}
              onSetSkillTrust={shell.handleSetSkillTrust}
              onApplySkill={shell.handleApplySkill}
              onRemoveSkill={shell.handleRemoveSkill}
              onRecoverWorkspaceSkill={shell.handleRecoverWorkspaceSkill}
              onOpenConfigCenterModal={shell.handleOpenConfigCenterModal}
              onCloseConfigCenterModal={shell.handleCloseConfigCenterModal}
              onConfigCenterDraftChange={shell.handleConfigCenterDraftChange}
              onResetConfigCenterDraft={shell.handleResetConfigCenterDraft}
              onSaveKimiCliConfigCenter={shell.handleSaveKimiCliConfigCenter}
              onSaveMainWindowCloseBehavior={shell.handleSaveMainWindowCloseBehavior}
              onInstallSourceChange={shell.handleInstallSourceChange}
              onSaveInstallSettings={shell.handleSaveInstallSettings}
              onRefreshPowerShellPreflight={shell.refreshPowerShellPreflight}
              onInstallDependencies={shell.handleInstallDependencies}
              onInstallKimi={shell.handleInstallKimi}
              onUpgradeKimi={shell.handleUpgradeKimi}
              onInstallNodejs={shell.handleInstallNodejs}
              onOpenInstallFlow={shell.handleOpenInstallFlow}
              onCloseInstallFlow={shell.handleCloseInstallFlow}
              onStartInstallTask={shell.handleStartInstallTask}
              onCancelInstallTask={shell.handleCancelInstallTask}
              onOpenInstallCommands={shell.handleOpenInstallCommands}
              onCloseInstallCommands={shell.handleCloseInstallCommands}
              onCompleteOnboarding={shell.handleCompleteOnboarding}
              onSkipOnboarding={shell.handleSkipOnboarding}
              onOpenExternalUrl={shell.handleOpenExternalUrl}
            />
          </div>
        ) : null}
      </div>

      {shell.controlCenterModalOpen && shell.screen === "workspace" ? (
        <div
          className="cc-shell-modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              shell.closeControlCenterModal();
            }
          }}
        >
          <div className="cc-shell-modal" role="dialog" aria-modal="true" aria-label="控制中心">
            <ControlCenterView
              surface="modal"
              status={shell.status}
              diagnostics={shell.diagnostics}
              onboarding={shell.onboarding}
              contextMenuStatus={shell.contextMenuStatus}
              activeControlSection={shell.activeControlSection}
              activeRuntimePanel={shell.activeRuntimePanel}
              stepCompletion={shell.stepCompletion}
              actionBusy={shell.actionBusy}
              diagnosticsBusy={shell.diagnosticsBusy}
              contextMenuBusy={shell.contextMenuBusy}
              loginProbeBusy={shell.loginProbeBusy}
              mainWindowCloseBehavior={shell.mainWindowCloseBehavior}
              bridgeSettings={shell.bridgeSettings}
              bridgeStatus={shell.bridgeStatus}
              bridgeOnboardingDraft={shell.bridgeOnboardingDraft}
              bridgeOnboardingDirty={shell.bridgeOnboardingDirty}
              bridgeOnboardingValidation={shell.bridgeOnboardingValidation}
              bridgeSettingsDirty={shell.bridgeSettingsDirty}
              bridgeSessions={shell.bridgeSessions}
              bridgeBindings={shell.bridgeBindings}
              bridgeApprovals={shell.bridgeApprovals}
              bridgeLogTail={shell.bridgeLogTail}
              bridgeRecentErrors={shell.bridgeRecentErrors}
              bridgeSecretsMask={shell.bridgeSecretsMask}
              bridgeBusy={shell.bridgeBusy}
              installedSkills={shell.installedSkills}
              skillCenterBusy={shell.skillCenterBusy}
              skillCenterSearch={shell.skillCenterSearch}
              skillCenterFilter={shell.skillCenterFilter}
              skillCenterSection={shell.skillCenterSection}
              selectedSkillId={shell.selectedSkillId}
              selectedSkillDetail={shell.selectedSkillDetail}
              globalSkillProjections={shell.globalSkillProjections}
              activeSessionSkillState={shell.activeSessionSkillState}
              workspaceSkillProfile={shell.workspaceSkillProfile}
              workspaceRecentSkillIds={shell.workspaceRecentSkillIds}
              kimiPathInput={shell.kimiPathInput}
              workDirInput={shell.workDirInput}
              setActiveControlSection={shell.setActiveControlSection}
              setActiveRuntimePanel={shell.setActiveRuntimePanel}
              onWorkDirInputChange={shell.setWorkDirInput}
              configCenterView={shell.configCenterView}
              configCenterDraft={shell.configCenterDraft}
              configCenterOpen={shell.configCenterOpen}
              configCenterBusy={shell.configCenterBusy}
              configCenterDirty={shell.configCenterDirty}
              installProbe={shell.installProbe}
              installSource={shell.installSource}
              installSettings={shell.installSettings}
              installSettingsBusy={shell.installSettingsBusy}
              powershellPreflight={shell.powershellPreflight}
              installFlowOpen={shell.installFlowOpen}
              installFlowCatalog={shell.installFlowCatalog}
              installSessionSnapshot={shell.installSessionSnapshot}
              installBusy={shell.installBusy}
              installAction={shell.installAction}
              installMessage={shell.installMessage}
              installCommandsOpen={shell.installCommandsOpen}
              installCommandsBusy={shell.installCommandsBusy}
              installCommandCatalog={shell.installCommandCatalog}
              onClose={shell.closeControlCenterModal}
              onRefreshCoreState={shell.refreshCoreState}
              onRefreshDiagnostics={shell.refreshDiagnostics}
              onRefreshContextMenuStatus={shell.refreshContextMenuStatus}
              onRefreshBridgeSettings={shell.refreshBridgeSettings}
              onRefreshBridgeStatus={shell.refreshBridgeStatus}
              onRefreshBridgeSessions={shell.refreshBridgeSessions}
              onRefreshBridgeBindings={shell.refreshBridgeBindings}
              onRefreshBridgeApprovals={shell.refreshBridgeApprovals}
              onRefreshBridgeLogTail={shell.refreshBridgeLogTail}
              onRefreshBridgeSecretsMask={shell.refreshBridgeSecretsMask}
              onSaveBridgeConnectorSecrets={shell.handleSaveBridgeConnectorSecrets}
              onRefreshSkillCenterState={() =>
                shell.refreshSkillCenterState(shell.selectedSkillId)
              }
              onRefreshInstallProbe={shell.refreshInstallProbe}
              onRefreshOnboarding={shell.refreshOnboarding}
              onRetry={shell.handleRuntimeOnlyRetry}
              onOpenLogs={shell.handleOpenLogs}
              onOpenFolder={shell.handleOpenFolder}
              onOpenKimiConfigDir={shell.handleOpenKimiConfigDir}
              onPickKimiPath={shell.handlePickKimiPath}
              onSavePathAndRetry={shell.handleSavePathAndRetry}
              onEnableContextMenu={shell.handleEnableContextMenu}
              onDisableContextMenu={shell.handleDisableContextMenu}
              onProbeLogin={shell.handleProbeLogin}
              onPickWorkDir={shell.handlePickWorkDir}
              onPickBridgeConnectorDefaultWorkDir={
                shell.handlePickBridgeConnectorDefaultWorkDir
              }
              onSaveWorkDirAndRestart={shell.handleSaveWorkDirAndRestart}
              onClearWorkDir={shell.handleClearWorkDir}
              onBridgeSettingsChange={shell.handleBridgeSettingsChange}
              onBridgeOnboardingDraftChange={shell.handleBridgeOnboardingDraftChange}
              onSaveBridgeSettings={shell.handleSaveBridgeSettings}
              onRunBridgePrimaryAction={shell.handleRunBridgePrimaryAction}
              onStopBridge={shell.handleStopBridge}
              onRestartBridge={shell.handleRestartBridge}
              onImportBridgeSession={shell.handleImportBridgeSession}
              onClearBridgeBinding={shell.handleClearBridgeBinding}
              onResetBridgeBindingSession={shell.handleResetBridgeBindingSession}
              onResetBridgeBindingToDefaultWorkDir={
                shell.handleResetBridgeBindingToDefaultWorkDir
              }
              onResolveBridgeApproval={shell.handleResolveBridgeApproval}
              onSkillCenterSearchChange={shell.setSkillCenterSearch}
              onSkillCenterFilterChange={shell.setSkillCenterFilter}
              onSkillCenterSectionChange={shell.setSkillCenterSection}
              onSelectSkill={shell.handleSelectSkill}
              onOpenSkillFromInsights={shell.handleOpenSkillFromInsights}
              onInstallSkillFromGit={shell.handleInstallSkillFromGit}
              onImportSkillFromPath={shell.handleImportSkillFromPath}
              onSetSkillTrust={shell.handleSetSkillTrust}
              onApplySkill={shell.handleApplySkill}
              onRemoveSkill={shell.handleRemoveSkill}
              onRecoverWorkspaceSkill={shell.handleRecoverWorkspaceSkill}
              onOpenConfigCenterModal={shell.handleOpenConfigCenterModal}
              onCloseConfigCenterModal={shell.handleCloseConfigCenterModal}
              onConfigCenterDraftChange={shell.handleConfigCenterDraftChange}
              onResetConfigCenterDraft={shell.handleResetConfigCenterDraft}
              onSaveKimiCliConfigCenter={shell.handleSaveKimiCliConfigCenter}
              onSaveMainWindowCloseBehavior={shell.handleSaveMainWindowCloseBehavior}
              onInstallSourceChange={shell.handleInstallSourceChange}
              onSaveInstallSettings={shell.handleSaveInstallSettings}
              onRefreshPowerShellPreflight={shell.refreshPowerShellPreflight}
              onInstallDependencies={shell.handleInstallDependencies}
              onInstallKimi={shell.handleInstallKimi}
              onUpgradeKimi={shell.handleUpgradeKimi}
              onInstallNodejs={shell.handleInstallNodejs}
              onOpenInstallFlow={shell.handleOpenInstallFlow}
              onCloseInstallFlow={shell.handleCloseInstallFlow}
              onStartInstallTask={shell.handleStartInstallTask}
              onCancelInstallTask={shell.handleCancelInstallTask}
              onOpenInstallCommands={shell.handleOpenInstallCommands}
              onCloseInstallCommands={shell.handleCloseInstallCommands}
              onCompleteOnboarding={shell.handleCompleteOnboarding}
              onSkipOnboarding={shell.handleSkipOnboarding}
              onOpenExternalUrl={shell.handleOpenExternalUrl}
            />
          </div>
        </div>
      ) : null}

      {shell.skillCenterGitDialogOpen ? (
        <div className="skill-center-dialog-overlay" role="presentation">
          <div
            className="skill-center-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-label="从 Git 安装 Skill"
          >
            <h3>从 Git 安装 Skill</h3>
            <p>输入仓库地址；Ref 可选，支持分支、tag 或 commit。</p>
            <div className="skill-center-dialog-fields">
              <label className="skill-center-dialog-field">
                <span>仓库地址</span>
                <Input
                  value={shell.skillCenterGitRepoUrl}
                  onChange={(event) => shell.setSkillCenterGitRepoUrl(event.target.value)}
                  placeholder="https://github.com/owner/repo.git"
                  autoFocus
                />
              </label>
              <label className="skill-center-dialog-field">
                <span>Ref（可选）</span>
                <Input
                  value={shell.skillCenterGitRef}
                  onChange={(event) => shell.setSkillCenterGitRef(event.target.value)}
                  placeholder="main / v1.0.0 / commit sha"
                />
              </label>
            </div>
            <div className="skill-center-dialog-actions">
              <Button
                type="button"
                variant="outline"
                onClick={shell.handleCloseSkillCenterGitDialog}
                disabled={shell.skillCenterBusy}
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void shell.handleConfirmInstallSkillFromGit();
                }}
                disabled={shell.skillCenterBusy}
              >
                从 Git 安装
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {shell.skillCenterImportDialogOpen ? (
        <div className="skill-center-dialog-overlay" role="presentation">
          <div
            className="skill-center-dialog-card"
            role="dialog"
            aria-modal="true"
            aria-label="导入本地 Skill"
          >
            <h3>导入本地 Skill</h3>
            <p>选择要导入的来源类型，然后继续选择目录或 ZIP 文件。</p>
            <div className="skill-center-import-choice-grid">
              <button
                type="button"
                className="skill-center-import-choice"
                onClick={() => {
                  void shell.handleConfirmImportSkillFromPath("directory");
                }}
                disabled={shell.skillCenterBusy}
              >
                <strong>导入目录</strong>
                <span>选择包含 `SKILL.md` 的本地 Skill 目录。</span>
              </button>
              <button
                type="button"
                className="skill-center-import-choice"
                onClick={() => {
                  void shell.handleConfirmImportSkillFromPath("zip");
                }}
                disabled={shell.skillCenterBusy}
              >
                <strong>导入 ZIP</strong>
                <span>选择本地 Skill ZIP 压缩包并导入。</span>
              </button>
            </div>
            <div className="skill-center-dialog-actions">
              <Button
                type="button"
                variant="outline"
                onClick={shell.handleCloseSkillCenterImportDialog}
                disabled={shell.skillCenterBusy}
              >
                取消
              </Button>
            </div>
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
