import { useEffect, useMemo, useState } from "react";
import type { AgentRoom, AgentRoomMember, AgentRoomMessage, AgentRun, WorkflowDefinition } from "@/app/types";
import { getAgentRoomTimeline, postAgentRoomMessage, resolveAgentRoomWorkflow } from "@/services/agentRoomService";

type TemplateId = "parallel_review" | "delivery_chain" | "research_chain" | "custom";

const TEMPLATES: Record<Exclude<TemplateId, "custom">, Array<{ id: string; label: string; prompt: string; dependsOn?: string[] }>> = {
  parallel_review: [
    { id: "review", label: "Reviewers", prompt: "Review independently and report concrete findings." },
    { id: "synthesize", label: "Synthesizer", prompt: "Synthesize the explicit reviewer results.", dependsOn: ["review"] },
  ],
  delivery_chain: [
    { id: "architect", label: "Architect", prompt: "Define the implementation contract and boundaries." },
    { id: "developer", label: "Developer", prompt: "Implement against the explicit architecture result.", dependsOn: ["architect"] },
    { id: "reviewer", label: "Reviewer", prompt: "Review the implementation against the contract.", dependsOn: ["developer"] },
  ],
  research_chain: [
    { id: "research", label: "Researcher", prompt: "Gather evidence and state uncertainty." },
    { id: "critic", label: "Critic", prompt: "Challenge the evidence and identify gaps.", dependsOn: ["research"] },
    { id: "synthesize", label: "Synthesizer", prompt: "Produce a bounded conclusion from the explicit results.", dependsOn: ["critic"] },
  ],
};

export function AgentRoomWorkflowPanel({ room, members, revision = 0 }: { room: AgentRoom; members: AgentRoomMember[]; revision?: number }) {
  const [template, setTemplate] = useState<TemplateId>("parallel_review");
  const [task, setTask] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [customJSON, setCustomJSON] = useState('{"version":"1","stages":[]}');
  const [messages, setMessages] = useState<AgentRoomMessage[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const first = members[0]?.memberId;
    if (!first) return;
    const descriptors = template === "custom" ? [] : TEMPLATES[template];
    setAssignments(Object.fromEntries(descriptors.map((stage, index) => [stage.id, template === "parallel_review" && index === 0 ? members.map((member) => member.memberId) : [members[Math.min(index, members.length - 1)]?.memberId ?? first]])));
  }, [members, template]);

  useEffect(() => {
    let cancelled = false;
    void getAgentRoomTimeline(room.roomId, { limit: 200 }).then((timeline) => {
      if (!cancelled) {
        setMessages(timeline.messages);
        setRuns(timeline.runs);
      }
    }).catch(() => { if (!cancelled) setError("Workflow 进度暂时不可用。"); });
    return () => { cancelled = true; };
  }, [revision, room.roomId]);

  const executions = useMemo(() => messages.flatMap((message) => {
    const definition = workflowDefinition(message);
    return definition ? [{ message, definition, runs: runs.filter((run) => run.sourceMessageId === message.messageId) }] : [];
  }), [messages, runs]);

  function setSingle(stageId: string, memberId: string) {
    setAssignments((current) => ({ ...current, [stageId]: memberId ? [memberId] : [] }));
  }

  function toggleReviewer(memberId: string) {
    setAssignments((current) => {
      const selected = current.review ?? [];
      return { ...current, review: selected.includes(memberId) ? selected.filter((id) => id !== memberId) : [...selected, memberId] };
    });
  }

  async function startWorkflow() {
    setError("");
    let definition: WorkflowDefinition;
    try {
      definition = template === "custom" ? JSON.parse(customJSON) as WorkflowDefinition : buildWorkflowDefinition(template, assignments);
    } catch {
      setError("Custom definition 必须是合法的 Workflow V1 JSON。");
      return;
    }
    if (!task.trim() || definition.stages.some((stage) => stage.targetMemberIds.length === 0)) {
      setError("请填写任务并为每个 Stage 明确选择成员。");
      return;
    }
    setState("sending");
    try {
      await postAgentRoomMessage(room.roomId, { content: task.trim(), mode: "workflow", queuePolicy: "enqueue", workflowDefinition: definition });
      setTask("");
      const timeline = await getAgentRoomTimeline(room.roomId, { limit: 200 });
      setMessages(timeline.messages);
      setRuns(timeline.runs);
      setState("idle");
    } catch {
      setState("error");
      setError("Workflow 启动失败；定义、成员或 Observer 状态不满足执行条件。");
    }
  }

  async function resolve(messageId: string, decision: "continue" | "stop") {
    try {
      const result = await resolveAgentRoomWorkflow(room.roomId, messageId, decision);
      setRuns((current) => [...current.filter((run) => run.sourceMessageId !== messageId), ...result.runs]);
    } catch {
      setError("Workflow 决策未应用；它可能已被处理。");
    }
  }

  const descriptors = template === "custom" ? [] : TEMPLATES[template];
  return (
    <section className="agent-room-workflow" aria-label="Workflow">
      <header><div><h3>Workflow</h3><p>DAG 最多 16 个 Stage / 32 个 Run；Agent reply 不会递归触发新任务。</p></div></header>
      <div className="agent-room-workflow-builder">
        <label>模板<select value={template} onChange={(event) => setTemplate(event.target.value as TemplateId)} disabled={room.archived || state === "sending"}>
          <option value="parallel_review">Parallel Review</option><option value="delivery_chain">Architect → Developer → Reviewer</option><option value="research_chain">Research → Critic → Synthesizer</option><option value="custom">Custom explicit stages</option>
        </select></label>
        {template === "custom" ? <label>Definition JSON<textarea value={customJSON} onChange={(event) => setCustomJSON(event.target.value)} /></label> : descriptors.map((stage, index) => (
          <fieldset key={stage.id}><legend>{stage.label}</legend>
            {template === "parallel_review" && index === 0 ? <div className="agent-room-targets">{members.map((member) => <label key={member.memberId}><input type="checkbox" checked={(assignments[stage.id] ?? []).includes(member.memberId)} onChange={() => toggleReviewer(member.memberId)} />{member.displayName}</label>)}</div> : <select aria-label={`${stage.label} member`} value={assignments[stage.id]?.[0] ?? ""} onChange={(event) => setSingle(stage.id, event.target.value)}><option value="">选择成员</option>{members.map((member) => <option key={member.memberId} value={member.memberId}>{member.displayName}</option>)}</select>}
            <p>{stage.prompt}</p>
          </fieldset>
        ))}
        <label>任务<textarea value={task} onChange={(event) => setTask(event.target.value)} disabled={room.archived || state === "sending"} /></label>
        <button type="button" disabled={room.archived || state === "sending" || members.length === 0} onClick={() => void startWorkflow()}>{state === "sending" ? "正在启动" : "启动 Workflow"}</button>
        {error ? <p className="agent-room-action-error" role="alert">{error}</p> : null}
      </div>
      <div className="agent-room-workflow-progress"><h4>执行进度</h4>{executions.length === 0 ? <p>尚无 Workflow。</p> : executions.map(({ message, definition, runs: executionRuns }) => (
        <article key={message.messageId}><strong>{message.content}</strong><ol>{definition.stages.map((stage) => {
          const stageRuns = executionRuns.filter((run) => run.workflowStageId === stage.stageId);
          const waitingUser = stageRuns.some((run) => run.status === "waiting_user");
          return <li key={stage.stageId}><span>{stage.stageId}</span><small>依赖：{stage.dependsOn?.join(", ") || "无"} · {stage.failurePolicy}</small><span>{stageRuns.map((run) => `${memberName(members, run.memberId)}: ${run.status}`).join(" · ")}</span>{waitingUser ? <div><button type="button" onClick={() => void resolve(message.messageId, "continue")}>继续</button><button type="button" className="is-danger" onClick={() => void resolve(message.messageId, "stop")}>停止</button></div> : null}</li>;
        })}</ol></article>
      ))}</div>
    </section>
  );
}

export function buildWorkflowDefinition(template: Exclude<TemplateId, "custom">, assignments: Record<string, string[]>): WorkflowDefinition {
  return { version: "1", stages: TEMPLATES[template].map((stage) => ({ stageId: stage.id, targetMemberIds: [...new Set(assignments[stage.id] ?? [])], dependsOn: stage.dependsOn, aggregation: "all", promptTemplate: stage.prompt, failurePolicy: "stop" })) };
}

function workflowDefinition(message: AgentRoomMessage): WorkflowDefinition | undefined {
  if (!message.metadata || typeof message.metadata !== "object") return undefined;
  const value = (message.metadata as { workflowDefinition?: unknown }).workflowDefinition;
  return value && typeof value === "object" ? value as WorkflowDefinition : undefined;
}
function memberName(members: AgentRoomMember[], memberId: string) { return members.find((member) => member.memberId === memberId)?.displayName ?? memberId.slice(0, 8); }
