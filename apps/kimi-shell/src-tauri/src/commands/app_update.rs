use serde::Serialize;
use tauri::{ipc::Channel, AppHandle};
use tauri_plugin_updater::UpdaterExt;

use crate::{backend_manager, bridge_manager, log_manager, window_manager};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateInfo {
    current_version: String,
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateProgress {
    stage: &'static str,
    downloaded: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'static str>,
}

impl AppUpdateInfo {
    fn current(current_version: String) -> Self {
        Self {
            current_version,
            available: false,
            version: None,
            date: None,
            body: None,
        }
    }
}

#[tauri::command]
pub(crate) async fn check_app_update(app: AppHandle) -> Result<AppUpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let update = app
        .updater()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    Ok(match update {
        Some(update) => AppUpdateInfo {
            current_version,
            available: true,
            version: Some(update.version),
            date: update.date.map(|value| value.to_string()),
            body: update.body,
        },
        None => AppUpdateInfo::current(current_version),
    })
}

#[tauri::command]
pub(crate) async fn install_app_update(
    app: AppHandle,
    progress: Channel<AppUpdateProgress>,
) -> Result<(), String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "当前已是最新版本。".to_string())?;

    let _ = progress.send(AppUpdateProgress {
        stage: "downloading",
        downloaded: 0,
        total: None,
        message: Some("正在下载更新…"),
    });

    let mut downloaded = 0_u64;
    let progress_for_chunks = progress.clone();
    let progress_for_finish = progress.clone();
    let bytes = update
        .download(
            move |chunk_length, total| {
                downloaded = downloaded.saturating_add(chunk_length as u64);
                let _ = progress_for_chunks.send(AppUpdateProgress {
                    stage: "downloading",
                    downloaded,
                    total,
                    message: None,
                });
            },
            move || {
                let _ = progress_for_finish.send(AppUpdateProgress {
                    stage: "installing",
                    downloaded: 0,
                    total: None,
                    message: Some("下载完成，正在安装…"),
                });
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    prepare_for_update_exit(&app).map_err(|error| error.to_string())?;
    update.install(bytes).map_err(|error| error.to_string())
}

fn prepare_for_update_exit(app: &AppHandle) -> anyhow::Result<()> {
    log_manager::append_line(
        app,
        "app update installer requested graceful runtime shutdown",
    );

    backend_manager::stop_backend(app)?;
    crate::dsh_manager::stop(app)?;
    bridge_manager::stop_bridge(app)?;
    window_manager::permit_process_exit(app, "app_update_install");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::AppUpdateInfo;

    #[test]
    fn current_version_has_no_remote_metadata() {
        assert_eq!(
            AppUpdateInfo::current("0.1.12".to_string()),
            AppUpdateInfo {
                current_version: "0.1.12".to_string(),
                available: false,
                version: None,
                date: None,
                body: None,
            }
        );
    }
}
