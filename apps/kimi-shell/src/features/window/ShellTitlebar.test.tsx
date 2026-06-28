// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspaceGridState } from "@/features/workspace-grid/gridMigration";
import { useWorkspaceGridStore } from "@/features/workspace-grid/gridStore";
import { ShellTitlebar } from "./ShellTitlebar";

describe("ShellTitlebar", () => {
  beforeEach(() => {
    useWorkspaceGridStore.setState(createDefaultWorkspaceGridState(100));
  });

  afterEach(() => {
    cleanup();
  });

  it("selects workspace grid layouts from a titlebar popover", () => {
    render(
      <ShellTitlebar
        screen="workspace"
        backendState="running"
        themeMode="light"
        activeWorkspaceView="code"
        workspaceLayoutMode="split"
        statusText="运行中"
        shellScreenLabel="工作区"
        actionBusy={false}
        tauriRuntime={false}
        isWindowMaximized={false}
        canOpenWorkspace
        sessionSkillCount={0}
        effectiveWorkDir="D:/work"
        onRetry={vi.fn()}
        onBackToStatus={vi.fn()}
        onOpenSkillCenter={vi.fn()}
        onOpenFolder={vi.fn()}
        onToggleWorkspaceView={vi.fn()}
        onToggleTheme={vi.fn()}
        onStartWindowDrag={vi.fn()}
        onMinimizeWindow={vi.fn()}
        onToggleMaximizeWindow={vi.fn()}
        onCloseWindow={vi.fn()}
        onTitlebarDoubleClick={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /选择工作区布局/ }));

    expect(screen.getByRole("menu", { name: "选择工作区布局" })).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(6);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /三窗布局/ }));

    expect(useWorkspaceGridStore.getState().preset).toBe("1x3");
    expect(screen.queryByRole("menu", { name: "选择工作区布局" })).toBeNull();
  });
});
