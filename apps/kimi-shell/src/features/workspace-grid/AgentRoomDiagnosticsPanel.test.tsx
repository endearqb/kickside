// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ diagnostics: vi.fn() }));
vi.mock("@/services/agentRoomService", () => ({ getAgentRoomDiagnostics: mocks.diagnostics }));

import { AgentRoomDiagnosticsPanel } from "./AgentRoomDiagnosticsPanel";

afterEach(cleanup);

describe("AgentRoomDiagnosticsPanel", () => {
  it("shows recovery health and generates a report without unrelated Bridge secrets", async () => {
    mocks.diagnostics.mockResolvedValue({
      state: "running", adminPort: 1, kimiRuntimeLocator: { configured: true, readable: true }, runtimeAdapter: { state: "ready" },
      agentRoom: { enabled: true, core: "running", observer: "running", activeRuns: 2, queueDepth: 3, observedSessions: 4, databaseVersion: 18, activeLeases: 1, pendingApprovals: 1, paneGeneration: 9, degradations: ["abort_unconfirmed"] },
      connectors: [], pendingApprovals: 1, bindings: 0, lastError: "must-not-copy-token",
    });
    render(<AgentRoomDiagnosticsPanel observerRunning capabilities={{ runtimeProvider: "server", core: true, observer: true, multiSessionObservation: true, sessionTranscript: false, userPromptEvents: true, abort: false, approval: true, nativeFollowUp: false, degradations: ["abort_unconfirmed"] }} />);
    expect(await screen.findByText("18")).toBeTruthy();
    expect(screen.getByText("3 / 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "复制安全报告" }));
    const report = await screen.findByText(/"databaseVersion": 18/);
    expect(report.textContent).not.toContain("must-not-copy-token");
  });
});
