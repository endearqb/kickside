import { useState, type MouseEvent } from "react";
import {
  Code2,
  Columns2,
  Copy,
  ExternalLink,
  MessageCircle,
  Minus,
  Monitor,
  RefreshCcw,
  Settings,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KimiAssistantBrand } from "@/components/kimi-code-brand";
import { IconButton } from "@/components/common/IconButton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { GRID_PRESETS } from "@/features/workspace-grid/gridPresets";
import { PaneShelf } from "@/features/workspace-grid/PaneShelf";
import { useWorkspaceGridStore } from "@/features/workspace-grid/gridStore";
import type {
  BackendState,
  Screen,
  Theme,
} from "@/app/types";
import type { WorkspaceGridPresetId } from "@/features/workspace-grid/gridTypes";

const DRAG_BLOCK_SELECTOR =
  ".titlebar-actions, .titlebar-window-controls, button, a, input, textarea, select, [role='button'], [data-no-drag='true']";
const WORKSPACE_GRID_PRESET_ORDER: WorkspaceGridPresetId[] = [
  "single",
  "1x2",
  "1x3",
  "2x2",
  "2x3-5",
  "2x3",
];

function isTitlebarDragTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element && target.closest(DRAG_BLOCK_SELECTOR));
}

type ShellTitlebarProps = {
  screen: Screen;
  backendState?: BackendState;
  themeMode: Theme;
  codeRemoteUrl: string | null;
  chatRemoteUrl: string;
  statusText: string;
  shellScreenLabel: string;
  actionBusy: boolean;
  tauriRuntime: boolean;
  isWindowMaximized: boolean;
  canOpenWorkspace: boolean;
  onRetry: () => void;
  onBackToStatus: () => void;
  onOpenControlCenter: () => void;
  onOpenExternalUrl: (url: string) => void;
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
  codeRemoteUrl,
  chatRemoteUrl,
  statusText,
  shellScreenLabel,
  actionBusy,
  tauriRuntime,
  isWindowMaximized,
  canOpenWorkspace,
  onRetry,
  onBackToStatus,
  onOpenControlCenter,
  onOpenExternalUrl,
  onToggleTheme,
  onStartWindowDrag,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow,
  onTitlebarDoubleClick,
}: ShellTitlebarProps) {
  const workspaceGridPreset = useWorkspaceGridStore((state) => state.preset);
  const setWorkspaceGridPreset = useWorkspaceGridStore((state) => state.setPreset);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const layoutToggleLabel = `选择工作区布局，当前 ${GRID_PRESETS[workspaceGridPreset].label}`;

  const handleDragZoneMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (!tauriRuntime) return;
    if (event.button !== 0) return;
    if (!isTitlebarDragTarget(event.target)) return;
    onStartWindowDrag();
  };

  const handleDragZoneDoubleClick = (event: MouseEvent<HTMLElement>) => {
    if (!tauriRuntime) return;
    if (event.button !== 0) return;
    if (!isTitlebarDragTarget(event.target)) return;
    onTitlebarDoubleClick();
  };

  return (
    <header className="titlebar">
      <div className="titlebar-actions" data-no-drag="true">
        {screen === "control_center" && canOpenWorkspace ? (
          <IconButton
            icon={<Monitor size={14} />}
            label="返回工作区"
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
            aria-label="重试后端启动"
            title="重试后端启动"
          />
        ) : null}
        {screen === "workspace" ? (
          <div className="titlebar-layout-menu-wrap">
            <IconButton
              icon={<Columns2 size={14} />}
              label={layoutToggleLabel}
              onClick={() => {
                setBrowserMenuOpen(false);
                setLayoutMenuOpen((current) => !current);
              }}
              className={`ghost mini titlebar-layout-btn ${layoutMenuOpen ? "is-active" : ""}`}
            />
            {layoutMenuOpen ? (
              <div className="titlebar-layout-popover" role="menu" aria-label="选择工作区布局">
                {WORKSPACE_GRID_PRESET_ORDER.map((presetId) => {
                  const preset = GRID_PRESETS[presetId];
                  const active = presetId === workspaceGridPreset;
                  return (
                    <button
                      type="button"
                      key={presetId}
                      className={`titlebar-layout-option${active ? " is-active" : ""}`}
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        setWorkspaceGridPreset(presetId);
                        setLayoutMenuOpen(false);
                      }}
                    >
                      <span className="titlebar-layout-option-count">
                        {preset.slots.length}
                      </span>
                      <span className="titlebar-layout-option-label">{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
        {screen === "workspace" ? <PaneShelf /> : null}
        {screen === "workspace" ? (
          <div className="titlebar-layout-menu-wrap">
            <IconButton
              icon={<ExternalLink size={14} />}
              label="在浏览器打开"
              onClick={() => {
                setLayoutMenuOpen(false);
                setBrowserMenuOpen((current) => !current);
              }}
              className={`ghost mini titlebar-browser-btn ${browserMenuOpen ? "is-active" : ""}`}
            />
            {browserMenuOpen ? (
              <div className="titlebar-browser-popover" role="menu" aria-label="在浏览器打开">
                <button
                  type="button"
                  className="titlebar-browser-option"
                  role="menuitem"
                  disabled={!codeRemoteUrl}
                  onClick={() => {
                    if (!codeRemoteUrl) {
                      return;
                    }
                    onOpenExternalUrl(codeRemoteUrl);
                    setBrowserMenuOpen(false);
                  }}
                >
                  <Code2 size={14} aria-hidden />
                  <span>Code</span>
                </button>
                <button
                  type="button"
                  className="titlebar-browser-option"
                  role="menuitem"
                  onClick={() => {
                    onOpenExternalUrl(chatRemoteUrl);
                    setBrowserMenuOpen(false);
                  }}
                >
                  <MessageCircle size={14} aria-hidden />
                  <span>Chat</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {screen === "workspace" ? (
          <ThemeToggle
            className="icon-btn mini"
            theme={themeMode}
            onToggle={onToggleTheme}
          />
        ) : null}
      </div>

      <div className={`titlebar-identity${screen === "workspace" ? " is-workspace" : ""}`}>
        {screen === "workspace" ? (
          <div
            className="titlebar-drag titlebar-workspace-drag-zone"
            onMouseDown={handleDragZoneMouseDown}
            onDoubleClick={handleDragZoneDoubleClick}
            aria-hidden="true"
          />
        ) : (
          <div
            className="titlebar-drag titlebar-status-wrap"
            onMouseDown={handleDragZoneMouseDown}
            onDoubleClick={handleDragZoneDoubleClick}
          >
            <KimiAssistantBrand compact className="titlebar-brand" />
            <span className="titlebar-app-status">
              {shellScreenLabel} | 状态：{statusText}
            </span>
          </div>
        )}
      </div>

      {tauriRuntime && (
        <div className="titlebar-right" data-no-drag="true">
          <div className="titlebar-utility-actions" data-no-drag="true">
            {screen !== "workspace" ? (
              <ThemeToggle
                className="icon-btn mini"
                theme={themeMode}
                onToggle={onToggleTheme}
              />
            ) : null}
            {screen === "workspace" ? (
              <IconButton
                icon={<Settings size={14} />}
                label="打开控制中心"
                onClick={onOpenControlCenter}
                className="ghost mini titlebar-settings-btn"
              />
            ) : null}
          </div>
          <div className="titlebar-window-controls" data-no-drag="true">
            <IconButton
              icon={<Minus size={14} />}
              label="最小化窗口"
              onClick={onMinimizeWindow}
              className="window-control-btn"
            />
            <IconButton
              icon={isWindowMaximized ? <Copy size={12} /> : <Square size={12} />}
              label={isWindowMaximized ? "还原窗口" : "最大化窗口"}
              onClick={onToggleMaximizeWindow}
              className="window-control-btn"
            />
            <IconButton
              icon={<X size={14} />}
              label="关闭窗口"
              onClick={onCloseWindow}
              className="window-control-btn close"
            />
          </div>
        </div>
      )}
    </header>
  );
}
