import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { useShellController } from "@/app/useShellController";
import { formatBackendState } from "@/app/types";
import { IconButton } from "@/components/common/IconButton";
import { ControlCenterView } from "@/features/control-center/ControlCenterView";
import { LoadingView } from "@/features/loading/LoadingView";
import { ShellTitlebar } from "@/features/window/ShellTitlebar";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import { pickRandomAgentTip, type AgentTip } from "@/lib/agentTips";
import "./App.css";

function App() {
  const shell = useShellController();
  const [shutdownTip, setShutdownTip] = useState<AgentTip | null>(null);
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
        activeSessionWorkDir={shell.status?.activeSessionWorkDir}
        effectiveWorkDir={shell.status?.effectiveWorkDir}
        onRetry={shell.handleRuntimeOnlyRetry}
        onBackToStatus={shell.backToStatus}
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
              bridgeSettings={shell.bridgeSettings}
              bridgeStatus={shell.bridgeStatus}
              bridgeOnboardingDraft={shell.bridgeOnboardingDraft}
              bridgeOnboardingDirty={shell.bridgeOnboardingDirty}
              bridgeOnboardingValidation={shell.bridgeOnboardingValidation}
              bridgeSessions={shell.bridgeSessions}
              bridgeBindings={shell.bridgeBindings}
              bridgeApprovals={shell.bridgeApprovals}
              bridgeLogTail={shell.bridgeLogTail}
              bridgeRecentErrors={shell.bridgeRecentErrors}
              bridgeSecretsMask={shell.bridgeSecretsMask}
              bridgeBusy={shell.bridgeBusy}
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
              onPickBridgeDefaultWorkDir={shell.handlePickBridgeDefaultWorkDir}
              onSaveWorkDirAndRestart={shell.handleSaveWorkDirAndRestart}
              onClearWorkDir={shell.handleClearWorkDir}
              onBridgeSettingsChange={shell.handleBridgeSettingsChange}
              onBridgeOnboardingDraftChange={shell.handleBridgeOnboardingDraftChange}
              onSaveBridgeOnboarding={shell.handleSaveBridgeOnboarding}
              onSaveBridgeSettings={shell.handleSaveBridgeSettings}
              onStartBridge={shell.handleStartBridge}
              onStopBridge={shell.handleStopBridge}
              onRestartBridge={shell.handleRestartBridge}
              onImportBridgeSession={shell.handleImportBridgeSession}
              onClearBridgeBinding={shell.handleClearBridgeBinding}
              onResolveBridgeApproval={shell.handleResolveBridgeApproval}
              onOpenConfigCenterModal={shell.handleOpenConfigCenterModal}
              onCloseConfigCenterModal={shell.handleCloseConfigCenterModal}
              onConfigCenterDraftChange={shell.handleConfigCenterDraftChange}
              onResetConfigCenterDraft={shell.handleResetConfigCenterDraft}
              onSaveKimiCliConfigCenter={shell.handleSaveKimiCliConfigCenter}
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
              bridgeSettings={shell.bridgeSettings}
              bridgeStatus={shell.bridgeStatus}
              bridgeOnboardingDraft={shell.bridgeOnboardingDraft}
              bridgeOnboardingDirty={shell.bridgeOnboardingDirty}
              bridgeOnboardingValidation={shell.bridgeOnboardingValidation}
              bridgeSessions={shell.bridgeSessions}
              bridgeBindings={shell.bridgeBindings}
              bridgeApprovals={shell.bridgeApprovals}
              bridgeLogTail={shell.bridgeLogTail}
              bridgeRecentErrors={shell.bridgeRecentErrors}
              bridgeSecretsMask={shell.bridgeSecretsMask}
              bridgeBusy={shell.bridgeBusy}
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
              onPickBridgeDefaultWorkDir={shell.handlePickBridgeDefaultWorkDir}
              onSaveWorkDirAndRestart={shell.handleSaveWorkDirAndRestart}
              onClearWorkDir={shell.handleClearWorkDir}
              onBridgeSettingsChange={shell.handleBridgeSettingsChange}
              onBridgeOnboardingDraftChange={shell.handleBridgeOnboardingDraftChange}
              onSaveBridgeOnboarding={shell.handleSaveBridgeOnboarding}
              onSaveBridgeSettings={shell.handleSaveBridgeSettings}
              onStartBridge={shell.handleStartBridge}
              onStopBridge={shell.handleStopBridge}
              onRestartBridge={shell.handleRestartBridge}
              onImportBridgeSession={shell.handleImportBridgeSession}
              onClearBridgeBinding={shell.handleClearBridgeBinding}
              onResolveBridgeApproval={shell.handleResolveBridgeApproval}
              onOpenConfigCenterModal={shell.handleOpenConfigCenterModal}
              onCloseConfigCenterModal={shell.handleCloseConfigCenterModal}
              onConfigCenterDraftChange={shell.handleConfigCenterDraftChange}
              onResetConfigCenterDraft={shell.handleResetConfigCenterDraft}
              onSaveKimiCliConfigCenter={shell.handleSaveKimiCliConfigCenter}
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
