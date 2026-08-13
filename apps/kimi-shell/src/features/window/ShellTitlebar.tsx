import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  Code2,
  Copy,
  ExternalLink,
  MessageCircle,
  Minus,
  Monitor,
  Plus,
  RefreshCcw,
  Settings,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KimiAssistantBrand } from "@/components/kimi-code-brand";
import { IconButton } from "@/components/common/IconButton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { PaneShelf } from "@/features/workspace-grid/PaneShelf";
import {
  WORKSPACE_GRID_MAX_TOTAL_PANES,
  useWorkspaceGridStore,
} from "@/features/workspace-grid/gridStore";
import type {
  BackendState,
  Screen,
  Theme,
} from "@/app/types";

const DRAG_BLOCK_SELECTOR =
  ".titlebar-actions, .titlebar-window-controls, button, a, input, textarea, select, [role='button'], [data-no-drag='true']";
function isTitlebarDragTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element && target.closest(DRAG_BLOCK_SELECTOR));
}

type ShellTitlebarProps = {
  screen: Screen;
  backendState?: BackendState;
  themeMode: Theme;
  codeRemoteUrl: string | null;
  chatRemoteUrl: string;
  effectiveWorkDir?: string;
  statusText: string;
  shellScreenLabel: string;
  actionBusy: boolean;
  tauriRuntime: boolean;
  nativeWindowControls: boolean;
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
  effectiveWorkDir,
  statusText,
  shellScreenLabel,
  actionBusy,
  tauriRuntime,
  nativeWindowControls,
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
  const panes = useWorkspaceGridStore((state) => state.panes);
  const addPane = useWorkspaceGridStore((state) => state.addPane);
  const [paneMenuOpen, setPaneMenuOpen] = useState(false);
  const [browserMenuOpen, setBrowserMenuOpen] = useState(false);
  const paneMenuRef = useRef<HTMLDivElement>(null);
  const browserMenuRef = useRef<HTMLDivElement>(null);
  const canCreatePane = panes.length < WORKSPACE_GRID_MAX_TOTAL_PANES;

  useEffect(() => {
    if (!paneMenuOpen && !browserMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!paneMenuRef.current?.contains(target)) setPaneMenuOpen(false);
      if (!browserMenuRef.current?.contains(target)) setBrowserMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPaneMenuOpen(false);
        setBrowserMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [browserMenuOpen, paneMenuOpen]);

  const createPane = (kind: "code" | "chat") => {
    addPane(kind === "code" ? { kind, workDir: effectiveWorkDir } : { kind });
    setPaneMenuOpen(false);
  };

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

  const workspaceSettingsAction = screen === "workspace" && tauriRuntime ? (
    <IconButton
      icon={<Settings size={14} />}
      label="打开控制中心"
      onClick={onOpenControlCenter}
      className="ghost mini titlebar-settings-btn"
    />
  ) : null;

  return (
    <header className={`titlebar${screen === "workspace" ? " is-workspace" : ""}`}>
      <div
        className={`titlebar-actions${screen === "workspace" ? " is-workspace" : ""}`}
        data-no-drag="true"
      >
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
          <div ref={paneMenuRef} className="titlebar-layout-menu-wrap">
            <IconButton
              icon={<Plus size={14} />}
              label={canCreatePane ? "新建窗格" : "已达到 12 个窗格上限"}
              onClick={() => {
                setBrowserMenuOpen(false);
                setPaneMenuOpen((current) => !current);
              }}
              disabled={!canCreatePane}
              className={`ghost mini titlebar-pane-create-btn ${paneMenuOpen ? "is-active" : ""}`}
            />
            {paneMenuOpen ? (
              <div className="titlebar-pane-popover" role="menu" aria-label="新建窗格">
                <button
                  type="button"
                  className="titlebar-pane-option"
                  role="menuitem"
                  onClick={() => createPane("code")}
                >
                  <Code2 size={14} aria-hidden />
                  <span>Code</span>
                </button>
                <button
                  type="button"
                  className="titlebar-pane-option"
                  role="menuitem"
                  onClick={() => createPane("chat")}
                >
                  <MessageCircle size={14} aria-hidden />
                  <span>Chat</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {screen === "workspace" ? <PaneShelf /> : null}
        {screen === "workspace" ? (
          <div ref={browserMenuRef} className="titlebar-layout-menu-wrap">
            <IconButton
              icon={<ExternalLink size={14} />}
              label="在浏览器打开"
              onClick={() => {
                setPaneMenuOpen(false);
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
        {nativeWindowControls ? workspaceSettingsAction : null}
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

      {tauriRuntime && (!nativeWindowControls || screen !== "workspace") && (
        <div className="titlebar-right" data-no-drag="true">
          <div className="titlebar-utility-actions" data-no-drag="true">
            {screen !== "workspace" ? (
              <ThemeToggle
                className="icon-btn mini"
                theme={themeMode}
                onToggle={onToggleTheme}
              />
            ) : null}
            {!nativeWindowControls ? workspaceSettingsAction : null}
          </div>
          {!nativeWindowControls ? (
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
          ) : null}
        </div>
      )}
    </header>
  );
}
