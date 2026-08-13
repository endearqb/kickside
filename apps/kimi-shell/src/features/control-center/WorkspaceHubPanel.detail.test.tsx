// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHubPanel } from "./WorkspaceHubPanel";

const openDialog = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialog, ask: vi.fn() }));

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
  variables: [
    {
      key: "workspaceName",
      label: "工作区名称",
      type: "string",
      required: true,
      secret: false,
    },
    {
      key: "workDir",
      label: "目标目录",
      type: "path",
      required: true,
      secret: false,
    },
  ],
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
    const { container } = render(
      <WorkspaceHubPanel
        detailOnly
        onOpenWorkspace={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Demo Harness/ }));

    expect(await screen.findByRole("heading", { name: harness.name })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建工作区" })).toBeTruthy();
    expect(screen.getAllByText("变量").length).toBeGreaterThan(0);
    expect((screen.getByText("模板文件").closest("details") as HTMLDetailsElement).open).toBe(false);
    const backButton = screen.getByRole("button", { name: "返回" });
    expect(backButton.closest(".cc-image-detail-top")).toBeTruthy();
    expect(container.querySelectorAll(".workspace-hub-harness-detail")).toHaveLength(1);
    expect(container.querySelector(".workspace-hub-detail-card")).toBeNull();
  });

  it("publishes harnesses and registered workspaces to the unified rail", async () => {
    const onRailGroupsChange = vi.fn();
    render(
      <WorkspaceHubPanel
        detailOnly
        onOpenWorkspace={vi.fn(async () => undefined)}
        onRailGroupsChange={onRailGroupsChange}
      />,
    );

    await waitFor(() => {
      const latest = onRailGroupsChange.mock.calls[onRailGroupsChange.mock.calls.length - 1]?.[0];
      expect(latest?.[0]?.items).toHaveLength(1);
      expect(latest?.[1]?.items).toHaveLength(1);
    });
    const groups = onRailGroupsChange.mock.calls[onRailGroupsChange.mock.calls.length - 1][0];
    expect(groups.map((group: { label: string }) => group.label)).toEqual([
      "Harness 模板",
      "已注册工作区",
    ]);
    expect(groups[0].items[0]).toMatchObject({ label: harness.name, meta: `v${harness.version}` });
    expect(groups[1].items[0]).toMatchObject({ label: workspace.name, statusLabel: "可选" });
  });

  it("browses for a target directory and opens the selected path", async () => {
    const onOpenWorkspace = vi.fn(async () => undefined);
    openDialog.mockResolvedValue("/Users/demo/Projects/Selected");

    render(
      <WorkspaceHubPanel
        detailOnly
        onOpenWorkspace={onOpenWorkspace}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Demo Harness/ }));
    const targetInput = await screen.findByRole("textbox", { name: "目标目录 *" });
    fireEvent.change(targetInput, { target: { value: "/Users/demo/Projects/Existing" } });
    fireEvent.click(screen.getByRole("button", { name: "浏览" }));

    await waitFor(() => {
      expect(openDialog).toHaveBeenCalledWith({
        title: "选择目标目录",
        multiple: false,
        directory: true,
      });
      expect((targetInput as HTMLInputElement).value).toBe("/Users/demo/Projects/Selected");
    });

    fireEvent.click(screen.getByRole("button", { name: "打开目标目录" }));
    await waitFor(() => {
      expect(onOpenWorkspace).toHaveBeenCalledWith("/Users/demo/Projects/Selected");
    });
  });
});
