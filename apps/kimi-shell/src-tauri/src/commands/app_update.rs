use std::time::Duration;

use semver::Version;
use serde::Serialize;
use tauri::{ipc::Channel, AppHandle};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

use crate::{
    backend_manager, bridge_manager, log_manager, settings_store, types::AppUpdateSource,
    window_manager,
};

const GITHUB_UPDATE_ENDPOINT: &str =
    "https://github.com/endearqb/kickside/releases/latest/download/latest.json";
const GITEE_UPDATE_ENDPOINT: &str =
    "https://gitee.com/endearqb/kickside/releases/download/latest/latest.json";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateInfo {
    current_version: String,
    available: bool,
    configured_source: AppUpdateSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_source: Option<AppUpdateSource>,
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
    fn current(current_version: String, configured_source: AppUpdateSource) -> Self {
        Self {
            current_version,
            available: false,
            configured_source,
            resolved_source: None,
            version: None,
            date: None,
            body: None,
        }
    }
}

#[tauri::command]
pub(crate) fn get_app_update_source(app: AppHandle) -> Result<AppUpdateSource, String> {
    settings_store::load_or_default(&app)
        .map(|settings| settings.app_update_source)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_app_update_source(
    app: AppHandle,
    source: AppUpdateSource,
) -> Result<AppUpdateSource, String> {
    let mut settings = settings_store::load_or_default(&app).map_err(|error| error.to_string())?;
    settings.app_update_source = source;
    settings.schema_version = crate::types::CURRENT_SETTINGS_SCHEMA_VERSION;
    settings_store::save(&app, &settings).map_err(|error| error.to_string())?;
    Ok(source)
}

#[tauri::command]
pub(crate) async fn check_app_update(app: AppHandle) -> Result<AppUpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let configured_source = settings_store::load_or_default(&app)
        .map_err(|error| error.to_string())?
        .app_update_source;
    let (update, resolved_source) = check_selected_update(&app, configured_source).await?;

    Ok(match update {
        Some(update) => AppUpdateInfo {
            current_version,
            available: true,
            configured_source,
            resolved_source,
            version: Some(update.version),
            date: update.date.map(|value| value.to_string()),
            body: update.body,
        },
        None => AppUpdateInfo::current(current_version, configured_source),
    })
}

#[tauri::command]
pub(crate) async fn install_app_update(
    app: AppHandle,
    progress: Channel<AppUpdateProgress>,
) -> Result<(), String> {
    let configured_source = settings_store::load_or_default(&app)
        .map_err(|error| error.to_string())?
        .app_update_source;
    let (update, _) = check_selected_update(&app, configured_source).await?;
    let update = update.ok_or_else(|| "当前已是最新版本。".to_string())?;

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
    update.install(bytes).map_err(|error| error.to_string())?;
    log_manager::append_line(&app, "app update installed; exiting current process");
    app.exit(0);
    Ok(())
}

async fn check_selected_update(
    app: &AppHandle,
    source: AppUpdateSource,
) -> Result<(Option<Update>, Option<AppUpdateSource>), String> {
    match source {
        AppUpdateSource::Gitee | AppUpdateSource::Github => {
            let update = check_source(app, source).await?;
            let resolved = update.as_ref().map(|_| source);
            Ok((update, resolved))
        }
        AppUpdateSource::Auto => {
            let gitee_app = app.clone();
            let github_app = app.clone();
            let gitee_task = tauri::async_runtime::spawn(async move {
                check_source(&gitee_app, AppUpdateSource::Gitee).await
            });
            let github_task = tauri::async_runtime::spawn(async move {
                check_source(&github_app, AppUpdateSource::Github).await
            });
            let gitee = gitee_task
                .await
                .map_err(|error| format!("Gitee 更新检测任务失败：{error}"))?;
            let github = github_task
                .await
                .map_err(|error| format!("GitHub 更新检测任务失败：{error}"))?;
            select_auto_update(gitee, github)
        }
    }
}

async fn check_source(app: &AppHandle, source: AppUpdateSource) -> Result<Option<Update>, String> {
    let endpoint = endpoint_for_source(source)?;
    let mut update = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .timeout(UPDATE_CHECK_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| format!("{} 更新源检测失败：{error}", source_label(source)))?;
    // Keep the check bounded without imposing the same short timeout on large installer downloads.
    if let Some(update) = update.as_mut() {
        update.timeout = None;
    }
    Ok(update)
}

fn endpoint_for_source(source: AppUpdateSource) -> Result<Url, String> {
    let value = match source {
        AppUpdateSource::Gitee => GITEE_UPDATE_ENDPOINT,
        AppUpdateSource::Github => GITHUB_UPDATE_ENDPOINT,
        AppUpdateSource::Auto => return Err("自动更新源必须先解析为具体来源。".to_string()),
    };
    Url::parse(value).map_err(|error| error.to_string())
}

fn select_auto_update(
    gitee: Result<Option<Update>, String>,
    github: Result<Option<Update>, String>,
) -> Result<(Option<Update>, Option<AppUpdateSource>), String> {
    match (gitee, github) {
        (Ok(gitee), Ok(github)) => Ok(select_newer_update(gitee, github)),
        (Ok(update), Err(_)) => {
            let resolved = update.as_ref().map(|_| AppUpdateSource::Gitee);
            Ok((update, resolved))
        }
        (Err(_), Ok(update)) => {
            let resolved = update.as_ref().map(|_| AppUpdateSource::Github);
            Ok((update, resolved))
        }
        (Err(gitee_error), Err(github_error)) => {
            Err(format!("自动更新检测失败。{gitee_error}；{github_error}"))
        }
    }
}

fn select_newer_update(
    gitee: Option<Update>,
    github: Option<Update>,
) -> (Option<Update>, Option<AppUpdateSource>) {
    match (gitee, github) {
        (Some(gitee), Some(github)) => {
            if prefer_gitee_version(&gitee.version, &github.version) {
                (Some(gitee), Some(AppUpdateSource::Gitee))
            } else {
                (Some(github), Some(AppUpdateSource::Github))
            }
        }
        (Some(update), None) => (Some(update), Some(AppUpdateSource::Gitee)),
        (None, Some(update)) => (Some(update), Some(AppUpdateSource::Github)),
        (None, None) => (None, None),
    }
}

fn prefer_gitee_version(gitee: &str, github: &str) -> bool {
    match (Version::parse(gitee), Version::parse(github)) {
        (Ok(gitee), Ok(github)) => gitee >= github,
        _ => true,
    }
}

fn source_label(source: AppUpdateSource) -> &'static str {
    match source {
        AppUpdateSource::Auto => "自动",
        AppUpdateSource::Gitee => "Gitee",
        AppUpdateSource::Github => "GitHub",
    }
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
    use super::{endpoint_for_source, prefer_gitee_version, source_label, AppUpdateInfo};
    use crate::types::AppUpdateSource;

    #[test]
    fn current_version_has_no_remote_metadata() {
        assert_eq!(
            AppUpdateInfo::current("0.1.12".to_string(), AppUpdateSource::Auto),
            AppUpdateInfo {
                current_version: "0.1.12".to_string(),
                available: false,
                configured_source: AppUpdateSource::Auto,
                resolved_source: None,
                version: None,
                date: None,
                body: None,
            }
        );
    }

    #[test]
    fn explicit_sources_use_https_endpoints() {
        for source in [AppUpdateSource::Gitee, AppUpdateSource::Github] {
            let endpoint = endpoint_for_source(source).expect("endpoint");
            assert_eq!(endpoint.scheme(), "https");
            assert!(endpoint.as_str().ends_with("latest.json"));
        }
        assert!(endpoint_for_source(AppUpdateSource::Auto).is_err());
        assert_eq!(source_label(AppUpdateSource::Github), "GitHub");
    }

    #[test]
    fn auto_source_prefers_newer_version_and_gitee_on_ties() {
        assert!(prefer_gitee_version("0.2.3", "0.2.3"));
        assert!(prefer_gitee_version("0.2.4", "0.2.3"));
        assert!(!prefer_gitee_version("0.2.3", "0.2.4"));
        assert!(prefer_gitee_version("invalid", "0.2.4"));
    }
}
