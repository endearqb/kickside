import { useEffect, useRef } from "react";
import type {
  BridgeRuntimeState,
  ControlSectionId,
  ControlCenterTaskId,
  RuntimePanelId,
} from "@/app/types";

const ACTIVE_STATUS_POLL_MS = 1000;
const BACKGROUND_STATUS_POLL_MS = 5000;
const ACTIVE_BRIDGE_POLL_MS = 1500;
const BACKGROUND_BRIDGE_POLL_MS = 10_000;

type PollingCallbacks = {
  refreshStatus: () => Promise<unknown>;
  refreshOnboarding: () => Promise<unknown>;
  refreshInstallSettings: () => Promise<unknown>;
  refreshWorkspaceWebSettings: () => Promise<unknown>;
  refreshPowerShellPreflight: () => Promise<unknown>;
  refreshBridgeSettings: () => Promise<unknown>;
  refreshBridgeStatus: () => Promise<unknown>;
  refreshBridgeSecretsMask: () => Promise<unknown>;
  refreshBridgeBindings: () => Promise<unknown>;
  refreshBridgeApprovals: () => Promise<unknown>;
  refreshBridgeLogTail: () => Promise<unknown>;
  refreshMainWindowCloseBehavior: () => Promise<unknown>;
};

type ShellPollingControllerOptions = PollingCallbacks & {
  tauriRuntime: boolean;
  screen: string;
  controlCenterModalOpen: boolean;
  activeControlSection: ControlSectionId;
  activeControlTask: ControlCenterTaskId | null;
  activeRuntimePanel: RuntimePanelId;
  bridgeState: BridgeRuntimeState;
};

export function useShellPollingController(options: ShellPollingControllerOptions) {
  const callbacksRef = useRef<PollingCallbacks>(options);
  callbacksRef.current = options;

  const {
    tauriRuntime,
    screen,
    controlCenterModalOpen,
    activeControlSection,
    activeControlTask,
    activeRuntimePanel,
    bridgeState,
  } = options;

  useEffect(() => {
    const callbacks = callbacksRef.current;
    if (!tauriRuntime) {
      void callbacks.refreshStatus();
    }
    void callbacks.refreshOnboarding();
    void callbacks.refreshInstallSettings();
    void callbacks.refreshWorkspaceWebSettings();
    void callbacks.refreshPowerShellPreflight();
    void callbacks.refreshBridgeSettings();
    void callbacks.refreshBridgeStatus();
    void callbacks.refreshMainWindowCloseBehavior();

    const statusPollMs =
      screen === "loading" || screen === "control_center" || controlCenterModalOpen
        ? ACTIVE_STATUS_POLL_MS
        : BACKGROUND_STATUS_POLL_MS;
    const timer = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }
      void callbacksRef.current.refreshStatus();
    }, statusPollMs);
    return () => window.clearInterval(timer);
  }, [controlCenterModalOpen, screen, tauriRuntime]);

  useEffect(() => {
    const controlCenterVisible = screen === "control_center" || controlCenterModalOpen;
    const bridgeControlsVisible =
      controlCenterVisible &&
      (activeControlSection === "onboarding" ||
        activeControlTask === "bridge_connector_secrets" ||
        activeControlTask === "bridge_runtime" ||
        (activeControlSection === "runtime_center" &&
          activeRuntimePanel === "bridge"));
    const bridgePanelVisible = isBridgePanelVisible(
      controlCenterVisible,
      activeControlSection,
      activeControlTask,
      activeRuntimePanel,
    );

    const callbacks = callbacksRef.current;
    if (bridgeControlsVisible) {
      void callbacks.refreshBridgeSettings();
      void callbacks.refreshBridgeStatus();
      void callbacks.refreshBridgeSecretsMask();
    }
    if (bridgePanelVisible) {
      void callbacks.refreshBridgeBindings();
      void callbacks.refreshBridgeApprovals();
      void callbacks.refreshBridgeLogTail();
    }
  }, [
    activeControlSection,
    activeControlTask,
    activeRuntimePanel,
    controlCenterModalOpen,
    screen,
  ]);

  useEffect(() => {
    const controlCenterVisible = screen === "control_center" || controlCenterModalOpen;
    if (!controlCenterVisible && bridgeState === "stopped") {
      return;
    }

    const bridgePollMs = controlCenterVisible
      ? ACTIVE_BRIDGE_POLL_MS
      : BACKGROUND_BRIDGE_POLL_MS;
    const timer = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }
      const callbacks = callbacksRef.current;
      void callbacks.refreshBridgeStatus();
      if (isBridgePanelVisible(controlCenterVisible, activeControlSection, activeControlTask, activeRuntimePanel)) {
        void callbacks.refreshBridgeBindings();
        void callbacks.refreshBridgeApprovals();
        void callbacks.refreshBridgeLogTail();
      }
    }, bridgePollMs);

    return () => window.clearInterval(timer);
  }, [
    activeControlSection,
    activeControlTask,
    activeRuntimePanel,
    bridgeState,
    controlCenterModalOpen,
    screen,
  ]);
}

function isBridgePanelVisible(
  controlCenterVisible: boolean,
  activeControlSection: ControlSectionId,
  activeControlTask: ControlCenterTaskId | null,
  activeRuntimePanel: RuntimePanelId,
): boolean {
  return (
    controlCenterVisible &&
    (activeControlTask === "bridge_runtime" ||
      (activeControlSection === "runtime_center" && activeRuntimePanel === "bridge"))
  );
}

function isDocumentVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}
