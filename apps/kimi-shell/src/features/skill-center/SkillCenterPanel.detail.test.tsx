// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { DiscoveredSkillRecord, InstalledSkill } from "@/app/types";
import { SkillCenterPanel } from "./SkillCenterPanel";

vi.mock("@/services/skillCenterService", () => ({
  listSkillFileEntries: vi.fn(async () => [{ relPath: "SKILL.md", isDir: false }]),
  readSkillFile: vi.fn(async (relPath: string) => ({
    relPath,
    size: 7,
    isBinary: false,
    truncated: false,
    text: "# Skill",
  })),
  listDiscoveredSkillFileEntries: vi.fn(async () => [{ relPath: "SKILL.md", isDir: false }]),
  readDiscoveredSkillFile: vi.fn(async (relPath: string) => ({
    relPath,
    size: 7,
    isBinary: false,
    truncated: false,
    text: "# Skill",
  })),
}));

const removedDetailTitles = [
  "当前工作区最近使用",
  "推荐理由",
  "最近恢复结果",
  "已应用目录",
  "外部发现位置",
  "发现位置",
];

const installedSkill: InstalledSkill = {
  id: "skill-1",
  name: "Installed Skill",
  description: "Installed description",
  sourceType: "bundled",
  sourceLabel: "Bundled",
  sourceKey: "bundled:skill-1",
  localPath: "C:/skills/installed",
  projectionName: "installed-skill",
  trusted: true,
  installedAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
  hasScripts: false,
  metadata: {
    triggers: [],
    tags: [],
    filePatterns: [],
    workspacePatterns: [],
    languages: [],
    recommendedScopes: [],
  },
  updateStatus: { kind: "up_to_date" },
  discoveryLocations: [
    {
      scope: "workspace",
      containerKind: "agents",
      containerPath: "C:/workspace/.agents/skills",
      skillPath: "C:/workspace/.agents/skills/installed-skill",
      workspaceId: "C:/workspace",
    },
  ],
};

const discoveredSkill: DiscoveredSkillRecord = {
  discoveryId: "discovered-1",
  name: "Discovered Skill",
  description: "Discovered description",
  canonicalPath: "C:/workspace/.agents/skills/discovered-skill",
  projectionName: "discovered-skill",
  hasScripts: true,
  lastScannedAt: "2026-07-11T00:00:00.000Z",
  locations: [
    {
      scope: "workspace",
      containerKind: "agents",
      containerPath: "C:/workspace/.agents/skills",
      skillPath: "C:/workspace/.agents/skills/discovered-skill",
      workspaceId: "C:/workspace",
    },
  ],
};

function baseProps(): ComponentProps<typeof SkillCenterPanel> {
  return {
    surface: "page",
    busy: false,
    section: "manage",
    installedSkills: [],
    selectedSkillId: null,
    selectedSkillDetail: null,
    globalSkillProjections: [],
    activeSessionSkillState: { appliedSkillIds: [], projections: [] },
    workspaceSkillProfile: null,
    workspaceRecentSkillIds: [],
    workspaceSkillRecommendations: [],
    workspaceSkillRestoreResults: [],
    skillDiscoverySnapshot: { scannedAt: "", workspaces: [], records: [] },
    selectedDiscoveryId: null,
    selectedDiscoveryDetail: null,
    workspaceSkillTargets: [],
    selectedWorkspaceSkillTargetId: null,
    workspaceSkillInventory: null,
    selectedWorkspaceSkillContainerKind: "agents",
    onSelectSkill: vi.fn(),
    onBackToDirectory: vi.fn(),
    onSelectDiscoveredSkill: vi.fn(),
    onImportDiscoveredSkill: vi.fn(),
    onSelectWorkspaceSkillTarget: vi.fn(),
    onSelectWorkspaceSkillContainer: vi.fn(),
    onOpenFolder: vi.fn(async () => undefined),
    onAddInstalledSkillToWorkspaceTarget: vi.fn(),
    onSetTrust: vi.fn(),
    onApplySkill: vi.fn(),
    onRemoveSkill: vi.fn(),
    onSetPin: vi.fn(),
    onUpdateSkill: vi.fn(),
    onUninstallSkill: vi.fn(),
    onRecoverWorkspaceSkill: vi.fn(),
    search: "",
    filter: "all",
    onSearchChange: vi.fn(),
    onFilterChange: vi.fn(),
    onSectionChange: vi.fn(),
    railActions: null,
  };
}

describe("SkillCenterPanel detail", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows only file preview content for installed skill detail", async () => {
    const { container } = render(
      <SkillCenterPanel
        {...baseProps()}
        installedSkills={[installedSkill]}
        selectedSkillId={installedSkill.id}
        selectedSkillDetail={{ skill: installedSkill, relativePaths: [], userGlobalApplied: false, currentSessionApplied: false }}
      />,
    );

    expect(await screen.findByRole("treeitem", { name: /SKILL.md/ })).toBeTruthy();
    expect(container.querySelector(".skill-center-detail-header")).toBeNull();
    for (const title of removedDetailTitles) {
      expect(screen.queryByText(title)).toBeNull();
    }
  });

  it("shows only file preview content for discovered skill detail", async () => {
    const { container } = render(
      <SkillCenterPanel
        {...baseProps()}
        skillDiscoverySnapshot={{ scannedAt: "", workspaces: [], records: [discoveredSkill] }}
        selectedDiscoveryId={discoveredSkill.discoveryId}
        selectedDiscoveryDetail={{ record: discoveredSkill, relativePaths: [] }}
      />,
    );

    expect(await screen.findByRole("treeitem", { name: /SKILL.md/ })).toBeTruthy();
    expect(container.querySelector(".skill-center-detail-header")).toBeNull();
    for (const title of removedDetailTitles) {
      expect(screen.queryByText(title)).toBeNull();
    }
  });

  it("switches between scanned workspaces without listing the user home target", () => {
    const onSelectWorkspaceSkillTarget = vi.fn();
    const { container } = render(
      <SkillCenterPanel
        {...baseProps()}
        section="workspace_insights"
        installedSkills={[installedSkill]}
        selectedWorkspaceSkillTargetId="workspace-a"
        onSelectWorkspaceSkillTarget={onSelectWorkspaceSkillTarget}
        workspaceSkillTargets={[
          {
            id: "home",
            scope: "user_home",
            label: "主目录",
            rootPath: "C:/Users/demo",
            readOnly: true,
            isCurrent: false,
            containerRoots: [],
          },
          {
            id: "workspace-a",
            scope: "workspace",
            label: "Workspace A",
            rootPath: "C:/workspace-a",
            readOnly: false,
            isCurrent: true,
            containerRoots: [{ containerKind: "agents", containerPath: "C:/workspace-a/.agents/skills" }],
          },
          {
            id: "workspace-b",
            scope: "workspace",
            label: "Workspace B",
            rootPath: "C:/workspace-b",
            readOnly: false,
            isCurrent: false,
            containerRoots: [{ containerKind: "kimi_code", containerPath: "C:/workspace-b/.kimi-code/skills" }],
          },
        ]}
        workspaceSkillInventory={{
          target: {
            id: "workspace-a",
            scope: "workspace",
            label: "Workspace A",
            rootPath: "C:/workspace-a",
            readOnly: false,
            isCurrent: true,
            containerRoots: [{ containerKind: "agents", containerPath: "C:/workspace-a/.agents/skills" }],
          },
          scannedAt: "2026-07-13T00:00:00.000Z",
          containers: [{
            containerKind: "agents",
            containerPath: "C:/workspace-a/.agents/skills",
            readOnly: false,
            skills: [{
              skillKey: "workspace-skill",
              name: "Workspace Skill",
              description: "Workspace description",
              projectionName: "workspace-skill",
              hasScripts: false,
              skillPath: "C:/workspace-a/.agents/skills/workspace-skill",
              containerKind: "agents",
            }],
          }],
        }}
      />,
    );

    const workspaceLists = screen.getAllByRole("list");
    expect(workspaceLists).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelectorAll(".skill-center-workspace-list")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "查看工作区" }));
    const workspaceMenu = screen.getByRole("menu", { name: "查看工作区" });
    expect(within(workspaceMenu).queryByText("主目录")).toBeNull();
    expect(within(workspaceMenu).getByText("当前 · C:/workspace-a")).toBeTruthy();
    fireEvent.click(within(workspaceMenu).getByRole("menuitem", { name: /Workspace B/ }));
    expect(onSelectWorkspaceSkillTarget).toHaveBeenCalledWith("workspace-b");
    expect(container.querySelector(".skill-center-container-switch.skill-center-compact-tabs")).toBeTruthy();
  });

  it("publishes skill library and workspace targets to the unified rail", async () => {
    const onRailGroupsChange = vi.fn();
    const onSectionChange = vi.fn();
    const onSelectSkill = vi.fn();
    const onBackToDirectory = vi.fn();
    render(
      <SkillCenterPanel
        {...baseProps()}
        installedSkills={[installedSkill]}
        skillDiscoverySnapshot={{ scannedAt: "", workspaces: [], records: [discoveredSkill] }}
        workspaceSkillTargets={[
          {
            id: "workspace-a",
            scope: "workspace",
            label: "Workspace A",
            rootPath: "C:/workspace-a",
            readOnly: false,
            isCurrent: true,
            containerRoots: [],
          },
        ]}
        onSectionChange={onSectionChange}
        onSelectSkill={onSelectSkill}
        onBackToDirectory={onBackToDirectory}
        onRailGroupsChange={onRailGroupsChange}
      />,
    );

    await waitFor(() => expect(onRailGroupsChange).toHaveBeenCalled());
    const groups = onRailGroupsChange.mock.calls[onRailGroupsChange.mock.calls.length - 1][0];
    expect(groups.map((group: { label: string }) => group.label)).toEqual([
      "Skill 视图",
      "技能库",
      "工作区目标",
    ]);
    expect(groups[1].items.map((item: { label: string }) => item.label)).toEqual([
      installedSkill.name,
      discoveredSkill.name,
    ]);
    expect(groups[2].items[0]).toMatchObject({ label: "Workspace A", meta: "可编辑" });
    groups[0].items[0].onSelect();
    expect(onSectionChange).toHaveBeenCalledWith("manage");
    expect(onBackToDirectory).toHaveBeenCalledOnce();
    groups[1].items[0].onSelect();
    expect(onSectionChange).toHaveBeenCalledWith("manage");
    expect(onSelectSkill).toHaveBeenCalledWith(installedSkill.id);
  });

  it("shows skills when the initial directory load completes without a section change", () => {
    const props = baseProps();
    const { container, rerender } = render(
      <SkillCenterPanel {...props} busy detailOnly />,
    );

    const panel = container.querySelector(".skill-center");
    expect(panel?.classList.contains("skill-center-surface-page")).toBe(true);
    expect(panel?.classList.contains("skill-center-page")).toBe(false);
    expect(container.querySelector('[aria-label="正在加载目录"]')).toBeTruthy();

    rerender(
      <SkillCenterPanel
        {...props}
        busy={false}
        detailOnly
        installedSkills={[installedSkill]}
      />,
    );

    expect(screen.getByRole("button", { name: /installed-skill/i })).toBeTruthy();
    expect(container.querySelector(".skill-center-directory-grid")).toBeTruthy();
    expect(container.querySelector(".skill-center-workspace-shell")).toBeNull();
    expect(screen.queryByText("选择一个工作区目标")).toBeNull();
    expect(props.onSectionChange).not.toHaveBeenCalled();
  });

  it("dismisses directory filters on outside pointer and Escape", () => {
    render(<SkillCenterPanel {...baseProps()} detailOnly />);

    const summary = screen.getByText("筛选与排序");
    const details = summary.closest("details") as HTMLDetailsElement;

    fireEvent.click(summary);
    expect(details.open).toBe(true);
    fireEvent.pointerDown(document.body);
    expect(details.open).toBe(false);

    fireEvent.click(summary);
    expect(details.open).toBe(true);
    const leakedEscape = vi.fn();
    window.addEventListener("keydown", leakedEscape);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    expect(leakedEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", leakedEscape);
  });
});
