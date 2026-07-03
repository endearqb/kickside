import { invoke } from "@tauri-apps/api/core";
import type {
  DiscoveredSkillDetail,
  InstalledSkill,
  SessionSkillState,
  SkillApplyResult,
  SkillApplyScope,
  SkillDiscoverySnapshot,
  SkillDetail,
  SkillFileContent,
  SkillFileEntry,
  SkillProjectionRecord,
  SkillRecommendation,
  SkillUsageStats,
  WorkspaceDiscoveryRoot,
  SkillDiscoveryContainerKind,
  WorkspaceSkillInventory,
  WorkspaceSkillProfile,
  WorkspaceSkillTarget,
} from "@/app/types";

export function installSkillFromGit(repoUrl: string, gitRef?: string) {
  return invoke<InstalledSkill>("install_skill_from_git", {
    repoUrl,
    gitRef: gitRef?.trim() ? gitRef.trim() : undefined,
  });
}

export function importSkillFromPath(path: string) {
  return invoke<InstalledSkill>("import_skill_from_path", { path });
}

export function listInstalledSkills() {
  return invoke<InstalledSkill[]>("list_installed_skills");
}

export function scanDiscoverableSkills() {
  return invoke<SkillDiscoverySnapshot>("scan_discoverable_skills");
}

export function listSkillDiscoveryWorkspaces() {
  return invoke<WorkspaceDiscoveryRoot[]>("list_skill_discovery_workspaces");
}

export function listWorkspaceSkillTargets() {
  return invoke<WorkspaceSkillTarget[]>("list_workspace_skill_targets");
}

export function getWorkspaceSkillInventory(targetId: string) {
  return invoke<WorkspaceSkillInventory>("get_workspace_skill_inventory", {
    targetId,
  });
}

export function addInstalledSkillToWorkspaceTarget(
  targetId: string,
  containerKind: SkillDiscoveryContainerKind,
  skillId: string,
) {
  return invoke<WorkspaceSkillInventory>("add_installed_skill_to_workspace_target", {
    targetId,
    containerKind,
    skillId,
  });
}

export function removeWorkspaceTargetSkill(
  targetId: string,
  containerKind: SkillDiscoveryContainerKind,
  skillPathOrKey: string,
) {
  return invoke<WorkspaceSkillInventory>("remove_workspace_target_skill", {
    targetId,
    containerKind,
    skillPathOrKey,
  });
}

export function getDiscoveredSkillDetail(discoveryId: string) {
  return invoke<DiscoveredSkillDetail>("get_discovered_skill_detail", {
    discoveryId,
  });
}

export function importDiscoveredSkill(discoveryId: string) {
  return invoke<InstalledSkill>("import_discovered_skill", { discoveryId });
}

export function getSkillDetail(skillId: string) {
  return invoke<SkillDetail>("get_skill_detail", { skillId });
}

export function listSkillFileEntries(skillId: string) {
  return invoke<SkillFileEntry[]>("list_skill_file_entries", { skillId });
}

export function readSkillFile(skillId: string, relPath: string) {
  return invoke<SkillFileContent>("read_skill_file", { skillId, relPath });
}

export function getSkillUsageStats(skillIds?: string[]) {
  return invoke<SkillUsageStats[]>("get_skill_usage_stats", { skillIds });
}

export function listDiscoveredSkillFileEntries(discoveryId: string) {
  return invoke<SkillFileEntry[]>("list_discovered_skill_file_entries", { discoveryId });
}

export function readDiscoveredSkillFile(discoveryId: string, relPath: string) {
  return invoke<SkillFileContent>("read_discovered_skill_file", { discoveryId, relPath });
}

export function setSkillTrust(skillId: string, trusted: boolean) {
  return invoke<void>("set_skill_trust", { skillId, trusted });
}

export function applySkill(skillId: string, scope: SkillApplyScope) {
  return invoke<SkillApplyResult>("apply_skill", { skillId, scope });
}

export function removeSkill(skillId: string, scope: SkillApplyScope) {
  return invoke<SkillApplyResult>("remove_skill", { skillId, scope });
}

export function listActiveSessionSkills() {
  return invoke<SessionSkillState>("list_active_session_skills");
}

export function listGlobalSkills() {
  return invoke<SkillProjectionRecord[]>("list_global_skills");
}

export function listWorkspaceRecentSkills(workspaceKey?: string) {
  return invoke<string[]>("list_workspace_recent_skills", { workspaceKey });
}

export function getWorkspaceSkillProfile(workspaceKey?: string) {
  return invoke<WorkspaceSkillProfile | null>("get_workspace_skill_profile", {
    workspaceKey,
  });
}

export function getWorkspaceSkillRecommendations(workspaceKey?: string) {
  return invoke<SkillRecommendation[]>("get_workspace_skill_recommendations", {
    workspaceKey,
  });
}

export function setWorkspaceSkillPin(
  skillId: string,
  pinned: boolean,
  workspaceKey?: string,
) {
  return invoke<WorkspaceSkillProfile>("set_workspace_skill_pin", {
    skillId,
    pinned,
    workspaceKey,
  });
}

export function updateSkill(skillId: string) {
  return invoke<InstalledSkill>("update_skill", { skillId });
}

export function uninstallSkill(skillId: string) {
  return invoke<void>("uninstall_skill", { skillId });
}
