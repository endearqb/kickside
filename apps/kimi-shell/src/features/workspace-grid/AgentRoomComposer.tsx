import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentRoom, AgentRoomMember, AgentRun } from "@/app/types";
import {
  getAgentRoomTimeline,
  postAgentRoomMessage,
  type AgentRoomDispatchResult,
} from "@/services/agentRoomService";

export function AgentRoomComposer({
  room,
  members,
  onDispatched,
}: {
  room: AgentRoom;
  members: AgentRoomMember[];
  onDispatched?: (result: AgentRoomDispatchResult) => void;
}) {
  const [content, setContent] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [mode, setMode] = useState(room.orchestrationMode === "parallel" ? "parallel" : "direct");
  const [queuePolicy, setQueuePolicy] = useState("enqueue");
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>([]);
  const [availableRuns, setAvailableRuns] = useState<AgentRun[]>([]);
  const [sharedRunIds, setSharedRunIds] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const [dispatchNotice, setDispatchNotice] = useState<"queued" | "abort_unconfirmed" | "">("");
  const mention = content.match(/(?:^|\s)@([^\s@]*)$/)?.[1].toLocaleLowerCase();
  const suggestions = useMemo(
    () =>
      mention === undefined
        ? []
        : members.filter((member) => member.displayName.toLocaleLowerCase().includes(mention)),
    [members, mention],
  );
  const selectedMembers = members.filter((member) => targets.includes(member.memberId));
  const canSend = !room.archived && state !== "sending" && content.trim() !== "" && targets.length > 0;

  useEffect(() => {
    let cancelled = false;
    void getAgentRoomTimeline(room.roomId, { limit: 100 })
      .then((timeline) => {
        if (!cancelled) {
          setAvailableRuns(timeline.runs.filter((run) =>
            run.status === "completed" && timeline.events.some((event) => event.runId === run.runId && event.kind === "run.reply_delta" && event.textDelta),
          ));
        }
      })
      .catch(() => {
        if (!cancelled) setAvailableRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [room.roomId]);

  function toggleTarget(memberId: string) {
    setTargets((current) =>
      current.includes(memberId)
        ? current.filter((value) => value !== memberId)
        : [...current, memberId],
    );
  }

  function completeMention(member?: AgentRoomMember) {
    const next = member ? [member.memberId] : members.map((item) => item.memberId);
    setTargets((current) => [...new Set([...current, ...next])]);
    setContent((current) => current.replace(/@[^\s@]*$/, member ? `@${member.displayName} ` : "@all "));
  }

  async function send() {
    if (!canSend) return;
    setState("sending");
    try {
      const result = await postAgentRoomMessage(room.roomId, {
        content: content.trim(),
        targetMemberIds: targets,
        mode,
        queuePolicy,
        attachments: attachmentPaths.map((localPath) => ({
          kind: "file",
          fileName: fileName(localPath),
          localPath,
        })),
        sharedRunIds,
      });
      setContent("");
      setAttachmentPaths([]);
      setSharedRunIds([]);
      setState("sent");
      setDispatchNotice(
        result.runs.some((run) => run.errorCode === "abort_unconfirmed")
          ? "abort_unconfirmed"
          : result.runs.some((run) => run.status === "queued" && run.queuePosition)
            ? "queued"
            : "",
      );
      onDispatched?.(result);
    } catch {
      setState("failed");
    }
  }

  async function addAttachments() {
    try {
      const selected = await open({ multiple: true, directory: false });
      const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
      setAttachmentPaths((current) => [...new Set([...current, ...paths])].slice(0, 16));
    } catch {
      setState("failed");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void send();
    }
  }

  return (
    <section className="agent-room-composer" aria-label="分派任务">
      <header>
        <div>
          <h3>分派任务</h3>
          <p>目标会在发送前解析到各自明确的 Workspace 与 Session。</p>
        </div>
        {room.archived ? <span className="agent-room-risk">已归档，只读</span> : null}
      </header>

      <fieldset disabled={room.archived || state === "sending"}>
        <legend>目标成员</legend>
        <div className="agent-room-targets">
          <label>
            <input
              type="checkbox"
              checked={members.length > 0 && targets.length === members.length}
              onChange={() => setTargets(targets.length === members.length ? [] : members.map((item) => item.memberId))}
            />
            @all
          </label>
          {members.map((member) => (
            <label key={member.memberId}>
              <input
                type="checkbox"
                checked={targets.includes(member.memberId)}
                onChange={() => toggleTarget(member.memberId)}
              />
              {member.displayName}
            </label>
          ))}
        </div>
      </fieldset>

      <label>
        <span>任务</span>
        <textarea
          aria-label="任务内容"
          value={content}
          disabled={room.archived || state === "sending"}
          placeholder="输入任务；使用 @ 搜索并选择成员"
          onChange={(event) => {
            setContent(event.target.value);
            setState("idle");
          }}
          onKeyDown={handleKeyDown}
        />
      </label>
      {mention !== undefined ? (
        <div className="agent-room-mentions" aria-label="成员建议">
          {"all".includes(mention) ? <button type="button" disabled={room.archived || state === "sending"} onClick={() => completeMention()}>@all</button> : null}
          {suggestions.map((member) => (
            <button type="button" key={member.memberId} disabled={room.archived || state === "sending"} onClick={() => completeMention(member)}>
              @{member.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <div className="agent-room-composer-options">
        <label>
          <span>执行模式</span>
          <select aria-label="执行模式" value={mode} onChange={(event) => setMode(event.target.value)} disabled={room.archived || state === "sending"}>
            <option value="direct">直接</option>
            <option value="parallel">并行</option>
          </select>
        </label>
        <label>
          <span>忙碌策略</span>
          <select aria-label="忙碌策略" value={queuePolicy} onChange={(event) => setQueuePolicy(event.target.value)} disabled={room.archived || state === "sending"}>
            <option value="enqueue">FIFO 排队</option>
            <option value="follow_up">原生 Follow-up（不支持时排队）</option>
            <option value="abort_and_replace">中止后替换（当前安全阻塞）</option>
            <option value="record_only">只记录，不执行</option>
          </select>
        </label>
      </div>
      {queuePolicy === "abort_and_replace" ? <p className="agent-room-risk">Runtime 尚不能确认 Abort；选择此项只会创建 blocked Run，不会提交替代任务。</p> : null}

      <div className="agent-room-composer-attachments">
        <button type="button" disabled={room.archived || state === "sending"} onClick={() => void addAttachments()}>
          选择附件
        </button>
        {attachmentPaths.length ? (
          <ul aria-label="待发送附件">
            {attachmentPaths.map((path) => (
              <li key={path} title={path}>
                <span>{fileName(path)}</span>
                <button type="button" aria-label={`移除 ${fileName(path)}`} onClick={() => setAttachmentPaths((current) => current.filter((value) => value !== path))}>移除</button>
              </li>
            ))}
          </ul>
        ) : <span>未选择附件</span>}
      </div>

      <fieldset disabled={room.archived || state === "sending"}>
        <legend>共享已完成结果</legend>
        <div className="agent-room-shared-runs">
          {availableRuns.map((run) => (
            <label key={run.runId} title={run.runId}>
              <input
                type="checkbox"
                checked={sharedRunIds.includes(run.runId)}
                onChange={() => setSharedRunIds((current) => current.includes(run.runId) ? current.filter((value) => value !== run.runId) : [...current, run.runId])}
              />
              {members.find((member) => member.memberId === run.memberId)?.displayName ?? "Agent"} · {run.runId.slice(0, 8)}
            </label>
          ))}
          {availableRuns.length === 0 ? <span>暂无可共享的已完成 Run</span> : null}
        </div>
      </fieldset>

      <div className="agent-room-send-preview" aria-live="polite">
        <strong>发送预览</strong>
        <span>{selectedMembers.length ? selectedMembers.map((member) => member.displayName).join("、") : "尚未选择目标"}</span>
      </div>
      <div className="agent-room-composer-actions">
        <span>{state === "sent" ? "已创建 Message 与 Run。" : state === "failed" ? "分派失败；未假定任务已执行。" : "Ctrl/⌘ + Enter 发送"}</span>
        <button type="button" disabled={!canSend} onClick={() => void send()}>
          {state === "sending" ? "正在分派…" : "发送"}
        </button>
      </div>
      {dispatchNotice ? (
        <div className="agent-room-busy-dialog" role="dialog" aria-label="Session busy 处理结果">
          <strong>{dispatchNotice === "queued" ? "Session 正忙，任务已进入 FIFO Queue。" : "Abort 未确认，替代 Run 已安全阻塞。"}</strong>
          <p>可用策略：排队、Follow-up 降级排队、只记录；Abort 未确认时禁止替代执行。可在 Timeline 取消排队或查看状态。</p>
          <button type="button" onClick={() => setDispatchNotice("")}>知道了</button>
        </div>
      ) : null}
    </section>
  );
}

function fileName(path: string) {
  return path.split(/[\\/]+/).filter(Boolean).pop() ?? path;
}
