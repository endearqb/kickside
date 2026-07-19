import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: mocks.listen }),
}));

import {
  AGENT_ROOM_EVENTS_EVENT,
  AGENT_ROOM_PUMP_STATUS_EVENT,
  addAgentRoomMember,
  abortAgentRoomRun,
  createAgentRoom,
  createAgentRoomAgent,
  deleteAgentRoom,
  deleteAgentRoomAgent,
  deleteAgentRoomMember,
  getAgentRoom,
  getAgentRoomCapabilities,
  getAgentRoomDiagnostics,
  getAgentRoomTimeline,
  listAgentRoomAgents,
  listAgentRoomApprovals,
  listAgentRoomMembers,
  listAgentRoomObservations,
  listAgentRooms,
  openAgentRoomSession,
  postAgentRoomMessage,
  resolveAgentRoomApproval,
  retryAgentRoomRun,
  setAgentRoomObservationPin,
  subscribeAgentRoomEvents,
  syncAgentRoomPaneSessions,
  updateAgentRoom,
  updateAgentRoomAgent,
  updateAgentRoomMember,
} from "./agentRoomService";

describe("agentRoomService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters the shared approval command to Agent Room and reuses Bridge status diagnostics", async () => {
    mocks.invoke.mockResolvedValueOnce([
      { approvalId: "room", platform: "agent_room" },
      { approvalId: "im", platform: "feishu" },
    ]).mockResolvedValueOnce({ agentRoom: { core: "running" } });
    await expect(listAgentRoomApprovals()).resolves.toEqual([{ approvalId: "room", platform: "agent_room" }]);
    await getAgentRoomDiagnostics();
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "list_bridge_approvals", { status: undefined });
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "get_bridge_status");
  });

  it("routes Agent Room operations only through Tauri commands", async () => {
    mocks.invoke.mockResolvedValue(undefined);
    const agent = {
      name: "Reviewer",
      rolePrompt: "Review",
      defaultWorkDir: "D:/repo",
      sessionPolicy: "persistent" as const,
      autoApprove: false,
      enabled: true,
    };
    const message = { content: "Review this", targetMemberIds: ["member-1"] };
    const panes = { generation: 4, panes: [] };
    const approval = { approvalId: "approval-1", status: "approved" };

    await listAgentRoomAgents();
    await createAgentRoomAgent(agent);
    await updateAgentRoomAgent("agent-1", { revision: 2, description: "Updated" });
    await deleteAgentRoomAgent("agent-1");
    await listAgentRooms({ archived: false, cursor: "cursor-1", limit: 20 });
    await getAgentRoom("room-1");
    await createAgentRoom({ title: "Room", orchestrationMode: "direct" });
    await updateAgentRoom("room-1", { title: "Updated room" });
    await deleteAgentRoom("room-1");
    await listAgentRoomMembers("room-1");
    await getAgentRoomTimeline("room-1", { limit: 100 });
    await addAgentRoomMember("room-1", { memberKind: "agent", agentId: "agent-1" });
    const memberPatch = {
      displayName: "Reviewer",
      binding: {
        followMode: "pin_session" as const,
        pinnedSessionId: "session-1",
        workspaceRoot: "D:/repo",
      },
    };
    await updateAgentRoomMember("room-1", "member-1", memberPatch);
    await deleteAgentRoomMember("room-1", "member-1");
    await postAgentRoomMessage("room-1", message);
    await abortAgentRoomRun("run-1");
    await retryAgentRoomRun("run-1", { sessionMode: "same_session" });
    await resolveAgentRoomApproval(approval);
    await syncAgentRoomPaneSessions(panes);
    await getAgentRoomCapabilities();
    await listAgentRoomObservations();
    await setAgentRoomObservationPin("session-1", true);
    await openAgentRoomSession("session-1", "D:/repo", "focus_existing");

    expect(mocks.invoke.mock.calls).toEqual([
      ["agent_room_list_agents"],
      ["agent_room_create_agent", { input: agent }],
      [
        "agent_room_update_agent",
        { agentId: "agent-1", input: { revision: 2, description: "Updated" } },
      ],
      ["agent_room_delete_agent", { agentId: "agent-1" }],
      [
        "agent_room_list_rooms",
        { archived: false, cursor: "cursor-1", limit: 20 },
      ],
      ["agent_room_get_room", { roomId: "room-1" }],
      [
        "agent_room_create_room",
        { input: { title: "Room", orchestrationMode: "direct" } },
      ],
      [
        "agent_room_update_room",
        { roomId: "room-1", input: { title: "Updated room" } },
      ],
      ["agent_room_delete_room", { roomId: "room-1" }],
      ["agent_room_list_members", { roomId: "room-1" }],
      ["agent_room_get_timeline", { roomId: "room-1", afterSeq: undefined, beforeSeq: undefined, limit: 100 }],
      [
        "agent_room_add_member",
        { roomId: "room-1", input: { memberKind: "agent", agentId: "agent-1" } },
      ],
      [
        "agent_room_update_member",
        { roomId: "room-1", memberId: "member-1", input: memberPatch },
      ],
      ["agent_room_delete_member", { roomId: "room-1", memberId: "member-1" }],
      ["agent_room_post_message", { roomId: "room-1", input: message }],
      ["agent_room_abort_run", { runId: "run-1" }],
      [
        "agent_room_retry_run",
        { runId: "run-1", input: { sessionMode: "same_session" } },
      ],
      ["agent_room_resolve_approval", { input: approval }],
      ["agent_room_sync_pane_sessions", { input: panes }],
      ["agent_room_get_capabilities"],
      ["agent_room_list_observations"],
      ["agent_room_set_observation_pin", { sessionId: "session-1", pinned: true }],
      [
        "agent_room_open_session",
        { sessionId: "session-1", workDir: "D:/repo", disposition: "focus_existing" },
      ],
    ]);
  });

  it("forwards main-window events and unregisters both listeners", async () => {
    const unlistenEvents = vi.fn();
    const unlistenStatus = vi.fn();
    mocks.listen
      .mockResolvedValueOnce(unlistenEvents)
      .mockResolvedValueOnce(unlistenStatus);
    const onEvents = vi.fn();
    const onStatus = vi.fn();

    const unlisten = await subscribeAgentRoomEvents(onEvents, onStatus);
    const eventsHandler = mocks.listen.mock.calls[0][1];
    const statusHandler = mocks.listen.mock.calls[1][1];
    const eventsPayload = {
      items: [],
      nextSeq: 9,
      hasMore: false,
      serverTime: "2026-07-19T00:00:00Z",
      generation: 2,
    };
    const statusPayload = {
      state: "ready",
      generation: 2,
      cursor: 9,
      retryCount: 0,
    };
    eventsHandler({ payload: eventsPayload });
    statusHandler({ payload: statusPayload });
    unlisten();

    expect(mocks.listen.mock.calls.map(([event]) => event)).toEqual([
      AGENT_ROOM_EVENTS_EVENT,
      AGENT_ROOM_PUMP_STATUS_EVENT,
    ]);
    expect(onEvents).toHaveBeenCalledWith(eventsPayload);
    expect(onStatus).toHaveBeenCalledWith(statusPayload);
    expect(unlistenEvents).toHaveBeenCalledOnce();
    expect(unlistenStatus).toHaveBeenCalledOnce();
  });

  it("unregisters the event listener when status subscription fails", async () => {
    const unlistenEvents = vi.fn();
    mocks.listen
      .mockResolvedValueOnce(unlistenEvents)
      .mockRejectedValueOnce(new Error("listen failed"));

    await expect(subscribeAgentRoomEvents(vi.fn(), vi.fn())).rejects.toThrow(
      "listen failed",
    );
    expect(unlistenEvents).toHaveBeenCalledOnce();
  });
});
