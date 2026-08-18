use std::{collections::HashSet, net::Ipv4Addr};

use get_if_addrs::{get_if_addrs, IfAddr};
use qrcode::{render::svg, QrCode};
use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::AppState,
    backend_manager, token_resolver,
    types::{BackendState, RuntimeOwnership},
};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KimiLanAddress {
    pub name: String,
    pub ip: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiLanAccessStatus {
    pub enabled: bool,
    pub switching: bool,
    pub last_error: Option<String>,
    pub runtime_ownership: RuntimeOwnership,
    pub runtime_ready: bool,
    pub can_toggle: bool,
    pub port: Option<u16>,
    pub addresses: Vec<KimiLanAddress>,
    pub token_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiLanLaunchUrl {
    pub url: String,
    pub qr_svg: String,
}

pub fn status(app: &AppHandle) -> Result<KimiLanAccessStatus, String> {
    let state = app.state::<AppState>();
    let (
        runtime_ready,
        enabled,
        switching,
        last_error,
        runtime_ownership,
        can_toggle,
        port,
        token_available,
    ) = {
        let runtime = state
            .runtime
            .lock()
            .map_err(|_| "Kimi 运行时状态不可用".to_string())?;
        let runtime_ready = runtime.state == BackendState::Running;
        let enabled = runtime.lan_access_enabled
            && runtime_ready
            && runtime.runtime_ownership == RuntimeOwnership::OwnedByShell;
        (
            runtime_ready,
            enabled,
            runtime.lan_access_switching,
            runtime.lan_access_last_error.clone(),
            runtime.runtime_ownership,
            runtime_ready
                && runtime.runtime_ownership == RuntimeOwnership::OwnedByShell
                && runtime.child.is_some(),
            enabled.then_some(runtime.active_port).flatten(),
            runtime
                .server_token_path
                .as_ref()
                .is_some_and(|path| path.is_file()),
        )
    };
    let addresses = port
        .and_then(|port| discover_private_ipv4(port).ok())
        .unwrap_or_default();
    Ok(KimiLanAccessStatus {
        enabled,
        switching,
        last_error,
        runtime_ownership,
        runtime_ready,
        can_toggle,
        port,
        addresses,
        token_available,
    })
}

pub fn set_enabled(app: AppHandle, enabled: bool) -> Result<KimiLanAccessStatus, String> {
    backend_manager::switch_kimi_lan_access(app.clone(), enabled)?;
    status(&app)
}

pub fn launch_url(app: &AppHandle, requested_ip: &str) -> Result<KimiLanLaunchUrl, String> {
    let requested_ip = requested_ip
        .trim()
        .parse::<Ipv4Addr>()
        .map_err(|_| "局域网地址无效".to_string())?;
    let snapshot = status(app)?;
    if !snapshot.enabled || !snapshot.can_toggle {
        return Err("局域网访问尚未开启".to_string());
    }
    if !snapshot
        .addresses
        .iter()
        .any(|address| address.ip == requested_ip.to_string())
    {
        return Err("所选地址不再属于当前可用的私有网卡".to_string());
    }

    let token_path = app
        .state::<AppState>()
        .runtime
        .lock()
        .map_err(|_| "Kimi 运行时状态不可用".to_string())?
        .server_token_path
        .clone()
        .ok_or_else(|| "Kimi Token 当前不可用".to_string())?;
    let token = token_resolver::read_server_token_at(&token_path)
        .map_err(|_| "Kimi Token 当前不可用".to_string())?;
    let port = snapshot
        .port
        .ok_or_else(|| "Kimi 端口当前不可用".to_string())?;
    let origin = format!("http://{requested_ip}:{port}");
    let url = token_resolver::build_workspace_url(&origin, Some(&token.value));
    let qr_svg = render_qr_svg(&url).map_err(|_| "无法生成局域网二维码".to_string())?;
    Ok(KimiLanLaunchUrl { url, qr_svg })
}

fn discover_private_ipv4(port: u16) -> Result<Vec<KimiLanAddress>, String> {
    let mut seen = HashSet::new();
    let mut addresses = get_if_addrs()
        .map_err(|_| "无法枚举当前网络接口".to_string())?
        .into_iter()
        .filter_map(|interface| {
            if excluded_interface(&interface.name) {
                return None;
            }
            let IfAddr::V4(address) = interface.addr else {
                return None;
            };
            let ip = address.ip;
            if !ip.is_private() || ip.is_loopback() || ip.is_link_local() || !seen.insert(ip) {
                return None;
            }
            Some(KimiLanAddress {
                name: friendly_interface_name(&interface.name),
                ip: ip.to_string(),
                url: format!("http://{ip}:{port}"),
            })
        })
        .collect::<Vec<_>>();
    addresses.sort_by(|left, right| left.name.cmp(&right.name).then(left.ip.cmp(&right.ip)));
    Ok(addresses)
}

fn excluded_interface(name: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    [
        "loopback",
        "docker",
        "veth",
        "virbr",
        "vmnet",
        "vbox",
        "vethernet",
        "hyper-v",
        "utun",
        "tun",
        "tap",
        "tailscale",
        "wireguard",
        "wg",
        "bridge",
        "br-",
        "awdl",
        "llw",
        "anpi",
    ]
    .iter()
    .any(|marker| name.contains(marker))
        || name == "lo"
        || name.starts_with("lo0")
}

fn friendly_interface_name(name: &str) -> String {
    match name.trim().to_ascii_lowercase().as_str() {
        "en0" => "Wi-Fi / Ethernet".to_string(),
        "en1" => "Ethernet / Wi-Fi".to_string(),
        _ => name.trim().to_string(),
    }
}

fn render_qr_svg(value: &str) -> anyhow::Result<String> {
    let code = QrCode::new(value.as_bytes())?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .dark_color(svg::Color("#1F1F1F"))
        .light_color(svg::Color("#FFFFFF"))
        .build())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn excludes_virtual_and_tunnel_interfaces() {
        for name in [
            "lo0",
            "docker0",
            "vEthernet (WSL)",
            "utun3",
            "tailscale0",
            "vmnet8",
        ] {
            assert!(excluded_interface(name), "{name} should be excluded");
        }
        for name in ["en0", "Ethernet", "Wi-Fi"] {
            assert!(!excluded_interface(name), "{name} should remain eligible");
        }
    }

    #[test]
    fn generated_qr_does_not_log_or_persist_the_launch_url() {
        let svg = render_qr_svg("http://192.168.1.8:58627/#token=opaque").unwrap();
        assert!(svg.starts_with("<?xml"));
        assert!(!svg.contains("opaque"));
    }
}
