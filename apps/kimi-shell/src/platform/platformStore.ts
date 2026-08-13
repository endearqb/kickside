import { invoke, isTauri } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { PlatformCapabilities } from "@/app/types";

type PlatformCapabilitiesStatus = "idle" | "loading" | "ready" | "fallback";

type PlatformCapabilitiesState = {
  capabilities: PlatformCapabilities | null;
  status: PlatformCapabilitiesStatus;
  error: string | null;
};

const WINDOWS_DEVELOPMENT_FALLBACK: PlatformCapabilities = {
  os: "windows",
  arch: "x86_64",
  nativeWindowControls: false,
  windowControlPlacement: "rightCustom",
  supportsAppMenu: false,
  supportsDockReopen: false,
  supportsExplorerContextMenu: true,
  supportsFinderQuickAction: false,
  supportsOpenedEvent: false,
  supportsTray: true,
  hotkeyLabel: "Ctrl+Shift+K",
  kimiInstallMode: "windowsManaged",
  releaseChannel: "development",
};

const MACOS_DEVELOPMENT_FALLBACK: PlatformCapabilities = {
  os: "macos",
  arch: "aarch64",
  nativeWindowControls: true,
  windowControlPlacement: "leftNative",
  supportsAppMenu: true,
  supportsDockReopen: true,
  supportsExplorerContextMenu: false,
  supportsFinderQuickAction: false,
  supportsOpenedEvent: false,
  supportsTray: true,
  hotkeyLabel: "⌘⇧K",
  kimiInstallMode: "externalGuided",
  releaseChannel: "development",
};

const PLATFORM_SURFACE_CLOSED_FALLBACK: PlatformCapabilities = {
  ...MACOS_DEVELOPMENT_FALLBACK,
  nativeWindowControls: true,
  windowControlPlacement: "leftNative",
  supportsAppMenu: false,
  supportsDockReopen: false,
  supportsExplorerContextMenu: false,
  supportsTray: false,
  kimiInstallMode: "externalGuided",
};

export const usePlatformCapabilitiesStore = create<PlatformCapabilitiesState>(() => ({
  capabilities: null,
  status: "idle",
  error: null,
}));

let platformCapabilitiesRequest: Promise<PlatformCapabilities> | null = null;

export function loadPlatformCapabilities(): Promise<PlatformCapabilities> {
  const current = usePlatformCapabilitiesStore.getState();
  if (current.capabilities && (current.status === "ready" || current.status === "fallback")) {
    return Promise.resolve(current.capabilities);
  }
  if (platformCapabilitiesRequest) {
    return platformCapabilitiesRequest;
  }

  usePlatformCapabilitiesStore.setState({ status: "loading", error: null });
  const runningInTauri = isTauri();
  platformCapabilitiesRequest = (runningInTauri
    ? invoke<PlatformCapabilities>("get_platform_capabilities")
    : Promise.resolve(WINDOWS_DEVELOPMENT_FALLBACK)
  )
    .then((capabilities) => {
      usePlatformCapabilitiesStore.setState({
        capabilities,
        status: runningInTauri ? "ready" : "fallback",
        error: null,
      });
      return capabilities;
    })
    .catch((error) => {
      const message = String(error);
      const fallback = createPlatformCapabilitiesFallback(
        typeof navigator === "undefined" ? "" : navigator.userAgent,
      );
      usePlatformCapabilitiesStore.setState({
        capabilities: fallback,
        status: "fallback",
        error: message,
      });
      return fallback;
    });

  return platformCapabilitiesRequest;
}

export function createPlatformCapabilitiesFallback(userAgent: string): PlatformCapabilities {
  if (/macintosh|mac os x/i.test(userAgent)) {
    return MACOS_DEVELOPMENT_FALLBACK;
  }
  if (/windows/i.test(userAgent)) {
    return WINDOWS_DEVELOPMENT_FALLBACK;
  }
  return PLATFORM_SURFACE_CLOSED_FALLBACK;
}

export function resetPlatformCapabilitiesStoreForTests() {
  platformCapabilitiesRequest = null;
  usePlatformCapabilitiesStore.setState({
    capabilities: null,
    status: "idle",
    error: null,
  });
}
