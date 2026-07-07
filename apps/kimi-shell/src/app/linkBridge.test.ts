// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import frameWorkspaceBridgeScript from "../../src-tauri/src/frame_workspace_bridge.js?raw";
import {
  createWorkspaceBridgeNonce,
  isExpectedWorkspaceBridgeNonce,
  isTrustedWorkspaceIframeSource,
  normalizeExternalOpenUrl,
  redactWorkspaceUrlForDisplay,
} from "./linkBridge";

describe("link bridge iframe source checks", () => {
  afterEach(() => {
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
});
