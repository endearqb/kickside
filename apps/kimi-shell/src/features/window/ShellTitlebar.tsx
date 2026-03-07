import type { MouseEvent } from "react";
import { Copy, FolderOpen, Minus, Monitor, RefreshCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KimiCliBrand } from "@/components/kimi-cli-brand";
import { IconButton } from "@/components/common/IconButton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { BackendState, Screen, Theme } from "@/app/types";

const DRAG_BLOCK_SELECTOR =
  ".titlebar-actions, .titlebar-window-controls, button, a, input, textarea, select, [role='button'], [data-no-drag='true']";

function isTitlebarDragTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element && target.closest(DRAG_BLOCK_SELECTOR));
}

type ShellTitlebarProps = {
  screen: Screen;
  backendState?: BackendState;
  themeMode: Theme;
  statusText: string;
  shellScreenLabel: string;
  actionBusy: boolean;
  tauriRuntime: boolean;
  isWindowMaximized: boolean;
  canOpenWorkspace: boolean;
  activeSessionWorkDir?: string;
  effectiveWorkDir?: string;
  onRetry: () => void;
  onBackToStatus: () => void;
  onOpenFolder: (path: string) => void;
  onToggleTheme: () => void;
  onStartWindowDrag: () => void;
  onMinimizeWindow: () => void;
  onToggleMaximizeWindow: () => void;
  onCloseWindow: () => void;
  onTitlebarDoubleClick: () => void;
};

export function ShellTitlebar({
  screen,
  backendState,
  themeMode,
  statusText,
  shellScreenLabel,
  actionBusy,
  tauriRuntime,
  isWindowMaximized,
  canOpenWorkspace,
  activeSessionWorkDir,
  effectiveWorkDir,
  onRetry,
  onBackToStatus,
  onOpenFolder,
  onToggleTheme,
  onStartWindowDrag,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow,
  onTitlebarDoubleClick,
}: ShellTitlebarProps) {
  const sessionPath = activeSessionWorkDir?.trim();
  const fallbackPath = effectiveWorkDir?.trim();
  const effectivePath = sessionPath || fallbackPath || "-";
  const canOpenEffectivePath = Boolean(sessionPath || fallbackPath);

  const handleTitlebarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (!tauriRuntime) return;
    if (event.button !== 0) return;
    if (!isTitlebarDragTarget(event.target)) return;
    onStartWindowDrag();
  };

  const handleTitlebarDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!tauriRuntime) return;
    if (event.button !== 0) return;
    if (!isTitlebarDragTarget(event.target)) return;
    onTitlebarDoubleClick();
  };

  return (
    <header
      className="titlebar"
      onMouseDown={handleTitlebarMouseDown}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="titlebar-actions">
        {screen === "control_center" && canOpenWorkspace ? (
          <IconButton
            icon={<Monitor size={14} />}
            label="工作区"
            onClick={onBackToStatus}
            className="ghost mini titlebar-nav-btn"
          />
        ) : null}
        {backendState !== "running" ? (
          <Button
            type="button"
            variant="destructive"
            size="icon"
            icon={<RefreshCcw size={15} />}
            className="icon-btn mini titlebar-retry-btn"
            onClick={onRetry}
            disabled={actionBusy}
            aria-label="重启后端"
            title="重启后端"
          />
        ) : null}
        <ThemeToggle
          className="icon-btn mini"
          theme={themeMode}
          onToggle={onToggleTheme}
        />
      </div>

      <div className={`titlebar-identity${screen === "workspace" ? " is-workspace" : ""}`}>
        {screen === "workspace" ? (
          <div className="titlebar-workspace-line">
            <span className="titlebar-workspace-spacer" aria-hidden />
            <div className="titlebar-drag titlebar-workspace-main">
              <span>Workspace</span>
              <span className="titlebar-workspace-divider" aria-hidden>
                |
              </span>
              <span className="titlebar-workspace-path" title={effectivePath}>
                {effectivePath}
              </span>
            </div>
            <IconButton
              icon={<FolderOpen size={14} />}
              label="打开当前工作区路径"
              onClick={() => onOpenFolder(effectivePath)}
              className="ghost mini titlebar-path-btn"
              disabled={!canOpenEffectivePath}
            />
          </div>
        ) : (
          <div className="titlebar-drag titlebar-status-wrap">
            <KimiCliBrand compact className="titlebar-brand" />
            <span className="titlebar-app-status">
              {shellScreenLabel} | State: {statusText}
            </span>
          </div>
        )}
      </div>

      {tauriRuntime && (
        <div className="titlebar-window-controls">
          <IconButton
            icon={<Minus size={14} />}
            label="Minimize window"
            onClick={onMinimizeWindow}
            className="window-control-btn"
          />
          <IconButton
            icon={isWindowMaximized ? <Copy size={12} /> : <Square size={12} />}
            label={isWindowMaximized ? "Restore window" : "Maximize window"}
            onClick={onToggleMaximizeWindow}
            className="window-control-btn"
          />
          <IconButton
            icon={<X size={14} />}
            label="Close window"
            onClick={onCloseWindow}
            className="window-control-btn close"
          />
        </div>
      )}
    </header>
  );
}
