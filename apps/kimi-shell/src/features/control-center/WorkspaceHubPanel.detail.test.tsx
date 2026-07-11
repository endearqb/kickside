// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHubPanel } from "./WorkspaceHubPanel";

const workspace = {
  id: "workspace-1",
  name: "Demo Workspace",
  cwd: "C:/Projects/Demo",
  agentRuntime: "kimi-code",
  source: "manual",
  tags: ["demo"],
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  lastOpenedAt: "2026-07-11T01:00:00.000Z",
};

const harness = {
  id: "harness-1",
  name: "Demo Harness",
  version: "0.1.0",
  summary: "Harness summary",
  tags: [],
  template: "default",
  variables: [],
  skills: [],
  postCreate: {},
};

vi.mock("./controlCenterRebuildApi", () => ({
  createHarnessWorkspace: vi.fn(),
  dryRunHarness: vi.fn(),
  listHarnessFileEntries: vi.fn(async () => [{ relPath: "HARNESS.md", isDir: false }]),
  listHarnesses: vi.fn(async () => [harness]),
  listWorkspaces: vi.fn(async () => [workspace]),
  listWorkspaceFileEntries: vi.fn(async () => [{ relPath: "README.md", isDir: false }]),
  markWorkspaceOpened: vi.fn(async () => workspace),
  readHarnessFile: vi.fn(async (relPath: string) => ({
    relPath,
    size: 9,
    isBinary: false,
    truncated: false,
    text: "# Harness",
  })),
  readWorkspaceFile: vi.fn(async (relPath: string) => ({
    relPath,
    size: 11,
    isBinary: false,
    truncated: false,
    text: "# Workspace",
  })),
}));

describe("WorkspaceHubPanel detail", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows only file preview content for workspace detail", async () => {
    render(
      <WorkspaceHubPanel
        detailOnly
        focusWorkspacePath={workspace.cwd}
        onOpenWorkspace={vi.fn(async () => undefined)}
        onOpenSchedule={vi.fn()}
      />,
    );

    expect(await screen.findByRole("heading", { name: workspace.name })).toBeTruthy();
    expect(await screen.findByRole("treeitem", { name: /README.md/ })).toBeTruthy();
    expect(screen.queryByText("工作区路径")).toBeNull();
    expect(screen.queryByText("Skill 清单")).toBeNull();
    expect(screen.queryByText("调度摘要")).toBeNull();
    expect(screen.queryByText("创建时间")).toBeNull();
  });

  it("keeps harness creation controls unchanged", async () => {
    render(
      <WorkspaceHubPanel
        detailOnly
        onOpenWorkspace={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Demo Harness/ }));

    expect(await screen.findByRole("heading", { name: harness.name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建工作区" })).toBeTruthy();
    expect(screen.getAllByText("变量").length).toBeGreaterThan(0);
  });
});
