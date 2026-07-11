import { describe, expect, it } from "vitest";
import type { WorkspaceSkillTarget } from "@/app/types";
import type { ScheduleStore, WorkspaceRecord } from "./controlCenterRebuildApi";
import {
  findWorkspaceRecordByPath,
  findWorkspaceTargetForRecord,
  matchesWorkspaceDirectoryFilters,
  normalizeWorkspacePathKey,
  shouldBackToWorkspaceDirectory,
  summarizeWorkspaceSchedule,
} from "./WorkspaceHubPanel";

function workspaceRecord(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: "workspace-1",
    name: "Demo",
    cwd: "C:\\Projects\\Demo\\",
    agentRuntime: "kimi-code",
    source: "manual",
    tags: [],
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    ...overrides,
  };
}

function workspaceTarget(overrides: Partial<WorkspaceSkillTarget> = {}): WorkspaceSkillTarget {
  return {
    id: "workspace:c:/projects/demo",
    scope: "workspace",
    label: "Demo",
    rootPath: "C:/Projects/Demo",
    readOnly: false,
    isCurrent: false,
    containerRoots: [],
    ...overrides,
  };
}

describe("WorkspaceHubPanel helpers", () => {
  it("only treats Escape in a detail view as back navigation", () => {
    expect(shouldBackToWorkspaceDirectory("Escape", true)).toBe(true);
    expect(shouldBackToWorkspaceDirectory("Escape", false)).toBe(false);
    expect(shouldBackToWorkspaceDirectory("Enter", true)).toBe(false);
  });

  it("normalizes Windows paths for stable workspace target matching", () => {
    expect(normalizeWorkspacePathKey("C:\\Projects\\Demo\\")).toBe("c:/projects/demo");
    expect(findWorkspaceTargetForRecord(workspaceRecord(), [workspaceTarget()])?.id).toBe(
      "workspace:c:/projects/demo",
    );
  });

  it("ignores user-home targets when matching a workspace record", () => {
    expect(
      findWorkspaceTargetForRecord(workspaceRecord(), [
        workspaceTarget({ id: "user_home", scope: "user_home", rootPath: "C:/Users/demo" }),
      ]),
    ).toBeNull();
  });

  it("finds a registered workspace by normalized path", () => {
    expect(
      findWorkspaceRecordByPath([workspaceRecord()], "c:/projects/demo")?.id,
    ).toBe("workspace-1");
  });

  it("combines primary workspace tabs with compact advanced filters", () => {
    const recentHarnessWorkspace = workspaceRecord({
      source: "harness",
      harnessId: "hermes-agent",
      lastOpenedAt: "2026-07-03T08:00:00.000Z",
    });

    expect(matchesWorkspaceDirectoryFilters(recentHarnessWorkspace, "all", "all")).toBe(true);
    expect(matchesWorkspaceDirectoryFilters(recentHarnessWorkspace, "all", "recent")).toBe(true);
    expect(matchesWorkspaceDirectoryFilters(recentHarnessWorkspace, "workspace", "harness_source")).toBe(true);
    expect(matchesWorkspaceDirectoryFilters(recentHarnessWorkspace, "workspace", "hermes")).toBe(false);
    expect(matchesWorkspaceDirectoryFilters(recentHarnessWorkspace, "harness", "all")).toBe(false);
    expect(matchesWorkspaceDirectoryFilters(recentHarnessWorkspace, "workspace", "manual")).toBe(false);
  });

  it("summarizes heartbeat and task state for the selected workspace", () => {
    const store: ScheduleStore = {
      heartbeats: [
        {
          id: "heartbeat-1",
          workspaceId: "workspace-1",
          enabled: true,
          intervalMinutes: 30,
          nextRunAt: "2026-07-03T10:00:00.000Z",
          lastOutcome: "executed",
          updatedAt: "2026-07-03T00:00:00.000Z",
        },
      ],
      tasks: [
        {
          id: "task-1",
          workspaceId: "workspace-1",
          name: "Morning",
          prompt: "Check status",
          cadence: { kind: "daily", at: "09:00" },
          enabled: true,
          executionPermission: "auto",
          maxRunMinutes: 10,
          nextRunAt: "2026-07-03T09:00:00.000Z",
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        },
        {
          id: "task-2",
          workspaceId: "other",
          name: "Other",
          prompt: "Ignore",
          cadence: { kind: "weekday", at: "18:00" },
          enabled: true,
          executionPermission: "auto",
          maxRunMinutes: 10,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z",
        },
      ],
    };

    const summary = summarizeWorkspaceSchedule(store, "workspace-1");
    expect(summary.heartbeat?.enabled).toBe(true);
    expect(summary.tasks).toHaveLength(1);
    expect(summary.enabledTaskCount).toBe(1);
    expect(summary.nextRunAt).toBe("2026-07-03T09:00:00.000Z");
  });
});
