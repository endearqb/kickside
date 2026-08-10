use crate::types::{
    KimiInstallMode, PlatformArch, PlatformCapabilities, PlatformOs, ReleaseChannel,
    WindowControlPlacement,
};

#[tauri::command]
pub(crate) fn get_platform_capabilities() -> PlatformCapabilities {
    capabilities_for(compiled_os(), compiled_arch(), compiled_release_channel())
}

fn capabilities_for(
    os: PlatformOs,
    arch: PlatformArch,
    release_channel: ReleaseChannel,
) -> PlatformCapabilities {
    match os {
        PlatformOs::Macos => PlatformCapabilities {
            os,
            arch,
            native_window_controls: true,
            window_control_placement: WindowControlPlacement::LeftNative,
            supports_app_menu: true,
            supports_dock_reopen: true,
            supports_explorer_context_menu: false,
            supports_finder_quick_action: false,
            supports_opened_event: false,
            supports_tray: true,
            hotkey_label: "⌘⇧K".to_string(),
            kimi_install_mode: KimiInstallMode::ExternalGuided,
            release_channel,
        },
        PlatformOs::Windows => PlatformCapabilities {
            os,
            arch,
            native_window_controls: false,
            window_control_placement: WindowControlPlacement::RightCustom,
            supports_app_menu: false,
            supports_dock_reopen: false,
            supports_explorer_context_menu: true,
            supports_finder_quick_action: false,
            supports_opened_event: false,
            supports_tray: true,
            hotkey_label: "Ctrl+Shift+K".to_string(),
            kimi_install_mode: KimiInstallMode::WindowsManaged,
            release_channel,
        },
    }
}

fn compiled_os() -> PlatformOs {
    match std::env::consts::OS {
        "macos" => PlatformOs::Macos,
        "windows" => PlatformOs::Windows,
        unsupported => panic!("unsupported desktop platform: {unsupported}"),
    }
}

fn compiled_arch() -> PlatformArch {
    match std::env::consts::ARCH {
        "aarch64" => PlatformArch::Aarch64,
        "x86_64" => PlatformArch::X86_64,
        unsupported => panic!("unsupported desktop architecture: {unsupported}"),
    }
}

fn compiled_release_channel() -> ReleaseChannel {
    match option_env!("KIMI_RELEASE_CHANNEL") {
        Some("developer_id") => ReleaseChannel::DeveloperId,
        Some("ad_hoc") => ReleaseChannel::AdHoc,
        Some("development") => ReleaseChannel::Development,
        _ if cfg!(debug_assertions) => ReleaseChannel::Development,
        _ => ReleaseChannel::AdHoc,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn macos_capabilities_use_native_window_conventions() {
        let capabilities = capabilities_for(
            PlatformOs::Macos,
            PlatformArch::Aarch64,
            ReleaseChannel::DeveloperId,
        );

        assert!(capabilities.native_window_controls);
        assert!(capabilities.supports_app_menu);
        assert!(capabilities.supports_dock_reopen);
        assert!(!capabilities.supports_explorer_context_menu);
        assert!(!capabilities.supports_opened_event);
        assert_eq!(capabilities.hotkey_label, "⌘⇧K");
        assert_eq!(
            capabilities.window_control_placement,
            WindowControlPlacement::LeftNative
        );
        assert_eq!(
            capabilities.kimi_install_mode,
            KimiInstallMode::ExternalGuided
        );
    }

    #[test]
    fn windows_capabilities_preserve_custom_shell_conventions() {
        let capabilities = capabilities_for(
            PlatformOs::Windows,
            PlatformArch::X86_64,
            ReleaseChannel::AdHoc,
        );

        assert!(!capabilities.native_window_controls);
        assert!(!capabilities.supports_app_menu);
        assert!(capabilities.supports_explorer_context_menu);
        assert_eq!(capabilities.hotkey_label, "Ctrl+Shift+K");
        assert_eq!(
            capabilities.window_control_placement,
            WindowControlPlacement::RightCustom
        );
        assert_eq!(
            capabilities.kimi_install_mode,
            KimiInstallMode::WindowsManaged
        );
    }

    #[test]
    fn capabilities_serialize_to_the_additive_frontend_contract() {
        let capabilities = capabilities_for(
            PlatformOs::Macos,
            PlatformArch::Aarch64,
            ReleaseChannel::AdHoc,
        );
        let value = serde_json::to_value(capabilities).expect("serialize capabilities");

        assert_eq!(value["os"], "macos");
        assert_eq!(value["arch"], "aarch64");
        assert_eq!(value["windowControlPlacement"], "leftNative");
        assert_eq!(value["kimiInstallMode"], "externalGuided");
        assert_eq!(value["releaseChannel"], "adHoc");
        assert_eq!(value["supportsExplorerContextMenu"], false);
    }
}
