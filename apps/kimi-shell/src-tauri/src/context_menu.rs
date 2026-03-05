use tauri::AppHandle;

use crate::types::ContextMenuStatus;

const VERB_KEY_NAME: &str = "KimiWebShell";
const DIR_BACKGROUND_MUIVERB: &str = "Open Kimi Web Shell here";
const DIR_MUIVERB: &str = "Open Kimi Web Shell";
const FILE_MUIVERB: &str = "Open in Kimi Web Shell (Copy to Workspace)";

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
#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\KimiWebShell";
#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_COMMAND_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\KimiWebShell\\command";

#[derive(Debug, Clone)]
struct ExpectedContextMenuCommands {
    icon_value: String,
    open_dir_background_command: String,
    open_dir_command: String,
    open_files_command: String,
}

fn quote_executable_path(executable: &str) -> String {
    format!("\"{}\"", executable.replace('"', "\\\""))
}

fn build_expected_commands(executable: &str) -> ExpectedContextMenuCommands {
    let quoted_exe = quote_executable_path(executable);
    ExpectedContextMenuCommands {
        icon_value: quoted_exe.clone(),
        open_dir_background_command: format!("{quoted_exe} --open-dir \"%V\""),
        open_dir_command: format!("{quoted_exe} --open-dir \"%1\""),
        // NOTE: We intentionally keep file command without literal `--` here.
        // Explorer on some systems fails to trigger the file verb reliably when
        // extra separator arguments are present in command templates.
        open_files_command: format!("{quoted_exe} --open-files \"%1\""),
    }
}

fn command_matches_expected(actual: &str, expected: &str) -> bool {
    actual.trim() == expected.trim()
}

fn truncate_for_status_message(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let short: String = value.chars().take(max_chars).collect();
    format!("{short}...")
}

pub fn status(_app: &AppHandle) -> ContextMenuStatus {
    #[cfg(target_os = "windows")]
    {
        return match inspect_windows_context_menu_state() {
            Ok(report) => report,
            Err(error) => ContextMenuStatus {
                supported: true,
                enabled: false,
                message: Some(format!(
                    "无法读取 Explorer 右键菜单状态，请点击“启用”重写配置。详情：{error}"
                )),
            },
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
        let executable = executable.to_string_lossy();
        let expected = build_expected_commands(executable.as_ref());

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        fn write_file_verb(
            hkcu: &RegKey,
            key_path: &str,
            command_key_path: &str,
            expected: &ExpectedContextMenuCommands,
        ) -> Result<(), String> {
            let (file_key, _) = hkcu
                .create_subkey(key_path)
                .map_err(|error| format!("failed to create `{key_path}`: {error}"))?;
            file_key
                .set_value("MUIVerb", &FILE_MUIVERB)
                .map_err(|error| {
                    format!("failed to write MUIVerb for files `{key_path}`: {error}")
                })?;
            file_key
                .set_value("Icon", &expected.icon_value)
                .map_err(|error| format!("failed to write Icon for files `{key_path}`: {error}"))?;
            file_key
                .set_value("MultiSelectModel", &"Player")
                .map_err(|error| {
                    format!("failed to write MultiSelectModel for files `{key_path}`: {error}")
                })?;

            let (file_command_key, _) = hkcu
                .create_subkey(command_key_path)
                .map_err(|error| format!("failed to create `{command_key_path}`: {error}"))?;
            file_command_key
                .set_value("", &expected.open_files_command)
                .map_err(|error| {
                    format!("failed to write command for files `{command_key_path}`: {error}")
                })?;

            Ok(())
        }

        let (dir_background_key, _) = hkcu
            .create_subkey(DIR_BACKGROUND_KEY)
            .map_err(|error| format!("failed to create `{DIR_BACKGROUND_KEY}`: {error}"))?;
        dir_background_key
            .set_value("MUIVerb", &DIR_BACKGROUND_MUIVERB)
            .map_err(|error| {
                format!("failed to write MUIVerb for directory background: {error}")
            })?;
        dir_background_key
            .set_value("Icon", &expected.icon_value)
            .map_err(|error| format!("failed to write Icon for directory background: {error}"))?;

        let (dir_background_command_key, _) = hkcu
            .create_subkey(DIR_BACKGROUND_COMMAND_KEY)
            .map_err(|error| format!("failed to create `{DIR_BACKGROUND_COMMAND_KEY}`: {error}"))?;
        dir_background_command_key
            .set_value("", &expected.open_dir_background_command)
            .map_err(|error| {
                format!("failed to write command for directory background: {error}")
            })?;

        let (dir_key, _) = hkcu
            .create_subkey(DIR_KEY)
            .map_err(|error| format!("failed to create `{DIR_KEY}`: {error}"))?;
        dir_key
            .set_value("MUIVerb", &DIR_MUIVERB)
            .map_err(|error| format!("failed to write MUIVerb for directory: {error}"))?;
        dir_key
            .set_value("Icon", &expected.icon_value)
            .map_err(|error| format!("failed to write Icon for directory: {error}"))?;

        let (dir_command_key, _) = hkcu
            .create_subkey(DIR_COMMAND_KEY)
            .map_err(|error| format!("failed to create `{DIR_COMMAND_KEY}`: {error}"))?;
        dir_command_key
            .set_value("", &expected.open_dir_command)
            .map_err(|error| format!("failed to write command for directory: {error}"))?;

        write_file_verb(&hkcu, FILE_KEY, FILE_COMMAND_KEY, &expected)?;
        write_file_verb(
            &hkcu,
            ALL_FILESYSTEM_OBJECTS_KEY,
            ALL_FILESYSTEM_OBJECTS_COMMAND_KEY,
            &expected,
        )?;

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
        delete_key_if_exists(&hkcu, ALL_FILESYSTEM_OBJECTS_KEY)?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("context menu integration is only supported on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn inspect_windows_context_menu_state() -> Result<ContextMenuStatus, String> {
    use std::env;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let executable = env::current_exe()
        .map_err(|error| format!("failed to resolve executable path: {error}"))?;
    let executable = executable.to_string_lossy();
    let expected = build_expected_commands(executable.as_ref());
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let required_keys = [
        DIR_BACKGROUND_KEY,
        DIR_BACKGROUND_COMMAND_KEY,
        DIR_KEY,
        DIR_COMMAND_KEY,
        FILE_KEY,
        FILE_COMMAND_KEY,
        ALL_FILESYSTEM_OBJECTS_KEY,
        ALL_FILESYSTEM_OBJECTS_COMMAND_KEY,
    ];

    let missing_keys: Vec<&str> = required_keys
        .iter()
        .copied()
        .filter(|key| hkcu.open_subkey(*key).is_err())
        .collect();
    if !missing_keys.is_empty() {
        let missing = missing_keys.join(", ");
        return Ok(ContextMenuStatus {
            supported: true,
            enabled: false,
            message: Some(format!(
                "右键菜单需修复：缺少注册表键 {missing}。可点击“启用”重新写入。"
            )),
        });
    }

    let checks = [
        (
            DIR_BACKGROUND_COMMAND_KEY,
            expected.open_dir_background_command.as_str(),
        ),
        (DIR_COMMAND_KEY, expected.open_dir_command.as_str()),
        (FILE_COMMAND_KEY, expected.open_files_command.as_str()),
        (
            ALL_FILESYSTEM_OBJECTS_COMMAND_KEY,
            expected.open_files_command.as_str(),
        ),
    ];

    for (command_key, expected_value) in checks {
        let key = hkcu
            .open_subkey(command_key)
            .map_err(|error| format!("failed to open `{command_key}`: {error}"))?;
        let actual_value: String = key
            .get_value("")
            .map_err(|error| format!("failed to read default value of `{command_key}`: {error}"))?;
        if !command_matches_expected(&actual_value, &expected_value) {
            let actual = truncate_for_status_message(&actual_value, 120);
            let expected = truncate_for_status_message(expected_value, 120);
            return Ok(ContextMenuStatus {
                supported: true,
                enabled: false,
                message: Some(format!(
                    "右键菜单需修复：命令值漂移 `{command_key}`（当前={actual}; 预期={expected}）。可点击“启用”重新写入。"
                )),
            });
        }
    }

    Ok(ContextMenuStatus {
        supported: true,
        enabled: true,
        message: None,
    })
}

#[allow(dead_code)]
pub fn verb_key_name() -> &'static str {
    VERB_KEY_NAME
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_expected_commands_handles_space_path() {
        let commands = build_expected_commands(r"C:\Program Files\Kimi Shell\kimi-shell.exe");
        assert_eq!(
            commands.open_files_command,
            "\"C:\\Program Files\\Kimi Shell\\kimi-shell.exe\" --open-files \"%1\""
        );
        assert_eq!(
            commands.open_dir_background_command,
            "\"C:\\Program Files\\Kimi Shell\\kimi-shell.exe\" --open-dir \"%V\""
        );
    }

    #[test]
    fn build_expected_commands_escapes_quotes() {
        let commands = build_expected_commands(r#"C:\Kimi"Quoted"\kimi-shell.exe"#);
        assert_eq!(
            commands.icon_value,
            "\"C:\\Kimi\\\"Quoted\\\"\\kimi-shell.exe\""
        );
    }

    #[test]
    fn command_matches_expected_trims_outer_whitespace() {
        assert!(command_matches_expected(
            "  \"C:\\kimi-shell.exe\" --open-dir \"%1\"  ",
            "\"C:\\kimi-shell.exe\" --open-dir \"%1\""
        ));
        assert!(!command_matches_expected(
            "\"C:\\kimi-shell.exe\" --open-files -- \"%1\"",
            "\"C:\\kimi-shell.exe\" --open-files \"%1\""
        ));
    }
}
