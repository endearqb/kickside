use qrcode::{render::svg, QrCode};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use url::Url;

use crate::{
    app_state::{unix_time_millis, AppState},
    backend_manager,
    lan_access::{self, KimiLanAddress},
    types::{BackendState, KimiAccessMode, KimiRemoteControlState, RuntimeOwnership},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiAccessStatus {
    pub mode: KimiAccessMode,
    pub switching: bool,
    pub last_error: Option<String>,
    pub runtime_ownership: RuntimeOwnership,
    pub runtime_ready: bool,
    pub can_change: bool,
    pub port: Option<u16>,
    pub lan_addresses: Vec<KimiLanAddress>,
    pub remote_control_supported: bool,
    pub remote_control_state: KimiRemoteControlState,
    pub remote_url_available: bool,
    pub remote_started_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiRemoteLaunchUrl {
    pub url: String,
    pub qr_svg: String,
}

pub fn status(app: &AppHandle) -> Result<KimiAccessStatus, String> {
    let state = app.state::<AppState>();
    let (
        mode,
        switching,
        last_error,
        ownership,
        runtime_ready,
        can_change,
        port,
        remote_control_supported,
        remote_control_state,
        remote_url_available,
        remote_started_at_ms,
    ) = {
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "Kimi 运行时状态不可用".to_string())?;
        let runtime_ready = runtime.state == BackendState::Running;
        (
            runtime.kimi_access_mode,
            runtime.lan_access_switching,
            runtime
                .lan_access_last_error
                .clone()
                .or_else(|| runtime.remote_control_last_error.clone()),
            runtime.runtime_ownership,
            runtime_ready,
            runtime_ready
                && runtime.runtime_ownership == RuntimeOwnership::OwnedByShell
                && runtime.child.is_some(),
            runtime.active_port,
            runtime.remote_control_supported == Some(true),
            runtime.remote_control_state,
            runtime.remote_control_url.is_some(),
            runtime.remote_control_started_at_ms,
        )
    };
    let lan_addresses = if mode == KimiAccessMode::Lan && runtime_ready {
        port.and_then(|port| lan_access::discover_private_ipv4(port).ok())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    Ok(KimiAccessStatus {
        mode,
        switching,
        last_error,
        runtime_ownership: ownership,
        runtime_ready,
        can_change,
        port,
        lan_addresses,
        remote_control_supported,
        remote_control_state,
        remote_url_available,
        remote_started_at_ms,
    })
}

pub fn set_mode(app: AppHandle, mode: KimiAccessMode) -> Result<KimiAccessStatus, String> {
    backend_manager::switch_kimi_access_mode(app.clone(), mode)?;
    status(&app)
}

pub fn remote_launch_url(app: &AppHandle) -> Result<KimiRemoteLaunchUrl, String> {
    let remote_url = {
        let state = app.state::<AppState>();
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "Kimi 运行时状态不可用".to_string())?;
        if runtime.kimi_access_mode != KimiAccessMode::KimiRemote
            || runtime.remote_control_state != KimiRemoteControlState::Connected
        {
            return Err("Kimi 官方远程访问尚未连接".to_string());
        }
        runtime
            .remote_control_url
            .clone()
            .ok_or_else(|| "Kimi 官方远程地址尚不可用".to_string())?
    };
    let qr_svg = QrCode::new(remote_url.as_bytes())
        .map_err(|_| "无法生成远程访问二维码".to_string())?
        .render::<svg::Color>()
        .min_dimensions(208, 208)
        .dark_color(svg::Color("#111827"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(KimiRemoteLaunchUrl {
        url: remote_url,
        qr_svg,
    })
}

pub(crate) fn observe_remote_output(app: &AppHandle, generation: u64, raw: &str) {
    let remote_url = extract_remote_url(raw);
    let state = app.state::<AppState>();
    let Ok(mut runtime) = state.runtime.lock() else {
        return;
    };
    if runtime.generation != generation || runtime.kimi_access_mode != KimiAccessMode::KimiRemote {
        return;
    }
    if let Some(url) = remote_url {
        runtime.remote_control_url = Some(url);
        runtime.remote_control_state = KimiRemoteControlState::Connected;
        runtime
            .remote_control_started_at_ms
            .get_or_insert_with(unix_time_millis);
        runtime.remote_control_last_error = None;
        return;
    }
    match classify_remote_state(raw, runtime.remote_control_state) {
        Some(KimiRemoteControlState::Connected) => {
            runtime.remote_control_state = KimiRemoteControlState::Connected;
            runtime
                .remote_control_started_at_ms
                .get_or_insert_with(unix_time_millis);
            runtime.remote_control_last_error = None;
        }
        Some(KimiRemoteControlState::Disconnected) => {
            runtime.remote_control_state = KimiRemoteControlState::Disconnected;
        }
        Some(KimiRemoteControlState::Registering) => {
            runtime.remote_control_state = KimiRemoteControlState::Registering;
        }
        Some(KimiRemoteControlState::Error) => {
            runtime.remote_control_state = KimiRemoteControlState::Error;
            runtime.remote_control_url = None;
            runtime.remote_control_last_error =
                Some("Kimi 官方远程连接失败，请检查登录和网络后重试".to_string());
        }
        Some(KimiRemoteControlState::Disabled | KimiRemoteControlState::Starting) | None => {}
    }
}

fn classify_remote_state(
    raw: &str,
    current: KimiRemoteControlState,
) -> Option<KimiRemoteControlState> {
    let lower = strip_ansi_sequences(raw).to_ascii_lowercase();
    let remote_context =
        lower.contains("remote") || lower.contains("relay") || lower.contains("code-rc.kimi.com");
    if !remote_context {
        return None;
    }
    if lower.contains("error") || lower.contains("failed") || lower.contains("denied") {
        return Some(KimiRemoteControlState::Error);
    }
    if lower.contains("remote device disconnected") {
        return None;
    }
    if lower.contains("relay disconnected") || lower.contains("connection closed") {
        return Some(KimiRemoteControlState::Disconnected);
    }
    if lower.contains("connected to relay")
        || lower.contains("connected to code-rc.kimi.com")
        || lower.contains("remote device connected")
    {
        return Some(KimiRemoteControlState::Connected);
    }
    if current != KimiRemoteControlState::Connected
        && (lower.contains("register")
            || lower.contains("registration")
            || lower.contains("connecting")
            || lower.contains("starting"))
    {
        return Some(KimiRemoteControlState::Registering);
    }
    None
}

pub(crate) fn redact_remote_output(raw: &str) -> Option<String> {
    let lower = raw.to_ascii_lowercase();
    let contains_url = ["https://", "http://", "wss://", "ws://"]
        .iter()
        .any(|scheme| lower.contains(scheme));
    let contains_auth_code = [
        "user code",
        "device code",
        "verification code",
        "oauth code",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    (contains_url || contains_auth_code).then(|| "[Kimi 官方远程地址已脱敏]\n".to_string())
}

fn extract_remote_url(raw: &str) -> Option<String> {
    let plain = strip_ansi_sequences(raw);
    plain.split_whitespace().find_map(|candidate| {
        let candidate = candidate.trim_matches(|character: char| {
            matches!(
                character,
                '"' | '\'' | '(' | ')' | '[' | ']' | '<' | '>' | ',' | ';' | '.'
            )
        });
        let url = Url::parse(candidate).ok()?;
        if url.scheme() != "https" {
            return None;
        }
        let host = url.host_str()?.to_ascii_lowercase();
        let trusted_host = host == "kimi.com" || host.ends_with(".kimi.com");
        let official_relay_url = host == "code-rc.kimi.com"
            && url.path().starts_with("/devices/")
            && url
                .query_pairs()
                .any(|(key, value)| key == "rc" && value == "1")
            && url
                .query_pairs()
                .any(|(key, value)| key == "from" && value == "kimi_code_cli");
        let context = plain.to_ascii_lowercase();
        let remote_context = context.contains("remote")
            || context.contains("control")
            || url.path().to_ascii_lowercase().contains("remote")
            || url.path().to_ascii_lowercase().contains("control");
        (trusted_host && (official_relay_url || remote_context)).then(|| url.to_string())
    })
}

fn strip_ansi_sequences(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut plain = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != 0x1b {
            plain.push(bytes[index]);
            index += 1;
            continue;
        }
        index += 1;
        match bytes.get(index).copied() {
            Some(b'[') => {
                index += 1;
                while index < bytes.len() {
                    let byte = bytes[index];
                    index += 1;
                    if (0x40..=0x7e).contains(&byte) {
                        break;
                    }
                }
            }
            Some(b']') => {
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == 0x07 {
                        index += 1;
                        break;
                    }
                    if bytes[index] == 0x1b && bytes.get(index + 1) == Some(&b'\\') {
                        index += 2;
                        break;
                    }
                    index += 1;
                }
            }
            Some(_) => index += 1,
            None => {}
        }
    }
    String::from_utf8_lossy(&plain).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_contextual_https_kimi_remote_urls() {
        assert_eq!(
            extract_remote_url("Remote Control: https://www.kimi.com/remote/device-1?code=secret"),
            Some("https://www.kimi.com/remote/device-1?code=secret".to_string())
        );
        assert_eq!(
            extract_remote_url("https://example.com/remote/device-1"),
            None
        );
        assert_eq!(extract_remote_url("https://www.kimi.com/login"), None);
        assert_eq!(
            extract_remote_url(
                "  1. Scan the QR code, or open \u{1b}[38;2;30;144;255mhttps://code-rc.kimi.com/devices/device-1/?rc=1&from=kimi_code_cli\u{1b}[0m"
            ),
            Some(
                "https://code-rc.kimi.com/devices/device-1/?rc=1&from=kimi_code_cli"
                    .to_string()
            )
        );
        assert_eq!(
            extract_remote_url("https://code-rc.kimi.com/devices/device-1/?rc=1&from=untrusted"),
            None
        );
    }

    #[test]
    fn remote_output_redaction_removes_the_entire_sensitive_line() {
        let output = redact_remote_output(
            "Remote Control: https://www.kimi.com/remote/device-1?code=secret\n",
        )
        .unwrap();
        assert!(!output.contains("device-1"));
        assert!(!output.contains("secret"));
        assert!(redact_remote_output("OAuth user code: ABCD-EFGH\n").is_some());
    }

    #[test]
    fn remote_state_does_not_downgrade_connected_output_to_registering() {
        assert_eq!(
            classify_remote_state(
                "  ✓ Connected to relay, waiting for remote devices…",
                KimiRemoteControlState::Connected
            ),
            Some(KimiRemoteControlState::Connected)
        );
        assert_eq!(
            classify_remote_state(
                "  ! Relay disconnected; reconnecting…",
                KimiRemoteControlState::Connected
            ),
            Some(KimiRemoteControlState::Disconnected)
        );
        assert_eq!(
            classify_remote_state(
                "  → Remote device disconnected",
                KimiRemoteControlState::Connected
            ),
            None
        );
        assert_eq!(
            classify_remote_state(
                "Remote Control registration started",
                KimiRemoteControlState::Connected
            ),
            None
        );
        assert_eq!(
            classify_remote_state(
                "Remote Control registration started",
                KimiRemoteControlState::Starting
            ),
            Some(KimiRemoteControlState::Registering)
        );
    }
}
