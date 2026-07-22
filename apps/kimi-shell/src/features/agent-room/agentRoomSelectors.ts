import type {
  AgentRoomEvent,
  AgentRoomMember,
  AgentRoomMessage,
  AgentRoomTimeline,
  AgentRun,
  BridgeApprovalRecord,
  SessionObservation,
} from "@/app/types";

export interface AgentRoomRunView {
  run: AgentRun;
  member?: AgentRoomMember;
  replyText: string;
  approvals: BridgeApprovalRecord[];
  artifacts: AgentRoomEvent[];
  lastEventSeq: number;
}

export interface AgentRoomTaskView {
  message: AgentRoomMessage;
  runs: AgentRoomRunView[];
}

export type ExecutionMemberStatus =
  | "failed"
  | "unreachable"
  | "waiting_approval"
  | "running"
  | "queued"
  | "idle";

export interface ExecutionMemberView {
  member: AgentRoomMember;
  status: ExecutionMemberStatus;
  pendingApprovalCount: number;
  lastRun?: AgentRun;
  bindingSummary: string;
}

export function selectTaskViews(
  timeline: AgentRoomTimeline,
  members: AgentRoomMember[],
  approvals: BridgeApprovalRecord[],
): { tasks: AgentRoomTaskView[]; orphanRuns: AgentRoomRunView[] } {
  const messages = [...timeline.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const messageIds = new Set(messages.map((message) => message.messageId));
  const toView = (run: AgentRun) => selectRunView(run, timeline.events, members, approvals);
  return {
    tasks: messages.map((message) => ({
      message,
      runs: timeline.runs
        .filter((run) => run.sourceMessageId === message.messageId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(toView),
    })),
    orphanRuns: timeline.runs
      .filter((run) => !messageIds.has(run.sourceMessageId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(toView),
  };
}

export function selectExecutionMembers(
  members: AgentRoomMember[],
  timeline: AgentRoomTimeline,
  approvals: BridgeApprovalRecord[],
  observations: Record<string, SessionObservation>,
): ExecutionMemberView[] {
  return members.map((member) => {
    const runs = timeline.runs
      .filter((run) => run.memberId === member.memberId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const pendingApprovalCount = approvals.filter(
      (approval) => approval.status === "pending" && approval.kimiSessionId === member.effectiveSessionId,
    ).length;
    return {
      member,
      lastRun: runs[0],
      pendingApprovalCount,
      status: memberStatus(member, runs, pendingApprovalCount, observations[member.effectiveSessionId ?? ""]),
      bindingSummary: memberBindingSummary(member),
    };
  });
}

function selectRunView(
  run: AgentRun,
  events: AgentRoomEvent[],
  members: AgentRoomMember[],
  approvals: BridgeApprovalRecord[],
): AgentRoomRunView {
  const ordered = events
    .filter((event) => event.runId === run.runId)
    .sort((a, b) => a.seq - b.seq)
    .filter((event, index, items) => index === 0 || event.seq !== items[index - 1].seq);
  const approvalIds = new Set(ordered.map((event) => event.approvalId).filter(Boolean));
  return {
    run,
    member: members.find((member) => member.memberId === run.memberId),
    replyText: ordered
      .filter((event) => event.kind === "run.reply_delta")
      .map((event) => event.textDelta ?? "")
      .join(""),
    approvals: approvals.filter((approval) => approvalIds.has(approval.approvalId)),
    artifacts: ordered.filter((event) => event.artifact != null),
    lastEventSeq: ordered[ordered.length - 1]?.seq ?? 0,
  };
}

function memberStatus(
  member: AgentRoomMember,
  runs: AgentRun[],
  pendingApprovalCount: number,
  observation?: SessionObservation,
): ExecutionMemberStatus {
  const latest = runs[0];
  if (["pane_unavailable", "session_unresolved", "workspace_mismatch"].includes(member.status)) return "unreachable";
  if (latest && ["failed", "blocked", "orphaned"].includes(latest.status)) return "failed";
  if (pendingApprovalCount || runs.some((run) => run.status === "waiting_approval")) return "waiting_approval";
  if (runs.some((run) => ["running", "submitting", "resolving_session", "waiting_for_lease"].includes(run.status))) return "running";
  if (runs.some((run) => run.status === "queued")) return "queued";
  if (!member.effectiveSessionId || observation?.sessionState === "failed") return "unreachable";
  return "idle";
}

function memberBindingSummary(member: AgentRoomMember) {
  if (member.followMode === "follow_pane") return `跟随窗格 ${member.followedPaneId ?? "待配置"}`;
  if (member.workspaceRoot) return directoryName(member.workspaceRoot);
  if (member.effectiveSessionId) return `Session ${shortId(member.effectiveSessionId)}`;
  return "尚未绑定 Session";
}

export function shortId(value: string, length = 8) {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

function directoryName(value: string) {
  return value.split(/[\\/]+/).filter(Boolean).pop() || value;
}
