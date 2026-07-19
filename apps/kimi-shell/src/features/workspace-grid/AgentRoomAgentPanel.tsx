import { useEffect, useMemo, useState, type FormEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AgentProfile, AgentProfileInput, AgentSessionPolicy } from "@/app/types";
import {
  listWorkspaces,
  type WorkspaceRecord,
} from "@/features/control-center/controlCenterRebuildApi";
import {
  createAgentRoomAgent,
  deleteAgentRoomAgent,
  listAgentRoomAgents,
  updateAgentRoomAgent,
} from "@/services/agentRoomService";
import type { ObservedSessionView } from "./agentRoomObservationStore";

interface AgentRoomAgentPanelProps {
  sessions: ObservedSessionView[];
  seedSession?: ObservedSessionView;
}

interface RuntimeControlDraft {
  model: string;
  thinking: string;
  permissionMode: string;
  planMode: boolean;
  swarmMode: boolean;
  goalObjective: string;
  goalControl: string;
}

interface AgentDraft {
  name: string;
  avatar: string;
  description: string;
  rolePrompt: string;
  defaultWorkDir: string;
  sessionPolicy: AgentSessionPolicy;
  pinnedSessionId: string;
  autoApprove: boolean;
  enabled: boolean;
  runtimeControls: RuntimeControlDraft;
}

const EMPTY_CONTROLS: RuntimeControlDraft = {
  model: "",
  thinking: "",
  permissionMode: "",
  planMode: false,
  swarmMode: false,
  goalObjective: "",
  goalControl: "",
};

const EMPTY_DRAFT: AgentDraft = {
  name: "",
  avatar: "",
  description: "",
  rolePrompt: "",
  defaultWorkDir: "",
  sessionPolicy: "per_room",
  pinnedSessionId: "",
  autoApprove: false,
  enabled: true,
  runtimeControls: EMPTY_CONTROLS,
};

export function AgentRoomAgentPanel({ sessions, seedSession }: AgentRoomAgentPanelProps) {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [selectedId, setSelectedId] = useState("new");
  const [draft, setDraft] = useState<AgentDraft>(() =>
    seedSession?.workDir
      ? {
          ...EMPTY_DRAFT,
          defaultWorkDir: seedSession.workDir,
          sessionPolicy: "resume_selected",
          pinnedSessionId: seedSession.sessionId,
        }
      : EMPTY_DRAFT,
  );
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const selected = agents.find((agent) => agent.agentId === selectedId);
  const workspaceOptions = useMemo(() => {
    const items = workspaces.map((workspace) => ({ name: workspace.name, cwd: workspace.cwd }));
    if (draft.defaultWorkDir && !items.some((item) => item.cwd === draft.defaultWorkDir)) {
      items.push({ name: directoryName(draft.defaultWorkDir), cwd: draft.defaultWorkDir });
    }
    return items;
  }, [draft.defaultWorkDir, workspaces]);
  const sessionOptions = useMemo(
    () => sessions.filter((session) => !draft.defaultWorkDir || samePath(session.workDir, draft.defaultWorkDir)),
    [draft.defaultWorkDir, sessions],
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    void Promise.all([listAgentRoomAgents(), listWorkspaces()])
      .then(([agentList, workspaceList]) => {
        if (cancelled) return;
        setAgents(agentList.items);
        setWorkspaces(workspaceList);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectAgent(agent: AgentProfile) {
    setSelectedId(agent.agentId);
    setDraft(toDraft(agent));
    setError("");
    setRevisionConflict(false);
  }

  function startNew(seed: AgentDraft = EMPTY_DRAFT) {
    setSelectedId("new");
    setDraft(seed);
    setError("");
    setRevisionConflict(false);
  }

  async function chooseWorkspace() {
    const selectedPath = await open({ directory: true, multiple: false });
    if (typeof selectedPath === "string") {
      setDraft((current) => ({ ...current, defaultWorkDir: selectedPath, pinnedSessionId: "" }));
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const validationError = validateAgentDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    setRevisionConflict(false);
    try {
      const input = toInput(draft);
      const saved = selected
        ? await updateAgentRoomAgent(selected.agentId, { revision: selected.revision, ...input })
        : await createAgentRoomAgent(input);
      setAgents((current) => [saved, ...current.filter((agent) => agent.agentId !== saved.agentId)]);
      setSelectedId(saved.agentId);
      setDraft(toDraft(saved));
    } catch (saveError) {
      setError(agentErrorMessage(saveError));
      setRevisionConflict(errorCode(saveError) === "revision_conflict");
    } finally {
      setSaving(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    if (!window.confirm("删除 Agent Profile？现有 Room Member 会保留快照，Kimi Session 不会删除。")) return;
    setError("");
    try {
      await deleteAgentRoomAgent(selected.agentId);
      setAgents((current) => current.filter((agent) => agent.agentId !== selected.agentId));
      startNew();
    } catch (deleteError) {
      setError(agentErrorMessage(deleteError));
    }
  }

  function copySelected() {
    if (!selected) return;
    startNew({ ...toDraft(selected), name: `${selected.name} 副本` });
  }

  async function reloadSelected() {
    if (!selected) return;
    setError("");
    setRevisionConflict(false);
    try {
      const result = await listAgentRoomAgents();
      setAgents(result.items);
      const latest = result.items.find((agent) => agent.agentId === selected.agentId);
      if (latest) setDraft(toDraft(latest));
    } catch {
      setError("无法重新载入 Agent Profile。");
    }
  }

  if (state === "loading") return <p>正在读取 Agent Profile。</p>;
  if (state === "error") return <p role="alert">Agent Profile 暂时不可用。</p>;

  const pinnedPolicy = draft.sessionPolicy === "persistent" || draft.sessionPolicy === "resume_selected";
  return (
    <div className="agent-room-management" aria-label="Agent Profile 管理">
      <aside className="agent-room-object-list">
        <div>
          <strong>Agents</strong>
          <button type="button" onClick={() => startNew()}>新建 Agent</button>
        </div>
        <ul>
          {agents.map((agent) => (
            <li key={agent.agentId}>
              <button
                type="button"
                className={selectedId === agent.agentId ? "is-selected" : ""}
                onClick={() => selectAgent(agent)}
              >
                <strong>{agent.name}</strong>
                <span>{agent.enabled ? "运行中" : "已停止"}</span>
              </button>
            </li>
          ))}
        </ul>
        {!agents.length ? <p>还没有 Agent Profile。</p> : null}
      </aside>

      <form className="agent-room-agent-form" onSubmit={(event) => void save(event)}>
        <div className="agent-room-form-heading">
          <h3>{selected ? `编辑 ${selected.name}` : "新建 Agent"}</h3>
          <div>
            {selected ? <button type="button" onClick={copySelected}>复制 Agent</button> : null}
            {selected ? <button type="button" className="is-danger" onClick={() => void removeSelected()}>删除 Agent</button> : null}
            <button type="submit" disabled={saving}>{saving ? "正在保存" : "保存 Agent"}</button>
          </div>
        </div>

        <section>
          <h4>身份与角色</h4>
          <label>名称<input value={draft.name} maxLength={64} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>头像标识<input value={draft.avatar} onChange={(event) => setDraft({ ...draft, avatar: event.target.value })} /></label>
          <label>说明<input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>Role Prompt<textarea value={draft.rolePrompt} onChange={(event) => setDraft({ ...draft, rolePrompt: event.target.value })} /></label>
        </section>

        <section>
          <h4>Workspace 与 Session</h4>
          <label>
            默认 Workspace
            <select value={draft.defaultWorkDir} onChange={(event) => setDraft({ ...draft, defaultWorkDir: event.target.value, pinnedSessionId: "" })}>
              <option value="">选择 Workspace</option>
              {workspaceOptions.map((workspace) => <option key={workspace.cwd} value={workspace.cwd}>{workspace.name} — {workspace.cwd}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => void chooseWorkspace()}>选择其他目录</button>
          <label>
            Session Policy
            <select value={draft.sessionPolicy} onChange={(event) => setDraft({ ...draft, sessionPolicy: event.target.value as AgentSessionPolicy, pinnedSessionId: "" })}>
              <option value="per_room">每个 Room</option>
              <option value="persistent">持久 Session</option>
              <option value="new_per_task">每次任务新建</option>
              <option value="resume_selected">恢复指定 Session</option>
            </select>
          </label>
          {pinnedPolicy ? (
            <label>
              固定 Session
              <select value={draft.pinnedSessionId} onChange={(event) => setDraft({ ...draft, pinnedSessionId: event.target.value })}>
                <option value="">{draft.sessionPolicy === "resume_selected" ? "必须选择 Session" : "不固定 Session"}</option>
                {sessionOptions.map((session) => <option key={session.sessionId} value={session.sessionId}>Session {shortId(session.sessionId)} — {session.workDir ?? "Workspace 未知"}</option>)}
              </select>
            </label>
          ) : null}
        </section>

        <section>
          <h4>运行时控制</h4>
          <div className="agent-room-control-grid">
            <label>模型<input value={draft.runtimeControls.model} onChange={(event) => updateControl(setDraft, draft, "model", event.target.value)} /></label>
            <label>Thinking<input value={draft.runtimeControls.thinking} onChange={(event) => updateControl(setDraft, draft, "thinking", event.target.value)} /></label>
            <label>权限模式<input value={draft.runtimeControls.permissionMode} onChange={(event) => updateControl(setDraft, draft, "permissionMode", event.target.value)} /></label>
            <label>Goal Objective<input value={draft.runtimeControls.goalObjective} onChange={(event) => updateControl(setDraft, draft, "goalObjective", event.target.value)} /></label>
            <label>Goal Control<input value={draft.runtimeControls.goalControl} onChange={(event) => updateControl(setDraft, draft, "goalControl", event.target.value)} /></label>
          </div>
          <label className="agent-room-check"><input type="checkbox" checked={draft.runtimeControls.planMode} onChange={(event) => updateControl(setDraft, draft, "planMode", event.target.checked)} />Plan Mode</label>
          <label className="agent-room-check"><input type="checkbox" checked={draft.runtimeControls.swarmMode} onChange={(event) => updateControl(setDraft, draft, "swarmMode", event.target.checked)} />Swarm Mode</label>
          <label className="agent-room-check"><input type="checkbox" checked={draft.autoApprove} onChange={(event) => setDraft({ ...draft, autoApprove: event.target.checked })} />自动批准 Runtime 请求</label>
          {draft.autoApprove ? <p className="agent-room-risk">高风险：仅在受信任 Workspace 启用自动批准。</p> : null}
          <label className="agent-room-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用 Agent</label>
        </section>

        <section>
          <h4>Connector Binding</h4>
          <p>待配置：Agent 与 Connector 的独立绑定将在 Workflow/Connector 阶段提供。</p>
        </section>
        {error ? <p className="agent-room-action-error" role="alert">{error}</p> : null}
        {revisionConflict ? <button type="button" onClick={() => void reloadSelected()}>重新载入 Agent</button> : null}
      </form>
    </div>
  );
}

function toDraft(agent: AgentProfile): AgentDraft {
  const controls = isRecord(agent.runtimeControls) ? agent.runtimeControls : {};
  return {
    name: agent.name,
    avatar: agent.avatar ?? "",
    description: agent.description ?? "",
    rolePrompt: agent.rolePrompt,
    defaultWorkDir: agent.defaultWorkDir,
    sessionPolicy: agent.sessionPolicy,
    pinnedSessionId: agent.pinnedSessionId ?? "",
    autoApprove: agent.autoApprove,
    enabled: agent.enabled,
    runtimeControls: {
      model: stringValue(controls.model),
      thinking: stringValue(controls.thinking),
      permissionMode: stringValue(controls.permissionMode),
      planMode: controls.planMode === true,
      swarmMode: controls.swarmMode === true,
      goalObjective: stringValue(controls.goalObjective),
      goalControl: stringValue(controls.goalControl),
    },
  };
}

function toInput(draft: AgentDraft): AgentProfileInput {
  const controls = Object.fromEntries(Object.entries(draft.runtimeControls).filter(([, value]) => value !== "" && value !== false));
  const acceptsPinned = draft.sessionPolicy === "persistent" || draft.sessionPolicy === "resume_selected";
  return {
    name: draft.name.trim(),
    avatar: draft.avatar.trim(),
    description: draft.description.trim(),
    rolePrompt: draft.rolePrompt.trim(),
    defaultWorkDir: draft.defaultWorkDir,
    sessionPolicy: draft.sessionPolicy,
    pinnedSessionId: acceptsPinned ? draft.pinnedSessionId : "",
    autoApprove: draft.autoApprove,
    runtimeControls: controls,
    enabled: draft.enabled,
  };
}

function validateAgentDraft(draft: AgentDraft) {
  const nameLength = Array.from(draft.name.trim()).length;
  if (nameLength < 1 || nameLength > 64) return "名称必须为 1–64 个字符。";
  if (!draft.rolePrompt.trim()) return "Role Prompt 必填。";
  if (new TextEncoder().encode(draft.rolePrompt.trim()).length > 32 * 1024) return "Role Prompt 不能超过 32 KiB。";
  if (!draft.defaultWorkDir.trim()) return "必须选择默认 Workspace。";
  if (draft.sessionPolicy === "resume_selected" && !draft.pinnedSessionId) return "恢复指定 Session 时必须明确选择 Session。";
  return "";
}

function updateControl<K extends keyof RuntimeControlDraft>(setDraft: (value: AgentDraft) => void, draft: AgentDraft, key: K, value: RuntimeControlDraft[K]) {
  setDraft({ ...draft, runtimeControls: { ...draft.runtimeControls, [key]: value } });
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function samePath(left: string | undefined, right: string) { return !!left && left.replace(/[\\/]+$/, "").toLowerCase() === right.replace(/[\\/]+$/, "").toLowerCase(); }
function directoryName(value: string) { return value.split(/[\\/]+/).filter(Boolean).pop() || value; }
function shortId(value: string) { return value.length > 12 ? `${value.slice(0, 12)}…` : value; }
function agentErrorMessage(error: unknown) {
  const code = errorCode(error);
  if (code === "revision_conflict") return "此 Agent 已被其他操作修改。请重新选择它以载入最新版本。";
  if (code === "workspace_not_found") return "Workspace 不存在或不是目录。";
  if (code === "workspace_mismatch") return "固定 Session 与 Workspace 不匹配。";
  if (code === "session_not_found") return "固定 Session 不存在。";
  if (code === "feature_disabled") return "Agent Room 功能未启用。";
  return "Agent Profile 操作失败，请检查输入和本地服务状态。";
}
function errorCode(error: unknown) { return error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined; }
