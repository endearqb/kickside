use std::{fs, path::Path};

use anyhow::Context;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    settings_store,
    types::{
        AppSettings, BridgeChannelConfig, BridgeChannelMode, BridgeOnboardingConfigInput,
        BridgePlatform, BridgeSecrets, BridgeSettings, CURRENT_SETTINGS_SCHEMA_VERSION,
    },
};

pub const DEFAULT_BRIDGE_ADMIN_PORT: u16 = 60_110;

pub fn load_or_default(app: &AppHandle) -> anyhow::Result<BridgeSettings> {
    let state = app.state::<AppState>();
    let (_, settings) = load_or_default_files(&state.settings_path, &state.bridge_settings_path)?;
    Ok(settings)
}

pub fn save(app: &AppHandle, input: &BridgeSettings) -> anyhow::Result<BridgeSettings> {
    let state = app.state::<AppState>();
    let (_, settings) = save_files(&state.settings_path, &state.bridge_settings_path, input)?;
    Ok(settings)
}

pub fn load_secrets_or_default(app: &AppHandle) -> anyhow::Result<BridgeSecrets> {
    let state = app.state::<AppState>();
    load_secrets_at(&state.bridge_secrets_path)
}

pub fn save_onboarding_config(
    app: &AppHandle,
    input: &BridgeOnboardingConfigInput,
) -> anyhow::Result<BridgeSettings> {
    let state = app.state::<AppState>();
    let (_, settings, _) = save_onboarding_files(
        &state.settings_path,
        &state.bridge_settings_path,
        &state.bridge_secrets_path,
        input,
    )?;
    Ok(settings)
}

pub fn ensure_bridge_files(app: &AppHandle) -> anyhow::Result<()> {
    let _ = settings_store::load_or_default(app)?;
    let _ = load_or_default(app)?;
    let _ = load_secrets_or_default(app)?;
    Ok(())
}

fn load_or_default_files(
    app_settings_path: &Path,
    bridge_settings_path: &Path,
) -> anyhow::Result<(AppSettings, BridgeSettings)> {
    let mut app_settings = load_app_settings_at(app_settings_path)?;
    let mut bridge_settings = if bridge_settings_path.exists() {
        read_json::<BridgeSettings>(bridge_settings_path)?
    } else {
        default_bridge_settings(&app_settings)
    };
    bridge_settings = normalize_bridge_settings(bridge_settings);
    write_json(bridge_settings_path, &bridge_settings)?;

    if sync_bridge_mirror(&bridge_settings, &mut app_settings) {
        save_app_settings_at(app_settings_path, &app_settings)?;
    }

    Ok((app_settings, bridge_settings))
}

fn save_files(
    app_settings_path: &Path,
    bridge_settings_path: &Path,
    input: &BridgeSettings,
) -> anyhow::Result<(AppSettings, BridgeSettings)> {
    let mut app_settings = load_app_settings_at(app_settings_path)?;
    let bridge_settings = normalize_bridge_settings(input.clone());
    write_json(bridge_settings_path, &bridge_settings)?;

    if sync_bridge_mirror(&bridge_settings, &mut app_settings) {
        save_app_settings_at(app_settings_path, &app_settings)?;
    }

    Ok((app_settings, bridge_settings))
}

fn save_onboarding_files(
    app_settings_path: &Path,
    bridge_settings_path: &Path,
    bridge_secrets_path: &Path,
    input: &BridgeOnboardingConfigInput,
) -> anyhow::Result<(AppSettings, BridgeSettings, BridgeSecrets)> {
    let mut app_settings = load_app_settings_at(app_settings_path)?;
    let existing_settings = if bridge_settings_path.exists() {
        read_json::<BridgeSettings>(bridge_settings_path)?
    } else {
        default_bridge_settings(&app_settings)
    };
    let mut bridge_settings = normalize_bridge_settings(existing_settings);
    let mut bridge_secrets = load_secrets_at(bridge_secrets_path)?;

    apply_onboarding_input(&mut bridge_settings, &mut bridge_secrets, input)?;

    write_json(bridge_secrets_path, &bridge_secrets)?;
    write_json(bridge_settings_path, &bridge_settings)?;

    if sync_bridge_mirror(&bridge_settings, &mut app_settings) {
        save_app_settings_at(app_settings_path, &app_settings)?;
    }

    Ok((app_settings, bridge_settings, bridge_secrets))
}

fn load_app_settings_at(path: &Path) -> anyhow::Result<AppSettings> {
    if path.exists() {
        let mut settings = read_json::<AppSettings>(path)?;
        if settings.hotkey.trim().is_empty() {
            settings.hotkey = AppSettings::default().hotkey;
        }
        if settings.schema_version < CURRENT_SETTINGS_SCHEMA_VERSION {
            settings.schema_version = CURRENT_SETTINGS_SCHEMA_VERSION;
        }
        save_app_settings_at(path, &settings)?;
        return Ok(settings);
    }

    let settings = AppSettings::default();
    save_app_settings_at(path, &settings)?;
    Ok(settings)
}

fn save_app_settings_at(path: &Path, settings: &AppSettings) -> anyhow::Result<()> {
    write_json(path, settings)
}

fn load_secrets_at(path: &Path) -> anyhow::Result<BridgeSecrets> {
    if path.exists() {
        return read_json(path);
    }
    let secrets = BridgeSecrets::default();
    write_json(path, &secrets)?;
    Ok(secrets)
}

fn trim_optional_string(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn apply_onboarding_input(
    bridge_settings: &mut BridgeSettings,
    bridge_secrets: &mut BridgeSecrets,
    input: &BridgeOnboardingConfigInput,
) -> anyhow::Result<()> {
    if let Some(value) = trim_optional_string(input.feishu.app_id.clone()) {
        bridge_secrets.feishu.app_id = Some(value);
    }
    if let Some(value) = trim_optional_string(input.feishu.app_secret.clone()) {
        bridge_secrets.feishu.app_secret = Some(value);
    }
    if let Some(value) = trim_optional_string(input.feishu.verification_token.clone()) {
        bridge_secrets.feishu.verification_token = Some(value);
    }
    if let Some(value) = trim_optional_string(input.feishu.encrypt_key.clone()) {
        bridge_secrets.feishu.encrypt_key = Some(value);
    }

    if input.feishu_enabled
        && (bridge_secrets.feishu.app_id.is_none() || bridge_secrets.feishu.app_secret.is_none())
    {
        anyhow::bail!("feishu appId and appSecret are required before enabling Feishu bridge")
    }

    bridge_settings.enabled = input.enabled || input.feishu_enabled;
    for channel in &mut bridge_settings.channels {
        if channel.platform == BridgePlatform::Feishu {
            channel.enabled = input.feishu_enabled;
        }
    }

    *bridge_settings = normalize_bridge_settings(bridge_settings.clone());
    Ok(())
}

fn read_json<T>(path: &Path) -> anyhow::Result<T>
where
    T: serde::de::DeserializeOwned,
{
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read json file: {}", path.display()))?;
    serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse json file: {}", path.display()))
}

fn write_json<T>(path: &Path, value: &T) -> anyhow::Result<()>
where
    T: serde::Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create parent directory: {}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(value).context("failed to serialize json")?;
    fs::write(path, raw).with_context(|| format!("failed to write json file: {}", path.display()))
}

fn default_bridge_settings(app_settings: &AppSettings) -> BridgeSettings {
    BridgeSettings {
        enabled: app_settings.bridge_enabled,
        auto_start: app_settings.bridge_auto_start,
        admin_port: app_settings
            .bridge_admin_port_override
            .unwrap_or(DEFAULT_BRIDGE_ADMIN_PORT),
        channels: vec![
            default_channel(BridgePlatform::Telegram),
            default_channel(BridgePlatform::Feishu),
        ],
    }
}

fn normalize_bridge_settings(settings: BridgeSettings) -> BridgeSettings {
    let telegram = settings
        .channels
        .iter()
        .find(|channel| channel.platform == BridgePlatform::Telegram)
        .cloned()
        .unwrap_or_else(|| default_channel(BridgePlatform::Telegram));
    let feishu = settings
        .channels
        .iter()
        .find(|channel| channel.platform == BridgePlatform::Feishu)
        .cloned()
        .unwrap_or_else(|| default_channel(BridgePlatform::Feishu));

    BridgeSettings {
        enabled: settings.enabled,
        auto_start: settings.auto_start,
        admin_port: if settings.admin_port == 0 {
            DEFAULT_BRIDGE_ADMIN_PORT
        } else {
            settings.admin_port
        },
        channels: vec![
            normalize_channel(telegram, BridgePlatform::Telegram),
            normalize_channel(feishu, BridgePlatform::Feishu),
        ],
    }
}

fn normalize_channel(
    mut channel: BridgeChannelConfig,
    platform: BridgePlatform,
) -> BridgeChannelConfig {
    channel.platform = platform;
    if channel.account_label.trim().is_empty() {
        channel.account_label = match platform {
            BridgePlatform::Telegram => "Telegram".to_string(),
            BridgePlatform::Feishu => "Feishu".to_string(),
        };
    }
    channel.mode = match platform {
        BridgePlatform::Telegram => BridgeChannelMode::Polling,
        BridgePlatform::Feishu => BridgeChannelMode::Websocket,
    };
    channel
}

fn default_channel(platform: BridgePlatform) -> BridgeChannelConfig {
    match platform {
        BridgePlatform::Telegram => BridgeChannelConfig {
            platform,
            enabled: false,
            mode: BridgeChannelMode::Polling,
            account_label: "Telegram".to_string(),
        },
        BridgePlatform::Feishu => BridgeChannelConfig {
            platform,
            enabled: false,
            mode: BridgeChannelMode::Websocket,
            account_label: "Feishu".to_string(),
        },
    }
}

fn sync_bridge_mirror(bridge_settings: &BridgeSettings, app_settings: &mut AppSettings) -> bool {
    let next_admin_override = if bridge_settings.admin_port == DEFAULT_BRIDGE_ADMIN_PORT {
        None
    } else {
        Some(bridge_settings.admin_port)
    };

    let changed = app_settings.bridge_enabled != bridge_settings.enabled
        || app_settings.bridge_auto_start != bridge_settings.auto_start
        || app_settings.bridge_admin_port_override != next_admin_override
        || app_settings.schema_version != CURRENT_SETTINGS_SCHEMA_VERSION;

    if changed {
        app_settings.bridge_enabled = bridge_settings.enabled;
        app_settings.bridge_auto_start = bridge_settings.auto_start;
        app_settings.bridge_admin_port_override = next_admin_override;
        app_settings.schema_version = CURRENT_SETTINGS_SCHEMA_VERSION;
    }

    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
            let epoch = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis();
            let path = std::env::temp_dir().join(format!(
                "kimi-shell-bridge-settings-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("temp dir should be created");
            let _ = epoch;
            Self { path }
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn load_or_default_creates_bridge_settings_and_defaults() {
        let temp = TempDirGuard::new("defaults");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");

        let (app_settings, bridge_settings) =
            load_or_default_files(&settings_path, &bridge_settings_path).expect("bridge settings");

        assert!(!bridge_settings.enabled);
        assert!(!bridge_settings.auto_start);
        assert_eq!(bridge_settings.admin_port, DEFAULT_BRIDGE_ADMIN_PORT);
        assert_eq!(bridge_settings.channels.len(), 2);
        assert!(!app_settings.bridge_enabled);
        assert!(!app_settings.bridge_auto_start);
        assert!(bridge_settings_path.exists());
        assert!(settings_path.exists());
    }

    #[test]
    fn save_syncs_mirror_fields_into_settings_json() {
        let temp = TempDirGuard::new("mirror");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");

        let input = BridgeSettings {
            enabled: true,
            auto_start: true,
            admin_port: 60_112,
            channels: vec![default_channel(BridgePlatform::Telegram)],
        };

        let (app_settings, bridge_settings) =
            save_files(&settings_path, &bridge_settings_path, &input).expect("save bridge files");

        assert!(bridge_settings.enabled);
        assert!(bridge_settings.auto_start);
        assert_eq!(bridge_settings.admin_port, 60_112);
        assert_eq!(bridge_settings.channels.len(), 2);
        assert!(app_settings.bridge_enabled);
        assert!(app_settings.bridge_auto_start);
        assert_eq!(app_settings.bridge_admin_port_override, Some(60_112));
    }

    #[test]
    fn load_secrets_creates_empty_file() {
        let temp = TempDirGuard::new("secrets");
        let secrets_path = temp.path.join("bridge_secrets.json");

        let secrets = load_secrets_at(&secrets_path).expect("bridge secrets");

        assert_eq!(secrets, BridgeSecrets::default());
        assert!(secrets_path.exists());
    }

    #[test]
    fn save_onboarding_config_enables_feishu_and_persists_secrets() {
        let temp = TempDirGuard::new("onboarding-save");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");
        let bridge_secrets_path = temp.path.join("bridge_secrets.json");

        let input = BridgeOnboardingConfigInput {
            enabled: false,
            feishu_enabled: true,
            feishu: crate::types::BridgeOnboardingFeishuInput {
                app_id: Some(" cli-app-id ".to_string()),
                app_secret: Some(" cli-app-secret ".to_string()),
                verification_token: Some("verify-token".to_string()),
                encrypt_key: Some("encrypt-key".to_string()),
            },
        };

        let (_, bridge_settings, bridge_secrets) = save_onboarding_files(
            &settings_path,
            &bridge_settings_path,
            &bridge_secrets_path,
            &input,
        )
        .expect("save onboarding config");

        assert!(bridge_settings.enabled);
        assert_eq!(bridge_settings.channels.len(), 2);
        assert!(
            bridge_settings
                .channels
                .iter()
                .find(|channel| channel.platform == BridgePlatform::Feishu)
                .expect("feishu channel")
                .enabled
        );
        assert_eq!(bridge_secrets.feishu.app_id.as_deref(), Some("cli-app-id"));
        assert_eq!(
            bridge_secrets.feishu.app_secret.as_deref(),
            Some("cli-app-secret")
        );
        assert_eq!(
            bridge_secrets.feishu.verification_token.as_deref(),
            Some("verify-token")
        );
        assert_eq!(
            bridge_secrets.feishu.encrypt_key.as_deref(),
            Some("encrypt-key")
        );
    }

    #[test]
    fn save_onboarding_config_keeps_existing_secrets_when_inputs_are_blank() {
        let temp = TempDirGuard::new("onboarding-preserve");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");
        let bridge_secrets_path = temp.path.join("bridge_secrets.json");

        write_json(
            &bridge_secrets_path,
            &BridgeSecrets {
                telegram: Default::default(),
                feishu: crate::types::BridgeFeishuSecrets {
                    app_id: Some("existing-app-id".to_string()),
                    app_secret: Some("existing-app-secret".to_string()),
                    verification_token: Some("existing-token".to_string()),
                    encrypt_key: None,
                },
            },
        )
        .expect("seed secrets");

        let input = BridgeOnboardingConfigInput {
            enabled: true,
            feishu_enabled: true,
            feishu: Default::default(),
        };

        let (_, bridge_settings, bridge_secrets) = save_onboarding_files(
            &settings_path,
            &bridge_settings_path,
            &bridge_secrets_path,
            &input,
        )
        .expect("save onboarding config");

        assert!(bridge_settings.enabled);
        assert!(
            bridge_settings
                .channels
                .iter()
                .find(|channel| channel.platform == BridgePlatform::Feishu)
                .expect("feishu channel")
                .enabled
        );
        assert_eq!(
            bridge_secrets.feishu.app_id.as_deref(),
            Some("existing-app-id")
        );
        assert_eq!(
            bridge_secrets.feishu.app_secret.as_deref(),
            Some("existing-app-secret")
        );
        assert_eq!(
            bridge_secrets.feishu.verification_token.as_deref(),
            Some("existing-token")
        );
    }

    #[test]
    fn save_onboarding_config_rejects_enabling_feishu_without_effective_credentials() {
        let temp = TempDirGuard::new("onboarding-invalid");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");
        let bridge_secrets_path = temp.path.join("bridge_secrets.json");

        let input = BridgeOnboardingConfigInput {
            enabled: false,
            feishu_enabled: true,
            feishu: Default::default(),
        };

        let error = save_onboarding_files(
            &settings_path,
            &bridge_settings_path,
            &bridge_secrets_path,
            &input,
        )
        .expect_err("missing feishu credentials should fail");

        assert!(
            error
                .to_string()
                .contains("feishu appId and appSecret are required"),
            "unexpected error: {error:#}"
        );
    }
}
