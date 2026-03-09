import type {
  Theme,
  WorkspaceLayoutMode,
  WorkspaceSplitOrder,
  WorkspaceViewKind,
} from "@/app/types";

export const THEME_STORAGE_KEY = "kimi-theme";
export const LEGACY_THEME_MODE_STORAGE_KEY = "kimi_shell_theme_mode";
export const THEME_BRIDGE_SOURCE = "kimi-shell-theme-bridge";
export const THEME_SYNC_SOURCE = "kimi-shell-theme-sync";
export const PREFILL_SYNC_SOURCE = "kimi-shell-prefill-sync";
export const PREFILL_BRIDGE_SOURCE = "kimi-shell-prefill-bridge";
export const EXTERNAL_LINK_BRIDGE_SOURCE = "kimi-shell-external-link-bridge";
export const CHAT_EXTERNAL_LINK_BRIDGE_SOURCE =
  "kimi-shell-chat-external-link-bridge";
export const SESSION_SYNC_SOURCE = "kimi-shell-session-sync";
export const SESSION_BRIDGE_SOURCE = "kimi-shell-session-bridge";
export const WORKSPACE_ACTIVE_VIEW_STORAGE_KEY = "kimi-workspace-active-view";
export const WORKSPACE_LAYOUT_MODE_STORAGE_KEY = "kimi-workspace-layout-mode";
export const WORKSPACE_SPLIT_ORDER_STORAGE_KEY = "kimi-workspace-split-order";
export const WORKSPACE_SPLIT_RATIO_STORAGE_KEY = "kimi-workspace-split-ratio";
export const WORKSPACE_SPLIT_RATIO_MIN = 1 / 3;
export const WORKSPACE_SPLIT_RATIO_MAX = 2 / 3;
export const WORKSPACE_SPLIT_RATIO_DEFAULT = 0.5;

export function getInitialThemeMode(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }

    const legacy = window.localStorage.getItem(LEGACY_THEME_MODE_STORAGE_KEY);
    if (legacy === "light" || legacy === "dark") {
      return legacy;
    }
  } catch {
    // Ignore storage errors.
  }

  return "light";
}

export function parseThemeMode(value?: string): Theme | null {
  if (value === "light" || value === "dark") {
    return value;
  }
  return null;
}

export function getInitialWorkspaceView(): WorkspaceViewKind {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_ACTIVE_VIEW_STORAGE_KEY);
    return parseWorkspaceViewKind(stored) ?? "code";
  } catch {
    return "code";
  }
}

export function getInitialWorkspaceLayoutMode(): WorkspaceLayoutMode {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_LAYOUT_MODE_STORAGE_KEY);
    return parseWorkspaceLayoutMode(stored) ?? "single";
  } catch {
    return "single";
  }
}

export function parseWorkspaceViewKind(value?: string | null): WorkspaceViewKind | null {
  if (value === "code" || value === "chat") {
    return value;
  }
  return null;
}

export function parseWorkspaceLayoutMode(
  value?: string | null,
): WorkspaceLayoutMode | null {
  if (value === "single" || value === "split") {
    return value;
  }
  return null;
}

export function clampWorkspaceSplitRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return WORKSPACE_SPLIT_RATIO_DEFAULT;
  }

  return Math.min(
    WORKSPACE_SPLIT_RATIO_MAX,
    Math.max(WORKSPACE_SPLIT_RATIO_MIN, value),
  );
}

export function parseWorkspaceSplitOrder(
  value?: string | null,
): WorkspaceSplitOrder | null {
  if (value === "code_left" || value === "chat_left") {
    return value;
  }
  return null;
}

export function getInitialWorkspaceSplitOrder(): WorkspaceSplitOrder {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_SPLIT_ORDER_STORAGE_KEY);
    return parseWorkspaceSplitOrder(stored) ?? "code_left";
  } catch {
    return "code_left";
  }
}

export function parseWorkspaceSplitRatio(value?: string | null): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampWorkspaceSplitRatio(parsed);
}

export function getInitialWorkspaceSplitRatio(): number {
  try {
    const stored = window.localStorage.getItem(WORKSPACE_SPLIT_RATIO_STORAGE_KEY);
    return parseWorkspaceSplitRatio(stored) ?? WORKSPACE_SPLIT_RATIO_DEFAULT;
  } catch {
    return WORKSPACE_SPLIT_RATIO_DEFAULT;
  }
}
