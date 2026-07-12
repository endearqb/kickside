use tauri::AppHandle;

use crate::{
    context_menu, settings_store,
    types::{ContextMenuLabelsInput, ContextMenuStatus},
};

#[tauri::command]
pub(crate) fn get_context_menu_status(app: AppHandle) -> ContextMenuStatus {
    context_menu::status(&app)
}

#[tauri::command]
pub(crate) fn enable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    set_context_menu_enabled(&app, true)?;
    Ok(context_menu::status(&app))
}

#[tauri::command]
pub(crate) fn disable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    set_context_menu_enabled(&app, false)?;
    Ok(context_menu::status(&app))
}

fn set_context_menu_enabled(app: &AppHandle, desired: bool) -> Result<(), String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let previous = settings.context_menu_desired_enabled;
    if desired {
        context_menu::enable(app)?;
    } else {
        context_menu::disable(app)?;
    }

    settings.context_menu_desired_enabled = desired;
    if let Err(error) = settings_store::save(app, &settings) {
        let rollback = if previous {
            context_menu::enable(app)
        } else {
            context_menu::disable(app)
        };
        return Err(format!(
            "failed to persist Explorer menu preference: {error}{}",
            rollback
                .err()
                .map(|value| format!("; rollback failed: {value}"))
                .unwrap_or_default()
        ));
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn save_context_menu_labels(
    app: AppHandle,
    input: ContextMenuLabelsInput,
) -> Result<ContextMenuStatus, String> {
    context_menu::save_labels(&app, input)
}
