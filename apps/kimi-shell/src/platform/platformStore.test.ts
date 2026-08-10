import { describe, expect, it } from "vitest";
import { createPlatformCapabilitiesFallback } from "./platformStore";

describe("platform capability fallback", () => {
  it("preserves native macOS chrome while closing Windows-only surfaces", () => {
    const fallback = createPlatformCapabilitiesFallback(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6)",
    );

    expect(fallback.os).toBe("macos");
    expect(fallback.nativeWindowControls).toBe(true);
    expect(fallback.supportsExplorerContextMenu).toBe(false);
  });

  it("preserves the established Windows shell fallback", () => {
    const fallback = createPlatformCapabilitiesFallback(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );

    expect(fallback.os).toBe("windows");
    expect(fallback.nativeWindowControls).toBe(false);
    expect(fallback.supportsExplorerContextMenu).toBe(true);
  });

  it("fails closed for an unknown platform", () => {
    const fallback = createPlatformCapabilitiesFallback("unknown");

    expect(fallback.nativeWindowControls).toBe(true);
    expect(fallback.supportsAppMenu).toBe(false);
    expect(fallback.supportsExplorerContextMenu).toBe(false);
    expect(fallback.supportsTray).toBe(false);
  });
});
