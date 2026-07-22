// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRoomMember, AgentRoomTimeline, BridgeApprovalRecord } from "@/app/types";
import { AgentRoomTaskStream } from "./AgentRoomTaskStream";

const service = vi.hoisted(() => ({
  abort: vi.fn(),
  open: vi.fn(),
  resolve: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("@/services/agentRoomService", () => ({
  abortAgentRoomRun: service.abort,
  openAgentRoomSession: service.open,
  resolveAgentRoomApproval: service.resolve,
  retryAgentRoomRun: service.retry,
}));

describe("AgentRoomTaskStream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps archived rooms read-only while preserving exact Session navigation", async () => {
    render(
      <AgentRoomTaskStream
        timeline={timeline()}
        members={[member()]}
        approvals={[approval()]}
        readOnly
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByRole<HTMLButtonElement>("button", { name: "允许一次" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "拒绝" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "取消排队" }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "打开 Session" }).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "在新窗格打开" }));
    await waitFor(() => expect(service.open).toHaveBeenCalledWith("session-1", "D:\\workspace", "new_pane"));
    expect(service.abort).not.toHaveBeenCalled();
    expect(service.resolve).not.toHaveBeenCalled();
  });

  it("offers the required first action when a room has no execution members", () => {
    const onAddMember = vi.fn();
    render(<AgentRoomTaskStream timeline={{ messages: [], runs: [], events: [] }} members={[]} approvals={[]} onAddMember={onAddMember} onChanged={vi.fn()} />);
    expect(screen.getByText("还没有执行成员")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "添加当前 Session" }));
    expect(onAddMember).toHaveBeenCalledOnce();
  });
});

function timeline(): AgentRoomTimeline {
  return {
    messages: [{ messageId: "message-1", roomId: "room-1", senderKind: "user", content: "检查实现", createdAt: "2026-07-22T00:00:00Z" }],
    runs: [{ runId: "run-1", roomId: "room-1", sourceMessageId: "message-1", memberId: "member-1", sessionId: "session-1", workDir: "D:\\workspace", originKind: "room", queuePolicy: "enqueue", status: "queued", createdAt: "2026-07-22T00:00:00Z", updatedAt: "2026-07-22T00:00:00Z" }],
    events: [{ seq: 1, eventId: "event-1", roomId: "room-1", runId: "run-1", sessionId: "session-1", approvalId: "approval-1", kind: "run.approval_requested", createdAt: "2026-07-22T00:00:00Z" }],
  };
}

function member(): AgentRoomMember {
  return { memberId: "member-1", roomId: "room-1", memberKind: "pinned_session", displayName: "前端", sessionPolicy: "resume_selected", followMode: "pin_session", effectiveSessionId: "session-1", workspaceRoot: "D:\\workspace", autoApprove: false, status: "ready", createdAt: "", updatedAt: "" };
}

function approval(): BridgeApprovalRecord {
  return { approvalId: "approval-1", connectorId: "", connectorLabel: "", kimiSessionId: "session-1", requestKind: "shell", prompt: "pnpm test", platform: "agent_room", chatId: "room-1", status: "pending", requestPayloadJson: "{}", dedupeKey: "approval-1", createdAt: "", updatedAt: "" };
}
