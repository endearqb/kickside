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

function createKimiLayoutFixture(
  width = 1179,
  options: { sidebar?: boolean; outline?: boolean; anchors?: boolean } = {},
) {
  const { sidebar = true, outline = true, anchors = true } = options;
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const frameWindow = frame.contentWindow! as Window & typeof globalThis;
  const frameDocument = frame.contentDocument!;
  frameDocument.head.innerHTML = "";
  frameDocument.body.innerHTML = `
    <div class="app-shell">
      <div class="app">
        ${
          sidebar
            ? `<aside class="side">
                 <button type="button" aria-label="收起侧边栏">收起</button>
                 <div class="session-row">会话 A</div>
               </aside>`
            : ""
        }
        <section class="con">
          <header class="chat-header"><button type="button">main</button></header>
          ${
            outline
              ? `<nav class="conversation-toc" aria-label="对话目录">
                   <div class="toc-scroll">
                     <button type="button" class="toc-row"><span class="toc-bar"></span><span class="toc-label">第一条消息</span></button>
                     <button type="button" class="toc-row"><span class="toc-bar"></span><span class="toc-label">第二条消息</span></button>
                   </div>
                 </nav>`
              : ""
          }
          <div class="chat-layout">
            ${
              anchors
                ? `<div class="u-bub turn-anchor" data-turn-id="turn-1">第一条消息</div>
                   <div class="a-msg turn-anchor" data-turn-id="assistant-1">助手回复不应进入目录</div>
                   <div class="u-bub turn-anchor" data-turn-id="turn-2">第二条消息</div>`
                : ""
            }
            <div class="composer"><textarea role="combobox" placeholder="输入消息…"></textarea></div>
          </div>
        </section>
      </div>
    </div>
  `;
  Object.defineProperty(frameDocument.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(frameWindow, "innerWidth", {
    configurable: true,
    value: width,
  });
  frameWindow.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }) as typeof frameWindow.requestAnimationFrame;
  let resizeObserverCallback: ResizeObserverCallback | null = null;
  class FixtureResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeObserverCallback = callback;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Object.defineProperty(frameWindow, "ResizeObserver", {
    configurable: true,
    value: FixtureResizeObserver,
  });
  frameWindow.eval(frameWorkspaceBridgeScript);
  return {
    frame,
    frameDocument,
    frameWindow,
    resize(nextWidth: number) {
      Object.defineProperty(frameDocument.documentElement, "clientWidth", {
        configurable: true,
        value: nextWidth,
      });
      Object.defineProperty(frameWindow, "innerWidth", {
        configurable: true,
        value: nextWidth,
      });
      resizeObserverCallback?.([], {} as ResizeObserver);
    },
  };
}

function dispatchKimiLayoutTheme(
  frameWindow: Window,
  overrides: Record<string, unknown> = {},
) {
  frameWindow.dispatchEvent(
    new MessageEvent("message", {
      source: frameWindow.parent,
      data: {
        source: "kimi-shell-theme-sync",
        theme: "light",
        accent: "#34c284",
        surface: "kimi-code",
        layoutEnhancement: "v2",
        ...overrides,
      },
    }),
  );
}

describe("link bridge iframe source checks", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.removeItem("kimi-web-layout-v2");
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

  it("keeps the native Header height and exposes a persistent compact TOC rail", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(1179, { sidebar: false });
    frameDocument.documentElement.style.setProperty("--logo", "#1783ff");
    const header = frameDocument.querySelector("header.chat-header") as HTMLElement;
    const originalHeader = header.outerHTML;

    dispatchKimiLayoutTheme(frameWindow);

    expect(frameDocument.documentElement.dataset.kimiShellLayout).toBe("compact");
    expect(header.outerHTML).toBe(originalHeader);
    expect(header.dataset.kimiEnhancedChatHeader).toBeUndefined();
    expect(
      frameDocument.querySelector('[data-kimi-enhanced-composer="true"]'),
    ).toBeTruthy();
    expect(
      frameDocument.querySelector('[data-kimi-enhanced-conversation-outline="true"]'),
    ).toBeTruthy();
    const outline = frameDocument.querySelector<HTMLElement>(
      '[data-kimi-enhanced-conversation-outline="true"]',
    );
    expect(outline?.hasAttribute("inert")).toBe(false);
    expect(outline?.hasAttribute("aria-hidden")).toBe(false);
    expect(frameDocument.getElementById("kickside-kimi-layout-v2")).toBeTruthy();
    expect(
      frameDocument.documentElement.style.getPropertyValue("--kimi-enhanced-accent"),
    ).toBe("#1783ff");

    const css = frameDocument.getElementById("kickside-kimi-layout-v2")?.textContent || "";
    expect(css).not.toContain("52px");
    expect(css).toContain(':hover .toc-label');
    expect(css).toContain(':focus-within .toc-label');
    expect(css).toContain("backdrop-filter: blur(18px) saturate(140%)");
    expect(css).toContain("--kimi-outline-glass-background: rgb(255 255 255 / 58%)");
    expect(css).toContain("--kimi-outline-expanded-panel-width");
    expect(css).toContain("220px");
    expect(css).toContain("max-width: 0 !important");
    expect(css).toContain("flex-direction: row !important");
    expect(css).not.toContain("row-reverse");
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-toggle="true"]')).toBeNull();
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-backdrop="true"]')).toBeNull();
  });

  it("keeps the native Sessions sidebar unchanged while moving only the wide TOC", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(1440);
    const sidebar = frameDocument.querySelector("aside.side") as HTMLElement;
    const originalSidebar = sidebar.outerHTML;

    dispatchKimiLayoutTheme(frameWindow);

    expect(sidebar.outerHTML).toBe(originalSidebar);
    expect(sidebar.attributes).toHaveLength(1);
    expect(sidebar.getAttribute("class")).toBe("side");
    expect(
      frameDocument.querySelector('[data-kimi-enhanced-conversation-outline="true"]'),
    ).toBeTruthy();
    expect(frameDocument.querySelector('[data-kimi-enhanced-chat-header="true"]')).toBeNull();
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-toggle="true"]')).toBeNull();
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-backdrop="true"]')).toBeNull();
  });

  it("leaves the compact Sessions sidebar and Header native while retaining the TOC rail", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(1179);
    const sidebar = frameDocument.querySelector("aside.side") as HTMLElement;
    const originalSidebar = sidebar.outerHTML;

    dispatchKimiLayoutTheme(frameWindow);

    expect(sidebar.outerHTML).toBe(originalSidebar);
    expect(frameDocument.querySelector('[data-kimi-enhanced-chat-header="true"]')).toBeNull();
    expect(frameDocument.querySelector('[data-kimi-enhanced-composer="true"]')).toBeNull();
    expect(
      frameDocument.querySelector('[data-kimi-enhanced-conversation-outline="true"]'),
    ).toBeTruthy();
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-toggle="true"]')).toBeNull();
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-backdrop="true"]')).toBeNull();
  });

  it("does not mistake a Sessions sidebar for a missing conversation TOC", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(1179, {
      outline: false,
      anchors: false,
    });
    const sidebar = frameDocument.querySelector("aside.side") as HTMLElement;
    const originalSidebar = sidebar.outerHTML;

    dispatchKimiLayoutTheme(frameWindow);

    expect(sidebar.outerHTML).toBe(originalSidebar);
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-toggle="true"]')).toBeNull();
    expect(
      frameDocument.querySelector('[data-kimi-enhanced-conversation-outline="true"]'),
    ).toBeNull();
  });

  it("enhances a native TOC even when the Header contract is missing", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(1179, { sidebar: false });
    const outline = frameDocument.querySelector("nav.conversation-toc") as HTMLElement;
    frameDocument.querySelector("header.chat-header")?.remove();

    dispatchKimiLayoutTheme(frameWindow);

    expect(outline.dataset.kimiEnhancedConversationOutline).toBe("true");
    expect(outline.hasAttribute("aria-hidden")).toBe(false);
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-toggle="true"]')).toBeNull();
  });

  it("does not project a mobile TOC for fewer than two user turns", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(480, {
      sidebar: false,
      outline: false,
    });
    frameDocument.querySelector('.u-bub[data-turn-id="turn-2"]')?.remove();

    dispatchKimiLayoutTheme(frameWindow);

    expect(
      frameDocument.querySelector('[data-kimi-enhanced-outline-projection="true"]'),
    ).toBeNull();
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-toggle="true"]')).toBeNull();
  });

  it("projects a bounded TOC from native turn anchors when mobile Kimi omits its TOC", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(480, {
      sidebar: false,
      outline: false,
    });
    const target = frameDocument.querySelector<HTMLElement>('.u-bub[data-turn-id="turn-1"]');
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    dispatchKimiLayoutTheme(frameWindow);

    const projection = frameDocument.querySelector<HTMLElement>(
      '[data-kimi-enhanced-outline-projection="true"]',
    );
    expect(projection?.getAttribute("aria-label")).toBe("对话目录");
    expect(projection?.querySelectorAll("button.toc-row")).toHaveLength(2);
    projection?.querySelector<HTMLButtonElement>('button[data-turn-id="turn-1"]')?.click();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
    expect(frameDocument.activeElement).not.toBeNull();
  });

  it("rebuilds a mobile TOC projection after the upstream DOM removes it", async () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(480, {
      sidebar: false,
      outline: false,
    });
    dispatchKimiLayoutTheme(frameWindow);
    frameDocument
      .querySelector('[data-kimi-enhanced-outline-projection="true"]')
      ?.remove();
    frameDocument.querySelector(".chat-layout")?.append(frameDocument.createElement("span"));

    await new Promise((resolve) => frameWindow.setTimeout(resolve, 0));

    expect(
      frameDocument.querySelectorAll(
        '[data-kimi-enhanced-outline-projection="true"] button.toc-row',
      ),
    ).toHaveLength(2);
  });

  it("moves focus from a mobile projection to the native TOC when it mounts", async () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(480, {
      sidebar: false,
      outline: false,
    });
    dispatchKimiLayoutTheme(frameWindow);
    const projectionRow = frameDocument.querySelector<HTMLElement>(
      '[data-kimi-enhanced-outline-projection="true"] button.toc-row',
    );
    projectionRow?.focus();

    const nativeOutline = frameDocument.createElement("nav");
    nativeOutline.className = "conversation-toc";
    nativeOutline.setAttribute("aria-label", "对话目录");
    nativeOutline.innerHTML =
      '<div class="toc-scroll"><button class="toc-row" type="button">' +
      '<span class="toc-bar"></span><span class="toc-label">第一条消息</span>' +
      "</button></div>";
    frameDocument.querySelector("section.con")?.append(nativeOutline);

    await new Promise((resolve) => frameWindow.setTimeout(resolve, 0));

    expect(
      frameDocument.querySelector('[data-kimi-enhanced-outline-projection="true"]'),
    ).toBeNull();
    expect(nativeOutline.dataset.kimiEnhancedConversationOutline).toBe("true");
    expect(frameDocument.activeElement).toBe(nativeOutline.querySelector("button.toc-row"));
  });

  it("re-applies the persistent rail when upstream remounts the native TOC", async () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(960, { sidebar: false });
    dispatchKimiLayoutTheme(frameWindow);
    const oldOutline = frameDocument.querySelector("nav.conversation-toc");
    const replacement = oldOutline?.cloneNode(true) as HTMLElement;
    oldOutline?.replaceWith(replacement);

    await new Promise((resolve) => frameWindow.setTimeout(resolve, 0));

    expect(frameDocument.querySelector(".chat-layout")?.hasAttribute("inert")).toBe(false);
    expect(replacement.dataset.kimiEnhancedConversationOutline).toBe("true");
    expect(replacement.hasAttribute("aria-hidden")).toBe(false);
  });

  it("keeps non-Kimi frames and user-disabled layout enhancement untouched", () => {
    const first = createKimiLayoutFixture(1180);
    dispatchKimiLayoutTheme(first.frameWindow, {
      surface: "dsh",
      layoutEnhancement: undefined,
    });
    expect(first.frameDocument.documentElement.dataset.kimiShellLayout).toBeUndefined();
    expect(first.frameDocument.getElementById("kickside-kimi-layout-v2")).toBeNull();

    first.frame.remove();
    const second = createKimiLayoutFixture(1180);
    second.frameWindow.localStorage.setItem("kimi-web-layout-v2", "off");
    dispatchKimiLayoutTheme(second.frameWindow);
    expect(second.frameDocument.documentElement.dataset.kimiShellLayout).toBeUndefined();
    expect(second.frameDocument.getElementById("kickside-kimi-layout-v2")).toBeNull();
    expect(
      second.frameDocument.documentElement.style.getPropertyValue("--kimi-enhanced-accent"),
    ).toBe("");
  });

  it("rejects a forged Kimi layout request that did not come from the parent", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(1180);
    frameWindow.dispatchEvent(
      new MessageEvent("message", {
        source: frameWindow,
        data: {
          source: "kimi-shell-theme-sync",
          theme: "light",
          surface: "kimi-code",
          layoutEnhancement: "v2",
        },
      }),
    );
    expect(frameDocument.documentElement.dataset.kimiShellLayout).toBeUndefined();
    expect(frameDocument.getElementById("kickside-kimi-layout-v2")).toBeNull();
  });

  it("fails open and emits a bounded diagnostic when semantic hooks are missing", () => {
    vi.useFakeTimers();
    const { frameDocument, frameWindow } = createKimiLayoutFixture(1180);
    const warning = vi.spyOn(frameWindow.console, "warn").mockImplementation(() => undefined);
    frameDocument.body.innerHTML = '<main id="native-kimi-content">原生页面</main>';

    dispatchKimiLayoutTheme(frameWindow);
    vi.advanceTimersByTime(1500);

    expect(frameDocument.getElementById("native-kimi-content")?.textContent).toBe("原生页面");
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[0]).toBe(
      "[KickSide] Kimi Web layout enhancement skipped: required semantic hooks were not found.",
    );
    vi.useRealTimers();
  });

  it.each([
    [959, "narrow"],
    [960, "compact"],
    [1179, "compact"],
    [1180, "wide"],
  ])("classifies the %ipx iframe boundary as %s", (width, mode) => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(width);
    dispatchKimiLayoutTheme(frameWindow);
    expect(frameDocument.documentElement.dataset.kimiShellLayout).toBe(mode);
  });

  it("keeps the same persistent TOC rail across layout boundaries", () => {
    const { frameDocument, frameWindow, resize } = createKimiLayoutFixture(960, {
      sidebar: false,
    });
    dispatchKimiLayoutTheme(frameWindow);
    const outline = frameDocument.querySelector("nav.conversation-toc") as HTMLElement;

    resize(959);

    expect(frameDocument.documentElement.dataset.kimiShellLayout).toBe("narrow");
    expect(outline.dataset.kimiEnhancedConversationOutline).toBe("true");
    expect(outline.hasAttribute("inert")).toBe(false);
    expect(outline.hasAttribute("aria-hidden")).toBe(false);

    resize(1180);

    expect(frameDocument.documentElement.dataset.kimiShellLayout).toBe("wide");
    expect(outline.dataset.kimiEnhancedConversationOutline).toBe("true");
    expect(frameDocument.querySelector('[data-kimi-enhanced-outline-toggle="true"]')).toBeNull();
  });

  it("makes a clipped native TOC available as the persistent left rail", () => {
    const { frameDocument, frameWindow, resize } = createKimiLayoutFixture(1440);
    const outline = frameDocument.querySelector("nav.conversation-toc") as HTMLElement;
    outline.setAttribute("inert", "");
    outline.setAttribute("aria-hidden", "true");
    dispatchKimiLayoutTheme(frameWindow);
    expect(outline.hasAttribute("inert")).toBe(false);
    expect(outline.hasAttribute("aria-hidden")).toBe(false);

    resize(1179);

    expect(outline.hasAttribute("inert")).toBe(false);
    expect(outline.hasAttribute("aria-hidden")).toBe(false);
    expect(outline.dataset.kimiEnhancedConversationOutline).toBe("true");
  });

  it("uses Kimi's native blue for the narrow workspace icon", () => {
    const { frameDocument, frameWindow } = createKimiLayoutFixture(800, {
      sidebar: false,
      outline: false,
      anchors: false,
    });
    const header = frameDocument.querySelector("header.chat-header");
    header?.replaceWith(
      Object.assign(frameDocument.createElement("div"), {
        className: "topbar",
        innerHTML:
          '<span class="wsq">N</span>' +
          '<button type="button" aria-label="切换会话 / 工作区">会话</button>',
      }),
    );
    frameDocument.documentElement.style.setProperty("--logo", "#1783ff");

    dispatchKimiLayoutTheme(frameWindow);

    const icon = frameDocument.querySelector(".wsq") as HTMLElement;
    expect(icon.dataset.kimiEnhancedWorkspaceIcon).toBe("true");
    expect(
      frameDocument.documentElement.style.getPropertyValue("--kimi-enhanced-accent"),
    ).toBe("#1783ff");
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
