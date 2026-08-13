import { invoke } from "@tauri-apps/api/core";

export type DshRuntimeState =
  | "stopped"
  | "starting"
  | "running"
  | "crashed"
  | "stopping";

export interface DshStatus {
  state: DshRuntimeState;
  pid?: number;
  port?: number;
  url?: string;
  workspaceDir?: string;
  startedAtMs?: number;
  exitCode?: number;
  lastError?: string;
  pinnedVersion: string;
}

export interface DshSettings {
  enabled: boolean;
  portRange: [number, number];
  startTimeoutSec: number;
  pinnedVersion: string;
}

export interface DshPreflight {
  ready: boolean;
  nodePath?: string;
  nodeVersion?: string;
  npmPath?: string;
  installedVersion?: string;
  pinnedVersion: string;
  installPath: string;
  issues: string[];
}

export function getDshSettings() {
  return invoke<DshSettings>("dsh_get_settings");
}

export function saveDshSettings(input: Omit<DshSettings, "pinnedVersion">) {
  return invoke<DshSettings>("dsh_save_settings", { input });
}

export function getDshPreflight() {
  return invoke<DshPreflight>("dsh_get_preflight");
}

export function installDsh() {
  return invoke<DshPreflight>("dsh_install");
}

export function getDshStatus() {
  return invoke<DshStatus>("dsh_get_status");
}

export function startDsh(workspaceDir: string) {
  return invoke<DshStatus>("dsh_start", { input: { workspaceDir } });
}

export function stopDsh() {
  return invoke<DshStatus>("dsh_stop");
}

export function getDshLogTail(maxLines = 80) {
  return invoke<string[]>("dsh_get_log_tail", { maxLines });
}
