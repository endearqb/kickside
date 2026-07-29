import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AgentRoom,
  AgentRoomCapabilities,
  AgentRoomMember,
  AgentRoomPumpStatus,
  AgentRoomTimeline,
  BridgeApprovalRecord,
  PaneSessionObservation,
  SessionObservation,
} from "@/app/types";
import { getInitialThemeMode } from "@/app/theme";
import {
  addAgentRoomMember,
  createAgentRoom,
  getAgentRoom,
  getAgentRoomCapabilities,
  getAgentRoomTimeline,
  listAgentRoomApprovals,
  listAgentRoomObservations,
  listAgentRooms,
  openAgentRoomSession,
  subscribeAgentRoomEvents,
} from "@/services/agentRoomService";
import { AgentRoomAddMemberDialog, type SessionCandidate } from "./AgentRoomAddMemberDialog";
import { AgentRoomCompactComposer } from "./AgentRoomCompactComposer";
import { AgentRoomExecutionMemberRail } from "./AgentRoomExecutionMemberRail";
import { AgentRoomTaskStream } from "./AgentRoomTaskStream";
import { AgentRoomWindowTitlebar } from "./AgentRoomWindowTitlebar";
import { selectExecutionMembers, type ExecutionMemberView } from "./agentRoomSelectors";
import "./agent-room-window.css";

const EMPTY_TIMELINE: AgentRoomTimeline = { messages: [], runs: [], events: [] };

export function AgentRoomWindowApp() {
  const theme = useMemo(() => getInitialThemeMode(), []);
  const [rooms, setRooms] = useState<AgentRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string>();
  const [room, setRoom] = useState<AgentRoom>();
  const [members, setMembers] = useState<AgentRoomMember[]>([]);
  const [timeline, setTimeline] = useState<AgentRoomTimeline>(EMPTY_TIMELINE);
  const [approvals, setApprovals] = useState<BridgeApprovalRecord[]>([]);
  const [observations, setObservations] = useState<SessionObservation[]>([]);
  const [panes, setPanes] = useState<PaneSessionObservation[]>([]);
  const [capabilities, setCapabilities] = useState<AgentRoomCapabilities>();
  const [pump, setPump] = useState<AgentRoomPumpStatus>();
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const selectedRoomIdRef = useRef(selectedRoomId);
  const lastAppliedSeq = useRef(0);
  const eventGeneration = useRef(0);
  const refreshTimer = useRef<number | undefined>(undefined);
  selectedRoomIdRef.current = selectedRoomId;

  const loadRoom = useCallback(async (roomId: string) => {
    const [detail, nextTimeline, nextApprovals] = await Promise.all([
      getAgentRoom(roomId),
      getAgentRoomTimeline(roomId, { limit: 100 }),
      listAgentRoomApprovals(),
    ]);
    setRoom(detail.room);
    setMembers(detail.members);
    setTimeline(nextTimeline);
    setApprovals(nextApprovals.filter((approval) => approval.chatId === roomId));
    setSelectedMemberIds((current) => current.filter((id) => detail.members.some((member) => member.memberId === id)));
  }, []);

  const refreshSnapshots = useCallback(async (preferredRoomId?: string) => {
    setStale(false);
    try {
      const [active, archived, observationPage, nextCapabilities] = await Promise.all([
        listAgentRooms({ archived: false, limit: 100 }),
        listAgentRooms({ archived: true, limit: 100 }),
        listAgentRoomObservations(),
        getAgentRoomCapabilities(),
      ]);
      const nextRooms = dedupeRooms([...active.items, ...archived.items]);
      setRooms(nextRooms);
      setObservations(observationPage.items);
      setPanes(observationPage.panes);
      setCapabilities(nextCapabilities);
      const requested = preferredRoomId ?? selectedRoomIdRef.current;
      if (requested && !nextRooms.some((item) => item.roomId === requested)) {
        setSelectedRoomId(undefined);
        setRoom(undefined);
        setMembers([]);
        setTimeline(EMPTY_TIMELINE);
        setApprovals([]);
        setError("原房间已删除或不可访问；请选择其他房间。");
        return;
      }
      const nextRoomId = requested ?? [...nextRooms].filter((item) => !item.archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.roomId;
      setSelectedRoomId(nextRoomId);
      if (nextRoomId) await loadRoom(nextRoomId);
      else { setRoom(undefined); setMembers([]); setTimeline(EMPTY_TIMELINE); setApprovals([]); }
      setError("");
    } catch (loadError) {
      setStale(true);
      setError(commandErrorCode(loadError) === "feature_disabled" ? "Agent Room 未启用。" : "无法刷新 Agent Room；已保留上一次可用投影。");
    } finally {
      setLoading(false);
    }
  }, [loadRoom]);

  useEffect(() => { void refreshSnapshots(); }, [refreshSnapshots]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void subscribeAgentRoomEvents(
      (payload) => {
        if (disposed) return;
        if (payload.generation !== eventGeneration.current) {
          eventGeneration.current = payload.generation;
          lastAppliedSeq.current = 0;
        }
        const fresh = payload.items.filter((event) => event.seq > lastAppliedSeq.current);
        if (!fresh.length) return;
        lastAppliedSeq.current = Math.max(lastAppliedSeq.current, ...fresh.map((event) => event.seq));
        if (refreshTimer.current === undefined) refreshTimer.current = window.setTimeout(() => { refreshTimer.current = undefined; void refreshSnapshots(); }, 150);
      },
      (status) => {
        if (disposed) return;
        setPump(status);
        if (status.state === "degraded") setError("本地观察服务暂不可用；已保留上次投影，请从标题栏重试连接。");
        if (status.state === "resync_required") {
          eventGeneration.current = status.generation;
          lastAppliedSeq.current = 0;
          setError("状态已过期，正在重新同步。");
          void refreshSnapshots();
        }
      },
    ).then((cleanup) => { if (disposed) cleanup(); else unsubscribe = cleanup; }).catch(() => setStale(true));
    const onFocus = () => void refreshSnapshots();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      unsubscribe?.();
      window.removeEventListener("focus", onFocus);
      if (refreshTimer.current !== undefined) window.clearTimeout(refreshTimer.current);
    };
  }, [refreshSnapshots]);

  const observationMap = useMemo(() => Object.fromEntries(observations.map((item) => [item.sessionId, item])), [observations]);
  const memberViews = useMemo(() => selectExecutionMembers(members, timeline, approvals, observationMap), [approvals, members, observationMap, timeline]);
  const closeAddMember = useCallback(() => setAddMemberOpen(false), []);
  const health = !capabilities?.core ? "disabled" : pump?.state === "degraded" || pump?.state === "resync_required" || capabilities.degradations.length ? "degraded" : pump?.state === "connecting" || !pump ? "connecting" : "healthy";

  async function selectRoom(roomId: string) {
    setSelectedRoomId(roomId);
    setLoading(true);
    try { await loadRoom(roomId); setError(""); } catch { setError("无法打开这个房间；请选择其他房间。"); } finally { setLoading(false); }
  }

  async function createRoom(title: string) {
    setBusy(true);
    try {
      const created = await createAgentRoom({ title, description: "", sharedBrief: "", orchestrationMode: "direct" });
      await refreshSnapshots(created.roomId);
    } catch (createError) {
      setError("未创建房间；请检查本地 Agent Room 服务后重试。");
      throw createError;
    } finally { setBusy(false); }
  }

  async function addPinned(candidate: SessionCandidate) {
    if (!room || room.archived) return;
    setBusy(true);
    try {
      await addAgentRoomMember(room.roomId, { memberKind: "pinned_session", pinnedSessionId: candidate.sessionId, workspaceRoot: candidate.workDir, displayName: workspaceName(candidate.workDir, candidate.sessionId) });
      await loadRoom(room.roomId);
    } finally { setBusy(false); }
  }

  async function addFollowed(candidate: SessionCandidate) {
    if (!room || room.archived || !candidate.pane) return;
    setBusy(true);
    try {
      await addAgentRoomMember(room.roomId, { memberKind: "followed_pane", followedPaneId: candidate.pane.paneId, displayName: workspaceName(candidate.workDir, candidate.sessionId) });
      await loadRoom(room.roomId);
    } finally { setBusy(false); }
  }

  async function openMemberSession(view: ExecutionMemberView) {
    const sessionId = view.member.effectiveSessionId;
    if (!sessionId) return;
    try { await openAgentRoomSession(sessionId, view.member.workspaceRoot, "focus_existing"); }
    catch (openError) { setError(sessionOpenError(openError)); }
  }

  async function toggleAlwaysOnTop() {
    const next = !alwaysOnTop;
    try { await getCurrentWindow().setAlwaysOnTop(next); setAlwaysOnTop(next); }
    catch { setError("无法更改窗口置顶状态。"); }
  }

  return (
    <main className={`agent-room-window theme-${theme}`}>
      <AgentRoomWindowTitlebar rooms={rooms} selectedRoomId={selectedRoomId} health={health} alwaysOnTop={alwaysOnTop} busy={busy} onSelectRoom={(id) => void selectRoom(id)} onCreateRoom={createRoom} onRetry={() => void refreshSnapshots()} onToggleAlwaysOnTop={() => void toggleAlwaysOnTop()} onWindowError={setError} />
      <div className="ar-window-body">
        {room ? <AgentRoomExecutionMemberRail members={memberViews} selectedMemberIds={selectedMemberIds} archived={room.archived} onToggleTarget={(id) => setSelectedMemberIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])} onOpenSession={(view) => void openMemberSession(view)} onAdd={() => setAddMemberOpen(true)} /> : <aside className="ar-member-rail" aria-hidden />}
        <div className="ar-main">
          {loading && !room ? <div className="ar-main-state" role="status">正在连接本地服务…</div> : room ? (
            <>
              <AgentRoomTaskStream timeline={timeline} members={members} approvals={approvals} stale={stale} readOnly={room.archived} onAddMember={() => setAddMemberOpen(true)} onChanged={() => void loadRoom(room.roomId)} />
              <AgentRoomCompactComposer room={room} members={members} selectedMemberIds={selectedMemberIds} onTargetsChange={setSelectedMemberIds} onDispatched={() => void loadRoom(room.roomId)} />
            </>
          ) : <EmptyRoomState busy={busy} onCreate={createRoom} />}
        </div>
      </div>
      {error ? <div className="ar-window-error" role="alert">{error}</div> : null}
      {addMemberOpen && room ? <AgentRoomAddMemberDialog members={members} panes={panes} observations={observations} busy={busy} onClose={closeAddMember} onAddPinned={addPinned} onAddFollowedPane={addFollowed} /> : null}
    </main>
  );
}

function EmptyRoomState({ busy, onCreate }: { busy: boolean; onCreate: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState("");
  return <form className="ar-main-state" onSubmit={(event) => { event.preventDefault(); if (title.trim()) void onCreate(title.trim()).catch(() => undefined); }}><strong>创建第一个房间</strong><p>只需一个名称，稍后再添加执行成员。</p><input aria-label="房间名称" maxLength={128} value={title} onChange={(event) => setTitle(event.target.value)} /><button type="submit" className="ar-btn ar-btn-primary" disabled={busy || !title.trim()}>创建房间</button></form>;
}

function dedupeRooms(rooms: AgentRoom[]) { return [...new Map(rooms.map((room) => [room.roomId, room])).values()]; }
function workspaceName(workDir: string | undefined, sessionId: string) { return workDir?.split(/[\\/]+/).filter(Boolean).pop() || `Session ${sessionId.slice(0, 8)}`; }
function commandErrorCode(error: unknown) { return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : ""; }
function sessionOpenError(error: unknown) {
  const code = commandErrorCode(error);
  if (code === "session_not_found") return "Session 已不存在；请重新绑定执行成员。";
  if (code === "workspace_mismatch") return "Session 与 Workspace 不匹配；请检查执行成员绑定。";
  if (code === "feature_disabled") return "Agent Room 未启用，无法打开 Session。";
  return "无法打开准确 Session；请修复执行成员绑定。";
}
