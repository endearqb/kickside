// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceViewProps } from "@/features/workspace/WorkspaceView";
import { getKimiAssistantDisplayName } from "@/lib/appBrand";
import {
  createEmbeddedExternalWebview,
  openExternalWebviewWindow,
} from "@/services/externalWebviewService";
import { createGridSession } from "@/services/workspaceGridService";
import { createDefaultWorkspaceGridState } from "./gridMigration";
import { useWorkspaceGridStore } from "./gridStore";
import { postThemeToFrame } from "./PaneFrame";
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
  workspaceBridgeNonce: "test-workspace-bridge-nonce",
  chatIframeRef: createRef<HTMLIFrameElement>(),
  codePaneState: "ready",
  chatPaneState: "ready",
  actionBusy: false,
  onRetry: vi.fn(),
  onOpenLogs: vi.fn(),
  onOpenPaneFolder: vi.fn(async () => undefined),
  onPaneSessionObserved: vi.fn(),
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
    if (typeof window.localStorage?.clear === "function") {
      window.localStorage.clear();
    }
    useWorkspaceGridStore.setState(createDefaultWorkspaceGridState(100));
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("moves active pane with arrow keys", () => {
    render(<WorkspaceGridView {...props} />);

    fireEvent.keyDown(screen.getByRole("region"), { key: "ArrowRight" });

    expect(useWorkspaceGridStore.getState().activePaneId).toBe("pane-chat");
  });

  it("does not use edge-to-edge chrome in the default multi-pane layout", () => {
    render(<WorkspaceGridView {...props} />);

    expect(screen.getByRole("region").classList.contains("is-edge-to-edge")).toBe(
      false,
    );
  });

  it("uses edge-to-edge chrome for populated single-pane layouts", () => {
    useWorkspaceGridStore.getState().setPreset("single");
    render(<WorkspaceGridView {...props} />);

    expect(screen.getByRole("region").classList.contains("is-edge-to-edge")).toBe(
      true,
    );
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
      fireEvent.click(screen.getByRole("button", { name: "当前 Chat，切换为 Code" }));
    });

    const pane = useWorkspaceGridStore
      .getState()
      .panes.find((item) => item.id === "pane-chat");
    expect(createGridSession).not.toHaveBeenCalled();
    expect(pane).toMatchObject({
      kind: "code",
      sessionId: undefined,
      title: getKimiAssistantDisplayName(),
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

  it("opens the current Code pane only after its iframe reports a session", async () => {
    const opening = deferred<void>();
    vi.mocked(props.onOpenPaneFolder).mockReturnValueOnce(opening.promise);
    useWorkspaceGridStore.getState().setPaneWorkDir("pane-code", "D:/pane-work");
    render(<WorkspaceGridView {...props} />);
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[src="http://127.0.0.1:1234/#token=secret"]',
    );
    expect(frame).toBeTruthy();
    const pendingButton = screen.getByRole("button", { name: "正在识别当前会话" });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:1234",
          source: frame?.contentWindow,
          data: {
            source: "kimi-shell-session-bridge",
            action: "pane_session_changed",
            sessionId: "session-b",
            applied: true,
          },
        }),
      );
    });
    const button = screen.getByRole("button", { name: "打开当前会话目录" });
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => Promise.resolve());

    expect(props.onOpenPaneFolder).toHaveBeenCalledWith(frame);
    expect(props.onOpenPaneFolder).toHaveBeenCalledTimes(1);
    await act(async () => opening.resolve());
  });

  it("enables the folder action from the iframe load handshake", async () => {
    render(<WorkspaceGridView {...props} />);
    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[src="http://127.0.0.1:1234/#token=secret"]',
    );
    expect(frame).toBeTruthy();
    const postMessage = vi.spyOn(frame!.contentWindow!, "postMessage");

    fireEvent.load(frame!);
    const request = postMessage.mock.calls
      .map(([message]) => message as { action?: string; requestId?: string })
      .find((message) => message.action === "report_current_session");
    expect(request?.requestId).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:1234",
          source: frame?.contentWindow,
          data: {
            source: "kimi-shell-session-bridge",
            action: "current_session_response",
            requestId: request?.requestId,
            sessionId: "session-load",
            applied: true,
          },
        }),
      );
    });

    expect(screen.getByRole("button", { name: "打开当前会话目录" })).toBeTruthy();
  });

  it("does not trust a persisted pane session or cached work directory", () => {
    useWorkspaceGridStore.setState((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === "pane-code"
          ? { ...pane, sessionId: "session-a", workDir: undefined }
          : pane,
      ),
    }));
    render(<WorkspaceGridView {...props} />);

    const button = screen.getByRole("button", { name: "正在识别当前会话" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(props.onOpenPaneFolder).not.toHaveBeenCalled();
  });

  it("does not render pane theme controls in pane headers", () => {
    render(<WorkspaceGridView {...props} />);

    expect(screen.queryByRole("combobox", { name: "窗格主题" })).toBeNull();
  });

  it("keeps the active iframe node when changing layout presets", () => {
    render(<WorkspaceGridView {...props} />);

    const iframeBefore = document.querySelector(
      'iframe[src="http://127.0.0.1:1234/#token=secret"]',
    );
    expect(iframeBefore).toBeTruthy();

    act(() => {
      useWorkspaceGridStore.getState().setPreset("2x2");
    });

    const iframeAfter = document.querySelector(
      'iframe[src="http://127.0.0.1:1234/#token=secret"]',
    );
    expect(iframeAfter).toBe(iframeBefore);
    expect(props.onCodeFrameLoad).not.toHaveBeenCalled();
  });

  it("posts pane theme sync payloads to iframe origin", () => {
    const frame = document.createElement("iframe");
    frame.src = "https://example.com/path";
    document.body.append(frame);
    const postMessageSpy = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation(() => undefined);

    postThemeToFrame(frame, "https://example.com/path", "dark");

    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: "kimi-shell-theme-sync", theme: "dark" },
      "https://example.com",
    );
  });

  it("swaps panes by pointer-dragging one pane header onto another slot", () => {
    render(<WorkspaceGridView {...props} />);

    const headers = document.querySelectorAll(".workspace-grid-pane-header");
    const slots = document.querySelectorAll(".workspace-grid-slot");
    const canvas = document.querySelector(".workspace-grid-canvas") as HTMLDivElement;
    setElementRect(slots[0]!, rect(0, 0, 400, 300));
    setElementRect(slots[1]!, rect(410, 0, 400, 300));

    fireEvent(headers[0]!, pointerEvent("pointerdown", 40, 12));
    expect(canvas.classList.contains("is-pane-dragging")).toBe(true);

    fireEvent(canvas, pointerEvent("pointermove", 450, 12));
    expect(slots[1]!.classList.contains("is-drop-target")).toBe(true);

    fireEvent(canvas, pointerEvent("pointerup", 450, 12));

    expect(useWorkspaceGridStore.getState().slots.map((slot) => slot.paneId)).toEqual([
      "pane-chat",
      "pane-code",
    ]);
  });

  it("hides the pane header suspend button but can resume a suspended pane", () => {
    useWorkspaceGridStore.getState().setPaneMountPolicy("pane-code", "suspended");
    render(<WorkspaceGridView {...props} />);

    expect(screen.queryByRole("button", { name: "挂起窗格" })).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复挂载" })).toBeNull();
    expect(screen.getByText("窗格已挂起")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复窗格" }));
    expect(useWorkspaceGridStore.getState().panes[0]?.mountPolicy).toBe("eager");
  });

  it("does not render the custom layout toolbar", () => {
    render(<WorkspaceGridView {...props} />);

    expect(screen.queryByRole("button", { name: "保存布局" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "保存的工作区布局" })).toBeNull();
  });

  it("persists column resize only when dragging ends", () => {
    useWorkspaceGridStore.getState().setPreset("1x3");
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
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
    expect(useWorkspaceGridStore.getState().trackSizes).toBeUndefined();
    expect(setItemSpy).not.toHaveBeenCalled();

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
      url: "https://kimi.com/path",
      title: "kimi.com",
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
      url: "https://kimi.com/path",
      title: "kimi.com",
      storageNamespace: externalPane?.storageNamespace,
      bounds: {
        x: 10,
        y: 20,
        width: 420,
        height: 240,
      },
    });
    expect(screen.getByText("kimi.com 已由嵌入式 Webview 承载")).toBeTruthy();
    expect(
      document.querySelector('iframe[src="https://kimi.com/path"]'),
    ).toBeNull();
  });

  it.each([
    ["pane removal", (paneId: string) => useWorkspaceGridStore.getState().removePane(paneId)],
    [
      "URL change",
      (paneId: string) =>
        useWorkspaceGridStore.setState((state) => ({
          panes: state.panes.map((pane) =>
            pane.id === paneId ? { ...pane, url: "https://kimi.com/next" } : pane,
          ),
        })),
    ],
    [
      "suspension",
      (paneId: string) =>
        useWorkspaceGridStore.getState().setPaneMountPolicy(paneId, "suspended"),
    ],
  ])("closes a child webview that resolves after %s", async (_scenario, invalidate) => {
    vi.useFakeTimers();
    const externalPane = addExternalPaneToGrid();
    const controller = {
      close: vi.fn(async () => undefined),
      sync: vi.fn(async () => undefined),
    };
    const creation = deferred<typeof controller>();
    vi.mocked(createEmbeddedExternalWebview).mockReturnValueOnce(creation.promise);
    render(<WorkspaceGridView {...props} />);

    act(() => {
      vi.advanceTimersByTime(8_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "在窗格内打开" }));
      await Promise.resolve();
    });
    expect(createEmbeddedExternalWebview).toHaveBeenCalledTimes(1);

    act(() => invalidate(externalPane.id));
    await act(async () => {
      creation.resolve(controller);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.close).toHaveBeenCalledTimes(1);
  });
});

function pointerEvent(type: string, clientX: number, clientY = 0): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "button", { value: 0 });
  return event;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setElementRect(element: Element, value: DOMRect) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => value,
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function addExternalPaneToGrid() {
  const store = useWorkspaceGridStore.getState();
  store.setPreset("1x3");
  const paneId = store.addPane({
    kind: "external",
    title: "kimi.com",
    url: "https://kimi.com/path",
  });
  const pane = useWorkspaceGridStore
    .getState()
    .panes.find((item) => item.id === paneId);
  if (!pane) {
    throw new Error("external pane was not added");
  }
  return pane;
}
