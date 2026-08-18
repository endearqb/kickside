import { describe, expect, it } from "vitest";
import { buildWorkspaceFrameKey } from "./useWorkspaceEmbedUrl";

describe("buildWorkspaceFrameKey", () => {
  it("remounts the Kimi frame when an owned runtime restarts on the same URL", () => {
    const before = buildWorkspaceFrameKey(
      "http://127.0.0.1:57820/?kimi_onboarded=1#token=opaque",
      "upstream",
      0,
      7,
    );
    const after = buildWorkspaceFrameKey(
      "http://127.0.0.1:57820/?kimi_onboarded=1#token=opaque",
      "upstream",
      0,
      8,
    );

    expect(after).not.toBe(before);
  });

  it("keeps an empty frame identity free of runtime details", () => {
    expect(buildWorkspaceFrameKey(null, "upstream", 3, 9)).toBe(
      "workspace-empty",
    );
  });
});
