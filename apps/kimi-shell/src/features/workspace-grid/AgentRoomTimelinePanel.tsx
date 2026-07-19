import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentRoomEvent, AgentRoomMember, AgentRoomTimeline, AgentRun, BridgeApprovalRecord } from "@/app/types";
import { abortAgentRoomRun, getAgentRoomTimeline, openAgentRoomSession, retryAgentRoomRun } from "@/services/agentRoomService";
import { AgentRoomApprovalCard, type AgentRoomApprovalDecision } from "./AgentRoomApprovalPanel";
import { useAgentRoomObservationStore } from "./agentRoomObservationStore";

export function AgentRoomTimelinePanel({ roomId, members, approvals = [], approvalBusyIds = new Set(), onResolveApproval }: { roomId: string; members: AgentRoomMember[]; approvals?: BridgeApprovalRecord[]; approvalBusyIds?: Set<string>; onResolveApproval?: (approval: BridgeApprovalRecord, decision: AgentRoomApprovalDecision) => void }) {
  const [timeline, setTimeline] = useState<AgentRoomTimeline>({ messages: [], runs: [], events: [] });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [actionError, setActionError] = useState("");
  const [actionRevision, setActionRevision] = useState(0);
  const [visibleCount, setVisibleCount] = useState(40);
  const [autoFollow, setAutoFollow] = useState(true);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const eventSeq = useAgentRoomObservationStore((value) => value.lastAppliedSeq);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void getAgentRoomTimeline(roomId, { limit: 100 })
      .then((value) => {
        if (!cancelled) {
          setTimeline(value);
          setState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => { cancelled = true; };
  }, [actionRevision, eventSeq, roomId]);

  const orderedMessages = useMemo(
    () => [...timeline.messages].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    [timeline.messages],
  );
  const orphanRuns = timeline.runs.filter((run) => !orderedMessages.some((message) => message.messageId === run.sourceMessageId));
  const visibleMessages = orderedMessages.slice(-visibleCount);

  useEffect(() => {
    if (autoFollow) timelineEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [autoFollow, eventSeq, timeline]);

  async function openRun(run: AgentRun) {
    if (!run.sessionId) return;
    setActionError("");
    try {
      await openAgentRoomSession(run.sessionId, run.workDir, "focus_existing");
    } catch {
      setActionError("无法打开这个 Run 的准确 Session。");
    }
  }

  async function actOnRun(run: AgentRun, action: "abort" | "retry") {
    setActionError("");
    try {
      if (action === "retry") await retryAgentRoomRun(run.runId, { sessionMode: "same_session" });
      else await abortAgentRoomRun(run.runId);
      setActionRevision((value) => value + 1);
    } catch (error) {
      setActionError(runActionError(error));
      setActionRevision((value) => value + 1);
    }
  }

  if (state === "loading" && !timeline.messages.length && !timeline.runs.length) return <p>正在读取 Room Timeline。</p>;
  if (state === "error" && !timeline.messages.length && !timeline.runs.length) return <p role="alert">Timeline 暂时不可用。</p>;

  return (
    <section className="agent-room-timeline" aria-label="Room Timeline" aria-live="polite">
      <div className="agent-room-section-heading"><h3>Timeline</h3><span>最近 100 条投影 · 有界渲染</span></div>
      <div className="agent-room-timeline-controls">
        {visibleCount < orderedMessages.length ? <button type="button" onClick={() => setVisibleCount((value) => value + 40)}>显示更早消息</button> : null}
        <label><input type="checkbox" checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} />自动跟随最新</label>
      </div>
      {!orderedMessages.length && !orphanRuns.length ? <p>还没有 Room Message 或 Run 投影。</p> : null}
      <ol>
        {visibleMessages.map((message) => (
          <li key={message.messageId} className="agent-room-timeline-message">
            <article>
              <header><strong>{message.senderKind === "user" ? "你" : message.senderKind}</strong><time>{formatTime(message.createdAt)}</time></header>
              <p>{message.content}</p>
            </article>
            {timeline.runs.filter((run) => run.sourceMessageId === message.messageId).map((run) => (
              <RunCard key={run.runId} run={run} member={members.find((member) => member.memberId === run.memberId)} events={timeline.events.filter((event) => event.runId === run.runId)} approvals={approvals} approvalBusyIds={approvalBusyIds} onResolveApproval={onResolveApproval} onOpen={() => void openRun(run)} onAction={(action) => void actOnRun(run, action)} />
            ))}
          </li>
        ))}
        {orphanRuns.map((run) => (
          <li key={run.runId}><RunCard run={run} member={members.find((member) => member.memberId === run.memberId)} events={timeline.events.filter((event) => event.runId === run.runId)} approvals={approvals} approvalBusyIds={approvalBusyIds} onResolveApproval={onResolveApproval} onOpen={() => void openRun(run)} onAction={(action) => void actOnRun(run, action)} /></li>
        ))}
      </ol>
      <div ref={timelineEndRef} aria-hidden="true" />
      {state === "error" ? <p role="status">最新刷新失败，保留上一次只读投影。</p> : null}
      {actionError ? <p className="agent-room-action-error" role="alert">{actionError}</p> : null}
    </section>
  );
}

function RunCard({ run, member, events, approvals: approvalRecords, approvalBusyIds, onResolveApproval, onOpen, onAction }: { run: AgentRun; member?: AgentRoomMember; events: AgentRoomEvent[]; approvals: BridgeApprovalRecord[]; approvalBusyIds: Set<string>; onResolveApproval?: (approval: BridgeApprovalRecord, decision: AgentRoomApprovalDecision) => void; onOpen: () => void; onAction: (action: "abort" | "retry") => void }) {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const reply = ordered.filter((event) => event.kind === "run.reply_delta").map((event) => event.textDelta ?? "").join("");
  const approvalEvents = ordered.filter((event) => event.approvalId || event.kind.includes("approval"));
  const artifacts = ordered.filter((event) => event.artifact != null);
  return (
    <article className="agent-room-run-card">
      <header><strong>{member?.displayName ?? "Agent Run"}</strong><span className={`is-${run.status}`}>{statusLabel(run.status)}</span></header>
      <dl>
        <div><dt>来源</dt><dd>{run.originKind === "pane_manual" ? "Pane 手动" : run.originKind}</dd></div>
        {run.queuePosition ? <div><dt>队列</dt><dd>第 {run.queuePosition} 位</dd></div> : null}
      </dl>
      {reply ? <p className="agent-room-last-reply">{reply}</p> : null}
      {approvalEvents.map((event) => {
        const approval = event.approvalId ? approvalRecords.find((item) => item.approvalId === event.approvalId) : undefined;
        return approval && onResolveApproval ? <AgentRoomApprovalCard key={event.eventId} approval={approval} compact busy={approvalBusyIds.has(approval.approvalId)} onResolve={onResolveApproval} /> : <p key={event.eventId}>审批：{event.status || "pending"}</p>;
      })}
      {artifacts.map((event) => <p key={event.eventId}>产物：{event.displayText || "Runtime 已提供产物引用"}</p>)}
      {run.errorCode || run.errorMessage ? <p className="agent-room-action-error">{run.errorCode ? `${run.errorCode}：` : ""}{run.errorMessage || "Run 失败"}</p> : null}
      <RunDiagnostics run={run} member={member} />
      <div className="agent-room-run-actions">
        {run.sessionId ? <button type="button" onClick={onOpen}>打开 Session</button> : null}
        {canAbort(run.status) ? <button type="button" onClick={() => onAction("abort")}>{run.status === "queued" ? "取消排队" : "请求中止"}</button> : null}
        {canRetry(run.status) ? <button type="button" onClick={() => onAction("retry")}>同 Session 重试</button> : null}
        {canRetry(run.status) ? <button type="button" disabled title="新 Session 重试尚无已验证的精确创建恢复契约">新 Session 重试</button> : null}
      </div>
    </article>
  );
}

function RunDiagnostics({ run, member }: { run: AgentRun; member?: AgentRoomMember }) {
  const assembly = recordValue(run.promptAssembly);
  const controls = recordValue(run.controls);
  const sharedRunIds = Array.isArray(assembly.sharedRunIds) ? assembly.sharedRunIds.filter((value): value is string => typeof value === "string") : [];
  const safeControls = ["model", "thinking", "permissionMode", "planMode", "swarmMode", "goalObjective", "goalControl"]
    .flatMap((key) => key in controls ? [[key, String(controls[key])]] : []);
  return (
    <details className="agent-room-run-diagnostics">
      <summary>Prompt Assembly 详情</summary>
      <dl>
        <div><dt>Role 注入</dt><dd>{assembly.rolePrompt === true ? "是" : "否"}</dd></div>
        <div><dt>Shared Brief</dt><dd>{assembly.sharedBrief === true ? "已注入" : "未注入"}</dd></div>
        <div><dt>Shared Run refs</dt><dd>{sharedRunIds.length ? sharedRunIds.join("、") : "无"}</dd></div>
        <div><dt>Controls</dt><dd>{safeControls.length ? safeControls.map(([key, value]) => `${key}=${value}`).join("；") : "默认"}</dd></div>
        <div><dt>Session Policy</dt><dd>{member?.sessionPolicy ?? "未知"}</dd></div>
        <div><dt>WorkDir</dt><dd>{run.workDir || member?.workspaceRoot || "未知"}</dd></div>
      </dl>
      <p>诊断仅显示白名单控制字段，不显示 token 或完整 Prompt。</p>
    </details>
  );
}

function statusLabel(value: string) {
  return ({ queued: "排队", running: "运行中", completed: "已完成", failed: "错误", blocked: "阻塞", aborted: "已中止" } as Record<string, string>)[value] ?? value;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function canAbort(status: string) { return ["queued", "resolving_session", "waiting_for_lease", "submitting", "running", "waiting_approval", "abort_requested"].includes(status); }
function canRetry(status: string) { return ["failed", "aborted", "orphaned", "blocked"].includes(status); }
function recordValue(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function runActionError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "abort_unconfirmed") return "Runtime 尚未确认中止；未提交替代 Run。";
  if (code === "session_mode_unsupported") return "当前只能在同一 Session 重试。";
  if (code === "session_busy") return "Session 正忙，Run 已保持在 FIFO Queue。";
  return "Run 操作失败，请刷新后重试。";
}
