import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect } from "react";
import {
  THEME_BRIDGE_SOURCE,
  THEME_SYNC_SOURCE,
  parseThemeMode,
} from "@/app/theme";
import type { Screen, Theme, WorkspaceEmbedState } from "@/app/types";

type UseWorkspaceThemeBridgeParams = {
  screen: Screen;
  workspaceEmbedState: WorkspaceEmbedState;
  workspaceOrigin: string | null;
  themeMode: Theme;
  workspaceIframeRef: RefObject<HTMLIFrameElement | null>;
  setThemeMode: Dispatch<SetStateAction<Theme>>;
};

export function useWorkspaceThemeBridge({
  screen,
  workspaceEmbedState,
  workspaceOrigin,
  themeMode,
  workspaceIframeRef,
  setThemeMode,
}: UseWorkspaceThemeBridgeParams) {
  const pushThemeToWorkspace = () => {
    if (workspaceEmbedState !== "ready") return;
    if (!workspaceOrigin) return;
    const frameWindow = workspaceIframeRef.current?.contentWindow;
    if (!frameWindow) return;
    try {
      frameWindow.postMessage(
        { source: THEME_SYNC_SOURCE, theme: themeMode },
        workspaceOrigin,
      );
    } catch {
      // iframe may still be at about:blank or navigating; next ready tick will retry.
    }
  };

  useEffect(() => {
    if (!workspaceOrigin) return;

    const handleWorkspaceThemeMessage = (event: MessageEvent) => {
      if (event.origin !== workspaceOrigin) return;

      const data = event.data as { source?: string; theme?: string } | null;
      if (!data || data.source !== THEME_BRIDGE_SOURCE) return;

      const nextMode = parseThemeMode(data.theme);
      if (!nextMode) return;
      setThemeMode((current) => (current === nextMode ? current : nextMode));
    };

    window.addEventListener("message", handleWorkspaceThemeMessage);
    return () =>
      window.removeEventListener("message", handleWorkspaceThemeMessage);
  }, [setThemeMode, workspaceOrigin]);

  useEffect(() => {
    if (screen !== "workspace" || workspaceEmbedState !== "ready") return;
    pushThemeToWorkspace();
  }, [screen, workspaceEmbedState, workspaceOrigin, themeMode]);

  return { pushThemeToWorkspace };
}
