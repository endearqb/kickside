import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AgentConnectorBinding, AgentProfile, BridgeSettings } from "@/app/types";
import { deleteAgentConnectorBinding, listAgentConnectorBindings, listAgentRoomAgents, putAgentConnectorBinding } from "@/services/agentRoomService";

export function AgentRoomConnectorPanel() {
  const [connectors, setConnectors] = useState<BridgeSettings["connectors"]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [bindings, setBindings] = useState<AgentConnectorBinding[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void reload().catch(() => setError("Connector bindings 暂时不可用。")); }, []);
  async function reload() {
    const [settings, profiles, links] = await Promise.all([invoke<BridgeSettings>("get_bridge_settings"), listAgentRoomAgents(), listAgentConnectorBindings()]);
    setConnectors(settings.connectors); setAgents(profiles.items); setBindings(links.items);
  }
  async function bind(connectorId: string, agentId: string, sessionMode: "independent_session" | "same_session") {
    setError("");
    try { if (agentId) await putAgentConnectorBinding(connectorId, { agentId, sessionMode }); else await deleteAgentConnectorBinding(connectorId); await reload(); } catch { setError("绑定未保存；same_session 需要 Agent 的明确 pinned Session。"); }
  }
  return <section className="agent-room-connectors" aria-label="Connector Agent bindings"><header><div><h3>Connector bindings</h3><p>Connector 与 Agent 生命周期解耦；凭据不会复制到 Agent。</p></div></header>{connectors.length === 0 ? <p>尚无 Connector。</p> : <ul>{connectors.map((connector) => {
    const binding = bindings.find((item) => item.connectorId === connector.id);
    return <li key={connector.id}><div><strong>{connector.label || connector.id}</strong><span>{connector.platform} · {connector.defaultWorkDir ? "Connector WorkDir override" : "使用 Agent / 全局 WorkDir"}</span></div><label>Agent<select value={binding?.agentId ?? ""} onChange={(event) => void bind(connector.id, event.target.value, binding?.sessionMode ?? "independent_session")}><option value="">Unbound</option>{agents.filter((agent) => agent.enabled).map((agent) => <option key={agent.agentId} value={agent.agentId}>{agent.name}</option>)}</select></label><label>Session<select disabled={!binding} value={binding?.sessionMode ?? "independent_session"} onChange={(event) => binding && void bind(connector.id, binding.agentId, event.target.value as "independent_session" | "same_session")}><option value="independent_session">Independent</option><option value="same_session">Same pinned Session</option></select></label></li>;
  })}</ul>}{error ? <p className="agent-room-action-error" role="alert">{error}</p> : null}</section>;
}
