// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useInstallController } from "./useInstallController";
import { useShellPollingController } from "./useShellPollingController";
import { useWorkspaceImportController } from "./useWorkspaceImportController";
import { completeWorkspaceImportRequest } from "@/services/workspaceImportService";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage = () => undefined;
  },
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@/services/workspaceImportService", () => ({
  cancelWorkspaceImportRequest: vi.fn(),
  completeWorkspaceImportRequest: vi.fn(async () => ({ requestId: "request-1" })),
  getActiveWorkspaceImportRequest: vi.fn(),
  listWorkspaceImportTargets: vi.fn(async () => []),
}));

describe("workspace import picker isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not install background channels or poll while disabled", () => {
    renderHook(() =>
      useInstallController({
        tauriRuntime: true,
        enabled: false,
        refreshOnboarding: vi.fn(),
        setActionError: vi.fn(),
      }),
    );
    const refresh = vi.fn(async () => undefined);
    renderHook(() =>
      useShellPollingController({
        tauriRuntime: true,
        enabled: false,
        screen: "loading",
        controlCenterModalOpen: false,
        activeControlSection: "onboarding",
        activeControlTask: null,
        activeRuntimePanel: "paths",
        bridgeState: "stopped",
        refreshStatus: refresh,
        refreshOnboarding: refresh,
        refreshInstallSettings: refresh,
        refreshWorkspaceWebSettings: refresh,
        refreshPowerShellPreflight: refresh,
        refreshBridgeSettings: refresh,
        refreshBridgeStatus: refresh,
        refreshBridgeSecretsMask: refresh,
        refreshBridgeBindings: refresh,
        refreshBridgeApprovals: refresh,
        refreshBridgeLogTail: refresh,
        refreshMainWindowCloseBehavior: refresh,
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    [true, 0],
    [false, 1],
  ])("completes an import with picker=%s and refreshes status %s times", async (picker, calls) => {
    const refreshStatus = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useWorkspaceImportController({
        tauriRuntime: true,
        listenersReady: false,
        isWorkspaceImportPickerRoute: picker,
        setActionError: vi.fn(),
        refreshStatus,
        handleCloseWindow: vi.fn(),
      }),
    );
    act(() => {
      result.current.handleWorkspaceImportRequest({
        requestId: "request-1",
        source: "explorer_files",
        itemCount: 1,
        itemPaths: ["C:\\input.txt"],
      });
    });
    await act(async () => {
      await result.current.handleSelectWorkspaceImportTarget({
        id: "workspace-1",
        kind: "known",
        rootPath: "C:\\workspace",
        label: "workspace",
        isCurrent: false,
        isDefault: false,
      });
    });
    expect(completeWorkspaceImportRequest).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    expect(refreshStatus).toHaveBeenCalledTimes(calls);
  });
});
