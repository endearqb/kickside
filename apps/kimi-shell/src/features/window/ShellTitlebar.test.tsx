// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspaceGridState } from "@/features/workspace-grid/gridMigration";
import { useWorkspaceGridStore } from "@/features/workspace-grid/gridStore";
import { ShellTitlebar } from "./ShellTitlebar";

const titlebarProps = {
  screen: "workspace" as const,
  backendState: "running" as const,
  themeMode: "light" as const,
  codeRemoteUrl: "http://127.0.0.1:1234/#token=secret",
  chatRemoteUrl: "https://www.kimi.com/",
  statusText: "运行中",
  shellScreenLabel: "工作区",
  actionBusy: false,
  tauriRuntime: false,
  isWindowMaximized: false,
  canOpenWorkspace: true,
  onRetry: vi.fn(),
  onBackToStatus: vi.fn(),
  onOpenControlCenter: vi.fn(),
  onOpenExternalUrl: vi.fn(),
  onToggleTheme: vi.fn(),
  onStartWindowDrag: vi.fn(),
  onMinimizeWindow: vi.fn(),
  onToggleMaximizeWindow: vi.fn(),
  onCloseWindow: vi.fn(),
  onTitlebarDoubleClick: vi.fn(),
};

describe("ShellTitlebar", () => {
  beforeEach(() => {
    useWorkspaceGridStore.setState(createDefaultWorkspaceGridState(100));
  });

  afterEach(() => {
    cleanup();
  });

  it("selects workspace grid layouts from a titlebar popover", () => {
    render(<ShellTitlebar {...titlebarProps} />);

    fireEvent.click(screen.getByRole("button", { name: /选择工作区布局/ }));

    expect(screen.getByRole("menu", { name: "选择工作区布局" })).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(6);

    fireEvent.click(screen.getByRole("menuitemradio", { name: /三窗布局/ }));

    expect(useWorkspaceGridStore.getState().preset).toBe("1x3");
    expect(screen.queryByRole("menu", { name: "选择工作区布局" })).toBeNull();
  });

  it("opens Code and Chat from the titlebar browser menu", () => {
    const onOpenExternalUrl = vi.fn();
    render(
      <ShellTitlebar
        {...titlebarProps}
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "在浏览器打开" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Code" }));
    expect(onOpenExternalUrl).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/#token=secret",
    );

    fireEvent.click(screen.getByRole("button", { name: "在浏览器打开" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Chat" }));
    expect(onOpenExternalUrl).toHaveBeenCalledWith("https://www.kimi.com/");
  });

  it("hides workspace title chrome and exposes control center instead of skills", () => {
    const onOpenControlCenter = vi.fn();
    render(
      <ShellTitlebar
        {...titlebarProps}
        tauriRuntime
        onOpenControlCenter={onOpenControlCenter}
      />,
    );

    expect(screen.queryByText("工作区")).toBeNull();
    expect(screen.queryByText("work")).toBeNull();
    expect(screen.queryByRole("button", { name: "打开当前会话目录" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "打开 Skill 投影与工作区管理" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "打开控制中心" }));
    expect(onOpenControlCenter).toHaveBeenCalled();
  });
});
