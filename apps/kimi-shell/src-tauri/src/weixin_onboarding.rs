use anyhow::Context;
use chrono::Utc;
use qrcode::{render::svg, QrCode};
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::{unix_time_millis, AppState, WeixinOnboardingRuntimeState},
    bridge_manager, bridge_settings_store, onboarding_http,
    types::{
        BridgeConnectorConfig, BridgeConnectorSecretsInput, BridgeFeishuSecrets, BridgePlatform,
        BridgeTelegramSecrets, BridgeWeixinSecrets, StartWeixinConnectorOnboardingInput,
        WeixinConnectorOnboardingSession, WeixinConnectorOnboardingState,
    },
};

const DEFAULT_WEIXIN_API_BASE: &str = "https://ilinkai.weixin.qq.com";
const DEFAULT_ILINK_BOT_TYPE: &str = "3";
const DEFAULT_EXPIRE_IN_SECS: u64 = 300;
const MAX_QR_REFRESH_COUNT: u32 = 3;

pub fn start(
    app: &AppHandle,
    input: &StartWeixinConnectorOnboardingInput,
) -> anyhow::Result<WeixinConnectorOnboardingSession> {
    let connector = get_weixin_connector(app, input.connector_id.trim())?;
    let api_base_url = resolve_connector_base_url(app, connector.id.as_str())?;
    let now_ms = unix_time_millis();

    {
        let state = app.state::<AppState>();
        let mut onboarding = state
            .weixin_onboarding
            .lock()
            .map_err(|_| anyhow::anyhow!("weixin onboarding mutex is poisoned"))?;
        if let Some(existing) = onboarding.as_mut() {
            expire_if_needed(existing, now_ms);
            if should_reuse_existing_session(existing, connector.id.as_str(), now_ms) {
                return Ok(snapshot_session(existing));
            }
        }
    }

    let client = WeixinLoginClient::new(app, api_base_url.as_str());
    let qr = client.fetch_qr_code(DEFAULT_ILINK_BOT_TYPE)?;
    let qr_svg = render_qr_svg(&qr.qrcode_img_content)?;
    let started_at = now_rfc3339();
    let expires_at_ms = now_ms.saturating_add(DEFAULT_EXPIRE_IN_SECS * 1000);
    let runtime = WeixinOnboardingRuntimeState {
        session_id: format!("weixin-onboard-{now_ms}"),
        connector_id: connector.id.clone(),
        state: WeixinConnectorOnboardingState::AwaitingScan,
        started_at,
        expires_at: Some(rfc3339_from_unix_ms(expires_at_ms)),
        expires_at_ms: Some(expires_at_ms),
        completed_at: None,
        verification_url: Some(qr.qrcode_img_content.clone()),
        qr_svg: Some(qr_svg),
        qrcode: qr.qrcode,
        detail_message: Some(format!(
            "请使用微信扫码完成 {} 的登录授权。",
            connector.label
        )),
        error_message: None,
        account_id: None,
        owner_user_id: None,
        last_configured_at: None,
        api_base_url,
        refresh_count: 0,
    };

    let snapshot = snapshot_session(&runtime);
    let state = app.state::<AppState>();
    let mut onboarding = state
        .weixin_onboarding
        .lock()
        .map_err(|_| anyhow::anyhow!("weixin onboarding mutex is poisoned"))?;
    *onboarding = Some(runtime);
    Ok(snapshot)
}

pub fn get_status(
    app: &AppHandle,
    session_id: &str,
) -> anyhow::Result<WeixinConnectorOnboardingSession> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        anyhow::bail!("session id is required");
    }

    let existing = {
        let state = app.state::<AppState>();
        let mut onboarding = state
            .weixin_onboarding
            .lock()
            .map_err(|_| anyhow::anyhow!("weixin onboarding mutex is poisoned"))?;
        let current = onboarding
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("当前没有进行中的微信开通会话"))?;
        if current.session_id != session_id {
            anyhow::bail!("微信开通会话不存在或已被替换");
        }
        expire_if_needed(current, unix_time_millis());
        if is_terminal_state(current.state) {
            return Ok(snapshot_session(current));
        }
        current.clone()
    };

    let client = WeixinLoginClient::new(app, existing.api_base_url.as_str());
    let status = client.poll_qr_status(existing.qrcode.as_str())?;

    let state = app.state::<AppState>();
    let mut onboarding = state
        .weixin_onboarding
        .lock()
        .map_err(|_| anyhow::anyhow!("weixin onboarding mutex is poisoned"))?;
    let current = onboarding
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("微信开通会话已被清理"))?;
    if current.session_id != session_id {
        anyhow::bail!("微信开通会话已变化，请刷新后重试");
    }

    match status.status.as_str() {
        "wait" => {
            current.state = WeixinConnectorOnboardingState::Polling;
            current.error_message = None;
            current.detail_message = Some("等待微信完成扫码授权。".to_string());
        }
        "scaned" | "scanned" => {
            current.state = WeixinConnectorOnboardingState::Polling;
            current.error_message = None;
            current.detail_message = Some("已扫码，请在微信中继续确认授权。".to_string());
        }
        "expired" => {
            if current.refresh_count >= MAX_QR_REFRESH_COUNT {
                current.state = WeixinConnectorOnboardingState::Expired;
                current.completed_at = Some(now_rfc3339());
                current.detail_message =
                    Some("二维码多次过期，请重新开始微信机器人登录。".to_string());
                current.error_message = Some("二维码已过期".to_string());
                return Ok(snapshot_session(current));
            }

            let refreshed = client.fetch_qr_code(DEFAULT_ILINK_BOT_TYPE)?;
            current.refresh_count += 1;
            current.state = WeixinConnectorOnboardingState::AwaitingScan;
            current.qrcode = refreshed.qrcode;
            current.verification_url = Some(refreshed.qrcode_img_content.clone());
            current.qr_svg = Some(render_qr_svg(&refreshed.qrcode_img_content)?);
            current.expires_at_ms =
                Some(unix_time_millis().saturating_add(DEFAULT_EXPIRE_IN_SECS * 1000));
            current.expires_at = current.expires_at_ms.map(rfc3339_from_unix_ms);
            current.error_message = None;
            current.detail_message = Some(format!(
                "二维码已刷新（{}/{}），请重新扫码。",
                current.refresh_count, MAX_QR_REFRESH_COUNT
            ));
        }
        "confirmed" => {
            let bot_token = status
                .bot_token
                .clone()
                .ok_or_else(|| anyhow::anyhow!("微信返回 confirmed，但缺少 bot_token"))?;
            let account_id = status
                .ilink_bot_id
                .clone()
                .ok_or_else(|| anyhow::anyhow!("微信返回 confirmed，但缺少 ilink_bot_id"))?;
            let configured_at = now_rfc3339();
            let restart_message = persist_success(
                app,
                current.connector_id.as_str(),
                bot_token.as_str(),
                status
                    .baseurl
                    .as_deref()
                    .unwrap_or(current.api_base_url.as_str()),
                account_id.as_str(),
                status.ilink_user_id.as_deref().unwrap_or(""),
            )?;
            current.state = WeixinConnectorOnboardingState::Succeeded;
            current.completed_at = Some(configured_at.clone());
            current.detail_message = Some(restart_message);
            current.error_message = None;
            current.account_id = Some(account_id);
            current.owner_user_id = status.ilink_user_id;
            current.last_configured_at = Some(configured_at);
        }
        other => {
            current.state = WeixinConnectorOnboardingState::Failed;
            current.completed_at = Some(now_rfc3339());
            current.detail_message = Some("微信登录未完成，请检查错误后重试。".to_string());
            current.error_message = Some(format!("unknown_status: {other}"));
        }
    }

    Ok(snapshot_session(current))
}

pub fn cancel(
    app: &AppHandle,
    session_id: &str,
) -> anyhow::Result<WeixinConnectorOnboardingSession> {
    let session_id = session_id.trim();
    let state = app.state::<AppState>();
    let mut onboarding = state
        .weixin_onboarding
        .lock()
        .map_err(|_| anyhow::anyhow!("weixin onboarding mutex is poisoned"))?;
    let current = onboarding
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("当前没有进行中的微信开通会话"))?;
    if current.session_id != session_id {
        anyhow::bail!("微信开通会话不存在或已被替换");
    }
    if !is_terminal_state(current.state) {
        current.state = WeixinConnectorOnboardingState::Cancelled;
        current.completed_at = Some(now_rfc3339());
        current.detail_message = Some("已取消当前微信机器人开通流程。".to_string());
        current.error_message = None;
    }
    Ok(snapshot_session(current))
}

fn persist_success(
    app: &AppHandle,
    connector_id: &str,
    bot_token: &str,
    base_url: &str,
    account_id: &str,
    owner_user_id: &str,
) -> anyhow::Result<String> {
    bridge_settings_store::save_connector_secrets(
        app,
        &BridgeConnectorSecretsInput {
            connector_id: connector_id.to_string(),
            telegram: BridgeTelegramSecrets::default(),
            feishu: BridgeFeishuSecrets::default(),
            weixin: BridgeWeixinSecrets {
                bot_token: Some(bot_token.to_string()),
                base_url: Some(base_url.to_string()),
                account_id: Some(account_id.to_string()),
                owner_user_id: if owner_user_id.trim().is_empty() {
                    None
                } else {
                    Some(owner_user_id.to_string())
                },
            },
        },
    )?;

    let mut settings = bridge_settings_store::load_or_default(app)?;
    settings.enabled = true;
    let mut updated = false;
    for connector in &mut settings.connectors {
        if connector.id == connector_id {
            connector.enabled = true;
            if connector.platform != BridgePlatform::Weixin {
                anyhow::bail!("目标 connector 不是微信 connector");
            }
            updated = true;
        }
    }
    if !updated {
        anyhow::bail!("未找到目标微信 connector: {connector_id}");
    }
    bridge_settings_store::save(app, &settings)?;

    match bridge_manager::restart_bridge(app) {
        Ok(_) => Ok("微信机器人已登录，凭据已保存，并已自动重启 IM Bridge。".to_string()),
        Err(error) => Ok(format!(
            "微信机器人已登录，凭据已保存；但自动重启 IM Bridge 失败，请手动重启。{error}"
        )),
    }
}

fn resolve_connector_base_url(app: &AppHandle, connector_id: &str) -> anyhow::Result<String> {
    let secrets = bridge_settings_store::load_secrets_or_default(app)?;
    Ok(secrets
        .connectors
        .get(connector_id)
        .and_then(|connector| connector.weixin.as_ref())
        .and_then(|weixin| weixin.base_url.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_WEIXIN_API_BASE.to_string()))
}

fn get_weixin_connector(
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
            if connector.platform != BridgePlatform::Weixin {
                anyhow::bail!("当前只支持微信 connector 自助开通");
            }
            Ok(connector)
        })
}

fn snapshot_session(session: &WeixinOnboardingRuntimeState) -> WeixinConnectorOnboardingSession {
    WeixinConnectorOnboardingSession {
        session_id: session.session_id.clone(),
        connector_id: session.connector_id.clone(),
        state: session.state,
        started_at: session.started_at.clone(),
        expires_at: session.expires_at.clone(),
        completed_at: session.completed_at.clone(),
        verification_url: session.verification_url.clone(),
        qr_svg: session.qr_svg.clone(),
        detail_message: session.detail_message.clone(),
        error_message: session.error_message.clone(),
        account_id: session.account_id.clone(),
        owner_user_id: session.owner_user_id.clone(),
        last_configured_at: session.last_configured_at.clone(),
    }
}

fn should_reuse_existing_session(
    session: &WeixinOnboardingRuntimeState,
    connector_id: &str,
    now_ms: u64,
) -> bool {
    session.connector_id == connector_id
        && !is_terminal_state(session.state)
        && !has_session_expired(session, now_ms)
}

fn is_terminal_state(state: WeixinConnectorOnboardingState) -> bool {
    matches!(
        state,
        WeixinConnectorOnboardingState::Succeeded
            | WeixinConnectorOnboardingState::Failed
            | WeixinConnectorOnboardingState::Expired
            | WeixinConnectorOnboardingState::Cancelled
    )
}

fn has_session_expired(session: &WeixinOnboardingRuntimeState, now_ms: u64) -> bool {
    session
        .expires_at_ms
        .map(|deadline| now_ms >= deadline)
        .unwrap_or(false)
}

fn expire_if_needed(session: &mut WeixinOnboardingRuntimeState, now_ms: u64) {
    if !is_terminal_state(session.state) && has_session_expired(session, now_ms) {
        session.state = WeixinConnectorOnboardingState::Expired;
        session.completed_at = Some(now_rfc3339());
        session.detail_message = Some("当前微信开通会话已过期，请重新开始。".to_string());
        session.error_message = Some("微信二维码已过期".to_string());
    }
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

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn rfc3339_from_unix_ms(value: u64) -> String {
    chrono::DateTime::<Utc>::from_timestamp_millis(value as i64)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

struct WeixinLoginClient {
    app: Option<AppHandle>,
    base_url: String,
}

impl WeixinLoginClient {
    fn new(app: &AppHandle, base_url: &str) -> Self {
        Self {
            app: Some(app.clone()),
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    fn fetch_qr_code(&self, bot_type: &str) -> anyhow::Result<QRCodeResponse> {
        onboarding_http::get_json(
            self.app.as_ref(),
            "weixin",
            "qr_code",
            format!(
                "{}/ilink/bot/get_bot_qrcode?bot_type={}",
                self.base_url, bot_type
            ),
            vec![("iLink-App-ClientVersion".to_string(), "1".to_string())],
            std::time::Duration::from_secs(20),
        )
        .context("failed to fetch weixin qr code")
    }

    fn poll_qr_status(&self, qrcode: &str) -> anyhow::Result<StatusResponse> {
        onboarding_http::get_json(
            self.app.as_ref(),
            "weixin",
            "qr_status",
            format!(
                "{}/ilink/bot/get_qrcode_status?qrcode={}",
                self.base_url, qrcode
            ),
            vec![("iLink-App-ClientVersion".to_string(), "1".to_string())],
            std::time::Duration::from_secs(20),
        )
        .context("failed to poll weixin qr status")
    }
}

#[derive(Debug, Deserialize)]
struct QRCodeResponse {
    qrcode: String,
    qrcode_img_content: String,
}

#[derive(Debug, Clone, Deserialize)]
struct StatusResponse {
    status: String,
    bot_token: Option<String>,
    ilink_bot_id: Option<String>,
    baseurl: Option<String>,
    ilink_user_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread, time::Duration};
    use tiny_http::{Header, Response, Server};

    #[test]
    fn client_fetches_qr_and_status() {
        let server = Server::http("127.0.0.1:0").expect("mock server");
        let base_url = format!("http://{}", server.server_addr());
        let handle = thread::spawn(move || {
            for index in 0..2 {
                let request = server.recv().expect("request");
                let body = if index == 0 {
                    r#"{"qrcode":"qr-1","qrcode_img_content":"https://example.com/qr"}"#
                } else {
                    r#"{"status":"wait"}"#
                };
                let response = Response::from_string(body).with_header(
                    Header::from_bytes("Content-Type", "application/json").expect("header"),
                );
                request.respond(response).expect("respond");
            }
        });

        let client = WeixinLoginClient {
            app: None,
            base_url: base_url.clone(),
        };
        let qr = client.fetch_qr_code(DEFAULT_ILINK_BOT_TYPE).expect("qr");
        assert_eq!(qr.qrcode, "qr-1");
        let status = client.poll_qr_status("qr-1").expect("status");
        assert_eq!(status.status, "wait");
        handle.join().expect("join");
        thread::sleep(Duration::from_millis(10));
    }
}
