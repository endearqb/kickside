import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { MoreHorizontal, Send, X } from "lucide-react";
import type { AgentRoom, AgentRoomMember } from "@/app/types";
import { postAgentRoomMessage, type AgentRoomDispatchResult } from "@/services/agentRoomService";

export function AgentRoomCompactComposer({
  room,
  members,
  selectedMemberIds,
  onTargetsChange,
  onDispatched,
}: {
  room: AgentRoom;
  members: AgentRoomMember[];
  selectedMemberIds: string[];
  onTargetsChange: (ids: string[]) => void;
  onDispatched: (result: AgentRoomDispatchResult) => void;
}) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState(room.orchestrationMode === "parallel" ? "parallel" : "direct");
  const [moreOpen, setMoreOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "failed">("idle");
  const [notice, setNotice] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mention = content.match(/(?:^|\s)@([^\s@]*)$/)?.[1].toLocaleLowerCase();
  const suggestions = useMemo(() => mention === undefined ? [] : members.filter((member) => member.displayName.toLocaleLowerCase().includes(mention)), [members, mention]);
  const mentionOpen = mention !== undefined && !mentionDismissed;
  const validTargets = members.filter((member) => selectedMemberIds.includes(member.memberId) && member.effectiveSessionId);
  const disabledReason = room.archived
    ? "已归档房间只能查看历史"
    : !content.trim()
      ? "输入任务后发送"
      : !validTargets.length
        ? "至少选择一个已绑定 Session 的执行成员"
        : state === "sending" ? "正在发送" : "";

  useEffect(() => { setMentionIndex(0); }, [mention]);

  function toggleTarget(memberId: string) {
    onTargetsChange(selectedMemberIds.includes(memberId) ? selectedMemberIds.filter((id) => id !== memberId) : [...selectedMemberIds, memberId]);
  }

  function completeMention(member?: AgentRoomMember) {
    const ids = member ? [member.memberId] : members.filter((item) => item.effectiveSessionId).map((item) => item.memberId);
    onTargetsChange([...new Set([...selectedMemberIds, ...ids])]);
    setContent((value) => value.replace(/@[^\s@]*$/, member ? `@${member.displayName} ` : "@all "));
    inputRef.current?.focus();
  }

  async function send() {
    if (disabledReason) return;
    setState("sending");
    setNotice("");
    try {
      const result = await postAgentRoomMessage(room.roomId, {
        content: content.trim(),
        targetMemberIds: validTargets.map((member) => member.memberId),
        mode,
        queuePolicy: "enqueue",
      });
      setContent("");
      setState("idle");
      const failures = Array.isArray(result.failures) ? result.failures : [];
      const failureSummary = failures.map((failure) => {
        const member = members.find((item) => item.memberId === failure.memberId);
        return `${member?.displayName ?? failure.memberId}：${failure.message || failure.code}`;
      }).join("；");
      setNotice(failures.length ? `已创建 ${result.runs.length} 个 Run；未创建：${failureSummary}` : "已发送任务。");
      onDispatched(result);
    } catch {
      setState("failed");
      setNotice("未确认任务已创建；输入已保留，请检查连接后重试。");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
      return;
    }
    if (!mentionOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setMentionDismissed(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = suggestions.length + 1;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setMentionIndex((value) => (value + delta + count) % count);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      completeMention(mentionIndex === 0 ? undefined : suggestions[mentionIndex - 1]);
    }
  }

  return (
    <section className="ar-composer" aria-label="派发任务" onKeyDown={(event) => { if (event.key === "Escape" && moreOpen) { event.preventDefault(); setMoreOpen(false); inputRef.current?.focus(); } }}>
      <div className="ar-composer-targets" aria-label="目标执行成员">
        {selectedMemberIds.map((id) => {
          const member = members.find((item) => item.memberId === id);
          return member ? <button type="button" key={id} className="ar-target-chip" onClick={() => toggleTarget(id)}>@{member.displayName}<X size={11} aria-hidden /></button> : null;
        })}
        <button type="button" className="ar-target-chip is-add" disabled={room.archived} onClick={() => onTargetsChange(members.filter((member) => member.effectiveSessionId).map((member) => member.memberId))}>@all</button>
      </div>
      <textarea
        ref={inputRef}
        aria-label="任务内容"
        value={content}
        disabled={room.archived || state === "sending"}
        placeholder="输入任务，@ 选择执行成员…"
        aria-expanded={mentionOpen}
        aria-controls={mentionOpen ? "ar-mention-menu" : undefined}
        aria-activedescendant={mentionOpen ? `ar-mention-${mentionIndex}` : undefined}
        rows={2}
        onChange={(event) => { setContent(event.target.value); setMentionDismissed(false); setState("idle"); setNotice(""); }}
        onKeyDown={handleKeyDown}
      />
      {mentionOpen ? <div id="ar-mention-menu" className="ar-mention-menu" role="listbox" aria-label="执行成员建议"><button id="ar-mention-0" type="button" role="option" aria-selected={mentionIndex === 0} onMouseEnter={() => setMentionIndex(0)} onClick={() => completeMention()}>@all</button>{suggestions.map((member, index) => <button id={`ar-mention-${index + 1}`} type="button" role="option" aria-selected={mentionIndex === index + 1} key={member.memberId} onMouseEnter={() => setMentionIndex(index + 1)} onClick={() => completeMention(member)}>@{member.displayName}</button>)}</div> : null}
      {moreOpen ? <div className="ar-composer-more"><label>编排方式<select value={mode} onChange={(event) => setMode(event.target.value)}><option value="direct">直接</option><option value="parallel">并行</option></select></label><span>忙碌时：FIFO 排队</span></div> : null}
      <footer>
        <button type="button" className="ar-icon-btn" aria-label="更多发送选项" aria-expanded={moreOpen} onClick={() => setMoreOpen((value) => !value)}><MoreHorizontal size={15} /></button>
        <span className={state === "failed" ? "ar-error" : ""} role={state === "failed" ? "alert" : "status"} title={notice || disabledReason || undefined}>{notice || disabledReason || "Ctrl + Enter 发送"}</span>
        <button type="button" className="ar-btn ar-btn-primary" disabled={Boolean(disabledReason)} onClick={() => void send()}><Send size={14} />{state === "sending" ? "发送中" : "发送"}</button>
      </footer>
    </section>
  );
}
