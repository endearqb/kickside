// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { isKnownWorkspaceIframeSource } from "./linkBridge";

describe("link bridge iframe source checks", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("trusts only workspace iframe windows", () => {
    const workspaceFrame = document.createElement("iframe");
    workspaceFrame.className = "workspace-iframe";
    const otherFrame = document.createElement("iframe");
    document.body.append(workspaceFrame, otherFrame);

    expect(isKnownWorkspaceIframeSource(workspaceFrame.contentWindow)).toBe(true);
    expect(isKnownWorkspaceIframeSource(otherFrame.contentWindow)).toBe(false);
    expect(isKnownWorkspaceIframeSource(window)).toBe(false);
  });
});
