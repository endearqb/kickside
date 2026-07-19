import type { BridgeApprovalRecord } from "@/app/types";

export type AgentRoomApprovalDecision = "approved" | "rejected";

export function AgentRoomApprovalPanel({
  approvals,
  busyIds,
  error,
  onResolve,
}: {
  approvals: BridgeApprovalRecord[];
  busyIds: Set<string>;
  error: string;
  onResolve: (approval: BridgeApprovalRecord, decision: AgentRoomApprovalDecision) => void;
}) {
  const ordered = [...approvals].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return (
    <section className="agent-room-approval-panel" aria-label="Agent Room Approval Inbox">
      <div className="agent-room-section-heading"><h3>Approval Inbox</h3><span>{ordered.filter((item) => item.status === "pending").length} 个待处理</span></div>
      <p className="agent-room-permission-warning">审批会授权 Runtime 执行工具操作，请先核对 Agent、Session 与请求类型。</p>
      {!ordered.length ? <p>当前没有 Agent Room Approval。</p> : (
        <ol>
          {ordered.map((approval) => (
            <li key={approval.approvalId}>
              <AgentRoomApprovalCard approval={approval} busy={busyIds.has(approval.approvalId)} onResolve={onResolve} />
            </li>
          ))}
        </ol>
      )}
      {error ? <p className="agent-room-action-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function AgentRoomApprovalCard({
  approval,
  busy,
  compact = false,
  onResolve,
}: {
  approval: BridgeApprovalRecord;
  busy: boolean;
  compact?: boolean;
  onResolve: (approval: BridgeApprovalRecord, decision: AgentRoomApprovalDecision) => void;
}) {
  const pending = approval.status === "pending";
  return (
    <article className={`agent-room-approval-card${compact ? " is-compact" : ""}`}>
      <header><strong>{approval.requestKind || "Runtime Approval"}</strong><span>{approvalStatus(approval.status)}</span></header>
      <dl>
        <div><dt>Room</dt><dd>{shortValue(approval.chatId)}</dd></div>
        <div><dt>Session</dt><dd>{shortValue(approval.kimiSessionId)}</dd></div>
      </dl>
      {approval.prompt ? <p>{approval.prompt}</p> : null}
      {pending ? (
        <div className="agent-room-approval-actions">
          <button type="button" disabled={busy} onClick={() => onResolve(approval, "approved")}>批准一次</button>
          <button type="button" disabled title="Runtime 的 Session scope 跨重启能力尚未验证">本 Session 批准</button>
          <button type="button" disabled={busy} className="is-destructive" onClick={() => onResolve(approval, "rejected")}>拒绝</button>
        </div>
      ) : <p className="agent-room-approval-resolved">已处理：{approvalStatus(approval.status)}</p>}
    </article>
  );
}

function approvalStatus(value: string) {
  return ({ pending: "待审批", approved: "已批准", rejected: "已拒绝", stale_failed: "已失效" } as Record<string, string>)[value] ?? value;
}

function shortValue(value: string) {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}
