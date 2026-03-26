use std::sync::Arc;

use anyhow::Context;
use chrono::Utc;
use qrcode::{render::svg, QrCode};
use reqwest::blocking::Client;
use serde::Deserialize;
use tauri::{AppHandle, Manager};
use url::Url;

use crate::{
    app_state::{unix_time_millis, AppState, FeishuOnboardingRuntimeState},
    bridge_manager, bridge_settings_store,
    types::{
        BridgeConnectorConfig, BridgeConnectorSecretsInput, BridgeFeishuSecrets, BridgePlatform,
        BridgeTelegramSecrets, BridgeWeixinSecrets, FeishuConnectorOnboardingSession,
        FeishuConnectorOnboardingState, StartFeishuConnectorOnboardingInput,
    },
};

const FEISHU_ACCOUNTS_BASE: &str = "https://accounts.feishu.cn";
const LARK_ACCOUNTS_BASE: &str = "https://accounts.larksuite.com";
const DEFAULT_POLL_INTERVAL_SECS: u64 = 5;
const DEFAULT_EXPIRE_IN_SECS: u64 = 600;

pub fn start(
    app: &AppHandle,
    input: &StartFeishuConnectorOnboardingInput,
) -> anyhow::Result<FeishuConnectorOnboardingSession> {
    let connector = get_feishu_connector(app, input.connector_id.trim())?;
    let now_ms = unix_time_millis();

    {
        let state = app.state::<AppState>();
        let mut onboarding = state
            .feishu_onboarding
            .lock()
            .map_err(|_| anyhow::anyhow!("feishu onboarding mutex is poisoned"))?;
        if let Some(existing) = onboarding.as_mut() {
            expire_if_needed(existing, now_ms);
            if should_reuse_existing_session(existing, connector.id.as_str(), now_ms) {
                return Ok(snapshot_session(existing));
            }
        }
    }

    let client = FeishuRegistrationClient::new(FEISHU_ACCOUNTS_BASE)?;
    let init = client.init()?;
    if !init
        .supported_auth_methods
        .iter()
        .any(|value| value.eq_ignore_ascii_case("client_secret"))
    {
        anyhow::bail!("飞书当前环境未返回 client_secret 开通能力，无法继续创建机器人");
    }

    let begin = client.begin()?;
    let verification_url = append_onboard_source(&begin.verification_uri_complete)?;
    let qr_svg = render_qr_svg(&verification_url)?;
    let started_at = now_rfc3339();
    let expires_at_ms =
        now_ms.saturating_add(begin.expire_in.unwrap_or(DEFAULT_EXPIRE_IN_SECS) * 1000);
    let runtime = FeishuOnboardingRuntimeState {
        session_id: format!("feishu-onboard-{}", now_ms),
        connector_id: connector.id.clone(),
        state: FeishuConnectorOnboardingState::AwaitingScan,
        started_at,
        expires_at: Some(rfc3339_from_unix_ms(expires_at_ms)),
        expires_at_ms: Some(expires_at_ms),
        completed_at: None,
        verification_url: Some(verification_url),
        qr_svg: Some(qr_svg),
        scanner_open_id: None,
        detail_message: Some(format!(
            "请用飞书扫码完成 {} 的机器人创建。",
            connector.label
        )),
        error_message: None,
        app_id_masked: None,
        last_configured_at: None,
        device_code: begin.device_code,
        poll_base_url: FEISHU_ACCOUNTS_BASE.to_string(),
        poll_interval_secs: begin.interval.unwrap_or(DEFAULT_POLL_INTERVAL_SECS).max(1),
    };

    let snapshot = snapshot_session(&runtime);
    let state = app.state::<AppState>();
    let mut onboarding = state
        .feishu_onboarding
        .lock()
        .map_err(|_| anyhow::anyhow!("feishu onboarding mutex is poisoned"))?;
    *onboarding = Some(runtime);
    Ok(snapshot)
}

pub fn get_status(
    app: &AppHandle,
    session_id: &str,
) -> anyhow::Result<FeishuConnectorOnboardingSession> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        anyhow::bail!("session id is required");
    }

    let existing = {
        let state = app.state::<AppState>();
        let mut onboarding = state
            .feishu_onboarding
            .lock()
            .map_err(|_| anyhow::anyhow!("feishu onboarding mutex is poisoned"))?;
        let current = onboarding
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("当前没有进行中的飞书开通会话"))?;
        if current.session_id != session_id {
            anyhow::bail!("飞书开通会话不存在或已被替换");
        }
        expire_if_needed(current, unix_time_millis());
        if is_terminal_state(current.state) {
            return Ok(snapshot_session(current));
        }
        current.clone()
    };

    let mut client = FeishuRegistrationClient::new(existing.poll_base_url.as_str())?;
    let mut poll = client.poll(existing.device_code.as_str())?;
    if matches!(
        poll.user_info
            .as_ref()
            .and_then(|info| info.tenant_brand.as_deref()),
        Some("lark")
    ) && existing.poll_base_url != LARK_ACCOUNTS_BASE
    {
        client = FeishuRegistrationClient::new(LARK_ACCOUNTS_BASE)?;
        poll = client.poll(existing.device_code.as_str())?;
        update_poll_base_url(app, session_id, LARK_ACCOUNTS_BASE)?;
    }

    if let (Some(client_id), Some(client_secret)) =
        (poll.client_id.clone(), poll.client_secret.clone())
    {
        let configured_at = now_rfc3339();
        let restart_message = persist_success(
            app,
            existing.connector_id.as_str(),
            client_id.as_str(),
            client_secret.as_str(),
        )?;
        let state = app.state::<AppState>();
        let mut onboarding = state
            .feishu_onboarding
            .lock()
            .map_err(|_| anyhow::anyhow!("feishu onboarding mutex is poisoned"))?;
        let current = onboarding
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("飞书开通会话已被清理"))?;
        if current.session_id != session_id {
            anyhow::bail!("飞书开通会话已变化，请刷新后重试");
        }
        current.state = FeishuConnectorOnboardingState::Succeeded;
        current.completed_at = Some(configured_at.clone());
        current.scanner_open_id = poll.user_info.and_then(|info| info.open_id);
        current.detail_message = Some(restart_message);
        current.error_message = None;
        current.app_id_masked = Some(mask_secret(client_id.as_str()));
        current.last_configured_at = Some(configured_at);
        return Ok(snapshot_session(current));
    }

    let state = app.state::<AppState>();
    let mut onboarding = state
        .feishu_onboarding
        .lock()
        .map_err(|_| anyhow::anyhow!("feishu onboarding mutex is poisoned"))?;
    let current = onboarding
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("飞书开通会话已被清理"))?;
    if current.session_id != session_id {
        anyhow::bail!("飞书开通会话已变化，请刷新后重试");
    }
    apply_non_success_poll(current, &poll);
    Ok(snapshot_session(current))
}

pub fn cancel(
    app: &AppHandle,
    session_id: &str,
) -> anyhow::Result<FeishuConnectorOnboardingSession> {
    let session_id = session_id.trim();
    let state = app.state::<AppState>();
    let mut onboarding = state
        .feishu_onboarding
        .lock()
        .map_err(|_| anyhow::anyhow!("feishu onboarding mutex is poisoned"))?;
    let current = onboarding
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("当前没有进行中的飞书开通会话"))?;
    if current.session_id != session_id {
        anyhow::bail!("飞书开通会话不存在或已被替换");
    }
    if !is_terminal_state(current.state) {
        current.state = FeishuConnectorOnboardingState::Cancelled;
        current.completed_at = Some(now_rfc3339());
        current.detail_message = Some("已取消当前飞书机器人开通流程。".to_string());
        current.error_message = None;
    }
    Ok(snapshot_session(current))
}

fn persist_success(
    app: &AppHandle,
    connector_id: &str,
    app_id: &str,
    app_secret: &str,
) -> anyhow::Result<String> {
    bridge_settings_store::save_connector_secrets(
        app,
        &BridgeConnectorSecretsInput {
            connector_id: connector_id.to_string(),
            telegram: BridgeTelegramSecrets::default(),
            feishu: BridgeFeishuSecrets {
                app_id: Some(app_id.to_string()),
                app_secret: Some(app_secret.to_string()),
                verification_token: None,
                encrypt_key: None,
            },
            weixin: BridgeWeixinSecrets::default(),
        },
    )?;

    let mut settings = bridge_settings_store::load_or_default(app)?;
    settings.enabled = true;
    let mut updated = false;
    for connector in &mut settings.connectors {
        if connector.id == connector_id {
            connector.enabled = true;
            if connector.platform != BridgePlatform::Feishu {
                anyhow::bail!("目标 connector 不是飞书 connector");
            }
            updated = true;
        }
    }
    if !updated {
        anyhow::bail!("未找到目标飞书 connector: {connector_id}");
    }
    bridge_settings_store::save(app, &settings)?;

    match bridge_manager::restart_bridge(app) {
        Ok(_) => Ok("机器人已创建，凭据已保存，并已自动重启 IM Bridge。".to_string()),
        Err(error) => Ok(format!(
            "机器人已创建，凭据已保存；但自动重启 IM Bridge 失败，请手动重启。{error}"
        )),
    }
}

fn update_poll_base_url(
    app: &AppHandle,
    session_id: &str,
    next_base_url: &str,
) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut onboarding = state
        .feishu_onboarding
        .lock()
        .map_err(|_| anyhow::anyhow!("feishu onboarding mutex is poisoned"))?;
    if let Some(current) = onboarding.as_mut() {
        if current.session_id == session_id {
            current.poll_base_url = next_base_url.to_string();
        }
    }
    Ok(())
}

fn get_feishu_connector(
    app: &AppHandle,
    connector_id: &str,
) -> anyhow::Result<BridgeConnectorConfig> {
    if connector_id.is_empty() {
        anyhow::bail!("connector id is required");
    }
    let settings = bridge_settings_store::load_or_default(app)?;
    settings
        .connectors
        .into_iter()
        .find(|connector| connector.id == connector_id)
        .ok_or_else(|| anyhow::anyhow!("未找到 connector: {connector_id}"))
        .and_then(|connector| {
            if connector.platform != BridgePlatform::Feishu {
                anyhow::bail!("当前只支持飞书 connector 自助开通");
            }
            Ok(connector)
        })
}

fn snapshot_session(session: &FeishuOnboardingRuntimeState) -> FeishuConnectorOnboardingSession {
    FeishuConnectorOnboardingSession {
        session_id: session.session_id.clone(),
        connector_id: session.connector_id.clone(),
        state: session.state,
        started_at: session.started_at.clone(),
        expires_at: session.expires_at.clone(),
        completed_at: session.completed_at.clone(),
        verification_url: session.verification_url.clone(),
        qr_svg: session.qr_svg.clone(),
        scanner_open_id: session.scanner_open_id.clone(),
        detail_message: session.detail_message.clone(),
        error_message: session.error_message.clone(),
        app_id_masked: session.app_id_masked.clone(),
        last_configured_at: session.last_configured_at.clone(),
    }
}

fn should_reuse_existing_session(
    session: &FeishuOnboardingRuntimeState,
    connector_id: &str,
    now_ms: u64,
) -> bool {
    session.connector_id == connector_id
        && !is_terminal_state(session.state)
        && !has_session_expired(session, now_ms)
}

fn is_terminal_state(state: FeishuConnectorOnboardingState) -> bool {
    matches!(
        state,
        FeishuConnectorOnboardingState::Succeeded
            | FeishuConnectorOnboardingState::Failed
            | FeishuConnectorOnboardingState::Expired
            | FeishuConnectorOnboardingState::Cancelled
    )
}

fn has_session_expired(session: &FeishuOnboardingRuntimeState, now_ms: u64) -> bool {
    session
        .expires_at_ms
        .map(|deadline| now_ms >= deadline)
        .unwrap_or(false)
}

fn expire_if_needed(session: &mut FeishuOnboardingRuntimeState, now_ms: u64) {
    if !is_terminal_state(session.state) && has_session_expired(session, now_ms) {
        session.state = FeishuConnectorOnboardingState::Expired;
        session.completed_at = Some(now_rfc3339());
        session.detail_message = Some("当前开通会话已过期，请重新开始。".to_string());
        session.error_message = Some("飞书开通二维码已过期".to_string());
    }
}

fn apply_non_success_poll(session: &mut FeishuOnboardingRuntimeState, poll: &PollResponse) {
    match poll.error.as_deref() {
        None | Some("authorization_pending") => {
            session.state = FeishuConnectorOnboardingState::Polling;
            session.error_message = None;
            session.detail_message =
                Some("等待扫码完成授权，创建成功后会自动保存凭据。".to_string());
        }
        Some("slow_down") => {
            session.state = FeishuConnectorOnboardingState::Polling;
            session.poll_interval_secs = session.poll_interval_secs.saturating_add(5);
            session.error_message = None;
            session.detail_message =
                Some("飞书要求放慢轮询频率，应用会继续等待授权结果。".to_string());
        }
        Some("access_denied") => {
            session.state = FeishuConnectorOnboardingState::Failed;
            session.completed_at = Some(now_rfc3339());
            session.detail_message = Some("扫码用户拒绝了当前机器人创建授权。".to_string());
            session.error_message = Some("用户拒绝授权".to_string());
        }
        Some("expired_token") => {
            session.state = FeishuConnectorOnboardingState::Expired;
            session.completed_at = Some(now_rfc3339());
            session.detail_message = Some("当前二维码会话已失效，请重新开始。".to_string());
            session.error_message = Some("开通会话已过期".to_string());
        }
        Some(code) => {
            session.state = FeishuConnectorOnboardingState::Failed;
            session.completed_at = Some(now_rfc3339());
            session.detail_message = Some("飞书未完成机器人创建，请检查错误后重试。".to_string());
            session.error_message = Some(match poll.error_description.as_deref() {
                Some(description) if !description.trim().is_empty() => {
                    format!("{code}: {description}")
                }
                _ => code.to_string(),
            });
        }
    }
}

fn append_onboard_source(raw_url: &str) -> anyhow::Result<String> {
    let mut url = Url::parse(raw_url)
        .with_context(|| format!("failed to parse verification url: {raw_url}"))?;
    url.query_pairs_mut().append_pair("from", "onboard");
    Ok(url.to_string())
}

fn render_qr_svg(value: &str) -> anyhow::Result<String> {
    let code = QrCode::new(value.as_bytes()).context("failed to build qr code")?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .dark_color(svg::Color("#1F252D"))
        .light_color(svg::Color("#FBF8F2"))
        .build())
}

fn mask_secret(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 6 {
        return format!(
            "{}***{}",
            chars.first().copied().unwrap_or('*'),
            chars.last().copied().unwrap_or('*')
        );
    }
    let head: String = chars.iter().take(4).collect();
    let tail: String = chars
        .iter()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("{head}***{tail}")
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn rfc3339_from_unix_ms(value: u64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(value as i64)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

struct FeishuRegistrationClient {
    http: Client,
    base_url: Arc<str>,
}

impl FeishuRegistrationClient {
    fn new(base_url: &str) -> anyhow::Result<Self> {
        let http = Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .context("failed to build feishu onboarding http client")?;
        Ok(Self {
            http,
            base_url: Arc::<str>::from(base_url.to_string()),
        })
    }

    fn init(&self) -> anyhow::Result<InitResponse> {
        self.post_form(&[("action", "init".to_string())])
    }

    fn begin(&self) -> anyhow::Result<BeginResponse> {
        self.post_form(&[
            ("action", "begin".to_string()),
            ("archetype", "PersonalAgent".to_string()),
            ("auth_method", "client_secret".to_string()),
            ("request_user_info", "open_id".to_string()),
        ])
    }

    fn poll(&self, device_code: &str) -> anyhow::Result<PollResponse> {
        self.post_form(&[
            ("action", "poll".to_string()),
            ("device_code", device_code.to_string()),
        ])
    }

    fn post_form<T>(&self, pairs: &[(&str, String)]) -> anyhow::Result<T>
    where
        T: for<'de> Deserialize<'de>,
    {
        let response = self
            .http
            .post(format!("{}/oauth/v1/app/registration", self.base_url))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(pairs)
            .send()
            .context("failed to send feishu onboarding request")?;
        let status = response.status();
        let body = response
            .text()
            .context("failed to read feishu onboarding response")?;
        serde_json::from_str::<T>(&body).with_context(|| {
            format!("failed to parse feishu onboarding response (status={status}): {body}")
        })
    }
}

#[derive(Debug, Deserialize)]
struct InitResponse {
    #[serde(default)]
    supported_auth_methods: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct BeginResponse {
    verification_uri_complete: String,
    device_code: String,
    interval: Option<u64>,
    expire_in: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct PollResponse {
    client_id: Option<String>,
    client_secret: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    user_info: Option<PollUserInfo>,
}

#[derive(Debug, Clone, Deserialize)]
struct PollUserInfo {
    open_id: Option<String>,
    tenant_brand: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread, time::Duration};
    use tiny_http::{Header, Response, Server};

    #[test]
    fn should_reuse_same_active_session() {
        let session = FeishuOnboardingRuntimeState {
            session_id: "session-1".to_string(),
            connector_id: "feishu-default".to_string(),
            state: FeishuConnectorOnboardingState::AwaitingScan,
            started_at: now_rfc3339(),
            expires_at: Some(now_rfc3339()),
            expires_at_ms: Some(unix_time_millis() + 60_000),
            completed_at: None,
            verification_url: Some("https://example.com".to_string()),
            qr_svg: Some("<svg />".to_string()),
            scanner_open_id: None,
            detail_message: None,
            error_message: None,
            app_id_masked: None,
            last_configured_at: None,
            device_code: "device-1".to_string(),
            poll_base_url: FEISHU_ACCOUNTS_BASE.to_string(),
            poll_interval_secs: 5,
        };
        assert!(should_reuse_existing_session(
            &session,
            "feishu-default",
            unix_time_millis()
        ));
        assert!(!should_reuse_existing_session(
            &session,
            "feishu-2",
            unix_time_millis()
        ));
    }

    #[test]
    fn apply_non_success_poll_updates_state() {
        let mut session = FeishuOnboardingRuntimeState {
            session_id: "session-1".to_string(),
            connector_id: "feishu-default".to_string(),
            state: FeishuConnectorOnboardingState::AwaitingScan,
            started_at: now_rfc3339(),
            expires_at: Some(now_rfc3339()),
            expires_at_ms: Some(unix_time_millis() + 60_000),
            completed_at: None,
            verification_url: Some("https://example.com".to_string()),
            qr_svg: Some("<svg />".to_string()),
            scanner_open_id: None,
            detail_message: None,
            error_message: None,
            app_id_masked: None,
            last_configured_at: None,
            device_code: "device-1".to_string(),
            poll_base_url: FEISHU_ACCOUNTS_BASE.to_string(),
            poll_interval_secs: 5,
        };

        apply_non_success_poll(
            &mut session,
            &PollResponse {
                client_id: None,
                client_secret: None,
                error: Some("slow_down".to_string()),
                error_description: None,
                user_info: None,
            },
        );
        assert_eq!(session.state, FeishuConnectorOnboardingState::Polling);
        assert_eq!(session.poll_interval_secs, 10);

        apply_non_success_poll(
            &mut session,
            &PollResponse {
                client_id: None,
                client_secret: None,
                error: Some("access_denied".to_string()),
                error_description: None,
                user_info: None,
            },
        );
        assert_eq!(session.state, FeishuConnectorOnboardingState::Failed);
        assert_eq!(session.error_message.as_deref(), Some("用户拒绝授权"));
    }

    #[test]
    fn append_onboard_source_and_render_qr() {
        let url = append_onboard_source("https://accounts.feishu.cn/verify?token=abc")
            .expect("append onboard");
        assert!(url.contains("from=onboard"));
        let svg = render_qr_svg(&url).expect("render qr");
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn feishu_registration_client_begin_and_poll_against_mock_server() {
        let server = Server::http("127.0.0.1:0").expect("mock server");
        let base_url = format!("http://{}", server.server_addr());
        let handle = thread::spawn(move || {
            for index in 0..3 {
                let request = server.recv().expect("request");
                let body = if index == 0 {
                    r#"{"supported_auth_methods":["client_secret"]}"#
                } else if index == 1 {
                    r#"{"verification_uri_complete":"https://accounts.feishu.cn/verify?token=abc","device_code":"device-1","interval":5,"expire_in":600}"#
                } else {
                    r#"{"error":"authorization_pending"}"#
                };
                let response = Response::from_string(body).with_header(
                    Header::from_bytes("Content-Type", "application/json").expect("header"),
                );
                request.respond(response).expect("respond");
            }
        });

        let client = FeishuRegistrationClient::new(base_url.as_str()).expect("client");
        let init = client.init().expect("init");
        assert_eq!(init.supported_auth_methods, vec!["client_secret"]);
        let begin = client.begin().expect("begin");
        assert_eq!(begin.device_code, "device-1");
        let poll = client.poll("device-1").expect("poll");
        assert_eq!(poll.error.as_deref(), Some("authorization_pending"));
        handle.join().expect("join");
        thread::sleep(Duration::from_millis(10));
    }
}
