use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::Path,
};

use anyhow::Context;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    settings_store,
    types::{
        AppSettings, BridgeChannelMode, BridgeConnectorConfig, BridgeConnectorSecrets,
        BridgeConnectorSecretsInput, BridgeFeishuSecrets, BridgeOnboardingConfigInput,
        BridgePlatform, BridgeSecrets, BridgeSettings, BridgeSkillsMode, BridgeTelegramSecrets,
        FeishuReplyRenderer, WorkDirPreset, CURRENT_SETTINGS_SCHEMA_VERSION,
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

pub fn save_connector_secrets(
    app: &AppHandle,
    input: &BridgeConnectorSecretsInput,
) -> anyhow::Result<BridgeSecrets> {
    let state = app.state::<AppState>();
    let mut secrets = load_secrets_at(&state.bridge_secrets_path)?;
    let connector_id = input.connector_id.trim();
    if connector_id.is_empty() {
        anyhow::bail!("connector id is required")
    }

    let entry = secrets
        .connectors
        .entry(connector_id.to_string())
        .or_insert_with(BridgeConnectorSecrets::default);

    if input.telegram.bot_token.is_some() {
        let telegram = entry
            .telegram
            .clone()
            .unwrap_or_else(BridgeTelegramSecrets::default);
        entry.telegram = Some(BridgeTelegramSecrets {
            bot_token: trim_optional_string(input.telegram.bot_token.clone())
                .or(telegram.bot_token),
        });
    }

    if input.feishu.app_id.is_some()
        || input.feishu.app_secret.is_some()
        || input.feishu.verification_token.is_some()
        || input.feishu.encrypt_key.is_some()
    {
        let existing = entry
            .feishu
            .clone()
            .unwrap_or_else(BridgeFeishuSecrets::default);
        entry.feishu = Some(BridgeFeishuSecrets {
            app_id: if input.feishu.app_id.is_some() {
                trim_optional_string(input.feishu.app_id.clone()).or(existing.app_id)
            } else {
                existing.app_id
            },
            app_secret: if input.feishu.app_secret.is_some() {
                trim_optional_string(input.feishu.app_secret.clone()).or(existing.app_secret)
            } else {
                existing.app_secret
            },
            verification_token: if input.feishu.verification_token.is_some() {
                trim_optional_string(input.feishu.verification_token.clone())
                    .or(existing.verification_token)
            } else {
                existing.verification_token
            },
            encrypt_key: if input.feishu.encrypt_key.is_some() {
                trim_optional_string(input.feishu.encrypt_key.clone()).or(existing.encrypt_key)
            } else {
                existing.encrypt_key
            },
        });
    }

    secrets = normalize_bridge_secrets(secrets);
    write_json(&state.bridge_secrets_path, &secrets)?;
    Ok(secrets)
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

pub fn sync_default_work_dir_from_app(
    app: &AppHandle,
    previous_app_work_dir: Option<String>,
) -> anyhow::Result<BridgeSettings> {
    let state = app.state::<AppState>();
    let mut app_settings = load_app_settings_at(&state.settings_path)?;
    let bridge_settings_exists = state.bridge_settings_path.exists();
    let mut bridge_settings = if bridge_settings_exists {
        read_json::<BridgeSettings>(&state.bridge_settings_path)?
    } else {
        default_bridge_settings(&app_settings)
    };
    bridge_settings = normalize_bridge_settings(bridge_settings);

    let changed = sync_bridge_default_work_dir_from_app(
        &mut bridge_settings,
        previous_app_work_dir.as_deref(),
        app_settings.work_dir.as_deref(),
    );
    if changed || !bridge_settings_exists {
        write_json(&state.bridge_settings_path, &bridge_settings)?;
    }

    if sync_bridge_mirror(&bridge_settings, &mut app_settings) {
        save_app_settings_at(&state.settings_path, &app_settings)?;
    }

    Ok(bridge_settings)
}

pub fn preview_default_work_dir_after_app_sync(
    settings: &BridgeSettings,
    previous_app_work_dir: Option<&str>,
    next_app_work_dir: Option<&str>,
) -> Option<String> {
    let mut preview = normalize_bridge_settings(settings.clone());
    sync_bridge_default_work_dir_from_app(&mut preview, previous_app_work_dir, next_app_work_dir);
    preview.default_work_dir
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
    sync_bridge_default_work_dir_from_app(
        &mut bridge_settings,
        None,
        app_settings.work_dir.as_deref(),
    );
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
    let mut bridge_settings = normalize_bridge_settings(input.clone());
    sync_bridge_default_work_dir_from_app(
        &mut bridge_settings,
        None,
        app_settings.work_dir.as_deref(),
    );
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
    sync_bridge_default_work_dir_from_app(
        &mut bridge_settings,
        None,
        app_settings.work_dir.as_deref(),
    );

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
        return read_json(path).map(normalize_bridge_secrets);
    }
    let secrets = normalize_bridge_secrets(BridgeSecrets::default());
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

fn normalize_work_dir_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
}

fn normalize_work_dir_presets(presets: Vec<WorkDirPreset>) -> Vec<WorkDirPreset> {
    if presets.is_empty() {
        return Vec::new();
    }

    let mut normalized = Vec::with_capacity(presets.len());
    let mut seen_paths = HashSet::new();
    for preset in presets {
        let name = preset.name.trim();
        let path = preset.path.trim();
        if name.is_empty() || path.is_empty() {
            continue;
        }
        if !seen_paths.insert(path.to_string()) {
            continue;
        }
        normalized.push(WorkDirPreset {
            name: name.to_string(),
            path: path.to_string(),
        });
    }
    normalized
}

fn sync_bridge_default_work_dir_from_app(
    bridge_settings: &mut BridgeSettings,
    previous_app_work_dir: Option<&str>,
    next_app_work_dir: Option<&str>,
) -> bool {
    let previous = normalize_work_dir_value(previous_app_work_dir);
    let next = normalize_work_dir_value(next_app_work_dir);
    let current = bridge_settings.default_work_dir.clone();

    let should_follow_app = current.is_none() || current == previous;
    if !should_follow_app || current == next {
        return false;
    }

    bridge_settings.default_work_dir = next;
    true
}

fn apply_onboarding_input(
    bridge_settings: &mut BridgeSettings,
    bridge_secrets: &mut BridgeSecrets,
    input: &BridgeOnboardingConfigInput,
) -> anyhow::Result<()> {
    *bridge_secrets = normalize_bridge_secrets(bridge_secrets.clone());
    ensure_default_feishu_connector(bridge_settings);
    let feishu_connector_id = bridge_settings
        .connectors
        .iter()
        .find(|connector| connector.platform == BridgePlatform::Feishu)
        .map(|connector| connector.id.clone())
        .unwrap_or_else(|| default_connector_id(BridgePlatform::Feishu, 1));
    let connector_secrets = bridge_secrets
        .connectors
        .entry(feishu_connector_id)
        .or_insert_with(|| BridgeConnectorSecrets {
            feishu: Some(BridgeFeishuSecrets::default()),
            telegram: None,
        });
    let feishu_secrets = connector_secrets
        .feishu
        .get_or_insert_with(BridgeFeishuSecrets::default);

    if let Some(value) = trim_optional_string(input.feishu.app_id.clone()) {
        feishu_secrets.app_id = Some(value);
    }
    if let Some(value) = trim_optional_string(input.feishu.app_secret.clone()) {
        feishu_secrets.app_secret = Some(value);
    }
    if let Some(value) = trim_optional_string(input.feishu.verification_token.clone()) {
        feishu_secrets.verification_token = Some(value);
    }
    if let Some(value) = trim_optional_string(input.feishu.encrypt_key.clone()) {
        feishu_secrets.encrypt_key = Some(value);
    }

    if input.feishu_enabled
        && (feishu_secrets.app_id.is_none() || feishu_secrets.app_secret.is_none())
    {
        anyhow::bail!("feishu appId and appSecret are required before enabling Feishu bridge")
    }

    bridge_settings.enabled = input.enabled || input.feishu_enabled;
    bridge_settings.auto_start = input.auto_start;
    for connector in &mut bridge_settings.connectors {
        if connector.platform == BridgePlatform::Feishu {
            connector.enabled = input.feishu_enabled;
            connector.feishu_auto_approve = Some(bridge_settings.feishu_auto_approve);
            connector.feishu_reply_renderer = Some(bridge_settings.feishu_reply_renderer);
        }
    }

    *bridge_secrets = normalize_bridge_secrets(bridge_secrets.clone());
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
        skills_mode: BridgeSkillsMode::Disabled,
        feishu_reply_renderer: FeishuReplyRenderer::Interactive,
        feishu_auto_approve: true,
        reset_binding_session_on_bridge_start: true,
        feishu_reply_cards: None,
        default_work_dir: normalize_work_dir_value(app_settings.work_dir.as_deref()),
        work_dir_presets: vec![],
        connectors: vec![
            default_connector(BridgePlatform::Telegram, 1),
            default_connector(BridgePlatform::Feishu, 1),
        ],
    }
}

fn normalize_bridge_settings(settings: BridgeSettings) -> BridgeSettings {
    let feishu_reply_renderer = match settings.feishu_reply_cards {
        Some(true) => FeishuReplyRenderer::Interactive,
        Some(false) => FeishuReplyRenderer::Post,
        None => settings.feishu_reply_renderer,
    };
    let connectors = normalize_connectors(
        settings.connectors,
        settings.default_work_dir.clone(),
        settings.reset_binding_session_on_bridge_start,
        settings.feishu_auto_approve,
        feishu_reply_renderer,
    );
    let derived_feishu = connectors
        .iter()
        .find(|connector| connector.platform == BridgePlatform::Feishu);

    BridgeSettings {
        enabled: settings.enabled,
        auto_start: settings.auto_start,
        admin_port: if settings.admin_port == 0 {
            DEFAULT_BRIDGE_ADMIN_PORT
        } else {
            settings.admin_port
        },
        skills_mode: BridgeSkillsMode::Disabled,
        feishu_reply_renderer: derived_feishu
            .and_then(|connector| connector.feishu_reply_renderer)
            .unwrap_or(feishu_reply_renderer),
        feishu_auto_approve: derived_feishu
            .and_then(|connector| connector.feishu_auto_approve)
            .unwrap_or(settings.feishu_auto_approve),
        reset_binding_session_on_bridge_start: settings.reset_binding_session_on_bridge_start,
        feishu_reply_cards: None,
        default_work_dir: normalize_work_dir_value(settings.default_work_dir.as_deref()),
        work_dir_presets: normalize_work_dir_presets(settings.work_dir_presets),
        connectors,
    }
}

fn normalize_connectors(
    connectors: Vec<BridgeConnectorConfig>,
    legacy_default_work_dir: Option<String>,
    legacy_reset_binding_session_on_start: bool,
    default_feishu_auto_approve: bool,
    default_feishu_reply_renderer: FeishuReplyRenderer,
) -> Vec<BridgeConnectorConfig> {
    let mut normalized = Vec::with_capacity(connectors.len());
    let mut seen_ids = HashSet::new();
    let mut platform_counts = HashMap::new();
    for connector in connectors {
        let platform = connector.platform;
        let count = platform_counts.entry(platform).or_insert(0usize);
        *count += 1;
        let fallback = default_connector(platform, *count);
        let mut item = connector;
        item.platform = platform;
        item.id = normalize_connector_id(item.id, platform, *count, &seen_ids);
        seen_ids.insert(item.id.clone());
        if item.label.trim().is_empty() {
            item.label = fallback.label;
        } else {
            item.label = item.label.trim().to_string();
        }
        item.default_work_dir = normalize_work_dir_value(item.default_work_dir.as_deref())
            .or_else(|| legacy_default_work_dir.clone());
        item.reset_binding_session_on_start = Some(
            item.reset_binding_session_on_start
                .unwrap_or(legacy_reset_binding_session_on_start),
        );
        item.mode = match platform {
            BridgePlatform::Telegram => BridgeChannelMode::Polling,
            BridgePlatform::Feishu => BridgeChannelMode::Websocket,
        };
        if platform == BridgePlatform::Feishu {
            item.feishu_auto_approve =
                Some(item.feishu_auto_approve.unwrap_or(default_feishu_auto_approve));
            item.feishu_reply_renderer =
                Some(item.feishu_reply_renderer.unwrap_or(default_feishu_reply_renderer));
        } else {
            item.feishu_auto_approve = None;
            item.feishu_reply_renderer = None;
        }
        normalized.push(item);
    }
    normalized
}

fn normalize_bridge_secrets(mut secrets: BridgeSecrets) -> BridgeSecrets {
    let mut connectors = BTreeMap::new();
    for (connector_id, connector) in secrets.connectors {
        let normalized_id = connector_id.trim().to_string();
        if normalized_id.is_empty() {
            continue;
        }
        let normalized = normalize_connector_secrets(connector);
        if normalized.telegram.is_none() && normalized.feishu.is_none() {
            continue;
        }
        connectors.insert(normalized_id, normalized);
    }

    if let Some(bot_token) = trim_optional_string(secrets.telegram.bot_token.take()) {
        connectors
            .entry(default_connector_id(BridgePlatform::Telegram, 1))
            .or_insert_with(BridgeConnectorSecrets::default)
            .telegram = Some(BridgeTelegramSecrets {
            bot_token: Some(bot_token),
        });
    }

    let app_id = trim_optional_string(secrets.feishu.app_id.take());
    let app_secret = trim_optional_string(secrets.feishu.app_secret.take());
    let verification_token = trim_optional_string(secrets.feishu.verification_token.take());
    let encrypt_key = trim_optional_string(secrets.feishu.encrypt_key.take());
    if app_id.is_some()
        || app_secret.is_some()
        || verification_token.is_some()
        || encrypt_key.is_some()
    {
        connectors
            .entry(default_connector_id(BridgePlatform::Feishu, 1))
            .or_insert_with(BridgeConnectorSecrets::default)
            .feishu = Some(BridgeFeishuSecrets {
            app_id,
            app_secret,
            verification_token,
            encrypt_key,
        });
    }

    let mut normalized = BridgeSecrets {
        connectors,
        telegram: BridgeTelegramSecrets::default(),
        feishu: BridgeFeishuSecrets::default(),
    };

    for connector in normalized.connectors.values() {
        if normalized.telegram.bot_token.is_none() {
            if let Some(telegram) = &connector.telegram {
                normalized.telegram = telegram.clone();
            }
        }
        if normalized.feishu.app_id.is_none() && normalized.feishu.app_secret.is_none() {
            if let Some(feishu) = &connector.feishu {
                normalized.feishu = feishu.clone();
            }
        }
    }

    normalized
}

fn normalize_connector_secrets(mut secrets: BridgeConnectorSecrets) -> BridgeConnectorSecrets {
    secrets.telegram = secrets.telegram.and_then(|telegram| {
        trim_optional_string(telegram.bot_token).map(|bot_token| BridgeTelegramSecrets {
            bot_token: Some(bot_token),
        })
    });
    secrets.feishu = secrets.feishu.and_then(|feishu| {
        let normalized = BridgeFeishuSecrets {
            app_id: trim_optional_string(feishu.app_id),
            app_secret: trim_optional_string(feishu.app_secret),
            verification_token: trim_optional_string(feishu.verification_token),
            encrypt_key: trim_optional_string(feishu.encrypt_key),
        };
        if normalized.app_id.is_none()
            && normalized.app_secret.is_none()
            && normalized.verification_token.is_none()
            && normalized.encrypt_key.is_none()
        {
            None
        } else {
            Some(normalized)
        }
    });
    secrets
}

fn normalize_connector_id(
    id: String,
    platform: BridgePlatform,
    index: usize,
    seen_ids: &HashSet<String>,
) -> String {
    let trimmed = id.trim();
    if !trimmed.is_empty() && !seen_ids.contains(trimmed) {
        return trimmed.to_string();
    }
    let mut candidate = default_connector_id(platform, index);
    let mut suffix = index.max(1);
    while seen_ids.contains(&candidate) {
        suffix += 1;
        candidate = default_connector_id(platform, suffix);
    }
    candidate
}

fn default_connector_id(platform: BridgePlatform, index: usize) -> String {
    let base = match platform {
        BridgePlatform::Telegram => "telegram",
        BridgePlatform::Feishu => "feishu",
    };
    if index <= 1 {
        format!("{base}-default")
    } else {
        format!("{base}-{index}")
    }
}

fn default_connector_label(platform: BridgePlatform, index: usize) -> String {
    let suffix = format!("{index:02}");
    match platform {
        BridgePlatform::Telegram => format!("Telegram 机器人 {suffix}"),
        BridgePlatform::Feishu => format!("飞书机器人 {suffix}"),
    }
}

fn default_connector(platform: BridgePlatform, index: usize) -> BridgeConnectorConfig {
    BridgeConnectorConfig {
        id: default_connector_id(platform, index),
        platform,
        enabled: false,
        mode: match platform {
            BridgePlatform::Telegram => BridgeChannelMode::Polling,
            BridgePlatform::Feishu => BridgeChannelMode::Websocket,
        },
        label: default_connector_label(platform, index),
        default_work_dir: None,
        reset_binding_session_on_start: None,
        feishu_auto_approve: (platform == BridgePlatform::Feishu).then_some(true),
        feishu_reply_renderer: (platform == BridgePlatform::Feishu)
            .then_some(FeishuReplyRenderer::Interactive),
    }
}

fn ensure_default_feishu_connector(bridge_settings: &mut BridgeSettings) {
    if bridge_settings
        .connectors
        .iter()
        .any(|connector| connector.platform == BridgePlatform::Feishu)
    {
        return;
    }
    bridge_settings
        .connectors
        .push(default_connector(BridgePlatform::Feishu, 1));
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
        assert_eq!(
            bridge_settings.feishu_reply_renderer,
            FeishuReplyRenderer::Interactive
        );
        assert!(bridge_settings.feishu_auto_approve);
        assert!(bridge_settings.reset_binding_session_on_bridge_start);
        assert!(bridge_settings.feishu_reply_cards.is_none());
        assert!(bridge_settings.default_work_dir.is_none());
        assert!(bridge_settings.work_dir_presets.is_empty());
        assert_eq!(bridge_settings.connectors.len(), 2);
        assert!(!app_settings.bridge_enabled);
        assert!(!app_settings.bridge_auto_start);
        assert!(bridge_settings_path.exists());
        assert!(settings_path.exists());
    }

    #[test]
    fn load_or_default_backfills_bridge_default_work_dir_from_app_settings() {
        let temp = TempDirGuard::new("inherit-app-workdir");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");

        write_json(
            &settings_path,
            &AppSettings {
                work_dir: Some(" D:/workspace ".to_string()),
                ..AppSettings::default()
            },
        )
        .expect("seed app settings");
        write_json(
            &bridge_settings_path,
            &BridgeSettings {
                enabled: false,
                auto_start: false,
                admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
                skills_mode: BridgeSkillsMode::Disabled,
                feishu_reply_renderer: FeishuReplyRenderer::Interactive,
                feishu_auto_approve: true,
                reset_binding_session_on_bridge_start: true,
                feishu_reply_cards: None,
                default_work_dir: None,
                work_dir_presets: vec![],
                connectors: vec![],
            },
        )
        .expect("seed bridge settings");

        let (_, bridge_settings) =
            load_or_default_files(&settings_path, &bridge_settings_path).expect("bridge settings");

        assert_eq!(
            bridge_settings.default_work_dir.as_deref(),
            Some("D:/workspace")
        );
    }

    #[test]
    fn load_or_default_backfills_missing_feishu_auto_approve_to_true() {
        let temp = TempDirGuard::new("inherit-feishu-auto-approve");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");

        fs::write(
            &bridge_settings_path,
            r#"{
  "enabled": false,
  "autoStart": false,
  "adminPort": 60110,
  "feishuReplyRenderer": "interactive",
  "channels": []
}"#,
        )
        .expect("seed bridge settings json");

        let (_, bridge_settings) =
            load_or_default_files(&settings_path, &bridge_settings_path).expect("bridge settings");

        assert!(bridge_settings.feishu_auto_approve);
        assert!(bridge_settings.reset_binding_session_on_bridge_start);
    }

    #[test]
    fn load_or_default_ignores_legacy_skills_dir_field() {
        let temp = TempDirGuard::new("legacy-skills-dir");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");

        fs::write(
            &bridge_settings_path,
            r#"{
  "enabled": false,
  "autoStart": false,
  "adminPort": 60110,
  "skillsDir": "D:/legacy",
  "feishuReplyRenderer": "interactive",
  "channels": []
}"#,
        )
        .expect("seed bridge settings json");

        let (_, bridge_settings) =
            load_or_default_files(&settings_path, &bridge_settings_path).expect("bridge settings");

        assert_eq!(bridge_settings.skills_mode, BridgeSkillsMode::Disabled);
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
            skills_mode: BridgeSkillsMode::FollowDefaultWorkDir,
            feishu_reply_renderer: FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: Some(" D:/repo ".to_string()),
            work_dir_presets: vec![WorkDirPreset {
                name: " Repo ".to_string(),
                path: " D:/repo ".to_string(),
            }],
            connectors: vec![default_connector(BridgePlatform::Telegram, 1)],
        };

        let (app_settings, bridge_settings) =
            save_files(&settings_path, &bridge_settings_path, &input).expect("save bridge files");

        assert!(bridge_settings.enabled);
        assert!(bridge_settings.auto_start);
        assert_eq!(bridge_settings.admin_port, 60_112);
        assert_eq!(bridge_settings.skills_mode, BridgeSkillsMode::Disabled);
        assert_eq!(
            bridge_settings.feishu_reply_renderer,
            FeishuReplyRenderer::Interactive
        );
        assert!(bridge_settings.feishu_auto_approve);
        assert!(bridge_settings.reset_binding_session_on_bridge_start);
        assert_eq!(bridge_settings.default_work_dir.as_deref(), Some("D:/repo"));
        assert_eq!(
            bridge_settings.work_dir_presets,
            vec![WorkDirPreset {
                name: "Repo".to_string(),
                path: "D:/repo".to_string(),
            }]
        );
        assert_eq!(bridge_settings.connectors.len(), 1);
        assert!(app_settings.bridge_enabled);
        assert!(app_settings.bridge_auto_start);
        assert_eq!(app_settings.bridge_admin_port_override, Some(60_112));
        let saved_json =
            fs::read_to_string(&bridge_settings_path).expect("read normalized bridge settings");
        assert!(!saved_json.contains("\"skills_mode\""));
    }

    #[test]
    fn save_files_treats_blank_bridge_default_work_dir_as_follow_app_setting() {
        let temp = TempDirGuard::new("save-follow-app-workdir");
        let settings_path = temp.path.join("settings.json");
        let bridge_settings_path = temp.path.join("bridge_settings.json");

        write_json(
            &settings_path,
            &AppSettings {
                work_dir: Some("D:/workspace".to_string()),
                ..AppSettings::default()
            },
        )
        .expect("seed app settings");

        let (app_settings, bridge_settings) = save_files(
            &settings_path,
            &bridge_settings_path,
            &BridgeSettings {
                enabled: false,
                auto_start: false,
                admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
                skills_mode: BridgeSkillsMode::Disabled,
                feishu_reply_renderer: FeishuReplyRenderer::Interactive,
                feishu_auto_approve: true,
                reset_binding_session_on_bridge_start: true,
                feishu_reply_cards: None,
                default_work_dir: None,
                work_dir_presets: vec![],
                connectors: vec![],
            },
        )
        .expect("save bridge files");

        assert_eq!(app_settings.work_dir.as_deref(), Some("D:/workspace"));
        assert_eq!(
            bridge_settings.default_work_dir.as_deref(),
            Some("D:/workspace")
        );
    }

    #[test]
    fn sync_bridge_default_work_dir_from_app_updates_only_when_bridge_was_following() {
        let mut inherited = BridgeSettings {
            enabled: false,
            auto_start: false,
            admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
            skills_mode: BridgeSkillsMode::Disabled,
            feishu_reply_renderer: FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: Some("D:/old".to_string()),
            work_dir_presets: vec![],
            connectors: vec![],
        };

        assert!(sync_bridge_default_work_dir_from_app(
            &mut inherited,
            Some("D:/old"),
            Some("D:/new")
        ));
        assert_eq!(inherited.default_work_dir.as_deref(), Some("D:/new"));

        let mut explicit_override = BridgeSettings {
            enabled: false,
            auto_start: false,
            admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
            skills_mode: BridgeSkillsMode::Disabled,
            feishu_reply_renderer: FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: Some("D:/bridge-only".to_string()),
            work_dir_presets: vec![],
            connectors: vec![],
        };

        assert!(!sync_bridge_default_work_dir_from_app(
            &mut explicit_override,
            Some("D:/old"),
            Some("D:/new")
        ));
        assert_eq!(
            explicit_override.default_work_dir.as_deref(),
            Some("D:/bridge-only")
        );
    }

    #[test]
    fn preview_default_work_dir_after_app_sync_matches_following_behavior() {
        let inherited = BridgeSettings {
            enabled: false,
            auto_start: false,
            admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
            skills_mode: BridgeSkillsMode::Disabled,
            feishu_reply_renderer: FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: Some("D:/old".to_string()),
            work_dir_presets: vec![],
            connectors: vec![],
        };
        assert_eq!(
            preview_default_work_dir_after_app_sync(&inherited, Some("D:/old"), Some("D:/new"))
                .as_deref(),
            Some("D:/new")
        );

        let explicit = BridgeSettings {
            default_work_dir: Some("D:/bridge-only".to_string()),
            ..inherited
        };
        assert_eq!(
            preview_default_work_dir_after_app_sync(&explicit, Some("D:/old"), Some("D:/new"))
                .as_deref(),
            Some("D:/bridge-only")
        );
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
    fn normalize_bridge_settings_filters_and_dedupes_work_dir_presets() {
        let normalized = normalize_bridge_settings(BridgeSettings {
            enabled: false,
            auto_start: false,
            admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
            skills_mode: BridgeSkillsMode::Disabled,
            feishu_reply_renderer: FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: None,
            work_dir_presets: vec![
                WorkDirPreset {
                    name: " Repo ".to_string(),
                    path: " D:/repo ".to_string(),
                },
                WorkDirPreset {
                    name: "".to_string(),
                    path: "D:/skip".to_string(),
                },
                WorkDirPreset {
                    name: "Duplicate".to_string(),
                    path: "D:/repo".to_string(),
                },
                WorkDirPreset {
                    name: "Docs".to_string(),
                    path: "D:/docs".to_string(),
                },
            ],
            connectors: vec![],
        });

        assert_eq!(
            normalized.work_dir_presets,
            vec![
                WorkDirPreset {
                    name: "Repo".to_string(),
                    path: "D:/repo".to_string(),
                },
                WorkDirPreset {
                    name: "Docs".to_string(),
                    path: "D:/docs".to_string(),
                },
            ]
        );
    }

    #[test]
    fn normalize_bridge_settings_maps_legacy_feishu_reply_cards_false_to_post() {
        let normalized = normalize_bridge_settings(BridgeSettings {
            enabled: false,
            auto_start: false,
            admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
            skills_mode: BridgeSkillsMode::Disabled,
            feishu_reply_renderer: FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: Some(false),
            default_work_dir: None,
            work_dir_presets: vec![],
            connectors: vec![],
        });

        assert_eq!(normalized.feishu_reply_renderer, FeishuReplyRenderer::Post);
        assert!(normalized.feishu_reply_cards.is_none());
    }

    #[test]
    fn normalize_bridge_settings_disables_legacy_skills_mode() {
        let normalized = normalize_bridge_settings(BridgeSettings {
            enabled: false,
            auto_start: false,
            admin_port: DEFAULT_BRIDGE_ADMIN_PORT,
            skills_mode: BridgeSkillsMode::FollowDefaultWorkDir,
            feishu_reply_renderer: FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: None,
            work_dir_presets: vec![],
            connectors: vec![],
        });

        assert_eq!(normalized.skills_mode, BridgeSkillsMode::Disabled);
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
            auto_start: true,
            feishu: crate::types::BridgeOnboardingFeishuInput {
                app_id: Some(" cli-app-id ".to_string()),
                app_secret: Some(" cli-app-secret ".to_string()),
                verification_token: Some("verify-token".to_string()),
                encrypt_key: Some("encrypt-key".to_string()),
            },
        };

        let (app_settings, bridge_settings, bridge_secrets) = save_onboarding_files(
            &settings_path,
            &bridge_settings_path,
            &bridge_secrets_path,
            &input,
        )
        .expect("save onboarding config");

        assert!(bridge_settings.enabled);
        assert!(bridge_settings.auto_start);
        assert!(app_settings.bridge_auto_start);
        assert_eq!(bridge_settings.connectors.len(), 2);
        assert!(
            bridge_settings
                .connectors
                .iter()
                .find(|connector| connector.platform == BridgePlatform::Feishu)
                .expect("feishu connector")
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

        let (reloaded_app_settings, reloaded_bridge_settings) =
            load_or_default_files(&settings_path, &bridge_settings_path)
                .expect("reload onboarding config");
        assert!(reloaded_app_settings.bridge_auto_start);
        assert!(reloaded_bridge_settings.auto_start);
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
                connectors: Default::default(),
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
            auto_start: false,
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
                .connectors
                .iter()
                .find(|connector| connector.platform == BridgePlatform::Feishu)
                .expect("feishu connector")
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
            auto_start: false,
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
