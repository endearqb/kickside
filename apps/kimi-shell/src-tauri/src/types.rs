use serde::{Deserialize, Serialize};

pub const CURRENT_ONBOARDING_VERSION: u32 = 1;
pub const CURRENT_SETTINGS_SCHEMA_VERSION: u32 = 2;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
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
    pub message: Option<String>,
    pub detected_kimi_path: Option<String>,
    pub configured_kimi_path: Option<String>,
    pub configured_work_dir: Option<String>,
    pub effective_work_dir: Option<String>,
    pub logs_dir: String,
    pub hotkey: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: u32,
    pub kimi_path: Option<String>,
    pub work_dir: Option<String>,
    pub hotkey: String,
    pub start_minimized_to_tray: bool,
    pub auto_restart_on_crash: bool,
    pub onboarding_completed_version: u32,
    pub onboarding_step_acks: OnboardingStepAcks,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: CURRENT_SETTINGS_SCHEMA_VERSION,
            kimi_path: None,
            work_dir: None,
            hotkey: "CmdOrCtrl+Shift+K".to_string(),
            start_minimized_to_tray: false,
            auto_restart_on_crash: false,
            onboarding_completed_version: 0,
            onboarding_step_acks: OnboardingStepAcks::default(),
        }
    }
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
    pub cli_contract_ok: Option<bool>,
    pub cli_contract_error: Option<String>,
    pub kimi_version: Option<String>,
    pub version_error: Option<String>,
    pub last_error: Option<String>,
    pub last_exit_reason: Option<String>,
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
pub enum LoginProbeState {
    LoggedIn,
    LoginRequired,
    Unknown,
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
    pub login_state: LoginProbeState,
    pub login_message: Option<String>,
    pub work_dir_configured: bool,
    pub work_dir: Option<String>,
    pub api_config_ack: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginProbeResult {
    pub state: LoginProbeState,
    pub message: String,
    pub kimi_path: Option<String>,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiCliApiConfigView {
    pub config_path: String,
    pub provider_id: Option<String>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub has_api_key: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiCliApiConfigInput {
    pub provider_id: String,
    pub model: String,
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TypedFieldType {
    #[default]
    String,
    Integer,
    Float,
    Boolean,
    StringArray,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeyValueEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TypedFieldEntry {
    pub key: String,
    pub value_type: TypedFieldType,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderEntry {
    pub key: String,
    pub provider_type: Option<String>,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub auth_token: Option<String>,
    pub app_id: Option<String>,
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub region: Option<String>,
    pub api_version: Option<String>,
    pub deployment: Option<String>,
    pub model_name: Option<String>,
    #[serde(default)]
    pub env: Vec<KeyValueEntry>,
    #[serde(default)]
    pub custom_headers: Vec<KeyValueEntry>,
    #[serde(default)]
    pub extra_fields: Vec<TypedFieldEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub key: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub max_context_size: Option<i64>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub extra_fields: Vec<TypedFieldEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServiceEntry {
    pub key: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub endpoint: Option<String>,
    pub api_key: Option<String>,
    pub timeout_ms: Option<i64>,
    pub max_retries: Option<i64>,
    #[serde(default)]
    pub extra_fields: Vec<TypedFieldEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoopControlEntry {
    pub enabled: Option<bool>,
    pub max_steps: Option<i64>,
    pub max_retries: Option<i64>,
    pub timeout_ms: Option<i64>,
    #[serde(default)]
    pub extra_fields: Vec<TypedFieldEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub key: String,
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<KeyValueEntry>,
    pub enabled: Option<bool>,
    pub working_directory: Option<String>,
    pub timeout_ms: Option<i64>,
    #[serde(default)]
    pub extra_fields: Vec<TypedFieldEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvOverrideStatus {
    pub key: String,
    pub is_set: bool,
    pub masked_value: Option<String>,
    #[serde(default)]
    pub overrides: Vec<String>,
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCliConfigCenterInput {
    #[serde(default)]
    pub providers: Vec<ProviderEntry>,
    #[serde(default)]
    pub models: Vec<ModelEntry>,
    #[serde(default)]
    pub services: Vec<ServiceEntry>,
    pub default_provider: Option<String>,
    pub model: Option<String>,
    pub default_model: Option<String>,
    pub default_service: Option<String>,
    pub default_editor: Option<String>,
    pub default_yolo: Option<bool>,
    pub default_yolo_mode: Option<String>,
    pub default_thinking: Option<bool>,
    pub default_thinking_mode: Option<String>,
    pub local_model_disable_auto_pull: Option<bool>,
    #[serde(default)]
    pub loop_control: LoopControlEntry,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiCliConfigCenterView {
    pub config_path: String,
    pub config_dir: String,
    pub data_dir: String,
    pub data_dir_env_source: Option<String>,
    #[serde(default)]
    pub providers: Vec<ProviderEntry>,
    #[serde(default)]
    pub models: Vec<ModelEntry>,
    #[serde(default)]
    pub services: Vec<ServiceEntry>,
    pub default_provider: Option<String>,
    pub model: Option<String>,
    pub default_model: Option<String>,
    pub default_service: Option<String>,
    pub default_editor: Option<String>,
    pub default_yolo: Option<bool>,
    pub default_yolo_mode: Option<String>,
    pub default_thinking: Option<bool>,
    pub default_thinking_mode: Option<String>,
    pub local_model_disable_auto_pull: Option<bool>,
    #[serde(default)]
    pub loop_control: LoopControlEntry,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerEntry>,
    #[serde(default)]
    pub env_overrides: Vec<EnvOverrideStatus>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProbeStatus {
    pub git_ready: bool,
    pub uv_ready: bool,
    pub python313_ready: bool,
    pub kimi_ready: bool,
}
