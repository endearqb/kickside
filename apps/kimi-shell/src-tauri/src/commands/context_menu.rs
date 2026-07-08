use tauri::AppHandle;

use crate::{
    context_menu,
    types::{ContextMenuLabelsInput, ContextMenuStatus},
};

#[tauri::command]
pub(crate) fn get_context_menu_status(app: AppHandle) -> ContextMenuStatus {
    context_menu::status(&app)
}

#[tauri::command]
pub(crate) fn enable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    context_menu::enable(&app)?;
    Ok(context_menu::status(&app))
}

#[tauri::command]
pub(crate) fn disable_context_menu(app: AppHandle) -> Result<ContextMenuStatus, String> {
    context_menu::disable(&app)?;
    Ok(context_menu::status(&app))
}

#[tauri::command]
pub(crate) fn save_context_menu_labels(
    app: AppHandle,
    input: ContextMenuLabelsInput,
) -> Result<ContextMenuStatus, String> {
    context_menu::save_labels(&app, input)
}
