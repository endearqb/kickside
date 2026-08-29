use std::{collections::HashSet, net::Ipv4Addr};

#[cfg(windows)]
use std::{collections::HashMap, mem::size_of};

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
        let enabled = runtime.kimi_access_mode == crate::types::KimiAccessMode::Lan
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

pub(crate) fn discover_private_ipv4(port: u16) -> Result<Vec<KimiLanAddress>, String> {
    #[cfg(windows)]
    let windows_adapters = windows_adapter_metadata()?;

    let mut seen = HashSet::new();
    let mut addresses = get_if_addrs()
        .map_err(|_| "无法枚举当前网络接口".to_string())?
        .into_iter()
        .filter_map(|interface| {
            #[cfg(windows)]
            let display_name = windows_interface_display_name(&interface.name, &windows_adapters)?;
            #[cfg(not(windows))]
            let display_name = (!excluded_interface(&interface.name))
                .then(|| friendly_interface_name(&interface.name))?;

            let IfAddr::V4(address) = interface.addr else {
                return None;
            };
            let ip = address.ip;
            if !ip.is_private() || ip.is_loopback() || ip.is_link_local() || !seen.insert(ip) {
                return None;
            }
            Some(KimiLanAddress {
                name: display_name,
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

#[cfg(any(windows, test))]
#[derive(Debug, Clone)]
struct WindowsAdapterMetadata {
    friendly_name: String,
    description: String,
    is_up: bool,
    is_virtual_kind: bool,
    has_gateway: bool,
}

#[cfg(windows)]
fn windows_interface_display_name(
    adapter_name: &str,
    adapters: &HashMap<String, WindowsAdapterMetadata>,
) -> Option<String> {
    let metadata = adapters.get(&normalize_windows_adapter_name(adapter_name))?;
    if !windows_adapter_is_eligible(adapter_name, metadata) {
        return None;
    }
    Some(if metadata.friendly_name.trim().is_empty() {
        adapter_name.trim().to_string()
    } else {
        metadata.friendly_name.trim().to_string()
    })
}

#[cfg(any(windows, test))]
fn windows_adapter_is_eligible(adapter_name: &str, metadata: &WindowsAdapterMetadata) -> bool {
    if !metadata.is_up || metadata.is_virtual_kind {
        return false;
    }

    let strong_tunnel_marker = [
        "docker",
        "vbox",
        "virtualbox",
        "vmnet",
        "vmware",
        "wsl",
        "default switch",
        "container",
        "vpn",
        "tailscale",
        "wireguard",
        "zerotier",
        "wintun",
        "tap-windows",
        "loopback",
    ];
    let identity = format!(
        "{} {} {}",
        adapter_name, metadata.friendly_name, metadata.description
    )
    .to_ascii_lowercase();
    if strong_tunnel_marker
        .iter()
        .any(|marker| identity.contains(marker))
    {
        return false;
    }

    // Hyper-V external switches can own the host's real LAN address and gateway,
    // while WSL/default/internal switches normally have no gateway. Preserve the
    // former and apply the conservative virtual-interface name filter to the latter.
    metadata.has_gateway
        || ![adapter_name, &metadata.friendly_name, &metadata.description]
            .iter()
            .any(|name| excluded_interface(name))
}

#[cfg(windows)]
fn normalize_windows_adapter_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

#[cfg(windows)]
fn windows_adapter_metadata() -> Result<HashMap<String, WindowsAdapterMetadata>, String> {
    use std::mem::MaybeUninit;

    use windows::Win32::{
        Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_NO_DATA, NO_ERROR},
        NetworkManagement::{
            IpHelper::{
                GetAdaptersAddresses, GAA_FLAG_INCLUDE_GATEWAYS, GAA_FLAG_SKIP_ANYCAST,
                GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST, IF_TYPE_ATM_VIRTUAL,
                IF_TYPE_MPLS_TUNNEL, IF_TYPE_PPP, IF_TYPE_PROP_VIRTUAL, IF_TYPE_SOFTWARE_LOOPBACK,
                IF_TYPE_TUNNEL, IP_ADAPTER_ADDRESSES_LH,
            },
            Ndis::IfOperStatusUp,
        },
        Networking::WinSock::AF_INET,
    };

    let flags = GAA_FLAG_INCLUDE_GATEWAYS
        | GAA_FLAG_SKIP_ANYCAST
        | GAA_FLAG_SKIP_MULTICAST
        | GAA_FLAG_SKIP_DNS_SERVER;
    let mut byte_len = 0u32;
    let first_result =
        unsafe { GetAdaptersAddresses(AF_INET.0 as u32, flags, None, None, &mut byte_len) };
    if first_result == ERROR_NO_DATA.0 {
        return Ok(HashMap::new());
    }
    if first_result != ERROR_BUFFER_OVERFLOW.0 || byte_len == 0 {
        return Err("无法读取 Windows 网络接口元数据".to_string());
    }

    for _ in 0..3 {
        let item_len = (byte_len as usize).div_ceil(size_of::<IP_ADAPTER_ADDRESSES_LH>());
        let mut buffer = Vec::<MaybeUninit<IP_ADAPTER_ADDRESSES_LH>>::with_capacity(item_len);
        buffer.resize_with(item_len, MaybeUninit::uninit);
        let head = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        let result = unsafe {
            GetAdaptersAddresses(AF_INET.0 as u32, flags, None, Some(head), &mut byte_len)
        };
        if result == ERROR_BUFFER_OVERFLOW.0 {
            continue;
        }
        if result == ERROR_NO_DATA.0 {
            return Ok(HashMap::new());
        }
        if result != NO_ERROR.0 {
            return Err("无法读取 Windows 网络接口元数据".to_string());
        }

        let mut adapters = HashMap::new();
        let mut current = head;
        while let Some(adapter) = unsafe { current.as_ref() } {
            let adapter_name = unsafe { adapter.AdapterName.to_string() }.unwrap_or_default();
            if !adapter_name.is_empty() {
                let friendly_name = unsafe { adapter.FriendlyName.to_string() }.unwrap_or_default();
                let description = unsafe { adapter.Description.to_string() }.unwrap_or_default();
                let is_virtual_kind = matches!(
                    adapter.IfType,
                    IF_TYPE_SOFTWARE_LOOPBACK
                        | IF_TYPE_TUNNEL
                        | IF_TYPE_PROP_VIRTUAL
                        | IF_TYPE_ATM_VIRTUAL
                        | IF_TYPE_MPLS_TUNNEL
                        | IF_TYPE_PPP
                );
                adapters.insert(
                    normalize_windows_adapter_name(&adapter_name),
                    WindowsAdapterMetadata {
                        friendly_name,
                        description,
                        is_up: adapter.OperStatus == IfOperStatusUp,
                        is_virtual_kind,
                        has_gateway: !adapter.FirstGatewayAddress.is_null(),
                    },
                );
            }
            current = adapter.Next;
        }
        return Ok(adapters);
    }
    Err("Windows 网络接口在枚举期间持续变化，请稍后重试".to_string())
}

#[cfg(not(windows))]
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
    fn windows_guid_uses_friendly_name_to_exclude_internal_virtual_switch() {
        let metadata = WindowsAdapterMetadata {
            friendly_name: "vEthernet (WSL)".to_string(),
            description: "Hyper-V Virtual Ethernet Adapter".to_string(),
            is_up: true,
            is_virtual_kind: false,
            has_gateway: false,
        };
        assert!(!windows_adapter_is_eligible(
            "{ED780EBA-14A6-47A2-8228-D59A550EBF0C}",
            &metadata
        ));
        let routed_wsl = WindowsAdapterMetadata {
            has_gateway: true,
            ..metadata
        };
        assert!(!windows_adapter_is_eligible(
            "{ROUTED-WSL-GUID}",
            &routed_wsl
        ));
    }

    #[test]
    fn windows_keeps_physical_and_routed_external_switch_adapters() {
        let physical = WindowsAdapterMetadata {
            friendly_name: "Wi-Fi".to_string(),
            description: "Intel(R) Wi-Fi 6 AX201".to_string(),
            is_up: true,
            is_virtual_kind: false,
            has_gateway: true,
        };
        assert!(windows_adapter_is_eligible("{PHYSICAL-GUID}", &physical));

        let external_switch = WindowsAdapterMetadata {
            friendly_name: "vEthernet (External)".to_string(),
            description: "Hyper-V Virtual Ethernet Adapter".to_string(),
            is_up: true,
            is_virtual_kind: false,
            has_gateway: true,
        };
        assert!(windows_adapter_is_eligible(
            "{EXTERNAL-SWITCH-GUID}",
            &external_switch
        ));

        let routed_vpn = WindowsAdapterMetadata {
            friendly_name: "Contoso VPN".to_string(),
            description: "Virtual private network adapter".to_string(),
            is_up: true,
            is_virtual_kind: false,
            has_gateway: true,
        };
        assert!(!windows_adapter_is_eligible(
            "{ROUTED-VPN-GUID}",
            &routed_vpn
        ));

        let disconnected_wifi = WindowsAdapterMetadata {
            is_up: false,
            ..physical
        };
        assert!(!windows_adapter_is_eligible(
            "{DISCONNECTED-GUID}",
            &disconnected_wifi
        ));
    }

    #[test]
    fn generated_qr_does_not_log_or_persist_the_launch_url() {
        let svg = render_qr_svg("http://192.168.1.8:58627/#token=opaque").unwrap();
        assert!(svg.starts_with("<?xml"));
        assert!(!svg.contains("opaque"));
    }
}
