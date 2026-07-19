// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getTimeline: vi.fn(), openSession: vi.fn(), abortRun: vi.fn(), retryRun: vi.fn() }));

vi.mock("@/services/agentRoomService", () => ({
  getAgentRoomTimeline: mocks.getTimeline,
  openAgentRoomSession: mocks.openSession,
  abortAgentRoomRun: mocks.abortRun,
  retryAgentRoomRun: mocks.retryRun,
}));

import { AgentRoomTimelinePanel } from "./AgentRoomTimelinePanel";
import { useAgentRoomObservationStore } from "./agentRoomObservationStore";

describe("AgentRoomTimelinePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentRoomObservationStore.setState({ lastAppliedSeq: 0 });
    mocks.getTimeline.mockResolvedValue(timeline);
    mocks.openSession.mockResolvedValue(undefined);
    mocks.abortRun.mockResolvedValue(undefined);
    mocks.retryRun.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("renders read-only messages, run state, merged reply, approval, artifact, error, and exact Session open", async () => {
    render(<AgentRoomTimelinePanel roomId="room-1" members={[member]} />);
    expect(await screen.findByText("Review this change")).toBeTruthy();
    expect(screen.getByText("hello world")).toBeTruthy();
    expect(screen.getByText("审批：pending")).toBeTruthy();
    expect(screen.getByText("产物：report.txt")).toBeTruthy();
    expect(screen.getByText("runtime_error：boom")).toBeTruthy();
    expect(screen.getByText("错误")).toBeTruthy();
    expect(mocks.getTimeline).toHaveBeenCalledWith("room-1", { limit: 100 });

    fireEvent.click(screen.getByRole("button", { name: "打开 Session" }));
    await waitFor(() => expect(mocks.openSession).toHaveBeenCalledWith("session-1", "D:/repo", "focus_existing"));
  });

  it("refreshes the latest projection when the observer Cursor advances", async () => {
    render(<AgentRoomTimelinePanel roomId="room-1" members={[member]} />);
    await screen.findByText("Review this change");
    useAgentRoomObservationStore.setState({ lastAppliedSeq: 9 });
    await waitFor(() => expect(mocks.getTimeline).toHaveBeenCalledTimes(2));
  });

  it("shows FIFO position and cancels a queued Run through the existing abort command", async () => {
    mocks.getTimeline.mockResolvedValue({ ...timeline, runs: [{ ...timeline.runs[0], status: "queued", queuePosition: 2, errorCode: undefined, errorMessage: undefined }] });
    render(<AgentRoomTimelinePanel roomId="room-1" members={[member]} />);
    expect(await screen.findByText("第 2 位")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消排队" }));
    await waitFor(() => expect(mocks.abortRun).toHaveBeenCalledWith("run-1"));
  });

  it("shows allowlisted prompt assembly diagnostics without rendering a full prompt or token", async () => {
    mocks.getTimeline.mockResolvedValue({
      ...timeline,
      runs: [{
        ...timeline.runs[0],
        controls: { model: "kimi", thinking: "medium", token: "must-not-render" },
        promptAssembly: { rolePrompt: true, sharedBrief: true, sharedRunIds: ["run-shared"], task: "private full prompt" },
      }],
    });
    render(<AgentRoomTimelinePanel roomId="room-1" members={[member]} />);
    fireEvent.click(await screen.findByText("Prompt Assembly 详情"));
    expect(screen.getByText("run-shared")).toBeTruthy();
    expect(screen.getByText(/model=kimi/)).toBeTruthy();
    expect(screen.getByText("resume_selected")).toBeTruthy();
    expect(screen.queryByText("must-not-render")).toBeNull();
    expect(screen.queryByText("private full prompt")).toBeNull();
  });
});

const member = {
  memberId: "member-1", roomId: "room-1", memberKind: "agent", displayName: "Reviewer",
  workspaceRoot: "D:/repo", sessionPolicy: "resume_selected" as const, followMode: "pin_session",
  effectiveSessionId: "session-1", autoApprove: false, status: "idle",
  createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z",
};

const timeline = {
  messages: [{ messageId: "message-1", roomId: "room-1", senderKind: "user", content: "Review this change", createdAt: "2026-07-19T00:00:00Z" }],
  runs: [{ runId: "run-1", roomId: "room-1", sourceMessageId: "message-1", memberId: "member-1", sessionId: "session-1", workDir: "D:/repo", originKind: "agent_room", queuePolicy: "enqueue", status: "failed", errorCode: "runtime_error", errorMessage: "boom", createdAt: "2026-07-19T00:00:01Z", updatedAt: "2026-07-19T00:00:02Z" }],
  events: [
    { seq: 1, eventId: "event-1", roomId: "room-1", runId: "run-1", kind: "run.reply_delta", textDelta: "hello ", createdAt: "2026-07-19T00:00:01Z" },
    { seq: 2, eventId: "event-2", roomId: "room-1", runId: "run-1", kind: "run.reply_delta", textDelta: "world", createdAt: "2026-07-19T00:00:01Z" },
    { seq: 3, eventId: "event-3", roomId: "room-1", runId: "run-1", kind: "approval.requested", approvalId: "approval-1", status: "pending", createdAt: "2026-07-19T00:00:01Z" },
    { seq: 4, eventId: "event-4", roomId: "room-1", runId: "run-1", kind: "artifact.ready", artifact: { path: "report.txt" }, displayText: "report.txt", createdAt: "2026-07-19T00:00:01Z" },
  ],
};
