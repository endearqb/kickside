import { useEffect, useMemo, useState } from "react";

import type { AgentProfile, AgentRoom, AgentRoomMember } from "@/app/types";
import {
  addAgentRoomMember,
  deleteAgentRoomMember,
  listAgentRoomAgents,
  updateAgentRoomMember,
} from "@/services/agentRoomService";
import type { ObservedSessionView } from "./agentRoomObservationStore";

interface AgentRoomMemberPanelProps {
  room: AgentRoom;
  members: AgentRoomMember[];
  sessions: ObservedSessionView[];
  onMembersChange: (members: AgentRoomMember[]) => void;
}

type BindingMode = "pin_session" | "follow_pane";

export function AgentRoomMemberPanel({ room, members, sessions, onMembersChange }: AgentRoomMemberPanelProps) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [agentId, setAgentId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [paneId, setPaneId] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [bindingMode, setBindingMode] = useState<BindingMode>("pin_session");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const panes = useMemo(
    () => sessions.flatMap((session) => session.paneIds.map((id) => ({ paneId: id, session }))),
    [sessions],
  );

  useEffect(() => {
    let cancelled = false;
    void listAgentRoomAgents()
      .then((page) => {
        if (!cancelled) setAgents(page.items.filter((agent) => agent.enabled));
      })
      .catch(() => {
        if (!cancelled) setError("无法读取 Agent Profile。");
      });
    return () => { cancelled = true; };
  }, []);

  async function mutate(action: () => Promise<AgentRoomMember>, replace = false) {
    setBusy(true);
    setError("");
    try {
      const member = await action();
      onMembersChange(replace
        ? members.map((item) => item.memberId === member.memberId ? member : item)
        : [...members, member]);
    } catch {
      setError("成员操作失败；请检查 Room、Workspace 与 Session 绑定。");
    } finally {
      setBusy(false);
    }
  }

  function addAgent() {
    if (!agentId) return;
    void mutate(() => addAgentRoomMember(room.roomId, { memberKind: "agent", agentId }));
  }

  function addPinnedSession() {
    const session = sessions.find((item) => item.sessionId === sessionId);
    if (!session || !session.workDir) return;
    void mutate(() => addAgentRoomMember(room.roomId, {
      memberKind: "pinned_session",
      pinnedSessionId: session.sessionId,
      workspaceRoot: session.workDir,
      displayName: sessionName(session),
    }));
  }

  function addFollowedPane() {
    if (!paneId) return;
    void mutate(() => addAgentRoomMember(room.roomId, {
      memberKind: "followed_pane",
      followedPaneId: paneId,
      displayName: `Pane ${paneId}`,
    }));
  }

  function repairBinding() {
    if (!selectedMemberId) return;
    if (bindingMode === "pin_session") {
      const session = sessions.find((item) => item.sessionId === sessionId);
      if (!session?.workDir) return;
      void mutate(() => updateAgentRoomMember(room.roomId, selectedMemberId, {
        binding: { followMode: "pin_session", pinnedSessionId: session.sessionId, workspaceRoot: session.workDir },
      }), true);
      return;
    }
    if (!paneId) return;
    void mutate(() => updateAgentRoomMember(room.roomId, selectedMemberId, {
      binding: { followMode: "follow_pane", followedPaneId: paneId },
    }), true);
  }

  async function remove(member: AgentRoomMember) {
    if (!window.confirm(`从房间移除“${member.displayName}”？对应 Kimi Session 不会被删除。`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteAgentRoomMember(room.roomId, member.memberId);
      onMembersChange(members.filter((item) => item.memberId !== member.memberId));
    } catch {
      setError("无法移除成员。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="agent-room-management" aria-label="房间成员管理">
      <aside className="agent-room-object-list">
        <div><strong>{room.title}</strong><span>{members.length} 位成员</span></div>
        <ul>
          {members.map((member) => (
            <li key={member.memberId}>
              <button type="button" className={selectedMemberId === member.memberId ? "is-selected" : ""} onClick={() => setSelectedMemberId(member.memberId)}>
                <strong>{member.displayName}</strong><small>{memberStatus(member, sessions)}</small>
              </button>
            </li>
          ))}
        </ul>
        {!members.length ? <p>尚无成员。</p> : null}
      </aside>

      <div className="agent-room-agent-form">
        <div className="agent-room-form-heading"><h3>成员与 Session 绑定</h3></div>
        {room.archived ? <p>已归档房间为只读；恢复后才能修改成员。</p> : (
          <>
            <section>
              <h4>加入成员</h4>
              <label><span>启用的 Agent</span><select aria-label="选择 Agent" value={agentId} onChange={(event) => setAgentId(event.target.value)}><option value="">明确选择 Agent</option>{agents.map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select></label>
              <button type="button" disabled={!agentId || busy} onClick={addAgent}>加入 Agent</button>
              <label><span>已观察 Session</span><select aria-label="选择固定 Session" value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">明确选择 Session</option>{sessions.map((session) => <option key={session.sessionId} value={session.sessionId} disabled={!session.workDir}>{sessionName(session)}</option>)}</select></label>
              <button type="button" disabled={!sessionId || busy} onClick={addPinnedSession}>加入固定 Session</button>
              <label><span>Code Pane</span><select aria-label="选择跟随 Pane" value={paneId} onChange={(event) => setPaneId(event.target.value)}><option value="">明确选择 Pane</option>{panes.map((pane) => <option key={pane.paneId} value={pane.paneId}>{pane.paneId} · {sessionName(pane.session)}</option>)}</select></label>
              <button type="button" disabled={!paneId || busy} onClick={addFollowedPane}>加入并跟随 Pane</button>
            </section>
            <section>
              <h4>修复或更换绑定</h4>
              <p>先从左侧选择成员，再明确选择固定 Session 或跟随 Pane。失败时旧绑定保持不变。</p>
              <label><span>绑定方式</span><select aria-label="绑定方式" value={bindingMode} onChange={(event) => setBindingMode(event.target.value as BindingMode)}><option value="pin_session">固定 Session</option><option value="follow_pane">跟随 Pane</option></select></label>
              <button type="button" disabled={!selectedMemberId || busy || (bindingMode === "pin_session" ? !sessionId : !paneId)} onClick={repairBinding}>保存绑定</button>
              {selectedMemberId ? <button type="button" className="is-danger" disabled={busy} onClick={() => { const member = members.find((item) => item.memberId === selectedMemberId); if (member) void remove(member); }}>移出房间</button> : null}
            </section>
          </>
        )}
        {error ? <p className="agent-room-action-error" role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

function sessionName(session: ObservedSessionView) {
  const workspace = session.workDir?.split(/[\\/]+/).filter(Boolean).pop();
  return `${workspace ?? "Session"} · ${session.sessionId}`;
}

export function memberStatus(member: AgentRoomMember, sessions: ObservedSessionView[]) {
  const live = sessions.find((session) => session.sessionId === member.effectiveSessionId)?.observation?.sessionState;
  if (live) return statusLabel(live);
  if (["pane_unavailable", "session_unresolved", "workspace_mismatch"].includes(member.status)) return "待配置";
  return member.effectiveSessionId ? "等待观察" : "待配置";
}

function statusLabel(value: string) {
  return ({ running: "运行中", idle: "空闲", completed: "已完成", failed: "错误", blocked: "阻塞", unknown: "未知" } as Record<string, string>)[value] ?? value;
}
