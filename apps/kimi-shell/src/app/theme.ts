import type { Theme } from "@/app/types";

export const THEME_STORAGE_KEY = "kimi-theme";
export const LEGACY_THEME_MODE_STORAGE_KEY = "kimi_shell_theme_mode";
export const THEME_BRIDGE_SOURCE = "kimi-shell-theme-bridge";
export const THEME_SYNC_SOURCE = "kimi-shell-theme-sync";

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
