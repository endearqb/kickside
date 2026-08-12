import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Eraser, FolderOpen, Plus, Sparkles } from "lucide-react";
import type {
  DiscoveredSkillDetail,
  DiscoveredSkillRecord,
  InstalledSkill,
  SessionSkillState,
  SkillApplyScope,
  SkillCenterFilter,
  SkillCenterSectionId,
  SkillDetail,
  SkillDiscoveryContainerKind,
  SkillDiscoveryLocation,
  SkillDiscoverySnapshot,
  SkillProjectionRecord,
  SkillRecommendation,
  WorkspaceSkillInventory,
  WorkspaceSkillProfile,
  WorkspaceSkillRestoreResult,
  WorkspaceSkillTarget,
} from "@/app/types";
import { ControlCenterEmptyState } from "@/components/control-center/ControlCenterEmptyState";
import { ControlCenterActionMenu } from "@/components/control-center/ControlCenterActionMenu";
import { ControlCenterSegmentedControl } from "@/components/control-center/ControlCenterSegmentedControl";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterWorkbenchLayout } from "@/components/control-center/ControlCenterWorkbenchLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UnifiedRailGroup } from "@/features/control-center/ControlCenterUnifiedRail";
import { DirectoryCardGrid, type DirectoryCardItem } from "@/features/directory/DirectoryCardGrid";
import { DirectoryFilePreview } from "@/features/directory/DirectoryFilePreview";
import {
  listDiscoveredSkillFileEntries,
  listSkillFileEntries,
  readDiscoveredSkillFile,
  readSkillFile,
} from "@/services/skillCenterService";

type ManageContextId = "skill_center" | "current_workspace" | "user_home" | `workspace:${string}`;
type SkillDirectoryPrimarySource = "all" | "bundled" | "workspace";
type SkillDirectorySourceFilter =
  | "all"
  | InstalledSkill["sourceType"]
  | "discovered";
type SkillDirectorySortKey = "name" | "source" | "updated" | "status";

type ManageListEntry =
  | {
      kind: "installed";
      key: string;
      installedSkill: InstalledSkill;
      matchedDiscovery: DiscoveredSkillRecord | null;
      matchedLocations: SkillDiscoveryLocation[];
    }
  | {
      kind: "discovered";
      key: string;
      discoveredRecord: DiscoveredSkillRecord;
      matchedLocations: SkillDiscoveryLocation[];
    };

type InstalledManageEntry = Extract<ManageListEntry, { kind: "installed" }>;
type DiscoveredManageEntry = Extract<ManageListEntry, { kind: "discovered" }>;

type SkillCenterPanelProps = {
  surface: "page";
  busy: boolean;
  actionError?: string | null;
  onRetryActionError?: () => void;
  section: SkillCenterSectionId;
  installedSkills: InstalledSkill[];
  selectedSkillId: string | null;
  selectedSkillDetail: SkillDetail | null;
  globalSkillProjections: SkillProjectionRecord[];
  activeSessionSkillState: SessionSkillState;
  workspaceSkillProfile: WorkspaceSkillProfile | null;
  workspaceRecentSkillIds: string[];
  workspaceSkillRecommendations: SkillRecommendation[];
  workspaceSkillRestoreResults: WorkspaceSkillRestoreResult[];
  skillDiscoverySnapshot: SkillDiscoverySnapshot | null;
  selectedDiscoveryId: string | null;
  selectedDiscoveryDetail: DiscoveredSkillDetail | null;
  workspaceSkillTargets: WorkspaceSkillTarget[];
  selectedWorkspaceSkillTargetId: string | null;
  workspaceSkillInventory: WorkspaceSkillInventory | null;
  selectedWorkspaceSkillContainerKind: SkillDiscoveryContainerKind;
  currentWorkspaceLabel?: string;
  onSelectSkill: (skillId: string) => void;
  onBackToDirectory?: () => void;
  onSelectDiscoveredSkill: (discoveryId: string) => void;
  onImportDiscoveredSkill: (discoveryId: string) => void;
  onSelectWorkspaceSkillTarget: (targetId: string) => void;
  onSelectWorkspaceSkillContainer: (containerKind: SkillDiscoveryContainerKind) => void;
  onOpenFolder: (path: string) => Promise<void>;
  onAddInstalledSkillToWorkspaceTarget: (
    skillId: string,
    targetId?: string | null,
    containerKind?: SkillDiscoveryContainerKind,
  ) => void;
  onSetTrust: (skillId: string, trusted: boolean) => void;
  onApplySkill: (skillId: string, scope: SkillApplyScope) => void;
  onRemoveSkill: (skillId: string, scope: SkillApplyScope) => void;
  onSetPin: (skillId: string, pinned: boolean) => void;
  onUpdateSkill: (skillId: string) => void;
  onUninstallSkill: (skillId: string) => void;
  onRecoverWorkspaceSkill: (skillId: string) => void;
  search: string;
  filter: SkillCenterFilter;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: SkillCenterFilter) => void;
  onSectionChange: (value: SkillCenterSectionId) => void;
  railActions?: ReactNode;
  detailOnly?: boolean;
  activeFocusId?: string | null;
  onRailGroupsChange?: (groups: UnifiedRailGroup[]) => void;
};

function statusForSkill(
  skillId: string,
  globalSkillProjections: SkillProjectionRecord[],
  activeSessionSkillState: SessionSkillState,
) {
  const userGlobalApplied = globalSkillProjections.some(
    (item) => item.skillId === skillId && item.scope === "user_global_kimi",
  );
  const kimiCodeHomeApplied = globalSkillProjections.some(
    (item) => item.skillId === skillId && item.scope === "kimi_code_home",
  );
  return {
    globalApplied: userGlobalApplied || kimiCodeHomeApplied,
    userGlobalApplied,
    kimiCodeHomeApplied,
    sessionApplied: activeSessionSkillState.appliedSkillIds.includes(skillId),
  };
}

function renderStatusChip(label: string, tone: "ready" | "muted" | "warning") {
  const mappedTone =
    tone === "ready" ? "success" : tone === "warning" ? "warning" : "neutral";
  return (
    <ControlCenterStatusBadge
      tone={mappedTone}
      className={`skill-center-chip skill-center-chip-${tone}`}
    >
      {label}
    </ControlCenterStatusBadge>
  );
}

function formatSkillSourceGroup(sourceType: InstalledSkill["sourceType"]) {
  if (sourceType === "bundled") return "Built-in skills";
  if (sourceType === "git") return "Git imports";
  if (sourceType === "discovered_import") return "Discovered imports";
  return "Local imports";
}

function formatSkillCardSource(skill: InstalledSkill) {
  if (skill.sourceType === "bundled") return "内置";
  if (skill.sourceType === "git") return "Git";
  if (skill.sourceType === "discovered_import") return "工作区发现";
  return "本地导入";
}

function formatSkillCardDate(value?: string | null) {
  if (!value) return "未记录";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatSkillUsageMetric(skill: InstalledSkill) {
  const applyCount = skill.usageStats?.applyCount ?? 0;
  if (applyCount > 0) {
    return `应用 ${applyCount} 次`;
  }
  return `更新 ${formatSkillCardDate(skill.updatedAt)}`;
}

export function matchesSkillDirectorySource(
  source: SkillDirectorySourceFilter,
  candidate: { kind: "installed"; sourceType: InstalledSkill["sourceType"] } | { kind: "discovered" },
) {
  if (source === "all") return true;
  if (candidate.kind === "discovered") return source === "discovered";
  return candidate.sourceType === source;
}

export function matchesSkillDirectoryPrimarySource(
  source: SkillDirectoryPrimarySource,
  candidate: { kind: "installed"; sourceType: InstalledSkill["sourceType"] } | { kind: "discovered" },
) {
  if (source === "all") return true;
  if (source === "bundled") {
    return candidate.kind === "installed" && candidate.sourceType === "bundled";
  }
  return candidate.kind === "discovered" || candidate.sourceType === "discovered_import";
}

export function getSkillDirectoryEmptyCopy(rawCount: number) {
  return rawCount === 0
    ? { title: "本分区为空", description: "刷新后仍为空时，这里还没有可显示对象。" }
    : { title: "没有匹配结果", description: "清空搜索或切换筛选条件。" };
}

export function shouldBackToSkillDirectory(key: string, hasDirectoryDetail: boolean) {
  return key === "Escape" && hasDirectoryDetail;
}

export function shouldShowSkillDirectory(
  detailOnly: boolean,
  section: SkillCenterSectionId,
  hasDirectoryDetail: boolean,
) {
  return detailOnly && section === "manage" && !hasDirectoryDetail;
}

function formatDiscoveryScope(scope: SkillDiscoveryLocation["scope"]) {
  return scope === "user_home" ? "主目录" : "工作区";
}

function formatDiscoveryContainer(kind: SkillDiscoveryContainerKind) {
  if (kind === "agents") return ".agents/skills";
  if (kind === "kimi_code") return ".kimi-code/skills";
  if (kind === "legacy_agents") return "~/.config/agents/skills legacy";
  if (kind === "codex") return ".codex/skills inventory";
  return ".claude/skills inventory";
}

function formatDiscoveryLocationLabel(location: SkillDiscoveryLocation) {
  const scope = formatDiscoveryScope(location.scope);
  const workspace = location.workspaceLabel?.trim();
  const container = formatDiscoveryContainer(location.containerKind);
  return workspace ? `${scope} · ${workspace} · ${container}` : `${scope} · ${container}`;
}

function normalizePathKey(value?: string | null) {
  return (value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function matchesKeyword(keyword: string, ...values: Array<string | undefined | null>) {
  if (!keyword) return true;
  return values.some((value) => value?.toLowerCase().includes(keyword));
}

function matchDiscoveryLocationsForTarget(
  record: DiscoveredSkillRecord,
  target: WorkspaceSkillTarget | null,
) {
  if (!target) return [];
  if (target.scope === "user_home") {
    return record.locations.filter((location) => location.scope === "user_home");
  }
  const targetKey = normalizePathKey(target.rootPath);
  return record.locations.filter(
    (location) =>
      location.scope === "workspace" &&
      normalizePathKey(location.workspaceId) === targetKey,
  );
}

function describeWorkspaceTarget(target: WorkspaceSkillTarget) {
  if (target.scope === "user_home") return "主目录";
  if (target.isCurrent) return "当前工作区";
  return "已知工作区";
}

export function SkillCenterPanel({
  surface,
  busy,
  actionError,
  onRetryActionError,
  section,
  installedSkills,
  selectedSkillId,
  selectedSkillDetail,
  globalSkillProjections,
  activeSessionSkillState,
  workspaceSkillProfile,
  skillDiscoverySnapshot,
  selectedDiscoveryId,
  selectedDiscoveryDetail,
  workspaceSkillTargets,
  selectedWorkspaceSkillTargetId,
  workspaceSkillInventory,
  selectedWorkspaceSkillContainerKind,
  onSelectSkill,
  onBackToDirectory,
  onSelectDiscoveredSkill,
  onImportDiscoveredSkill,
  onSelectWorkspaceSkillTarget,
  onSelectWorkspaceSkillContainer,
  onOpenFolder,
  onAddInstalledSkillToWorkspaceTarget,
  onSetTrust,
  onApplySkill,
  onRemoveSkill,
  onSetPin,
  onUpdateSkill,
  onUninstallSkill,
  search,
  filter,
  onSearchChange,
  onFilterChange,
  onSectionChange,
  railActions,
  detailOnly = false,
  onRailGroupsChange,
}: SkillCenterPanelProps) {
  const [manageContextId, setManageContextId] = useState<ManageContextId>("skill_center");
  const [directoryPrimarySource, setDirectoryPrimarySource] =
    useState<SkillDirectoryPrimarySource>("all");
  const [directorySource, setDirectorySource] = useState<SkillDirectorySourceFilter>("all");
  const [directorySort, setDirectorySort] = useState<SkillDirectorySortKey>("name");
  const actionErrorText = actionError?.trim() ?? "";

  const keyword = search.trim().toLowerCase();
  const currentWorkspaceTarget =
    workspaceSkillTargets.find((target) => target.isCurrent) ?? null;
  const homeWorkspaceTarget =
    workspaceSkillTargets.find((target) => target.scope === "user_home") ?? null;
  useEffect(() => {
    if (manageContextId === "skill_center") return;
    if (manageContextId === "current_workspace" && currentWorkspaceTarget) return;
    if (manageContextId === "user_home" && homeWorkspaceTarget) return;
    if (
      manageContextId.startsWith("workspace:") &&
      workspaceSkillTargets.some((target) => target.id === manageContextId)
    ) {
      return;
    }
    setManageContextId("skill_center");
  }, [currentWorkspaceTarget, homeWorkspaceTarget, manageContextId, workspaceSkillTargets]);

  function resetSkillDirectoryFilters() {
    onSearchChange("");
    onFilterChange("all");
    setDirectoryPrimarySource("all");
    setDirectorySource("all");
    setDirectorySort("name");
  }

  const filteredInstalledSkills = useMemo(() => {
    const pinnedSkillIds = new Set(workspaceSkillProfile?.pinnedSkillIds ?? []);
    return installedSkills.filter((skill) => {
      if (!matchesKeyword(keyword, skill.name, skill.description, skill.projectionName)) {
        return false;
      }
      const state = statusForSkill(skill.id, globalSkillProjections, activeSessionSkillState);
      if (filter === "session") return state.sessionApplied;
      if (filter === "global") return state.globalApplied;
      if (filter === "pinned") return pinnedSkillIds.has(skill.id);
      if (filter === "untrusted") return !skill.trusted;
      if (filter === "update_available") {
        return skill.updateStatus.kind === "update_available";
      }
      return true;
    });
  }, [
    activeSessionSkillState,
    filter,
    globalSkillProjections,
    installedSkills,
    keyword,
    workspaceSkillProfile?.pinnedSkillIds,
  ]);

  const manageTarget =
    manageContextId === "skill_center"
      ? null
      : manageContextId === "current_workspace"
        ? currentWorkspaceTarget
        : manageContextId === "user_home"
          ? homeWorkspaceTarget
          : workspaceSkillTargets.find((target) => target.id === manageContextId) ?? null;

  const contextDiscoveryEntries = useMemo(() => {
    if (manageContextId === "skill_center") {
      return (skillDiscoverySnapshot?.records ?? []).map((record) => ({
        record,
        matchedLocations: record.locations,
      }));
    }
    if (!manageTarget) return [];
    return (skillDiscoverySnapshot?.records ?? [])
      .map((record) => ({
        record,
        matchedLocations: matchDiscoveryLocationsForTarget(record, manageTarget),
      }))
      .filter((entry) => entry.matchedLocations.length > 0);
  }, [manageContextId, manageTarget, skillDiscoverySnapshot?.records]);

  const manageEntries = useMemo<ManageListEntry[]>(() => {
    const importedBySkillId = new Map<
      string,
      { record: DiscoveredSkillRecord; matchedLocations: SkillDiscoveryLocation[] }
    >();
    for (const entry of contextDiscoveryEntries) {
      if (entry.record.importedSkillId) {
        importedBySkillId.set(entry.record.importedSkillId, entry);
      }
    }

    const installedSource =
      manageContextId === "skill_center" ? filteredInstalledSkills : installedSkills;
    const installedEntries: ManageListEntry[] = installedSource
      .filter((skill) =>
        manageContextId === "skill_center"
          ? true
          : matchesKeyword(keyword, skill.name, skill.description, skill.projectionName),
      )
      .map((skill) => {
        const matched = importedBySkillId.get(skill.id) ?? null;
        return {
          kind: "installed",
          key: `installed:${skill.id}`,
          installedSkill: skill,
          matchedDiscovery: matched?.record ?? null,
          matchedLocations:
            matched?.matchedLocations ??
            (manageContextId === "skill_center" ? skill.discoveryLocations : []),
        };
      });

    const installedSkillIds = new Set(installedSkills.map((skill) => skill.id));
    const discoveredEntries: ManageListEntry[] = contextDiscoveryEntries
      .filter(({ record, matchedLocations }) => {
        if (manageContextId === "skill_center" && filter !== "all") {
          return false;
        }
        if (record.importedSkillId && installedSkillIds.has(record.importedSkillId)) {
          return false;
        }
        return matchesKeyword(
          keyword,
          record.name,
          record.description,
          record.projectionName,
          ...matchedLocations.map((location) => formatDiscoveryLocationLabel(location)),
        );
      })
      .map(({ record, matchedLocations }) => ({
        kind: "discovered",
        key: `discovered:${record.discoveryId}`,
        discoveredRecord: record,
        matchedLocations,
      }));

    return [...installedEntries, ...discoveredEntries];
  }, [
    contextDiscoveryEntries,
    filter,
    filteredInstalledSkills,
    installedSkills,
    keyword,
    manageContextId,
  ]);

  const selectedManageEntry = useMemo(() => {
    const discoveredEntry = manageEntries.find(
      (entry) =>
        entry.kind === "discovered" && entry.discoveredRecord.discoveryId === selectedDiscoveryId,
    );
    if (discoveredEntry) return discoveredEntry;

    const importedSelectedSkillId = selectedDiscoveryDetail?.record.importedSkillId ?? null;
    if (importedSelectedSkillId) {
      const importedEntry = manageEntries.find(
        (entry) =>
          entry.kind === "installed" && entry.installedSkill.id === importedSelectedSkillId,
      );
      if (importedEntry) return importedEntry;
    }

    return (
      manageEntries.find(
        (entry) => entry.kind === "installed" && entry.installedSkill.id === selectedSkillId,
      ) ?? null
    );
  }, [
    manageEntries,
    selectedDiscoveryDetail?.record.importedSkillId,
    selectedDiscoveryId,
    selectedSkillId,
  ]);

  const selectedInstalledSkill =
    selectedManageEntry?.kind === "installed"
      ? selectedSkillDetail?.skill ??
        installedSkills.find((item) => item.id === selectedManageEntry.installedSkill.id) ??
        selectedManageEntry.installedSkill
      : null;
  const selectedDiscoveredRecord =
    selectedManageEntry?.kind === "discovered"
      ? selectedDiscoveryDetail?.record?.discoveryId ===
        selectedManageEntry.discoveredRecord.discoveryId
        ? selectedDiscoveryDetail.record
        : selectedManageEntry.discoveredRecord
      : null;
  const selectedInstalledSkillId = selectedInstalledSkill?.id ?? "";
  const selectedDiscoveredSkillId = selectedDiscoveredRecord?.discoveryId ?? "";
  const loadSelectedInstalledFileEntries = useCallback(
    () =>
      selectedInstalledSkillId
        ? listSkillFileEntries(selectedInstalledSkillId)
        : Promise.resolve([]),
    [selectedInstalledSkillId],
  );
  const readSelectedInstalledFile = useCallback(
    (relPath: string) => {
      if (!selectedInstalledSkillId) {
        return Promise.reject(new Error("missing selected skill"));
      }
      return readSkillFile(selectedInstalledSkillId, relPath);
    },
    [selectedInstalledSkillId],
  );
  const loadSelectedDiscoveredFileEntries = useCallback(
    () =>
      selectedDiscoveredSkillId
        ? listDiscoveredSkillFileEntries(selectedDiscoveredSkillId)
        : Promise.resolve([]),
    [selectedDiscoveredSkillId],
  );
  const readSelectedDiscoveredFile = useCallback(
    (relPath: string) => {
      if (!selectedDiscoveredSkillId) {
        return Promise.reject(new Error("missing selected discovered skill"));
      }
      return readDiscoveredSkillFile(selectedDiscoveredSkillId, relPath);
    },
    [selectedDiscoveredSkillId],
  );

  const selectedWorkspaceTarget =
    workspaceSkillTargets.find((target) => target.id === selectedWorkspaceSkillTargetId) ?? null;
  const scannedWorkspaceTargets = workspaceSkillTargets.filter(
    (target) => target.scope === "workspace",
  );
  const selectedWorkspaceRootPath = selectedWorkspaceTarget?.rootPath.trim() ?? "";
  const selectedWorkspaceContainer =
    workspaceSkillInventory?.containers.find(
      (container) => container.containerKind === selectedWorkspaceSkillContainerKind,
    ) ??
    workspaceSkillInventory?.containers[0] ??
    null;

  const workspaceExistingSkills = useMemo(() => {
    if (!selectedWorkspaceContainer) return [];
    return selectedWorkspaceContainer.skills.filter((skill) =>
      matchesKeyword(keyword, skill.name, skill.description, skill.projectionName, skill.skillPath),
    );
  }, [keyword, selectedWorkspaceContainer]);

  const workspaceImportCandidates = useMemo(() => {
    const existingInstalledIds = new Set(
      (selectedWorkspaceContainer?.skills ?? [])
        .map((skill) => skill.matchedInstalledSkillId)
        .filter((value): value is string => Boolean(value)),
    );
    const existingProjectionNames = new Set(
      (selectedWorkspaceContainer?.skills ?? []).map((skill) => skill.projectionName.toLowerCase()),
    );
    return installedSkills.filter((skill) => {
      if (!skill.trusted) return false;
      if (!matchesKeyword(keyword, skill.name, skill.description, skill.projectionName)) {
        return false;
      }
      if (existingInstalledIds.has(skill.id)) return false;
      if (existingProjectionNames.has(skill.projectionName.toLowerCase())) return false;
      return true;
    });
  }, [installedSkills, keyword, selectedWorkspaceContainer?.skills]);

  const isSkillCenterManageContext = manageContextId === "skill_center";
  const installedManageEntries = manageEntries.filter(
    (entry): entry is InstalledManageEntry => entry.kind === "installed",
  );
  const discoveredManageEntries = manageEntries.filter(
    (entry): entry is DiscoveredManageEntry => entry.kind === "discovered",
  );
  const sourceGroupConfigs: Array<{ sourceType: InstalledSkill["sourceType"] }> = [
    { sourceType: "bundled" },
    { sourceType: "git" },
    { sourceType: "local_import" },
    { sourceType: "discovered_import" },
  ];
  const installedSourceGroups = sourceGroupConfigs
    .map(({ sourceType }) => ({
      sourceType,
      label: formatSkillSourceGroup(sourceType),
      entries: installedManageEntries.filter(
        (entry) => entry.installedSkill.sourceType === sourceType,
      ),
    }))
    .filter((group) => group.entries.length > 0);
  const workspaceTargetRows = workspaceSkillTargets
    .map((target) => ({
      target,
      contextId: (target.isCurrent
        ? "current_workspace"
        : target.scope === "user_home"
          ? "user_home"
          : target.id) as ManageContextId,
    }))
    .filter(({ target }) =>
      matchesKeyword(keyword, target.label, target.rootPath, describeWorkspaceTarget(target)),
    );

  const skillDirectoryCards = useMemo<DirectoryCardItem[]>(() => {
    const pinnedSkillIds = new Set(workspaceSkillProfile?.pinnedSkillIds ?? []);
    const rows = manageEntries
      .filter((entry) =>
        matchesSkillDirectoryPrimarySource(
          directoryPrimarySource,
          entry.kind === "installed"
            ? { kind: "installed", sourceType: entry.installedSkill.sourceType }
            : { kind: "discovered" },
        ) &&
        (entry.kind === "installed"
          ? matchesSkillDirectorySource(directorySource, {
              kind: "installed",
              sourceType: entry.installedSkill.sourceType,
            })
          : matchesSkillDirectorySource(directorySource, { kind: "discovered" })),
      )
      .map((entry) => {
        if (entry.kind === "installed") {
          const skill = entry.installedSkill;
          const state = statusForSkill(
            skill.id,
            globalSkillProjections,
            activeSessionSkillState,
          );
          const badges: DirectoryCardItem["badges"] = [
            {
              label: skill.trusted ? "已信任" : "未信任",
              tone: skill.trusted ? "success" : "warning",
            },
          ];
          if (skill.updateStatus.kind === "update_available") {
            badges.push({ label: "有更新", tone: "accent" });
          } else if (state.sessionApplied) {
            badges.push({ label: "会话已应用", tone: "accent" });
          } else if (state.globalApplied) {
            badges.push({ label: "全局已应用", tone: "neutral" });
          } else if (pinnedSkillIds.has(skill.id)) {
            badges.push({ label: "已置顶", tone: "neutral" });
          } else if (skill.hasScripts) {
            badges.push({ label: "包含 scripts", tone: "neutral" });
          }
          return {
            item: {
              id: `installed:${skill.id}`,
              title: `/${skill.projectionName}`,
              subtitle: skill.name,
              meta: `${formatSkillCardSource(skill)} · ${formatSkillUsageMetric(skill)}`,
              description: skill.description || "这个技能没有提供描述。",
              active:
                selectedManageEntry?.kind === "installed" &&
                selectedManageEntry.installedSkill.id === skill.id,
              badges: badges.slice(0, 2),
              cornerSlot: (
                <ControlCenterActionMenu
                  label={`${skill.name} 操作`}
                  disabled={busy}
                  items={[
                    { label: "查看详情", onSelect: () => onSelectSkill(skill.id) },
                    {
                      label: "投影到当前工作区",
                      description: !skill.trusted
                        ? "先信任技能"
                        : state.sessionApplied
                          ? "已应用"
                          : undefined,
                      disabled: !skill.trusted || state.sessionApplied,
                      onSelect: () => onApplySkill(skill.id, "session_kimi"),
                    },
                    ...(state.sessionApplied
                      ? [
                          {
                            label: "从当前工作区移除",
                            onSelect: () => onRemoveSkill(skill.id, "session_kimi"),
                          },
                        ]
                      : []),
                    ...(state.userGlobalApplied
                      ? [
                          {
                            label: "从 ~/.agents 移除",
                            onSelect: () => onRemoveSkill(skill.id, "user_global_kimi"),
                          },
                        ]
                      : []),
                    ...(state.kimiCodeHomeApplied
                      ? [
                          {
                            label: "从 KIMI_CODE_HOME 移除",
                            onSelect: () => onRemoveSkill(skill.id, "kimi_code_home"),
                          },
                        ]
                      : []),
                    {
                      label: pinnedSkillIds.has(skill.id) ? "取消置顶" : "置顶",
                      onSelect: () => onSetPin(skill.id, !pinnedSkillIds.has(skill.id)),
                    },
                    {
                      label: skill.trusted ? "取消信任" : "信任技能",
                      onSelect: () => onSetTrust(skill.id, !skill.trusted),
                    },
                    { label: "更新技能", onSelect: () => onUpdateSkill(skill.id) },
                    { label: "打开目录", onSelect: () => void onOpenFolder(skill.localPath) },
                    {
                      label: "卸载技能",
                      tone: "danger" as const,
                      onSelect: () => onUninstallSkill(skill.id),
                    },
                  ]}
                />
              ),
              onOpen: () => onSelectSkill(skill.id),
            },
            sortName: skill.projectionName,
            sortSource: skill.sourceType,
            sortUpdated: skill.updatedAt,
            sortStatus: `${skill.trusted ? "1" : "0"}-${state.sessionApplied ? "0" : "1"}`,
          };
        }

        const record = entry.discoveredRecord;
        return {
          item: {
            id: `discovered:${record.discoveryId}`,
            title: `/${record.projectionName}`,
            subtitle: record.name,
            meta: `待导入 · 扫描 ${formatSkillCardDate(record.lastScannedAt)}`,
            description: record.description || "这个外部 Skill 没有提供描述。",
            active:
              selectedManageEntry?.kind === "discovered" &&
              selectedManageEntry.discoveredRecord.discoveryId === record.discoveryId,
            badges: [
              { label: "待导入", tone: "warning" as const },
              ...(record.hasScripts
                ? [{ label: "包含 scripts", tone: "neutral" as const }]
                : []),
            ].slice(0, 2),
            cornerAction: record.importedSkillId
              ? undefined
              : {
                  label: "导入技能库",
                  icon: <Plus size={14} />,
                  onSelect: () => onImportDiscoveredSkill(record.discoveryId),
                },
            onOpen: () => onSelectDiscoveredSkill(record.discoveryId),
          },
          sortName: record.projectionName,
          sortSource: "discovered",
          sortUpdated: record.lastScannedAt,
          sortStatus: "0",
        };
      });

    rows.sort((left, right) => {
      if (directorySort === "source") return left.sortSource.localeCompare(right.sortSource);
      if (directorySort === "updated") return right.sortUpdated.localeCompare(left.sortUpdated);
      if (directorySort === "status") return left.sortStatus.localeCompare(right.sortStatus);
      return left.sortName.localeCompare(right.sortName);
    });
    return rows.map((row) => row.item);
  }, [
    activeSessionSkillState,
    directoryPrimarySource,
    directorySort,
    directorySource,
    globalSkillProjections,
    manageEntries,
    onImportDiscoveredSkill,
    onApplySkill,
    onOpenFolder,
    onRemoveSkill,
    onSelectDiscoveredSkill,
    onSelectSkill,
    onSetPin,
    onSetTrust,
    onUninstallSkill,
    onUpdateSkill,
    selectedManageEntry,
    workspaceSkillProfile?.pinnedSkillIds,
    busy,
  ]);

  const skillDirectoryEmptyCopy = getSkillDirectoryEmptyCopy(manageEntries.length);
  const hasDirectoryDetail = Boolean(selectedInstalledSkill || selectedDiscoveredRecord);
  const workspaceTargets = useMemo(
    () => workspaceSkillTargets.filter((target) => target.scope === "workspace"),
    [workspaceSkillTargets],
  );
  const railActionRefs = useRef({
    onSectionChange,
    onSelectDiscoveredSkill,
    onSelectSkill,
    onSelectWorkspaceSkillTarget,
  });
  railActionRefs.current = {
    onSectionChange,
    onSelectDiscoveredSkill,
    onSelectSkill,
    onSelectWorkspaceSkillTarget,
  };
  const railGroups = useMemo<UnifiedRailGroup[]>(
    () => [
      {
        id: "skill_center:views",
        label: "Skill 视图",
        items: [
          {
            id: "skill_center:list",
            label: "技能库",
            meta: manageEntries.length,
            active: section === "manage",
            onSelect: () => railActionRefs.current.onSectionChange("manage"),
          },
          {
            id: "skill_center:workspace",
            label: "工作区目标",
            meta: workspaceTargets.length,
            active: section === "workspace_insights",
            onSelect: () => railActionRefs.current.onSectionChange("workspace_insights"),
          },
        ],
      },
      {
        id: "skill_center:library",
        label: "技能库",
        count: manageEntries.length,
        collapsible: true,
        items: manageEntries.map((entry) => {
          if (entry.kind === "installed") {
            return {
              id: `skill:${entry.installedSkill.id}`,
              label: entry.installedSkill.name,
              statusLabel: entry.installedSkill.trusted ? "已信任" : "待配置",
              statusTone: entry.installedSkill.trusted
                ? ("success" as const)
                : ("warning" as const),
              active: section === "manage" && selectedSkillId === entry.installedSkill.id,
              onSelect: () => {
                railActionRefs.current.onSectionChange("manage");
                railActionRefs.current.onSelectSkill(entry.installedSkill.id);
              },
            };
          }
          return {
            id: `skill:${entry.discoveredRecord.discoveryId}`,
            label: entry.discoveredRecord.name,
            statusLabel: "待配置",
            statusTone: "warning" as const,
            active:
              section === "manage" &&
              selectedDiscoveryId === entry.discoveredRecord.discoveryId,
            onSelect: () => {
              railActionRefs.current.onSectionChange("manage");
              railActionRefs.current.onSelectDiscoveredSkill(entry.discoveredRecord.discoveryId);
            },
          };
        }),
      },
      {
        id: "skill_center:targets",
        label: "工作区目标",
        count: workspaceTargets.length,
        collapsible: true,
        items: workspaceTargets.map((target) => ({
          id: `skill-target:${target.id}`,
          label: target.label,
          meta: target.readOnly ? "只读" : "可编辑",
          active:
            section === "workspace_insights" && selectedWorkspaceSkillTargetId === target.id,
          onSelect: () => {
            railActionRefs.current.onSectionChange("workspace_insights");
            railActionRefs.current.onSelectWorkspaceSkillTarget(target.id);
          },
        })),
      },
    ],
    [
      manageEntries,
      section,
      selectedDiscoveryId,
      selectedSkillId,
      selectedWorkspaceSkillTargetId,
      workspaceTargets,
    ],
  );

  useEffect(() => {
    onRailGroupsChange?.(railGroups);
  }, [onRailGroupsChange, railGroups]);

  function renderManageEntry(entry: ManageListEntry) {
    const isSelected =
      entry.kind === "installed"
        ? selectedManageEntry?.kind === "installed" &&
          selectedManageEntry.installedSkill.id === entry.installedSkill.id
        : selectedManageEntry?.kind === "discovered" &&
          selectedManageEntry.discoveredRecord.discoveryId ===
            entry.discoveredRecord.discoveryId;

    if (entry.kind === "installed") {
      return (
        <button
          key={entry.key}
          type="button"
          className={`skill-center-list-item ${isSelected ? "active" : ""}`}
          onClick={() => onSelectSkill(entry.installedSkill.id)}
        >
          <div className="skill-center-list-header">
            <strong>{entry.installedSkill.name}</strong>
            <div className="skill-center-chip-row skill-center-chip-row-compact">
              {entry.installedSkill.trusted
                ? renderStatusChip("已信任", "ready")
                : renderStatusChip("未信任", "warning")}
            </div>
          </div>
        </button>
      );
    }

    return (
      <button
        key={entry.key}
        type="button"
        className={`skill-center-list-item ${isSelected ? "active" : ""}`}
        onClick={() => onSelectDiscoveredSkill(entry.discoveredRecord.discoveryId)}
      >
        <div className="skill-center-list-header">
          <strong>{entry.discoveredRecord.name}</strong>
          <div className="skill-center-chip-row skill-center-chip-row-compact">
            {renderStatusChip("待导入", "warning")}
          </div>
        </div>
      </button>
    );
  }

  return (
    <div
      className={`skill-center skill-center-${surface} ${detailOnly ? "skill-center-detail-only" : ""}`}
      onKeyDownCapture={(event) => {
        if (shouldBackToSkillDirectory(event.key, hasDirectoryDetail) && onBackToDirectory) {
          event.preventDefault();
          event.stopPropagation();
          onBackToDirectory();
        }
      }}
    >
      <div className="skill-center-content">
        {shouldShowSkillDirectory(detailOnly, section, hasDirectoryDetail) ? (
          <div className="skill-center-directory-surface">
            <ControlCenterSegmentedControl<SkillDirectoryPrimarySource>
              ariaLabel="Skill 来源"
              className="skill-center-directory-tabs skill-center-compact-tabs"
              value={directoryPrimarySource}
              onChange={(value) => {
                setDirectoryPrimarySource(value);
                setDirectorySource("all");
              }}
              items={[
                {
                  value: "all",
                  label: "全部",
                  description: manageEntries.length,
                },
                {
                  value: "bundled",
                  label: "内置",
                  description: installedSkills.filter((skill) => skill.sourceType === "bundled").length,
                },
                {
                  value: "workspace",
                  label: "工作区",
                  description: manageEntries.filter((entry) =>
                    matchesSkillDirectoryPrimarySource(
                      "workspace",
                      entry.kind === "installed"
                        ? { kind: "installed", sourceType: entry.installedSkill.sourceType }
                        : { kind: "discovered" },
                    ),
                  ).length,
                },
              ]}
            />
            <div className="directory-toolbar skill-center-directory-toolbar">
              <Input
                value={search}
                onChange={(event) => onSearchChange(event.currentTarget.value)}
                placeholder="搜索 Skill、描述、来源或路径"
                aria-label="搜索 Skill"
              />
              <details className="skill-center-directory-filters">
                <summary>筛选与排序</summary>
                <div className="skill-center-directory-filter-popover">
                  <label>
                    <span>来源</span>
                    <select
                      value={directorySource}
                      onChange={(event) => {
                        const nextSource = event.currentTarget.value as SkillDirectorySourceFilter;
                        setDirectorySource(nextSource);
                        if (nextSource !== "all") setDirectoryPrimarySource("all");
                      }}
                    >
                      <option value="all">全部来源</option>
                      <option value="git">Git</option>
                      <option value="local_import">本地导入</option>
                    </select>
                  </label>
                  <label>
                    <span>状态</span>
                    <select
                      value={filter}
                      onChange={(event) =>
                        onFilterChange(event.currentTarget.value as SkillCenterFilter)
                      }
                    >
                      <option value="all">全部状态</option>
                      <option value="session">会话已应用</option>
                      <option value="global">全局已应用</option>
                      <option value="pinned">已置顶</option>
                      <option value="untrusted">未信任</option>
                      <option value="update_available">有更新</option>
                    </select>
                  </label>
                  <label>
                    <span>排序</span>
                    <select
                      value={directorySort}
                      onChange={(event) =>
                        setDirectorySort(event.currentTarget.value as SkillDirectorySortKey)
                      }
                    >
                      <option value="name">名称 A-Z</option>
                      <option value="updated">最近更新</option>
                      <option value="source">来源</option>
                      <option value="status">状态</option>
                    </select>
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    icon={<Eraser size={14} />}
                    onClick={resetSkillDirectoryFilters}
                    disabled={
                      !search &&
                      filter === "all" &&
                      directoryPrimarySource === "all" &&
                      directorySource === "all" &&
                      directorySort === "name"
                    }
                  >
                    清空筛选
                  </Button>
                </div>
              </details>
            </div>
            {actionErrorText ? (
              <div className="skill-center-action-error" role="alert">
                <span>操作失败：{actionErrorText}</span>
                {onRetryActionError ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onRetryActionError}
                    disabled={busy}
                  >
                    重试
                  </Button>
                ) : null}
              </div>
            ) : null}
            <DirectoryCardGrid
              className="skill-center-directory-grid"
              items={skillDirectoryCards}
              loading={busy && skillDirectoryCards.length === 0}
              empty={
                <ControlCenterEmptyState
                  className="skill-center-empty"
                  title={skillDirectoryEmptyCopy.title}
                  description={skillDirectoryEmptyCopy.description}
                  icon={<Sparkles size={16} />}
                />
              }
            />
          </div>
        ) : null}
        {section === "manage" && (!detailOnly || hasDirectoryDetail) ? (
          <ControlCenterWorkbenchLayout
            mode="stack-on-mobile"
            railBodyClassName="skill-center-list"
            detailBodyClassName="skill-center-detail-body"
            railHeader={
              <div className="skill-center-toolbar">
                <div className="skill-center-rail-title-row">
                  <h4>Skill 中心</h4>
                  {railActions}
                </div>
                <Input
                  className="skill-center-header-search"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="搜索 skill..."
                />
              </div>
            }
            rail={
              <>
                <button
                  type="button"
                  className="skill-center-list-item"
                  onClick={() => onSectionChange("workspace_insights")}
                  disabled={busy}
                >
                  <div className="skill-center-list-header">
                    <strong>工作区洞察</strong>
                    <span className="cc-rail-count">{workspaceSkillTargets.length}</span>
                  </div>
                </button>
                {manageEntries.length === 0 && workspaceTargetRows.length === 0 ? (
                  <ControlCenterEmptyState
                    className="skill-center-empty"
                    title="还没有匹配结果"
                    description={
                      isSkillCenterManageContext
                        ? "当前筛选条件下还没有匹配的技能。"
                        : "当前范围里还没有匹配的 Skill 或外部发现。"
                    }
                    icon={<Sparkles size={16} />}
                  />
                ) : null}
                {installedSourceGroups.map((group) => (
                  <div key={group.sourceType} className="skill-center-rail-group">
                    <div className="skill-center-rail-group-header">
                      <span>{group.label}</span>
                      <small>{group.entries.length}</small>
                    </div>
                    <div className="skill-center-rail-group-list">
                      {group.entries.map((entry) => renderManageEntry(entry))}
                    </div>
                  </div>
                ))}
                {discoveredManageEntries.length > 0 ? (
                  <div className="skill-center-rail-group">
                    <div className="skill-center-rail-group-header">
                      <span>Discoverable locations</span>
                      <small>{discoveredManageEntries.length}</small>
                    </div>
                    <div className="skill-center-rail-group-list">
                      {discoveredManageEntries.map((entry) => renderManageEntry(entry))}
                    </div>
                  </div>
                ) : null}
                {workspaceTargetRows.length > 0 ? (
                  <div className="skill-center-rail-group skill-center-rail-group-targets">
                    <div className="skill-center-rail-group-header">
                      <span>Workspace targets</span>
                      <small>{workspaceTargetRows.length}</small>
                    </div>
                    <div className="skill-center-rail-group-list">
                      {workspaceTargetRows.map(({ target, contextId }) => (
                        <button
                          key={target.id}
                          type="button"
                          className={`skill-center-list-item skill-center-target-item ${
                            manageContextId === contextId ? "active" : ""
                          }`}
                          onClick={() => {
                            setManageContextId(contextId);
                            onSelectWorkspaceSkillTarget(target.id);
                          }}
                        >
                          <div className="skill-center-list-header">
                            <strong>{target.label}</strong>
                            <div className="skill-center-chip-row skill-center-chip-row-compact">
                              {target.readOnly
                                ? renderStatusChip("只读", "warning")
                                : renderStatusChip("可编辑", "ready")}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            }
            detail={
              selectedInstalledSkill ? (
                <>
                  {selectedInstalledSkill.hasScripts ? (
                    <div className="skill-center-script-warning" role="alert">
                      {selectedInstalledSkill.trusted
                        ? "包含 scripts/，更新或重新信任前请复核脚本内容。"
                        : "包含 scripts/，信任前不能投影；请先检查脚本内容。"}
                    </div>
                  ) : null}

                  <DirectoryFilePreview
                    entityKey={`installed:${selectedInstalledSkill.id}`}
                    description={selectedInstalledSkill.description || "这个技能没有提供描述。"}
                    loadEntries={loadSelectedInstalledFileEntries}
                    readFile={readSelectedInstalledFile}
                    onOpenRoot={() => onOpenFolder(selectedInstalledSkill.localPath)}
                    showDescription={false}
                    className="skill-center-file-preview"
                  />
                </>
              ) : selectedDiscoveredRecord ? (
                <>
                  <DirectoryFilePreview
                    entityKey={`discovered:${selectedDiscoveredRecord.discoveryId}`}
                    description={selectedDiscoveredRecord.description || "这个外部 Skill 没有提供描述。"}
                    loadEntries={loadSelectedDiscoveredFileEntries}
                    readFile={readSelectedDiscoveredFile}
                    onOpenRoot={() => onOpenFolder(selectedDiscoveredRecord.canonicalPath)}
                    showDescription={false}
                    className="skill-center-file-preview"
                  />
                </>
              ) : null
            }
            emptyDetail={
              <ControlCenterEmptyState
                className="skill-center-empty skill-center-empty-detail"
                title="选择左侧条目开始查看"
                description={
                  manageContextId === "skill_center"
                    ? "选择一个已安装技能，查看详情和应用状态。"
                    : "选择一个技能或外部发现，查看导入、来源和应用状态。"
                }
                icon={<Sparkles size={18} />}
              />
            }
          />
        ) : (
          <ControlCenterWorkbenchLayout
            mode="stack-on-mobile"
            railBodyClassName="skill-center-list"
            detailBodyClassName="skill-center-detail-body"
            railHeader={
              <div className="skill-center-toolbar">
                <div className="skill-center-rail-title-row">
                  <h4>工作区洞察</h4>
                  {railActions}
                </div>
                <Input
                  className="skill-center-header-search"
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                  placeholder="搜索工作区 Skill 或受管 Skill"
                />
              </div>
            }
            rail={
              <>
                <button
                  type="button"
                  className="skill-center-list-item"
                  onClick={() => onSectionChange("manage")}
                  disabled={busy}
                >
                  <div className="skill-center-list-header">
                    <strong>技能管理</strong>
                    <span className="cc-rail-count">{installedSkills.length}</span>
                  </div>
                </button>
                {workspaceSkillTargets.length === 0 ? (
                  <ControlCenterEmptyState
                    className="skill-center-empty"
                    title="还没有可管理的工作区目标"
                    description="等工作区扫描结果建立后，这里会显示可管理的目标目录。"
                    icon={<Sparkles size={16} />}
                  />
                ) : null}
                {workspaceSkillTargets.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    className={`skill-center-list-item ${selectedWorkspaceSkillTargetId === target.id ? "active" : ""}`}
                    onClick={() => onSelectWorkspaceSkillTarget(target.id)}
                  >
                    <div className="skill-center-list-header">
                      <strong>{target.label}</strong>
                      <div className="skill-center-chip-row skill-center-chip-row-compact">
                        {target.readOnly
                          ? renderStatusChip("只读", "warning")
                          : renderStatusChip("可编辑", "ready")}
                      </div>
                    </div>
                    <p className="skill-center-list-description">{describeWorkspaceTarget(target)}</p>
                    <code className="skill-center-list-projection">{target.rootPath}</code>
                  </button>
                ))}
              </>
            }
            detail={
              selectedWorkspaceTarget ? (
                <div className="skill-center-workspace-shell">
                  <div className="skill-center-detail-header">
                    <div className="skill-center-detail-title">
                      <h3>{selectedWorkspaceTarget.label}</h3>
                      <p className="skill-center-detail-description">{selectedWorkspaceTarget.rootPath}</p>
                    </div>
                    <div className="skill-center-chip-row skill-center-chip-row-detail">
                      {selectedWorkspaceTarget.readOnly
                        ? renderStatusChip("主目录只读", "warning")
                        : renderStatusChip("工作区可编辑", "ready")}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        icon={<FolderOpen size={14} />}
                        className="cc-inline-icon-btn skill-center-open-folder-btn"
                        onClick={() => void onOpenFolder(selectedWorkspaceRootPath)}
                        disabled={!selectedWorkspaceRootPath || busy}
                        aria-label="在资源管理器中打开工作区"
                        title="在资源管理器中打开工作区"
                      />
                      <ControlCenterActionMenu
                        label="查看工作区"
                        triggerContent="查看工作区"
                        triggerIcon={<ChevronDown size={14} />}
                        className="skill-center-workspace-picker"
                        disabled={busy}
                        items={scannedWorkspaceTargets.map((target) => ({
                          label: target.label,
                          description:
                            target.id === selectedWorkspaceSkillTargetId
                              ? `当前 · ${target.rootPath}`
                              : target.rootPath,
                          onSelect: () => onSelectWorkspaceSkillTarget(target.id),
                        }))}
                      />
                    </div>
                  </div>

                  <ControlCenterSegmentedControl
                    ariaLabel="工作区 Skill 容器"
                    className="skill-center-container-switch skill-center-compact-tabs"
                    value={selectedWorkspaceSkillContainerKind}
                    onChange={(containerKind) => onSelectWorkspaceSkillContainer(containerKind)}
                    disabled={busy}
                    items={(
                      workspaceSkillInventory?.containers.map((container) => ({
                        containerKind: container.containerKind,
                        count: container.skills.length,
                      })) ??
                      selectedWorkspaceTarget.containerRoots.map((root) => ({
                        containerKind: root.containerKind,
                        count: 0,
                      }))
                    ).map(({ containerKind, count }) => ({
                      value: containerKind,
                      label: formatDiscoveryContainer(containerKind),
                      description: `${count}`,
                    }))}
                  />

                  <div className="skill-center-workspace-grid">
                    <section className="skill-center-workspace-section">
                      <div className="skill-center-section-header">
                        <h4>已有 Skill</h4>
                        <span>{workspaceExistingSkills.length}</span>
                      </div>
                      {!selectedWorkspaceContainer ? (
                        <p className="skill-center-muted">当前容器没有扫描结果。</p>
                      ) : workspaceExistingSkills.length === 0 ? (
                        <p className="skill-center-muted">这个容器里还没有匹配的 Skill。</p>
                      ) : (
                        <div className="skill-center-workspace-list">
                          {workspaceExistingSkills.map((skill) => (
                            <div key={skill.skillPath} className="skill-center-workspace-item">
                              <div className="skill-center-workspace-copy">
                                <div className="skill-center-workspace-item-head">
                                  <strong className="skill-center-item-name" title={skill.name}>
                                    {skill.name}
                                  </strong>
                                  <div className="skill-center-chip-row skill-center-chip-row-compact">
                                    {skill.matchedInstalledSkillId
                                      ? renderStatusChip("已关联", "ready")
                                      : renderStatusChip("目录内 Skill", "muted")}
                                  </div>
                                </div>
                                <p className="skill-center-list-description">
                                  {skill.description || "这个工作区 Skill 没有提供描述。"}
                                </p>
                                <code className="skill-center-list-projection">{skill.skillPath}</code>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="skill-center-workspace-section">
                      <div className="skill-center-section-header">
                        <h4>从受管 Skill 投影</h4>
                        <span>{workspaceImportCandidates.length}</span>
                      </div>
                      {selectedWorkspaceTarget.readOnly ? (
                        <p className="skill-center-muted">主目录只读，不提供导入操作。</p>
                      ) : workspaceImportCandidates.length === 0 ? (
                        <p className="skill-center-muted">没有可导入的技能，或者这些技能已经存在于当前容器。</p>
                      ) : (
                        <div className="skill-center-workspace-list">
                          {workspaceImportCandidates.map((skill) => (
                            <div key={skill.id} className="skill-center-workspace-item">
                              <div className="skill-center-workspace-copy">
                                <div className="skill-center-workspace-item-head">
                                  <strong className="skill-center-item-name" title={skill.name}>
                                    {skill.name}
                                  </strong>
                                  <div className="skill-center-chip-row skill-center-chip-row-compact">
                                    {skill.trusted
                                      ? renderStatusChip("已信任", "ready")
                                      : renderStatusChip("未信任", "warning")}
                                  </div>
                                </div>
                                <p className="skill-center-list-description">
                                  {skill.description || "这个技能没有提供描述。"}
                                </p>
                                <code className="skill-center-list-projection">{skill.projectionName}</code>
                              </div>
                              <div className="skill-center-workspace-actions">
                                <Button
                                  type="button"
                                  onClick={() =>
                                    onAddInstalledSkillToWorkspaceTarget(
                                      skill.id,
                                      selectedWorkspaceTarget.id,
                                      selectedWorkspaceSkillContainerKind,
                                    )
                                  }
                                  disabled={busy}
                                >
                                  导入
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              ) : null
            }
            emptyDetail={
              <ControlCenterEmptyState
                className="skill-center-empty skill-center-empty-detail"
                title="选择一个工作区目标"
                description="从左侧选择目标目录，管理目录中的 Skill。"
                icon={<Sparkles size={18} />}
              />
            }
          />
        )}
      </div>
    </div>
  );
}
