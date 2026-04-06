export type BackendState =
  | "stopped"
  | "starting"
  | "running"
  | "crashed"
  | "stopping"
  | "missing_kimi";

export type BridgePlatform = "telegram" | "feishu" | "weixin";

export type MainWindowCloseBehavior = "ask" | "exit" | "minimize_to_tray";

export type MainWindowCloseDecision = "exit" | "minimize_to_tray";

export type BridgeChannelMode = "polling" | "websocket";

export type FeishuReplyRenderer = "post" | "interactive";

export type BridgeRuntimeState =
  | "stopped"
  | "starting"
  | "running"
  | "degraded"
  | "stopping"
  | "crashed";

export type BridgeChannelState =
  | "idle"
  | "connecting"
  | "ready"
  | "degraded"
  | "error";

export type WebviewRuntimeKind = "evergreen" | "fixed" | "unknown";

export type MainCreateMode = "auto" | "manual";

export type StartupPhase =
  | "idle"
  | "prefill_surface_shown"
  | "main_boot_requested"
  | "main_build_task_posted"
  | "main_build_task_entered"
  | "main_config_loaded"
  | "main_builder_constructed"
  | "main_build_started"
  | "main_window_created"
  | "main_page_load_started"
  | "main_page_load_finished"
  | "frontend_ready"
  | "failed";

export type StartupFailureKind =
  | "main_thread_task_stalled"
  | "main_webview_build_hung"
  | "frontend_ready_timeout"
  | "main_navigation_failed"
  | "main_window_missing"
  | "main_destroyed_during_startup"
  | "main_close_requested_during_startup";

export type StartupMonitorState =
  | "waiting"
  | "route_workspace"
  | "route_control_center"
  | "failed";

export type StartupMonitorReason =
  | "starting"
  | "onboarding_required"
  | "missing_kimi"
  | "backend_crashed"
  | "backend_ready"
  | "startup_timeout";

export type StartupMonitorTargetRoute =
  | "workspace"
  | "onboarding"
  | "diagnostics"
  | "control_center";

export type LoginProbeState = "logged_in" | "login_required" | "unknown";
export type AuthMode = "kimi_login" | "provider_api" | "unknown";
export type KimiLoginHealthState = "unknown" | "verified" | "auth_required" | "error";
export type KimiLoginHealthSource =
  | "manual_probe"
  | "workspace_api"
  | "backend_startup";

export interface KimiLoginHealth {
  state: KimiLoginHealthState;
  source: KimiLoginHealthSource;
  message: string;
  exitCode?: number;
  checkedAtMs?: number;
  needsAttention: boolean;
}

export type OnboardingStep =
  | "install_kimi"
  | "context_menu"
  | "login_kimi"
  | "work_dir"
  | "api_config"
  | "done";

export type ActionableOnboardingStep = Exclude<OnboardingStep, "done">;

export interface AppStatus {
  instanceId: string;
  pid: number;
  startedAt: string;
  isHotkeyOwner: boolean;
  startCycleId: number;
  state: BackendState;
  activePort?: number;
  workspacePort?: number;
  basePort?: number;
  loadingStartupMs?: number;
  backendReadyMs?: number;
  loadingSlaMet?: boolean;
  message?: string;
  detectedKimiPath?: string;
  configuredKimiPath?: string;
  configuredWorkDir?: string;
  effectiveWorkDir?: string;
  activeSessionId?: string;
  activeSessionWorkDir?: string;
  sessionSource?: string;
  startupAttemptId: number;
  startupPhase: StartupPhase;
  startupFailureKind?: StartupFailureKind;
  startupFailureDetail?: string;
  startupMonitorState?: StartupMonitorState;
  startupMonitorReason?: StartupMonitorReason;
  startupMonitorTargetRoute?: StartupMonitorTargetRoute;
  startupMonitorDetail?: string;
  authMode: AuthMode;
  providerApiConfigured: boolean;
  providerApiActiveProvider?: string;
  kimiLoginHealth: KimiLoginHealth;
  logsDir: string;
  hotkey: string;
}

export interface BridgeConnectorConfig {
  id: string;
  platform: BridgePlatform;
  enabled: boolean;
  mode: BridgeChannelMode;
  label: string;
  defaultWorkDir?: string;
  resetBindingSessionOnStart?: boolean;
  feishuAutoApprove?: boolean;
  feishuReplyRenderer?: FeishuReplyRenderer;
}

export type BridgeChannelConfig = BridgeConnectorConfig;

export interface WorkDirPreset {
  name: string;
  path: string;
}

export interface BridgeSettings {
  enabled: boolean;
  autoStart: boolean;
  adminPort: number;
  feishuReplyRenderer: FeishuReplyRenderer;
  feishuAutoApprove: boolean;
  resetBindingSessionOnBridgeStart: boolean;
  defaultWorkDir?: string;
  workDirPresets: WorkDirPreset[];
  connectors: BridgeConnectorConfig[];
}

export interface BridgeConnectorStatus {
  connectorId: string;
  connectorLabel: string;
  platform: BridgePlatform;
  enabled: boolean;
  state: BridgeChannelState;
  lastHeartbeatAt?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
  lastOffset?: string;
  lastErrorCode?: string;
  lastError?: string;
  lastReadyAt?: string;
  lastFailureAt?: string;
  lastFailureOperation?: string;
  lastFailureRetryable?: boolean;
  consecutiveFailures?: number;
  nextRetryAt?: string;
  lastRecoveryAt?: string;
  recoveryHint?: string;
}

export type BridgeChannelStatus = BridgeConnectorStatus;

export interface BridgeStatus {
  state: BridgeRuntimeState;
  startedAt?: string;
  pid?: number;
  adminPort: number;
  version?: string;
  connectors: BridgeConnectorStatus[];
  pendingApprovals: number;
  bindings: number;
  lastErrorCode?: string;
  lastError?: string;
}

export interface BindingRecord {
  bindingId: string;
  connectorId: string;
  connectorLabel: string;
  platform: BridgePlatform;
  accountId?: string;
  chatId: string;
  threadId?: string;
  kimiSessionId: string;
  workDir?: string;
  onboardedAt?: string;
  onboardingVersion?: string;
  createdAt: string;
  updatedAt: string;
  lastInboundMessageId?: string;
}

export type BridgeSessionSource = "bridge" | "shell_web";

export interface BridgeSessionRecord {
  source: BridgeSessionSource;
  sessionId: string;
  workDir?: string;
  lastMessageAt?: string;
  summary?: string;
  sessionState?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  autoApprove: boolean;
  providerName?: string;
  runtimeMetadataJson?: string;
  createdAt?: string;
  updatedAt?: string;
  switchable: boolean;
  importable: boolean;
}

export interface BridgeSessionImportInput {
  source: BridgeSessionSource;
  sourceSessionId: string;
  workDir?: string;
  summary?: string;
}

export interface BridgeApprovalRecord {
  approvalId: string;
  connectorId: string;
  connectorLabel: string;
  kimiSessionId: string;
  turnId?: string;
  stepId?: string;
  requestKind: string;
  prompt: string;
  platform: BridgePlatform;
  chatId: string;
  threadId?: string;
  status: string;
  requestPayloadJson: string;
  resolutionPayloadJson?: string;
  dedupeKey: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export type SkillApplyScope = "user_global_kimi" | "session_kimi";

export type SkillProjectionMethod = "symlink" | "junction" | "copy";

export type SkillSourceType =
  | "git"
  | "local_import"
  | "bundled"
  | "discovered_import";

export type SkillDiscoveryScope = "user_home" | "workspace";

export type SkillDiscoveryContainerKind = "agents" | "codex" | "claude";

export type SkillUpdateStatusKind =
  | "up_to_date"
  | "update_available"
  | "source_missing"
  | "refresh_available"
  | "unsupported";

export interface SkillUpdateStatusView {
  kind: SkillUpdateStatusKind;
  detail?: string;
  checkedAt?: string;
}

export interface SkillManifestMetadata {
  tags: string[];
  filePatterns: string[];
  workspacePatterns: string[];
  languages: string[];
  recommendedScopes: SkillApplyScope[];
}

export interface SkillDiscoveryLocation {
  scope: SkillDiscoveryScope;
  containerKind: SkillDiscoveryContainerKind;
  containerPath: string;
  skillPath: string;
  workspaceId?: string;
  workspaceLabel?: string;
}

export interface WorkspaceDiscoveryRoot {
  id: string;
  scope: SkillDiscoveryScope;
  path: string;
  label: string;
  lastSeenAt: string;
}

export interface WorkspaceSkillTargetContainerRoot {
  containerKind: SkillDiscoveryContainerKind;
  containerPath: string;
}

export interface WorkspaceSkillTarget {
  id: string;
  scope: SkillDiscoveryScope;
  label: string;
  rootPath: string;
  readOnly: boolean;
  isCurrent: boolean;
  containerRoots: WorkspaceSkillTargetContainerRoot[];
}

export interface WorkspaceManagedSkillRecord {
  skillKey: string;
  name: string;
  description: string;
  projectionName: string;
  hasScripts: boolean;
  skillPath: string;
  containerKind: SkillDiscoveryContainerKind;
  matchedInstalledSkillId?: string;
}

export interface WorkspaceSkillContainerInventory {
  containerKind: SkillDiscoveryContainerKind;
  containerPath: string;
  readOnly: boolean;
  skills: WorkspaceManagedSkillRecord[];
}

export interface WorkspaceSkillInventory {
  target: WorkspaceSkillTarget;
  scannedAt: string;
  containers: WorkspaceSkillContainerInventory[];
}

export interface DiscoveredSkillRecord {
  discoveryId: string;
  name: string;
  description: string;
  canonicalPath: string;
  projectionName: string;
  hasScripts: boolean;
  locations: SkillDiscoveryLocation[];
  importedSkillId?: string;
  lastScannedAt: string;
}

export interface DiscoveredSkillDetail {
  record: DiscoveredSkillRecord;
  relativePaths: string[];
}

export interface SkillDiscoverySnapshot {
  scannedAt: string;
  workspaces: WorkspaceDiscoveryRoot[];
  records: DiscoveredSkillRecord[];
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  sourceType: SkillSourceType;
  sourceLabel: string;
  sourceKey: string;
  sourcePath?: string;
  repoUrl?: string;
  gitRef?: string;
  commit?: string;
  localPath: string;
  projectionName: string;
  trusted: boolean;
  installedAt: string;
  updatedAt: string;
  hasScripts: boolean;
  metadata: SkillManifestMetadata;
  updateStatus: SkillUpdateStatusView;
  discoveryLocations: SkillDiscoveryLocation[];
}

export interface SkillDetail {
  skill: InstalledSkill;
  relativePaths: string[];
  userGlobalApplied: boolean;
  currentSessionApplied: boolean;
}

export interface SkillProjectionRecord {
  skillId: string;
  scope: SkillApplyScope;
  targetPath: string;
  projectionName: string;
  appliedAt: string;
  method: SkillProjectionMethod;
}

export interface SessionSkillState {
  sessionId?: string;
  sessionWorkDir?: string;
  appliedSkillIds: string[];
  projections: SkillProjectionRecord[];
}

export interface WorkspaceSkillProfile {
  workspaceId: string;
  recentSkillIds: string[];
  pinnedSkillIds: string[];
  lastSessionSkillIds: string[];
}

export type SkillCenterSectionId = "manage" | "workspace_insights";
export type SkillCenterFilter =
  | "all"
  | "session"
  | "global"
  | "pinned"
  | "untrusted"
  | "update_available";

export interface SkillApplyResult {
  scope: SkillApplyScope;
  globalSkills: SkillProjectionRecord[];
  activeSession: SessionSkillState;
}

export interface SkillRecommendation {
  skillId: string;
  score: number;
  reasons: string[];
  matchedSignals: string[];
  recommendedScope: SkillApplyScope;
}

export interface WorkspaceSkillRestoreResult {
  skillId: string;
  status:
    | "applied"
    | "skipped_already_applied"
    | "skipped_untrusted"
    | "missing_skill"
    | "failed";
  detail: string;
}

export interface BridgeApprovalResolveInput {
  approvalId: string;
  status: string;
  resolutionPayloadJson?: string;
}

export interface BridgeMaskedSecretValue {
  configured: boolean;
  maskedValue?: string;
}

export interface BridgeTelegramSecretsMaskView {
  botToken: BridgeMaskedSecretValue;
}

export interface BridgeFeishuSecretsMaskView {
  appId: BridgeMaskedSecretValue;
  appSecret: BridgeMaskedSecretValue;
  verificationToken: BridgeMaskedSecretValue;
  encryptKey: BridgeMaskedSecretValue;
}

export interface BridgeWeixinSecretsMaskView {
  botToken: BridgeMaskedSecretValue;
  baseUrl?: string;
  accountId?: string;
  ownerUserId?: string;
}

export interface BridgeSecretsMaskView {
  connectors: BridgeConnectorSecretsMaskView[];
  telegram: BridgeTelegramSecretsMaskView;
  feishu: BridgeFeishuSecretsMaskView;
  weixin: BridgeWeixinSecretsMaskView;
}

export interface BridgeConnectorSecretsMaskView {
  connectorId: string;
  connectorLabel: string;
  platform: BridgePlatform;
  telegram?: BridgeTelegramSecretsMaskView;
  feishu?: BridgeFeishuSecretsMaskView;
  weixin?: BridgeWeixinSecretsMaskView;
}

export interface BridgeConnectorSecretsInput {
  connectorId: string;
  telegram: {
    botToken?: string;
  };
  feishu: {
    appId?: string;
    appSecret?: string;
    verificationToken?: string;
    encryptKey?: string;
  };
  weixin: {
    botToken?: string;
    baseUrl?: string;
    accountId?: string;
    ownerUserId?: string;
  };
}

export interface StartFeishuConnectorOnboardingInput {
  connectorId: string;
}

export type FeishuConnectorOnboardingState =
  | "idle"
  | "awaiting_scan"
  | "polling"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export interface FeishuConnectorOnboardingSession {
  sessionId: string;
  connectorId: string;
  state: FeishuConnectorOnboardingState;
  startedAt: string;
  expiresAt?: string;
  completedAt?: string;
  verificationUrl?: string;
  qrSvg?: string;
  scannerOpenId?: string;
  detailMessage?: string;
  errorMessage?: string;
  appIdMasked?: string;
  lastConfiguredAt?: string;
}

export interface StartWeixinConnectorOnboardingInput {
  connectorId: string;
}

export type WeixinConnectorOnboardingState =
  | "idle"
  | "awaiting_scan"
  | "polling"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled";

export interface WeixinConnectorOnboardingSession {
  sessionId: string;
  connectorId: string;
  state: WeixinConnectorOnboardingState;
  startedAt: string;
  expiresAt?: string;
  completedAt?: string;
  verificationUrl?: string;
  qrSvg?: string;
  detailMessage?: string;
  errorMessage?: string;
  accountId?: string;
  ownerUserId?: string;
  lastConfiguredAt?: string;
}

export interface BridgeOnboardingFeishuInput {
  appId?: string;
  appSecret?: string;
  verificationToken?: string;
  encryptKey?: string;
}

export interface BridgeOnboardingConfigInput {
  enabled: boolean;
  feishuEnabled: boolean;
  autoStart: boolean;
  feishu: BridgeOnboardingFeishuInput;
}

export interface BridgeOnboardingValidation {
  canSave: boolean;
  canStart: boolean;
  message?: string;
}

export interface FrontendReadyAck {
  accepted: boolean;
  backendState: BackendState;
  workspaceUrl?: string;
  startCycleId: number;
  pendingPrefill?: PrefillChatPayload;
}

export interface PrefillChatPayload {
  requestId: string;
  text: string;
  autoSend: boolean;
}

export interface ShellRoutePayload {
  route: string;
  source: string;
}

export interface MainWindowCloseDecisionInput {
  decision: MainWindowCloseDecision;
  remember: boolean;
}

export interface MainWindowCloseDecisionRequestPayload {
  title: string;
  message: string;
  exitLabel: string;
  minimizeLabel: string;
  rememberLabel: string;
}

export interface SubmitPrefillAck {
  accepted: boolean;
  requestId?: string;
  queued: boolean;
  dispatched: boolean;
  textLength: number;
}

export interface StartupMonitorStatus {
  state: StartupMonitorState;
  reason: StartupMonitorReason;
  elapsedMs: number;
  backendState: BackendState;
  detail?: string;
  targetRoute?: StartupMonitorTargetRoute;
}

export type PrefillStatusState = "idle" | "opening_main" | "startup_failed";

export interface PrefillStatusPayload {
  state: PrefillStatusState;
  detail?: string;
}

export interface PrefillBridgeAck {
  source?: string;
  requestId?: string;
  applied?: boolean;
  reason?: string;
}

export interface ShutdownProgressPayload {
  stage: string;
  detail?: string;
  elapsedMs?: number;
}

export interface OpenRequestErrorPayload {
  source: string;
  stage: string;
  message: string;
  argsSummary?: string;
}

export interface WorkspaceSessionBridgePayload {
  action: string;
  source: string;
  requestId?: string;
  sessionId?: string;
  workDir?: string;
  routeTemplate?: string;
  applied?: boolean;
  reason?: string;
}

export interface DiagnosticsInfo {
  instanceId: string;
  pid: number;
  startedAt: string;
  isHotkeyOwner: boolean;
  startCycleId: number;
  state: BackendState;
  activePort?: number;
  workspacePort?: number;
  basePort?: number;
  loadingStartupMs?: number;
  backendReadyMs?: number;
  loadingSlaMet?: boolean;
  configuredKimiPath?: string;
  detectedKimiPath?: string;
  configuredWorkDir?: string;
  effectiveWorkDir?: string;
  launchCommand?: string;
  cliContractOk?: boolean;
  cliContractError?: string;
  kimiVersion?: string;
  versionError?: string;
  lastError?: string;
  lastExitReason?: string;
  webviewRuntimeKind: WebviewRuntimeKind;
  webviewRuntimeVersion?: string;
  startupPending: boolean;
  startupExitCause?: string;
  mainCreateMode: MainCreateMode;
  startupAttemptId: number;
  startupPhase: StartupPhase;
  startupFailureKind?: StartupFailureKind;
  startupFailureDetail?: string;
  startupMonitorState?: StartupMonitorState;
  startupMonitorReason?: StartupMonitorReason;
  startupMonitorTargetRoute?: StartupMonitorTargetRoute;
  startupMonitorDetail?: string;
  authMode: AuthMode;
  providerApiConfigured: boolean;
  providerApiActiveProvider?: string;
  kimiLoginHealth: KimiLoginHealth;
  startupTrace: string[];
  appLogPath: string;
  backendLogPath: string;
  appLogTail: string[];
  backendLogTail: string[];
  logTail: string[];
  logsDir: string;
}

export interface ContextMenuStatus {
  supported: boolean;
  enabled: boolean;
  message?: string;
}

export interface OnboardingStatus {
  currentVersion: number;
  completedVersion: number;
  shouldShowOnboarding: boolean;
  launchBlockedByOnboarding: boolean;
  startupOpenRequestApplied: boolean;
  recommendedStep: OnboardingStep;
  kimiInstalled: boolean;
  detectedKimiPath?: string;
  contextMenuSupported: boolean;
  contextMenuEnabled: boolean;
  contextMenuMessage?: string;
  authMode: AuthMode;
  providerApiConfigured: boolean;
  providerApiActiveProvider?: string;
  kimiLoginHealth: KimiLoginHealth;
  loginState: LoginProbeState;
  loginMessage?: string;
  workDirConfigured: boolean;
  workDir?: string;
  apiConfigAck: boolean;
}

export interface LoginProbeResult {
  state: LoginProbeState;
  message: string;
  kimiPath?: string;
  exitCode?: number;
}

export interface KimiCliApiConfigView {
  configPath: string;
  providerId?: string;
  model?: string;
  baseUrl?: string;
  hasApiKey: boolean;
}

export interface KimiCliApiConfigInput {
  providerId: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export type TypedFieldType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "string_array";

export interface KeyValueEntry {
  key: string;
  value: string;
}

export interface TypedFieldEntry {
  key: string;
  valueType: TypedFieldType;
  value: string;
}

export interface ProviderEntry {
  key: string;
  providerType?: string;
  apiKey?: string;
  baseUrl?: string;
  authToken?: string;
  appId?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  apiVersion?: string;
  deployment?: string;
  modelName?: string;
  env: KeyValueEntry[];
  customHeaders: KeyValueEntry[];
  extraFields: TypedFieldEntry[];
}

export interface ModelEntry {
  key: string;
  provider?: string;
  model?: string;
  maxContextSize?: number;
  capabilities: string[];
  extraFields: TypedFieldEntry[];
}

export interface ServiceEntry {
  key: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  extraFields: TypedFieldEntry[];
}

export interface LoopControlEntry {
  enabled?: boolean;
  maxSteps?: number;
  maxRetries?: number;
  timeoutMs?: number;
  extraFields: TypedFieldEntry[];
}

export interface McpServerEntry {
  key: string;
  command?: string;
  args: string[];
  env: KeyValueEntry[];
  enabled?: boolean;
  workingDirectory?: string;
  timeoutMs?: number;
  extraFields: TypedFieldEntry[];
}

export interface EnvOverrideStatus {
  key: string;
  isSet: boolean;
  maskedValue?: string;
  overrides: string[];
  priority: string;
}

export interface KimiCliConfigCenterInput {
  providers: ProviderEntry[];
  models: ModelEntry[];
  services: ServiceEntry[];
  defaultProvider?: string;
  model?: string;
  defaultModel?: string;
  defaultService?: string;
  defaultEditor?: string;
  defaultYolo?: boolean;
  defaultYoloMode?: string;
  defaultThinking?: boolean;
  defaultThinkingMode?: string;
  localModelDisableAutoPull?: boolean;
  loopControl: LoopControlEntry;
  mcpServers: McpServerEntry[];
}

export interface KimiCliConfigCenterView extends KimiCliConfigCenterInput {
  configPath: string;
  configDir: string;
  dataDir: string;
  dataDirEnvSource?: string;
  envOverrides: EnvOverrideStatus[];
  warnings: string[];
}

export type ConfigCenterSectionId =
  | "overview"
  | "providers"
  | "models"
  | "services"
  | "defaults"
  | "loop_control"
  | "mcp_servers"
  | "env_overrides";

export const PROVIDER_TYPE_OPTIONS = [
  "moonshot",
  "openai",
  "anthropic",
  "azure",
  "openrouter",
  "doubao",
  "siliconflow",
  "deepseek",
  "gemini",
  "vertex_ai",
  "ollama",
  "openai-compatible",
  "custom",
] as const;

export interface InstallProbeStatus {
  wingetReady: boolean;
  gitReady: boolean;
  uvReady: boolean;
  python313Ready: boolean;
  kimiReady: boolean;
  nodeReady: boolean;
  coreReady: boolean;
}

export type InstallTaskId =
  | "quick_install_core"
  | "install_uv"
  | "install_python313"
  | "install_kimi"
  | "upgrade_kimi"
  | "install_git"
  | "install_nodejs";

export type InstallTaskGroup = "core" | "optional" | "upgrade";

export type InstallSource = "official" | "mirror";

export type InstallMirrorPreset = "mixed" | "tuna" | "aliyun" | "custom";

export interface InstallCustomMirrorConfig {
  gitReleasePages: string[];
  uvReleasePages: string[];
  pythonInstallerUrls: string[];
  pypiIndexUrls: string[];
}

export interface InstallSettingsView {
  preferredSource: InstallSource;
  mirrorPreset: InstallMirrorPreset;
  customMirrorConfig: InstallCustomMirrorConfig;
}

export type PowerShellDiagnosticKind =
  | "ok"
  | "execution_policy"
  | "group_policy"
  | "applocker_or_wdac"
  | "constrained_language"
  | "command_launch"
  | "unknown";

export interface PowerShellExecutionPolicyItem {
  scope: string;
  policy: string;
}

export interface PowerShellPreflightSummary {
  kind: PowerShellDiagnosticKind;
  detail: string;
  suggestedFix?: string;
  languageMode?: string;
  smokeTestOk: boolean;
  smokeTestExitCode?: number;
  smokeTestStdout?: string;
  smokeTestStderr?: string;
  executionPolicies: PowerShellExecutionPolicyItem[];
}

export type InstallSessionStatus =
  | "idle"
  | "starting"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "fallback_required";

export type InstallSessionStage =
  | "idle"
  | "prepare"
  | "execute_step"
  | "probe"
  | "done";

export type InstallLogStream = "stdout" | "stderr" | "system";

export interface InstallTaskStep {
  id: string;
  title: string;
  description: string;
  command: string;
}

export interface InstallTaskDefinition {
  id: InstallTaskId;
  title: string;
  description: string;
  group: InstallTaskGroup;
  recommended: boolean;
  runsInApp: boolean;
  requiresElevation: boolean;
  optional: boolean;
  fallbackReason?: string;
  officialSteps: InstallTaskStep[];
  mirrorSteps: InstallTaskStep[];
}

export interface InstallFlowCatalog {
  tasks: InstallTaskDefinition[];
}

export interface InstallLogChunk {
  taskId: InstallTaskId;
  stepId?: string;
  source: InstallSource;
  stream: InstallLogStream;
  text: string;
  at: string;
}

export interface InstallSessionSnapshot {
  status: InstallSessionStatus;
  stage: InstallSessionStage;
  taskId?: InstallTaskId;
  source?: InstallSource;
  title?: string;
  currentStepId?: string;
  currentStepTitle?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  message?: string;
  failureSummary?: string;
  lastStdout?: string;
  lastStderr?: string;
  fallbackReason?: string;
  powershellDiagnostic?: PowerShellPreflightSummary;
  logsTruncated: boolean;
  probe?: InstallProbeStatus;
  logs: InstallLogChunk[];
}

export type InstallSessionEvent =
  | { event: "snapshot"; snapshot: InstallSessionSnapshot }
  | { event: "log"; chunk: InstallLogChunk };

export function createEmptyInstallSessionSnapshot(): InstallSessionSnapshot {
  return {
    status: "idle",
    stage: "idle",
    logsTruncated: false,
    logs: [],
  };
}

export interface InstallCommandEntry {
  id: string;
  title: string;
  description: string;
  source: "official" | "mirror" | "shared";
  requiresElevation: boolean;
  steps: InstallCommandStep[];
}

export interface InstallCommandStep {
  id: string;
  title: string;
  description: string;
  command: string;
}

export interface InstallCommandCatalog {
  entries: InstallCommandEntry[];
}

export type Screen = "loading" | "control_center" | "workspace";

export type WorkspaceViewKind = "code" | "chat";

export type WorkspaceLayoutMode = "single" | "split";

export type WorkspaceSplitOrder = "code_left" | "chat_left";

export type WorkspacePaneState = "idle" | "loading" | "ready" | "blocked";

export type WorkspaceEmbedState = WorkspacePaneState;

export type Theme = "light" | "dark";

export type ControlSectionId =
  | "overview"
  | "onboarding"
  | "runtime_center"
  | "bridge_center"
  | "skill_center";

export type RuntimePanelId = "core" | "paths" | "logs" | "bridge";

export type ControlCenterSurface = "fullscreen" | "modal";

export type ControlCenterTaskId =
  | "config_center"
  | "bridge_connector_secrets"
  | "bridge_runtime"
  | "skill_git_import"
  | "skill_import";

export interface ControlCenterTaskPayload {
  connectorId?: string;
}

export type ControlCenterChrome = "full";

export const ONBOARDING_STEP_ORDER: ActionableOnboardingStep[] = [
  "install_kimi",
  "context_menu",
  "login_kimi",
  "work_dir",
  "api_config",
];

export function stepTitle(step: OnboardingStep): string {
  switch (step) {
    case "install_kimi":
      return "安装 Kimi CLI";
    case "context_menu":
      return "启用右键菜单";
    case "login_kimi":
      return "登录 Kimi";
    case "work_dir":
      return "设置工作目录";
    case "api_config":
      return "配置 Provider API";
    default:
      return "完成";
  }
}

export function formatLoginState(state?: LoginProbeState): string {
  if (state === "logged_in") return "已登录";
  if (state === "login_required") return "需要登录";
  return "未知";
}

export function formatAuthMode(mode?: AuthMode): string {
  if (mode === "kimi_login") return "Kimi 登录";
  if (mode === "provider_api") return "Provider API";
  return "未知";
}

export function formatKimiLoginHealthState(state?: KimiLoginHealthState): string {
  if (state === "verified") return "已验证";
  if (state === "auth_required") return "需要重新登录";
  if (state === "error") return "检测异常";
  return "未知";
}

export function formatKimiLoginHealthSource(source?: KimiLoginHealthSource): string {
  if (source === "manual_probe") return "手动检测";
  if (source === "workspace_api") return "工作区接口";
  return "启动回填";
}

export function formatBackendState(state?: BackendState): string {
  if (!state) return "Unknown";
  if (state === "missing_kimi") return "Missing Kimi";
  return state
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}
