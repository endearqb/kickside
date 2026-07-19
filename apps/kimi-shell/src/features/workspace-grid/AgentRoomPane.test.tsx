// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRooms: vi.fn(),
  getRoom: vi.fn(),
  addMember: vi.fn(),
  createAgent: vi.fn(),
  listAgents: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  listObservations: vi.fn(),
  openSession: vi.fn(),
  pin: vi.fn(),
  postMessage: vi.fn(),
  getTimeline: vi.fn(),
  listApprovals: vi.fn(),
  resolveApproval: vi.fn(),
  abortRun: vi.fn(),
  retryRun: vi.fn(),
}));

vi.mock("@/services/agentRoomService", () => ({
  listAgentRooms: mocks.listRooms,
  getAgentRoom: mocks.getRoom,
  addAgentRoomMember: mocks.addMember,
  createAgentRoomAgent: mocks.createAgent,
  listAgentRoomAgents: mocks.listAgents,
  updateAgentRoomAgent: mocks.updateAgent,
  deleteAgentRoomAgent: mocks.deleteAgent,
  listAgentRoomObservations: mocks.listObservations,
  openAgentRoomSession: mocks.openSession,
  setAgentRoomObservationPin: mocks.pin,
  postAgentRoomMessage: mocks.postMessage,
  getAgentRoomTimeline: mocks.getTimeline,
  listAgentRoomApprovals: mocks.listApprovals,
  resolveAgentRoomApproval: mocks.resolveApproval,
  abortAgentRoomRun: mocks.abortRun,
  retryAgentRoomRun: mocks.retryRun,
}));

vi.mock("@/features/control-center/controlCenterRebuildApi", () => ({
  listWorkspaces: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { AgentRoomPane } from "./AgentRoomPane";
import { useAgentRoomObservationStore } from "./agentRoomObservationStore";

describe("AgentRoomPane observer UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listRooms.mockResolvedValue({ items: [room], cursor: "" });
    mocks.listAgents.mockResolvedValue({ items: [] });
    mocks.getRoom.mockResolvedValue({ room, members: [] });
    mocks.addMember.mockImplementation(async (_roomId, input) => ({
      memberId: "member-new",
      roomId: "room-1",
      memberKind: input.memberKind,
      displayName: input.displayName,
      workspaceRoot: input.workspaceRoot,
      sessionPolicy: "resume_selected",
      followMode: input.memberKind === "followed_pane" ? "follow_pane" : "pin_session",
      followedPaneId: input.followedPaneId,
      pinnedSessionId: input.pinnedSessionId,
      effectiveSessionId: input.pinnedSessionId ?? "session-visible",
      autoApprove: false,
      status: "idle",
      createdAt: "2026-07-18T00:00:00Z",
      updatedAt: "2026-07-18T00:00:00Z",
    }));
    mocks.openSession.mockResolvedValue({});
    mocks.pin.mockResolvedValue({ sessionId: "session-visible", pinned: true });
    mocks.listObservations.mockResolvedValue({
      items: observations,
      pinnedSessionIds: ["session-closed"],
      observerRunning: true,
    });
    mocks.getTimeline.mockResolvedValue({ messages: [], runs: [], events: [] });
    mocks.listApprovals.mockResolvedValue([]);
    mocks.resolveApproval.mockResolvedValue(undefined);
    useAgentRoomObservationStore.setState({
      panes: [
        {
          paneId: "pane-code",
          effectiveSessionId: "session-visible",
          workDir: "D:/repo",
          visible: true,
          active: true,
          maximized: false,
          mountPolicy: "eager",
          loadState: "ready",
          generation: 1,
          updatedAt: "2026-07-18T00:00:00Z",
        },
      ],
      observations: Object.fromEntries(observations.map((item) => [item.sessionId, item])),
      pinnedSessionIds: ["session-closed"],
      recentEvents: {},
      lastAppliedSeq: 2,
      capabilities: {
        runtimeProvider: "server",
        core: true,
        observer: true,
        multiSessionObservation: true,
        sessionTranscript: true,
        userPromptEvents: false,
        abort: false,
        approval: true,
        nativeFollowUp: false,
        degradations: ["user_prompt_events_unsupported"],
      },
      pump: { state: "ready", generation: 1, cursor: 2, retryCount: 0 },
      observerRunning: true,
      syncErrorCode: undefined,
    });
  });

  afterEach(cleanup);

  it("shows deduplicated pane and pinned sessions with explicit manual-prompt degradation", async () => {
    renderPane();

    expect(await screen.findByText("Session session-visi…")).toBeTruthy();
    expect(screen.getByText("当前可见")).toBeTruthy();
    expect(screen.getByText("Session session-clos…")).toBeTruthy();
    expect(screen.getByText("已固定")).toBeTruthy();
    expect(screen.getByText("由 Pane 发起的任务（Prompt 未知）")).toBeTruthy();
    expect(screen.getByText("能力降级：user_prompt_events_unsupported")).toBeTruthy();
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("adds a pinned member or followed pane using the existing observer-only APIs", async () => {
    renderPane();
    await screen.findByText("Session session-visi…");

    fireEvent.click(screen.getAllByRole("button", { name: "加入房间" })[0]!);
    await waitFor(() =>
      expect(mocks.addMember).toHaveBeenCalledWith(
        "room-1",
        expect.objectContaining({
          memberKind: "pinned_session",
          pinnedSessionId: "session-visible",
          workspaceRoot: "D:/repo",
        }),
      ),
    );

    cleanup();
    mocks.getRoom.mockResolvedValueOnce({ room, members: [] });
    renderPane();
    await screen.findByText("Session session-visi…");
    fireEvent.click(screen.getByRole("button", { name: "跟随 Pane" }));
    await waitFor(() =>
      expect(mocks.addMember).toHaveBeenCalledWith(
        "room-1",
        expect.objectContaining({
          memberKind: "followed_pane",
          followedPaneId: "pane-code",
        }),
      ),
    );
    expect(mocks.postMessage).not.toHaveBeenCalled();
  });

  it("reopens a closed pinned session through the validating Tauri command", async () => {
    renderPane();
    await screen.findByText("Session session-clos…");
    fireEvent.click(screen.getByRole("button", { name: "重新打开" }));

    await waitFor(() =>
      expect(mocks.openSession).toHaveBeenCalledWith(
        "session-closed",
        "D:/closed",
        "focus_existing",
      ),
    );
  });

  it("reports a missing Session and opens an explicit Agent form for an observed Session", async () => {
    mocks.openSession.mockRejectedValueOnce({ code: "session_not_found" });
    renderPane();
    await screen.findByText("Session session-clos…");

    fireEvent.click(screen.getByRole("button", { name: "重新打开" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Session 不存在，无法重新打开。",
    );

    fireEvent.click(screen.getAllByRole("button", { name: "保存为 Agent" })[0]!);
    expect(await screen.findByRole("heading", { name: "新建 Agent" })).toBeTruthy();
    expect((screen.getByLabelText("默认 Workspace") as HTMLSelectElement).value).toBe("D:/repo");
    expect((screen.getByLabelText("固定 Session") as HTMLSelectElement).value).toBe("session-visible");
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });
});

function renderPane() {
  return render(
    <AgentRoomPane
      roomId="room-1"
      active
      mountPolicy="eager"
      onSelectRoom={vi.fn()}
      onResume={vi.fn()}
    />,
  );
}

const room = {
  roomId: "room-1",
  title: "Review Room",
  orchestrationMode: "parallel",
  archived: false,
  createdAt: "2026-07-18T00:00:00Z",
  updatedAt: "2026-07-18T00:00:00Z",
};

const observations = [
  {
    sessionId: "session-visible",
    generation: 1,
    workDir: "D:/repo",
    lastSeq: 2,
    lastEventAt: "2026-07-18T00:00:02Z",
    sessionState: "running",
    controlOrigin: "pane_manual",
    lastReply: "Review reply",
    pendingApprovals: 1,
    updatedAt: "2026-07-18T00:00:02Z",
  },
  {
    sessionId: "session-closed",
    generation: 1,
    workDir: "D:/closed",
    lastSeq: 1,
    lastEventAt: "2026-07-18T00:00:01Z",
    sessionState: "idle",
    controlOrigin: "runtime_external",
    pendingApprovals: 0,
    updatedAt: "2026-07-18T00:00:01Z",
  },
];
