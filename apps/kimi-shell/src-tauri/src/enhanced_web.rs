use serde::Deserialize;
use tauri::AppHandle;

use crate::{
    app_state::unix_time_millis,
    settings_store,
    types::{
        AppSettings, EnhancedWebHealth, EnhancedWebHealthState, WorkspaceWebMode,
        WorkspaceWebSettingsInput, WorkspaceWebSettingsView,
    },
};

pub const DISCLAIMER: &str =
    "本地增强版基于 MoonshotAI/kimi-cli 开源 Web 构建，由本应用维护；不代表 MoonshotAI 官方背书。";
pub const SOURCE_COMMIT: &str = "1e45df06da698151d2dc29a700722c37432e86ce";

const ENHANCED_WEB_MANIFEST: &str = include_str!("../../public/enhanced-kimi-web/manifest.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnhancedWebManifest {
    upstream_commit: String,
    variant: String,
}

pub fn settings_view(app: &AppHandle) -> Result<WorkspaceWebSettingsView, String> {
    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    Ok(view_from_settings(&settings))
}

pub fn save_settings(
    app: &AppHandle,
    input: WorkspaceWebSettingsInput,
) -> Result<WorkspaceWebSettingsView, String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.workspace_web_mode = input.mode;
    settings.enhanced_web_auto_fallback = input.auto_fallback;
    if matches!(settings.workspace_web_mode, WorkspaceWebMode::EnhancedLocal) {
        settings.enhanced_web_pinned_commit = Some(SOURCE_COMMIT.to_string());
    }
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    Ok(view_from_settings(&settings))
}

pub fn fallback_to_official(
    app: &AppHandle,
    reason: &str,
) -> Result<WorkspaceWebSettingsView, String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let trimmed_reason = reason.trim();
    settings.workspace_web_mode = WorkspaceWebMode::Official;
    settings.enhanced_web_last_fallback_reason = Some(if trimmed_reason.is_empty() {
        "enhanced_web_fallback".to_string()
    } else {
        trimmed_reason.to_string()
    });
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    Ok(view_from_settings(&settings))
}

pub fn mark_enhanced_ready(app: &AppHandle) -> Result<WorkspaceWebSettingsView, String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.enhanced_web_last_known_good_commit = Some(SOURCE_COMMIT.to_string());
    settings.enhanced_web_last_fallback_reason = None;
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    Ok(view_from_settings(&settings))
}

pub fn health(settings: &AppSettings) -> EnhancedWebHealth {
    match serde_json::from_str::<EnhancedWebManifest>(ENHANCED_WEB_MANIFEST) {
        Ok(manifest)
            if manifest.upstream_commit == SOURCE_COMMIT
                && manifest.variant == "enhanced_local_wrapper" =>
        {
            if matches!(settings.workspace_web_mode, WorkspaceWebMode::Official)
                && settings.enhanced_web_last_fallback_reason.is_some()
            {
                return EnhancedWebHealth {
                    state: EnhancedWebHealthState::FallbackActive,
                    message: "增强版最近触发回退，当前使用官方 Web。".to_string(),
                    source_commit: Some(SOURCE_COMMIT.to_string()),
                    checked_at_ms: Some(unix_time_millis()),
                };
            }
            EnhancedWebHealth {
                state: EnhancedWebHealthState::Ready,
                message: "本地增强注入已启用，工作区将直接加载官方 Web 并应用中文化与桌面优化。"
                    .to_string(),
                source_commit: Some(SOURCE_COMMIT.to_string()),
                checked_at_ms: Some(unix_time_millis()),
            }
        }
        Ok(_) => EnhancedWebHealth {
            state: EnhancedWebHealthState::Error,
            message: "增强版入口元数据与当前来源 commit 不一致。".to_string(),
            source_commit: Some(SOURCE_COMMIT.to_string()),
            checked_at_ms: Some(unix_time_millis()),
        },
        Err(error) => EnhancedWebHealth {
            state: EnhancedWebHealthState::MissingAssets,
            message: format!("增强版入口元数据不可用：{error}"),
            source_commit: Some(SOURCE_COMMIT.to_string()),
            checked_at_ms: Some(unix_time_millis()),
        },
    }
}

pub fn view_from_settings(settings: &AppSettings) -> WorkspaceWebSettingsView {
    WorkspaceWebSettingsView {
        mode: settings.workspace_web_mode,
        auto_fallback: settings.enhanced_web_auto_fallback,
        pinned_commit: settings.enhanced_web_pinned_commit.clone(),
        last_known_good_commit: settings.enhanced_web_last_known_good_commit.clone(),
        last_fallback_reason: settings.enhanced_web_last_fallback_reason.clone(),
        source_commit: Some(SOURCE_COMMIT.to_string()),
        health: health(settings),
        disclaimer: DISCLAIMER.to_string(),
    }
}
