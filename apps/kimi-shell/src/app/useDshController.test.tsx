// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as dshService from "@/services/dshService";
import { useDshController } from "./useDshController";

vi.mock("@/services/dshService", () => ({
  getDshPreflight: vi.fn(),
  getDshSettings: vi.fn(),
  getDshStatus: vi.fn(),
  installDsh: vi.fn(),
  saveDshSettings: vi.fn(),
  startDsh: vi.fn(),
  stopDsh: vi.fn(),
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

  it("does not preflight a disabled runtime until the control surface asks for it", async () => {
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
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: false,
      runtimeReady: false,
      installReady: true,
      nodeSupported: false,
      npmAvailable: false,
      installValid: false,
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: ["未检测"],
    });

    const { result } = renderHook(() => useDshController(true));
    await waitFor(() => expect(result.current.status?.state).toBe("stopped"));

    expect(dshService.getDshPreflight).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh({ preflight: "force" });
    });
    expect(dshService.getDshPreflight).toHaveBeenCalledOnce();
  });

  it("reuses a fresh preflight result across cached refreshes", async () => {
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
    vi.mocked(dshService.getDshPreflight).mockResolvedValue({
      ready: true,
      runtimeReady: true,
      installReady: true,
      nodeSupported: true,
      npmAvailable: true,
      installValid: true,
      pinnedVersion: "0.1.0-rc.6",
      installPath: "/tmp/dsh",
      issues: [],
    });

    const { result } = renderHook(() => useDshController(true));
    await waitFor(() => expect(result.current.status?.state).toBe("stopped"));

    await act(async () => {
      await result.current.refresh({ preflight: "force" });
      await result.current.refresh({ preflight: "cached" });
    });

    expect(dshService.getDshPreflight).toHaveBeenCalledOnce();
  });
});
