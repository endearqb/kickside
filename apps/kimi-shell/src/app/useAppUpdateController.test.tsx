// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useAppUpdateController } from "./useAppUpdateController";
import type { AppUpdateProgress } from "@/app/types";

let latestChannel: { onmessage: (event: AppUpdateProgress) => void } | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = () => undefined;
    constructor() {
      latestChannel = this;
    }
  },
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("useAppUpdateController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestChannel = null;
  });

  it("checks once at startup and reports the latest version", async () => {
    mockedInvoke.mockImplementation((command) => command === "get_app_update_source"
      ? Promise.resolve("auto")
      : Promise.resolve({ currentVersion: "0.1.12", available: false, configuredSource: "auto" }));
    const { result, rerender } = renderHook(() =>
      useAppUpdateController({ tauriRuntime: true, enabled: true }),
    );
    await waitFor(() => expect(result.current.appUpdateStatus).toBe("up_to_date"));
    rerender();
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "check_app_update")).toHaveLength(1);
  });

  it("keeps available update metadata", async () => {
    mockedInvoke.mockImplementation((command) => command === "get_app_update_source"
      ? Promise.resolve("auto")
      : Promise.resolve({
        currentVersion: "0.1.12",
        available: true,
        configuredSource: "auto",
        resolvedSource: "gitee",
        version: "0.1.13",
        body: "更新说明",
      }));
    const { result } = renderHook(() =>
      useAppUpdateController({ tauriRuntime: true, enabled: true }),
    );
    await waitFor(() => expect(result.current.appUpdateStatus).toBe("available"));
    expect(result.current.appUpdateInfo?.version).toBe("0.1.13");
  });

  it("keeps startup check failures local to update settings", async () => {
    mockedInvoke.mockImplementation((command) => command === "get_app_update_source"
      ? Promise.resolve("auto")
      : Promise.reject(new Error("offline")));
    const { result } = renderHook(() =>
      useAppUpdateController({ tauriRuntime: true, enabled: true }),
    );
    await waitFor(() => expect(result.current.appUpdateStatus).toBe("error"));
    expect(result.current.appUpdateError).toContain("offline");
  });

  it("reports download progress and ignores duplicate install clicks", async () => {
    let finish: (() => void) | undefined;
    mockedInvoke.mockImplementation((command) => {
      if (command === "get_app_update_source") return Promise.resolve("auto");
      if (command === "check_app_update") {
        return Promise.resolve({ currentVersion: "0.1.12", available: true, configuredSource: "auto", version: "0.1.13" });
      }
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const { result } = renderHook(() =>
      useAppUpdateController({ tauriRuntime: true, enabled: true }),
    );
    await waitFor(() => expect(result.current.appUpdateStatus).toBe("available"));
    act(() => {
      void result.current.installAppUpdate();
      void result.current.installAppUpdate();
    });
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "install_app_update")).toHaveLength(1);
    act(() => latestChannel?.onmessage({ stage: "downloading", downloaded: 50, total: 100 }));
    expect(result.current.appUpdateProgress?.downloaded).toBe(50);
    act(() => finish?.());
  });

  it("persists a selected source and rechecks with the saved preference", async () => {
    mockedInvoke.mockImplementation((command, payload) => {
      if (command === "get_app_update_source") return Promise.resolve("auto");
      if (command === "save_app_update_source") {
        return Promise.resolve((payload as { source: string } | undefined)?.source);
      }
      return Promise.resolve({ currentVersion: "0.1.12", available: false, configuredSource: "gitee" });
    });
    const { result } = renderHook(() =>
      useAppUpdateController({ tauriRuntime: true, enabled: true }),
    );
    await waitFor(() => expect(result.current.appUpdateStatus).toBe("up_to_date"));
    await act(async () => result.current.saveAppUpdateSource("gitee"));
    expect(mockedInvoke).toHaveBeenCalledWith("save_app_update_source", { source: "gitee" });
    expect(result.current.appUpdateSource).toBe("gitee");
    expect(mockedInvoke.mock.calls.filter(([command]) => command === "check_app_update")).toHaveLength(2);
  });

  it("does nothing in browser mode", () => {
    const { result } = renderHook(() =>
      useAppUpdateController({ tauriRuntime: false, enabled: true }),
    );
    expect(result.current.appUpdateSupported).toBe(false);
    expect(result.current.appUpdateStatus).toBe("idle");
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
