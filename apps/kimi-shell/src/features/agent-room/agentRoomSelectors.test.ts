import { describe, expect, it } from "vitest";
import type { AgentRoomMember, AgentRoomTimeline, AgentRun, BridgeApprovalRecord } from "@/app/types";
import { selectExecutionMembers, selectTaskViews } from "./agentRoomSelectors";

describe("agentRoomSelectors", () => {
  it("groups runs under messages, merges deduplicated deltas, and retains orphan runs", () => {
    const timeline: AgentRoomTimeline = {
      messages: [{ messageId: "m1", roomId: "r1", senderKind: "user", content: "ship", createdAt: "2026-01-01T00:00:00Z" }],
      runs: [run("run-1", "m1", "member-1", "running"), run("orphan", "missing", "member-1", "failed")],
      events: [
        { seq: 1, eventId: "e1", runId: "run-1", kind: "run.reply_delta", textDelta: "hel", createdAt: "" },
        { seq: 1, eventId: "duplicate", runId: "run-1", kind: "run.reply_delta", textDelta: "ignored", createdAt: "" },
        { seq: 2, eventId: "e2", runId: "run-1", kind: "run.reply_delta", textDelta: "lo", approvalId: "a1", createdAt: "" },
      ],
    };
    const result = selectTaskViews(timeline, [member()], [approval()]);
    expect(result.tasks[0].runs[0].replyText).toBe("hello");
    expect(result.tasks[0].runs[0].approvals).toHaveLength(1);
    expect(result.orphanRuns[0].run.runId).toBe("orphan");
  });

  it("uses error, approval, running, queue, then idle member priority", () => {
    const members = [member()];
    const running = run("run-1", "m1", "member-1", "running");
    expect(selectExecutionMembers(members, { messages: [], runs: [running], events: [] }, [approval()], {})[0]?.status).toBe("waiting_approval");
    expect(selectExecutionMembers(members, { messages: [], runs: [running], events: [] }, [], {})[0]?.status).toBe("running");
    expect(selectExecutionMembers([{ ...member(), status: "workspace_mismatch" }], { messages: [], runs: [running], events: [] }, [approval()], {})[0]?.status).toBe("unreachable");
  });

  it("does not let an older failed run mask the current run", () => {
    const failed = { ...run("old", "m0", "member-1", "failed"), updatedAt: "2026-01-01T00:00:00Z" };
    const running = { ...run("current", "m1", "member-1", "running"), updatedAt: "2026-01-02T00:00:00Z" };
    expect(selectExecutionMembers([member()], { messages: [], runs: [failed, running], events: [] }, [], {})[0]?.status).toBe("running");
  });
});

function member(): AgentRoomMember {
  return { memberId: "member-1", roomId: "r1", memberKind: "pinned_session", displayName: "Frontend", sessionPolicy: "resume_selected", followMode: "pin_session", effectiveSessionId: "s1", autoApprove: false, status: "ready", createdAt: "", updatedAt: "" };
}
function run(runId: string, sourceMessageId: string, memberId: string, status: string): AgentRun {
  return { runId, roomId: "r1", sourceMessageId, memberId, originKind: "room", queuePolicy: "enqueue", status, createdAt: "", updatedAt: "" };
}
function approval(): BridgeApprovalRecord {
  return { approvalId: "a1", connectorId: "", connectorLabel: "", kimiSessionId: "s1", requestKind: "shell", prompt: "pnpm test", platform: "agent_room", chatId: "r1", status: "pending", requestPayloadJson: "{}", dedupeKey: "a1", createdAt: "", updatedAt: "" };
}
