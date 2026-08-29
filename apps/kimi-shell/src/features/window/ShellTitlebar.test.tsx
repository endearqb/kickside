// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  effectiveWorkDir: "D:/work",
  statusText: "运行中",
  shellScreenLabel: "工作区",
  actionBusy: false,
  tauriRuntime: false,
  nativeWindowControls: false,
  isWindowMaximized: false,
  canOpenWorkspace: true,
  agentRoomEnabled: false,
  onRetry: vi.fn(),
  onBackToStatus: vi.fn(),
  onOpenControlCenter: vi.fn(),
  onOpenAgentRoom: vi.fn(),
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

  it("creates KimiCode and KimiChat panes from the vertical branded menu", () => {
    const { container } = render(<ShellTitlebar {...titlebarProps} />);

    expect(screen.queryByRole("button", { name: /选择工作区布局/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建窗格" }));

    expect(screen.getByRole("menu", { name: "新建窗格" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);

    expect(container.querySelectorAll('.titlebar-pane-popover [data-backend-brand="kimi"]')).toHaveLength(2);
    fireEvent.click(screen.getByRole("menuitem", { name: "KimiCode" }));

    const state = useWorkspaceGridStore.getState();
    const firstPane = state.panes.find(
      (pane) => pane.id === state.slots[0]?.paneId,
    );
    expect(state.preset).toBe("1x3");
    expect(firstPane).toMatchObject({ kind: "code", workDir: "D:/work" });
    expect(screen.queryByRole("menu", { name: "新建窗格" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "新建窗格" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "KimiChat" }));
    const nextState = useWorkspaceGridStore.getState();
    expect(
      nextState.panes.find((pane) => pane.id === nextState.slots[0]?.paneId)?.kind,
    ).toBe("chat");
  });

  it("shows a persistent remote-control state without exposing its URL", () => {
    render(
      <ShellTitlebar
        {...titlebarProps}
        kimiAccessStatus={{
          mode: "kimi_remote",
          switching: false,
          runtimeOwnership: "owned_by_shell",
          runtimeReady: true,
          canChange: true,
          lanAddresses: [],
          remoteControlSupported: true,
          remoteControlState: "connected",
          remoteUrlAvailable: true,
        }}
      />,
    );

    expect(screen.getByText("Kimi 官方远程 · 运行中")).toBeTruthy();
    expect(screen.queryByText(/https:\/\//)).toBeNull();
  });

  it("exposes DSH only when enabled and routes creation through the owner callback", () => {
    const onCreateDshPane = vi.fn(async () => undefined);
    const { rerender } = render(<ShellTitlebar {...titlebarProps} />);
    fireEvent.click(screen.getByRole("button", { name: "新建窗格" }));
    expect(screen.queryByRole("menuitem", { name: /DeepSeek Harness/ })).toBeNull();

    rerender(
      <ShellTitlebar
        {...titlebarProps}
        dshEnabled
        onCreateDshPane={onCreateDshPane}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /DeepSeek Harness/ }));
    expect(onCreateDshPane).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "新建窗格" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /DeepSeek Harness/ }));
    expect(onCreateDshPane).toHaveBeenCalledTimes(2);
    expect(useWorkspaceGridStore.getState().panes.some((pane) => pane.kind === "dsh")).toBe(false);
  });

  it("opens Code, Chat, and the live DSH runtime from the titlebar browser menu", () => {
    const onOpenExternalUrl = vi.fn();
    const { rerender } = render(
      <ShellTitlebar
        {...titlebarProps}
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "在浏览器打开" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "KimiCode" }));
    expect(onOpenExternalUrl).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/#token=secret",
    );

    fireEvent.click(screen.getByRole("button", { name: "在浏览器打开" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "KimiChat" }));
    expect(onOpenExternalUrl).toHaveBeenCalledWith("https://www.kimi.com/");

    fireEvent.click(screen.getByRole("button", { name: "在浏览器打开" }));
    expect(screen.queryByRole("menuitem", { name: "DeepSeek Harness" })).toBeNull();

    rerender(
      <ShellTitlebar
        {...titlebarProps}
        dshEnabled
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );
    const unavailableDsh = screen.getByRole("menuitem", {
      name: "DeepSeek Harness",
    }) as HTMLButtonElement;
    expect(unavailableDsh.disabled).toBe(true);

    rerender(
      <ShellTitlebar
        {...titlebarProps}
        dshEnabled
        dshRemoteUrl="http://127.0.0.1:3080"
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "DeepSeek Harness" }));
    expect(onOpenExternalUrl).toHaveBeenLastCalledWith("http://127.0.0.1:3080");
    expect(screen.queryByRole("menu", { name: "在浏览器打开" })).toBeNull();
  });

  it("closes each titlebar menu when clicking elsewhere in the app", () => {
    render(<ShellTitlebar {...titlebarProps} />);

    fireEvent.click(screen.getByRole("button", { name: "新建窗格" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "新建窗格" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "新建窗格" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "新建窗格" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /打开窗格库/ }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "窗格库" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "在浏览器打开" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu", { name: "在浏览器打开" })).toBeNull();
  });

  it("disables pane creation at the twelve-pane total limit", () => {
    while (useWorkspaceGridStore.getState().panes.length < 12) {
      useWorkspaceGridStore.getState().addPane({ kind: "chat" });
    }

    render(<ShellTitlebar {...titlebarProps} />);

    const button = screen.getByRole("button", {
      name: "已达到 12 个窗格上限",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows only the current session directory name with its backend icon in the pane shelf", () => {
    const state = useWorkspaceGridStore.getState();
    const paneId = state.slots.find((slot) => slot.paneId)?.paneId;
    useWorkspaceGridStore.setState({
      panes: state.panes.map((pane) => pane.id === paneId
        ? { ...pane, workDir: "D:\\projects\\client\\current-session" }
        : pane),
    });
    render(<ShellTitlebar {...titlebarProps} />);

    fireEvent.click(screen.getByRole("button", { name: /打开窗格库/ }));

    expect(screen.getByText("current-session")).toBeTruthy();
    expect(screen.queryByText("D:\\projects\\client\\current-session")).toBeNull();
    expect(screen.getByRole("button", { name: "D:\\projects\\client\\current-session" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "D:\\projects\\client\\current-session" })
        .querySelector('[data-backend-brand="kimi"]'),
    ).toBeTruthy();
  });

  it("updates a DSH pane shelf title when its observed session directory changes", () => {
    const state = useWorkspaceGridStore.getState();
    const paneId = state.slots.find((slot) => slot.paneId)?.paneId;
    useWorkspaceGridStore.getState().configurePane(paneId!, {
      kind: "dsh",
      title: "DeepSeek Harness",
      workDir: "/Users/test/Skill-workspace",
    });
    render(<ShellTitlebar {...titlebarProps} />);

    act(() => {
      useWorkspaceGridStore.getState().setPaneWorkDir(
        paneId!,
        "/Users/test/MyProjects",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: /打开窗格库/ }));

    const paneButton = screen.getByRole("button", {
      name: "/Users/test/MyProjects",
    });
    expect(screen.getByText("MyProjects")).toBeTruthy();
    expect(paneButton.querySelector('[data-backend-brand="dsh"]')).toBeTruthy();
    expect(screen.queryByText("Skill-workspace")).toBeNull();
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

  it("does not expose the retired Agent Room entry", () => {
    render(<ShellTitlebar {...titlebarProps} />);
    expect(screen.queryByRole("button", { name: "打开 Agent Room" })).toBeNull();
  });

  it("uses native macOS controls instead of rendering Windows window buttons", () => {
    const { container } = render(
      <ShellTitlebar
        {...titlebarProps}
        tauriRuntime
        nativeWindowControls
      />,
    );

    expect(screen.queryByRole("button", { name: "最小化窗口" })).toBeNull();
    expect(screen.queryByRole("button", { name: "最大化窗口" })).toBeNull();
    expect(screen.queryByRole("button", { name: "关闭窗口" })).toBeNull();
    expect(screen.getByRole("button", { name: "打开控制中心" })).toBeTruthy();

    const header = container.querySelector(".titlebar.is-workspace");
    const appActions = header?.querySelector(".titlebar-actions.is-workspace");
    expect(appActions?.querySelectorAll("button")).toHaveLength(5);
    expect(appActions?.contains(screen.getByRole("button", { name: "打开控制中心" }))).toBe(true);
    expect(header?.querySelector(".titlebar-right")).toBeNull();
  });

  it("routes a primary-button double click on the macOS drag zone to window zoom", () => {
    const onTitlebarDoubleClick = vi.fn();
    const { container } = render(
      <ShellTitlebar
        {...titlebarProps}
        tauriRuntime
        nativeWindowControls
        onTitlebarDoubleClick={onTitlebarDoubleClick}
      />,
    );

    const dragZone = container.querySelector(".titlebar-workspace-drag-zone");
    expect(dragZone).toBeTruthy();
    fireEvent.doubleClick(dragZone!, { button: 0 });

    expect(onTitlebarDoubleClick).toHaveBeenCalledOnce();
  });
});
