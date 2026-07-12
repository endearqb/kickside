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

    if settings.schema_version < 9 {
        migrate_context_menu_labels(&mut settings);
        changed = true;
    }

    if settings.schema_version < 10 {
        migrate_context_menu_copy_label(&mut settings);
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

fn migrate_context_menu_labels(settings: &mut AppSettings) {
    let defaults = &mut settings.context_menu_labels;
    if defaults.open_dir_background == "Open Kimi Web Shell here" {
        defaults.open_dir_background = "在此处打开 Kimi 小助手".to_string();
    }
    if defaults.open_dir == "Open in Kimi Web Shell" {
        defaults.open_dir = "在 Kimi 小助手中打开".to_string();
    }
    if defaults.open_file == "Open in Kimi Web Shell (Copy to Workspace)" {
        defaults.open_file = "复制到工作区并用 Kimi 小助手打开".to_string();
    }
    if defaults.open_filesystem_object == "Open in Kimi Web Shell" {
        defaults.open_filesystem_object = "在 Kimi 小助手中打开".to_string();
    }
    if defaults.move_to_workspace == "移动到工作区" {
        defaults.move_to_workspace = "移动到 Kimi 小助手工作区".to_string();
    }
}

fn migrate_context_menu_copy_label(settings: &mut AppSettings) {
    if settings.context_menu_labels.move_to_workspace == "移动到 Kimi 小助手工作区" {
        settings.context_menu_labels.move_to_workspace = "复制到 Kimi 小助手工作区".to_string();
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_menu_migration_replaces_only_historical_defaults() {
        let mut settings = AppSettings::default();
        settings.context_menu_labels.open_dir_background = "Open Kimi Web Shell here".into();
        settings.context_menu_labels.open_dir = "我的自定义文件夹菜单".into();
        settings.context_menu_labels.move_to_workspace = "移动到工作区".into();

        migrate_context_menu_labels(&mut settings);

        assert_eq!(
            settings.context_menu_labels.open_dir_background,
            "在此处打开 Kimi 小助手"
        );
        assert_eq!(
            settings.context_menu_labels.open_dir,
            "我的自定义文件夹菜单"
        );
        assert_eq!(
            settings.context_menu_labels.move_to_workspace,
            "移动到 Kimi 小助手工作区"
        );
    }

    #[test]
    fn context_menu_copy_label_migration_preserves_custom_values() {
        let mut settings = AppSettings::default();
        settings.context_menu_labels.move_to_workspace = "移动到 Kimi 小助手工作区".into();
        migrate_context_menu_copy_label(&mut settings);
        assert_eq!(
            settings.context_menu_labels.move_to_workspace,
            "复制到 Kimi 小助手工作区"
        );

        settings.context_menu_labels.move_to_workspace = "我的自定义菜单".into();
        migrate_context_menu_copy_label(&mut settings);
        assert_eq!(
            settings.context_menu_labels.move_to_workspace,
            "我的自定义菜单"
        );
    }
}
