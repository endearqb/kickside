// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRoomMember } from "@/app/types";

const postMessage = vi.hoisted(() => vi.fn());
const openDialog = vi.hoisted(() => vi.fn());
const getTimeline = vi.hoisted(() => vi.fn());
vi.mock("@/services/agentRoomService", () => ({ postAgentRoomMessage: postMessage, getAgentRoomTimeline: getTimeline }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog }));

import { AgentRoomComposer } from "./AgentRoomComposer";

describe("AgentRoomComposer", () => {
  beforeEach(() => {
    postMessage.mockReset();
    openDialog.mockReset();
    getTimeline.mockReset();
    getTimeline.mockResolvedValue({ messages: [], events: [{ eventId: "reply-old", seq: 1, roomId: "room-1", runId: "run-previous", kind: "run.reply_delta", textDelta: "finding", createdAt: "2026-07-19T00:01:00Z" }], runs: [{ ...completedRun }] });
    postMessage.mockResolvedValue({ message: { messageId: "message-1" }, runs: [], failures: [] });
  });
  afterEach(cleanup);

  it("previews @all and dispatches explicit multi-target IDs with mode and queue policy", async () => {
    render(<AgentRoomComposer room={room} members={members} />);
    fireEvent.click(screen.getByLabelText("@all"));
    fireEvent.change(screen.getByLabelText("任务内容"), { target: { value: "review independently" } });
    fireEvent.change(screen.getByLabelText("执行模式"), { target: { value: "parallel" } });
    fireEvent.change(screen.getByLabelText("忙碌策略"), { target: { value: "follow_up" } });
    openDialog.mockResolvedValue(["D:\\input\\brief.txt"]);
    fireEvent.click(screen.getByRole("button", { name: "选择附件" }));
    expect(await screen.findByText("brief.txt")).toBeTruthy();
    fireEvent.click(await screen.findByLabelText(/Alpha · run-prev/));

    expect(screen.getByText("Alpha、Beta")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("任务内容"), { key: "Enter", ctrlKey: true });

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith("room-1", {
        content: "review independently",
        targetMemberIds: ["member-a", "member-b"],
        mode: "parallel",
        queuePolicy: "follow_up",
        attachments: [{ kind: "file", fileName: "brief.txt", localPath: "D:\\input\\brief.txt" }],
        sharedRunIds: ["run-previous"],
      }),
    );
    expect(await screen.findByText("已创建 Message 与 Run。")).toBeTruthy();
  });

  it("adds an autocomplete target and keeps archived rooms read-only", () => {
    const { rerender } = render(<AgentRoomComposer room={room} members={members} />);
    fireEvent.change(screen.getByLabelText("任务内容"), { target: { value: "ask @alp" } });
    fireEvent.click(screen.getByRole("button", { name: "@Alpha" }));
    expect((screen.getByLabelText("任务内容") as HTMLTextAreaElement).value).toBe("ask @Alpha ");
    expect((screen.getByLabelText("Alpha") as HTMLInputElement).checked).toBe(true);

    rerender(<AgentRoomComposer room={{ ...room, archived: true }} members={members} />);
    expect(screen.getByText("已归档，只读")).toBeTruthy();
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("exposes abort-and-replace only as a fail-closed policy and reports an unconfirmed abort", async () => {
    postMessage.mockResolvedValue({
      message: { messageId: "message-2" },
      runs: [{ ...completedRun, runId: "run-blocked", status: "blocked", errorCode: "abort_unconfirmed", errorMessage: "not confirmed" }],
      failures: [],
    });
    render(<AgentRoomComposer room={room} members={members} />);
    fireEvent.click(screen.getByLabelText("Alpha"));
    fireEvent.change(screen.getByLabelText("任务内容"), { target: { value: "replace safely" } });
    fireEvent.change(screen.getByLabelText("忙碌策略"), { target: { value: "abort_and_replace" } });
    expect(screen.getByText(/不会提交替代任务/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((await screen.findByRole("dialog", { name: "Session busy 处理结果" })).textContent).toContain("Abort 未确认");
    expect(postMessage).toHaveBeenCalledWith("room-1", expect.objectContaining({ queuePolicy: "abort_and_replace" }));
  });
});

const room = {
  roomId: "room-1",
  title: "Review Room",
  description: "",
  sharedBrief: "",
  orchestrationMode: "parallel",
  archived: false,
  createdAt: "2026-07-19T00:00:00Z",
  updatedAt: "2026-07-19T00:00:00Z",
};

const members: AgentRoomMember[] = [
  {
    memberId: "member-a", roomId: "room-1", memberKind: "agent", agentId: "agent-a",
    displayName: "Alpha", rolePromptSnapshot: "", workspaceRoot: "D:/a", sessionPolicy: "per_room",
    followMode: "pin_session", effectiveSessionId: "session-a", autoApprove: false, runtimeControls: {},
    status: "idle", createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z",
  },
  {
    memberId: "member-b", roomId: "room-1", memberKind: "agent", agentId: "agent-b",
    displayName: "Beta", rolePromptSnapshot: "", workspaceRoot: "D:/b", sessionPolicy: "new_per_task",
    followMode: "pin_session", autoApprove: false, runtimeControls: {}, status: "idle",
    createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z",
  },
];

const completedRun = {
  runId: "run-previous", roomId: "room-1", sourceMessageId: "message-old", memberId: "member-a",
  agentId: "agent-a", sessionId: "session-a", workDir: "D:/a", turnId: "turn-old", promptId: "prompt-old",
  originKind: "agent_room", queuePolicy: "enqueue", status: "completed", controls: {}, promptAssembly: {},
  createdAt: "2026-07-19T00:00:00Z", completedAt: "2026-07-19T00:01:00Z", updatedAt: "2026-07-19T00:01:00Z",
};
