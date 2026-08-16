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
import { getAgentRoomCapabilities } from "@/services/agentRoomService";
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

vi.mock("@/services/agentRoomService", () => ({
  listAgentRooms: vi.fn(async () => ({ items: [], cursor: "" })),
  getAgentRoomCapabilities: vi.fn(async () => ({
    runtimeProvider: "fake",
    core: true,
    observer: true,
    multiSessionObservation: true,
    sessionTranscript: true,
    userPromptEvents: true,
    abort: true,
    approval: true,
    nativeFollowUp: false,
    degradations: [],
  })),
  getAgentRoom: vi.fn(async () => ({ room: null, members: [] })),
  subscribeAgentRoomEvents: vi.fn(async () => () => undefined),
  syncAgentRoomPaneSessions: vi.fn(async ({ generation }) => ({
    acceptedGeneration: generation,
    observedSessionIds: [],
  })),
  listAgentRoomObservations: vi.fn(async () => ({
    items: [],
    pinnedSessionIds: [],
    observerRunning: true,
  })),
  listAgentRoomApprovals: vi.fn(async () => []),
  resolveAgentRoomApproval: vi.fn(async () => undefined),
  abortAgentRoomRun: vi.fn(async () => ({})),
  retryAgentRoomRun: vi.fn(async () => ({})),
  openAgentRoomSession: vi.fn(async () => ({})),
  addAgentRoomMember: vi.fn(),
  createAgentRoomAgent: vi.fn(),
  setAgentRoomObservationPin: vi.fn(),
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
  onOpenFolder: vi.fn(async () => undefined),
  onOpenPaneFolder: vi.fn(async () => undefined),
  onPaneSessionObserved: vi.fn(),
  onOpenExternalUrl: vi.fn(),
  onSplitRatioChange: vi.fn(),
  onSplitDragStateChange: vi.fn(),
  onCodeFrameLoad: vi.fn(),
  onCodeFrameError: vi.fn(),
  onChatFrameLoad: vi.fn(),
  onChatFrameError: vi.fn(),
  onRecoverDsh: vi.fn(async () => null),
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

  it("renders a passive empty state without pane creation actions", () => {
    useWorkspaceGridStore.getState().setPreset("1x3");
    render(<WorkspaceGridView {...props} />);

    expect(
      screen.getByText("暂无窗格，请使用左上角 + 新建窗格"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Code" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat" })).toBeNull();
  });

  it("does not render the retired Agent Room surface", () => {
    useWorkspaceGridStore.getState().setPreset("single");
    useWorkspaceGridStore.getState().configurePane("pane-code", {
      kind: "agent_room",
      roomId: "room-1",
      title: "Review Room",
    });

    render(<WorkspaceGridView {...props} />);

    expect(screen.queryByRole("region", { name: "Agent Room" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "选择 Agent Room" })).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    expect(props.onPaneSessionObserved).not.toHaveBeenCalled();
    expect(getAgentRoomCapabilities).not.toHaveBeenCalled();
  });

  it("switches an existing pane to Code without creating a server session", async () => {
    render(<WorkspaceGridView {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "当前 KimiChat，切换为 KimiCode" }));
    });

    const pane = useWorkspaceGridStore
      .getState()
      .panes.find((item) => item.id === "pane-chat");
    expect(createGridSession).not.toHaveBeenCalled();
    expect(pane).toMatchObject({
      kind: "code",
      sessionId: undefined,
      title: "KimiCode",
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

  it("adds the Kimi layout contract without weakening the exact origin", () => {
    const frame = document.createElement("iframe");
    frame.src = "http://127.0.0.1:1234/";
    document.body.append(frame);
    document.documentElement.style.setProperty("--accent", "#34c284");
    const postMessageSpy = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation(() => undefined);

    postThemeToFrame(frame, frame.src, "light", {
      surface: "kimi-code",
      layoutEnhancement: "v2",
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        source: "kimi-shell-theme-sync",
        theme: "light",
        accent: "#34c284",
        surface: "kimi-code",
        layoutEnhancement: "v2",
      },
      "http://127.0.0.1:1234",
    );
    document.documentElement.style.removeProperty("--accent");
  });

  it("keeps theme sync but omits the Kimi layout request when the host kill switch is off", () => {
    const frame = document.createElement("iframe");
    frame.src = "http://127.0.0.1:1234/";
    document.body.append(frame);
    window.localStorage.setItem("kimi-web-layout-v2", "off");
    const postMessageSpy = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation(() => undefined);

    postThemeToFrame(frame, frame.src, "dark", {
      surface: "kimi-code",
      layoutEnhancement: "v2",
    });

    expect(postMessageSpy).toHaveBeenCalledWith(
      { source: "kimi-shell-theme-sync", theme: "dark" },
      "http://127.0.0.1:1234",
    );
    window.localStorage.removeItem("kimi-web-layout-v2");
  });

  it("forces DSH theme messages to follow the shell theme", () => {
    useWorkspaceGridStore.getState().setPreset("single");
    useWorkspaceGridStore.getState().configurePane("pane-code", {
      kind: "dsh",
      title: "DeepSeek Harness",
      workDir: "D:/work",
      theme: "light",
    });
    const dshStatus = {
      state: "running" as const,
      port: 3080,
      url: "http://127.0.0.1:3080",
      pinnedVersion: "0.1.0-rc.6",
    };
    const { rerender } = render(
      <WorkspaceGridView
        {...props}
        themeMode="dark"
        dshStatus={dshStatus}
      />,
    );

    const frame = document.querySelector(
      'iframe[title="DeepSeek Harness"]',
    ) as HTMLIFrameElement;
    expect(frame).toBeTruthy();
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage");
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(
      { source: "kimi-shell-theme-sync", theme: "dark" },
      "http://127.0.0.1:3080",
    );

    rerender(
      <WorkspaceGridView
        {...props}
        themeMode="light"
        dshStatus={dshStatus}
      />,
    );
    expect(postMessage).toHaveBeenCalledWith(
      { source: "kimi-shell-theme-sync", theme: "light" },
      "http://127.0.0.1:3080",
    );
  });

  it("keeps the owned DSH frame mounted while HTTP health is degraded", () => {
    useWorkspaceGridStore.getState().setPreset("single");
    useWorkspaceGridStore.getState().configurePane("pane-code", {
      kind: "dsh",
      title: "DeepSeek Harness",
      workDir: "/Users/test/work",
    });
    const { rerender } = render(
      <WorkspaceGridView
        {...props}
        dshStatus={{
          state: "running",
          port: 3080,
          url: "http://127.0.0.1:3080",
          pinnedVersion: "0.1.0-rc.6",
        }}
      />,
    );
    const runningFrame = document.querySelector<HTMLIFrameElement>(
      'iframe[title="DeepSeek Harness"]',
    );
    expect(runningFrame?.src).toBe("http://127.0.0.1:3080/");

    rerender(
      <WorkspaceGridView
        {...props}
        dshStatus={{
          state: "degraded",
          port: 3080,
          url: "http://127.0.0.1:3080",
          lastError: "HTTP 健康检查连续失败",
          pinnedVersion: "0.1.0-rc.6",
        }}
      />,
    );

    expect(document.querySelector('iframe[title="DeepSeek Harness"]')).toBe(runningFrame);
    expect(screen.queryByText("DeepSeek Harness 暂时无法在应用内显示")).toBeNull();
  });

  it("restarts an unavailable DSH pane with that pane's current workspace", () => {
    useWorkspaceGridStore.getState().setPreset("single");
    useWorkspaceGridStore.getState().configurePane("pane-code", {
      kind: "dsh",
      title: "DeepSeek Harness",
      workDir: "/Users/test/CurrentWorkspace",
    });
    render(
      <WorkspaceGridView
        {...props}
        dshStatus={{
          state: "stopped",
          pinnedVersion: "0.1.0-rc.6",
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "重试后端启动" }));

    expect(props.onRecoverDsh).toHaveBeenCalledOnce();
    expect(props.onRecoverDsh).toHaveBeenCalledWith("/Users/test/CurrentWorkspace");
  });

  it("tracks the current DSH session directory and opens it from the pane header", async () => {
    useWorkspaceGridStore.getState().setPreset("single");
    useWorkspaceGridStore.getState().configurePane("pane-code", {
      kind: "dsh",
      title: "DeepSeek Harness",
      workDir: "/Users/test/OldWorkspace",
    });
    render(
      <WorkspaceGridView
        {...props}
        dshStatus={{
          state: "running",
          port: 3080,
          url: "http://127.0.0.1:3080",
          pinnedVersion: "0.1.0-rc.6",
        }}
      />,
    );

    const frame = document.querySelector<HTMLIFrameElement>(
      'iframe[title="DeepSeek Harness"]',
    );
    expect(frame).toBeTruthy();
    expect(
      (screen.getByRole("button", {
        name: "正在识别 DeepSeek Harness 当前会话",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:3080",
          source: frame?.contentWindow,
          data: {
            source: "kimi-shell-dsh-workspace-bridge",
            action: "dsh_workspace_changed",
            sessionId: "session-dsh",
            workDir: "/Users/test/MyProjects",
            applied: true,
          },
        }),
      );
    });

    expect(
      useWorkspaceGridStore.getState().panes.find((pane) => pane.id === "pane-code")?.workDir,
    ).toBe("/Users/test/MyProjects");
    fireEvent.click(
      screen.getByRole("button", {
        name: "打开 DeepSeek Harness 当前会话目录",
      }),
    );
    await act(async () => Promise.resolve());
    expect(props.onOpenFolder).toHaveBeenCalledWith("/Users/test/MyProjects");
  });

  it("closes every DSH pane without exposing or invoking a backend stop action", () => {
    const store = useWorkspaceGridStore.getState();
    store.configurePane("pane-code", {
      kind: "dsh",
      title: "DeepSeek Harness",
      workDir: "D:/work",
    });
    store.addPane({
      kind: "dsh",
      title: "DeepSeek Harness",
      workDir: "D:/work",
    });
    render(
      <WorkspaceGridView
        {...props}
        dshStatus={{
          state: "running",
          port: 3080,
          url: "http://127.0.0.1:3080",
          pinnedVersion: "0.1.0-rc.6",
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "停止 DeepSeek Harness" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "刷新 DeepSeek Harness" })).toHaveLength(2);

    const dshCloseButtons = () =>
      Array.from(document.querySelectorAll<HTMLElement>(".workspace-grid-pane"))
        .filter((pane) => pane.querySelector(".workspace-grid-pane-title")?.textContent?.includes("DeepSeek Harness"))
        .map((pane) => pane.querySelector<HTMLButtonElement>('button[aria-label="关闭窗格"]'))
        .filter((button): button is HTMLButtonElement => Boolean(button));

    fireEvent.click(dshCloseButtons()[0]!);
    expect(useWorkspaceGridStore.getState().panes.filter((pane) => pane.kind === "dsh")).toHaveLength(1);
    fireEvent.click(dshCloseButtons()[0]!);
    expect(useWorkspaceGridStore.getState().panes.filter((pane) => pane.kind === "dsh")).toHaveLength(0);
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

    const embedHost = document.querySelector(
      `[data-workspace-pane-id="${externalPane.id}"] .workspace-embed`,
    ) as HTMLDivElement;
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
