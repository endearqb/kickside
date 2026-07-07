import { useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  createDefaultBridgeSecretsMaskView,
  createDefaultBridgeSettings,
  createDefaultBridgeStatus,
} from "@/app/shellControllerDefaults";
import type {
  BindingRecord,
  BridgeApprovalRecord,
  BridgeSecretsMaskView,
  BridgeSessionRecord,
  BridgeSettings,
  BridgeStatus,
} from "@/app/types";

type BridgeRuntimeControllerOptions = {
  setActionError: Dispatch<SetStateAction<string | null>>;
};

export function useBridgeRuntimeController({
  setActionError,
}: BridgeRuntimeControllerOptions) {
  const [bridgeSettings, setBridgeSettings] = useState<BridgeSettings>(
    () => createDefaultBridgeSettings(),
  );
  const [bridgeSettingsSnapshot, setBridgeSettingsSnapshot] =
    useState<BridgeSettings>(() => createDefaultBridgeSettings());
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(
    () => createDefaultBridgeStatus(),
  );
  const [bridgeSessions, setBridgeSessions] = useState<BridgeSessionRecord[]>([]);
  const [bridgeBindings, setBridgeBindings] = useState<BindingRecord[]>([]);
  const [bridgeApprovals, setBridgeApprovals] = useState<BridgeApprovalRecord[]>([]);
  const [bridgeLogTail, setBridgeLogTail] = useState<string[]>([]);
  const [bridgeSecretsMask, setBridgeSecretsMask] =
    useState<BridgeSecretsMaskView>(() => createDefaultBridgeSecretsMaskView());

  async function refreshBridgeSettings() {
    try {
      const data = await invoke<BridgeSettings>("get_bridge_settings");
      setBridgeSettings(data);
      setBridgeSettingsSnapshot(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      return bridgeSettings;
    }
  }

  async function refreshBridgeStatus() {
    try {
      const data = await invoke<BridgeStatus>("get_bridge_status");
      setBridgeStatus(data);
      setActionError(null);
      return data;
    } catch (error) {
      const message = String(error);
      setBridgeStatus((current) => ({
        ...current,
        lastError: message,
      }));
      setActionError(message);
      return bridgeStatus;
    }
  }

  async function refreshBridgeBindings() {
    try {
      const data = await invoke<BindingRecord[]>("list_bridge_bindings");
      setBridgeBindings(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      return bridgeBindings;
    }
  }

  async function refreshBridgeSessions(options?: { silent?: boolean }) {
    try {
      const data = await invoke<BridgeSessionRecord[]>("list_bridge_sessions");
      setBridgeSessions(data);
      return data;
    } catch (error) {
      if (!options?.silent) {
        setActionError(String(error));
      }
      return bridgeSessions;
    }
  }

  async function refreshBridgeApprovals(status = "pending") {
    try {
      const data = await invoke<BridgeApprovalRecord[]>("list_bridge_approvals", {
        status,
      });
      setBridgeApprovals(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      return bridgeApprovals;
    }
  }

  async function refreshBridgeLogTail(maxLines = 80) {
    try {
      const data = await invoke<string[]>("get_bridge_log_tail", {
        maxLines,
      });
      setBridgeLogTail(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      return bridgeLogTail;
    }
  }

  async function refreshBridgeSecretsMask() {
    try {
      const data = await invoke<BridgeSecretsMaskView>("get_bridge_secrets_mask_view");
      setBridgeSecretsMask(data);
      return data;
    } catch (error) {
      setActionError(String(error));
      return bridgeSecretsMask;
    }
  }

  return {
    bridgeSettings,
    setBridgeSettings,
    bridgeSettingsSnapshot,
    setBridgeSettingsSnapshot,
    bridgeStatus,
    setBridgeStatus,
    bridgeSessions,
    setBridgeSessions,
    bridgeBindings,
    setBridgeBindings,
    bridgeApprovals,
    setBridgeApprovals,
    bridgeLogTail,
    setBridgeLogTail,
    bridgeSecretsMask,
    setBridgeSecretsMask,
    refreshBridgeSettings,
    refreshBridgeStatus,
    refreshBridgeSessions,
    refreshBridgeBindings,
    refreshBridgeApprovals,
    refreshBridgeLogTail,
    refreshBridgeSecretsMask,
  };
}
