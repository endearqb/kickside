// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSkillInventory } from "@/app/types";
import { useSkillCenterController } from "@/app/useSkillCenterController";
import { getWorkspaceSkillInventory } from "@/services/skillCenterService";

vi.mock("@/services/skillCenterService", () => ({
  getDiscoveredSkillDetail: vi.fn(),
  getSkillDetail: vi.fn(),
  getWorkspaceSkillInventory: vi.fn(),
  getWorkspaceSkillProfile: vi.fn(),
  getWorkspaceSkillRecommendations: vi.fn(),
  listActiveSessionSkills: vi.fn(),
  listGlobalSkills: vi.fn(),
  listInstalledSkills: vi.fn(),
  listSkillDiscoveryWorkspaces: vi.fn(),
  listWorkspaceSkillTargets: vi.fn(),
  scanDiscoverableSkills: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function inventory(targetId: string): WorkspaceSkillInventory {
  return {
    target: {
      id: targetId,
      scope: "workspace",
      label: targetId,
      rootPath: `/work/${targetId}`,
      readOnly: false,
      isCurrent: false,
      containerRoots: [],
    },
    scannedAt: "2026-08-12T00:00:00Z",
    containers: [],
  };
}

describe("useSkillCenterController workspace target selection", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the previous target visible until the next inventory is ready and ignores stale results", async () => {
    const first = deferred<WorkspaceSkillInventory>();
    const second = deferred<WorkspaceSkillInventory>();
    vi.mocked(getWorkspaceSkillInventory).mockImplementation((targetId) =>
      targetId === "workspace-a" ? first.promise : second.promise,
    );
    const { result } = renderHook(() =>
      useSkillCenterController({ setActionError: vi.fn() }),
    );

    let firstSelection!: Promise<WorkspaceSkillInventory | null>;
    let secondSelection!: Promise<WorkspaceSkillInventory | null>;
    act(() => {
      firstSelection = result.current.selectWorkspaceSkillTargetState("workspace-a");
      secondSelection = result.current.selectWorkspaceSkillTargetState("workspace-b");
    });

    expect(result.current.selectedWorkspaceSkillTargetId).toBeNull();
    expect(result.current.workspaceSkillInventory).toBeNull();

    await act(async () => {
      second.resolve(inventory("workspace-b"));
      await secondSelection;
    });
    expect(result.current.selectedWorkspaceSkillTargetId).toBe("workspace-b");
    expect(result.current.workspaceSkillInventory?.target.id).toBe("workspace-b");

    await act(async () => {
      first.resolve(inventory("workspace-a"));
      await firstSelection;
    });
    expect(result.current.selectedWorkspaceSkillTargetId).toBe("workspace-b");
    expect(result.current.workspaceSkillInventory?.target.id).toBe("workspace-b");
  });
});
