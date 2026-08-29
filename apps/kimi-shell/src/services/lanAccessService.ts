import { invoke } from "@tauri-apps/api/core";

export type KimiLanAddress = {
  name: string;
  ip: string;
  url: string;
};

export type KimiLanAccessStatus = {
  enabled: boolean;
  switching: boolean;
  lastError?: string;
  runtimeOwnership: "owned_by_shell" | "reused_external" | "unavailable";
  runtimeReady: boolean;
  canToggle: boolean;
  port?: number;
  addresses: KimiLanAddress[];
  tokenAvailable: boolean;
};

export type KimiLanLaunchUrl = {
  url: string;
  qrSvg: string;
};

export type KimiAccessMode = "local" | "lan" | "kimi_remote";
export type KimiRemoteControlState =
  | "disabled"
  | "starting"
  | "registering"
  | "connected"
  | "disconnected"
  | "error";

export type KimiAccessStatus = {
  mode: KimiAccessMode;
  switching: boolean;
  lastError?: string;
  runtimeOwnership: "owned_by_shell" | "reused_external" | "unavailable";
  runtimeReady: boolean;
  canChange: boolean;
  port?: number;
  lanAddresses: KimiLanAddress[];
  remoteControlSupported: boolean;
  remoteControlState: KimiRemoteControlState;
  remoteUrlAvailable: boolean;
  remoteStartedAtMs?: number;
};

export type KimiRemoteLaunchUrl = {
  url: string;
  qrSvg: string;
};

export function getKimiLanAccessStatus() {
  return invoke<KimiLanAccessStatus>("get_kimi_lan_access_status");
}

export function setKimiLanAccess(enabled: boolean) {
  return invoke<KimiLanAccessStatus>("set_kimi_lan_access", { enabled });
}

export function getKimiLanLaunchUrl(ip: string) {
  return invoke<KimiLanLaunchUrl>("get_kimi_lan_launch_url", { ip });
}

export function getKimiAccessStatus() {
  return invoke<KimiAccessStatus>("get_kimi_access_status");
}

export function setKimiAccessMode(mode: KimiAccessMode) {
  return invoke<KimiAccessStatus>("set_kimi_access_mode", { mode });
}

export function getKimiRemoteLaunchUrl() {
  return invoke<KimiRemoteLaunchUrl>("get_kimi_remote_launch_url");
}
