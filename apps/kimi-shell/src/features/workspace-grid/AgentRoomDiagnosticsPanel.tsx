import { useEffect, useMemo, useState } from "react";

import type { AgentRoomCapabilities, AgentRoomPumpStatus, BridgeStatus } from "@/app/types";
import { getAgentRoomDiagnostics } from "@/services/agentRoomService";

export function AgentRoomDiagnosticsPanel({
  capabilities,
  pump,
  observerRunning,
  syncErrorCode,
}: {
  capabilities?: AgentRoomCapabilities;
  pump?: AgentRoomPumpStatus;
  observerRunning: boolean;
  syncErrorCode?: string;
}) {
  const [status, setStatus] = useState<BridgeStatus>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reportVisible, setReportVisible] = useState(false);
  const [copyState, setCopyState] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getAgentRoomDiagnostics().then((value) => {
      if (!cancelled) { setStatus(value); setState("ready"); }
    }).catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, []);

  const report = useMemo(() => JSON.stringify({
    bridgeState: status?.state ?? "unknown",
    agentRoom: status?.agentRoom ?? null,
    pump: pump ? { state: pump.state, generation: pump.generation, cursor: pump.cursor, retryCount: pump.retryCount, errorCode: pump.errorCode } : null,
    observerRunning,
    syncErrorCode: syncErrorCode || null,
    capabilities: capabilities ? {
      runtimeProvider: capabilities.runtimeProvider,
      observer: capabilities.observer,
      sessionTranscript: capabilities.sessionTranscript,
      abort: capabilities.abort,
      approval: capabilities.approval,
      degradations: capabilities.degradations,
    } : null,
  }, null, 2), [capabilities, observerRunning, pump, status, syncErrorCode]);

  async function copyReport() {
    setReportVisible(true);
    try {
      await navigator.clipboard.writeText(report);
      setCopyState("安全报告已复制");
    } catch {
      setCopyState("系统剪贴板不可用，请手动复制下方报告");
    }
  }

  const room = status?.agentRoom;
  return (
    <section className="agent-room-diagnostics" aria-label="Agent Room Diagnostics">
      <div className="agent-room-section-heading"><h3>Agent Room Doctor</h3><span>{state === "loading" ? "读取中" : state === "error" ? "状态不可用" : "已脱敏"}</span></div>
      <dl>
        <Diagnostic label="Core" value={room?.core ?? "unknown"} />
        <Diagnostic label="Sidecar" value={status?.state ?? "unknown"} />
        <Diagnostic label="DB version" value={String(room?.databaseVersion ?? 0)} />
        <Diagnostic label="Event Pump" value={pump?.state ?? "idle"} />
        <Diagnostic label="Observer" value={observerRunning ? "running" : room?.observer ?? "not_running"} />
        <Diagnostic label="Active Runs" value={String(room?.activeRuns ?? 0)} />
        <Diagnostic label="Queue / Lease" value={`${room?.queueDepth ?? 0} / ${room?.activeLeases ?? 0}`} />
        <Diagnostic label="Pending Approval" value={String(room?.pendingApprovals ?? 0)} />
        <Diagnostic label="Pane generation" value={String(room?.paneGeneration ?? 0)} />
        <Diagnostic label="Transcript" value={capabilities?.sessionTranscript ? "supported" : "unsupported"} />
        <Diagnostic label="Capability" value={(room?.degradations ?? capabilities?.degradations ?? []).length ? "degraded" : "ready"} />
        <Diagnostic label="Logs" value="omitted from safe report" />
      </dl>
      <div className="agent-room-capability-badges" aria-label="能力降级">
        {(room?.degradations ?? capabilities?.degradations ?? []).map((item) => <span key={item}>{item}</span>)}
        {syncErrorCode ? <span>{syncErrorCode}</span> : null}
      </div>
      <button type="button" onClick={() => void copyReport()}>复制安全报告</button>
      {copyState ? <p role="status">{copyState}</p> : null}
      {reportVisible ? <pre>{report}</pre> : null}
    </section>
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
