// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRoom, AgentRoomMember } from "@/app/types";
import { postAgentRoomMessage } from "@/services/agentRoomService";
import { AgentRoomCompactComposer } from "./AgentRoomCompactComposer";

vi.mock("@/services/agentRoomService", () => ({ postAgentRoomMessage: vi.fn() }));

describe("AgentRoomCompactComposer", () => {
  beforeEach(() => vi.mocked(postAgentRoomMessage).mockReset());
  afterEach(cleanup);

  it("sends direct+enqueue with Ctrl+Enter and only clears after success", async () => {
    vi.mocked(postAgentRoomMessage).mockResolvedValue({ message: { messageId: "m1" } as never, runs: [], failures: [{ memberId: "member-1", code: "busy", message: "Session 正忙" }] });
    render(<AgentRoomCompactComposer room={room()} members={[member()]} selectedMemberIds={["member-1"]} onTargetsChange={vi.fn()} onDispatched={vi.fn()} />);
    const input = screen.getByLabelText("任务内容");
    fireEvent.change(input, { target: { value: "ship it" } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(postAgentRoomMessage).toHaveBeenCalledWith("room-1", expect.objectContaining({ mode: "direct", queuePolicy: "enqueue", targetMemberIds: ["member-1"] })));
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByText(/Frontend：Session 正忙/)).toBeTruthy();
  });

  it("supports keyboard target selection and closes overlays with Escape", () => {
    const onTargetsChange = vi.fn();
    render(<AgentRoomCompactComposer room={room()} members={[member()]} selectedMemberIds={[]} onTargetsChange={onTargetsChange} onDispatched={vi.fn()} />);
    const input = screen.getByLabelText("任务内容");
    fireEvent.change(input, { target: { value: "@F" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onTargetsChange).toHaveBeenCalledWith(["member-1"]);
    expect((input as HTMLTextAreaElement).value).toBe("@Frontend ");

    fireEvent.change(input, { target: { value: "@" } });
    expect(screen.getByRole("listbox", { name: "执行成员建议" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "执行成员建议" })).toBeNull();

    const more = screen.getByRole("button", { name: "更多发送选项" });
    fireEvent.click(more);
    expect(screen.getByText("忙碌时：FIFO 排队")).toBeTruthy();
    fireEvent.keyDown(more, { key: "Escape" });
    expect(screen.queryByText("忙碌时：FIFO 排队")).toBeNull();
    expect(document.activeElement).toBe(input);
  });
});

function room(): AgentRoom { return { roomId: "room-1", title: "Room", orchestrationMode: "direct", archived: false, createdAt: "", updatedAt: "" }; }
function member(): AgentRoomMember { return { memberId: "member-1", roomId: "room-1", memberKind: "pinned_session", displayName: "Frontend", sessionPolicy: "resume_selected", followMode: "pin_session", effectiveSessionId: "s1", autoApprove: false, status: "ready", createdAt: "", updatedAt: "" }; }
