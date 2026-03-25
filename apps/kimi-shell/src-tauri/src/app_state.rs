use std::{
    fs::{File, OpenOptions},
    path::PathBuf,
    process::Child,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use fs2::FileExt;
use rand::{distributions::Alphanumeric, Rng};
use tauri::{AppHandle, Manager};

use crate::types::{
    BackendState, BridgeChannelStatus, BridgeRuntimeState, FeishuConnectorOnboardingState,
    LoginProbeState, MainCreateMode, StartupFailureKind, StartupMonitorReason,
    StartupMonitorState, StartupMonitorTargetRoute, StartupPhase,
    WeixinConnectorOnboardingState, WebviewRuntimeKind,
};

#[derive(Debug, Clone)]
pub struct PendingWorkspaceBootstrap {
    pub work_dir: PathBuf,
    pub auto_session: bool,
    pub force_create_new: bool,
    pub source: String,
}

#[derive(Debug)]
pub struct RuntimeState {
    pub state: BackendState,
    pub active_port: Option<u16>,
    pub workspace_port: Option<u16>,
    pub base_port: Option<u16>,
    pub generation: u64,
    pub start_cycle_id: u64,
    pub child: Option<Child>,
    pub last_error: Option<String>,
    pub detected_kimi_path: Option<PathBuf>,
    pub effective_work_dir: Option<PathBuf>,
    pub launch_command: Option<String>,
    pub start_requested_at_ms: Option<u64>,
    pub loading_reported_at_ms: Option<u64>,
    pub loading_reported_cycle_id: Option<u64>,
    pub backend_ready_at_ms: Option<u64>,
    pub cli_contract_ok: Option<bool>,
    pub cli_contract_error: Option<String>,
    pub last_exit_reason: Option<String>,
    pub session_work_dir: Option<PathBuf>,
    pub pending_workspace_bootstrap: Option<PendingWorkspaceBootstrap>,
    pub active_session_id: Option<String>,
    pub active_session_work_dir: Option<PathBuf>,
    pub session_source: Option<String>,
    pub startup_open_request_applied: bool,
    pub login_probe_state: Option<LoginProbeState>,
    pub login_probe_message: Option<String>,
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
    pub startup_monitor_log_key: Option<String>,
    pub startup_trace: Vec<String>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            state: BackendState::Stopped,
            active_port: None,
            workspace_port: None,
            base_port: None,
            generation: 0,
            start_cycle_id: 0,
            child: None,
            last_error: None,
            detected_kimi_path: None,
            effective_work_dir: None,
            launch_command: None,
            start_requested_at_ms: None,
            loading_reported_at_ms: None,
            loading_reported_cycle_id: None,
            backend_ready_at_ms: None,
            cli_contract_ok: None,
            cli_contract_error: None,
            last_exit_reason: None,
            session_work_dir: None,
            pending_workspace_bootstrap: None,
            active_session_id: None,
            active_session_work_dir: None,
            session_source: None,
            startup_open_request_applied: false,
            login_probe_state: None,
            login_probe_message: None,
            webview_runtime_kind: WebviewRuntimeKind::Evergreen,
            webview_runtime_version: None,
            startup_pending: false,
            startup_exit_cause: None,
            main_create_mode: MainCreateMode::Manual,
            startup_attempt_id: 0,
            startup_phase: StartupPhase::Idle,
            startup_failure_kind: None,
            startup_failure_detail: None,
            startup_monitor_state: None,
            startup_monitor_reason: None,
            startup_monitor_target_route: None,
            startup_monitor_detail: None,
            startup_monitor_log_key: None,
            startup_trace: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub struct BridgeProcessState {
    pub state: BridgeRuntimeState,
    pub admin_port: u16,
    pub admin_token: String,
    pub child: Option<Child>,
    pub pid: Option<u32>,
    pub binary_path: Option<PathBuf>,
    pub started_at: Option<String>,
    pub version: Option<String>,
    pub last_error_code: Option<String>,
    pub last_error: Option<String>,
    pub channels: Vec<BridgeChannelStatus>,
    pub bindings: usize,
    pub pending_approvals: usize,
}

impl BridgeProcessState {
    pub fn new(admin_token: String) -> Self {
        Self {
            state: BridgeRuntimeState::Stopped,
            admin_port: 60_110,
            admin_token,
            child: None,
            pid: None,
            binary_path: None,
            started_at: None,
            version: None,
            last_error_code: None,
            last_error: None,
            channels: Vec::new(),
            bindings: 0,
            pending_approvals: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FeishuOnboardingRuntimeState {
    pub session_id: String,
    pub connector_id: String,
    pub state: FeishuConnectorOnboardingState,
    pub started_at: String,
    pub expires_at: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub completed_at: Option<String>,
    pub verification_url: Option<String>,
    pub qr_svg: Option<String>,
    pub scanner_open_id: Option<String>,
    pub detail_message: Option<String>,
    pub error_message: Option<String>,
    pub app_id_masked: Option<String>,
    pub last_configured_at: Option<String>,
    pub device_code: String,
    pub poll_base_url: String,
    pub poll_interval_secs: u64,
}

#[derive(Debug, Clone)]
pub struct WeixinOnboardingRuntimeState {
    pub session_id: String,
    pub connector_id: String,
    pub state: WeixinConnectorOnboardingState,
    pub started_at: String,
    pub expires_at: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub completed_at: Option<String>,
    pub verification_url: Option<String>,
    pub qr_svg: Option<String>,
    pub qrcode: String,
    pub detail_message: Option<String>,
    pub error_message: Option<String>,
    pub account_id: Option<String>,
    pub owner_user_id: Option<String>,
    pub last_configured_at: Option<String>,
    pub api_base_url: String,
    pub refresh_count: u32,
}

pub struct AppState {
    pub runtime: Mutex<RuntimeState>,
    pub bridge_runtime: Mutex<BridgeProcessState>,
    pub feishu_onboarding: Mutex<Option<FeishuOnboardingRuntimeState>>,
    pub weixin_onboarding: Mutex<Option<WeixinOnboardingRuntimeState>>,
    pub bridge_host_control_port: Mutex<Option<u16>>,
    pub settings_path: PathBuf,
    pub bridge_settings_path: PathBuf,
    pub bridge_secrets_path: PathBuf,
    pub bridge_db_path: PathBuf,
    pub logs_dir: PathBuf,
    pub bridge_log_path: PathBuf,
    pub instance_id: String,
    pub pid: u32,
    pub started_at: String,
    pub hotkey_owner: bool,
    _hotkey_lock_file: Option<File>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let config_dir = app
            .path()
            .app_config_dir()
            .context("failed to resolve app config directory")?;
        std::fs::create_dir_all(&config_dir).with_context(|| {
            format!(
                "failed to create config directory: {}",
                config_dir.display()
            )
        })?;

        let logs_dir = app
            .path()
            .app_log_dir()
            .context("failed to resolve app log directory")?;
        std::fs::create_dir_all(&logs_dir)
            .with_context(|| format!("failed to create logs directory: {}", logs_dir.display()))?;

        let pid = std::process::id();
        let started_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let started_at = started_epoch.to_string();
        let instance_id = format!("inst-{pid}-{started_epoch}");

        let (hotkey_owner, hotkey_lock_file) =
            try_acquire_hotkey_lock(config_dir.join("hotkey_owner.lock"))?;
        let bridge_admin_token = generate_bridge_admin_token();

        Ok(Self {
            runtime: Mutex::new(RuntimeState::default()),
            bridge_runtime: Mutex::new(BridgeProcessState::new(bridge_admin_token)),
            feishu_onboarding: Mutex::new(None),
            weixin_onboarding: Mutex::new(None),
            bridge_host_control_port: Mutex::new(None),
            settings_path: config_dir.join("settings.json"),
            bridge_settings_path: config_dir.join("bridge_settings.json"),
            bridge_secrets_path: config_dir.join("bridge_secrets.json"),
            bridge_db_path: config_dir.join("bridge.db"),
            logs_dir: logs_dir.clone(),
            bridge_log_path: logs_dir.join("bridge.log"),
            instance_id,
            pid,
            started_at,
            hotkey_owner,
            _hotkey_lock_file: hotkey_lock_file,
        })
    }
}

pub fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn try_acquire_hotkey_lock(lock_path: PathBuf) -> anyhow::Result<(bool, Option<File>)> {
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .with_context(|| format!("failed to open hotkey lock file: {}", lock_path.display()))?;

    match lock_file.try_lock_exclusive() {
        Ok(_) => Ok((true, Some(lock_file))),
        Err(_) => Ok((false, None)),
    }
}

fn generate_bridge_admin_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(40)
        .map(char::from)
        .collect()
}
