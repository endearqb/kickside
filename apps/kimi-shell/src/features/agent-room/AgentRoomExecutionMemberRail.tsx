import { ExternalLink, Plus } from "lucide-react";
import type { ExecutionMemberView } from "./agentRoomSelectors";

export function AgentRoomExecutionMemberRail({
  members,
  selectedMemberIds,
  archived,
  onToggleTarget,
  onOpenSession,
  onAdd,
}: {
  members: ExecutionMemberView[];
  selectedMemberIds: string[];
  archived: boolean;
  onToggleTarget: (memberId: string) => void;
  onOpenSession: (member: ExecutionMemberView) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="ar-member-rail" aria-label="执行成员">
      <div className="ar-rail-heading"><strong>执行成员</strong><span>{members.length}</span></div>
      <ul>
        {members.map((view) => (
          <li key={view.member.memberId}>
            <button
              type="button"
              className={`ar-member-row${selectedMemberIds.includes(view.member.memberId) ? " is-selected" : ""}`}
              aria-pressed={selectedMemberIds.includes(view.member.memberId)}
              onClick={() => onToggleTarget(view.member.memberId)}
            >
              <span className={`ar-status-dot is-${view.status}`} aria-hidden />
              <span className="ar-member-copy">
                <strong>{view.member.displayName}</strong>
                <small>{view.bindingSummary}</small>
              </span>
              {view.pendingApprovalCount ? <span className="ar-member-badge">审批 {view.pendingApprovalCount}</span> : null}
            </button>
            {view.member.effectiveSessionId ? (
              <button type="button" className="ar-member-open" aria-label={`打开 ${view.member.displayName} 的 Session`} title="打开 Session" onClick={() => onOpenSession(view)}>
                <ExternalLink size={13} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {!members.length ? <p className="ar-list-empty">还没有执行成员</p> : null}
      <button type="button" className="ar-add-member" disabled={archived} onClick={onAdd}><Plus size={14} />添加执行成员</button>
    </aside>
  );
}
