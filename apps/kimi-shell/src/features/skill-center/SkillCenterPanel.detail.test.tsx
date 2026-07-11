// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
});
