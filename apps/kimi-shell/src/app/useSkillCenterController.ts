import { useState, type Dispatch, type SetStateAction } from "react";
import {
  createEmptySessionSkillState,
  createEmptyWorkspaceSkillProfile,
} from "@/app/shellControllerDefaults";
import type {
  DiscoveredSkillDetail,
  InstalledSkill,
  SessionSkillState,
  SkillCenterFilter,
  SkillCenterSectionId,
  SkillDetail,
  SkillDiscoveryContainerKind,
  SkillDiscoverySnapshot,
  SkillProjectionRecord,
  SkillRecommendation,
  WorkspaceDiscoveryRoot,
  WorkspaceSkillInventory,
  WorkspaceSkillProfile,
  WorkspaceSkillRestoreResult,
  WorkspaceSkillTarget,
} from "@/app/types";
import {
  getDiscoveredSkillDetail,
  getWorkspaceSkillProfile,
  getWorkspaceSkillInventory,
  getWorkspaceSkillRecommendations,
  getSkillDetail,
  listActiveSessionSkills,
  listSkillDiscoveryWorkspaces,
  listGlobalSkills,
  listInstalledSkills,
  listWorkspaceSkillTargets,
  scanDiscoverableSkills,
} from "@/services/skillCenterService";

type SkillCenterControllerOptions = {
  setActionError: Dispatch<SetStateAction<string | null>>;
};

export function selectPreferredSkillId(
  skills: InstalledSkill[],
  preferredSkillId?: string | null,
) {
  return preferredSkillId && skills.some((skill) => skill.id === preferredSkillId)
    ? preferredSkillId
    : null;
}

export function selectPreferredDiscoveryId(
  records: { discoveryId: string }[],
  preferredDiscoveryId?: string | null,
) {
  return preferredDiscoveryId &&
    records.some((record) => record.discoveryId === preferredDiscoveryId)
    ? preferredDiscoveryId
    : null;
}

export function useSkillCenterController({
  setActionError,
}: SkillCenterControllerOptions) {
  const [installedSkills, setInstalledSkills] = useState<InstalledSkill[]>([]);
  const [skillCenterBusy, setSkillCenterBusy] = useState(false);
  const [skillCenterSearch, setSkillCenterSearch] = useState("");
  const [skillCenterFilter, setSkillCenterFilter] = useState<SkillCenterFilter>("all");
  const [skillCenterSection, setSkillCenterSection] =
    useState<SkillCenterSectionId>("manage");
  const [skillCenterGitRepoUrl, setSkillCenterGitRepoUrl] = useState("");
  const [skillCenterGitRef, setSkillCenterGitRef] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<SkillDetail | null>(
    null,
  );
  const [globalSkillProjections, setGlobalSkillProjections] = useState<
    SkillProjectionRecord[]
  >([]);
  const [activeSessionSkillState, setActiveSessionSkillState] =
    useState<SessionSkillState>(() => createEmptySessionSkillState());
  const [workspaceSkillProfile, setWorkspaceSkillProfile] =
    useState<WorkspaceSkillProfile | null>(() => createEmptyWorkspaceSkillProfile());
  const [workspaceRecentSkillIds, setWorkspaceRecentSkillIds] = useState<string[]>([]);
  const [workspaceSkillRecommendations, setWorkspaceSkillRecommendations] = useState<
    SkillRecommendation[]
  >([]);
  const [workspaceSkillRestoreResults, setWorkspaceSkillRestoreResults] = useState<
    WorkspaceSkillRestoreResult[]
  >([]);
  const [skillDiscoverySnapshot, setSkillDiscoverySnapshot] =
    useState<SkillDiscoverySnapshot | null>(null);
  const [skillDiscoveryWorkspaces, setSkillDiscoveryWorkspaces] = useState<
    WorkspaceDiscoveryRoot[]
  >([]);
  const [selectedDiscoveryId, setSelectedDiscoveryId] = useState<string | null>(null);
  const [selectedDiscoveryDetail, setSelectedDiscoveryDetail] =
    useState<DiscoveredSkillDetail | null>(null);
  const [workspaceSkillTargets, setWorkspaceSkillTargets] = useState<WorkspaceSkillTarget[]>([]);
  const [selectedWorkspaceSkillTargetId, setSelectedWorkspaceSkillTargetId] = useState<
    string | null
  >(null);
  const [workspaceSkillInventory, setWorkspaceSkillInventory] =
    useState<WorkspaceSkillInventory | null>(null);
  const [selectedWorkspaceSkillContainerKind, setSelectedWorkspaceSkillContainerKind] =
    useState<SkillDiscoveryContainerKind>("agents");

  async function refreshInstalledSkills(preferredSkillId?: string | null) {
    const data = await listInstalledSkills();
    setInstalledSkills(data);
    const nextSelectedId = selectPreferredSkillId(data, preferredSkillId);
    setSelectedSkillId(nextSelectedId);
    return { skills: data, selectedSkillId: nextSelectedId };
  }

  async function refreshSelectedSkillDetail(skillId?: string | null) {
    if (!skillId?.trim()) {
      setSelectedSkillDetail(null);
      return null;
    }
    const detail = await getSkillDetail(skillId);
    setSelectedSkillDetail(detail);
    return detail;
  }

  async function refreshActiveSessionSkills() {
    try {
      const data = await listActiveSessionSkills();
      setActiveSessionSkillState(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      const empty = createEmptySessionSkillState();
      setActiveSessionSkillState(empty);
      return empty;
    }
  }

  async function refreshGlobalSkillProjections() {
    try {
      const data = await listGlobalSkills();
      setGlobalSkillProjections(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      setGlobalSkillProjections([]);
      return [];
    }
  }

  async function refreshWorkspaceSkillProfileState(workspaceKey?: string) {
    try {
      const profile = await getWorkspaceSkillProfile(workspaceKey);
      setWorkspaceSkillProfile(profile);
      setWorkspaceRecentSkillIds(profile?.recentSkillIds ?? []);
      return profile;
    } catch (error) {
      setActionError(String(error));
      setWorkspaceSkillProfile(null);
      setWorkspaceRecentSkillIds([]);
      return null;
    }
  }

  async function refreshWorkspaceSkillRecommendationsState(workspaceKey?: string) {
    try {
      const recommendations = await getWorkspaceSkillRecommendations(workspaceKey);
      setWorkspaceSkillRecommendations(recommendations);
      return recommendations;
    } catch (error) {
      setActionError(String(error));
      setWorkspaceSkillRecommendations([]);
      return [];
    }
  }

  async function refreshSkillDiscoveryWorkspaces() {
    try {
      const workspaces = await listSkillDiscoveryWorkspaces();
      setSkillDiscoveryWorkspaces(workspaces);
      return workspaces;
    } catch (error) {
      setActionError(String(error));
      setSkillDiscoveryWorkspaces([]);
      return [];
    }
  }

  async function refreshSelectedDiscoveryDetail(discoveryId?: string | null) {
    if (!discoveryId?.trim()) {
      setSelectedDiscoveryDetail(null);
      return null;
    }
    const detail = await getDiscoveredSkillDetail(discoveryId);
    setSelectedDiscoveryDetail(detail);
    return detail;
  }

  async function refreshSkillDiscoveryState(preferredDiscoveryId?: string | null) {
    try {
      const [workspaces, snapshot] = await Promise.all([
        refreshSkillDiscoveryWorkspaces(),
        scanDiscoverableSkills(),
      ]);
      setSkillDiscoverySnapshot(snapshot);
      const nextSelectedId = selectPreferredDiscoveryId(
        snapshot.records,
        preferredDiscoveryId,
      );
      setSelectedDiscoveryId(nextSelectedId);
      setSkillDiscoveryWorkspaces(snapshot.workspaces.length > 0 ? snapshot.workspaces : workspaces);
      await refreshSelectedDiscoveryDetail(nextSelectedId);
      return {
        snapshot,
        workspaces: snapshot.workspaces.length > 0 ? snapshot.workspaces : workspaces,
        selectedDiscoveryId: nextSelectedId,
      };
    } catch (error) {
      setActionError(String(error));
      setSkillDiscoverySnapshot(null);
      setSkillDiscoveryWorkspaces([]);
      setSelectedDiscoveryId(null);
      setSelectedDiscoveryDetail(null);
      throw error;
    }
  }

  async function refreshWorkspaceSkillTargetsState(preferredTargetId?: string | null) {
    try {
      const targets = await listWorkspaceSkillTargets();
      setWorkspaceSkillTargets(targets);
      const nextSelectedTargetId =
        preferredTargetId &&
        targets.some((target) => target.id === preferredTargetId)
          ? preferredTargetId
          : targets[0]?.id ?? null;
      setSelectedWorkspaceSkillTargetId(nextSelectedTargetId);
      return { targets, selectedWorkspaceSkillTargetId: nextSelectedTargetId };
    } catch (error) {
      setActionError(String(error));
      setWorkspaceSkillTargets([]);
      setSelectedWorkspaceSkillTargetId(null);
      throw error;
    }
  }

  async function refreshWorkspaceSkillInventoryState(targetId?: string | null) {
    if (!targetId?.trim()) {
      setWorkspaceSkillInventory(null);
      return null;
    }
    try {
      const inventory = await getWorkspaceSkillInventory(targetId);
      setWorkspaceSkillInventory(inventory);
      const availableContainerKinds = inventory.containers.map((container) => container.containerKind);
      setSelectedWorkspaceSkillContainerKind((current) =>
        availableContainerKinds.includes(current)
          ? current
          : availableContainerKinds[0] ?? "agents",
      );
      return inventory;
    } catch (error) {
      setActionError(String(error));
      setWorkspaceSkillInventory(null);
      throw error;
    }
  }

  async function refreshWorkspaceSkillManagementState(preferredTargetId?: string | null) {
    const { selectedWorkspaceSkillTargetId: nextTargetId } =
      await refreshWorkspaceSkillTargetsState(preferredTargetId ?? selectedWorkspaceSkillTargetId);
    await refreshWorkspaceSkillInventoryState(nextTargetId);
    return nextTargetId;
  }

  async function refreshSkillCenterState(preferredSkillId?: string | null) {
    try {
      const [{ selectedSkillId: nextSelectedId }, globalState, sessionState] =
        await Promise.all([
          refreshInstalledSkills(preferredSkillId),
          refreshGlobalSkillProjections(),
          refreshActiveSessionSkills(),
        ]);
      await Promise.all([
        refreshSelectedSkillDetail(nextSelectedId),
        refreshWorkspaceSkillProfileState(),
        refreshWorkspaceSkillRecommendationsState(),
      ]);
      return {
        selectedSkillId: nextSelectedId,
        globalState,
        sessionState,
      };
    } catch (error) {
      setActionError(String(error));
      throw error;
    }
  }

  return {
    installedSkills,
    setInstalledSkills,
    skillCenterBusy,
    setSkillCenterBusy,
    skillCenterSearch,
    setSkillCenterSearch,
    skillCenterFilter,
    setSkillCenterFilter,
    skillCenterSection,
    setSkillCenterSection,
    skillCenterGitRepoUrl,
    setSkillCenterGitRepoUrl,
    skillCenterGitRef,
    setSkillCenterGitRef,
    selectedSkillId,
    setSelectedSkillId,
    selectedSkillDetail,
    setSelectedSkillDetail,
    globalSkillProjections,
    activeSessionSkillState,
    workspaceSkillProfile,
    setWorkspaceSkillProfile,
    workspaceRecentSkillIds,
    setWorkspaceRecentSkillIds,
    workspaceSkillRecommendations,
    workspaceSkillRestoreResults,
    setWorkspaceSkillRestoreResults,
    skillDiscoverySnapshot,
    skillDiscoveryWorkspaces,
    selectedDiscoveryId,
    setSelectedDiscoveryId,
    selectedDiscoveryDetail,
    setSelectedDiscoveryDetail,
    workspaceSkillTargets,
    selectedWorkspaceSkillTargetId,
    setSelectedWorkspaceSkillTargetId,
    workspaceSkillInventory,
    selectedWorkspaceSkillContainerKind,
    setSelectedWorkspaceSkillContainerKind,
    refreshActiveSessionSkills,
    refreshSkillCenterState,
    refreshSkillDiscoveryState,
    refreshWorkspaceSkillManagementState,
    refreshSelectedSkillDetail,
    refreshSelectedDiscoveryDetail,
    refreshWorkspaceSkillRecommendationsState,
    refreshWorkspaceSkillInventoryState,
  };
}
