mod app_state;
mod backend_manager;
mod cli_contract;
mod command_utils;
mod context_menu;
mod kimi_locator;
mod log_manager;
mod open_request;
mod port_manager;
mod settings_store;
mod shortcut_manager;
mod tray_manager;
mod types;
mod window_manager;

use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, LogicalSize, Manager, RunEvent, Size};
use tauri_plugin_global_shortcut::ShortcutState;

use app_state::{unix_time_millis, AppState};
use types::{
    AppSettings, AppStatus, BackendState, ContextMenuStatus, DiagnosticsInfo, FrontendReadyAck,
    InstallProbeStatus, KimiCliApiConfigInput, KimiCliApiConfigView, KimiCliConfigCenterInput,
    KimiCliConfigCenterView, LoginProbeResult, LoginProbeState, OnboardingStatus, OnboardingStep,
    SubmitPrefillAck, CURRENT_ONBOARDING_VERSION,
};

#[tauri::command]
fn get_app_status(app: AppHandle) -> Result<AppStatus, String> {
    let settings = settings_store::load_or_default(&app).unwrap_or_default();
    let logs_dir = log_manager::ensure_logs_dir(&app).map_err(|error| error.to_string())?;

    let shared = app.state::<AppState>();
    let instance_id = shared.instance_id.clone();
    let pid = shared.pid;
    let started_at = shared.started_at.clone();
    let is_hotkey_owner = shared.hotkey_owner;

    let (
        state,
        start_cycle_id,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        message,
        detected_kimi_path,
        effective_work_dir,
    ) = {
        let runtime = shared
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        let loading_startup_ms = diff_millis(
            runtime.start_requested_at_ms,
            runtime.loading_reported_at_ms,
        );
        let backend_ready_ms =
            diff_millis(runtime.start_requested_at_ms, runtime.backend_ready_at_ms);
        (
            runtime.state,
            runtime.start_cycle_id,
            runtime.active_port,
            runtime.workspace_port,
            runtime.base_port,
            loading_startup_ms,
            backend_ready_ms,
            loading_startup_ms.map(|ms| ms <= 1_000),
            runtime.last_error.clone(),
            runtime
                .detected_kimi_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime
                .effective_work_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
        )
    };

    Ok(AppStatus {
        instance_id,
        pid,
        started_at,
        is_hotkey_owner,
        start_cycle_id,
        state,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        message,
        detected_kimi_path,
        configured_kimi_path: settings.kimi_path,
        configured_work_dir: settings.work_dir,
        effective_work_dir,
        logs_dir: logs_dir.to_string_lossy().to_string(),
        hotkey: settings.hotkey,
    })
}

#[tauri::command]
fn retry_start_backend(app: AppHandle) {
    backend_manager::restart_backend(app);
}

#[tauri::command]
fn report_loading_rendered(app: AppHandle, start_cycle_id: Option<u64>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;

    let cycle_id = start_cycle_id.unwrap_or(runtime.start_cycle_id);
    if cycle_id != runtime.start_cycle_id {
        return Ok(());
    }
    if runtime.loading_reported_at_ms.is_none() {
        runtime.loading_reported_at_ms = Some(unix_time_millis());
        runtime.loading_reported_cycle_id = Some(cycle_id);
    }

    Ok(())
}

#[tauri::command]
fn notify_frontend_ready(app: AppHandle) -> Result<FrontendReadyAck, String> {
    let transition = window_manager::mark_frontend_ready(&app, "frontend_ready_invoke");

    let (backend_state, start_cycle_id, workspace_url) = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;

        let workspace_url = runtime
            .workspace_port
            .or(runtime.active_port)
            .map(|port| format!("http://127.0.0.1:{port}"));

        (runtime.state, runtime.start_cycle_id, workspace_url)
    };

    Ok(FrontendReadyAck {
        accepted: transition.accepted,
        backend_state,
        workspace_url,
        start_cycle_id,
        pending_prefill: transition.pending_prefill,
    })
}

#[tauri::command]
fn submit_prefill(app: AppHandle, text: String) -> Result<SubmitPrefillAck, String> {
    Ok(window_manager::submit_prefill(
        &app,
        text,
        "submit_prefill_invoke",
    ))
}

#[tauri::command]
fn save_kimi_path(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("kimi path cannot be empty".to_string());
    }

    let executable = PathBuf::from(trimmed);
    if !executable.exists() {
        return Err(format!(
            "kimi executable path does not exist: {}",
            executable.display()
        ));
    }

    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    settings.kimi_path = Some(executable.to_string_lossy().to_string());
    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn save_work_dir(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();

    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    if trimmed.is_empty() {
        settings.work_dir = None;
    } else {
        let work_dir = PathBuf::from(trimmed);
        if !work_dir.exists() {
            return Err(format!(
                "work directory does not exist: {}",
                work_dir.display()
            ));
        }
        if !work_dir.is_dir() {
            return Err(format!(
                "work directory is not a folder: {}",
                work_dir.display()
            ));
        }
        settings.work_dir = Some(work_dir.to_string_lossy().to_string());
    }

    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;
    backend_manager::set_session_work_dir(&app, None).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    backend_manager::open_logs_folder(&app)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    backend_manager::open_external_url(&url)
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    backend_manager::open_folder(&path)
}

#[tauri::command]
fn open_kimi_config_dir() -> Result<(), String> {
    backend_manager::open_kimi_config_dir()
}

#[tauri::command]
fn load_kimi_cli_api_config() -> Result<KimiCliApiConfigView, String> {
    backend_manager::load_kimi_cli_api_config()
}

#[tauri::command]
fn save_kimi_cli_api_config(input: KimiCliApiConfigInput) -> Result<(), String> {
    backend_manager::save_kimi_cli_api_config(input)
}

#[tauri::command]
fn load_kimi_cli_config_center() -> Result<KimiCliConfigCenterView, String> {
    backend_manager::load_kimi_cli_config_center()
}

#[tauri::command]
fn save_kimi_cli_config_center(
    app: AppHandle,
    input: KimiCliConfigCenterInput,
) -> Result<(), String> {
    backend_manager::save_kimi_cli_config_center(&app, input)
}

#[tauri::command]
fn install_kimi_dependencies(source: String) -> Result<String, String> {
    backend_manager::install_kimi_dependencies(&source)
}

#[tauri::command]
fn install_kimi_cli(source: String) -> Result<String, String> {
    backend_manager::install_kimi_cli(&source)
}

#[tauri::command]
fn get_install_probe_status() -> InstallProbeStatus {
    backend_manager::get_install_probe_status()
}

#[tauri::command]
fn get_diagnostics(app: AppHandle) -> Result<DiagnosticsInfo, String> {
    let settings = settings_store::load_or_default(&app).unwrap_or_default();
    let logs_dir = log_manager::ensure_logs_dir(&app).map_err(|error| error.to_string())?;
    let app_log_path = log_manager::app_log_path(&app).map_err(|error| error.to_string())?;
    let backend_log_path =
        log_manager::backend_log_path(&app).map_err(|error| error.to_string())?;
    let shared = app.state::<AppState>();
    let instance_id = shared.instance_id.clone();
    let pid = shared.pid;
    let started_at = shared.started_at.clone();
    let is_hotkey_owner = shared.hotkey_owner;

    let (
        state,
        start_cycle_id,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        last_error,
        last_exit_reason,
        detected_kimi_path,
        effective_work_dir,
        launch_command,
        cli_contract_ok,
        cli_contract_error,
    ) = {
        let runtime = shared
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        let loading_startup_ms = diff_millis(
            runtime.start_requested_at_ms,
            runtime.loading_reported_at_ms,
        );
        let backend_ready_ms =
            diff_millis(runtime.start_requested_at_ms, runtime.backend_ready_at_ms);
        (
            runtime.state,
            runtime.start_cycle_id,
            runtime.active_port,
            runtime.workspace_port,
            runtime.base_port,
            loading_startup_ms,
            backend_ready_ms,
            loading_startup_ms.map(|ms| ms <= 1_000),
            runtime.last_error.clone(),
            runtime.last_exit_reason.clone(),
            runtime
                .detected_kimi_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime
                .effective_work_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime.launch_command.clone(),
            runtime.cli_contract_ok,
            runtime.cli_contract_error.clone(),
        )
    };

    let kimi_for_version = settings
        .kimi_path
        .as_ref()
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| detected_kimi_path.clone());

    let (kimi_version, version_error) = match kimi_for_version {
        Some(path) => match query_kimi_version(&path) {
            Ok(version) => (Some(version), None),
            Err(error) => (None, Some(error)),
        },
        None => (
            None,
            Some("No kimi executable path available for version check.".to_string()),
        ),
    };

    Ok(DiagnosticsInfo {
        instance_id,
        pid,
        started_at,
        is_hotkey_owner,
        start_cycle_id,
        state,
        active_port,
        workspace_port,
        base_port,
        loading_startup_ms,
        backend_ready_ms,
        loading_sla_met,
        configured_kimi_path: settings.kimi_path,
        detected_kimi_path,
        configured_work_dir: settings.work_dir,
        effective_work_dir,
        launch_command,
        cli_contract_ok,
        cli_contract_error,
        kimi_version,
        version_error,
        last_error,
        last_exit_reason,
        app_log_path: app_log_path.to_string_lossy().to_string(),
        backend_log_path: backend_log_path.to_string_lossy().to_string(),
        app_log_tail: read_log_tail(&app_log_path, 60),
        backend_log_tail: read_log_tail(&backend_log_path, 60),
        log_tail: read_log_tail(&backend_log_path, 80),
        logs_dir: logs_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn get_context_menu_status(app: AppHandle) -> ContextMenuStatus {
    context_menu::status(&app)
}

#[tauri::command]
fn enable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    context_menu::enable(&app)?;
    Ok(context_menu::status(&app))
}

#[tauri::command]
fn disable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    context_menu::disable(&app)?;
    Ok(context_menu::status(&app))
}

#[tauri::command]
fn get_onboarding_status(app: AppHandle) -> Result<OnboardingStatus, String> {
    build_onboarding_status(&app)
}

#[tauri::command]
fn complete_onboarding(app: AppHandle) -> Result<(), String> {
    mark_onboarding_completed(&app)?;
    Ok(())
}

#[tauri::command]
fn skip_onboarding(app: AppHandle) -> Result<(), String> {
    mark_onboarding_completed(&app)?;
    Ok(())
}

#[tauri::command]
fn ack_api_config_step(app: AppHandle, acknowledged: Option<bool>) -> Result<(), String> {
    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    settings.onboarding_step_acks.api_config_ack = acknowledged.unwrap_or(true);
    settings_store::save(&app, &settings).map_err(|error| error.to_string())
}

#[tauri::command]
fn probe_kimi_login(app: AppHandle) -> Result<LoginProbeResult, String> {
    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    let kimi_path = resolve_kimi_path_for_login(&app, &settings)?;

    let mut process = Command::new(&kimi_path);
    command_utils::configure_kimi_query_command(&mut process);
    let output = process
        .arg("login")
        .arg("--json")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .output()
        .map_err(|error| {
            format!(
                "failed to run `{} login --json`: {}",
                kimi_path.display(),
                error
            )
        })?;

    let message = summarize_command_output(&output);
    let state = if output.status.success() {
        LoginProbeState::LoggedIn
    } else {
        LoginProbeState::LoginRequired
    };

    set_login_probe_runtime(&app, state, Some(message.clone()))?;

    settings.onboarding_step_acks.login_verified = state == LoginProbeState::LoggedIn;
    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;

    Ok(LoginProbeResult {
        state,
        message,
        kimi_path: Some(kimi_path.to_string_lossy().to_string()),
        exit_code: output.status.code(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = shortcut_manager::default_shortcut();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            window_manager::show_and_focus(&app);
            open_request::handle_external_cli_request(app.clone(), args, Some(cwd));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, active_shortcut, event| {
                    if event.state() == ShortcutState::Pressed && active_shortcut == &shortcut {
                        window_manager::toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let shared = AppState::new(app.handle())?;
            let hotkey_owner = shared.hotkey_owner;
            let pid = shared.pid;
            app.manage(shared);

            #[cfg(target_os = "windows")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.set_decorations(false) {
                    log_manager::append_line(
                        app.handle(),
                        format!("failed to disable window decorations: {error}"),
                    );
                }
                if let Err(error) = window.set_shadow(true) {
                    log_manager::append_line(
                        app.handle(),
                        format!("failed to enable window shadow: {error}"),
                    );
                }

                if let Err(error) = window.set_min_size(Some(Size::Logical(LogicalSize::new(
                    900.0, 640.0,
                )))) {
                    log_manager::append_line(
                        app.handle(),
                        format!("failed to set window min size: {error}"),
                    );
                }

                match window.outer_size() {
                    Ok(size) if size.width < 900 || size.height < 640 => {
                        log_manager::append_line(
                            app.handle(),
                            format!(
                                "detected abnormal window size {}x{}, restoring default bounds",
                                size.width, size.height
                            ),
                        );
                        let _ = window.unminimize();
                        let _ = window.set_size(Size::Logical(LogicalSize::new(1200.0, 820.0)));
                        let _ = window.center();
                    }
                    Ok(_) => {}
                    Err(error) => {
                        log_manager::append_line(
                            app.handle(),
                            format!("failed to query window size: {error}"),
                        );
                    }
                }
            }

            tray_manager::setup_tray(app.handle())?;
            if hotkey_owner {
                shortcut_manager::register_default_hotkey(app.handle())?;
            }

            if hotkey_owner {
                log_manager::append_line(
                    app.handle(),
                    format!("instance initialized (pid={pid}, hotkey_owner=true)"),
                );
            } else {
                log_manager::append_line(
                    app.handle(),
                    format!("instance initialized (pid={pid}, hotkey_owner=false, skipped hotkey registration)"),
                );
            }

            open_request::apply_startup_cli_request(app.handle());
            window_manager::enter_local_boot(app.handle(), "setup_bootstrap");
            backend_manager::start_backend(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            retry_start_backend,
            report_loading_rendered,
            notify_frontend_ready,
            submit_prefill,
            save_kimi_path,
            save_work_dir,
            get_diagnostics,
            open_logs_folder,
            open_external_url,
            open_folder,
            open_kimi_config_dir,
            load_kimi_cli_api_config,
            save_kimi_cli_api_config,
            load_kimi_cli_config_center,
            save_kimi_cli_config_center,
            install_kimi_dependencies,
            install_kimi_cli,
            get_install_probe_status,
            get_context_menu_status,
            enable_context_menu,
            disable_context_menu,
            get_onboarding_status,
            complete_onboarding,
            skip_onboarding,
            ack_api_config_step,
            probe_kimi_login
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent { label, event, .. } => {
            if label == "prefill" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if !window_manager::consume_prefill_close_allowance(app_handle) {
                        api.prevent_close();
                        window_manager::complete_prefill_without_text(
                            app_handle,
                            "prefill_close_requested",
                        );
                    }
                }
                return;
            }

            if label == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = backend_manager::stop_backend(app_handle);
                    app_handle.exit(0);
                }
            }
        }
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            let _ = backend_manager::stop_backend(app_handle);
        }
        _ => {}
    });
}

fn build_onboarding_status(app: &AppHandle) -> Result<OnboardingStatus, String> {
    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let context_status = context_menu::status(app);

    let (
        runtime_state,
        startup_open_request_applied,
        runtime_detected_kimi_path,
        runtime_login_state,
        runtime_login_message,
    ) = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        (
            runtime.state,
            runtime.startup_open_request_applied,
            runtime
                .detected_kimi_path
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime.login_probe_state,
            runtime.login_probe_message.clone(),
        )
    };

    let located_kimi_path = kimi_locator::locate(&settings)
        .ok()
        .map(|path| path.to_string_lossy().to_string());
    let kimi_installed = located_kimi_path.is_some();
    let detected_kimi_path = runtime_detected_kimi_path.or(located_kimi_path);

    let login_state = runtime_login_state.unwrap_or_else(|| {
        if settings.onboarding_step_acks.login_verified {
            LoginProbeState::LoggedIn
        } else {
            LoginProbeState::Unknown
        }
    });

    let work_dir = settings
        .work_dir
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let work_dir_configured = work_dir.is_some();
    let api_config_ack = settings.onboarding_step_acks.api_config_ack;

    let should_show_onboarding =
        should_show_onboarding(&settings, startup_open_request_applied, runtime_state);
    let recommended_step = recommend_onboarding_step(
        runtime_state,
        kimi_installed,
        context_status.supported,
        context_status.enabled,
        login_state,
        work_dir_configured,
        api_config_ack,
    );

    Ok(OnboardingStatus {
        current_version: CURRENT_ONBOARDING_VERSION,
        completed_version: settings.onboarding_completed_version,
        should_show_onboarding,
        launch_blocked_by_onboarding: false,
        startup_open_request_applied,
        recommended_step,
        kimi_installed,
        detected_kimi_path,
        context_menu_supported: context_status.supported,
        context_menu_enabled: context_status.enabled,
        context_menu_message: context_status.message,
        login_state,
        login_message: runtime_login_message,
        work_dir_configured,
        work_dir,
        api_config_ack,
    })
}

fn should_show_onboarding(
    settings: &AppSettings,
    startup_open_request_applied: bool,
    runtime_state: BackendState,
) -> bool {
    if matches!(
        runtime_state,
        BackendState::MissingKimi | BackendState::Crashed
    ) {
        return true;
    }

    settings.onboarding_completed_version < CURRENT_ONBOARDING_VERSION
        && !startup_open_request_applied
}

fn recommend_onboarding_step(
    runtime_state: BackendState,
    kimi_installed: bool,
    context_menu_supported: bool,
    context_menu_enabled: bool,
    login_state: LoginProbeState,
    work_dir_configured: bool,
    api_config_ack: bool,
) -> OnboardingStep {
    if matches!(runtime_state, BackendState::MissingKimi) || !kimi_installed {
        return OnboardingStep::InstallKimi;
    }
    if context_menu_supported && !context_menu_enabled {
        return OnboardingStep::ContextMenu;
    }
    if login_state != LoginProbeState::LoggedIn {
        return OnboardingStep::LoginKimi;
    }
    if !work_dir_configured {
        return OnboardingStep::WorkDir;
    }
    if !api_config_ack {
        return OnboardingStep::ApiConfig;
    }
    OnboardingStep::Done
}

fn mark_onboarding_completed(app: &AppHandle) -> Result<(), String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.onboarding_completed_version = CURRENT_ONBOARDING_VERSION;
    settings_store::save(app, &settings).map_err(|error| error.to_string())
}

fn resolve_kimi_path_for_login(app: &AppHandle, settings: &AppSettings) -> Result<PathBuf, String> {
    if let Some(configured) = settings
        .kimi_path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(configured);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "configured kimi path does not exist: {}",
            path.display()
        ));
    }

    {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        if let Some(path) = runtime.detected_kimi_path.clone() {
            return Ok(path);
        }
    }

    kimi_locator::locate(settings).map_err(|error| error.to_string())
}

fn set_login_probe_runtime(
    app: &AppHandle,
    state: LoginProbeState,
    message: Option<String>,
) -> Result<(), String> {
    let shared = app.state::<AppState>();
    let mut runtime = shared
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;
    runtime.login_probe_state = Some(state);
    runtime.login_probe_message = message;
    Ok(())
}

fn summarize_command_output(output: &std::process::Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    let merged = if !stdout.is_empty() && !stderr.is_empty() {
        format!("{stdout}\n{stderr}")
    } else if !stdout.is_empty() {
        stdout
    } else if !stderr.is_empty() {
        stderr
    } else if output.status.success() {
        "Login command completed.".to_string()
    } else {
        "Login command failed. Please run `kimi login` manually and try again.".to_string()
    };

    let max_chars = 600usize;
    if merged.chars().count() <= max_chars {
        return merged;
    }

    let truncated: String = merged.chars().take(max_chars).collect();
    format!("{truncated}…")
}

fn query_kimi_version(kimi_path: &str) -> Result<String, String> {
    let mut process = Command::new(kimi_path);
    command_utils::configure_kimi_query_command(&mut process);
    let output = process
        .arg("--version")
        .output()
        .map_err(|error| format!("failed to run `{} --version`: {}", kimi_path, error))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if output.status.success() {
        if !stdout.is_empty() {
            return Ok(stdout);
        }
        if !stderr.is_empty() {
            return Ok(stderr);
        }
        return Ok("No version output".to_string());
    }

    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        "unknown error".to_string()
    };
    Err(format!(
        "`{} --version` failed ({}): {}",
        kimi_path, output.status, detail
    ))
}

fn read_log_tail(path: &std::path::Path, max_lines: usize) -> Vec<String> {
    let Ok(content) = std::fs::read_to_string(path) else {
        return Vec::new();
    };

    let lines: Vec<String> = content.lines().map(|line| line.to_string()).collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].to_vec()
}

fn diff_millis(start_ms: Option<u64>, end_ms: Option<u64>) -> Option<u64> {
    let start = start_ms?;
    let end = end_ms?;
    end.checked_sub(start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn onboarding_is_shown_for_missing_kimi_even_if_completed() {
        let mut settings = AppSettings::default();
        settings.onboarding_completed_version = CURRENT_ONBOARDING_VERSION;
        assert!(should_show_onboarding(
            &settings,
            false,
            BackendState::MissingKimi
        ));
    }

    #[test]
    fn onboarding_is_hidden_after_completion_for_normal_startup() {
        let mut settings = AppSettings::default();
        settings.onboarding_completed_version = CURRENT_ONBOARDING_VERSION;
        assert!(!should_show_onboarding(
            &settings,
            false,
            BackendState::Running
        ));
    }

    #[test]
    fn recommendation_prefers_install_when_kimi_missing() {
        let step = recommend_onboarding_step(
            BackendState::Starting,
            false,
            true,
            false,
            LoginProbeState::Unknown,
            false,
            false,
        );
        assert!(matches!(step, OnboardingStep::InstallKimi));
    }
}
