import type { MouseEvent } from "react";
import {
  ArrowLeftRight,
  Columns2,
  Copy,
  FolderOpen,
  MessageSquare,
  Minus,
  Monitor,
  RefreshCcw,
  Sparkles,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { KimiCliBrand } from "@/components/kimi-cli-brand";
import { IconButton } from "@/components/common/IconButton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type {
  BackendState,
  Screen,
  Theme,
  WorkspaceLayoutMode,
  WorkspaceSplitOrder,
  WorkspaceViewKind,
} from "@/app/types";

type ParsedPath = {
  fullPath: string;
  root: string;
  segments: string[];
  separator: "\\" | "/";
  caseInsensitive: boolean;
};

type WorkspacePathDisplay = {
  fullPath: string;
  prefix: string;
  leaf: string;
};

const DRAG_BLOCK_SELECTOR =
  ".titlebar-actions, .titlebar-window-controls, button, a, input, textarea, select, [role='button'], [data-no-drag='true']";

function isTitlebarDragTarget(target: EventTarget | null): boolean {
  return !(target instanceof Element && target.closest(DRAG_BLOCK_SELECTOR));
}

function parsePath(rawPath: string): ParsedPath {
  const fullPath = rawPath.trim();
  const normalizedInput = fullPath.replace(/\\/g, "/");
  let root = "";
  let normalized = normalizedInput;

  if (/^[A-Za-z]:\//.test(normalizedInput)) {
    root = normalizedInput.slice(0, 3);
    normalized = `${root}${normalizedInput.slice(3).replace(/\/+/g, "/")}`;
  } else if (normalizedInput.startsWith("//")) {
    const uncBody = normalizedInput.slice(2).replace(/\/+/g, "/");
    const uncSegments = uncBody.split("/").filter(Boolean);

    if (uncSegments.length >= 2) {
      root = `//${uncSegments[0]}/${uncSegments[1]}/`;
      normalized = `${root}${uncSegments.slice(2).join("/")}`;
    } else {
      root = "//";
      normalized = `//${uncSegments.join("/")}`;
    }
  } else if (normalizedInput.startsWith("/")) {
    root = "/";
    normalized = `/${normalizedInput.slice(1).replace(/\/+/g, "/")}`;
  } else {
    normalized = normalizedInput.replace(/\/+/g, "/");
  }

  if (normalized.length > root.length) {
    normalized = normalized.replace(/\/+$/, "");
  }

  const body = normalized.slice(root.length);
  return {
    fullPath,
    root,
    segments: body ? body.split("/").filter(Boolean) : [],
    separator: fullPath.includes("\\") || /^[A-Za-z]:/.test(fullPath) ? "\\" : "/",
    caseInsensitive: /^[A-Za-z]:/.test(fullPath) || fullPath.startsWith("\\\\"),
  };
}

function normalizeForCompare(value: string, caseInsensitive: boolean): string {
  return caseInsensitive ? value.toLowerCase() : value;
}

function isPathWithinBase(current: ParsedPath, base: ParsedPath): boolean {
  const compareCaseInsensitive = current.caseInsensitive || base.caseInsensitive;

  if (
    normalizeForCompare(current.root, compareCaseInsensitive) !==
    normalizeForCompare(base.root, compareCaseInsensitive)
  ) {
    return false;
  }

  if (base.segments.length > current.segments.length) {
    return false;
  }

  return base.segments.every(
    (segment, index) =>
      normalizeForCompare(segment, compareCaseInsensitive) ===
      normalizeForCompare(current.segments[index] ?? "", compareCaseInsensitive),
  );
}

function toDisplayRoot(root: string, separator: "\\" | "/"): string {
  return root.replace(/\//g, separator);
}

function getPathLeaf(path: ParsedPath): string {
  if (path.segments.length > 0) {
    return path.segments[path.segments.length - 1] ?? path.fullPath;
  }

  const rootDisplay = toDisplayRoot(path.root, path.separator);
  return rootDisplay || path.fullPath;
}

function splitDisplayPath(
  segments: string[],
  separator: "\\" | "/",
  rootDisplay = "",
): Pick<WorkspacePathDisplay, "prefix" | "leaf"> {
  if (segments.length === 0) {
    return { prefix: "", leaf: rootDisplay || "-" };
  }

  const leaf = segments[segments.length - 1] ?? "-";
  const prefixSegments = segments.slice(0, -1);
  let prefix = rootDisplay;

  if (prefixSegments.length > 0) {
    if (prefix && !prefix.endsWith(separator)) {
      prefix += separator;
    }
    prefix += prefixSegments.join(separator);
    prefix += separator;
  } else if (prefix && !prefix.endsWith(separator)) {
    prefix += separator;
  }

  return { prefix, leaf };
}

function formatWorkspacePath(
  activeSessionWorkDir?: string,
  effectiveWorkDir?: string,
): WorkspacePathDisplay {
  const currentPath = activeSessionWorkDir?.trim() || effectiveWorkDir?.trim();
  if (!currentPath) {
    return { fullPath: "-", prefix: "", leaf: "-" };
  }

  const parsedCurrentPath = parsePath(currentPath);
  const basePath = effectiveWorkDir?.trim();

  if (basePath) {
    const parsedBasePath = parsePath(basePath);
    if (isPathWithinBase(parsedCurrentPath, parsedBasePath)) {
      const relativeSegments = parsedCurrentPath.segments.slice(parsedBasePath.segments.length);
      if (relativeSegments.length === 0) {
        return {
          fullPath: parsedCurrentPath.fullPath,
          prefix: "",
          leaf: getPathLeaf(parsedCurrentPath),
        };
      }

      const relativeDisplay = splitDisplayPath(relativeSegments, parsedCurrentPath.separator);
      return {
        fullPath: parsedCurrentPath.fullPath,
        prefix: relativeDisplay.prefix,
        leaf: relativeDisplay.leaf,
      };
    }
  }

  const absoluteDisplay = splitDisplayPath(
    parsedCurrentPath.segments,
    parsedCurrentPath.separator,
    toDisplayRoot(parsedCurrentPath.root, parsedCurrentPath.separator),
  );
  return {
    fullPath: parsedCurrentPath.fullPath,
    prefix: absoluteDisplay.prefix,
    leaf: absoluteDisplay.leaf,
  };
}

type ShellTitlebarProps = {
  screen: Screen;
  backendState?: BackendState;
  themeMode: Theme;
  activeWorkspaceView: WorkspaceViewKind;
  workspaceLayoutMode: WorkspaceLayoutMode;
  workspaceSplitOrder: WorkspaceSplitOrder;
  statusText: string;
  shellScreenLabel: string;
  actionBusy: boolean;
  tauriRuntime: boolean;
  isWindowMaximized: boolean;
  canOpenWorkspace: boolean;
  sessionSkillCount: number;
  activeSessionWorkDir?: string;
  effectiveWorkDir?: string;
  onRetry: () => void;
  onBackToStatus: () => void;
  onOpenSkillCenter: () => void;
  onOpenFolder: (path: string) => void;
  onToggleWorkspaceView: () => void;
  onToggleWorkspaceSplit: () => void;
  onSwapWorkspaceSplitOrder: () => void;
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
  activeWorkspaceView,
  workspaceLayoutMode,
  workspaceSplitOrder,
  statusText,
  shellScreenLabel,
  actionBusy,
  tauriRuntime,
  isWindowMaximized,
  canOpenWorkspace,
  sessionSkillCount,
  activeSessionWorkDir,
  effectiveWorkDir,
  onRetry,
  onBackToStatus,
  onOpenSkillCenter,
  onOpenFolder,
  onToggleWorkspaceView,
  onToggleWorkspaceSplit,
  onSwapWorkspaceSplitOrder,
  onToggleTheme,
  onStartWindowDrag,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow,
  onTitlebarDoubleClick,
}: ShellTitlebarProps) {
  const workspacePathDisplay = formatWorkspacePath(activeSessionWorkDir, effectiveWorkDir);
  const sessionPath = activeSessionWorkDir?.trim() || "";
  const canOpenSessionPath = sessionPath.length > 0;
  const viewToggleLabel =
    activeWorkspaceView === "code"
      ? "当前显示 Kimi Code Web，切换到 Kimi Chat"
      : "当前显示 Kimi Chat，切换到 Kimi Code Web";
  const splitToggleLabel =
    workspaceLayoutMode === "split"
      ? "切回单栏视图"
      : "同时显示 Kimi Code Web 与 Kimi Chat";
  const swapSplitOrderLabel =
    workspaceSplitOrder === "code_left"
      ? "切换分栏顺序，将 Kimi Chat 移到左侧"
      : "切换分栏顺序，将 Kimi Code Web 移到左侧";

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
        {screen === "workspace" && workspaceLayoutMode !== "split" ? (
          <IconButton
            icon={
              activeWorkspaceView === "code" ? (
                <TerminalSquare size={14} />
              ) : (
                <MessageSquare size={14} />
              )
            }
            label={viewToggleLabel}
            onClick={onToggleWorkspaceView}
            className={`ghost mini titlebar-workspace-toggle ${activeWorkspaceView === "chat" ? "is-chat" : "is-code"}`}
          />
        ) : null}
        {screen === "workspace" ? (
          <IconButton
            icon={<Columns2 size={14} />}
            label={splitToggleLabel}
            onClick={onToggleWorkspaceSplit}
            className={`ghost mini titlebar-split-btn ${workspaceLayoutMode === "split" ? "is-active" : ""}`}
          />
        ) : null}
        {screen === "workspace" && workspaceLayoutMode === "split" ? (
          <IconButton
            icon={<ArrowLeftRight size={14} />}
            label={swapSplitOrderLabel}
            onClick={onSwapWorkspaceSplitOrder}
            className="ghost mini titlebar-swap-btn"
          />
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
          <div className="titlebar-workspace-line">
            <div
              className="titlebar-drag titlebar-workspace-main"
              onMouseDown={handleDragZoneMouseDown}
              onDoubleClick={handleDragZoneDoubleClick}
            >
              <span>工作区</span>
              <span className="titlebar-workspace-divider" aria-hidden>
                |
              </span>
              <span
                className="titlebar-workspace-path"
                dir="ltr"
                title={workspacePathDisplay.fullPath}
              >
                {workspacePathDisplay.prefix ? (
                  <span className="titlebar-workspace-path-prefix">
                    {workspacePathDisplay.prefix}
                  </span>
                ) : null}
                <span className="titlebar-workspace-path-leaf">
                  {workspacePathDisplay.leaf}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <div
            className="titlebar-drag titlebar-status-wrap"
            onMouseDown={handleDragZoneMouseDown}
            onDoubleClick={handleDragZoneDoubleClick}
          >
            <KimiCliBrand compact className="titlebar-brand" />
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
              <>
                <IconButton
                  icon={<FolderOpen size={14} />}
                  label="打开当前会话目录"
                  onClick={() => onOpenFolder(sessionPath)}
                  className="ghost mini titlebar-path-btn"
                  disabled={!canOpenSessionPath}
                />
                <button
                  type="button"
                  className="titlebar-skill-btn"
                  onClick={onOpenSkillCenter}
                  aria-label="打开 Skill 投影与工作区管理"
                  title="打开 Skill 投影与工作区管理"
                >
                  <Sparkles size={14} />
                  <span>技能</span>
                  {sessionSkillCount > 0 ? (
                    <span className="titlebar-skill-badge">{sessionSkillCount}</span>
                  ) : null}
                </button>
              </>
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
