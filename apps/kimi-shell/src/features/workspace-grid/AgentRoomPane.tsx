import { useEffect, useMemo, useState } from "react";
import { Pin, RefreshCcw } from "lucide-react";
import type { AgentRoom, AgentRoomMember, BridgeApprovalRecord } from "@/app/types";
import { Button } from "@/components/ui/button";
import {
  addAgentRoomMember,
  getAgentRoom,
  listAgentRoomObservations,
  listAgentRoomApprovals,
  listAgentRooms,
  openAgentRoomSession,
  setAgentRoomObservationPin,
  resolveAgentRoomApproval,
} from "@/services/agentRoomService";
import {
  selectObservedSessions,
  useAgentRoomObservationStore,
  type ObservedSessionView,
} from "./agentRoomObservationStore";
import { useWorkspaceGridStore } from "./gridStore";
import type { WorkspacePaneMountPolicy } from "./gridTypes";
import { AgentRoomAgentPanel } from "./AgentRoomAgentPanel";
import { AgentRoomMemberPanel, memberStatus } from "./AgentRoomMemberPanel";
import { AgentRoomRoomPanel } from "./AgentRoomRoomPanel";
import { AgentRoomTimelinePanel } from "./AgentRoomTimelinePanel";
import { AgentRoomComposer } from "./AgentRoomComposer";
import { AgentRoomApprovalPanel, type AgentRoomApprovalDecision } from "./AgentRoomApprovalPanel";
import { AgentRoomDiagnosticsPanel } from "./AgentRoomDiagnosticsPanel";
import { AgentRoomWorkflowPanel } from "./AgentRoomWorkflowPanel";
import { AgentRoomConnectorPanel } from "./AgentRoomConnectorPanel";

interface AgentRoomPaneProps {
  roomId?: string;
  active: boolean;
  mountPolicy: WorkspacePaneMountPolicy;
  onSelectRoom: (roomId: string) => void;
  onResume: () => void;
}

export function AgentRoomPane({
  roomId,
  active,
  mountPolicy,
  onSelectRoom,
  onResume,
}: AgentRoomPaneProps) {
  const [rooms, setRooms] = useState<AgentRoom[]>([]);
  const [room, setRoom] = useState<AgentRoom | null>(null);
  const [members, setMembers] = useState<AgentRoomMember[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "unavailable">(
    "loading",
  );
  const [actionError, setActionError] = useState("");
  const [view, setView] = useState<"observe" | "compose" | "workflow" | "rooms" | "agents" | "connectors" | "members" | "timeline" | "approvals" | "diagnostics">("observe");
  const [approvals, setApprovals] = useState<BridgeApprovalRecord[]>([]);
  const [approvalBusyIds, setApprovalBusyIds] = useState<Set<string>>(new Set());
  const [approvalError, setApprovalError] = useState("");
  const [agentSeed, setAgentSeed] = useState<ObservedSessionView>();
  const [managementRevision, setManagementRevision] = useState(0);
  const panes = useAgentRoomObservationStore((value) => value.panes);
  const observations = useAgentRoomObservationStore((value) => value.observations);
  const pinnedSessionIds = useAgentRoomObservationStore(
    (value) => value.pinnedSessionIds,
  );
  const recentEvents = useAgentRoomObservationStore((value) => value.recentEvents);
  const eventSeq = useAgentRoomObservationStore((value) => value.lastAppliedSeq);
  const capabilities = useAgentRoomObservationStore((value) => value.capabilities);
  const pump = useAgentRoomObservationStore((value) => value.pump);
  const observerRunning = useAgentRoomObservationStore(
    (value) => value.observerRunning,
  );
  const syncErrorCode = useAgentRoomObservationStore((value) => value.syncErrorCode);
  const showPane = useWorkspaceGridStore((value) => value.showPane);
  const sessions = useMemo(
    () =>
      selectObservedSessions({ panes, observations, pinnedSessionIds, recentEvents }),
    [observations, panes, pinnedSessionIds, recentEvents],
  );
  const suspended =
    mountPolicy === "suspended" ||
    mountPolicy === "manual" ||
    (mountPolicy === "on-focus" && !active);

  useEffect(() => {
    if (suspended) return;
    let cancelled = false;
    setState("loading");
    void Promise.all([
      listAgentRooms({ limit: 100 }),
      roomId ? getAgentRoom(roomId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([roomPage, detail]) => {
        if (cancelled) return;
        setRooms(roomPage.items);
        setRoom(detail?.room ?? null);
        setMembers(detail?.members ?? []);
        setState(roomId && !detail ? "missing" : "ready");
      })
      .catch(() => {
        if (!cancelled) {
          setRoom(null);
          setMembers([]);
          setState(roomId ? "missing" : "unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [managementRevision, roomId, suspended]);

  useEffect(() => {
    if (suspended) return;
    let cancelled = false;
    void listAgentRoomApprovals()
      .then((items) => { if (!cancelled) setApprovals(items); })
      .catch(() => { if (!cancelled) setApprovalError("Approval Inbox 暂时不可用。"); });
    return () => { cancelled = true; };
  }, [eventSeq, managementRevision, suspended]);

  if (suspended) {
    return (
      <AgentRoomEmpty
        title="Agent Room 已挂起"
        message="恢复窗格后再读取房间状态。"
        action="恢复窗格"
        onAction={onResume}
      />
    );
  }

  const health = pump?.state ?? (capabilities?.observer ? "idle" : "degraded");
  const degradation =
    syncErrorCode || capabilities?.degradations[0] || (!observerRunning ? "observer_stopped" : "");

  async function refreshObservationSnapshot() {
    const page = await listAgentRoomObservations();
    useAgentRoomObservationStore
      .getState()
      .setObservationSnapshot(page.items, page.pinnedSessionIds, page.observerRunning);
  }

  async function handlePin(session: ObservedSessionView) {
    setActionError("");
    try {
      await setAgentRoomObservationPin(session.sessionId, !session.pinned);
      await refreshObservationSnapshot();
    } catch (error) {
      setActionError(actionErrorMessage(error));
    }
  }

  async function handleAddMember(session: ObservedSessionView, followPaneId?: string) {
    if (!roomId || room?.archived) return;
    setActionError("");
    try {
      const member = await addAgentRoomMember(
        roomId,
        followPaneId
          ? {
              memberKind: "followed_pane",
              followedPaneId: followPaneId,
              displayName: `Pane ${followPaneId}`,
            }
          : {
              memberKind: "pinned_session",
              pinnedSessionId: session.sessionId,
              workspaceRoot: session.workDir,
              displayName: session.workDir
                ? directoryName(session.workDir)
                : `Session ${shortId(session.sessionId)}`,
            },
      );
      setMembers((current) => [...current, member]);
    } catch (error) {
      setActionError(actionErrorMessage(error));
    }
  }

  function handleSaveAgent(session: ObservedSessionView) {
    if (!session.workDir) {
      setActionError("缺少 Workspace，无法保存为 Agent。");
      return;
    }
    setActionError("");
    setAgentSeed(session);
    setView("agents");
  }

  function focusPane(paneId: string) {
    showPane(paneId);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-workspace-pane-id="${CSS.escape(paneId)}"]`)
        ?.focus();
    });
  }

  async function openSession(session: ObservedSessionView, disposition: "focus_existing" | "new_pane") {
    setActionError("");
    try {
      await openAgentRoomSession(session.sessionId, session.workDir, disposition);
    } catch (error) {
      setActionError(actionErrorMessage(error));
    }
  }

  async function handleResolveApproval(approval: BridgeApprovalRecord, decision: AgentRoomApprovalDecision) {
    if (approvalBusyIds.has(approval.approvalId)) return;
    setApprovalError("");
    setApprovalBusyIds((current) => new Set(current).add(approval.approvalId));
    try {
      await resolveAgentRoomApproval({
        approvalId: approval.approvalId,
        status: decision,
        resolutionPayloadJson: JSON.stringify({ decision, scope: "once" }),
      });
      setApprovals(await listAgentRoomApprovals());
    } catch (error) {
      setApprovalError(actionErrorMessage(error));
    } finally {
      setApprovalBusyIds((current) => {
        const next = new Set(current);
        next.delete(approval.approvalId);
        return next;
      });
    }
  }

  const pendingRoomApprovals = approvals.filter((item) => item.status === "pending" && item.chatId === roomId).length;

  return (
    <section className="agent-room-pane" aria-label="Agent Room">
      <div className="agent-room-pane-toolbar">
        <label>
          <span>房间</span>
          <select
            aria-label="选择 Agent Room"
            value={roomId ?? ""}
            onChange={(event) => event.target.value && onSelectRoom(event.target.value)}
          >
            <option value="">选择房间</option>
            {rooms.map((item) => (
              <option key={item.roomId} value={item.roomId}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="agent-room-toolbar-actions">
          <div className="agent-room-view-tabs" role="tablist" aria-label="Agent Room 视图">
            <button type="button" role="tab" aria-selected={view === "observe"} onClick={() => setView("observe")}>观察</button>
            <button type="button" role="tab" aria-selected={view === "compose"} onClick={() => setView("compose")}>发送</button>
            <button type="button" role="tab" aria-selected={view === "workflow"} onClick={() => setView("workflow")}>Workflow</button>
            <button type="button" role="tab" aria-selected={view === "rooms"} onClick={() => setView("rooms")}>房间</button>
            <button type="button" role="tab" aria-selected={view === "agents"} onClick={() => setView("agents")}>Agents</button>
            <button type="button" role="tab" aria-selected={view === "connectors"} onClick={() => setView("connectors")}>Connectors</button>
            <button type="button" role="tab" aria-selected={view === "members"} onClick={() => setView("members")}>成员</button>
            <button type="button" role="tab" aria-selected={view === "timeline"} onClick={() => setView("timeline")}>Timeline</button>
            <button type="button" role="tab" aria-selected={view === "approvals"} onClick={() => setView("approvals")}>审批{pendingRoomApprovals ? ` ${pendingRoomApprovals}` : ""}</button>
            <button type="button" role="tab" aria-selected={view === "diagnostics"} onClick={() => setView("diagnostics")}>诊断</button>
          </div>
          <span className={`agent-room-health is-${health}`}>{healthLabel(health)}</span>
        </div>
      </div>

      {view === "agents" ? (
        <AgentRoomAgentPanel sessions={sessions} seedSession={agentSeed} />
      ) : view === "connectors" ? (
        <AgentRoomConnectorPanel />
      ) : view === "workflow" ? (
        room ? <AgentRoomWorkflowPanel room={room} members={members} revision={managementRevision + eventSeq} /> : <AgentRoomEmpty title="尚未选择房间" message="选择房间后配置 Workflow。" />
      ) : view === "rooms" ? (
        <AgentRoomRoomPanel selectedRoomId={roomId} onSelectRoom={onSelectRoom} onChanged={() => setManagementRevision((value) => value + 1)} />
      ) : view === "members" ? (
        room ? <AgentRoomMemberPanel room={room} members={members} sessions={sessions} onMembersChange={setMembers} /> : <AgentRoomEmpty title="尚未选择房间" message="选择房间后管理成员与 Session 绑定。" />
      ) : view === "timeline" ? (
        roomId ? <AgentRoomTimelinePanel roomId={roomId} members={members} approvals={approvals} approvalBusyIds={approvalBusyIds} onResolveApproval={handleResolveApproval} /> : <AgentRoomEmpty title="尚未选择房间" message="选择房间后查看 Timeline。" />
      ) : view === "approvals" ? (
        <AgentRoomApprovalPanel approvals={approvals} busyIds={approvalBusyIds} error={approvalError} onResolve={handleResolveApproval} />
      ) : view === "diagnostics" ? (
        <AgentRoomDiagnosticsPanel capabilities={capabilities ?? undefined} pump={pump ?? undefined} observerRunning={observerRunning} syncErrorCode={syncErrorCode} />
      ) : view === "compose" ? (
        room ? <AgentRoomComposer room={room} members={members} onDispatched={() => setManagementRevision((value) => value + 1)} /> : <AgentRoomEmpty title="尚未选择房间" message="选择房间后分派任务。" />
      ) : !roomId ? (
        <AgentRoomEmpty title="尚未选择房间" message="从上方列表选择一个已有房间。" />
      ) : state === "loading" ? (
        <AgentRoomEmpty title="正在读取房间" message="正在连接本地 Agent Room 服务。" />
      ) : !room ? (
        <AgentRoomEmpty
          title={state === "missing" ? "房间不存在或不可访问" : "Agent Room 未启用"}
          message="选择其他房间；若列表为空，请在启用功能后重试。"
        />
      ) : (
        <div className="agent-room-pane-layout">
          <aside className="agent-room-member-rail" aria-label="房间成员">
            <strong>{room.title}</strong>
            <span>{members.length} 位成员</span>
            <ul>
              {members.map((member) => (
                <li key={member.memberId}>
                  <span>
                    <strong>{member.displayName}</strong>
                    <small>{memberStatus(member, sessions)}</small>
                  </span>
                  {member.effectiveSessionId ? (
                    <button
                      type="button"
                      onClick={() =>
                        void openAgentRoomSession(
                          member.effectiveSessionId!,
                          member.workspaceRoot,
                          "focus_existing",
                        ).catch((error) => setActionError(actionErrorMessage(error)))
                      }
                    >
                      打开 Session
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {members.length === 0 ? <p>成员将在加入房间后显示。</p> : null}
          </aside>
          <div className="agent-room-pane-main">
            <section aria-label="窗格会话">
              <div className="agent-room-section-heading">
                <h3>窗格会话</h3>
                <span aria-live="polite">{degradation ? `能力降级：${degradation}` : "观察运行中"}</span>
              </div>
              {sessions.length ? (
                <ul className="agent-room-session-list">
                  {sessions.map((session) => {
                    const member = members.find(
                      (item) => item.effectiveSessionId === session.sessionId,
                    );
                    return (
                      <SessionItem
                        key={session.sessionId}
                        session={session}
                        member={member}
                        onFocusPane={focusPane}
                        onOpen={(disposition) => void openSession(session, disposition)}
                        onPin={() => void handlePin(session)}
                        onJoin={() => void handleAddMember(session)}
                        onFollow={(paneId) => void handleAddMember(session, paneId)}
                        onSaveAgent={() => handleSaveAgent(session)}
                        canManageMembers={!room.archived}
                      />
                    );
                  })}
                </ul>
              ) : (
                <p>打开一个包含实际 Session 的 Code Pane 后会自动显示。</p>
              )}
              {actionError ? <p className="agent-room-action-error" role="alert">{actionError}</p> : null}
            </section>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionItem({
  session,
  member,
  onFocusPane,
  onOpen,
  onPin,
  onJoin,
  onFollow,
  onSaveAgent,
  canManageMembers,
}: {
  session: ObservedSessionView;
  member?: AgentRoomMember;
  onFocusPane: (paneId: string) => void;
  onOpen: (disposition: "focus_existing" | "new_pane") => void;
  onPin: () => void;
  onJoin: () => void;
  onFollow: (paneId: string) => void;
  onSaveAgent: () => void;
  canManageMembers: boolean;
}) {
  const observation = session.observation;
  const promptEvent = [...session.recentEvents]
    .reverse()
    .find((event) => event.kind.includes("prompt") && event.displayText);
  return (
    <li className="agent-room-session-item">
      <div>
        <strong title={session.sessionId}>Session {shortId(session.sessionId)}</strong>
        <span>{session.visible ? "当前可见" : session.paneIds.length ? "已收纳" : session.pinned ? "已固定" : "历史观察"}</span>
      </div>
      <dl>
        <div><dt>Workspace</dt><dd>{session.workDir ?? "未知"}</dd></div>
        <div><dt>状态</dt><dd>{statusLabel(observation?.sessionState ?? "unknown")}</dd></div>
        <div><dt>来源</dt><dd>{originLabel(observation?.controlOrigin)}</dd></div>
        <div><dt>审批</dt><dd>{observation?.pendingApprovals ?? 0}</dd></div>
      </dl>
      {observation?.controlOrigin === "pane_manual" ? (
        <p>{promptEvent?.displayText ?? "由 Pane 发起的任务（Prompt 未知）"}</p>
      ) : null}
      {observation?.lastReply ? <p className="agent-room-last-reply">{observation.lastReply}</p> : null}
      <div className="agent-room-session-actions">
        {session.paneIds.map((paneId) => (
          <button type="button" key={paneId} onClick={() => onFocusPane(paneId)}>
            聚焦 {paneId}
          </button>
        ))}
        {!session.paneIds.length ? <button type="button" onClick={() => onOpen("focus_existing")}>重新打开</button> : null}
        <button type="button" onClick={() => onOpen("new_pane")}>新窗格</button>
        <button type="button" onClick={onPin}><Pin size={12} aria-hidden />{session.pinned ? "取消固定" : "固定"}</button>
        {canManageMembers && !member ? <button type="button" onClick={onJoin}>加入房间</button> : null}
        {canManageMembers && !member && session.primaryPaneId ? <button type="button" onClick={() => onFollow(session.primaryPaneId!)}>跟随 Pane</button> : null}
        <button type="button" onClick={onSaveAgent} disabled={!session.workDir}>保存为 Agent</button>
      </div>
    </li>
  );
}

function AgentRoomEmpty({ title, message, action, onAction }: { title: string; message: string; action?: string; onAction?: () => void }) {
  return (
    <div className="agent-room-empty">
      <h3>{title}</h3><p>{message}</p>
      {action && onAction ? <Button type="button" icon={<RefreshCcw size={14} />} className="cc-action-btn" onClick={onAction}>{action}</Button> : null}
    </div>
  );
}

function shortId(value: string) { return value.length > 12 ? `${value.slice(0, 12)}…` : value; }
function directoryName(value: string) { return value.split(/[\\/]+/).filter(Boolean).pop() || value; }
function healthLabel(value: string) { return value === "ready" ? "观察运行中" : value === "connecting" ? "正在连接" : value === "idle" ? "等待事件" : "观察降级"; }
function statusLabel(value: string) { return ({ running: "运行中", idle: "空闲", completed: "已完成", failed: "错误", blocked: "阻塞", unknown: "未知" } as Record<string, string>)[value] ?? value; }
function originLabel(value?: string) { return ({ pane_manual: "Pane 手动", runtime_external: "Runtime 外部", room: "Agent Room" } as Record<string, string>)[value ?? ""] ?? value ?? "未知"; }
function actionErrorMessage(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "session_not_found") return "Session 不存在，无法重新打开。";
  if (code === "workspace_mismatch") return "Session 与 Workspace 不匹配。";
  if (code === "feature_disabled") return "Agent Room 功能未启用。";
  return "操作失败，请检查 Agent Room 与 Runtime 状态。";
}
