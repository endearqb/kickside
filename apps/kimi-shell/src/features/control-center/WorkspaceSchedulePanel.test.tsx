// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSchedulePanel } from "./WorkspaceSchedulePanel";

const workspace = {
  id: "workspace-1",
  name: "Demo Workspace",
  cwd: "/Users/demo/workspace",
  agentRuntime: "kimi-code",
  source: "manual",
  tags: [],
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

vi.mock("./controlCenterRebuildApi", () => ({
  createScheduledTask: vi.fn(),
  deleteScheduledTask: vi.fn(),
  listRuns: vi.fn(async () => []),
  listSchedule: vi.fn(async () => ({ heartbeats: [], tasks: [] })),
  listWorkspaces: vi.fn(async () => [workspace]),
  runScheduleNow: vi.fn(),
  setHeartbeat: vi.fn(),
}));

afterEach(cleanup);

describe("WorkspaceSchedulePanel", () => {
  it("uses the unified rail as the only workspace list in detail mode", async () => {
    const onRailGroupsChange = vi.fn();
    render(
      <WorkspaceSchedulePanel
        detailOnly
        onRailGroupsChange={onRailGroupsChange}
      />,
    );

    expect(await screen.findByRole("heading", { name: workspace.name })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "调度工作区" })).toBeNull();
    expect(screen.getByRole("heading", { name: "工作区心跳" })).toBeTruthy();
    await waitFor(() => {
      const latest = onRailGroupsChange.mock.calls[onRailGroupsChange.mock.calls.length - 1]?.[0];
      expect(latest?.[0]?.items?.[0]).toMatchObject({
        label: workspace.name,
        statusLabel: "已停止",
      });
    });
  });
});
