import { Channel, invoke } from "@tauri-apps/api/core";

export type DshRuntimeState =
  | "stopped"
  | "starting"
  | "running"
  | "degraded"
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
  runtimeReady: boolean;
  installReady: boolean;
  nodeSupported: boolean;
  npmAvailable: boolean;
  installValid: boolean;
  nodePath?: string;
  nodeVersion?: string;
  installNodePath?: string;
  installNodeVersion?: string;
  npmPath?: string;
  installedVersion?: string;
  pinnedVersion: string;
  installPath: string;
  issues: string[];
}

export type DshUpdateState =
  | "not_installed"
  | "up_to_date"
  | "update_available"
  | "ahead"
  | "unsupported";

export interface DshUpdateInfo {
  state: DshUpdateState;
  installedVersion?: string;
  recommendedVersion: string;
  upstreamVersion?: string;
  updateAvailable: boolean;
  compatible: boolean;
  checkedAtMs: number;
}

export type DshInstallStage =
  | "preflight"
  | "prepare"
  | "install"
  | "verify"
  | "activate"
  | "start";

export type DshInstallEvent =
  | { type: "stage"; stage: DshInstallStage; message: string }
  | { type: "output"; stream: "stdout" | "stderr"; line: string }
  | { type: "completed"; version: string }
  | { type: "failed"; code: string; message: string };

export function getTrustedDshRuntimeUrl(
  status: DshStatus | null | undefined,
): string | null {
  if (
    (status?.state !== "running" && status?.state !== "degraded") ||
    !status.url
  ) {
    return null;
  }

  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(status.url);
  if (!match) {
    return null;
  }

  const port = Number(match[1]);
  return port <= 65_535 && status.port === port ? status.url : null;
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

export function checkDshUpdate(force = false) {
  return invoke<DshUpdateInfo>("dsh_check_update", { force });
}

export function installDsh(onEvent?: (event: DshInstallEvent) => void) {
  const progress = new Channel<DshInstallEvent>();
  progress.onmessage = (event) => onEvent?.(event);
  return invoke<DshPreflight>("dsh_install", { progress });
}

export function updateDsh(onEvent?: (event: DshInstallEvent) => void) {
  const progress = new Channel<DshInstallEvent>();
  progress.onmessage = (event) => onEvent?.(event);
  return invoke<DshPreflight>("dsh_update", { progress });
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
