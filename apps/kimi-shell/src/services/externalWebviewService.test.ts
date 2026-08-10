import { describe, expect, it } from "vitest";
import {
  createWebviewDataDirectoryOption,
  createWebviewDataDirectoryOptionForPlatform,
} from "./externalWebviewService";
import { resetPlatformCapabilitiesStoreForTests } from "@/platform/platformStore";

describe("external webview data directory", () => {
  it("fails closed while platform capabilities are still loading", () => {
    resetPlatformCapabilitiesStoreForTests();
    expect(createWebviewDataDirectoryOption("pane-01")).toEqual({});
  });

  it("keeps a sanitized per-pane dataDirectory on Windows", () => {
    expect(createWebviewDataDirectoryOptionForPlatform("windows", "pane / 01")).toEqual({
      dataDirectory: "pane---01",
    });
  });

  it("omits dataDirectory on macOS 13 where WKWebView uses the shared data store", () => {
    expect(createWebviewDataDirectoryOptionForPlatform("macos", "pane-01")).toEqual({});
  });
});
