use tauri::{AppHandle, Manager};

use crate::{
    app_state::{unix_time_millis, AppState},
    backend_manager, log_manager, settings_store,
    types::{
        AuthMode, KimiCliConfigCenterView, KimiLoginHealth, KimiLoginHealthSource,
        KimiLoginHealthState, LoginProbeState, ProviderApiHealth, ProviderApiHealthSource,
        ProviderApiHealthState, ProviderEntry,
    },
};

#[derive(Debug, Clone, Default)]
pub struct AuthModeSnapshot {
    pub auth_mode: AuthMode,
    pub provider_api_configured: bool,
    pub provider_api_active_provider: Option<String>,
}

pub fn resolve_auth_mode_snapshot(
    app: &AppHandle,
    login_verified_fallback: bool,
) -> Result<AuthModeSnapshot, String> {
    let view = backend_manager::load_kimi_cli_config_center().unwrap_or_default();
    let login_health = read_runtime_login_health(app, login_verified_fallback)?;
    Ok(evaluate_auth_mode(&view, login_health.state))
}

pub fn evaluate_auth_mode(
    view: &KimiCliConfigCenterView,
    kimi_login_state: KimiLoginHealthState,
) -> AuthModeSnapshot {
    let active_provider = normalize_optional_string(&view.default_provider).or_else(|| {
        view.providers
            .iter()
            .find_map(|entry| normalize_optional_string(&Some(entry.key.clone())))
    });

    let Some(provider_key) = active_provider else {
        return AuthModeSnapshot {
            auth_mode: AuthMode::KimiLogin,
            provider_api_configured: false,
            provider_api_active_provider: None,
        };
    };

    let Some(provider) = view
        .providers
        .iter()
        .find(|entry| entry.key.trim() == provider_key)
    else {
        return AuthModeSnapshot {
            auth_mode: AuthMode::Unknown,
            provider_api_configured: false,
            provider_api_active_provider: Some(provider_key),
        };
    };

    let provider_api_configured = provider_has_credential(provider);

    AuthModeSnapshot {
        auth_mode: if kimi_login_state == KimiLoginHealthState::Verified {
            AuthMode::KimiLogin
        } else if provider_api_configured {
            AuthMode::ProviderApi
        } else {
            AuthMode::Unknown
        },
        provider_api_configured,
        provider_api_active_provider: Some(provider_key),
    }
}

pub fn login_probe_state_from_health(state: KimiLoginHealthState) -> LoginProbeState {
    match state {
        KimiLoginHealthState::Verified => LoginProbeState::LoggedIn,
        KimiLoginHealthState::AuthRequired => LoginProbeState::LoginRequired,
        KimiLoginHealthState::Unknown | KimiLoginHealthState::Error => LoginProbeState::Unknown,
    }
}

pub fn fallback_login_health(login_verified: bool) -> KimiLoginHealth {
    if login_verified {
        return KimiLoginHealth {
            state: KimiLoginHealthState::Verified,
            source: KimiLoginHealthSource::BackendStartup,
            message: "沿用此前已验证的 Kimi 登录状态。".to_string(),
            exit_code: None,
            checked_at_ms: None,
            needs_attention: false,
        };
    }

    KimiLoginHealth {
        state: KimiLoginHealthState::Unknown,
        source: KimiLoginHealthSource::BackendStartup,
        message: String::new(),
        exit_code: None,
        checked_at_ms: None,
        needs_attention: false,
    }
}

pub fn sync_runtime_auth_snapshot(
    app: &AppHandle,
    snapshot: &AuthModeSnapshot,
) -> Result<(), String> {
    let shared = app.state::<AppState>();
    let mut runtime = shared
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;
    runtime.auth_mode = snapshot.auth_mode;
    runtime.provider_api_configured = snapshot.provider_api_configured;
    runtime.provider_api_active_provider = snapshot.provider_api_active_provider.clone();
    Ok(())
}

pub fn read_runtime_login_health(
    app: &AppHandle,
    login_verified_fallback: bool,
) -> Result<KimiLoginHealth, String> {
    let shared = app.state::<AppState>();
    let runtime = shared
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;
    Ok(runtime
        .kimi_login_health
        .clone()
        .unwrap_or_else(|| fallback_login_health(login_verified_fallback)))
}

pub fn read_runtime_provider_api_health(app: &AppHandle) -> Result<ProviderApiHealth, String> {
    let shared = app.state::<AppState>();
    let runtime = shared
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;
    Ok(runtime.provider_api_health.clone().unwrap_or_default())
}

pub fn update_kimi_login_health(
    app: &AppHandle,
    next_state: KimiLoginHealthState,
    source: KimiLoginHealthSource,
    message: impl Into<String>,
    exit_code: Option<i32>,
) -> Result<KimiLoginHealth, String> {
    let message = message.into().trim().to_string();
    let checked_at_ms = Some(unix_time_millis());
    let view = backend_manager::load_kimi_cli_config_center().unwrap_or_default();
    let next_snapshot = evaluate_auth_mode(&view, next_state);
    let next = KimiLoginHealth {
        state: next_state,
        source,
        message: message.clone(),
        exit_code,
        checked_at_ms,
        needs_attention: matches!(
            next_state,
            KimiLoginHealthState::AuthRequired | KimiLoginHealthState::Error
        ),
    };

    let (previous, previous_auth_mode) = {
        let shared = app.state::<AppState>();
        let mut runtime = shared
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        let previous = runtime.kimi_login_health.clone();
        let previous_auth_mode = runtime.auth_mode;
        runtime.auth_mode = next_snapshot.auth_mode;
        runtime.provider_api_configured = next_snapshot.provider_api_configured;
        runtime.provider_api_active_provider = next_snapshot.provider_api_active_provider.clone();
        runtime.kimi_login_health = Some(next.clone());
        runtime.login_probe_state = Some(login_probe_state_from_health(next.state));
        runtime.login_probe_message = if next.message.is_empty() {
            None
        } else {
            Some(next.message.clone())
        };
        (previous, previous_auth_mode)
    };

    sync_legacy_login_verified(app, next.state == KimiLoginHealthState::Verified)?;

    let state_changed = previous.as_ref().map(|item| item.state) != Some(next.state);
    let auth_mode_changed = previous_auth_mode != next_snapshot.auth_mode;
    if state_changed || auth_mode_changed {
        let checked_at_label = checked_at_ms
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string());
        let exit_code_label = exit_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string());
        log_manager::append_line(
            app,
            format!(
                "kimi_login_health_changed auth_mode={auth_mode:?} state={state:?} source={source:?} exit_code={exit_code_label} checked_at={checked_at_label} message={message}",
                auth_mode = next_snapshot.auth_mode,
                state = next.state
            ),
        );
    }

    Ok(next)
}

pub fn update_provider_api_health(
    app: &AppHandle,
    next_state: ProviderApiHealthState,
    source: ProviderApiHealthSource,
    message: impl Into<String>,
    exit_code: Option<i32>,
) -> Result<ProviderApiHealth, String> {
    let message = message.into().trim().to_string();
    let checked_at_ms = Some(unix_time_millis());
    let next = ProviderApiHealth {
        state: next_state,
        source,
        message: message.clone(),
        exit_code,
        checked_at_ms,
        needs_attention: matches!(
            next_state,
            ProviderApiHealthState::AuthRequired | ProviderApiHealthState::Error
        ),
    };

    let previous = {
        let shared = app.state::<AppState>();
        let mut runtime = shared
            .runtime
            .lock()
            .map_err(|_| "runtime state mutex is poisoned".to_string())?;
        let previous = runtime.provider_api_health.clone();
        runtime.provider_api_health = Some(next.clone());
        previous
    };

    let state_changed = previous.as_ref().map(|item| item.state) != Some(next.state);
    if state_changed {
        let checked_at_label = checked_at_ms
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string());
        let exit_code_label = exit_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "-".to_string());
        log_manager::append_line(
            app,
            format!(
                "provider_api_health_changed state={state:?} source={source:?} exit_code={exit_code_label} checked_at={checked_at_label} message={message}",
                state = next.state
            ),
        );
    }

    Ok(next)
}

pub fn reset_provider_api_health(app: &AppHandle) -> Result<(), String> {
    let shared = app.state::<AppState>();
    let mut runtime = shared
        .runtime
        .lock()
        .map_err(|_| "runtime state mutex is poisoned".to_string())?;
    runtime.provider_api_health = None;
    Ok(())
}

fn sync_legacy_login_verified(app: &AppHandle, next_verified: bool) -> Result<(), String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    if settings.onboarding_step_acks.login_verified == next_verified {
        return Ok(());
    }
    settings.onboarding_step_acks.login_verified = next_verified;
    settings_store::save(app, &settings).map_err(|error| error.to_string())
}

fn provider_has_credential(entry: &ProviderEntry) -> bool {
    normalize_optional_string(&entry.api_key).is_some()
        || normalize_optional_string(&entry.auth_token).is_some()
}

fn normalize_optional_string(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::ProviderEntry;

    #[test]
    fn auth_mode_prefers_verified_kimi_login_over_provider_api() {
        let snapshot = evaluate_auth_mode(
            &KimiCliConfigCenterView {
                default_provider: Some("moonshot".to_string()),
                providers: vec![ProviderEntry {
                    key: "moonshot".to_string(),
                    api_key: Some("secret".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            },
            KimiLoginHealthState::Verified,
        );

        assert_eq!(snapshot.auth_mode, AuthMode::KimiLogin);
        assert!(snapshot.provider_api_configured);
        assert_eq!(
            snapshot.provider_api_active_provider.as_deref(),
            Some("moonshot")
        );
    }

    #[test]
    fn auth_mode_falls_back_to_kimi_login_when_no_provider_exists() {
        let snapshot = evaluate_auth_mode(
            &KimiCliConfigCenterView::default(),
            KimiLoginHealthState::Unknown,
        );
        assert_eq!(snapshot.auth_mode, AuthMode::KimiLogin);
        assert!(!snapshot.provider_api_configured);
        assert!(snapshot.provider_api_active_provider.is_none());
    }

    #[test]
    fn auth_mode_falls_back_to_provider_api_when_login_is_not_verified() {
        let snapshot = evaluate_auth_mode(
            &KimiCliConfigCenterView {
                default_provider: Some("moonshot".to_string()),
                providers: vec![ProviderEntry {
                    key: "moonshot".to_string(),
                    api_key: Some("secret".to_string()),
                    ..Default::default()
                }],
                ..Default::default()
            },
            KimiLoginHealthState::AuthRequired,
        );

        assert_eq!(snapshot.auth_mode, AuthMode::ProviderApi);
        assert!(snapshot.provider_api_configured);
        assert_eq!(
            snapshot.provider_api_active_provider.as_deref(),
            Some("moonshot")
        );
    }

    #[test]
    fn auth_mode_becomes_unknown_when_provider_is_present_without_credentials() {
        let snapshot = evaluate_auth_mode(
            &KimiCliConfigCenterView {
                providers: vec![ProviderEntry {
                    key: "moonshot".to_string(),
                    ..Default::default()
                }],
                ..Default::default()
            },
            KimiLoginHealthState::Unknown,
        );

        assert_eq!(snapshot.auth_mode, AuthMode::Unknown);
        assert!(!snapshot.provider_api_configured);
        assert_eq!(
            snapshot.provider_api_active_provider.as_deref(),
            Some("moonshot")
        );
    }
}
