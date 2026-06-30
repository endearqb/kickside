use tauri::{AppHandle, Manager};

use crate::{
    app_state::{unix_time_millis, AppState},
    backend_manager, log_manager, settings_store,
    types::{
        AuthMode, KimiCodeAccessConfigView, KimiCodeAuthState, KimiLoginHealth,
        KimiLoginHealthSource, KimiLoginHealthState, ProviderApiHealth, ProviderApiHealthSource,
        ProviderApiHealthState,
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
    let login_health = read_runtime_login_health(app, login_verified_fallback)?;
    Ok(evaluate_auth_mode_from_config(app, login_health.state)?)
}

pub fn evaluate_auth_mode(
    view: &KimiCodeAccessConfigView,
    kimi_login_state: KimiLoginHealthState,
) -> AuthModeSnapshot {
    let Some(provider_key) = normalize_string(&view.provider.id) else {
        return AuthModeSnapshot {
            auth_mode: AuthMode::KimiLogin,
            provider_api_configured: false,
            provider_api_active_provider: None,
        };
    };

    let provider_api_configured = view.provider.api_key_configured;

    AuthModeSnapshot {
        auth_mode: if provider_api_configured {
            AuthMode::ProviderApi
        } else if kimi_login_state == KimiLoginHealthState::Verified {
            AuthMode::KimiLogin
        } else {
            AuthMode::Unknown
        },
        provider_api_configured,
        provider_api_active_provider: Some(provider_key),
    }
}

pub fn kimi_code_auth_state_from_health(state: KimiLoginHealthState) -> KimiCodeAuthState {
    match state {
        KimiLoginHealthState::Verified => KimiCodeAuthState::LoggedIn,
        KimiLoginHealthState::AuthRequired => KimiCodeAuthState::LoginRequired,
        KimiLoginHealthState::Unknown | KimiLoginHealthState::Error => KimiCodeAuthState::Unknown,
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
    let next_snapshot = evaluate_auth_mode_from_config(app, next_state)?;
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
        runtime.kimi_code_auth_state = Some(kimi_code_auth_state_from_health(next.state));
        runtime.kimi_code_auth_message = if next.message.is_empty() {
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

fn evaluate_auth_mode_from_config(
    app: &AppHandle,
    kimi_login_state: KimiLoginHealthState,
) -> Result<AuthModeSnapshot, String> {
    let view = backend_manager::load_kimi_code_access_config(app)?;
    if let Some(error) = view
        .config_error
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let message = format!("Kimi Code Access 配置读取失败：{error}");
        let _ = update_provider_api_health(
            app,
            ProviderApiHealthState::Error,
            ProviderApiHealthSource::BackendStartup,
            message,
            None,
        );
        return Ok(AuthModeSnapshot {
            auth_mode: AuthMode::Unknown,
            provider_api_configured: false,
            provider_api_active_provider: None,
        });
    }
    Ok(evaluate_auth_mode(&view, kimi_login_state))
}

fn normalize_string(value: &str) -> Option<String> {
    Some(value)
        .map(str::trim)
        .map(ToString::to_string)
        .filter(|item| !item.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn access_view(provider_id: &str, api_key_configured: bool) -> KimiCodeAccessConfigView {
        let mut view = KimiCodeAccessConfigView::default();
        view.provider.id = provider_id.to_string();
        view.provider.api_key_configured = api_key_configured;
        view
    }

    #[test]
    fn auth_mode_prefers_configured_kimi_code_access() {
        let snapshot = evaluate_auth_mode(
            &access_view(backend_manager::KIMI_CODING_PLAN_PROVIDER_ID, true),
            KimiLoginHealthState::Verified,
        );

        assert_eq!(snapshot.auth_mode, AuthMode::ProviderApi);
        assert!(snapshot.provider_api_configured);
        assert_eq!(
            snapshot.provider_api_active_provider.as_deref(),
            Some(backend_manager::KIMI_CODING_PLAN_PROVIDER_ID)
        );
    }

    #[test]
    fn auth_mode_falls_back_to_kimi_login_when_no_provider_exists() {
        let snapshot = evaluate_auth_mode(
            &KimiCodeAccessConfigView::default(),
            KimiLoginHealthState::Unknown,
        );
        assert_eq!(snapshot.auth_mode, AuthMode::KimiLogin);
        assert!(!snapshot.provider_api_configured);
        assert!(snapshot.provider_api_active_provider.is_none());
    }

    #[test]
    fn auth_mode_falls_back_to_provider_api_when_login_is_not_verified() {
        let snapshot = evaluate_auth_mode(
            &access_view(backend_manager::KIMI_CODING_PLAN_PROVIDER_ID, true),
            KimiLoginHealthState::AuthRequired,
        );

        assert_eq!(snapshot.auth_mode, AuthMode::ProviderApi);
        assert!(snapshot.provider_api_configured);
        assert_eq!(
            snapshot.provider_api_active_provider.as_deref(),
            Some(backend_manager::KIMI_CODING_PLAN_PROVIDER_ID)
        );
    }

    #[test]
    fn auth_mode_becomes_unknown_when_provider_is_present_without_credentials() {
        let snapshot = evaluate_auth_mode(
            &access_view(backend_manager::KIMI_CODING_PLAN_PROVIDER_ID, false),
            KimiLoginHealthState::Unknown,
        );

        assert_eq!(snapshot.auth_mode, AuthMode::Unknown);
        assert!(!snapshot.provider_api_configured);
        assert_eq!(
            snapshot.provider_api_active_provider.as_deref(),
            Some(backend_manager::KIMI_CODING_PLAN_PROVIDER_ID)
        );
    }
}
