use tauri::AppHandle;

use crate::types::ContextMenuStatus;

const VERB_KEY_NAME: &str = "KimiWebShell";
const MOVE_TO_WORKSPACE_VERB_KEY_NAME: &str = "MoveToWorkspace";
const IMPORT_DEFAULT_VERB_KEY_NAME: &str = "ImportToDefaultWorkspace";
const IMPORT_PICKER_VERB_KEY_NAME: &str = "ImportWithWorkspacePicker";

const DIR_BACKGROUND_MUIVERB: &str = "Open Kimi Web Shell here";
const DIR_MUIVERB: &str = "Open in Kimi Web Shell";
const FILE_MUIVERB: &str = "Open in Kimi Web Shell (Copy to Workspace)";
const ALL_FILESYSTEM_OBJECTS_MUIVERB: &str = "Open in Kimi Web Shell";

const MOVE_TO_WORKSPACE_MUIVERB: &str = "移动到工作区";
const IMPORT_DEFAULT_MUIVERB: &str = "导入到默认工作区";
const IMPORT_PICKER_MUIVERB: &str = "选择其他工作区";
const MULTI_SELECT_MODEL_PLAYER: &str = "Player";
const EMPTY_SUBCOMMANDS_VALUE: &str = "";

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

#[cfg(target_os = "windows")]
const DIR_MOVE_TO_WORKSPACE_KEY: &str = "Software\\Classes\\Directory\\shell\\MoveToWorkspace";
#[cfg(target_os = "windows")]
const DIR_MOVE_TO_WORKSPACE_SHELL_KEY: &str =
    "Software\\Classes\\Directory\\shell\\MoveToWorkspace\\shell";
#[cfg(target_os = "windows")]
const DIR_IMPORT_DEFAULT_KEY: &str =
    "Software\\Classes\\Directory\\shell\\MoveToWorkspace\\shell\\ImportToDefaultWorkspace";
#[cfg(target_os = "windows")]
const DIR_IMPORT_DEFAULT_COMMAND_KEY: &str =
    "Software\\Classes\\Directory\\shell\\MoveToWorkspace\\shell\\ImportToDefaultWorkspace\\command";
#[cfg(target_os = "windows")]
const DIR_IMPORT_PICKER_KEY: &str =
    "Software\\Classes\\Directory\\shell\\MoveToWorkspace\\shell\\ImportWithWorkspacePicker";
#[cfg(target_os = "windows")]
const DIR_IMPORT_PICKER_COMMAND_KEY: &str =
    "Software\\Classes\\Directory\\shell\\MoveToWorkspace\\shell\\ImportWithWorkspacePicker\\command";

#[cfg(target_os = "windows")]
const FILE_MOVE_TO_WORKSPACE_KEY: &str = "Software\\Classes\\*\\shell\\MoveToWorkspace";
#[cfg(target_os = "windows")]
const FILE_MOVE_TO_WORKSPACE_SHELL_KEY: &str =
    "Software\\Classes\\*\\shell\\MoveToWorkspace\\shell";
#[cfg(target_os = "windows")]
const FILE_IMPORT_DEFAULT_KEY: &str =
    "Software\\Classes\\*\\shell\\MoveToWorkspace\\shell\\ImportToDefaultWorkspace";
#[cfg(target_os = "windows")]
const FILE_IMPORT_DEFAULT_COMMAND_KEY: &str =
    "Software\\Classes\\*\\shell\\MoveToWorkspace\\shell\\ImportToDefaultWorkspace\\command";
#[cfg(target_os = "windows")]
const FILE_IMPORT_PICKER_KEY: &str =
    "Software\\Classes\\*\\shell\\MoveToWorkspace\\shell\\ImportWithWorkspacePicker";
#[cfg(target_os = "windows")]
const FILE_IMPORT_PICKER_COMMAND_KEY: &str =
    "Software\\Classes\\*\\shell\\MoveToWorkspace\\shell\\ImportWithWorkspacePicker\\command";

#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_MOVE_TO_WORKSPACE_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\MoveToWorkspace";
#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_MOVE_TO_WORKSPACE_SHELL_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\MoveToWorkspace\\shell";
#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_IMPORT_DEFAULT_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\MoveToWorkspace\\shell\\ImportToDefaultWorkspace";
#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_IMPORT_DEFAULT_COMMAND_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\MoveToWorkspace\\shell\\ImportToDefaultWorkspace\\command";
#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_IMPORT_PICKER_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\MoveToWorkspace\\shell\\ImportWithWorkspacePicker";
#[cfg(target_os = "windows")]
const ALL_FILESYSTEM_OBJECTS_IMPORT_PICKER_COMMAND_KEY: &str =
    "Software\\Classes\\AllFilesystemObjects\\shell\\MoveToWorkspace\\shell\\ImportWithWorkspacePicker\\command";

#[derive(Debug, Clone)]
struct ExpectedContextMenuCommands {
    icon_value: String,
    open_dir_background_command: String,
    open_dir_command: String,
    open_files_command: String,
    import_default_command: String,
    import_picker_command: String,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
struct CascadingMenuKeySet {
    parent_key: &'static str,
    shell_key: &'static str,
    import_default_key: &'static str,
    import_default_command_key: &'static str,
    import_picker_key: &'static str,
    import_picker_command_key: &'static str,
}

#[cfg(target_os = "windows")]
const CASCADING_MENU_KEYSETS: [CascadingMenuKeySet; 3] = [
    CascadingMenuKeySet {
        parent_key: DIR_MOVE_TO_WORKSPACE_KEY,
        shell_key: DIR_MOVE_TO_WORKSPACE_SHELL_KEY,
        import_default_key: DIR_IMPORT_DEFAULT_KEY,
        import_default_command_key: DIR_IMPORT_DEFAULT_COMMAND_KEY,
        import_picker_key: DIR_IMPORT_PICKER_KEY,
        import_picker_command_key: DIR_IMPORT_PICKER_COMMAND_KEY,
    },
    CascadingMenuKeySet {
        parent_key: FILE_MOVE_TO_WORKSPACE_KEY,
        shell_key: FILE_MOVE_TO_WORKSPACE_SHELL_KEY,
        import_default_key: FILE_IMPORT_DEFAULT_KEY,
        import_default_command_key: FILE_IMPORT_DEFAULT_COMMAND_KEY,
        import_picker_key: FILE_IMPORT_PICKER_KEY,
        import_picker_command_key: FILE_IMPORT_PICKER_COMMAND_KEY,
    },
    CascadingMenuKeySet {
        parent_key: ALL_FILESYSTEM_OBJECTS_MOVE_TO_WORKSPACE_KEY,
        shell_key: ALL_FILESYSTEM_OBJECTS_MOVE_TO_WORKSPACE_SHELL_KEY,
        import_default_key: ALL_FILESYSTEM_OBJECTS_IMPORT_DEFAULT_KEY,
        import_default_command_key: ALL_FILESYSTEM_OBJECTS_IMPORT_DEFAULT_COMMAND_KEY,
        import_picker_key: ALL_FILESYSTEM_OBJECTS_IMPORT_PICKER_KEY,
        import_picker_command_key: ALL_FILESYSTEM_OBJECTS_IMPORT_PICKER_COMMAND_KEY,
    },
];

fn quote_executable_path(executable: &str) -> String {
    format!("\"{}\"", executable.replace('"', "\\\""))
}

fn build_expected_commands(executable: &str) -> ExpectedContextMenuCommands {
    let quoted_exe = quote_executable_path(executable);
    ExpectedContextMenuCommands {
        icon_value: quoted_exe.clone(),
        open_dir_background_command: format!("{quoted_exe} --open-dir \"%V\""),
        open_dir_command: format!("{quoted_exe} --open-dir \"%1\""),
        open_files_command: format!("{quoted_exe} --open-files \"%1\""),
        import_default_command: format!("{quoted_exe} --import-to-default-workspace \"%1\""),
        import_picker_command: format!("{quoted_exe} --import-with-workspace-picker \"%1\""),
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

        write_simple_verb(
            &hkcu,
            DIR_BACKGROUND_KEY,
            DIR_BACKGROUND_COMMAND_KEY,
            DIR_BACKGROUND_MUIVERB,
            &expected.icon_value,
            None,
            &expected.open_dir_background_command,
        )?;
        write_simple_verb(
            &hkcu,
            DIR_KEY,
            DIR_COMMAND_KEY,
            DIR_MUIVERB,
            &expected.icon_value,
            None,
            &expected.open_dir_command,
        )?;
        write_simple_verb(
            &hkcu,
            FILE_KEY,
            FILE_COMMAND_KEY,
            FILE_MUIVERB,
            &expected.icon_value,
            Some(MULTI_SELECT_MODEL_PLAYER),
            &expected.open_files_command,
        )?;
        write_simple_verb(
            &hkcu,
            ALL_FILESYSTEM_OBJECTS_KEY,
            ALL_FILESYSTEM_OBJECTS_COMMAND_KEY,
            ALL_FILESYSTEM_OBJECTS_MUIVERB,
            &expected.icon_value,
            Some(MULTI_SELECT_MODEL_PLAYER),
            &expected.open_files_command,
        )?;

        for keyset in CASCADING_MENU_KEYSETS {
            write_cascading_menu(&hkcu, keyset, &expected)?;
        }

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
        for subkey in [
            DIR_BACKGROUND_KEY,
            DIR_KEY,
            FILE_KEY,
            ALL_FILESYSTEM_OBJECTS_KEY,
            DIR_MOVE_TO_WORKSPACE_KEY,
            FILE_MOVE_TO_WORKSPACE_KEY,
            ALL_FILESYSTEM_OBJECTS_MOVE_TO_WORKSPACE_KEY,
        ] {
            delete_key_if_exists(&hkcu, subkey)?;
        }
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

    let legacy_required_keys = [
        DIR_BACKGROUND_KEY,
        DIR_BACKGROUND_COMMAND_KEY,
        DIR_KEY,
        DIR_COMMAND_KEY,
        FILE_KEY,
        FILE_COMMAND_KEY,
        ALL_FILESYSTEM_OBJECTS_KEY,
        ALL_FILESYSTEM_OBJECTS_COMMAND_KEY,
    ];
    validate_required_keys(&hkcu, &legacy_required_keys, "旧入口")?;

    let legacy_verb_checks = [
        (DIR_BACKGROUND_KEY, DIR_BACKGROUND_MUIVERB),
        (DIR_KEY, DIR_MUIVERB),
        (FILE_KEY, FILE_MUIVERB),
        (ALL_FILESYSTEM_OBJECTS_KEY, ALL_FILESYSTEM_OBJECTS_MUIVERB),
    ];
    validate_mui_verbs(&hkcu, &legacy_verb_checks, "旧入口")?;

    let legacy_command_checks = [
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
    validate_commands(&hkcu, &legacy_command_checks, "旧入口")?;
    validate_multi_select_model(&hkcu, FILE_KEY, "旧入口文件菜单")?;
    validate_multi_select_model(&hkcu, ALL_FILESYSTEM_OBJECTS_KEY, "旧入口文件系统对象菜单")?;

    for keyset in CASCADING_MENU_KEYSETS {
        validate_required_keys(
            &hkcu,
            &[
                keyset.parent_key,
                keyset.shell_key,
                keyset.import_default_key,
                keyset.import_default_command_key,
                keyset.import_picker_key,
                keyset.import_picker_command_key,
            ],
            "移动到工作区子菜单",
        )?;
        validate_mui_verbs(
            &hkcu,
            &[
                (keyset.parent_key, MOVE_TO_WORKSPACE_MUIVERB),
                (keyset.import_default_key, IMPORT_DEFAULT_MUIVERB),
                (keyset.import_picker_key, IMPORT_PICKER_MUIVERB),
            ],
            "移动到工作区子菜单",
        )?;
        validate_icon_value(
            &hkcu,
            keyset.parent_key,
            &expected.icon_value,
            "移动到工作区父菜单",
        )?;
        validate_icon_value(
            &hkcu,
            keyset.import_default_key,
            &expected.icon_value,
            "移动到工作区默认子项",
        )?;
        validate_icon_value(
            &hkcu,
            keyset.import_picker_key,
            &expected.icon_value,
            "移动到工作区选择器子项",
        )?;
        validate_commands(
            &hkcu,
            &[
                (
                    keyset.import_default_command_key,
                    expected.import_default_command.as_str(),
                ),
                (
                    keyset.import_picker_command_key,
                    expected.import_picker_command.as_str(),
                ),
            ],
            "移动到工作区子菜单",
        )?;
        validate_multi_select_model(&hkcu, keyset.parent_key, "移动到工作区父菜单")?;
        validate_subcommands_value(&hkcu, keyset.parent_key, "移动到工作区父菜单")?;
        validate_multi_select_model(&hkcu, keyset.import_default_key, "移动到工作区默认子项")?;
        validate_multi_select_model(&hkcu, keyset.import_picker_key, "移动到工作区选择器子项")?;
    }

    Ok(ContextMenuStatus {
        supported: true,
        enabled: true,
        message: None,
    })
}

#[cfg(target_os = "windows")]
fn write_simple_verb(
    hkcu: &winreg::RegKey,
    key_path: &str,
    command_key_path: &str,
    menu_label: &str,
    icon_value: &str,
    multi_select_model: Option<&str>,
    command_value: &str,
) -> Result<(), String> {
    let (menu_key, _) = hkcu
        .create_subkey(key_path)
        .map_err(|error| format!("failed to create `{key_path}`: {error}"))?;
    menu_key
        .set_value("MUIVerb", &menu_label)
        .map_err(|error| format!("failed to write MUIVerb for `{key_path}`: {error}"))?;
    menu_key
        .set_value("Icon", &icon_value)
        .map_err(|error| format!("failed to write Icon for `{key_path}`: {error}"))?;
    if let Some(value) = multi_select_model {
        menu_key
            .set_value("MultiSelectModel", &value)
            .map_err(|error| {
                format!("failed to write MultiSelectModel for `{key_path}`: {error}")
            })?;
    }

    let (command_key, _) = hkcu
        .create_subkey(command_key_path)
        .map_err(|error| format!("failed to create `{command_key_path}`: {error}"))?;
    command_key
        .set_value("", &command_value)
        .map_err(|error| format!("failed to write command for `{command_key_path}`: {error}"))?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn write_cascading_menu(
    hkcu: &winreg::RegKey,
    keyset: CascadingMenuKeySet,
    expected: &ExpectedContextMenuCommands,
) -> Result<(), String> {
    let (parent_key, _) = hkcu
        .create_subkey(keyset.parent_key)
        .map_err(|error| format!("failed to create `{}`: {error}", keyset.parent_key))?;
    parent_key
        .set_value("MUIVerb", &MOVE_TO_WORKSPACE_MUIVERB)
        .map_err(|error| {
            format!(
                "failed to write MUIVerb for `{}`: {error}",
                keyset.parent_key
            )
        })?;
    parent_key
        .set_value("Icon", &expected.icon_value)
        .map_err(|error| format!("failed to write Icon for `{}`: {error}", keyset.parent_key))?;
    parent_key
        .set_value("MultiSelectModel", &MULTI_SELECT_MODEL_PLAYER)
        .map_err(|error| {
            format!(
                "failed to write MultiSelectModel for `{}`: {error}",
                keyset.parent_key
            )
        })?;
    parent_key
        .set_value("SubCommands", &EMPTY_SUBCOMMANDS_VALUE)
        .map_err(|error| {
            format!(
                "failed to write SubCommands for `{}`: {error}",
                keyset.parent_key
            )
        })?;

    hkcu.create_subkey(keyset.shell_key)
        .map_err(|error| format!("failed to create `{}`: {error}", keyset.shell_key))?;

    write_simple_verb(
        hkcu,
        keyset.import_default_key,
        keyset.import_default_command_key,
        IMPORT_DEFAULT_MUIVERB,
        &expected.icon_value,
        Some(MULTI_SELECT_MODEL_PLAYER),
        &expected.import_default_command,
    )?;
    write_simple_verb(
        hkcu,
        keyset.import_picker_key,
        keyset.import_picker_command_key,
        IMPORT_PICKER_MUIVERB,
        &expected.icon_value,
        Some(MULTI_SELECT_MODEL_PLAYER),
        &expected.import_picker_command,
    )?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn validate_required_keys(hkcu: &winreg::RegKey, keys: &[&str], area: &str) -> Result<(), String> {
    let missing_keys: Vec<&str> = keys
        .iter()
        .copied()
        .filter(|key| hkcu.open_subkey(*key).is_err())
        .collect();
    if missing_keys.is_empty() {
        return Ok(());
    }

    Err(format!(
        "{area}需修复：缺少注册表键 {}。可点击“启用”重新写入。",
        missing_keys.join(", ")
    ))
}

#[cfg(target_os = "windows")]
fn validate_mui_verbs(
    hkcu: &winreg::RegKey,
    checks: &[(&str, &str)],
    area: &str,
) -> Result<(), String> {
    for (menu_key, expected_verb) in checks {
        let key = hkcu
            .open_subkey(menu_key)
            .map_err(|error| format!("failed to open `{menu_key}`: {error}"))?;
        let actual_verb: String = key
            .get_value("MUIVerb")
            .map_err(|error| format!("failed to read MUIVerb of `{menu_key}`: {error}"))?;
        if !command_matches_expected(&actual_verb, expected_verb) {
            let actual = truncate_for_status_message(&actual_verb, 80);
            let expected = truncate_for_status_message(expected_verb, 80);
            return Err(format!(
                "{area}需修复：MUIVerb 漂移 `{menu_key}`（当前={actual}; 预期={expected}）。可点击“启用”重新写入。"
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn validate_icon_value(
    hkcu: &winreg::RegKey,
    key_path: &str,
    expected_value: &str,
    area: &str,
) -> Result<(), String> {
    let key = hkcu
        .open_subkey(key_path)
        .map_err(|error| format!("failed to open `{key_path}`: {error}"))?;
    let actual_value: String = key
        .get_value("Icon")
        .map_err(|error| format!("failed to read Icon of `{key_path}`: {error}"))?;
    if command_matches_expected(&actual_value, expected_value) {
        return Ok(());
    }

    let actual = truncate_for_status_message(&actual_value, 120);
    let expected = truncate_for_status_message(expected_value, 120);
    Err(format!(
        "{area}需修复：Icon 漂移 `{key_path}`（当前={actual}; 预期={expected}）。可点击“启用”重新写入。"
    ))
}

#[cfg(target_os = "windows")]
fn validate_commands(
    hkcu: &winreg::RegKey,
    checks: &[(&str, &str)],
    area: &str,
) -> Result<(), String> {
    for (command_key, expected_value) in checks {
        let key = hkcu
            .open_subkey(command_key)
            .map_err(|error| format!("failed to open `{command_key}`: {error}"))?;
        let actual_value: String = key
            .get_value("")
            .map_err(|error| format!("failed to read default value of `{command_key}`: {error}"))?;
        if !command_matches_expected(&actual_value, expected_value) {
            let actual = truncate_for_status_message(&actual_value, 120);
            let expected = truncate_for_status_message(expected_value, 120);
            return Err(format!(
                "{area}需修复：命令值漂移 `{command_key}`（当前={actual}; 预期={expected}）。可点击“启用”重新写入。"
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn validate_multi_select_model(
    hkcu: &winreg::RegKey,
    key_path: &str,
    area: &str,
) -> Result<(), String> {
    let key = hkcu
        .open_subkey(key_path)
        .map_err(|error| format!("failed to open `{key_path}`: {error}"))?;
    let actual_value: String = key
        .get_value("MultiSelectModel")
        .map_err(|error| format!("failed to read MultiSelectModel of `{key_path}`: {error}"))?;
    if command_matches_expected(&actual_value, MULTI_SELECT_MODEL_PLAYER) {
        return Ok(());
    }

    Err(format!(
        "{area}需修复：MultiSelectModel 漂移 `{key_path}`（当前={actual_value}; 预期={MULTI_SELECT_MODEL_PLAYER}）。可点击“启用”重新写入。"
    ))
}

#[cfg(target_os = "windows")]
fn validate_subcommands_value(
    hkcu: &winreg::RegKey,
    key_path: &str,
    area: &str,
) -> Result<(), String> {
    let key = hkcu
        .open_subkey(key_path)
        .map_err(|error| format!("failed to open `{key_path}`: {error}"))?;
    let actual_value: String = key
        .get_value("SubCommands")
        .map_err(|error| format!("failed to read SubCommands of `{key_path}`: {error}"))?;
    if command_matches_expected(&actual_value, EMPTY_SUBCOMMANDS_VALUE) {
        return Ok(());
    }

    Err(format!(
        "{area}需修复：SubCommands 漂移 `{key_path}`（当前={actual_value}; 预期为空字符串）。可点击“启用”重新写入。"
    ))
}

#[allow(dead_code)]
pub fn verb_key_name() -> &'static str {
    VERB_KEY_NAME
}

#[allow(dead_code)]
pub fn move_to_workspace_verb_key_name() -> &'static str {
    MOVE_TO_WORKSPACE_VERB_KEY_NAME
}

#[allow(dead_code)]
pub fn import_default_verb_key_name() -> &'static str {
    IMPORT_DEFAULT_VERB_KEY_NAME
}

#[allow(dead_code)]
pub fn import_picker_verb_key_name() -> &'static str {
    IMPORT_PICKER_VERB_KEY_NAME
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
        assert_eq!(
            commands.import_default_command,
            "\"C:\\Program Files\\Kimi Shell\\kimi-shell.exe\" --import-to-default-workspace \"%1\""
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
