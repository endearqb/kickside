// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
  listWorkspaces: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@/services/agentRoomService", () => ({
  listAgentRoomAgents: mocks.listAgents,
  createAgentRoomAgent: mocks.createAgent,
  updateAgentRoomAgent: mocks.updateAgent,
  deleteAgentRoomAgent: mocks.deleteAgent,
}));
vi.mock("@/features/control-center/controlCenterRebuildApi", () => ({
  listWorkspaces: mocks.listWorkspaces,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import { AgentRoomAgentPanel } from "./AgentRoomAgentPanel";
import type { ObservedSessionView } from "./agentRoomObservationStore";

describe("AgentRoomAgentPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAgents.mockResolvedValue({ items: [] });
    mocks.listWorkspaces.mockResolvedValue([
      { id: "workspace-1", name: "Repo", cwd: "D:/repo", tags: [] },
    ]);
    mocks.createAgent.mockImplementation(async (input) => profile({ ...input, agentId: "agent-new" }));
    mocks.updateAgent.mockImplementation(async (agentId, input) =>
      profile({ ...input, agentId, revision: input.revision + 1 }),
    );
    mocks.deleteAgent.mockResolvedValue({ status: "deleted" });
  });

  afterEach(cleanup);

  it("creates a seeded Agent only after required role and exact Session are explicit", async () => {
    render(<AgentRoomAgentPanel sessions={[session]} seedSession={session} />);
    await screen.findByRole("heading", { name: "新建 Agent" });

    mocks.open.mockResolvedValueOnce("D:/other");
    fireEvent.click(screen.getByRole("button", { name: "选择其他目录" }));
    await waitFor(() => expect((screen.getByLabelText("默认 Workspace") as HTMLSelectElement).value).toBe("D:/other"));
    fireEvent.change(screen.getByLabelText("默认 Workspace"), { target: { value: "D:/repo" } });
    fireEvent.change(screen.getByLabelText("固定 Session"), { target: { value: "session-1" } });

    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Agent" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Role Prompt 必填");

    fireEvent.change(screen.getByLabelText("Role Prompt"), { target: { value: "Review boundaries" } });
    fireEvent.change(screen.getByLabelText("模型"), { target: { value: "kimi-k2" } });
    fireEvent.click(screen.getByLabelText("自动批准 Runtime 请求"));
    expect(screen.getByText(/高风险/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存 Agent" }));

    await waitFor(() =>
      expect(mocks.createAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Reviewer",
          rolePrompt: "Review boundaries",
          defaultWorkDir: "D:/repo",
          sessionPolicy: "resume_selected",
          pinnedSessionId: "session-1",
          autoApprove: true,
          runtimeControls: { model: "kimi-k2" },
        }),
      ),
    );
  });

  it("updates with revision, copies as a new draft, and confirms deletion impact", async () => {
    const existing = profile();
    mocks.listAgents.mockResolvedValueOnce({ items: [existing] });
    render(<AgentRoomAgentPanel sessions={[session]} />);
    fireEvent.click(await screen.findByRole("button", { name: /Reviewer/ }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Lead Reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Agent" }));
    await waitFor(() =>
      expect(mocks.updateAgent).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({ revision: 4, name: "Lead Reviewer" }),
      ),
    );

    mocks.updateAgent.mockRejectedValueOnce({ code: "revision_conflict" });
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Local Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Agent" }));
    expect(await screen.findByRole("button", { name: "重新载入 Agent" })).toBeTruthy();
    mocks.listAgents.mockResolvedValueOnce({ items: [profile({ name: "Remote Reviewer", revision: 6 })] });
    fireEvent.click(screen.getByRole("button", { name: "重新载入 Agent" }));
    await waitFor(() => expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("Remote Reviewer"));

    fireEvent.click(screen.getByRole("button", { name: "复制 Agent" }));
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("Remote Reviewer 副本");

    fireEvent.click(screen.getByRole("button", { name: /Remote Reviewer/ }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "删除 Agent" }));
    await waitFor(() => expect(mocks.deleteAgent).toHaveBeenCalledWith("agent-1"));
    expect(confirm.mock.calls[0]?.[0]).toContain("Kimi Session 不会删除");
  });
});

const session: ObservedSessionView = {
  sessionId: "session-1",
  workDir: "D:/repo",
  paneIds: ["pane-1"],
  primaryPaneId: "pane-1",
  visible: true,
  pinned: false,
  recentEvents: [],
};

function profile(overrides: Record<string, unknown> = {}) {
  return {
    agentId: "agent-1",
    name: "Reviewer",
    avatar: "",
    description: "",
    rolePrompt: "Review boundaries",
    defaultWorkDir: "D:/repo",
    sessionPolicy: "per_room",
    pinnedSessionId: "",
    autoApprove: false,
    runtimeControls: {},
    enabled: true,
    revision: 4,
    createdAt: "2026-07-18T00:00:00Z",
    updatedAt: "2026-07-18T00:00:00Z",
    ...overrides,
  };
}
