import { describe, expect, it } from "vitest";
import { getTrustedDshRuntimeUrl, type DshStatus } from "./dshService";

function status(input: Partial<DshStatus>): DshStatus {
  return {
    state: "running",
    port: 3080,
    pinnedVersion: "0.1.0-rc.6",
    ...input,
  };
}

describe("getTrustedDshRuntimeUrl", () => {
  it("accepts only a live exact IPv4 loopback origin", () => {
    expect(
      getTrustedDshRuntimeUrl(status({ url: "http://127.0.0.1:3080" })),
    ).toBe("http://127.0.0.1:3080");
    expect(
      getTrustedDshRuntimeUrl(
        status({ state: "starting", url: "http://127.0.0.1:3080" }),
      ),
    ).toBeNull();
    expect(
      getTrustedDshRuntimeUrl(
        status({ state: "degraded", url: "http://127.0.0.1:3080" }),
      ),
    ).toBe("http://127.0.0.1:3080");
    expect(
      getTrustedDshRuntimeUrl(status({ url: "http://localhost:3080" })),
    ).toBeNull();
    expect(
      getTrustedDshRuntimeUrl(status({ url: "http://127.0.0.1:3080/path" })),
    ).toBeNull();
    expect(
      getTrustedDshRuntimeUrl(status({ url: "http://127.0.0.1:65536" })),
    ).toBeNull();
    expect(
      getTrustedDshRuntimeUrl(
        status({ port: 3081, url: "http://127.0.0.1:3080" }),
      ),
    ).toBeNull();
  });
});
