// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import frameWorkspaceBridgeScript from "../../src-tauri/src/frame_workspace_bridge.js?raw";
import {
  createWorkspaceBridgeNonce,
  isExpectedWorkspaceBridgeNonce,
  isTrustedWorkspaceIframeSource,
  normalizeExternalOpenUrl,
  parseWorkspaceFrameSessionMessage,
  queryWorkspaceFrameSessionId,
  redactWorkspaceUrlForDisplay,
} from "./linkBridge";

describe("link bridge iframe source checks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.documentElement.removeAttribute("data-kimi-sidekick-theme");
    document.body.removeAttribute("data-kimi-sidekick-theme");
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

  it("requires the exact workspace bridge nonce", () => {
    const nonce = createWorkspaceBridgeNonce();

    expect(nonce.length).toBeGreaterThan(0);
    expect(isExpectedWorkspaceBridgeNonce(nonce, nonce)).toBe(true);
    expect(isExpectedWorkspaceBridgeNonce(`${nonce}-other`, nonce)).toBe(false);
    expect(isExpectedWorkspaceBridgeNonce("", nonce)).toBe(false);
    expect(isExpectedWorkspaceBridgeNonce(null, nonce)).toBe(false);
  });

  it("redacts workspace URL fragments for display", () => {
    expect(redactWorkspaceUrlForDisplay("http://127.0.0.1:1234/#token=secret")).toBe(
      "http://127.0.0.1:1234/#token=[REDACTED]",
    );
    expect(redactWorkspaceUrlForDisplay("http://127.0.0.1:1234")).toBe(
      "http://127.0.0.1:1234/",
    );
    expect(redactWorkspaceUrlForDisplay("not-a-url#token=secret")).toBe(
      "not-a-url#[REDACTED]",
    );
  });

  it("injects pane theme metadata and head style from theme sync messages", () => {
    window.eval(frameWorkspaceBridgeScript);

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "kimi-shell-theme-sync", theme: "dark" },
      }),
    );

    expect(document.documentElement.dataset.kimiSidekickTheme).toBe("dark");
    expect(document.body.dataset.kimiSidekickTheme).toBe("dark");
    expect(document.head.querySelector('meta[name="color-scheme"]')?.getAttribute("content")).toBe(
      "dark",
    );
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(
      "#101418",
    );
    expect(document.getElementById("kimi-sidekick-pane-theme")?.textContent).toContain(
      "color-scheme: dark",
    );
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
});
