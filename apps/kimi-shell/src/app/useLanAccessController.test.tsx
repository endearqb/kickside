// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as lanAccessService from "@/services/lanAccessService";
import { useLanAccessController } from "./useLanAccessController";

vi.mock("@/services/lanAccessService", () => ({
  getKimiAccessStatus: vi.fn(),
  getKimiLanLaunchUrl: vi.fn(),
  getKimiRemoteLaunchUrl: vi.fn(),
  setKimiAccessMode: vi.fn(),
}));

const localStatus: lanAccessService.KimiAccessStatus = {
  mode: "local",
  switching: false,
  runtimeOwnership: "owned_by_shell",
  runtimeReady: true,
  canChange: true,
  port: 57820,
  lanAddresses: [],
  remoteControlSupported: true,
  remoteControlState: "disabled",
  remoteUrlAvailable: false,
};

describe("useLanAccessController", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("refreshes the Shell runtime projection after a successful restart", async () => {
    vi.mocked(lanAccessService.getKimiAccessStatus).mockResolvedValue(localStatus);
    vi.mocked(lanAccessService.setKimiAccessMode).mockResolvedValue({
      ...localStatus,
      mode: "lan",
    });
    const onRuntimeChanged = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLanAccessController(true, onRuntimeChanged),
    );
    await waitFor(() => expect(result.current.status).toEqual(localStatus));

    await act(async () => {
      await result.current.setMode("lan");
    });

    expect(onRuntimeChanged).toHaveBeenCalledOnce();
    expect(result.current.status?.mode).toBe("lan");
  });

  it("refreshes the Shell projection after a failed switch and rollback", async () => {
    vi.mocked(lanAccessService.getKimiAccessStatus).mockResolvedValue(localStatus);
    vi.mocked(lanAccessService.setKimiAccessMode).mockRejectedValue(
      new Error("switch failed; rollback completed"),
    );
    const onRuntimeChanged = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLanAccessController(true, onRuntimeChanged),
    );
    await waitFor(() => expect(result.current.status).toEqual(localStatus));

    await act(async () => {
      await result.current.setMode("kimi_remote");
    });

    expect(onRuntimeChanged).toHaveBeenCalledOnce();
    expect(result.current.error).toBe("switch failed; rollback completed");
  });
});
