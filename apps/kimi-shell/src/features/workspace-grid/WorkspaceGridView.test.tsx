// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceViewProps } from "@/features/workspace/WorkspaceView";
import {
  createEmbeddedExternalWebview,
  openExternalWebviewWindow,
} from "@/services/externalWebviewService";
import { createGridSession } from "@/services/workspaceGridService";
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
  themeMode: "light",
  workspaceIframeRef: createRef<HTMLIFrameElement>(),
  chatIframeRef: createRef<HTMLIFrameElement>(),
  codePaneState: "ready",
  chatPaneState: "ready",
  actionBusy: false,
  onRetry: vi.fn(),
  onOpenLogs: vi.fn(),
  onOpenFolder: vi.fn(),
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
    vi.clearAllMocks();
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

  it("does not offer Kimi.com as an empty-pane or header action", () => {
    useWorkspaceGridStore.getState().setPreset("1x3");
    render(<WorkspaceGridView {...props} />);

    expect(screen.queryByRole("button", { name: "Kimi.com" })).toBeNull();
    expect(screen.queryByRole("button", { name: "切换为 Kimi.com" })).toBeNull();
    expect(screen.getByRole("button", { name: "Code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat" })).toBeTruthy();
  });

  it("switches an existing pane to Code without creating a server session", async () => {
    render(<WorkspaceGridView {...props} />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "切换为 Code" })[1]);
    });

    const pane = useWorkspaceGridStore
      .getState()
      .panes.find((item) => item.id === "pane-chat");
    expect(createGridSession).not.toHaveBeenCalled();
    expect(pane).toMatchObject({
      kind: "code",
      sessionId: undefined,
      title: "Kimi Code",
      workDir: "D:/work",
    });
  });

  it("adds empty Code panes as root Kimi Code Web iframes without sessions", async () => {
    useWorkspaceGridStore.getState().setPreset("1x3");
    render(<WorkspaceGridView {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Code" }));
    });

    const pane = useWorkspaceGridStore
      .getState()
      .panes.find((item) => item.id !== "pane-code" && item.kind === "code");
    expect(createGridSession).not.toHaveBeenCalled();
    expect(pane).toMatchObject({
      sessionId: undefined,
      workDir: "D:/work",
    });
    expect(
      document.querySelector(
        'iframe[src="http://127.0.0.1:1234/#token=secret"]',
      ),
    ).toBeTruthy();
  });

  it("adds panes to the clicked empty fourth slot", async () => {
    useWorkspaceGridStore.getState().setPreset("2x2");
    render(<WorkspaceGridView {...props} />);

    const emptyCodeButtons = screen.getAllByRole("button", { name: "Code" });
    await act(async () => {
      fireEvent.click(emptyCodeButtons[1]);
    });

    const state = useWorkspaceGridStore.getState();
    const bottomLeft = state.slots.find((slot) => slot.id === "bottom-left");
    const bottomRight = state.slots.find((slot) => slot.id === "bottom-right");
    const bottomRightPane = state.panes.find(
      (pane) => pane.id === bottomRight?.paneId,
    );

    expect(bottomLeft?.paneId).toBeUndefined();
    expect(bottomRightPane).toMatchObject({
      kind: "code",
      sessionId: undefined,
      workDir: "D:/work",
    });
  });

  it("opens the current Code pane work directory from the pane header", () => {
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "打开此窗格目录" }));

    expect(props.onOpenFolder).toHaveBeenCalledWith("D:/work");
  });

  it("stores an explicit theme only for the clicked pane", () => {
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(
      screen.getAllByRole("button", { name: "切换此窗格为深色主题" })[0],
    );

    const state = useWorkspaceGridStore.getState();
    expect(state.panes.find((pane) => pane.id === "pane-code")?.theme).toBe(
      "dark",
    );
    expect(state.panes.find((pane) => pane.id === "pane-chat")?.theme).toBeUndefined();
  });

  it("swaps panes by dragging one pane header onto another slot", () => {
    render(<WorkspaceGridView {...props} />);

    const headers = document.querySelectorAll(".workspace-grid-pane-header");
    const slots = document.querySelectorAll(".workspace-grid-slot");
    const transfer = createDataTransfer();

    fireEvent.dragStart(headers[0]!, { dataTransfer: transfer });
    fireEvent.dragOver(slots[1]!, { dataTransfer: transfer });
    fireEvent.drop(slots[1]!, { dataTransfer: transfer });

    expect(useWorkspaceGridStore.getState().slots.map((slot) => slot.paneId)).toEqual([
      "pane-chat",
      "pane-code",
    ]);
  });

  it("can suspend and resume a pane", () => {
    render(<WorkspaceGridView {...props} />);

    fireEvent.click(screen.getAllByRole("button", { name: "挂起窗格" })[0]);

    expect(screen.getByText("窗格已挂起")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复窗格" }));
    expect(useWorkspaceGridStore.getState().panes[0]?.mountPolicy).toBe("eager");
  });

  it("does not render the custom layout toolbar", () => {
    render(<WorkspaceGridView {...props} />);

    expect(screen.queryByRole("button", { name: "保存布局" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "保存的工作区布局" })).toBeNull();
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
      1.333,
      0.667,
    ]);
  });

  it("opens blocked external panes in a Tauri webview window", () => {
    vi.useFakeTimers();
    const externalPane = addExternalPaneToGrid();
    render(<WorkspaceGridView {...props} />);

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
    const externalPane = addExternalPaneToGrid();
    render(<WorkspaceGridView {...props} />);

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
    expect(screen.getByText("example.com 已由嵌入式 Webview 承载")).toBeTruthy();
    expect(
      document.querySelector('iframe[src="https://example.com/path"]'),
    ).toBeNull();
  });
});

function pointerEvent(type: string, clientX: number): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

function createDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    dropEffect: "none",
    effectAllowed: "none",
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    clearData: vi.fn((format?: string) => {
      if (format) {
        values.delete(format);
        return;
      }
      values.clear();
    }),
    getData: vi.fn((format: string) => values.get(format) ?? ""),
    setData: vi.fn((format: string, data: string) => {
      values.set(format, data);
    }),
    setDragImage: vi.fn(),
  };
}

function addExternalPaneToGrid() {
  const store = useWorkspaceGridStore.getState();
  store.setPreset("1x3");
  const paneId = store.addPane({
    kind: "external",
    title: "example.com",
    url: "https://example.com/path",
  });
  const pane = useWorkspaceGridStore
    .getState()
    .panes.find((item) => item.id === paneId);
  if (!pane) {
    throw new Error("external pane was not added");
  }
  return pane;
}
