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
