use anyhow::Context;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    types::{AppSettings, InstallMirrorPreset, CURRENT_SETTINGS_SCHEMA_VERSION},
};

pub fn load_or_default(app: &AppHandle) -> anyhow::Result<AppSettings> {
    let state = app.state::<AppState>();
    let path = state.settings_path.clone();

    if !path.exists() {
        let settings = AppSettings::default();
        save(app, &settings)?;
        return Ok(settings);
    }

    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("failed to read settings file: {}", path.display()))?;
    let mut settings: AppSettings = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse settings file: {}", path.display()))?;
    let mut changed = false;

    if settings.hotkey.trim().is_empty() {
        settings.hotkey = AppSettings::default().hotkey;
        changed = true;
    }

    if settings.schema_version < CURRENT_SETTINGS_SCHEMA_VERSION {
        settings.schema_version = CURRENT_SETTINGS_SCHEMA_VERSION;
        changed = true;
    }

    if settings.mirror_preset == InstallMirrorPreset::Aliyun {
        settings.mirror_preset = InstallMirrorPreset::Mixed;
        changed = true;
    }

    if changed {
        save(app, &settings)?;
    }

    Ok(settings)
}

pub fn save(app: &AppHandle, settings: &AppSettings) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    if let Some(parent) = state.settings_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create parent directory for settings: {}",
                parent.display()
            )
        })?;
    }

    let raw = serde_json::to_string_pretty(settings).context("failed to serialize settings")?;
    std::fs::write(&state.settings_path, raw).with_context(|| {
        format!(
            "failed to write settings file: {}",
            state.settings_path.display()
        )
    })?;

    Ok(())
}
