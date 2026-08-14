// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import frameWorkspaceBridgeScript from "../../src-tauri/src/frame_workspace_bridge.js?raw";
import {
  createWorkspaceBridgeNonce,
  isExpectedWorkspaceBridgeNonce,
  isTrustedWorkspaceIframeSource,
  normalizeExternalOpenUrl,
  parseDshFrameWorkspaceMessage,
  parseWorkspaceFrameSessionMessage,
  queryDshFrameWorkspace,
  queryWorkspaceFrameSessionId,
  redactWorkspaceUrlForDisplay,
} from "./linkBridge";

describe("link bridge iframe source checks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-kimi-sidekick-theme");
    document.body.removeAttribute("data-kimi-sidekick-theme");
    document.body.removeAttribute("data-ds-dark-theme");
    document.head
      .querySelectorAll(
        'meta[name="color-scheme"], meta[name="theme-color"], style#kimi-sidekick-pane-theme',
      )
      .forEach((node) => node.remove());
  });

  it("trusts only the current workspace iframe window", () => {
    const workspaceFrame = document.createElement("iframe");
    workspaceFrame.className = "workspace-iframe";
    const otherFrame = document.createElement("iframe");
    document.body.append(workspaceFrame, otherFrame);

    expect(isTrustedWorkspaceIframeSource(workspaceFrame.contentWindow, workspaceFrame)).toBe(
      true,
    );
    expect(isTrustedWorkspaceIframeSource(otherFrame.contentWindow, workspaceFrame)).toBe(
      false,
    );
    expect(isTrustedWorkspaceIframeSource(window, workspaceFrame)).toBe(false);
  });

  it("normalizes only http and https external open URLs", () => {
    expect(normalizeExternalOpenUrl(" https://example.com/path ")).toBe(
      "https://example.com/path",
    );
    expect(normalizeExternalOpenUrl("http://example.com")).toBe(
      "http://example.com/",
    );
    expect(normalizeExternalOpenUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalOpenUrl("file:///C:/secret.txt")).toBeNull();
    expect(normalizeExternalOpenUrl("data:text/html,hello")).toBeNull();
    expect(normalizeExternalOpenUrl("ms-settings:privacy")).toBeNull();
    expect(normalizeExternalOpenUrl("shell:AppsFolder")).toBeNull();
    expect(normalizeExternalOpenUrl("")).toBeNull();
    expect(normalizeExternalOpenUrl("://bad")).toBeNull();
  });

  it("forwards Kimi login links with the iframe bridge nonce", () => {
    const postMessage = vi.fn();
    let clickHandler: ((event: Record<string, unknown>) => void) | undefined;
    const frameWindow = {
      name: "workspace-bridge-nonce",
      parent: { postMessage },
      top: {},
      location: new URL("http://127.0.0.1:1234/"),
      history: {},
      addEventListener: vi.fn(),
      open: vi.fn(),
    };
    const frameDocument = {
      head: null,
      body: null,
      documentElement: { dataset: {} },
      addEventListener: vi.fn(
        (type: string, handler: (event: Record<string, unknown>) => void) => {
          if (type === "click") clickHandler = handler;
        },
      ),
      getElementById: vi.fn(),
    };
    class FrameElement {
      closest() {
        return this;
      }
    }
    class FrameAnchorElement extends FrameElement {
      getAttribute(name: string) {
        return name === "href" ? "https://kimi.example/login?code=ABCD" : null;
      }
    }

    new Function(
      "window",
      "document",
      "Element",
      "HTMLAnchorElement",
      "URL",
      "URLSearchParams",
      "setTimeout",
      frameWorkspaceBridgeScript,
    )(
      frameWindow,
      frameDocument,
      FrameElement,
      FrameAnchorElement,
      URL,
      URLSearchParams,
      (callback: () => void) => callback(),
    );

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    clickHandler?.({
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      target: new FrameAnchorElement(),
      preventDefault,
      stopPropagation,
    });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledWith(
      {
        source: "kimi-shell-external-link-bridge",
        url: "https://kimi.example/login?code=ABCD",
        reason: "anchor_click",
        bridgeNonce: "workspace-bridge-nonce",
      },
      "*",
    );
  });

  it("requires the exact workspace bridge nonce", () => {
    const nonce = createWorkspaceBridgeNonce();

    expect(nonce.length).toBeGreaterThan(0);
    expect(isExpectedWorkspaceBridgeNonce(nonce, nonce)).toBe(true);
    expect(isExpectedWorkspaceBridgeNonce(`${nonce}-other`, nonce)).toBe(false);
    expect(isExpectedWorkspaceBridgeNonce("", nonce)).toBe(false);
    expect(isExpectedWorkspaceBridgeNonce(null, nonce)).toBe(false);
  });

  it("redacts workspace URL fragments for display", () => {
    expect(
      redactWorkspaceUrlForDisplay(
        "http://127.0.0.1:1234/?kimi_onboarded=1#token=secret",
      ),
    ).toBe("http://127.0.0.1:1234/?kimi_onboarded=1#token=[REDACTED]");
    expect(redactWorkspaceUrlForDisplay("http://127.0.0.1:1234")).toBe(
      "http://127.0.0.1:1234/",
    );
    expect(redactWorkspaceUrlForDisplay("not-a-url#token=secret")).toBe(
      "not-a-url#[REDACTED]",
    );
  });

  it("applies the Kimi color-scheme contract from pane theme sync messages", () => {
    window.eval(frameWorkspaceBridgeScript);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "kimi-shell-theme-sync", theme: "dark" },
      }),
    );

    expect(window.localStorage.getItem("kimi-web.color-scheme")).toBe("dark");
    expect(window.localStorage.getItem("kimi-theme")).toBe("dark");
    expect(document.documentElement.dataset.colorScheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.dataset.kimiSidekickTheme).toBe("dark");
    expect(document.body.dataset.kimiSidekickTheme).toBe("dark");
    expect(document.body.hasAttribute("data-ds-dark-theme")).toBe(true);
    expect(document.head.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      "dark",
    );
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#121212",
    );
    expect(document.getElementById("kimi-sidekick-pane-theme")?.textContent).toContain(
      "color-scheme: dark",
    );

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "kimi-shell-theme-sync", theme: "light" },
      }),
    );

    expect(window.localStorage.getItem("kimi-web.color-scheme")).toBe("light");
    expect(document.documentElement.dataset.colorScheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.body.hasAttribute("data-ds-dark-theme")).toBe(false);
  });

  it("parses only session messages from the exact iframe and origin", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const data = {
      source: "kimi-shell-session-bridge",
      action: "pane_session_changed",
      sessionId: "session-a",
      applied: true,
    };

    expect(
      parseWorkspaceFrameSessionMessage(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:1234",
          source: frame.contentWindow,
          data,
        }),
        frame,
        "http://127.0.0.1:1234",
      )?.sessionId,
    ).toBe("session-a");
    expect(
      parseWorkspaceFrameSessionMessage(
        new MessageEvent("message", {
          origin: "http://evil.test",
          source: frame.contentWindow,
          data,
        }),
        frame,
        "http://127.0.0.1:1234",
      ),
    ).toBeNull();
  });

  it("queries the current iframe session without sending paths or tokens", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const postMessage = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation((message) => {
        const request = message as { requestId: string };
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "http://127.0.0.1:1234",
              source: frame.contentWindow,
              data: {
                source: "kimi-shell-session-bridge",
                action: "current_session_response",
                requestId: request.requestId,
                sessionId: "session-b",
                applied: true,
              },
            }),
          );
        });
      });

    await expect(
      queryWorkspaceFrameSessionId(frame, "http://127.0.0.1:1234"),
    ).resolves.toBe("session-b");
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "kimi-shell-session-sync",
        action: "report_current_session",
      }),
      "http://127.0.0.1:1234",
    );
    expect(JSON.stringify(postMessage.mock.calls[0]?.[0])).not.toMatch(
      /token|workDir|href|url/i,
    );
  });

  it("accepts DSH workspace reports only from the exact iframe and runtime origin", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const data = {
      source: "kimi-shell-dsh-workspace-bridge",
      action: "dsh_workspace_changed",
      sessionId: "session-dsh",
      workDir: "/Users/test/MyProjects",
      applied: true,
    };

    expect(
      parseDshFrameWorkspaceMessage(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:3080",
          source: frame.contentWindow,
          data,
        }),
        frame,
        "http://127.0.0.1:3080",
      ),
    ).toMatchObject({
      sessionId: "session-dsh",
      workDir: "/Users/test/MyProjects",
      applied: true,
    });
    expect(
      parseDshFrameWorkspaceMessage(
        new MessageEvent("message", {
          origin: "http://evil.test",
          source: frame.contentWindow,
          data,
        }),
        frame,
        "http://127.0.0.1:3080",
      ),
    ).toBeNull();
    expect(
      parseDshFrameWorkspaceMessage(
        new MessageEvent("message", {
          origin: "http://127.0.0.1:3080",
          source: frame.contentWindow,
          data: { ...data, workDir: "../relative" },
        }),
        frame,
        "http://127.0.0.1:3080",
      ),
    ).toBeNull();
  });

  it("queries a DSH iframe workspace with a correlated request", async () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const postMessage = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation((message) => {
        const request = message as { requestId: string };
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: "http://127.0.0.1:3080",
              source: frame.contentWindow,
              data: {
                source: "kimi-shell-dsh-workspace-bridge",
                action: "current_workspace_response",
                requestId: request.requestId,
                sessionId: "session-dsh",
                workDir: "/Users/test/MyProjects",
                applied: true,
              },
            }),
          );
        });
      });

    await expect(
      queryDshFrameWorkspace(frame, "http://127.0.0.1:3080"),
    ).resolves.toMatchObject({
      sessionId: "session-dsh",
      workDir: "/Users/test/MyProjects",
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "kimi-shell-dsh-workspace-sync",
        action: "report_current_workspace",
      }),
      "http://127.0.0.1:3080",
    );
  });

  it("reports canonical, legacy, root, and A-to-B-to-A route changes", async () => {
    const postMessage = vi.fn();
    const frameWindow = {
      parent: { postMessage },
      top: {},
      location: new URL("http://workspace.local/sessions/A%20encoded"),
      history: {
        pushState(_state: unknown, _title: string, nextUrl: string) {
          frameWindow.location = new URL(nextUrl, frameWindow.location.href);
        },
        replaceState(_state: unknown, _title: string, nextUrl: string) {
          frameWindow.location = new URL(nextUrl, frameWindow.location.href);
        },
      },
      addEventListener: vi.fn(),
      open: vi.fn(),
    };
    const frameDocument = {
      head: null,
      body: null,
      documentElement: { dataset: {} },
      addEventListener: vi.fn(),
      getElementById: vi.fn(),
    };
    class FrameElement {}
    class FrameAnchorElement extends FrameElement {}

    new Function(
      "window",
      "document",
      "Element",
      "HTMLAnchorElement",
      "URL",
      "URLSearchParams",
      "setTimeout",
      frameWorkspaceBridgeScript,
    )(
      frameWindow,
      frameDocument,
      FrameElement,
      FrameAnchorElement,
      URL,
      URLSearchParams,
      (callback: () => void) => callback(),
    );
    frameWindow.history.pushState({}, "", "/sessions/B");
    frameWindow.history.pushState({}, "", "/sessions/A%20encoded");
    frameWindow.history.pushState({}, "", "/?session=legacy%2Fid");
    frameWindow.history.pushState({}, "", "/");

    const reports = postMessage.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .filter((payload) => payload.action === "pane_session_changed");
    expect(reports.map((payload) => payload.sessionId)).toEqual([
      "A encoded",
      "B",
      "A encoded",
      "legacy/id",
      null,
    ]);
    for (const payload of reports) {
      expect(Object.keys(payload)).not.toEqual(
        expect.arrayContaining(["url", "href", "hash", "token", "workDir", "paneId"]),
      );
    }
  });

  it("reports only this DSH frame's persisted selection and resolves cwd through session.list", async () => {
    const postMessage = vi.fn();
    const handlers = new Map<string, (event: Record<string, unknown>) => void>();
    class FakeStorage {
      private readonly values = new Map<string, string>();

      getItem(key: string) {
        return this.values.get(key) ?? null;
      }

      setItem(key: string, value: string) {
        this.values.set(key, String(value));
      }
    }
    const localStorage = new FakeStorage();
    localStorage.setItem(
      "dsh.sessions.current",
      JSON.stringify({ sessionId: "session-a" }),
    );
    const fetch = vi.fn(async (_url: string, init: { body?: string }) => {
      const request = JSON.parse(init.body ?? "{}") as { rpcId: string };
      return {
        ok: true,
        json: async () => ({
          type: "server-response",
          rpcId: request.rpcId,
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: "session-a", cwd: "/Users/test/WorkspaceA" },
                { sessionId: "session-b", cwd: "/Users/test/WorkspaceB" },
              ],
            },
          },
        }),
      };
    });
    const frameWindow = {
      __DSH_BOOT__: {},
      parent: { postMessage },
      top: {},
      location: new URL("http://127.0.0.1:3080/"),
      history: { pushState: vi.fn(), replaceState: vi.fn() },
      localStorage,
      Storage: FakeStorage,
      fetch,
      crypto: { randomUUID: () => "rpc-id" },
      addEventListener: vi.fn(
        (type: string, handler: (event: Record<string, unknown>) => void) => {
          handlers.set(type, handler);
        },
      ),
      open: vi.fn(),
    };
    const frameDocument = {
      head: null,
      body: null,
      documentElement: { dataset: {} },
      addEventListener: vi.fn(),
      getElementById: vi.fn(),
    };
    class FrameElement {}
    class FrameAnchorElement extends FrameElement {}

    new Function(
      "window",
      "document",
      "Element",
      "HTMLAnchorElement",
      "URL",
      "URLSearchParams",
      "setTimeout",
      frameWorkspaceBridgeScript,
    )(
      frameWindow,
      frameDocument,
      FrameElement,
      FrameAnchorElement,
      URL,
      URLSearchParams,
      (callback: () => void) => callback(),
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    localStorage.setItem(
      "dsh.sessions.current",
      JSON.stringify({ sessionId: "session-b" }),
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const reports = postMessage.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .filter((payload) => payload.action === "dsh_workspace_changed");
    expect(reports).toEqual([
      expect.objectContaining({
        sessionId: "session-a",
        workDir: "/Users/test/WorkspaceA",
        applied: true,
      }),
      expect.objectContaining({
        sessionId: "session-b",
        workDir: "/Users/test/WorkspaceB",
        applied: true,
      }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(handlers.has("storage")).toBe(false);
  });
});
