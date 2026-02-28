mod app_state;
mod backend_manager;
mod cli_contract;
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

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_global_shortcut::ShortcutState;

use app_state::{unix_time_millis, AppState};
use types::{AppStatus, ContextMenuStatus, DiagnosticsInfo};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = shortcut_manager::default_shortcut();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
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

            let settings = settings_store::load_or_default(app.handle()).unwrap_or_default();

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
            backend_manager::start_backend(app.handle().clone());

            if settings.start_minimized_to_tray {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            retry_start_backend,
            report_loading_rendered,
            save_kimi_path,
            save_work_dir,
            get_diagnostics,
            open_logs_folder,
            get_context_menu_status,
            enable_context_menu,
            disable_context_menu
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::WindowEvent { label, event, .. } => {
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

fn query_kimi_version(kimi_path: &str) -> Result<String, String> {
    let output = Command::new(kimi_path)
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
