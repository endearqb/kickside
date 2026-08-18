use tauri::AppHandle;

use crate::lan_access::{self, KimiLanAccessStatus, KimiLanLaunchUrl};

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
