use tauri::AppHandle;

use crate::lan_access::{self, KimiLanAccessStatus, KimiLanLaunchUrl};
use crate::{
    kimi_access::{self, KimiAccessStatus, KimiRemoteLaunchUrl},
    types::KimiAccessMode,
};

#[tauri::command]
pub(crate) fn get_kimi_access_status(app: AppHandle) -> Result<KimiAccessStatus, String> {
    kimi_access::status(&app)
}

#[tauri::command]
pub(crate) async fn set_kimi_access_mode(
    app: AppHandle,
    mode: KimiAccessMode,
) -> Result<KimiAccessStatus, String> {
    tauri::async_runtime::spawn_blocking(move || kimi_access::set_mode(app, mode))
        .await
        .map_err(|_| "Kimi 访问方式切换任务异常终止".to_string())?
}

#[tauri::command]
pub(crate) fn get_kimi_remote_launch_url(app: AppHandle) -> Result<KimiRemoteLaunchUrl, String> {
    kimi_access::remote_launch_url(&app)
}

#[tauri::command]
pub(crate) fn get_kimi_lan_access_status(app: AppHandle) -> Result<KimiLanAccessStatus, String> {
    lan_access::status(&app)
}

#[tauri::command]
pub(crate) async fn set_kimi_lan_access(
    app: AppHandle,
    enabled: bool,
) -> Result<KimiLanAccessStatus, String> {
    tauri::async_runtime::spawn_blocking(move || lan_access::set_enabled(app, enabled))
        .await
        .map_err(|_| "局域网访问切换任务异常终止".to_string())?
}

#[tauri::command]
pub(crate) fn get_kimi_lan_launch_url(
    app: AppHandle,
    ip: String,
) -> Result<KimiLanLaunchUrl, String> {
    lan_access::launch_url(&app, &ip)
}
