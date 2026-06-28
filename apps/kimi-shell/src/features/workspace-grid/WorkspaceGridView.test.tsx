// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceViewProps } from "@/features/workspace/WorkspaceView";
import {
  createEmbeddedExternalWebview,
  openExternalWebviewWindow,
} from "@/services/externalWebviewService";
import { createDefaultWorkspaceGridState } from "./gridMigration";
import { useWorkspaceGridStore } from "./gridStore";
import { WorkspaceGridView } from "./WorkspaceGridView";

vi.mock("@/services/externalWebviewService", () => ({
  createEmbeddedExternalWebview: vi.fn(async () => ({
    close: vi.fn(async () => undefined),
    sync: vi.fn(async () => undefined),
  })),
  openExternalWebviewWindow: vi.fn(async () => undefined),
}));

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
    vi.useRealTimers();
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

  it("persists column resize from a drag handle", () => {
    useWorkspaceGridStore.getState().setPreset("1x3");
    render(<WorkspaceGridView {...props} />);
    const canvas = document.querySelector(".workspace-grid-canvas") as HTMLDivElement;
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 900,
        height: 600,
        top: 0,
        right: 900,
        bottom: 600,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent(
      screen.getByRole("button", { name: "调整列 1" }),
      pointerEvent("pointerdown", 300),
    );
    fireEvent(canvas, pointerEvent("pointermove", 450));
    fireEvent(canvas, pointerEvent("pointerup", 450));

    expect(useWorkspaceGridStore.getState().trackSizes?.columns).toEqual([
      1.5,
      0.5,
      1,
    ]);
  });

  it("opens blocked external panes in a Tauri webview window", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com/path#secret");
    useWorkspaceGridStore.getState().setPreset("1x3");
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Kimi.com" }));
    const externalPane = useWorkspaceGridStore
      .getState()
      .panes.find((item) => item.kind === "external");
    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "在应用窗口打开" }));

    expect(openExternalWebviewWindow).toHaveBeenCalledWith({
      url: "https://example.com/path",
      title: "example.com",
      storageNamespace: externalPane?.storageNamespace,
    });
  });

  it("embeds blocked external panes in a child Tauri webview", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com/path#secret");
    useWorkspaceGridStore.getState().setPreset("1x3");
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Kimi.com" }));
    const externalPane = useWorkspaceGridStore
      .getState()
      .panes.find((item) => item.kind === "external");
    const embedHosts = document.querySelectorAll(".workspace-embed");
    const embedHost = embedHosts[embedHosts.length - 1] as HTMLDivElement;
    Object.defineProperty(embedHost, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        width: 420,
        height: 240,
        top: 20,
        right: 430,
        bottom: 260,
        left: 10,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "在窗格内打开" }));
    });

    expect(createEmbeddedExternalWebview).toHaveBeenCalledWith({
      url: "https://example.com/path",
      title: "example.com",
      storageNamespace: externalPane?.storageNamespace,
      bounds: {
        x: 10,
        y: 20,
        width: 420,
        height: 240,
      },
    });
  });
});

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}
