// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProfile, AgentRoom, AgentRoomMember } from "@/app/types";
import type { ObservedSessionView } from "./agentRoomObservationStore";

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  deleteMember: vi.fn(),
}));

vi.mock("@/services/agentRoomService", () => ({
  listAgentRoomAgents: mocks.listAgents,
  addAgentRoomMember: mocks.addMember,
  updateAgentRoomMember: mocks.updateMember,
  deleteAgentRoomMember: mocks.deleteMember,
}));

import { AgentRoomMemberPanel } from "./AgentRoomMemberPanel";

describe("AgentRoomMemberPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAgents.mockResolvedValue({ items: [agent], cursor: "" });
    mocks.addMember.mockImplementation(async (_roomId, input) => member({
      memberKind: input.memberKind,
      agentId: input.agentId,
      followedPaneId: input.followedPaneId,
      effectiveSessionId: input.pinnedSessionId ?? session.sessionId,
      workspaceRoot: input.workspaceRoot ?? session.workDir,
    }));
    mocks.updateMember.mockImplementation(async () => member({ effectiveSessionId: session.sessionId }));
    mocks.deleteMember.mockResolvedValue({ status: "deleted" });
  });

  afterEach(cleanup);

  it("adds an enabled Agent, an explicitly selected Session, and an explicitly selected Pane", async () => {
    render(<AgentRoomMemberPanel room={room()} members={[]} sessions={[session]} onMembersChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Reviewer" });

    fireEvent.change(screen.getByLabelText("选择 Agent"), { target: { value: agent.agentId } });
    fireEvent.click(screen.getByRole("button", { name: "加入 Agent" }));
    await waitFor(() => expect(mocks.addMember).toHaveBeenCalledWith("room-1", { memberKind: "agent", agentId: agent.agentId }));

    fireEvent.change(screen.getByLabelText("选择固定 Session"), { target: { value: session.sessionId } });
    fireEvent.click(screen.getByRole("button", { name: "加入固定 Session" }));
    await waitFor(() => expect(mocks.addMember).toHaveBeenCalledWith("room-1", expect.objectContaining({
      memberKind: "pinned_session", pinnedSessionId: session.sessionId, workspaceRoot: session.workDir,
    })));

    fireEvent.change(screen.getByLabelText("选择跟随 Pane"), { target: { value: "pane-1" } });
    fireEvent.click(screen.getByRole("button", { name: "加入并跟随 Pane" }));
    await waitFor(() => expect(mocks.addMember).toHaveBeenCalledWith("room-1", {
      memberKind: "followed_pane", followedPaneId: "pane-1", displayName: "Pane pane-1",
    }));
  });

  it("shows live Session state and repairs binding atomically without deleting the Session", async () => {
    const existing = member({ status: "workspace_mismatch", effectiveSessionId: session.sessionId });
    render(<AgentRoomMemberPanel room={room()} members={[existing]} sessions={[session]} onMembersChange={vi.fn()} />);
    expect(await screen.findByText("运行中")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Member/ }));
    fireEvent.change(screen.getByLabelText("选择固定 Session"), { target: { value: session.sessionId } });
    fireEvent.click(screen.getByRole("button", { name: "保存绑定" }));
    await waitFor(() => expect(mocks.updateMember).toHaveBeenCalledWith("room-1", existing.memberId, {
      binding: { followMode: "pin_session", pinnedSessionId: session.sessionId, workspaceRoot: session.workDir },
    }));

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "移出房间" }));
    await waitFor(() => expect(mocks.deleteMember).toHaveBeenCalledWith("room-1", existing.memberId));
    expect(confirm.mock.calls[0]?.[0]).toContain("Kimi Session 不会被删除");
  });

  it("keeps archived Rooms read-only", async () => {
    render(<AgentRoomMemberPanel room={room({ archived: true })} members={[member()]} sessions={[session]} onMembersChange={vi.fn()} />);
    expect(await screen.findByText(/已归档房间为只读/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "加入 Agent" })).toBeNull();
    expect(mocks.addMember).not.toHaveBeenCalled();
    expect(mocks.updateMember).not.toHaveBeenCalled();
    expect(mocks.deleteMember).not.toHaveBeenCalled();
  });
});

const agent: AgentProfile = {
  agentId: "agent-1", name: "Reviewer", rolePrompt: "Review", defaultWorkDir: "D:/repo",
  sessionPolicy: "per_room", autoApprove: false, enabled: true, revision: 1,
  createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z",
};

const session: ObservedSessionView = {
  sessionId: "session-1", paneIds: ["pane-1"], primaryPaneId: "pane-1", visible: true,
  pinned: false, workDir: "D:/repo", recentEvents: [],
  observation: { sessionId: "session-1", generation: 1, lastSeq: 1, sessionState: "running", controlOrigin: "pane_manual", pendingApprovals: 0, updatedAt: "2026-07-19T00:00:00Z" },
};

function room(overrides: Partial<AgentRoom> = {}): AgentRoom {
  return { roomId: "room-1", title: "Room", orchestrationMode: "direct", archived: false, createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z", ...overrides };
}

function member(overrides: Partial<AgentRoomMember> = {}): AgentRoomMember {
  return { memberId: "member-1", roomId: "room-1", memberKind: "pinned_session", displayName: "Member", workspaceRoot: "D:/repo", sessionPolicy: "resume_selected", followMode: "pin_session", pinnedSessionId: "session-1", effectiveSessionId: "session-1", autoApprove: false, status: "idle", createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z", ...overrides };
}
