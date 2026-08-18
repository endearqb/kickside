#[cfg(target_os = "macos")]
use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::Read,
    os::unix::fs::OpenOptionsExt,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "macos")]
use rand::RngCore;
#[cfg(target_os = "macos")]
use serde::Serialize;
#[cfg(target_os = "macos")]
use tauri::{Emitter, PhysicalPosition, Webview};

#[cfg(target_os = "macos")]
use crate::window_manager::MAIN_WINDOW_LABEL;

#[cfg(target_os = "macos")]
pub const NATIVE_FILE_DROP_EVENT: &str = "native-file-drop";
#[cfg(target_os = "macos")]
const GRANT_TTL: Duration = Duration::from_secs(30);
#[cfg(target_os = "macos")]
const MAX_FILE_COUNT: usize = 8;
#[cfg(target_os = "macos")]
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
#[cfg(target_os = "macos")]
const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;

#[cfg(target_os = "macos")]
struct NativeFileGrant {
    created_at: Instant,
    file: File,
    size: u64,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileGrantMetadata {
    grant_id: String,
    name: String,
    size: u64,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Serialize)]
pub struct NativeFileDropPosition {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFileDropPayload {
    files: Vec<NativeFileGrantMetadata>,
    position: NativeFileDropPosition,
}

#[cfg(target_os = "macos")]
fn grants() -> &'static Mutex<HashMap<String, NativeFileGrant>> {
    static GRANTS: OnceLock<Mutex<HashMap<String, NativeFileGrant>>> = OnceLock::new();
    GRANTS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "macos")]
fn new_grant_id() -> String {
    let mut random = [0_u8; 24];
    rand::thread_rng().fill_bytes(&mut random);
    random.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(target_os = "macos")]
fn purge_expired(grants: &mut HashMap<String, NativeFileGrant>, now: Instant) {
    grants.retain(|_, grant| now.duration_since(grant.created_at) <= GRANT_TTL);
}

#[cfg(target_os = "macos")]
fn schedule_expiry_cleanup() {
    thread::spawn(|| {
        thread::sleep(GRANT_TTL + Duration::from_secs(1));
        if let Ok(mut store) = grants().lock() {
            purge_expired(&mut store, Instant::now());
        }
    });
}

#[cfg(target_os = "macos")]
fn open_regular_file(path: &PathBuf) -> Result<(File, u64), String> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "拖入的文件无法安全打开".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "无法读取拖入文件的元数据".to_string())?;
    if !metadata.is_file() {
        return Err("仅支持普通文件，不支持目录或特殊文件".to_string());
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err("单个附件不能超过 25 MB".to_string());
    }
    Ok((file, metadata.len()))
}

#[cfg(target_os = "macos")]
pub fn publish_drop(
    app: &tauri::AppHandle,
    paths: &[PathBuf],
    position: PhysicalPosition<f64>,
) -> Result<(), String> {
    let now = Instant::now();
    let mut store = grants()
        .lock()
        .map_err(|_| "附件授权存储不可用".to_string())?;
    purge_expired(&mut store, now);

    let mut total_bytes = 0_u64;
    let mut files = Vec::new();
    for path in paths.iter().take(MAX_FILE_COUNT) {
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let (file, size) = match open_regular_file(path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if total_bytes.saturating_add(size) > MAX_TOTAL_BYTES {
            break;
        }
        total_bytes += size;

        let mut grant_id = new_grant_id();
        while store.contains_key(&grant_id) {
            grant_id = new_grant_id();
        }
        store.insert(
            grant_id.clone(),
            NativeFileGrant {
                created_at: now,
                file,
                size,
            },
        );
        files.push(NativeFileGrantMetadata {
            grant_id,
            name: name.to_string(),
            size,
        });
    }
    drop(store);

    if files.is_empty() {
        return Err("没有可添加的普通文件".to_string());
    }

    let grant_ids: Vec<String> = files.iter().map(|file| file.grant_id.clone()).collect();
    let emit_result = app.emit_to(
        MAIN_WINDOW_LABEL,
        NATIVE_FILE_DROP_EVENT,
        NativeFileDropPayload {
            files,
            position: NativeFileDropPosition {
                x: position.x,
                y: position.y,
            },
        },
    );
    if let Err(error) = emit_result {
        if let Ok(mut store) = grants().lock() {
            for grant_id in grant_ids {
                store.remove(&grant_id);
            }
        }
        return Err(format!("无法把附件拖放事件交给主窗口：{error}"));
    }
    schedule_expiry_cleanup();
    Ok(())
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn consume_native_file_drop_grant(
    webview: Webview,
    grant_id: String,
) -> Result<tauri::ipc::Response, String> {
    if webview.label() != MAIN_WINDOW_LABEL {
        return Err("附件授权只能由主窗口消费".to_string());
    }

    let now = Instant::now();
    let grant = {
        let mut store = grants()
            .lock()
            .map_err(|_| "附件授权存储不可用".to_string())?;
        purge_expired(&mut store, now);
        store
            .remove(grant_id.trim())
            .ok_or_else(|| "附件授权不存在或已过期".to_string())?
    };

    let mut bytes = Vec::with_capacity(grant.size as usize);
    grant
        .file
        .take(MAX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取拖入附件失败".to_string())?;
    if bytes.len() as u64 != grant.size || bytes.len() as u64 > MAX_FILE_BYTES {
        return Err("拖入附件在读取期间发生变化".to_string());
    }
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn consume_native_file_drop_grant() -> Result<tauri::ipc::Response, String> {
    Err("原生附件拖放仅用于 macOS".to_string())
}
