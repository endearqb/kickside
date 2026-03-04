import { useShellController } from "@/app/useShellController";
import { formatBackendState } from "@/app/types";
import { ControlCenterView } from "@/features/control-center/ControlCenterView";
import { LoadingView } from "@/features/loading/LoadingView";
import { ShellTitlebar } from "@/features/window/ShellTitlebar";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import "./App.css";

function App() {
  const shell = useShellController();
  const statusChipClass =
    shell.status?.state === "running"
      ? "saved"
      : shell.status?.state === "crashed"
        ? "error"
        : "unsaved";

  return (
    <main
      className={`shell-root theme-${shell.themeMode} ${shell.screen === "workspace" ? "workspace-shell" : ""}`}
    >
      <ShellTitlebar
        screen={shell.screen}
        backendState={shell.status?.state}
        themeMode={shell.themeMode}
        statusText={shell.statusText}
        shellScreenLabel={shell.shellScreenLabel}
        actionBusy={shell.actionBusy}
        tauriRuntime={shell.tauriRuntime}
        isWindowMaximized={shell.isWindowMaximized}
        canOpenWorkspace={shell.canOpenWorkspace}
        effectiveWorkDir={shell.status?.effectiveWorkDir}
        onRetry={shell.handleRetry}
        onOpenControlCenter={shell.openControlCenter}
        onBackToStatus={shell.backToStatus}
        onOpenFolder={(path) => {
          void shell.handleOpenFolder(path);
        }}
        onToggleTheme={shell.handleToggleThemeMode}
        onStartWindowDrag={shell.handleStartWindowDrag}
        onMinimizeWindow={shell.handleMinimizeWindow}
        onToggleMaximizeWindow={shell.handleToggleMaximizeWindow}
        onCloseWindow={shell.handleCloseWindow}
        onTitlebarDoubleClick={shell.handleTitlebarDoubleClick}
      />

      {shell.actionError && <div className="shell-alert">{shell.actionError}</div>}

      {shell.screen === "workspace" ? (
        <WorkspaceView
          remoteUrl={shell.remoteUrl}
          workspaceIframeRef={shell.workspaceIframeRef}
          workspaceEmbedState={shell.workspaceEmbedState}
          actionBusy={shell.actionBusy}
          onRetry={shell.handleRetry}
          onOpenLogs={shell.handleOpenLogs}
          onOpenExternalUrl={shell.handleOpenExternalUrl}
          onFrameLoad={shell.handleWorkspaceFrameLoad}
          onFrameError={shell.handleWorkspaceFrameError}
        />
      ) : shell.screen === "loading" ? (
        <LoadingView
          status={shell.status}
          statusText={shell.statusText}
          remoteUrl={shell.remoteUrl}
          actionBusy={shell.actionBusy}
          workDirInput={shell.workDirInput}
          hotkeyOwnerLabel={shell.hotkeyOwnerLabel}
          onWorkDirChange={shell.setWorkDirInput}
          onRetry={shell.handleRetry}
          onOpenLogs={shell.handleOpenLogs}
          onOpenExternalUrl={shell.handleOpenExternalUrl}
          onPickWorkDir={shell.handlePickWorkDir}
          onSaveWorkDirAndRestart={shell.handleSaveWorkDirAndRestart}
          onClearWorkDir={shell.handleClearWorkDir}
        />
      ) : (
        <ControlCenterView
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
          installBusy={shell.installBusy}
          installMessage={shell.installMessage}
          onRefreshCoreState={shell.refreshCoreState}
          onRefreshDiagnostics={shell.refreshDiagnostics}
          onRefreshContextMenuStatus={shell.refreshContextMenuStatus}
          onRefreshOnboarding={shell.refreshOnboarding}
          onRetry={shell.handleRetry}
          onOpenLogs={shell.handleOpenLogs}
          onOpenFolder={shell.handleOpenFolder}
          onOpenKimiConfigDir={shell.handleOpenKimiConfigDir}
          onPickKimiPath={shell.handlePickKimiPath}
          onSavePathAndRetry={shell.handleSavePathAndRetry}
          onEnableContextMenu={shell.handleEnableContextMenu}
          onDisableContextMenu={shell.handleDisableContextMenu}
          onProbeLogin={shell.handleProbeLogin}
          onPickWorkDir={shell.handlePickWorkDir}
          onSaveWorkDirAndRestart={shell.handleSaveWorkDirAndRestart}
          onClearWorkDir={shell.handleClearWorkDir}
          onOpenConfigCenterModal={shell.handleOpenConfigCenterModal}
          onCloseConfigCenterModal={shell.handleCloseConfigCenterModal}
          onConfigCenterDraftChange={shell.handleConfigCenterDraftChange}
          onResetConfigCenterDraft={shell.handleResetConfigCenterDraft}
          onSaveKimiCliConfigCenter={shell.handleSaveKimiCliConfigCenter}
          onInstallSourceChange={shell.handleInstallSourceChange}
          onInstallDependencies={shell.handleInstallDependencies}
          onInstallKimi={shell.handleInstallKimi}
          onCompleteOnboarding={shell.handleCompleteOnboarding}
          onSkipOnboarding={shell.handleSkipOnboarding}
          onOpenExternalUrl={shell.handleOpenExternalUrl}
        />
      )}

      <footer className="statusbar" aria-live="polite">
        <div className="statusbar-left">
          <span className={`status-indicator ${statusChipClass}`}>
            {formatBackendState(shell.status?.state)}
          </span>
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
