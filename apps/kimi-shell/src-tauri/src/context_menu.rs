use tauri::AppHandle;

use crate::types::ContextMenuStatus;

const VERB_KEY_NAME: &str = "KimiWebShell";

#[cfg(target_os = "windows")]
const DIR_BACKGROUND_KEY: &str = "Software\\Classes\\Directory\\Background\\shell\\KimiWebShell";
#[cfg(target_os = "windows")]
const DIR_BACKGROUND_COMMAND_KEY: &str =
    "Software\\Classes\\Directory\\Background\\shell\\KimiWebShell\\command";
#[cfg(target_os = "windows")]
const DIR_KEY: &str = "Software\\Classes\\Directory\\shell\\KimiWebShell";
#[cfg(target_os = "windows")]
const DIR_COMMAND_KEY: &str = "Software\\Classes\\Directory\\shell\\KimiWebShell\\command";
#[cfg(target_os = "windows")]
const FILE_KEY: &str = "Software\\Classes\\*\\shell\\KimiWebShell";
#[cfg(target_os = "windows")]
const FILE_COMMAND_KEY: &str = "Software\\Classes\\*\\shell\\KimiWebShell\\command";

pub fn status(_app: &AppHandle) -> ContextMenuStatus {
    #[cfg(target_os = "windows")]
    {
        let enabled = all_required_keys_exist();
        return ContextMenuStatus {
            supported: true,
            enabled,
            message: None,
        };
    }

    #[cfg(not(target_os = "windows"))]
    {
        ContextMenuStatus {
            supported: false,
            enabled: false,
            message: Some("Explorer context menu integration is only supported on Windows.".into()),
        }
    }
}

pub fn enable(_app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::env;
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};

        let executable = env::current_exe()
            .map_err(|error| format!("failed to resolve executable path: {error}"))?;
        let executable = executable.to_string_lossy().to_string();
        let quoted_exe = format!("\"{}\"", executable.replace('"', "\\\""));
        let icon_value = quoted_exe.clone();
        let open_dir_background_command = format!("{quoted_exe} --open-dir \"%V\"");
        let open_dir_command = format!("{quoted_exe} --open-dir \"%1\"");
        let open_files_command = format!("{quoted_exe} --open-files \"%1\"");

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let (dir_background_key, _) = hkcu
            .create_subkey(DIR_BACKGROUND_KEY)
            .map_err(|error| format!("failed to create `{DIR_BACKGROUND_KEY}`: {error}"))?;
        dir_background_key
            .set_value("MUIVerb", &"Open Kimi Web Shell here")
            .map_err(|error| {
                format!("failed to write MUIVerb for directory background: {error}")
            })?;
        dir_background_key
            .set_value("Icon", &icon_value)
            .map_err(|error| format!("failed to write Icon for directory background: {error}"))?;

        let (dir_background_command_key, _) = hkcu
            .create_subkey(DIR_BACKGROUND_COMMAND_KEY)
            .map_err(|error| format!("failed to create `{DIR_BACKGROUND_COMMAND_KEY}`: {error}"))?;
        dir_background_command_key
            .set_value("", &open_dir_background_command)
            .map_err(|error| {
                format!("failed to write command for directory background: {error}")
            })?;

        let (dir_key, _) = hkcu
            .create_subkey(DIR_KEY)
            .map_err(|error| format!("failed to create `{DIR_KEY}`: {error}"))?;
        dir_key
            .set_value("MUIVerb", &"Open Kimi Web Shell")
            .map_err(|error| format!("failed to write MUIVerb for directory: {error}"))?;
        dir_key
            .set_value("Icon", &icon_value)
            .map_err(|error| format!("failed to write Icon for directory: {error}"))?;

        let (dir_command_key, _) = hkcu
            .create_subkey(DIR_COMMAND_KEY)
            .map_err(|error| format!("failed to create `{DIR_COMMAND_KEY}`: {error}"))?;
        dir_command_key
            .set_value("", &open_dir_command)
            .map_err(|error| format!("failed to write command for directory: {error}"))?;

        let (file_key, _) = hkcu
            .create_subkey(FILE_KEY)
            .map_err(|error| format!("failed to create `{FILE_KEY}`: {error}"))?;
        file_key
            .set_value("MUIVerb", &"Open in Kimi Web Shell (Copy to Workspace)")
            .map_err(|error| format!("failed to write MUIVerb for files: {error}"))?;
        file_key
            .set_value("Icon", &icon_value)
            .map_err(|error| format!("failed to write Icon for files: {error}"))?;
        file_key
            .set_value("MultiSelectModel", &"Player")
            .map_err(|error| format!("failed to write MultiSelectModel for files: {error}"))?;

        let (file_command_key, _) = hkcu
            .create_subkey(FILE_COMMAND_KEY)
            .map_err(|error| format!("failed to create `{FILE_COMMAND_KEY}`: {error}"))?;
        file_command_key
            .set_value("", &open_files_command)
            .map_err(|error| format!("failed to write command for files: {error}"))?;

        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("context menu integration is only supported on Windows".to_string())
    }
}

pub fn disable(_app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::io::ErrorKind;
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};

        fn delete_key_if_exists(hkcu: &RegKey, subkey: &str) -> Result<(), String> {
            match hkcu.delete_subkey_all(subkey) {
                Ok(_) => Ok(()),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!("failed to delete `{subkey}`: {error}")),
            }
        }

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        delete_key_if_exists(&hkcu, DIR_BACKGROUND_KEY)?;
        delete_key_if_exists(&hkcu, DIR_KEY)?;
        delete_key_if_exists(&hkcu, FILE_KEY)?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("context menu integration is only supported on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn all_required_keys_exist() -> bool {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let keys = [
        DIR_BACKGROUND_KEY,
        DIR_BACKGROUND_COMMAND_KEY,
        DIR_KEY,
        DIR_COMMAND_KEY,
        FILE_KEY,
        FILE_COMMAND_KEY,
    ];

    keys.iter().all(|key| hkcu.open_subkey(key).is_ok())
}

#[allow(dead_code)]
pub fn verb_key_name() -> &'static str {
    VERB_KEY_NAME
}
