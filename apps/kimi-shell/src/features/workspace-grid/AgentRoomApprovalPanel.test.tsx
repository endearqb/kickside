// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRoomApprovalPanel } from "./AgentRoomApprovalPanel";

afterEach(cleanup);

describe("AgentRoomApprovalPanel", () => {
  it("supports one-shot approve/reject, disables unverified session scope, and shows resolved state", () => {
    const onResolve = vi.fn();
    render(<AgentRoomApprovalPanel approvals={[pending, { ...pending, approvalId: "resolved", status: "approved" }]} busyIds={new Set()} error="" onResolve={onResolve} />);
    expect(screen.getByText("1 个待处理")).toBeTruthy();
    expect(screen.getByText(/请先核对 Agent/)).toBeTruthy();
    expect(screen.getByText("已处理：已批准")).toBeTruthy();
    expect((screen.getAllByRole("button", { name: "本 Session 批准" })[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "批准一次" }));
    expect(onResolve).toHaveBeenCalledWith(pending, "approved");
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
    expect(onResolve).toHaveBeenCalledWith(pending, "rejected");
  });
});

const pending = {
  approvalId: "approval-1", connectorId: "", connectorLabel: "", kimiSessionId: "session-1",
  requestKind: "tool", prompt: "Run a local command", platform: "agent_room" as const,
  chatId: "room-1", status: "pending", requestPayloadJson: "{}", dedupeKey: "approval-1",
  createdAt: "2026-07-19T00:00:00Z", updatedAt: "2026-07-19T00:00:00Z",
};
