import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentRoomMember, AgentRoomTimeline, AgentRun, BridgeApprovalRecord } from "@/app/types";
import {
  abortAgentRoomRun,
  openAgentRoomSession,
  resolveAgentRoomApproval,
  retryAgentRoomRun,
} from "@/services/agentRoomService";
import { selectTaskViews, shortId, type AgentRoomRunView } from "./agentRoomSelectors";

export function AgentRoomTaskStream({
  timeline,
  members,
  approvals,
  stale = false,
  readOnly = false,
  onAddMember,
  onChanged,
}: {
  timeline: AgentRoomTimeline;
  members: AgentRoomMember[];
  approvals: BridgeApprovalRecord[];
  stale?: boolean;
  readOnly?: boolean;
  onAddMember?: () => void;
  onChanged: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [newActivity, setNewActivity] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [error, setError] = useState("");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const { tasks, orphanRuns } = useMemo(() => selectTaskViews(timeline, members, approvals), [approvals, members, timeline]);
  const visibleTasks = tasks.slice(-visibleCount);
  const activityKey = `${timeline.events[timeline.events.length - 1]?.seq ?? 0}:${timeline.runs.map((run) => run.updatedAt).join("|")}`;

  useEffect(() => {
    if (nearBottom) scrollToEnd();
    else setNewActivity(true);
  }, [activityKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function scrollToEnd() {
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
      setNewActivity(false);
    });
  }

  async function runAction(run: AgentRun, action: "open" | "open_new" | "abort" | "retry") {
    if (busyIds.has(run.runId)) return;
    setBusyIds((current) => new Set(current).add(run.runId));
    setError("");
    try {
      if (action === "open" && run.sessionId) await openAgentRoomSession(run.sessionId, run.workDir, "focus_existing");
      if (action === "open_new" && run.sessionId) await openAgentRoomSession(run.sessionId, run.workDir, "new_pane");
      if (action === "abort") await abortAgentRoomRun(run.runId);
      if (action === "retry") await retryAgentRoomRun(run.runId, { sessionMode: "same_session" });
      if (action !== "open" && action !== "open_new") onChanged();
    } catch (actionError) {
      setError(action === "open" || action === "open_new" ? sessionOpenError(actionError) : "Run 操作未完成；已保留当前状态，请刷新后确认。");
    } finally {
      setBusyIds((current) => { const next = new Set(current); next.delete(run.runId); return next; });
    }
  }

  async function resolve(approval: BridgeApprovalRecord, decision: "approved" | "rejected") {
    if (busyIds.has(approval.approvalId)) return;
    setBusyIds((current) => new Set(current).add(approval.approvalId));
    setError("");
    try {
      await resolveAgentRoomApproval({ approvalId: approval.approvalId, status: decision, resolutionPayloadJson: JSON.stringify({ decision, scope: "once" }) });
      onChanged();
    } catch {
      setError("审批未处理；它可能已由其他入口解决，请刷新状态。");
    } finally {
      setBusyIds((current) => { const next = new Set(current); next.delete(approval.approvalId); return next; });
    }
  }

  return (
    <section className="ar-task-stream" aria-label="任务动态">
      <header className="ar-stream-heading"><h1>任务动态</h1>{readOnly ? <span role="status">此房间已归档，只能查看历史</span> : stale ? <span role="status">刷新失败，当前投影可能不是最新</span> : null}</header>
      <div
        ref={scrollRef}
        className="ar-stream-scroll"
        aria-live="polite"
        onScroll={(event) => {
          const node = event.currentTarget;
          setNearBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 80);
        }}
      >
        {visibleCount < tasks.length ? <button type="button" className="ar-load-earlier" onClick={() => setVisibleCount((value) => value + 40)}>显示更早任务</button> : null}
        {!tasks.length && !orphanRuns.length ? <StreamEmpty members={members} readOnly={readOnly} onAddMember={onAddMember} /> : null}
        <ol className="ar-task-list">
          {visibleTasks.map((task) => (
            <li key={task.message.messageId} className="ar-task">
              <article className="ar-task-message">
                <header><strong>{task.message.senderKind === "user" ? "我" : task.message.senderKind}</strong><time>{formatTime(task.message.createdAt)}</time></header>
                {task.message.targetMemberIds?.length ? <div className="ar-task-targets">{task.message.targetMemberIds.map((id) => <span key={id}>@{members.find((member) => member.memberId === id)?.displayName ?? shortId(id)}</span>)}</div> : null}
                <p>{task.message.content}</p>
              </article>
              <div className="ar-run-list">
                {task.runs.map((view) => <RunRow key={view.run.runId} view={view} busyIds={busyIds} readOnly={readOnly} onAction={runAction} onResolve={resolve} />)}
                {!task.runs.length ? <p className="ar-run-empty">尚未创建 Run</p> : null}
              </div>
            </li>
          ))}
        </ol>
        {orphanRuns.length ? <section className="ar-orphan-runs"><h2>未关联任务</h2>{orphanRuns.map((view) => <RunRow key={view.run.runId} view={view} busyIds={busyIds} readOnly={readOnly} onAction={runAction} onResolve={resolve} />)}</section> : null}
        {error ? <p className="ar-error" role="alert">{error}</p> : null}
      </div>
      {newActivity ? <button type="button" className="ar-new-activity" onClick={scrollToEnd}>有新动态</button> : null}
    </section>
  );
}

function StreamEmpty({ members, readOnly, onAddMember }: { members: AgentRoomMember[]; readOnly: boolean; onAddMember?: () => void }) {
  if (readOnly) return <div className="ar-stream-empty"><strong>此房间已归档，只能查看历史</strong><p>恢复房间后才能添加成员或发送任务。</p></div>;
  if (!members.length) return <div className="ar-stream-empty"><strong>还没有执行成员</strong><p>添加主窗口中已打开的 Session。</p>{onAddMember ? <button type="button" className="ar-btn ar-btn-primary" onClick={onAddMember}>添加当前 Session</button> : null}</div>;
  if (!members.some((member) => member.effectiveSessionId)) return <div className="ar-stream-empty"><strong>执行成员尚未绑定可用 Session</strong><p>重新选择主窗口中的 Session。</p>{onAddMember ? <button type="button" className="ar-btn ar-btn-quiet" onClick={onAddMember}>修复绑定</button> : null}</div>;
  return <div className="ar-stream-empty"><strong>向执行成员发送第一个任务</strong><p>任务、运行状态和审批会显示在这里。</p></div>;
}

function RunRow({ view, busyIds, readOnly, onAction, onResolve }: {
  view: AgentRoomRunView;
  busyIds: Set<string>;
  readOnly: boolean;
  onAction: (run: AgentRun, action: "open" | "open_new" | "abort" | "retry") => Promise<void>;
  onResolve: (approval: BridgeApprovalRecord, decision: "approved" | "rejected") => Promise<void>;
}) {
  const { run } = view;
  return (
    <article className="ar-run-row">
      <header>
        <span className={`ar-status-dot is-${statusTone(run.status)}`} aria-hidden />
        <strong>{view.member?.displayName ?? "未知执行成员"}</strong>
        <span className="ar-run-status">{statusLabel(run.status)}</span>
        <time>{run.completedAt ? formatTime(run.completedAt) : durationLabel(run.startedAt)}</time>
      </header>
      {view.replyText ? <p className="ar-run-reply">{view.replyText}</p> : null}
      {view.approvals.map((approval) => (
        <div className="ar-inline-approval" key={approval.approvalId}>
          <div><span className="ar-status-dot is-waiting_approval" aria-hidden /><strong>{approval.requestKind || "请求执行工具"}</strong></div>
          {approval.prompt ? <code>{approval.prompt}</code> : null}
          {approval.status === "pending" ? <div><button type="button" className="ar-btn ar-btn-primary" disabled={readOnly || busyIds.has(approval.approvalId)} onClick={() => void onResolve(approval, "approved")}>允许一次</button><button type="button" className="ar-btn ar-btn-quiet" disabled={readOnly || busyIds.has(approval.approvalId)} onClick={() => void onResolve(approval, "rejected")}>拒绝</button></div> : <span>已处理：{approvalStatus(approval.status)}</span>}
        </div>
      ))}
      {run.errorMessage || run.errorCode ? <p className="ar-run-error">{run.errorCode ? `${run.errorCode}：` : ""}{run.errorMessage ?? "Run 失败"}</p> : null}
      {view.artifacts.map((event) => <p className="ar-run-artifact" key={event.eventId}>产物：{event.displayText || "Runtime 已提供产物引用"}</p>)}
      <details><summary>运行详情</summary><dl><div><dt>来源</dt><dd>{run.originKind}</dd></div><div><dt>队列</dt><dd>{run.queuePosition ? `第 ${run.queuePosition} 位` : "无"}</dd></div><div><dt>WorkDir</dt><dd>{run.workDir ?? "未知"}</dd></div></dl></details>
      <div className="ar-run-actions">
        {run.sessionId ? <><button type="button" disabled={busyIds.has(run.runId)} onClick={() => void onAction(run, "open")}>打开 Session</button><button type="button" disabled={busyIds.has(run.runId)} onClick={() => void onAction(run, "open_new")}>在新窗格打开</button></> : null}
        {canAbort(run.status) ? <button type="button" disabled={readOnly || busyIds.has(run.runId)} onClick={() => void onAction(run, "abort")}>{run.status === "queued" ? "取消排队" : "请求中止"}</button> : null}
        {canRetry(run.status) ? <button type="button" disabled={readOnly || busyIds.has(run.runId)} onClick={() => void onAction(run, "retry")}>同 Session 重试</button> : null}
      </div>
    </article>
  );
}

function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function durationLabel(start?: string) { if (!start) return ""; const ms = Date.now() - new Date(start).getTime(); return Number.isFinite(ms) && ms >= 0 ? `${Math.max(1, Math.floor(ms / 60_000))}m` : ""; }
function statusLabel(value: string) { return ({ queued: "排队", resolving_session: "正在连接 Session", waiting_for_lease: "等待执行权", submitting: "正在提交", running: "运行中", waiting_approval: "等待审批", abort_requested: "正在请求中止", completed: "已完成", failed: "错误", blocked: "阻塞", orphaned: "状态待恢复", aborted: "已中止" } as Record<string, string>)[value] ?? "未知状态"; }
function statusTone(value: string) { if (["failed", "blocked", "orphaned"].includes(value)) return "failed"; if (value === "waiting_approval") return "waiting_approval"; if (value === "queued") return "queued"; if (["running", "submitting", "resolving_session", "waiting_for_lease"].includes(value)) return "running"; return "idle"; }
function approvalStatus(value: string) { return ({ approved: "已允许", rejected: "已拒绝", stale_failed: "已失效" } as Record<string, string>)[value] ?? value; }
function canAbort(value: string) { return ["queued", "resolving_session", "waiting_for_lease", "submitting", "running", "waiting_approval", "abort_requested"].includes(value); }
function canRetry(value: string) { return ["failed", "aborted", "orphaned", "blocked"].includes(value); }
function sessionOpenError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code === "session_not_found") return "Session 已不存在；请重新绑定执行成员。";
  if (code === "workspace_mismatch") return "Session 与 Workspace 不匹配；请检查执行成员绑定。";
  if (code === "feature_disabled") return "Agent Room 未启用，无法打开 Session。";
  return "无法打开准确 Session；请确认 Session 仍存在且 Workspace 匹配。";
}
