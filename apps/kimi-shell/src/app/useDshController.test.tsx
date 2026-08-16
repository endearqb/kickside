// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as dshService from "@/services/dshService";
import { useDshController } from "./useDshController";

vi.mock("@/services/dshService", () => ({
  getDshSettings: vi.fn(),
  getDshStatus: vi.fn(),
  startDsh: vi.fn(),
}));

describe("useDshController", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("projects start failures without rejecting pane event handlers", async () => {
    vi.mocked(dshService.getDshSettings).mockResolvedValue({
      enabled: false,
      portRange: [3080, 3179],
      startTimeoutSec: 60,
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.getDshStatus).mockResolvedValue({
      state: "stopped",
      pinnedVersion: "0.1.0-rc.6",
    });
    vi.mocked(dshService.startDsh).mockRejectedValue(
      new Error("E-DSH-004：启动超时"),
    );

    const { result } = renderHook(() => useDshController(true));
    await waitFor(() => expect(result.current.status?.state).toBe("stopped"));

    let startResult: dshService.DshStatus | null | undefined;
    await act(async () => {
      startResult = await result.current.start("/Users/test/work");
    });

    expect(startResult).toBeNull();
    expect(result.current.error).toBe("E-DSH-004：启动超时");
    expect(result.current.busy).toBe(false);
  });
});
