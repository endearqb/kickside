import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, FolderOpen, Shield, ShieldOff, Sparkles } from "lucide-react";
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
import { ControlCenterSegmentedControl } from "@/components/control-center/ControlCenterSegmentedControl";
import { ControlCenterStatusBadge } from "@/components/control-center/ControlCenterStatusBadge";
import { ControlCenterSurfaceSection } from "@/components/control-center/ControlCenterSurfaceSection";
import { ControlCenterWorkbenchLayout } from "@/components/control-center/ControlCenterWorkbenchLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ManageContextId = "skill_center" | "current_workspace" | "user_home" | `workspace:${string}`;
type SkillDisplaySource = "bundled" | "user" | "harness" | "hub";

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

type SkillCenterPanelProps = {
  surface: "page";
  busy: boolean;
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
  onOpenSkillFromInsights: (skillId: string) => void;
  onSelectDiscoveredSkill: (discoveryId: string) => void;
  onScanDiscoveredSkills: () => void;
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

function projectionForSkill(
  skillId: string,
  projections: SkillProjectionRecord[],
  scope?: SkillApplyScope,
) {
  return (
    projections.find(
      (item) => item.skillId === skillId && (scope ? item.scope === scope : true),
    ) ?? null
  );
}

function formatProjectionScope(scope: SkillApplyScope) {
  if (scope === "user_global_kimi") return "用户全局 ~/.agents";
  if (scope === "kimi_code_home") return "KIMI_CODE_HOME";
  return "当前工作区";
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

function formatSkillSource(skill: InstalledSkill) {
  if (skill.sourceType === "git") {
    return skill.repoUrl || skill.sourceLabel || "Git";
  }
  if (skill.sourceType === "bundled") {
    return "内置 Skill";
  }
  if (skill.sourceType === "discovered_import") {
    return skill.sourcePath || skill.sourceLabel || "外部发现导入";
  }
  return skill.sourcePath || skill.sourceLabel || "本地导入";
}

function getSkillDisplaySource(skill: InstalledSkill): SkillDisplaySource {
  const sourceText = `${skill.sourceLabel ?? ""} ${skill.sourcePath ?? ""}`.toLowerCase();
  if (skill.sourceType === "bundled") return "bundled";
  if (sourceText.includes("harness")) return "harness";
  return "user";
}

function formatSkillDisplaySource(source: SkillDisplaySource) {
  if (source === "bundled") return "bundled";
  if (source === "harness") return "harness";
  if (source === "hub") return "hub";
  return "user";
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

function renderCollapsibleSection(
  title: string,
  expanded: boolean,
  onToggle: () => void,
  content: ReactNode,
) {
  return (
    <ControlCenterSurfaceSection
      className={`skill-center-collapsible ${expanded ? "is-open" : ""}`}
      title={
        <button
          type="button"
          className="skill-center-section-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <div className="skill-center-section-toggle-copy">
            <h4>{title}</h4>
          </div>
          <ChevronRight
            size={16}
            className={`skill-center-section-toggle-icon ${expanded ? "is-open" : ""}`}
          />
        </button>
      }
    >
      {expanded ? <div className="skill-center-section-body">{content}</div> : null}
    </ControlCenterSurfaceSection>
  );
}

export function SkillCenterPanel({
  surface,
  busy,
  section,
  installedSkills,
  selectedSkillId,
  selectedSkillDetail,
  globalSkillProjections,
  activeSessionSkillState,
  workspaceSkillProfile,
  workspaceRecentSkillIds,
  workspaceSkillRecommendations,
  workspaceSkillRestoreResults,
  skillDiscoverySnapshot,
  selectedDiscoveryId,
  selectedDiscoveryDetail,
  workspaceSkillTargets,
  selectedWorkspaceSkillTargetId,
  workspaceSkillInventory,
  selectedWorkspaceSkillContainerKind,
  currentWorkspaceLabel,
  onSelectSkill,
  onSelectDiscoveredSkill,
  onScanDiscoveredSkills,
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
  onRecoverWorkspaceSkill,
  search,
  filter,
  onSearchChange,
  onFilterChange,
}: SkillCenterPanelProps) {
  const [metaExpanded, setMetaExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [manageContextId, setManageContextId] = useState<ManageContextId>("skill_center");

  useEffect(() => {
    setMetaExpanded(false);
    setFilesExpanded(false);
  }, [manageContextId, section, selectedDiscoveryId, selectedSkillId]);

  const keyword = search.trim().toLowerCase();
  const currentWorkspaceTarget =
    workspaceSkillTargets.find((target) => target.isCurrent) ?? null;
  const homeWorkspaceTarget =
    workspaceSkillTargets.find((target) => target.scope === "user_home") ?? null;
  const knownWorkspaceTargets = workspaceSkillTargets.filter(
    (target) => target.scope === "workspace" && !target.isCurrent,
  );

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

  const recentSkills = useMemo(
    () =>
      workspaceRecentSkillIds
        .map((skillId) => installedSkills.find((item) => item.id === skillId))
        .filter((item): item is InstalledSkill => Boolean(item)),
    [installedSkills, workspaceRecentSkillIds],
  );

  const recommendationMap = useMemo(
    () =>
      new Map(
        workspaceSkillRecommendations.map((recommendation) => [
          recommendation.skillId,
          recommendation,
        ]),
      ),
    [workspaceSkillRecommendations],
  );

  const restoreResultMap = useMemo(
    () =>
      new Map(
        workspaceSkillRestoreResults.map((result) => [result.skillId, result]),
      ),
    [workspaceSkillRestoreResults],
  );

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

    if (manageContextId === "skill_center") {
      return installedEntries;
    }

    const installedSkillIds = new Set(installedSkills.map((skill) => skill.id));
    const discoveredEntries: ManageListEntry[] = contextDiscoveryEntries
      .filter(({ record, matchedLocations }) => {
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

  const selectedInstalledState = selectedInstalledSkill
    ? statusForSkill(selectedInstalledSkill.id, globalSkillProjections, activeSessionSkillState)
    : {
        globalApplied: false,
        userGlobalApplied: false,
        kimiCodeHomeApplied: false,
        sessionApplied: false,
      };
  const selectedInstalledUserGlobalProjection = selectedInstalledSkill
    ? projectionForSkill(selectedInstalledSkill.id, globalSkillProjections, "user_global_kimi")
    : null;
  const selectedInstalledKimiCodeHomeProjection = selectedInstalledSkill
    ? projectionForSkill(selectedInstalledSkill.id, globalSkillProjections, "kimi_code_home")
    : null;
  const selectedInstalledSessionProjection = selectedInstalledSkill
    ? projectionForSkill(selectedInstalledSkill.id, activeSessionSkillState.projections)
    : null;
  const selectedInstalledPinned = selectedInstalledSkill
    ? (workspaceSkillProfile?.pinnedSkillIds ?? []).includes(selectedInstalledSkill.id)
    : false;
  const selectedInstalledRecommendation = selectedInstalledSkill
    ? recommendationMap.get(selectedInstalledSkill.id) ?? null
    : null;
  const selectedInstalledRestoreResult = selectedInstalledSkill
    ? restoreResultMap.get(selectedInstalledSkill.id) ?? null
    : null;
  const selectedInstalledLocations =
    selectedManageEntry?.kind === "installed"
      ? selectedManageEntry.matchedLocations.length > 0
        ? selectedManageEntry.matchedLocations
        : selectedInstalledSkill?.discoveryLocations ?? []
      : [];

  const selectedWorkspaceTarget =
    workspaceSkillTargets.find((target) => target.id === selectedWorkspaceSkillTargetId) ?? null;
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

  const filterOptions: Array<{ value: SkillCenterFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "global", label: "已投影" },
    { value: "session", label: "当前工作区" },
    { value: "pinned", label: "已固定" },
    { value: "untrusted", label: "未信任" },
    { value: "update_available", label: "可更新" },
  ];
  const isSkillCenterManageContext = manageContextId === "skill_center";

  return (
    <div className={`skill-center skill-center-${surface}`}>
      <div className="skill-center-content">
        {section === "manage" ? (
          <ControlCenterWorkbenchLayout
            mode="stack-on-mobile"
            railBodyClassName="skill-center-list"
            detailBodyClassName="skill-center-detail-body"
            railHeader={
              <div className="skill-center-toolbar">
                <div className="skill-center-manage-toolbar-grid">
                  <Input
                    className="skill-center-header-search"
                    value={search}
                    onChange={(event) => onSearchChange(event.target.value)}
                    placeholder={
                      isSkillCenterManageContext
                        ? "搜索受管 Skill"
                        : "搜索技能、外部发现或来源位置"
                    }
                  />
                  <select
                    className="skill-center-select skill-center-manage-select"
                    value={manageContextId}
                    onChange={(event) => setManageContextId(event.target.value as ManageContextId)}
                    disabled={busy}
                    aria-label="技能管理范围"
                  >
                    <option value="skill_center">受管 Skill</option>
                    <option value="current_workspace" disabled={!currentWorkspaceTarget}>
                      {currentWorkspaceTarget ? "当前工作区" : "当前工作区（未识别）"}
                    </option>
                    <option value="user_home">主目录</option>
                    {knownWorkspaceTargets.length > 0 ? (
                      <optgroup label="已知工作区">
                        {knownWorkspaceTargets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                  {isSkillCenterManageContext ? (
                    <select
                      className="skill-center-select skill-center-manage-select"
                      value={filter}
                      onChange={(event) =>
                        onFilterChange(event.target.value as SkillCenterFilter)
                      }
                      disabled={busy}
                      aria-label="技能管理详情筛选"
                    >
                      {filterOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="skill-center-manage-action"
                      onClick={onScanDiscoveredSkills}
                      disabled={busy}
                    >
                      重新扫描
                    </Button>
                  )}
                </div>
              </div>
            }
            rail={
              <>
                {manageEntries.length === 0 ? (
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
                {manageEntries.map((entry) => {
                  const isSelected =
                    entry.kind === "installed"
                      ? selectedManageEntry?.kind === "installed" &&
                        selectedManageEntry.installedSkill.id === entry.installedSkill.id
                      : selectedManageEntry?.kind === "discovered" &&
                        selectedManageEntry.discoveredRecord.discoveryId ===
                          entry.discoveredRecord.discoveryId;
                  if (entry.kind === "installed") {
                    const state = statusForSkill(
                      entry.installedSkill.id,
                      globalSkillProjections,
                      activeSessionSkillState,
                    );
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
                            {entry.matchedLocations.length > 0
                              ? renderStatusChip(
                                  entry.matchedDiscovery?.importedSkillId ? "已导入" : "外部来源",
                                  "muted",
                                )
                              : null}
                            {state.userGlobalApplied
                              ? renderStatusChip("~/.agents", "muted")
                              : null}
                            {state.kimiCodeHomeApplied
                              ? renderStatusChip("KIMI_CODE_HOME", "muted")
                              : null}
                            {state.sessionApplied
                              ? renderStatusChip("当前工作区", "muted")
                              : null}
                          </div>
                        </div>
                        <p className="skill-center-list-description">
                          {entry.installedSkill.description || "这个技能没有提供描述。"}
                        </p>
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
                          {entry.discoveredRecord.hasScripts
                            ? renderStatusChip("含脚本", "muted")
                            : null}
                        </div>
                      </div>
                      <p className="skill-center-list-description">
                        {entry.discoveredRecord.description || "这个外部 Skill 没有提供描述。"}
                      </p>
                      <div className="skill-center-chip-row">
                        {entry.matchedLocations.slice(0, 2).map((location) => (
                          <span
                            key={`${entry.discoveredRecord.discoveryId}-${location.skillPath}-${location.containerKind}`}
                            className="skill-center-chip skill-center-chip-muted"
                          >
                            {formatDiscoveryLocationLabel(location)}
                          </span>
                        ))}
                        {entry.matchedLocations.length > 2 ? (
                          <span className="skill-center-chip skill-center-chip-muted">
                            +{entry.matchedLocations.length - 2} 个位置
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </>
            }
            detail={
              selectedInstalledSkill ? (
                <>
                  <div className="skill-center-detail-header">
                    <div className="skill-center-detail-title">
                      <h3>{selectedInstalledSkill.name}</h3>
                    </div>
                    <div className="skill-center-chip-row skill-center-chip-row-detail">
                      {selectedInstalledSkill.trusted
                        ? renderStatusChip("已信任", "ready")
                        : renderStatusChip("未信任", "warning")}
                      {selectedInstalledLocations.length > 0
                        ? renderStatusChip(
                            selectedManageEntry?.kind === "installed" &&
                              selectedManageEntry.matchedDiscovery?.importedSkillId
                              ? "已导入发现"
                              : "外部来源",
                            "muted",
                          )
                        : null}
                      {selectedInstalledState.userGlobalApplied
                        ? renderStatusChip("~/.agents", "muted")
                        : null}
                      {selectedInstalledState.kimiCodeHomeApplied
                        ? renderStatusChip("KIMI_CODE_HOME", "muted")
                        : null}
                      {selectedInstalledState.sessionApplied
                        ? renderStatusChip("当前工作区", "muted")
                        : null}
                    </div>
                  </div>
                  <p className="skill-center-detail-description">
                    {selectedInstalledSkill.description || "这个技能没有提供描述。"}
                  </p>

                  <div className="skill-center-actions skill-center-actions-primary">
                    <Button
                      type="button"
                      onClick={() => onApplySkill(selectedInstalledSkill.id, "session_kimi")}
                      disabled={
                        busy ||
                        !selectedInstalledSkill.trusted ||
                        selectedInstalledState.sessionApplied
                      }
                    >
                      投影到当前工作区 .agents
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onApplySkill(selectedInstalledSkill.id, "user_global_kimi")}
                      disabled={
                        busy ||
                        !selectedInstalledSkill.trusted ||
                        selectedInstalledState.userGlobalApplied
                      }
                    >
                      投影到用户全局 ~/.agents
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onApplySkill(selectedInstalledSkill.id, "kimi_code_home")}
                      disabled={
                        busy ||
                        !selectedInstalledSkill.trusted ||
                        selectedInstalledState.kimiCodeHomeApplied
                      }
                    >
                      投影到 KIMI_CODE_HOME
                    </Button>
                  </div>

                  <div className="skill-center-actions skill-center-actions-secondary">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onSetPin(selectedInstalledSkill.id, !selectedInstalledPinned)}
                      disabled={busy}
                    >
                      {selectedInstalledPinned ? "取消固定" : "固定到工作区"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onUpdateSkill(selectedInstalledSkill.id)}
                      disabled={busy}
                    >
                      更新技能
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={
                        selectedInstalledSkill.trusted ? (
                          <ShieldOff size={14} />
                        ) : (
                          <Shield size={14} />
                        )
                      }
                      onClick={() =>
                        onSetTrust(selectedInstalledSkill.id, !selectedInstalledSkill.trusted)
                      }
                      disabled={busy}
                    >
                      {selectedInstalledSkill.trusted ? "取消信任" : "信任技能"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onUninstallSkill(selectedInstalledSkill.id)}
                      disabled={busy}
                    >
                      卸载技能
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRemoveSkill(selectedInstalledSkill.id, "user_global_kimi")}
                      disabled={busy || !selectedInstalledState.userGlobalApplied}
                    >
                      从 ~/.agents 移除
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRemoveSkill(selectedInstalledSkill.id, "kimi_code_home")}
                      disabled={busy || !selectedInstalledState.kimiCodeHomeApplied}
                    >
                      从 KIMI_CODE_HOME 移除
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onRemoveSkill(selectedInstalledSkill.id, "session_kimi")}
                      disabled={busy || !selectedInstalledState.sessionApplied}
                    >
                      从当前工作区移除
                    </Button>
                  </div>

                  {renderCollapsibleSection(
                    "基础信息",
                    metaExpanded,
                    () => setMetaExpanded((current) => !current),
                    <dl className="skill-center-meta">
                      <div>
                        <dt>投影名</dt>
                        <dd>{selectedInstalledSkill.projectionName}</dd>
                      </div>
                      <div>
                        <dt>来源</dt>
                        <dd>{formatSkillSource(selectedInstalledSkill)}</dd>
                      </div>
                      <div>
                        <dt>展示来源</dt>
                        <dd>{formatSkillDisplaySource(getSkillDisplaySource(selectedInstalledSkill))}</dd>
                      </div>
                      <div>
                        <dt>Triggers</dt>
                        <dd>
                          {selectedInstalledSkill.metadata?.triggers?.length
                            ? selectedInstalledSkill.metadata.triggers.join(" / ")
                            : "未声明"}
                        </dd>
                      </div>
                      <div>
                        <dt>本地路径</dt>
                        <dd>{selectedInstalledSkill.localPath}</dd>
                      </div>
                      <div>
                        <dt>脚本</dt>
                        <dd>{selectedInstalledSkill.hasScripts ? "包含 scripts/" : "无 scripts/"}</dd>
                      </div>
                    </dl>,
                  )}

                  {selectedInstalledLocations.length > 0 ? (
                    <div className="skill-center-applied-paths">
                      <div className="skill-center-section-header">
                        <h4>{manageContextId === "skill_center" ? "外部发现位置" : "当前范围来源位置"}</h4>
                        <span>{selectedInstalledLocations.length} 个位置</span>
                      </div>
                      <div className="skill-center-path-list">
                        {selectedInstalledLocations.map((location) => (
                          <div
                            key={`${location.skillPath}-${location.containerKind}`}
                            className="skill-center-path-item"
                          >
                            <strong>{formatDiscoveryLocationLabel(location)}</strong>
                            <code>{location.skillPath}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {renderCollapsibleSection(
                    "技能内容预览",
                    filesExpanded,
                    () => setFilesExpanded((current) => !current),
                    <div className="skill-center-files">
                      <div className="skill-center-file-list">
                        {(selectedSkillDetail?.relativePaths ?? []).slice(0, 48).map((item) => (
                          <code key={item}>{item}</code>
                        ))}
                      </div>
                    </div>,
                  )}

                  <div className="skill-center-recent">
                    <div className="skill-center-section-header">
                      <h4>当前工作区最近使用</h4>
                      <span>{currentWorkspaceLabel || "未识别工作区"}</span>
                    </div>
                    {recentSkills.length === 0 ? (
                      <p className="skill-center-muted">这个工作区还没有最近使用记录。</p>
                    ) : (
                      <div className="skill-center-recent-list">
                        {recentSkills.map((skill) => (
                          <div key={skill.id} className="skill-center-recent-item">
                            <div>
                              <strong>{skill.name}</strong>
                              <p>{skill.projectionName}</p>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => onRecoverWorkspaceSkill(skill.id)}
                              disabled={busy || !skill.trusted}
                            >
                              投影到当前工作区
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="skill-center-applied-paths">
                    <div className="skill-center-section-header">
                      <h4>已应用目录</h4>
                    </div>
                    {!selectedInstalledUserGlobalProjection &&
                    !selectedInstalledKimiCodeHomeProjection &&
                    !selectedInstalledSessionProjection ? (
                      <p className="skill-center-muted">这个技能当前还没有应用到任何目录。</p>
                    ) : (
                      <div className="skill-center-path-list">
                        {selectedInstalledUserGlobalProjection ? (
                          <div className="skill-center-path-item">
                            <strong>
                              {formatProjectionScope(selectedInstalledUserGlobalProjection.scope)}
                            </strong>
                            <code>{selectedInstalledUserGlobalProjection.targetPath}</code>
                          </div>
                        ) : null}
                        {selectedInstalledKimiCodeHomeProjection ? (
                          <div className="skill-center-path-item">
                            <strong>
                              {formatProjectionScope(
                                selectedInstalledKimiCodeHomeProjection.scope,
                              )}
                            </strong>
                            <code>{selectedInstalledKimiCodeHomeProjection.targetPath}</code>
                          </div>
                        ) : null}
                        {selectedInstalledSessionProjection ? (
                          <div className="skill-center-path-item">
                            <strong>{formatProjectionScope(selectedInstalledSessionProjection.scope)}</strong>
                            <code>{selectedInstalledSessionProjection.targetPath}</code>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {selectedInstalledRecommendation ? (
                    <div className="skill-center-applied-paths">
                      <div className="skill-center-section-header">
                        <h4>推荐理由</h4>
                        <span>{selectedInstalledRecommendation.recommendedScope}</span>
                      </div>
                      <div className="skill-center-path-list">
                        {selectedInstalledRecommendation.reasons.map((reason) => (
                          <div key={reason} className="skill-center-path-item">
                            <code>{reason}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedInstalledRestoreResult ? (
                    <div className="skill-center-applied-paths">
                      <div className="skill-center-section-header">
                        <h4>最近恢复结果</h4>
                        <span>{selectedInstalledRestoreResult.status}</span>
                      </div>
                      <p className="skill-center-muted">{selectedInstalledRestoreResult.detail}</p>
                    </div>
                  ) : null}
                </>
              ) : selectedDiscoveredRecord ? (
                <>
                  <div className="skill-center-detail-header">
                    <div className="skill-center-detail-title">
                      <h3>{selectedDiscoveredRecord.name}</h3>
                    </div>
                    <div className="skill-center-chip-row skill-center-chip-row-detail">
                      {renderStatusChip("待导入", "warning")}
                      {selectedDiscoveredRecord.hasScripts
                        ? renderStatusChip("包含 scripts/", "muted")
                        : null}
                    </div>
                  </div>
                  <p className="skill-center-detail-description">
                    {selectedDiscoveredRecord.description || "这个外部 Skill 没有提供描述。"}
                  </p>

                  <div className="skill-center-actions skill-center-actions-primary">
                    <Button
                      type="button"
                      onClick={() => onImportDiscoveredSkill(selectedDiscoveredRecord.discoveryId)}
                      disabled={busy}
                    >
                      导入到受管 Skill
                    </Button>
                  </div>

                  <div className="skill-center-applied-paths">
                    <div className="skill-center-section-header">
                      <h4>基础信息</h4>
                      <span>{selectedDiscoveredRecord.projectionName}</span>
                    </div>
                    <div className="skill-center-path-list">
                      <div className="skill-center-path-item">
                        <strong>Canonical 来源路径</strong>
                        <code>{selectedDiscoveredRecord.canonicalPath}</code>
                      </div>
                      <div className="skill-center-path-item">
                        <strong>上次扫描时间</strong>
                        <code>{selectedDiscoveredRecord.lastScannedAt}</code>
                      </div>
                    </div>
                  </div>

                  <div className="skill-center-applied-paths">
                    <div className="skill-center-section-header">
                      <h4>发现位置</h4>
                      <span>{selectedManageEntry?.kind === "discovered" ? selectedManageEntry.matchedLocations.length : selectedDiscoveredRecord.locations.length} 个位置</span>
                    </div>
                    <div className="skill-center-path-list">
                      {(selectedManageEntry?.kind === "discovered"
                        ? selectedManageEntry.matchedLocations
                        : selectedDiscoveredRecord.locations
                      ).map((location) => (
                        <div
                          key={`${selectedDiscoveredRecord.discoveryId}-${location.skillPath}-${location.containerKind}`}
                          className="skill-center-path-item"
                        >
                          <strong>{formatDiscoveryLocationLabel(location)}</strong>
                          <code>{location.skillPath}</code>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="skill-center-files">
                    <div className="skill-center-section-header">
                      <h4>技能内容预览</h4>
                      <span>{selectedDiscoveryDetail?.relativePaths.length ?? 0} 个文件</span>
                    </div>
                    <div className="skill-center-file-list">
                      {(selectedDiscoveryDetail?.relativePaths ?? []).slice(0, 64).map((item) => (
                        <code key={item}>{item}</code>
                      ))}
                    </div>
                  </div>
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
                    </div>
                  </div>

                  <ControlCenterSegmentedControl
                    ariaLabel="工作区 Skill 容器"
                    className="skill-center-container-switch"
                    itemClassName="skill-center-container-switch-btn"
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
