import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { AgentRoomMember, PaneSessionObservation, SessionObservation } from "@/app/types";
import { shortId } from "./agentRoomSelectors";

export interface SessionCandidate {
  sessionId: string;
  workDir?: string;
  observation?: SessionObservation;
  pane?: PaneSessionObservation;
  group: "current" | "visible" | "stored";
}

export function AgentRoomAddMemberDialog({
  members,
  panes,
  observations,
  busy,
  onClose,
  onAddPinned,
  onAddFollowedPane,
}: {
  members: AgentRoomMember[];
  panes: PaneSessionObservation[];
  observations: SessionObservation[];
  busy: boolean;
  onClose: () => void;
  onAddPinned: (candidate: SessionCandidate) => Promise<void>;
  onAddFollowedPane: (candidate: SessionCandidate) => Promise<void>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const candidates = useMemo(() => buildCandidates(panes, observations), [observations, panes]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest<HTMLElement>("[role='dialog']");
      const focusable = [...(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeys);
    return () => { document.removeEventListener("keydown", handleKeys); returnFocusRef.current?.focus(); };
  }, [onClose]);

  async function add(candidate: SessionCandidate, follow: boolean) {
    setError("");
    try {
      await (follow ? onAddFollowedPane(candidate) : onAddPinned(candidate));
    } catch {
      setError("未添加执行成员；请检查 Session 与 Workspace 是否仍然有效。");
    }
  }

  return (
    <div className="ar-dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="ar-dialog" role="dialog" aria-modal="true" aria-labelledby="ar-add-member-title">
        <header><h2 id="ar-add-member-title">添加执行成员</h2><button ref={closeRef} type="button" className="ar-icon-btn" aria-label="关闭添加执行成员" onClick={onClose}><X size={14} /></button></header>
        <div className="ar-dialog-body">
          {(["current", "visible", "stored"] as const).map((group) => {
            const items = candidates.filter((candidate) => candidate.group === group);
            if (!items.length) return null;
            return (
              <section key={group} className="ar-candidate-group">
                <h3>{groupLabel(group)}</h3>
                <ul>{items.map((candidate) => {
                  const alreadyPinned = members.some((member) => member.effectiveSessionId === candidate.sessionId || member.pinnedSessionId === candidate.sessionId);
                  const alreadyFollowing = Boolean(candidate.pane && members.some((member) => member.followedPaneId === candidate.pane?.paneId));
                  return (
                    <li key={`${group}-${candidate.pane?.paneId ?? candidate.sessionId}`}>
                      <span className={`ar-status-dot is-${candidate.observation?.sessionState === "running" ? "running" : "idle"}`} aria-hidden />
                      <span className="ar-candidate-copy"><strong>{workspaceName(candidate.workDir)}</strong><small>Session {shortId(candidate.sessionId)}{candidate.pane ? ` · ${candidate.pane.visible ? "可见" : "已收纳"}` : " · 已固定观察"}</small></span>
                      <div>
                        <button type="button" className="ar-btn ar-btn-quiet" disabled={busy || alreadyPinned} onClick={() => void add(candidate, false)}>{alreadyPinned ? "已在房间中" : "添加固定会话"}</button>
                        {candidate.pane ? <button type="button" className="ar-btn ar-btn-quiet" disabled={busy || alreadyFollowing || alreadyPinned} onClick={() => void add(candidate, true)}>{alreadyFollowing ? "已跟随" : "添加并跟随窗格"}</button> : null}
                      </div>
                    </li>
                  );
                })}</ul>
              </section>
            );
          })}
          {!candidates.length ? <div className="ar-dialog-empty"><strong>没有可用 Session</strong><p>请先在主窗口的 Code Pane 中进入一个 Session。</p></div> : null}
          {error ? <p className="ar-error" role="alert">{error}</p> : null}
        </div>
      </section>
    </div>
  );
}

export function buildCandidates(panes: PaneSessionObservation[], observations: SessionObservation[]): SessionCandidate[] {
  const observationById = new Map(observations.map((item) => [item.sessionId, item]));
  const paneCandidates = panes.flatMap((pane) => {
    const sessionId = pane.effectiveSessionId?.trim();
    if (!sessionId) return [];
    return [{
      sessionId,
      workDir: pane.workDir || observationById.get(sessionId)?.workDir,
      observation: observationById.get(sessionId),
      pane,
      group: pane.active ? "current" as const : pane.visible ? "visible" as const : "stored" as const,
    }];
  });
  const paneSessionIds = new Set(paneCandidates.map((candidate) => candidate.sessionId));
  return [
    ...paneCandidates.sort((a, b) => Number(b.pane?.active) - Number(a.pane?.active) || (a.pane?.paneId ?? "").localeCompare(b.pane?.paneId ?? "")),
    ...observations.filter((item) => !paneSessionIds.has(item.sessionId)).map((item) => ({ sessionId: item.sessionId, workDir: item.workDir, observation: item, group: "stored" as const })),
  ];
}

function groupLabel(group: SessionCandidate["group"]) {
  return ({ current: "当前活动 Session", visible: "当前可见 Code Pane", stored: "已收纳或已固定观察" } as const)[group];
}

function workspaceName(workDir?: string) {
  return workDir?.split(/[\\/]+/).filter(Boolean).pop() || "未知 Workspace";
}
