use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

pub const CURRENT_ONBOARDING_VERSION: u32 = 1;
pub const CURRENT_SETTINGS_SCHEMA_VERSION: u32 = 10;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackendState {
    Stopped,
    Starting,
    Running,
    Crashed,
    Stopping,
    MissingKimi,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeOwnership {
    OwnedByShell,
    ReusedExternal,
    Unavailable,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum BridgePlatform {
    Telegram,
    Feishu,
    Weixin,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BridgeChannelMode {
    Polling,
    Websocket,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum FeishuReplyRenderer {
    Post,
    Interactive,
    #[default]
    Streaming,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WeixinReplyMode {
    FinalOnly,
    #[default]
    StatusOnly,
    StreamingExperimental,
}

fn default_feishu_auto_approve() -> bool {
    false
}

fn default_reset_binding_session_on_bridge_start() -> bool {
    true
}

fn bridge_skills_mode_is_disabled(value: &BridgeSkillsMode) -> bool {
    matches!(value, BridgeSkillsMode::Disabled)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BridgeRuntimeState {
    Stopped,
    Starting,
    Running,
    Degraded,
    Stopping,
    Crashed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BridgeChannelState {
    Idle,
    Connecting,
    Ready,
    Degraded,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WebviewRuntimeKind {
    Evergreen,
    Fixed,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MainCreateMode {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceWebMode {
    #[default]
    Official,
    EnhancedLocal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum EnhancedWebHealthState {
    #[default]
    NotConfigured,
    Ready,
    MissingAssets,
    FallbackActive,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct EnhancedWebHealth {
    pub state: EnhancedWebHealthState,
    pub message: String,
    pub source_commit: Option<String>,
    pub checked_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum MainWindowCloseBehavior {
    #[default]
    Ask,
    Exit,
    MinimizeToTray,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MainWindowCloseDecision {
    Exit,
    MinimizeToTray,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupPhase {
    Idle,
    PrefillSurfaceShown,
    MainBootRequested,
    MainBuildTaskPosted,
    MainBuildTaskEntered,
    MainConfigLoaded,
    MainBuilderConstructed,
    MainBuildStarted,
    MainWindowCreated,
    MainPageLoadStarted,
    MainPageLoadFinished,
    FrontendReady,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupFailureKind {
    MainThreadTaskStalled,
    MainWebviewBuildHung,
    FrontendReadyTimeout,
    MainNavigationFailed,
    MainWindowMissing,
    MainDestroyedDuringStartup,
    MainCloseRequestedDuringStartup,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupMonitorState {
    Waiting,
    RouteWorkspace,
    RouteControlCenter,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupMonitorReason {
    Starting,
    OnboardingRequired,
    MissingKimi,
    BackendCrashed,
    BackendReady,
    StartupTimeout,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StartupMonitorTargetRoute {
    Workspace,
    Onboarding,
    Diagnostics,
    ControlCenter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMonitorStatus {
    pub state: StartupMonitorState,
    pub reason: StartupMonitorReason,
    pub elapsed_ms: u64,
    pub backend_state: BackendState,
    pub detail: Option<String>,
    pub target_route: Option<StartupMonitorTargetRoute>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub instance_id: String,
    pub pid: u32,
    pub started_at: String,
    pub is_hotkey_owner: bool,
    pub start_cycle_id: u64,
    pub state: BackendState,
    pub runtime_ownership: RuntimeOwnership,
    pub active_port: Option<u16>,
    pub workspace_port: Option<u16>,
    pub base_port: Option<u16>,
    pub loading_startup_ms: Option<u64>,
    pub backend_ready_ms: Option<u64>,
    pub loading_sla_met: Option<bool>,
    pub message: Option<String>,
    pub detected_kimi_path: Option<String>,
    pub configured_kimi_path: Option<String>,
    pub configured_work_dir: Option<String>,
    pub effective_work_dir: Option<String>,
    pub active_session_id: Option<String>,
    pub active_session_work_dir: Option<String>,
    pub session_source: Option<String>,
    pub runtime_origin: Option<String>,
    pub server_token_path: Option<String>,
    pub server_token_redacted: Option<String>,
    pub workspace_url: Option<String>,
    pub workspace_url_redacted: Option<String>,
    pub startup_attempt_id: u64,
    pub startup_phase: StartupPhase,
    pub startup_failure_kind: Option<StartupFailureKind>,
    pub startup_failure_detail: Option<String>,
    pub startup_monitor_state: Option<StartupMonitorState>,
    pub startup_monitor_reason: Option<StartupMonitorReason>,
    pub startup_monitor_target_route: Option<StartupMonitorTargetRoute>,
    pub startup_monitor_detail: Option<String>,
    pub auth_mode: AuthMode,
    pub provider_api_configured: bool,
    pub provider_api_active_provider: Option<String>,
    pub kimi_login_health: KimiLoginHealth,
    pub provider_api_health: ProviderApiHealth,
    pub workspace_web_mode: WorkspaceWebMode,
    pub enhanced_web_source_commit: Option<String>,
    pub enhanced_web_health: EnhancedWebHealth,
    pub enhanced_web_last_fallback_reason: Option<String>,
    pub logs_dir: String,
    pub hotkey: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendReadyAck {
    pub accepted: bool,
    pub backend_state: BackendState,
    pub workspace_url: Option<String>,
    pub start_cycle_id: u64,
    pub pending_prefill: Option<PrefillChatPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefillChatPayload {
    pub request_id: String,
    pub text: String,
    pub auto_send: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellRoutePayload {
    pub route: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitPrefillAck {
    pub accepted: bool,
    pub request_id: Option<String>,
    pub queued: bool,
    pub dispatched: bool,
    pub text_length: usize,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrefillStatusState {
    Idle,
    OpeningMain,
    StartupFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefillStatusPayload {
    pub state: PrefillStatusState,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShutdownProgressPayload {
    pub stage: String,
    pub detail: Option<String>,
    pub elapsed_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequestErrorPayload {
    pub source: String,
    pub stage: String,
    pub message: String,
    pub args_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionBridgePayload {
    pub action: String,
    pub source: String,
    pub request_id: Option<String>,
    pub session_id: Option<String>,
    pub work_dir: Option<String>,
    pub route_template: Option<String>,
    pub disposition: Option<WorkspaceSessionDisposition>,
    pub target_window_label: Option<String>,
    pub applied: Option<bool>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSessionDisposition {
    ReplaceActive,
    NewPane,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceImportTargetKind {
    Current,
    Default,
    Known,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImportTarget {
    pub id: String,
    pub label: String,
    pub root_path: String,
    pub kind: WorkspaceImportTargetKind,
    pub is_current: bool,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImportRequestPayload {
    pub request_id: String,
    pub source: String,
    pub item_count: usize,
    pub item_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImportTargetInput {
    pub root_path: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceImportResult {
    pub request_id: String,
    pub source: String,
    pub target_path: String,
    pub target_label: String,
    pub imported_count: usize,
    pub imported_names: Vec<String>,
    pub current_workspace_match: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: u32,
    pub kimi_path: Option<String>,
    pub work_dir: Option<String>,
    pub hotkey: String,
    pub workspace_web_mode: WorkspaceWebMode,
    pub enhanced_web_auto_fallback: bool,
    pub enhanced_web_pinned_commit: Option<String>,
    pub enhanced_web_last_known_good_commit: Option<String>,
    pub enhanced_web_last_fallback_reason: Option<String>,
    pub main_window_close_behavior: MainWindowCloseBehavior,
    pub start_minimized_to_tray: bool,
    pub auto_restart_on_crash: bool,
    #[serde(rename = "bridge_enabled")]
    pub bridge_enabled: bool,
    #[serde(rename = "bridge_auto_start")]
    pub bridge_auto_start: bool,
    #[serde(rename = "bridge_admin_port_override")]
    pub bridge_admin_port_override: Option<u16>,
    pub onboarding_completed_version: u32,
    pub onboarding_step_acks: OnboardingStepAcks,
    pub preferred_install_source: InstallSource,
    pub mirror_preset: InstallMirrorPreset,
    pub custom_mirror_config: InstallCustomMirrorConfig,
    pub kimi_runtime_launch: KimiRuntimeLaunchSettings,
    pub context_menu_desired_enabled: bool,
    pub context_menu_labels: ContextMenuLabelsInput,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SETTINGS_SCHEMA_VERSION,
            kimi_path: None,
            work_dir: None,
            hotkey: "CmdOrCtrl+Shift+K".to_string(),
            workspace_web_mode: WorkspaceWebMode::Official,
            enhanced_web_auto_fallback: true,
            enhanced_web_pinned_commit: None,
            enhanced_web_last_known_good_commit: None,
            enhanced_web_last_fallback_reason: None,
            main_window_close_behavior: MainWindowCloseBehavior::Ask,
            start_minimized_to_tray: false,
            auto_restart_on_crash: false,
            bridge_enabled: false,
            bridge_auto_start: false,
            bridge_admin_port_override: None,
            onboarding_completed_version: 0,
            onboarding_step_acks: OnboardingStepAcks::default(),
            preferred_install_source: InstallSource::Official,
            mirror_preset: InstallMirrorPreset::Mixed,
            custom_mirror_config: InstallCustomMirrorConfig::default(),
            kimi_runtime_launch: KimiRuntimeLaunchSettings::default(),
            context_menu_desired_enabled: true,
            context_menu_labels: ContextMenuLabelsInput::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct KimiRuntimeLaunchSettings {
    pub agent_swarm_max_concurrency: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWebSettingsView {
    pub mode: WorkspaceWebMode,
    pub auto_fallback: bool,
    pub pinned_commit: Option<String>,
    pub last_known_good_commit: Option<String>,
    pub last_fallback_reason: Option<String>,
    pub source_commit: Option<String>,
    pub health: EnhancedWebHealth,
    pub disclaimer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWebSettingsInput {
    pub mode: WorkspaceWebMode,
    pub auto_fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowCloseDecisionInput {
    pub decision: MainWindowCloseDecision,
    pub remember: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowCloseDecisionRequestPayload {
    pub title: String,
    pub message: String,
    pub exit_label: String,
    pub minimize_label: String,
    pub remember_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConnectorConfig {
    #[serde(default)]
    pub id: String,
    pub platform: BridgePlatform,
    pub enabled: bool,
    pub mode: BridgeChannelMode,
    #[serde(default, alias = "accountLabel")]
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_work_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_binding_session_on_start: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feishu_auto_approve: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feishu_reply_renderer: Option<FeishuReplyRenderer>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weixin_reply_mode: Option<WeixinReplyMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkDirPreset {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSettings {
    pub enabled: bool,
    pub auto_start: bool,
    pub admin_port: u16,
    #[serde(default, skip_serializing_if = "bridge_skills_mode_is_disabled")]
    pub skills_mode: BridgeSkillsMode,
    #[serde(default)]
    pub feishu_reply_renderer: FeishuReplyRenderer,
    #[serde(default = "default_feishu_auto_approve")]
    pub feishu_auto_approve: bool,
    #[serde(default = "default_reset_binding_session_on_bridge_start")]
    pub reset_binding_session_on_bridge_start: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feishu_reply_cards: Option<bool>,
    pub default_work_dir: Option<String>,
    #[serde(default)]
    pub work_dir_presets: Vec<WorkDirPreset>,
    #[serde(default, alias = "channels")]
    pub connectors: Vec<BridgeConnectorConfig>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum BridgeSkillsMode {
    #[default]
    Disabled,
    FollowDefaultWorkDir,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BridgeSessionSource {
    Bridge,
    ShellWeb,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSessionRecord {
    pub source: BridgeSessionSource,
    pub session_id: String,
    pub work_dir: Option<String>,
    pub last_message_at: Option<String>,
    pub summary: Option<String>,
    pub session_state: Option<String>,
    pub lease_owner: Option<String>,
    pub lease_expires_at: Option<String>,
    pub auto_approve: bool,
    pub provider_name: Option<String>,
    pub runtime_metadata_json: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub switchable: bool,
    pub importable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSessionImportInput {
    pub source: BridgeSessionSource,
    pub source_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeTelegramSecrets {
    pub bot_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeFeishuSecrets {
    pub app_id: Option<String>,
    pub app_secret: Option<String>,
    pub verification_token: Option<String>,
    pub encrypt_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeWeixinSecrets {
    pub bot_token: Option<String>,
    pub base_url: Option<String>,
    pub account_id: Option<String>,
    pub owner_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeConnectorSecrets {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telegram: Option<BridgeTelegramSecrets>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feishu: Option<BridgeFeishuSecrets>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weixin: Option<BridgeWeixinSecrets>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeSecrets {
    #[serde(default)]
    pub connectors: BTreeMap<String, BridgeConnectorSecrets>,
    pub telegram: BridgeTelegramSecrets,
    pub feishu: BridgeFeishuSecrets,
    pub weixin: BridgeWeixinSecrets,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeConnectorSecretsInput {
    pub connector_id: String,
    pub telegram: BridgeTelegramSecrets,
    pub feishu: BridgeFeishuSecrets,
    pub weixin: BridgeWeixinSecrets,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartFeishuConnectorOnboardingInput {
    pub connector_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FeishuConnectorOnboardingState {
    Idle,
    AwaitingScan,
    Polling,
    Succeeded,
    Failed,
    Expired,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeishuConnectorOnboardingSession {
    pub session_id: String,
    pub connector_id: String,
    pub state: FeishuConnectorOnboardingState,
    pub started_at: String,
    pub expires_at: Option<String>,
    pub completed_at: Option<String>,
    pub verification_url: Option<String>,
    pub qr_svg: Option<String>,
    pub scanner_open_id: Option<String>,
    pub detail_message: Option<String>,
    pub error_message: Option<String>,
    pub app_id_masked: Option<String>,
    pub last_configured_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartWeixinConnectorOnboardingInput {
    pub connector_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WeixinConnectorOnboardingState {
    Idle,
    AwaitingScan,
    Polling,
    Succeeded,
    Failed,
    Expired,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WeixinConnectorOnboardingSession {
    pub session_id: String,
    pub connector_id: String,
    pub state: WeixinConnectorOnboardingState,
    pub started_at: String,
    pub expires_at: Option<String>,
    pub completed_at: Option<String>,
    pub verification_url: Option<String>,
    pub qr_svg: Option<String>,
    pub detail_message: Option<String>,
    pub error_message: Option<String>,
    pub account_id: Option<String>,
    pub owner_user_id: Option<String>,
    pub last_configured_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeOnboardingFeishuInput {
    pub app_id: Option<String>,
    pub app_secret: Option<String>,
    pub verification_token: Option<String>,
    pub encrypt_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BridgeOnboardingConfigInput {
    pub enabled: bool,
    pub feishu_enabled: bool,
    pub auto_start: bool,
    pub feishu: BridgeOnboardingFeishuInput,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConnectorStatus {
    #[serde(default)]
    pub connector_id: String,
    #[serde(default)]
    pub connector_label: String,
    pub platform: BridgePlatform,
    pub enabled: bool,
    pub state: BridgeChannelState,
    pub last_heartbeat_at: Option<String>,
    pub last_inbound_at: Option<String>,
    pub last_outbound_at: Option<String>,
    pub last_offset: Option<String>,
    pub last_error_code: Option<String>,
    pub last_error: Option<String>,
    pub last_ready_at: Option<String>,
    pub last_failure_at: Option<String>,
    pub last_failure_operation: Option<String>,
    pub last_failure_retryable: Option<bool>,
    pub consecutive_failures: Option<usize>,
    pub next_retry_at: Option<String>,
    pub last_recovery_at: Option<String>,
    pub recovery_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub state: BridgeRuntimeState,
    pub started_at: Option<String>,
    pub pid: Option<u32>,
    pub admin_port: u16,
    pub version: Option<String>,
    #[serde(default)]
    pub kimi_runtime_locator: BridgeRuntimeLocatorStatus,
    #[serde(default)]
    pub runtime_adapter: BridgeRuntimeAdapterStatus,
    #[serde(default, alias = "channels")]
    pub connectors: Vec<BridgeConnectorStatus>,
    pub pending_approvals: usize,
    pub bindings: usize,
    pub last_error_code: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRuntimeLocatorStatus {
    pub configured: bool,
    pub path: Option<String>,
    pub readable: bool,
    pub health: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeRuntimeAdapterStatus {
    pub name: Option<String>,
    pub state: String,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BindingRecord {
    pub binding_id: String,
    #[serde(default)]
    pub connector_id: String,
    #[serde(default)]
    pub connector_label: String,
    pub platform: BridgePlatform,
    pub account_id: Option<String>,
    pub chat_id: String,
    pub thread_id: Option<String>,
    pub kimi_session_id: String,
    pub work_dir: Option<String>,
    pub onboarded_at: Option<String>,
    pub onboarding_version: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub last_inbound_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeApprovalRecord {
    pub approval_id: String,
    #[serde(default)]
    pub connector_id: String,
    #[serde(default)]
    pub connector_label: String,
    pub kimi_session_id: String,
    pub turn_id: Option<String>,
    pub step_id: Option<String>,
    pub request_kind: String,
    pub prompt: String,
    pub platform: BridgePlatform,
    pub chat_id: String,
    pub thread_id: Option<String>,
    pub status: String,
    pub request_payload_json: String,
    pub resolution_payload_json: Option<String>,
    pub dedupe_key: String,
    pub created_at: String,
    pub updated_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillApplyScope {
    UserGlobalKimi,
    KimiCodeHome,
    SessionKimi,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillProjectionMethod {
    Symlink,
    Junction,
    Copy,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SkillSourceType {
    #[default]
    Git,
    LocalImport,
    Bundled,
    DiscoveredImport,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SkillUpdateStatusKind {
    #[default]
    UpToDate,
    UpdateAvailable,
    SourceMissing,
    RefreshAvailable,
    Unsupported,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUpdateStatusView {
    #[serde(default)]
    pub kind: SkillUpdateStatusKind,
    pub detail: Option<String>,
    pub checked_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillManifestMetadata {
    #[serde(default)]
    pub triggers: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub file_patterns: Vec<String>,
    #[serde(default)]
    pub workspace_patterns: Vec<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub recommended_scopes: Vec<SkillApplyScope>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillUsageStats {
    #[serde(default)]
    pub skill_id: String,
    #[serde(default)]
    pub apply_count: u32,
    pub last_applied_at: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillDiscoveryScope {
    UserHome,
    Workspace,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillDiscoveryContainerKind {
    Agents,
    KimiCode,
    LegacyAgents,
    Codex,
    Claude,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoveryLocation {
    pub scope: SkillDiscoveryScope,
    pub container_kind: SkillDiscoveryContainerKind,
    pub container_path: String,
    pub skill_path: String,
    pub workspace_id: Option<String>,
    pub workspace_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDiscoveryRoot {
    pub id: String,
    pub scope: SkillDiscoveryScope,
    pub path: String,
    pub label: String,
    pub last_seen_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkillTargetContainerRoot {
    pub container_kind: SkillDiscoveryContainerKind,
    pub container_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkillTarget {
    pub id: String,
    pub scope: SkillDiscoveryScope,
    pub label: String,
    pub root_path: String,
    pub read_only: bool,
    pub is_current: bool,
    #[serde(default)]
    pub container_roots: Vec<WorkspaceSkillTargetContainerRoot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceManagedSkillRecord {
    pub skill_key: String,
    pub name: String,
    pub description: String,
    pub projection_name: String,
    pub has_scripts: bool,
    pub skill_path: String,
    pub container_kind: SkillDiscoveryContainerKind,
    pub matched_installed_skill_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkillContainerInventory {
    pub container_kind: SkillDiscoveryContainerKind,
    pub container_path: String,
    pub read_only: bool,
    #[serde(default)]
    pub skills: Vec<WorkspaceManagedSkillRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkillInventory {
    pub target: WorkspaceSkillTarget,
    pub scanned_at: String,
    #[serde(default)]
    pub containers: Vec<WorkspaceSkillContainerInventory>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkillRecord {
    pub discovery_id: String,
    pub name: String,
    pub description: String,
    pub canonical_path: String,
    pub projection_name: String,
    pub has_scripts: bool,
    #[serde(default)]
    pub locations: Vec<SkillDiscoveryLocation>,
    pub imported_skill_id: Option<String>,
    pub last_scanned_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredSkillDetail {
    pub record: DiscoveredSkillRecord,
    #[serde(default)]
    pub relative_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiscoverySnapshot {
    pub scanned_at: String,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceDiscoveryRoot>,
    #[serde(default)]
    pub records: Vec<DiscoveredSkillRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub source_type: SkillSourceType,
    #[serde(default)]
    pub source_label: String,
    #[serde(default)]
    pub source_key: String,
    pub source_path: Option<String>,
    pub repo_url: Option<String>,
    pub git_ref: Option<String>,
    pub commit: Option<String>,
    pub local_path: String,
    pub projection_name: String,
    pub trusted: bool,
    pub installed_at: String,
    pub updated_at: String,
    pub has_scripts: bool,
    #[serde(default)]
    pub metadata: SkillManifestMetadata,
    #[serde(default)]
    pub update_status: SkillUpdateStatusView,
    #[serde(default)]
    pub usage_stats: SkillUsageStats,
    #[serde(default)]
    pub discovery_locations: Vec<SkillDiscoveryLocation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDetail {
    pub skill: InstalledSkill,
    #[serde(default)]
    pub relative_paths: Vec<String>,
    pub user_global_applied: bool,
    pub current_session_applied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileEntry {
    pub rel_path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillFileContent {
    pub rel_path: String,
    pub size: u64,
    pub is_binary: bool,
    pub truncated: bool,
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillProjectionRecord {
    pub skill_id: String,
    pub scope: SkillApplyScope,
    pub target_path: String,
    pub projection_name: String,
    pub applied_at: String,
    pub method: SkillProjectionMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSkillState {
    pub session_id: Option<String>,
    pub session_work_dir: Option<String>,
    #[serde(default)]
    pub applied_skill_ids: Vec<String>,
    #[serde(default)]
    pub projections: Vec<SkillProjectionRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSkillProfile {
    pub workspace_id: String,
    #[serde(default)]
    pub recent_skill_ids: Vec<String>,
    #[serde(default)]
    pub pinned_skill_ids: Vec<String>,
    #[serde(default)]
    pub last_session_skill_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillApplyResult {
    pub scope: SkillApplyScope,
    #[serde(default)]
    pub global_skills: Vec<SkillProjectionRecord>,
    pub active_session: SessionSkillState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillRecommendation {
    pub skill_id: String,
    pub score: i32,
    #[serde(default)]
    pub reasons: Vec<String>,
    #[serde(default)]
    pub matched_signals: Vec<String>,
    pub recommended_scope: SkillApplyScope,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeApprovalResolveInput {
    pub approval_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolution_payload_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeMaskedSecretValue {
    pub configured: bool,
    pub masked_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeTelegramSecretsMaskView {
    pub bot_token: BridgeMaskedSecretValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeFeishuSecretsMaskView {
    pub app_id: BridgeMaskedSecretValue,
    pub app_secret: BridgeMaskedSecretValue,
    pub verification_token: BridgeMaskedSecretValue,
    pub encrypt_key: BridgeMaskedSecretValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeWeixinSecretsMaskView {
    pub bot_token: BridgeMaskedSecretValue,
    pub base_url: Option<String>,
    pub account_id: Option<String>,
    pub owner_user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeSecretsMaskView {
    #[serde(default)]
    pub connectors: Vec<BridgeConnectorSecretsMaskView>,
    pub telegram: BridgeTelegramSecretsMaskView,
    pub feishu: BridgeFeishuSecretsMaskView,
    pub weixin: BridgeWeixinSecretsMaskView,
}

pub type BridgeChannelStatus = BridgeConnectorStatus;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeConnectorSecretsMaskView {
    pub connector_id: String,
    pub connector_label: String,
    pub platform: BridgePlatform,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telegram: Option<BridgeTelegramSecretsMaskView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feishu: Option<BridgeFeishuSecretsMaskView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weixin: Option<BridgeWeixinSecretsMaskView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct OnboardingStepAcks {
    pub login_verified: bool,
    pub api_config_ack: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsInfo {
    pub instance_id: String,
    pub pid: u32,
    pub started_at: String,
    pub is_hotkey_owner: bool,
    pub start_cycle_id: u64,
    pub state: BackendState,
    pub active_port: Option<u16>,
    pub workspace_port: Option<u16>,
    pub base_port: Option<u16>,
    pub loading_startup_ms: Option<u64>,
    pub backend_ready_ms: Option<u64>,
    pub loading_sla_met: Option<bool>,
    pub configured_kimi_path: Option<String>,
    pub detected_kimi_path: Option<String>,
    pub configured_work_dir: Option<String>,
    pub effective_work_dir: Option<String>,
    pub launch_command: Option<String>,
    pub runtime_origin: Option<String>,
    pub server_token_path: Option<String>,
    pub server_token_redacted: Option<String>,
    pub workspace_url: Option<String>,
    pub workspace_url_redacted: Option<String>,
    pub kimi_version: Option<String>,
    pub version_error: Option<String>,
    pub last_error: Option<String>,
    pub last_exit_reason: Option<String>,
    pub webview_runtime_kind: WebviewRuntimeKind,
    pub webview_runtime_version: Option<String>,
    pub startup_pending: bool,
    pub startup_exit_cause: Option<String>,
    pub main_create_mode: MainCreateMode,
    pub startup_attempt_id: u64,
    pub startup_phase: StartupPhase,
    pub startup_failure_kind: Option<StartupFailureKind>,
    pub startup_failure_detail: Option<String>,
    pub startup_monitor_state: Option<StartupMonitorState>,
    pub startup_monitor_reason: Option<StartupMonitorReason>,
    pub startup_monitor_target_route: Option<StartupMonitorTargetRoute>,
    pub startup_monitor_detail: Option<String>,
    pub auth_mode: AuthMode,
    pub provider_api_configured: bool,
    pub provider_api_active_provider: Option<String>,
    pub kimi_login_health: KimiLoginHealth,
    pub provider_api_health: ProviderApiHealth,
    pub workspace_web_mode: WorkspaceWebMode,
    pub enhanced_web_source_commit: Option<String>,
    pub enhanced_web_health: EnhancedWebHealth,
    pub enhanced_web_last_fallback_reason: Option<String>,
    pub startup_trace: Vec<String>,
    pub app_log_path: String,
    pub backend_log_path: String,
    pub app_log_tail: Vec<String>,
    pub backend_log_tail: Vec<String>,
    pub log_tail: Vec<String>,
    pub logs_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuStatus {
    pub supported: bool,
    pub enabled: bool,
    pub message: Option<String>,
    pub labels: ContextMenuLabelsInput,
    pub items: Vec<ContextMenuItemView>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct ContextMenuLabelsInput {
    pub open_dir_background: String,
    pub open_dir: String,
    pub open_file: String,
    pub open_filesystem_object: String,
    pub move_to_workspace: String,
    pub import_to_default_workspace: String,
    pub import_with_workspace_picker: String,
}

impl Default for ContextMenuLabelsInput {
    fn default() -> Self {
        Self {
            open_dir_background: "在此处打开 Kimi 小助手".to_string(),
            open_dir: "在 Kimi 小助手中打开".to_string(),
            open_file: "复制到工作区并用 Kimi 小助手打开".to_string(),
            open_filesystem_object: "在 Kimi 小助手中打开".to_string(),
            move_to_workspace: "复制到 Kimi 小助手工作区".to_string(),
            import_to_default_workspace: "导入到默认工作区".to_string(),
            import_with_workspace_picker: "选择其他工作区".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuItemView {
    pub id: String,
    pub label_key: String,
    pub label: String,
    pub scope: String,
    pub registry_key: String,
    pub command: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OnboardingStep {
    InstallKimi,
    ContextMenu,
    LoginKimi,
    WorkDir,
    ApiConfig,
    Done,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KimiCodeAuthState {
    LoggedIn,
    LoginRequired,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    KimiLogin,
    ProviderApi,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum KimiLoginHealthState {
    #[default]
    Unknown,
    Verified,
    AuthRequired,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum KimiLoginHealthSource {
    ManualRefresh,
    WorkspaceApi,
    #[default]
    BackendStartup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiLoginHealth {
    pub state: KimiLoginHealthState,
    pub source: KimiLoginHealthSource,
    #[serde(default)]
    pub message: String,
    pub exit_code: Option<i32>,
    pub checked_at_ms: Option<u64>,
    pub needs_attention: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProviderApiHealthState {
    #[default]
    Unknown,
    AuthRequired,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProviderApiHealthSource {
    WorkspaceApi,
    #[default]
    BackendStartup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderApiHealth {
    pub state: ProviderApiHealthState,
    pub source: ProviderApiHealthSource,
    #[serde(default)]
    pub message: String,
    pub exit_code: Option<i32>,
    pub checked_at_ms: Option<u64>,
    pub needs_attention: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingStatus {
    pub current_version: u32,
    pub completed_version: u32,
    pub should_show_onboarding: bool,
    pub launch_blocked_by_onboarding: bool,
    pub startup_open_request_applied: bool,
    pub recommended_step: OnboardingStep,
    pub kimi_installed: bool,
    pub detected_kimi_path: Option<String>,
    pub context_menu_supported: bool,
    pub context_menu_enabled: bool,
    pub context_menu_message: Option<String>,
    pub auth_mode: AuthMode,
    pub provider_api_configured: bool,
    pub provider_api_active_provider: Option<String>,
    pub kimi_login_health: KimiLoginHealth,
    pub provider_api_health: ProviderApiHealth,
    pub kimi_code_auth_state: KimiCodeAuthState,
    pub kimi_code_auth_message: Option<String>,
    pub work_dir_configured: bool,
    pub work_dir: Option<String>,
    pub api_config_ack: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAuthResult {
    pub state: KimiCodeAuthState,
    pub message: String,
    pub kimi_path: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiDoctorResult {
    pub succeeded: bool,
    pub exit_code: Option<i32>,
    pub command: String,
    pub kimi_path: String,
    pub shell_path: Option<String>,
    pub stdout: String,
    pub stderr: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigProviderView {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub base_url: Option<String>,
    pub api_key_configured: bool,
    pub api_key_masked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigModelView {
    pub id: String,
    pub provider: String,
    pub model: String,
    pub max_context_size: i64,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigServiceView {
    pub key: String,
    pub base_url: Option<String>,
    pub api_key_configured: bool,
    pub api_key_masked: Option<String>,
    pub uses_provider_api_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigServicesView {
    pub search: KimiCodeAccessConfigServiceView,
    pub fetch: KimiCodeAccessConfigServiceView,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeRuntimeLimitsView {
    pub agent_swarm_max_concurrency: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigView {
    pub kimi_code_home: String,
    pub config_path: String,
    pub config_exists: bool,
    pub config_fingerprint: Option<String>,
    pub config_error: Option<String>,
    pub provider: KimiCodeAccessConfigProviderView,
    pub model: KimiCodeAccessConfigModelView,
    pub services: KimiCodeAccessConfigServicesView,
    pub runtime_limits: KimiCodeRuntimeLimitsView,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KimiCodeAccessServiceApiKeyMode {
    ReuseProvider,
    Custom,
    KeepExisting,
    Clear,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigInput {
    pub expected_config_fingerprint: Option<String>,
    pub provider_base_url: String,
    pub provider_api_key: Option<String>,
    pub clear_provider_api_key: Option<bool>,
    pub search_base_url: String,
    pub search_api_key_mode: Option<KimiCodeAccessServiceApiKeyMode>,
    pub search_api_key: Option<String>,
    pub fetch_base_url: String,
    pub fetch_api_key_mode: Option<KimiCodeAccessServiceApiKeyMode>,
    pub fetch_api_key: Option<String>,
    pub agent_swarm_max_concurrency: Option<u32>,
    pub clear_agent_swarm_max_concurrency: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigTestInput {
    pub provider_base_url: String,
    pub provider_api_key: Option<String>,
    pub search_base_url: String,
    pub search_api_key: Option<String>,
    pub fetch_base_url: String,
    pub fetch_api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessEndpointTestResult {
    pub url: String,
    pub reachable: bool,
    pub status_code: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCodeAccessConfigTestResult {
    pub provider: KimiCodeAccessEndpointTestResult,
    pub search: KimiCodeAccessEndpointTestResult,
    pub fetch: KimiCodeAccessEndpointTestResult,
    pub api_key_configured: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum InstallTaskId {
    QuickInstallCore,
    InstallUv,
    InstallPython313,
    InstallKimi,
    UpgradeKimi,
    UninstallKimi,
    InstallGit,
    InstallNodejs,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallTaskGroup {
    Core,
    Optional,
    Upgrade,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallSource {
    #[default]
    Official,
    Mirror,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallMirrorPreset {
    #[default]
    Mixed,
    Tuna,
    Ustc,
    Aliyun,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct InstallCustomMirrorConfig {
    pub git_release_pages: Vec<String>,
    pub uv_release_pages: Vec<String>,
    pub python_installer_urls: Vec<String>,
    pub pypi_index_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSettingsView {
    pub preferred_source: InstallSource,
    pub mirror_preset: InstallMirrorPreset,
    pub custom_mirror_config: InstallCustomMirrorConfig,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallMirrorHealthCategory {
    GitReleasePage,
    UvReleasePage,
    PythonInstaller,
    PypiIndex,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallMirrorHealthEntry {
    pub category: InstallMirrorHealthCategory,
    pub url: String,
    pub healthy: bool,
    pub status_code: Option<u16>,
    pub detail: String,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallMirrorHealthReport {
    #[serde(default)]
    pub entries: Vec<InstallMirrorHealthEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PowerShellDiagnosticKind {
    Ok,
    ExecutionPolicy,
    GroupPolicy,
    AppLockerOrWdac,
    ConstrainedLanguage,
    CommandLaunch,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellExecutionPolicyItem {
    pub scope: String,
    pub policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerShellPreflightSummary {
    pub kind: PowerShellDiagnosticKind,
    pub detail: String,
    pub suggested_fix: Option<String>,
    pub language_mode: Option<String>,
    pub smoke_test_ok: bool,
    pub smoke_test_exit_code: Option<i32>,
    pub smoke_test_stdout: Option<String>,
    pub smoke_test_stderr: Option<String>,
    #[serde(default)]
    pub execution_policies: Vec<PowerShellExecutionPolicyItem>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallSessionStatus {
    Idle,
    Starting,
    Running,
    Cancelling,
    Succeeded,
    Failed,
    Cancelled,
    FallbackRequired,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallSessionStage {
    Idle,
    Prepare,
    ExecuteStep,
    Probe,
    Done,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InstallLogStream {
    Stdout,
    Stderr,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallTaskStep {
    pub id: String,
    pub title: String,
    pub description: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallTaskDefinition {
    pub id: InstallTaskId,
    pub title: String,
    pub description: String,
    pub group: InstallTaskGroup,
    pub recommended: bool,
    pub runs_in_app: bool,
    pub requires_elevation: bool,
    pub optional: bool,
    pub fallback_reason: Option<String>,
    #[serde(default)]
    pub official_steps: Vec<InstallTaskStep>,
    #[serde(default)]
    pub mirror_steps: Vec<InstallTaskStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallFlowCatalog {
    #[serde(default)]
    pub tasks: Vec<InstallTaskDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProbeStatus {
    pub winget_ready: bool,
    pub git_ready: bool,
    pub git_bash_ready: bool,
    pub kimi_shell_path: Option<String>,
    pub uv_ready: bool,
    pub python313_ready: bool,
    pub kimi_ready: bool,
    pub node_ready: bool,
    pub core_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLogChunk {
    pub task_id: InstallTaskId,
    pub step_id: Option<String>,
    pub source: InstallSource,
    pub stream: InstallLogStream,
    pub text: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSessionSnapshot {
    pub status: InstallSessionStatus,
    pub stage: InstallSessionStage,
    pub task_id: Option<InstallTaskId>,
    pub source: Option<InstallSource>,
    pub title: Option<String>,
    pub current_step_id: Option<String>,
    pub current_step_title: Option<String>,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
    pub failure_summary: Option<String>,
    pub last_stdout: Option<String>,
    pub last_stderr: Option<String>,
    pub fallback_reason: Option<String>,
    pub powershell_diagnostic: Option<PowerShellPreflightSummary>,
    pub logs_truncated: bool,
    pub probe: Option<InstallProbeStatus>,
    #[serde(default)]
    pub logs: Vec<InstallLogChunk>,
}

impl Default for InstallSessionSnapshot {
    fn default() -> Self {
        Self {
            status: InstallSessionStatus::Idle,
            stage: InstallSessionStage::Idle,
            task_id: None,
            source: None,
            title: None,
            current_step_id: None,
            current_step_title: None,
            started_at: None,
            finished_at: None,
            exit_code: None,
            message: None,
            failure_summary: None,
            last_stdout: None,
            last_stderr: None,
            fallback_reason: None,
            powershell_diagnostic: None,
            logs_truncated: false,
            probe: None,
            logs: Vec::new(),
        }
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum InstallSessionEvent {
    Snapshot { snapshot: InstallSessionSnapshot },
    Log { chunk: InstallLogChunk },
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallCommandStep {
    pub id: String,
    pub title: String,
    pub description: String,
    pub command: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallCommandEntry {
    pub id: String,
    pub title: String,
    pub description: String,
    pub source: String,
    pub requires_elevation: bool,
    #[serde(default)]
    pub steps: Vec<InstallCommandStep>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InstallCommandCatalog {
    #[serde(default)]
    pub entries: Vec<InstallCommandEntry>,
}
