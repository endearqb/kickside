import { invoke } from "@tauri-apps/api/core";
import type {
  InstalledSkill,
  SessionSkillState,
  SkillApplyResult,
  SkillApplyScope,
  SkillDetail,
  SkillProjectionRecord,
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

export function getSkillDetail(skillId: string) {
  return invoke<SkillDetail>("get_skill_detail", { skillId });
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
