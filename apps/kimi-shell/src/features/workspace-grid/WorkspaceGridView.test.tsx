// @vitest-environment jsdom
import { createRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceViewProps } from "@/features/workspace/WorkspaceView";
import { createDefaultWorkspaceGridState } from "./gridMigration";
import { useWorkspaceGridStore } from "./gridStore";
import { WorkspaceGridView } from "./WorkspaceGridView";

vi.mock("@/services/workspaceGridService", () => ({
  createGridSession: vi.fn(async () => ({
    sessionId: "server-session-1",
    workDir: "D:/work",
    isRunning: true,
  })),
}));

const props: WorkspaceViewProps = {
  activeWorkspaceView: "code",
  workspaceLayoutMode: "split",
  workspaceSplitOrder: "code_left",
  workspaceSplitRatio: 0.5,
  isSplitDragging: false,
  codeRemoteUrl: "http://127.0.0.1:1234/#token=secret",
  codeFrameKey: "code",
  chatRemoteUrl: "https://www.kimi.com/",
  effectiveWorkDir: "D:/work",
  workspaceIframeRef: createRef<HTMLIFrameElement>(),
  chatIframeRef: createRef<HTMLIFrameElement>(),
  codePaneState: "ready",
  chatPaneState: "ready",
  actionBusy: false,
  onRetry: vi.fn(),
  onOpenLogs: vi.fn(),
  onOpenExternalUrl: vi.fn(),
  onSplitRatioChange: vi.fn(),
  onSplitDragStateChange: vi.fn(),
  onCodeFrameLoad: vi.fn(),
  onCodeFrameError: vi.fn(),
  onChatFrameLoad: vi.fn(),
  onChatFrameError: vi.fn(),
};

describe("WorkspaceGridView", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWorkspaceGridStore.setState(createDefaultWorkspaceGridState(100));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("moves active pane with arrow keys", () => {
    render(<WorkspaceGridView {...props} />);

    fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowRight" });

    expect(useWorkspaceGridStore.getState().activePaneId).toBe("pane-chat");
  });

  it("adds a custom external URL without persisting fragments", () => {
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com/path#token=secret");
    useWorkspaceGridStore.getState().setPreset("1x3");
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Kimi.com" }));

    const pane = useWorkspaceGridStore
      .getState()
      .panes.find((item) => item.kind === "external");
    expect(pane?.title).toBe("example.com");
    expect(pane?.url).toBe("https://example.com/path");
  });

  it("can suspend and resume a pane", () => {
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(screen.getAllByRole("button", { name: "挂起窗格" })[0]);

    expect(screen.getByText("窗格已挂起")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复窗格" }));
    expect(useWorkspaceGridStore.getState().panes[0]?.mountPolicy).toBe("eager");
  });

  it("saves and restores a named layout", () => {
    vi.spyOn(window, "prompt").mockReturnValue("双窗调试");
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "保存布局" }));
    const select = screen.getByRole("combobox", {
      name: "保存的工作区布局",
    }) as HTMLSelectElement;
    const savedLayoutId = select.value;

    fireEvent.click(screen.getByRole("button", { name: "三列" }));
    expect(useWorkspaceGridStore.getState().preset).toBe("1x3");

    fireEvent.change(select, { target: { value: "" } });
    fireEvent.change(select, { target: { value: savedLayoutId } });
    expect(useWorkspaceGridStore.getState().preset).toBe("1x2");
  });
});
