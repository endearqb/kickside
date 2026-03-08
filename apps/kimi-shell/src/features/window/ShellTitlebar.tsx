import type { MouseEvent } from "react";
import { Copy, FolderOpen, Minus, Monitor, RefreshCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KimiCliBrand } from "@/components/kimi-cli-brand";
import { IconButton } from "@/components/common/IconButton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { BackendState, Screen, Theme } from "@/app/types";

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
  const workspacePathDisplay = formatWorkspacePath(activeSessionWorkDir, effectiveWorkDir);
  const canOpenEffectivePath = workspacePathDisplay.fullPath !== "-";

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
            label="Back to workspace"
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
            aria-label="Retry backend startup"
            title="Retry backend startup"
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
            <IconButton
              icon={<FolderOpen size={14} />}
              label="Open current workspace path"
              onClick={() => onOpenFolder(workspacePathDisplay.fullPath)}
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
