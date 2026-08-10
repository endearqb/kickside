use tauri::AppHandle;

use crate::{
    settings_store,
    types::{ContextMenuItemView, ContextMenuLabelsInput, ContextMenuStatus},
};

const VERB_KEY_NAME: &str = "KimiWebShell";
const MOVE_TO_WORKSPACE_VERB_KEY_NAME: &str = "MoveToWorkspace";
const IMPORT_DEFAULT_VERB_KEY_NAME: &str = "ImportToDefaultWorkspace";
const IMPORT_PICKER_VERB_KEY_NAME: &str = "ImportWithWorkspacePicker";
#[cfg(target_os = "windows")]
const MULTI_SELECT_MODEL_PLAYER: &str = "Player";
#[cfg(target_os = "windows")]
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
const CASCADING_MENU_KEYSETS: [CascadingMenuKeySet; 2] = [
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
];

#[cfg(target_os = "windows")]
fn quote_executable_path(executable: &str) -> String {
    format!("\"{}\"", executable.replace('"', "\\\""))
}

#[cfg(target_os = "windows")]
fn build_expected_commands(executable: &str) -> ExpectedContextMenuCommands {
    let quoted_exe = quote_executable_path(executable);
    ExpectedContextMenuCommands {
        icon_value: quoted_exe.clone(),
        open_dir_background_command: format!("{quoted_exe} --open-dir -- \"%V\""),
        open_dir_command: format!("{quoted_exe} --open-dir -- \"%1\""),
        open_files_command: format!("{quoted_exe} --open-files -- \"%1\""),
        import_default_command: format!("{quoted_exe} --import-to-default-workspace -- \"%1\""),
        import_picker_command: format!("{quoted_exe} --import-with-workspace-picker -- \"%1\""),
    }
}

#[cfg(target_os = "windows")]
fn delete_key_if_exists(hkcu: &winreg::RegKey, subkey: &str) -> Result<(), String> {
    use std::io::ErrorKind;
    match hkcu.delete_subkey_all(subkey) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to delete `{subkey}`: {error}")),
    }
}

#[cfg(target_os = "windows")]
fn cleanup_owned_keys(hkcu: &winreg::RegKey) -> Result<(), String> {
    for subkey in [
        DIR_BACKGROUND_KEY,
        DIR_KEY,
        FILE_KEY,
        ALL_FILESYSTEM_OBJECTS_KEY,
        DIR_MOVE_TO_WORKSPACE_KEY,
        FILE_MOVE_TO_WORKSPACE_KEY,
        ALL_FILESYSTEM_OBJECTS_MOVE_TO_WORKSPACE_KEY,
    ] {
        delete_key_if_exists(hkcu, subkey)?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn notify_shell_association_changed() {
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
}

fn load_context_menu_labels(app: &AppHandle) -> ContextMenuLabelsInput {
    settings_store::load_or_default(app)
        .map(|settings| settings.context_menu_labels)
        .unwrap_or_default()
}

fn status_view(
    app: &AppHandle,
    supported: bool,
    enabled: bool,
    message: Option<String>,
) -> ContextMenuStatus {
    let labels = load_context_menu_labels(app);
    let items = context_menu_item_views(&labels).unwrap_or_default();
    ContextMenuStatus {
        supported,
        enabled,
        message,
        labels,
        items,
    }
}

#[cfg(target_os = "windows")]
fn context_menu_item_views(
    labels: &ContextMenuLabelsInput,
) -> Result<Vec<ContextMenuItemView>, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("failed to resolve executable path: {error}"))?;
    let executable = executable.to_string_lossy();
    let expected = build_expected_commands(executable.as_ref());
    Ok(vec![
        item_view(
            "dir_background_open",
            "openDirBackground",
            &labels.open_dir_background,
            "目录空白处",
            DIR_BACKGROUND_KEY,
            &expected.open_dir_background_command,
        ),
        item_view(
            "dir_open",
            "openDir",
            &labels.open_dir,
            "文件夹",
            DIR_KEY,
            &expected.open_dir_command,
        ),
        item_view(
            "file_open",
            "openFile",
            &labels.open_file,
            "文件",
            FILE_KEY,
            &expected.open_files_command,
        ),
        item_view(
            "dir_move_parent",
            "moveToWorkspace",
            &labels.move_to_workspace,
            "文件夹父菜单",
            DIR_MOVE_TO_WORKSPACE_KEY,
            "",
        ),
        item_view(
            "dir_import_default",
            "importToDefaultWorkspace",
            &labels.import_to_default_workspace,
            "文件夹子菜单",
            DIR_IMPORT_DEFAULT_KEY,
            &expected.import_default_command,
        ),
        item_view(
            "dir_import_picker",
            "importWithWorkspacePicker",
            &labels.import_with_workspace_picker,
            "文件夹子菜单",
            DIR_IMPORT_PICKER_KEY,
            &expected.import_picker_command,
        ),
        item_view(
            "file_move_parent",
            "moveToWorkspace",
            &labels.move_to_workspace,
            "文件父菜单",
            FILE_MOVE_TO_WORKSPACE_KEY,
            "",
        ),
        item_view(
            "file_import_default",
            "importToDefaultWorkspace",
            &labels.import_to_default_workspace,
            "文件子菜单",
            FILE_IMPORT_DEFAULT_KEY,
            &expected.import_default_command,
        ),
        item_view(
            "file_import_picker",
            "importWithWorkspacePicker",
            &labels.import_with_workspace_picker,
            "文件子菜单",
            FILE_IMPORT_PICKER_KEY,
            &expected.import_picker_command,
        ),
    ])
}

#[cfg(not(target_os = "windows"))]
fn context_menu_item_views(
    _labels: &ContextMenuLabelsInput,
) -> Result<Vec<ContextMenuItemView>, String> {
    Ok(Vec::new())
}

#[cfg(target_os = "windows")]
fn item_view(
    id: &str,
    label_key: &str,
    label: &str,
    scope: &str,
    registry_key: &str,
    command: &str,
) -> ContextMenuItemView {
    ContextMenuItemView {
        id: id.to_string(),
        label_key: label_key.to_string(),
        label: label.to_string(),
        scope: scope.to_string(),
        registry_key: registry_key.to_string(),
        command: command.to_string(),
    }
}

pub fn save_labels(
    app: &AppHandle,
    input: ContextMenuLabelsInput,
) -> Result<ContextMenuStatus, String> {
    let labels = validate_context_menu_labels(input)?;
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let previous = settings.clone();
    settings.context_menu_labels = labels;
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    if settings.context_menu_desired_enabled {
        if let Err(error) = enable(app) {
            let rollback = settings_store::save(app, &previous)
                .and_then(|_| enable(app).map_err(anyhow::Error::msg));
            return Err(format!(
                "failed to apply Explorer menu labels: {error}{}",
                rollback
                    .err()
                    .map(|value| format!("; rollback failed: {value:#}"))
                    .unwrap_or_default()
            ));
        }
    }
    Ok(status(app))
}

fn validate_context_menu_labels(
    labels: ContextMenuLabelsInput,
) -> Result<ContextMenuLabelsInput, String> {
    fn clean(value: String, label: &str) -> Result<String, String> {
        let value = value.trim().to_string();
        if value.is_empty() {
            return Err(format!("{label} cannot be empty."));
        }
        if value.chars().count() > 80 {
            return Err(format!("{label} must be 80 characters or fewer."));
        }
        if value.chars().any(|ch| ch.is_control()) {
            return Err(format!(
                "{label} cannot contain line breaks or control characters."
            ));
        }
        Ok(value)
    }

    Ok(ContextMenuLabelsInput {
        open_dir_background: clean(labels.open_dir_background, "Directory background label")?,
        open_dir: clean(labels.open_dir, "Directory label")?,
        open_file: clean(labels.open_file, "File label")?,
        open_filesystem_object: clean(labels.open_filesystem_object, "Filesystem object label")?,
        move_to_workspace: clean(labels.move_to_workspace, "Move-to-workspace label")?,
        import_to_default_workspace: clean(
            labels.import_to_default_workspace,
            "Import-to-default-workspace label",
        )?,
        import_with_workspace_picker: clean(
            labels.import_with_workspace_picker,
            "Import-with-workspace-picker label",
        )?,
    })
}

#[cfg(target_os = "windows")]
fn command_matches_expected(actual: &str, expected: &str) -> bool {
    actual.trim() == expected.trim()
}

#[cfg(target_os = "windows")]
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
        match inspect_windows_context_menu_state(_app) {
            Ok(report) => report,
            Err(error) => status_view(
                _app,
                true,
                false,
                Some(format!(
                    "无法读取 Explorer 右键菜单状态，请点击“启用”重写配置。详情：{error}"
                )),
            ),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        status_view(
            _app,
            false,
            false,
            Some("Explorer context menu integration is only supported on Windows.".into()),
        )
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
        let labels = load_context_menu_labels(_app);
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);

        let result = (|| {
            cleanup_owned_keys(&hkcu)?;
            write_simple_verb(
                &hkcu,
                DIR_BACKGROUND_KEY,
                DIR_BACKGROUND_COMMAND_KEY,
                &labels.open_dir_background,
                &expected.icon_value,
                None,
                &expected.open_dir_background_command,
            )?;
            write_simple_verb(
                &hkcu,
                DIR_KEY,
                DIR_COMMAND_KEY,
                &labels.open_dir,
                &expected.icon_value,
                None,
                &expected.open_dir_command,
            )?;
            write_simple_verb(
                &hkcu,
                FILE_KEY,
                FILE_COMMAND_KEY,
                &labels.open_file,
                &expected.icon_value,
                Some(MULTI_SELECT_MODEL_PLAYER),
                &expected.open_files_command,
            )?;
            for keyset in CASCADING_MENU_KEYSETS {
                write_cascading_menu(&hkcu, keyset, &expected, &labels)?;
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = cleanup_owned_keys(&hkcu);
        }
        notify_shell_association_changed();
        result
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("context menu integration is only supported on Windows".to_string())
    }
}

pub fn disable(_app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let result = cleanup_owned_keys(&hkcu);
        notify_shell_association_changed();
        result
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("context menu integration is only supported on Windows".to_string())
    }
}

#[cfg(target_os = "windows")]
fn inspect_windows_context_menu_state(app: &AppHandle) -> Result<ContextMenuStatus, String> {
    use std::env;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    let executable = env::current_exe()
        .map_err(|error| format!("failed to resolve executable path: {error}"))?;
    let executable = executable.to_string_lossy();
    let expected = build_expected_commands(executable.as_ref());
    let labels = load_context_menu_labels(app);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let required_keys = [
        DIR_BACKGROUND_KEY,
        DIR_BACKGROUND_COMMAND_KEY,
        DIR_KEY,
        DIR_COMMAND_KEY,
        FILE_KEY,
        FILE_COMMAND_KEY,
    ];
    validate_required_keys(&hkcu, &required_keys, "右键入口")?;

    let verb_checks = [
        (DIR_BACKGROUND_KEY, labels.open_dir_background.as_str()),
        (DIR_KEY, labels.open_dir.as_str()),
        (FILE_KEY, labels.open_file.as_str()),
    ];
    validate_mui_verbs(&hkcu, &verb_checks, "右键入口")?;

    let command_checks = [
        (
            DIR_BACKGROUND_COMMAND_KEY,
            expected.open_dir_background_command.as_str(),
        ),
        (DIR_COMMAND_KEY, expected.open_dir_command.as_str()),
        (FILE_COMMAND_KEY, expected.open_files_command.as_str()),
    ];
    validate_commands(&hkcu, &command_checks, "右键入口")?;
    validate_multi_select_model(&hkcu, FILE_KEY, "文件菜单")?;

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
                (keyset.parent_key, labels.move_to_workspace.as_str()),
                (
                    keyset.import_default_key,
                    labels.import_to_default_workspace.as_str(),
                ),
                (
                    keyset.import_picker_key,
                    labels.import_with_workspace_picker.as_str(),
                ),
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

    Ok(status_view(app, true, true, None))
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
    labels: &ContextMenuLabelsInput,
) -> Result<(), String> {
    let (parent_key, _) = hkcu
        .create_subkey(keyset.parent_key)
        .map_err(|error| format!("failed to create `{}`: {error}", keyset.parent_key))?;
    parent_key
        .set_value("MUIVerb", &labels.move_to_workspace)
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
        &labels.import_to_default_workspace,
        &expected.icon_value,
        Some(MULTI_SELECT_MODEL_PLAYER),
        &expected.import_default_command,
    )?;
    write_simple_verb(
        hkcu,
        keyset.import_picker_key,
        keyset.import_picker_command_key,
        &labels.import_with_workspace_picker,
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

    #[cfg(target_os = "windows")]
    #[test]
    fn build_expected_commands_handles_space_path() {
        let commands = build_expected_commands(r"C:\Program Files\Kimi Shell\kimi-shell.exe");
        assert_eq!(
            commands.open_files_command,
            "\"C:\\Program Files\\Kimi Shell\\kimi-shell.exe\" --open-files -- \"%1\""
        );
        assert_eq!(
            commands.open_dir_background_command,
            "\"C:\\Program Files\\Kimi Shell\\kimi-shell.exe\" --open-dir -- \"%V\""
        );
        assert_eq!(
            commands.import_default_command,
            "\"C:\\Program Files\\Kimi Shell\\kimi-shell.exe\" --import-to-default-workspace -- \"%1\""
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn build_expected_commands_escapes_quotes() {
        let commands = build_expected_commands(r#"C:\Kimi"Quoted"\kimi-shell.exe"#);
        assert_eq!(
            commands.icon_value,
            "\"C:\\Kimi\\\"Quoted\\\"\\kimi-shell.exe\""
        );
    }

    #[cfg(target_os = "windows")]
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

    #[test]
    fn validate_context_menu_labels_trims_and_rejects_invalid_values() {
        let labels = validate_context_menu_labels(ContextMenuLabelsInput {
            open_dir: "  在 Kimi 中打开  ".to_string(),
            ..ContextMenuLabelsInput::default()
        })
        .expect("valid labels");
        assert_eq!(labels.open_dir, "在 Kimi 中打开");

        assert!(validate_context_menu_labels(ContextMenuLabelsInput {
            open_file: " ".to_string(),
            ..ContextMenuLabelsInput::default()
        })
        .is_err());
        assert!(validate_context_menu_labels(ContextMenuLabelsInput {
            open_file: "bad\nlabel".to_string(),
            ..ContextMenuLabelsInput::default()
        })
        .is_err());
        assert!(validate_context_menu_labels(ContextMenuLabelsInput {
            open_file: "x".repeat(81),
            ..ContextMenuLabelsInput::default()
        })
        .is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn context_menu_item_views_include_custom_labels() {
        let labels = ContextMenuLabelsInput {
            open_dir: "打开目录".to_string(),
            move_to_workspace: "移动项目".to_string(),
            ..ContextMenuLabelsInput::default()
        };
        let items = context_menu_item_views(&labels).expect("item views");
        assert!(items
            .iter()
            .any(|item| item.label_key == "openDir" && item.label == "打开目录"));
        assert!(items
            .iter()
            .any(|item| item.label_key == "moveToWorkspace" && item.label == "移动项目"));
    }
}
