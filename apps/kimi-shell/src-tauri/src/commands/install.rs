use tauri::{ipc::Channel, AppHandle, State};

use crate::{
    install_manager,
    types::{
        InstallFlowCatalog, InstallMirrorHealthReport, InstallProbeStatus, InstallSessionEvent,
        InstallSessionSnapshot, InstallSettingsView, InstallSource, InstallTaskId,
        PowerShellPreflightSummary,
    },
};

#[tauri::command]
pub(crate) fn register_install_session_channel(
    state: State<install_manager::InstallManager>,
    channel: Channel<InstallSessionEvent>,
) -> Result<InstallSessionSnapshot, String> {
    state.register_channel(channel)
}

#[tauri::command]
pub(crate) fn get_install_flow_catalog(app: AppHandle) -> InstallFlowCatalog {
    install_manager::build_install_flow_catalog(&app)
}

#[tauri::command]
pub(crate) fn get_install_session_snapshot(
    state: State<install_manager::InstallManager>,
) -> Result<InstallSessionSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
pub(crate) fn start_install_task(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    task_id: InstallTaskId,
    source: InstallSource,
) -> Result<InstallSessionSnapshot, String> {
    state.start_task(&app, task_id, source)
}

#[tauri::command]
pub(crate) fn cancel_install_task(
    state: State<install_manager::InstallManager>,
) -> Result<InstallSessionSnapshot, String> {
    state.cancel_task()
}

#[tauri::command]
pub(crate) fn install_kimi_dependencies(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::QuickInstallCore, source)
}

#[tauri::command]
pub(crate) fn install_kimi_code(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::InstallKimi, source)
}

#[tauri::command]
pub(crate) fn upgrade_kimi_code(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::UpgradeKimi, source)
}

#[tauri::command]
pub(crate) fn uninstall_kimi_code(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
    source: InstallSource,
) -> Result<String, String> {
    install_manager::start_compat_task(&app, &state, InstallTaskId::UninstallKimi, source)
}

#[tauri::command]
pub(crate) fn install_nodejs(
    app: AppHandle,
    state: State<install_manager::InstallManager>,
) -> Result<String, String> {
    install_manager::start_compat_task(
        &app,
        &state,
        InstallTaskId::InstallNodejs,
        InstallSource::Official,
    )
}

#[tauri::command]
pub(crate) fn get_install_probe_status(app: AppHandle) -> InstallProbeStatus {
    install_manager::get_install_probe_status(&app)
}

#[tauri::command]
pub(crate) fn get_install_settings(app: AppHandle) -> InstallSettingsView {
    install_manager::get_install_settings(&app)
}

#[tauri::command]
pub(crate) fn save_install_settings(
    app: AppHandle,
    input: InstallSettingsView,
) -> Result<InstallSettingsView, String> {
    install_manager::save_install_settings(&app, input)
}

#[tauri::command]
pub(crate) fn get_install_mirror_health_report(
    input: InstallSettingsView,
) -> Result<InstallMirrorHealthReport, String> {
    install_manager::get_install_mirror_health_report(input)
}

#[tauri::command]
pub(crate) fn get_powershell_preflight() -> PowerShellPreflightSummary {
    install_manager::get_powershell_preflight()
}
