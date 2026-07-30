// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useInstallController } from "./useInstallController";
import type { InstallSessionEvent } from "@/app/types";

let installChannel: { onmessage: (event: InstallSessionEvent) => void } | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = () => undefined;
    constructor() {
      installChannel = this;
    }
  },
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const readyProbe = {
  wingetReady: true,
  gitReady: true,
  gitBashReady: true,
  kimiShellPath: "C:\\Program Files\\Git\\bin\\bash.exe",
  uvReady: false,
  python313Ready: false,
  kimiReady: true,
  nodeReady: true,
  coreReady: true,
};
const idleSnapshot = {
  status: "idle" as const,
  stage: "idle" as const,
  logsTruncated: false,
  logs: [],
};

function renderInstallController(setActionError = vi.fn()) {
  return {
    setActionError,
    hook: renderHook(() =>
      useInstallController({
        tauriRuntime: true,
        enabled: true,
        refreshOnboarding: vi.fn(async () => undefined),
        setActionError,
      }),
    ),
  };
}

describe("useInstallController Kimi Code updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installChannel = null;
    mockedInvoke.mockImplementation((command) => {
      if (command === "register_install_session_channel") {
        return Promise.resolve(idleSnapshot);
      }
      if (command === "get_install_probe_status") {
        return Promise.resolve(readyProbe);
      }
      if (command === "check_kimi_code_update") {
        return Promise.resolve({
          currentVersion: "0.29.2",
          latestVersion: "0.30.0",
          available: true,
        });
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
  });

  it("silently probes once at startup and exposes an available update", async () => {
    const { hook } = renderInstallController();

    await waitFor(() => expect(hook.result.current.kimiCodeUpdateStatus).toBe("available"));
    expect(
      mockedInvoke.mock.calls.filter(([command]) => command === "get_install_probe_status"),
    ).toHaveLength(1);
    expect(
      mockedInvoke.mock.calls.filter(([command]) => command === "check_kimi_code_update"),
    ).toHaveLength(1);
  });

  it("keeps update failures local and leaves manual upgrade available", async () => {
    mockedInvoke.mockImplementation((command) => {
      if (command === "register_install_session_channel") return Promise.resolve(idleSnapshot);
      if (command === "get_install_probe_status") return Promise.resolve(readyProbe);
      if (command === "check_kimi_code_update") return Promise.reject(new Error("offline"));
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
    const { hook, setActionError } = renderInstallController();

    await waitFor(() => expect(hook.result.current.kimiCodeUpdateStatus).toBe("error"));
    expect(hook.result.current.kimiCodeUpdateError).toContain("offline");
    expect(setActionError).not.toHaveBeenCalled();
  });

  it("rechecks after a successful upgrade snapshot", async () => {
    const { hook } = renderInstallController();
    await waitFor(() => expect(hook.result.current.kimiCodeUpdateStatus).toBe("available"));

    act(() => {
      installChannel?.onmessage({
        event: "snapshot",
        snapshot: {
          ...idleSnapshot,
          status: "succeeded",
          stage: "done",
          taskId: "upgrade_kimi",
          finishedAt: "2026-07-30T10:00:00Z",
        },
      });
    });

    await waitFor(() =>
      expect(
        mockedInvoke.mock.calls.filter(([command]) => command === "check_kimi_code_update"),
      ).toHaveLength(2),
    );
  });
});
