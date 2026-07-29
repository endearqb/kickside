import type {
  BridgeConnectorConfig,
  BridgeOnboardingConfigInput,
  BridgeOnboardingValidation,
  BridgeSecretsMaskView,
  BridgeSettings,
  BridgeStatus,
  InstallCustomMirrorConfig,
  InstallSettingsView,
  KimiCodeAccessConfigInput,
  KimiCodeAccessConfigView,
  SessionSkillState,
  WorkspaceSkillProfile,
  WorkspaceWebSettingsView,
} from "@/app/types";

const KIMI_CODING_PLAN_BASE_URL = "https://api.kimi.com/coding/v1";
const KIMI_CODING_PLAN_SEARCH_URL = "https://api.kimi.com/coding/v1/search";
const KIMI_CODING_PLAN_FETCH_URL = "https://api.kimi.com/coding/v1/fetch";
export function createDefaultBridgeConnector(
  platform: "telegram" | "feishu" | "weixin",
  index = 1,
): BridgeConnectorConfig {
  const base =
    platform === "telegram" ? "telegram" : platform === "feishu" ? "feishu" : "weixin";
  const label =
    platform === "telegram"
      ? `Telegram 机器人 ${String(index).padStart(2, "0")}`
      : platform === "feishu"
        ? `飞书机器人 ${String(index).padStart(2, "0")}`
        : `微信机器人 ${String(index).padStart(2, "0")}`;
  return {
    id: index <= 1 ? `${base}-default` : `${base}-${index}`,
    platform,
    enabled: false,
    mode: platform === "feishu" ? "websocket" : "polling",
    label,
    defaultWorkDir: undefined,
    resetBindingSessionOnStart: true,
    feishuAutoApprove: platform === "feishu" ? false : undefined,
    feishuReplyRenderer: platform === "feishu" ? "streaming" : undefined,
    weixinReplyMode: platform === "weixin" ? "status_only" : undefined,
  };
}

export function getBridgePlatformConnectors(
  settings: BridgeSettings,
  platform: "telegram" | "feishu" | "weixin",
): BridgeConnectorConfig[] {
  return settings.connectors.filter((connector) => connector.platform === platform);
}

export function createEmptyKimiCodeAccessInput(): KimiCodeAccessConfigInput {
  return {
    expectedConfigFingerprint: undefined,
    providerBaseUrl: KIMI_CODING_PLAN_BASE_URL,
    providerApiKey: undefined,
    clearProviderApiKey: false,
    defaultModel: "kimi-code/k3",
    searchBaseUrl: KIMI_CODING_PLAN_SEARCH_URL,
    searchApiKeyMode: "reuse_provider",
    searchApiKey: undefined,
    fetchBaseUrl: KIMI_CODING_PLAN_FETCH_URL,
    fetchApiKeyMode: "reuse_provider",
    fetchApiKey: undefined,
    agentSwarmMaxConcurrency: undefined,
    clearAgentSwarmMaxConcurrency: false,
  };
}

export function serviceModeFromView(
  configured: boolean,
  usesProviderApiKey: boolean,
): KimiCodeAccessConfigInput["searchApiKeyMode"] {
  if (usesProviderApiKey) return "reuse_provider";
  if (configured) return "keep_existing";
  return "reuse_provider";
}

export function toKimiCodeAccessInput(view: KimiCodeAccessConfigView): KimiCodeAccessConfigInput {
  return {
    expectedConfigFingerprint: view.configFingerprint,
    providerBaseUrl: view.provider.baseUrl ?? KIMI_CODING_PLAN_BASE_URL,
    providerApiKey: undefined,
    clearProviderApiKey: false,
    defaultModel:
      view.defaultModel ??
      view.models.find((model) => model.id === "kimi-code/k3")?.id ??
      view.models[0]?.id ??
      "kimi-code/k3",
    searchBaseUrl: view.services.search.baseUrl ?? KIMI_CODING_PLAN_SEARCH_URL,
    searchApiKeyMode: serviceModeFromView(
      view.services.search.apiKeyConfigured,
      view.services.search.usesProviderApiKey,
    ),
    searchApiKey: undefined,
    fetchBaseUrl: view.services.fetch.baseUrl ?? KIMI_CODING_PLAN_FETCH_URL,
    fetchApiKeyMode: serviceModeFromView(
      view.services.fetch.apiKeyConfigured,
      view.services.fetch.usesProviderApiKey,
    ),
    fetchApiKey: undefined,
    agentSwarmMaxConcurrency: view.runtimeLimits.agentSwarmMaxConcurrency,
    clearAgentSwarmMaxConcurrency: view.runtimeLimits.agentSwarmMaxConcurrency == null,
  };
}

export function cloneKimiCodeAccessInput(
  input: KimiCodeAccessConfigInput,
): KimiCodeAccessConfigInput {
  return JSON.parse(JSON.stringify(input)) as KimiCodeAccessConfigInput;
}

export function formatKimiCodeAccessSaveError(error: unknown): string {
  const message = String(error);
  return message.includes("config_conflict:")
    ? "配置已被其他程序修改。当前输入已保留；请先复制需要保留的内容，再重新打开配置面板加载最新版。"
    : message;
}

export function parseHashRoute(hash: string): string {
  return hash.replace(/^#\/?/, "");
}

export function buildSkillUninstallConfirmMessage(label: string, projectionCount: number) {
  return `确定卸载“${label}”吗？当前记录的投影数量：${projectionCount}。如果它仍应用在全局或 Session 中，系统会先阻止卸载。`;
}

export function createDefaultInstallMirrorConfig(): InstallCustomMirrorConfig {
  return {
    gitReleasePages: [],
    uvReleasePages: [],
    pythonInstallerUrls: [],
    pypiIndexUrls: [],
  };
}

export function createDefaultInstallSettingsView(): InstallSettingsView {
  return {
    preferredSource: "official",
    mirrorPreset: "mixed",
    customMirrorConfig: createDefaultInstallMirrorConfig(),
  };
}

export function createDefaultBridgeSettings(): BridgeSettings {
  return {
    enabled: false,
    autoStart: false,
    adminPort: 60110,
    feishuReplyRenderer: "streaming",
    feishuAutoApprove: false,
    resetBindingSessionOnBridgeStart: true,
    defaultWorkDir: "",
    workDirPresets: [],
    connectors: [
      createDefaultBridgeConnector("feishu"),
      createDefaultBridgeConnector("weixin"),
    ],
  };
}

export function createDefaultWorkspaceWebSettings(): WorkspaceWebSettingsView {
  return {
    mode: "official",
    autoFallback: true,
    sourceCommit: undefined,
    health: {
      state: "not_configured",
      message: "尚未读取本地增强版状态。",
    },
    disclaimer:
      "本地增强版基于 MoonshotAI/kimi-cli 开源 Web 构建，由本应用维护；不代表 MoonshotAI 官方背书。",
  };
}

export function createDefaultBridgeStatus(): BridgeStatus {
  return {
    state: "stopped",
    adminPort: 60110,
    version: undefined,
    kimiRuntimeLocator: {
      configured: false,
      readable: false,
    },
    runtimeAdapter: {
      name: "server",
      state: "unavailable",
    },
    agentRoom: {
      enabled: false,
      core: "disabled",
      observer: "disabled",
      activeRuns: 0,
      queueDepth: 0,
      observedSessions: 0,
      databaseVersion: 0,
      activeLeases: 0,
      pendingApprovals: 0,
      paneGeneration: 0,
      degradations: ["feature_disabled"],
    },
    connectors: [],
    pendingApprovals: 0,
    bindings: 0,
    lastErrorCode: undefined,
    lastError: undefined,
  };
}

export function createEmptySessionSkillState(): SessionSkillState {
  return {
    appliedSkillIds: [],
    projections: [],
  };
}

export function createEmptyWorkspaceSkillProfile(): WorkspaceSkillProfile | null {
  return null;
}

export function formatBridgeErrorEntry(
  errorCode: string | null | undefined,
  message: string | null | undefined,
  prefix?: string,
): string | null {
  const trimmedMessage = message?.trim();
  const trimmedCode = errorCode?.trim();
  if (!trimmedMessage && !trimmedCode) {
    return null;
  }

  const parts: string[] = [];
  if (prefix) {
    parts.push(prefix);
  }
  if (trimmedCode) {
    parts.push(`[${trimmedCode}]`);
  }
  if (trimmedMessage) {
    parts.push(trimmedMessage);
  }
  return parts.join(" ").trim();
}

export function createDefaultBridgeSecretsMaskView(): BridgeSecretsMaskView {
  return {
    connectors: [],
    telegram: {
      botToken: {
        configured: false,
      },
    },
    feishu: {
      appId: {
        configured: false,
      },
      appSecret: {
        configured: false,
      },
      verificationToken: {
        configured: false,
      },
      encryptKey: {
        configured: false,
      },
    },
    weixin: {
      botToken: {
        configured: false,
      },
    },
  };
}

export function getBridgeChannelEnabled(
  settings: BridgeSettings,
  platform: "telegram" | "feishu" | "weixin",
): boolean {
  return getBridgePlatformConnectors(settings, platform).some((connector) => connector.enabled);
}

export function createDefaultBridgeOnboardingConfigInput(
  settings: BridgeSettings = createDefaultBridgeSettings(),
): BridgeOnboardingConfigInput {
  return {
    enabled: settings.enabled,
    feishuEnabled: getBridgeChannelEnabled(settings, "feishu"),
    autoStart: settings.autoStart,
    feishu: {
      appId: "",
      appSecret: "",
      verificationToken: "",
      encryptKey: "",
    },
  };
}

export function hasBridgeDraftSecretValue(value?: string): boolean {
  return Boolean(value?.trim());
}

export function createBridgeOnboardingValidation(
  draft: BridgeOnboardingConfigInput,
  secretsMask: BridgeSecretsMaskView,
  dirty: boolean,
): BridgeOnboardingValidation {
  const draftHasFeishuSecrets =
    hasBridgeDraftSecretValue(draft.feishu.appId) &&
    hasBridgeDraftSecretValue(draft.feishu.appSecret);
  const savedHasFeishuSecrets =
    secretsMask.connectors.some(
      (connector) =>
        connector.platform === "feishu" &&
        connector.feishu?.appId.configured &&
        connector.feishu?.appSecret.configured,
    ) ||
    (secretsMask.feishu.appId.configured && secretsMask.feishu.appSecret.configured);
  const wantsEnabled = draft.enabled || draft.feishuEnabled;

  if (draft.feishuEnabled && !draftHasFeishuSecrets && !savedHasFeishuSecrets) {
    return {
      canSave: false,
      canStart: false,
      message: "启用 Feishu 前需要至少一个已配置 appId/appSecret 的飞书机器人。",
    };
  }

  if (!wantsEnabled) {
    return {
      canSave: true,
      canStart: false,
        message: "这是可选配置；保存并启用外部 IM 通道后，才能从这里直接启动 bridge。",
    };
  }

  if (dirty) {
    return {
      canSave: true,
      canStart: false,
        message: "存在未保存的外部 IM 通道配置，请先点击“保存并启用”再启动 bridge。",
    };
  }

  return {
    canSave: true,
    canStart: true,
    message:
      "配置已就绪；现在只能说明 sidecar 可以尝试建立飞书长连接，是否被平台识别为已连接仍取决于长连接和应用权限。",
  };
}
