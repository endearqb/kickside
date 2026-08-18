// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as lanAccessService from "@/services/lanAccessService";
import { useLanAccessController } from "./useLanAccessController";

vi.mock("@/services/lanAccessService", () => ({
  getKimiLanAccessStatus: vi.fn(),
  getKimiLanLaunchUrl: vi.fn(),
  setKimiLanAccess: vi.fn(),
}));

const localStatus: lanAccessService.KimiLanAccessStatus = {
  enabled: false,
  switching: false,
  runtimeOwnership: "owned_by_shell",
  runtimeReady: true,
  canToggle: true,
  port: 57820,
  addresses: [],
  tokenAvailable: true,
};

describe("useLanAccessController", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("refreshes the Shell runtime projection after a successful restart", async () => {
    vi.mocked(lanAccessService.getKimiLanAccessStatus).mockResolvedValue(localStatus);
    vi.mocked(lanAccessService.setKimiLanAccess).mockResolvedValue({
      ...localStatus,
      enabled: true,
    });
    const onRuntimeChanged = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLanAccessController(true, onRuntimeChanged),
    );
    await waitFor(() => expect(result.current.status).toEqual(localStatus));

    await act(async () => {
      await result.current.toggle(true);
    });

    expect(onRuntimeChanged).toHaveBeenCalledOnce();
    expect(result.current.status?.enabled).toBe(true);
  });

  it("refreshes the Shell projection after a failed switch and rollback", async () => {
    vi.mocked(lanAccessService.getKimiLanAccessStatus).mockResolvedValue(localStatus);
    vi.mocked(lanAccessService.setKimiLanAccess).mockRejectedValue(
      new Error("switch failed; rollback completed"),
    );
    const onRuntimeChanged = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useLanAccessController(true, onRuntimeChanged),
    );
    await waitFor(() => expect(result.current.status).toEqual(localStatus));

    await act(async () => {
      await result.current.toggle(true);
    });

    expect(onRuntimeChanged).toHaveBeenCalledOnce();
    expect(result.current.error).toBe("switch failed; rollback completed");
  });
});
