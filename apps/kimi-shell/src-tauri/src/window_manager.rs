use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, LogicalSize, Manager, Size, WebviewWindow,
    WebviewWindowBuilder,
};
use tauri_plugin_dialog::{DialogExt, FilePath};

#[cfg(windows)]
use webview2_com::{
    take_pwstr, DownloadStartingEventHandler, Microsoft::Web::WebView2::Win32::*,
    StateChangedEventHandler,
};
#[cfg(windows)]
use windows::core::{Interface, HSTRING, PWSTR};

use crate::{
    app_state::AppState,
    log_manager,
    settings_store,
    types::{
        MainWindowCloseBehavior, MainWindowCloseDecision, MainWindowCloseDecisionInput,
        MainWindowCloseDecisionRequestPayload,
        OpenRequestErrorPayload, PrefillChatPayload, PrefillStatusPayload, PrefillStatusState,
        ShellRoutePayload, StartupFailureKind, StartupMonitorTargetRoute, StartupPhase,
        SubmitPrefillAck, WebviewRuntimeKind, WorkspaceSessionBridgePayload,
    },
};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const PREFILL_WINDOW_LABEL: &str = "prefill";

const SHELL_ROUTE_EVENT: &str = "shell-route";
const PREFILL_CHAT_EVENT: &str = "prefill-chat";
const PREFILL_STATUS_EVENT: &str = "prefill-status";
const OPEN_REQUEST_ERROR_EVENT: &str = "open-request-error";
pub const MAIN_WINDOW_CLOSE_DECISION_REQUEST_EVENT: &str = "main-window-close-decision-request";
const STARTUP_TRACE_LIMIT: usize = 48;
const MAIN_TASK_ENTER_TIMEOUT: Duration = Duration::from_secs(2);
const MAIN_WINDOW_READY_TIMEOUT: Duration = Duration::from_secs(3);
const FRONTEND_READY_TIMEOUT: Duration = Duration::from_secs(5);
const CHAT_EXTERNAL_LINK_BRIDGE_SOURCE: &str = "kimi-shell-chat-external-link-bridge";
const CHAT_FRAME_ORIGIN: &str = "https://www.kimi.com";
const DOWNLOAD_SAVE_DIALOG_TITLE: &str = "Save download";

const PREFILL_WIDTH: f64 = 720.0;
const PREFILL_HEIGHT: f64 = 520.0;
const PREFILL_MIN_WIDTH: f64 = 660.0;
const PREFILL_MIN_HEIGHT: f64 = 460.0;
const SHELL_WIDTH: f64 = 1200.0;
const SHELL_HEIGHT: f64 = 820.0;
const SHELL_MIN_WIDTH: f64 = 900.0;
const SHELL_MIN_HEIGHT: f64 = 640.0;

fn chat_external_link_bridge_script() -> String {
    format!(
        r##"
(function () {{
  const BRIDGE_SOURCE = "{bridge_source}";
  const CHAT_ORIGIN = "{chat_origin}";

  if (window.top === window) {{
    return;
  }}

  try {{
    if (window.location.origin !== CHAT_ORIGIN) {{
      return;
    }}
  }} catch (_) {{
    return;
  }}

  function resolveUrl(rawUrl) {{
    if (!rawUrl) {{
      return null;
    }}
    try {{
      return new URL(String(rawUrl), window.location.href);
    }} catch (_) {{
      return null;
    }}
  }}

  function isExternalHttpUrl(parsed) {{
    if (!parsed) {{
      return false;
    }}
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {{
      return false;
    }}
    return parsed.origin !== CHAT_ORIGIN;
  }}

  function postExternalUrl(url, reason) {{
    try {{
      if (!window.parent || window.parent === window) {{
        return;
      }}
      window.parent.postMessage(
        {{
          source: BRIDGE_SOURCE,
          url: url,
          reason: reason || "unknown"
        }},
        "*"
      );
    }} catch (_) {{
      // ignore
    }}
  }}

  document.addEventListener(
    "click",
    function(event) {{
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {{
        return;
      }}

      const target = event && event.target;
      if (!(target instanceof Element)) {{
        return;
      }}

      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) {{
        return;
      }}

      const href = anchor.getAttribute("href") || "";
      if (!href || href.startsWith("#")) {{
        return;
      }}

      const resolved = resolveUrl(href);
      if (!isExternalHttpUrl(resolved)) {{
        return;
      }}

      event.preventDefault();
      event.stopPropagation();
      postExternalUrl(resolved.toString(), "anchor_click");
    }},
    true
  );

  try {{
    const nativeWindowOpen = window.open;
    if (typeof nativeWindowOpen === "function") {{
      window.open = function(url, target, features) {{
        const resolved = resolveUrl(typeof url === "string" ? url : String(url || ""));
        if (isExternalHttpUrl(resolved)) {{
          postExternalUrl(resolved.toString(), "window_open");
          return null;
        }}
        return nativeWindowOpen.call(window, url, target, features);
      }};
    }}
  }} catch (_) {{
    // ignore
  }}
}})();
"##,
        bridge_source = CHAT_EXTERNAL_LINK_BRIDGE_SOURCE,
        chat_origin = CHAT_FRAME_ORIGIN
    )
}

#[cfg(windows)]
type WebviewEventRegistrationToken = i64;

#[cfg(windows)]
struct UnsafeSend<T>(T);

#[cfg(windows)]
unsafe impl<T> Send for UnsafeSend<T> {}

#[cfg(windows)]
impl<T: Clone> Clone for UnsafeSend<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

#[cfg(windows)]
impl<T> UnsafeSend<T> {
    fn take(self) -> T {
        self.0
    }
}

fn selected_file_path(selection: Option<FilePath>) -> Option<PathBuf> {
    selection.and_then(|value| value.into_path().ok())
}

#[cfg(windows)]
fn finalize_windows_download_selection(
    app: &AppHandle,
    url: &str,
    args: ICoreWebView2DownloadStartingEventArgs,
    deferral: ICoreWebView2Deferral,
    selected_path: Option<PathBuf>,
) {
    match selected_path {
        Some(path) if path.is_absolute() => {
            let resolved = HSTRING::from(path.to_string_lossy().to_string());
            let _ = unsafe { args.SetResultFilePath(&resolved) };
            let _ = unsafe { args.SetHandled(true) };
            log_manager::append_line(
                app,
                format!("download destination selected: {url} -> {}", path.display()),
            );
        }
        Some(path) => {
            log_manager::append_line(
                app,
                format!(
                    "download rejected because selected path is not absolute: {} ({url})",
                    path.display()
                ),
            );
            let _ = unsafe { args.SetCancel(true) };
        }
        None => {
            log_manager::append_line(app, format!("download canceled by user: {url}"));
            let _ = unsafe { args.SetCancel(true) };
        }
    }

    let _ = unsafe { deferral.Complete() };
}

#[cfg(windows)]
unsafe fn attach_windows_download_save_hook(
    window: &WebviewWindow,
    app: &AppHandle,
) -> Result<(), String> {
    let app_for_hook = app.clone();
    window
        .with_webview(move |platform_webview| {
            let attach_result: Result<(), String> = (|| {
                let controller = platform_webview.controller();
                let webview = controller
                    .CoreWebView2()
                    .map_err(|error| format!("failed to resolve CoreWebView2: {error}"))?;
                let webview4: ICoreWebView2_4 = webview
                    .cast()
                    .map_err(|error| format!("failed to cast CoreWebView2_4: {error}"))?;
                let app_for_download = app_for_hook.clone();
                let mut token = WebviewEventRegistrationToken::default();

                webview4
                    .add_DownloadStarting(
                        &DownloadStartingEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else {
                                return Ok(());
                            };

                            let download_operation = args.DownloadOperation()?;
                            let url = {
                                let mut uri = PWSTR::null();
                                download_operation.Uri(&mut uri)?;
                                take_pwstr(uri)
                            };

                            let app_for_state = app_for_download.clone();
                            let url_for_state = url.clone();
                            let mut state_token = WebviewEventRegistrationToken::default();
                            download_operation.add_StateChanged(
                                &StateChangedEventHandler::create(Box::new(
                                    move |download_operation, _| {
                                        let Some(download_operation) = download_operation else {
                                            return Ok(());
                                        };

                                        let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
                                        download_operation.State(&mut state)?;

                                        if state != COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
                                            let success =
                                                state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED;
                                            let saved_path = if success {
                                                let mut path = PWSTR::null();
                                                download_operation.ResultFilePath(&mut path)?;
                                                Some(PathBuf::from(take_pwstr(path)))
                                            } else {
                                                None
                                            };
                                            let saved_path_display = saved_path
                                                .as_ref()
                                                .map(|value| value.display().to_string())
                                                .unwrap_or_else(|| "<none>".to_string());
                                            log_manager::append_line(
                                                &app_for_state,
                                                format!(
                                                    "download finished: url={url_for_state}, path={saved_path_display}, success={success}"
                                                ),
                                            );
                                        }

                                        Ok(())
                                    },
                                )),
                                &mut state_token,
                            )?;

                            let suggested_destination = {
                                let mut path = PWSTR::null();
                                args.ResultFilePath(&mut path)?;
                                PathBuf::from(take_pwstr(path))
                            };
                            let default_directory =
                                suggested_destination.parent().map(PathBuf::from);
                            let default_file_name = suggested_destination
                                .file_name()
                                .map(|value| value.to_string_lossy().trim().to_string())
                                .filter(|value| !value.is_empty());

                            let deferral = UnsafeSend(args.GetDeferral()?);
                            let args = UnsafeSend(args);
                            let app_for_dialog = app_for_download.clone();
                            let url_for_dialog = url.clone();

                            let mut dialog =
                                app_for_dialog.dialog().file().set_title(DOWNLOAD_SAVE_DIALOG_TITLE);
                            if let Some(directory) = default_directory.as_ref() {
                                dialog = dialog.set_directory(directory);
                            }
                            if let Some(file_name) = default_file_name.as_ref() {
                                dialog = dialog.set_file_name(file_name);
                            }

                            dialog.save_file(move |selection| {
                                let selected_path = selected_file_path(selection);
                                let app_for_main = app_for_dialog.clone();
                                let app_for_main_callback = app_for_main.clone();
                                let url_for_main = url_for_dialog.clone();
                                let args_for_main = UnsafeSend(args.take());
                                let deferral_for_main = UnsafeSend(deferral.take());
                                let args_for_fallback = args_for_main.clone();
                                let deferral_for_fallback = deferral_for_main.clone();

                                let schedule_result = app_for_main.run_on_main_thread(move || {
                                    finalize_windows_download_selection(
                                        &app_for_main_callback,
                                        &url_for_main,
                                        args_for_main.take(),
                                        deferral_for_main.take(),
                                        selected_path,
                                    );
                                });

                                if let Err(error) = schedule_result {
                                    log_manager::append_line(
                                        &app_for_dialog,
                                        format!(
                                            "failed to schedule download save decision on main thread: {error}"
                                        ),
                                    );
                                    finalize_windows_download_selection(
                                        &app_for_dialog,
                                        &url_for_dialog,
                                        args_for_fallback.take(),
                                        deferral_for_fallback.take(),
                                        None,
                                    );
                                }
                            });

                            Ok(())
                        })),
                        &mut token,
                    )
                    .map_err(|error| format!("failed to register DownloadStarting handler: {error}"))?;

                Ok(())
            })();

            match attach_result {
                Ok(()) => {
                    log_manager::append_line(
                        &app_for_hook,
                        "main window download save hook installed",
                    );
                }
                Err(error) => {
                    log_manager::append_line(
                        &app_for_hook,
                        format!(
                            "main window download save hook unavailable; falling back to default download behavior: {error}"
                        ),
                    );
                }
            }
        })
        .map_err(|error| format!("failed to access main platform webview for download hook: {error}"))
}

#[cfg(not(windows))]
fn attach_windows_download_save_hook(
    _window: &WebviewWindow,
    _app: &AppHandle,
) -> Result<(), String> {
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationStage {
    Init,
    LocalBoot,
    BackendReady,
    ControlCenter,
    Diagnostics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalRoute {
    Loading,
    Onboarding,
    Diagnostics,
    ControlCenter,
}

#[derive(Debug, Clone)]
struct NavigationState {
    stage: NavigationStage,
    route: Option<LocalRoute>,
    frontend_ready: bool,
    loading_rendered: bool,
    queued_route: Option<LocalRoute>,
    pending_prefill: Option<PrefillChatPayload>,
    pending_main_events: Vec<QueuedMainEvent>,
    next_prefill_id: u64,
    allow_process_exit: bool,
    handoff_requested: bool,
    startup_pending: bool,
    startup_exit_cause: Option<String>,
    startup_attempt_id: u64,
    startup_phase: StartupPhase,
    startup_failure_kind: Option<StartupFailureKind>,
    startup_failure_detail: Option<String>,
    startup_guard_failed: bool,
    main_ready_watchdog_armed: bool,
    main_ready_watchdog_generation: u64,
    suppress_next_main_close_requested: bool,
    suppress_next_main_destroyed: bool,
    main_close_decision_prompt_open: bool,
    suppress_next_prefill_close_requested: bool,
    suppress_next_prefill_destroyed: bool,
}

impl Default for NavigationState {
    fn default() -> Self {
        Self {
            stage: NavigationStage::Init,
            route: None,
            frontend_ready: false,
            loading_rendered: false,
            queued_route: None,
            pending_prefill: None,
            pending_main_events: Vec::new(),
            next_prefill_id: 0,
            allow_process_exit: false,
            handoff_requested: false,
            startup_pending: false,
            startup_exit_cause: None,
            startup_attempt_id: 0,
            startup_phase: StartupPhase::Idle,
            startup_failure_kind: None,
            startup_failure_detail: None,
            startup_guard_failed: false,
            main_ready_watchdog_armed: false,
            main_ready_watchdog_generation: 0,
            suppress_next_main_close_requested: false,
            suppress_next_main_destroyed: false,
            main_close_decision_prompt_open: false,
            suppress_next_prefill_close_requested: false,
            suppress_next_prefill_destroyed: false,
        }
    }
}

#[derive(Debug, Clone)]
enum QueuedMainEvent {
    WorkspaceSession {
        event_name: String,
        payload: WorkspaceSessionBridgePayload,
    },
    OpenRequestError(OpenRequestErrorPayload),
}

#[derive(Debug, Clone)]
struct StartupSnapshot {
    attempt_id: u64,
    pending: bool,
    exit_cause: Option<String>,
    phase: StartupPhase,
    failure_kind: Option<StartupFailureKind>,
    failure_detail: Option<String>,
}

pub struct FrontendReadyTransition {
    pub accepted: bool,
    pub pending_prefill: Option<PrefillChatPayload>,
}

enum DispatchOutcome {
    Dispatch(LocalRoute),
    Queued(LocalRoute, &'static str),
    Skipped,
}

fn shared_navigation_state() -> &'static Mutex<NavigationState> {
    static STATE: OnceLock<Mutex<NavigationState>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(NavigationState::default()))
}

pub fn create_prefill_window(app: &AppHandle, source: &str) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        apply_prefill_window_geometry(app, &window, source);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let config = window_config(app, PREFILL_WINDOW_LABEL)?;
    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|error| format!("failed to construct prefill builder: {error}"))?
        .build()
        .map_err(|error| format!("failed to build prefill window: {error}"))?;

    apply_prefill_window_geometry(app, &window, source);
    let _ = window.show();
    let _ = window.set_focus();
    log_manager::append_line(app, format!("prefill window prepared (source={source})"));
    Ok(())
}

pub fn create_hidden_main_window(app: &AppHandle, source: &str) -> Result<(), String> {
    let (startup_attempt_id, watchdog_generation, snapshot) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            let message = format!(
                "navigation state mutex poisoned while preparing hidden main window (source={source})"
            );
            log_manager::append_line(app, &message);
            return Err(message);
        };

        prepare_hidden_main_boot_locked(&mut state);
        let snapshot = snapshot_from_state(&state);
        (
            state.startup_attempt_id,
            state.main_ready_watchdog_generation,
            snapshot,
        )
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    spawn_main_ready_watchdog(
        app.clone(),
        startup_attempt_id,
        watchdog_generation,
        source.to_string(),
    );

    advance_startup_phase(app, StartupPhase::MainBuildTaskPosted, source);
    let app_handle = app.clone();
    let source_owned = source.to_string();
    app.run_on_main_thread(move || {
        run_create_hidden_main_on_main_thread(&app_handle, &source_owned);
    })
    .map_err(|error| format!("failed to schedule hidden main creation: {error}"))
}

pub fn prepare_for_backend_restart(app: &AppHandle, source: &str) -> Result<(), String> {
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            let message = format!(
                "navigation state mutex poisoned while preparing backend restart (source={source})"
            );
            log_manager::append_line(app, &message);
            return Err(message);
        };

        reset_for_retry_locked(&mut state);
        snapshot_from_state(&state)
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    ensure_prefill_window(app, &format!("{source}:ensure_prefill"))?;
    destroy_hidden_main_window(app, &format!("{source}:destroy_main"));
    record_prefill_shown(app, source);
    create_hidden_main_window(app, &format!("{source}:create_hidden_main"))
}

pub fn record_prefill_shown(app: &AppHandle, source: &str) {
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while recording prefill shown (source={source})"
                ),
            );
            return;
        };

        state.startup_phase = StartupPhase::PrefillSurfaceShown;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        state.startup_guard_failed = false;
        state.allow_process_exit = false;
        snapshot_from_state(&state)
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    record_startup_trace(app, format!("prefill shown (source={source})"));
}

pub fn set_webview_runtime_info(
    app: &AppHandle,
    kind: WebviewRuntimeKind,
    version: Option<String>,
    source: &str,
) {
    let version_for_runtime = version.clone();
    with_runtime_state(app, |runtime| {
        runtime.webview_runtime_kind = kind;
        runtime.webview_runtime_version = version_for_runtime;
    });

    let version_display = version.as_deref().unwrap_or("unknown");
    log_manager::append_line(
        app,
        format!(
            "webview runtime resolved (source={source}, kind={}, version={version_display})",
            webview_runtime_kind_label(kind)
        ),
    );
}

pub fn permit_process_exit(app: &AppHandle, source: &str) {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!("navigation state mutex poisoned while permitting exit (source={source})"),
        );
        return;
    };
    state.allow_process_exit = true;
    log_manager::append_line(app, format!("process exit permitted (source={source})"));
}

pub fn should_prevent_process_exit(_app: &AppHandle) -> bool {
    let lock = shared_navigation_state().lock();
    let Ok(state) = lock else {
        return false;
    };
    !state.allow_process_exit && (state.startup_pending || state.startup_guard_failed)
}

pub fn allow_prefill_close_request(app: &AppHandle, source: &str) -> bool {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while handling prefill close request (source={source})"
            ),
        );
        return false;
    };

    if state.suppress_next_prefill_close_requested {
        state.suppress_next_prefill_close_requested = false;
        return true;
    }

    false
}

pub fn handle_prefill_window_destroyed(app: &AppHandle, source: &str) {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while handling prefill destroy (source={source})"
            ),
        );
        return;
    };

    if state.suppress_next_prefill_destroyed {
        state.suppress_next_prefill_destroyed = false;
        return;
    }

    log_manager::append_line(
        app,
        format!(
            "prefill window destroyed (source={source}, startup_pending={})",
            state.startup_pending
        ),
    );
}

fn load_main_window_close_behavior(app: &AppHandle) -> MainWindowCloseBehavior {
    settings_store::load_or_default(app)
        .map(|settings| settings.main_window_close_behavior)
        .unwrap_or(MainWindowCloseBehavior::Ask)
}

fn emit_main_window_close_decision_request(app: &AppHandle, source: &str) -> bool {
    let payload = MainWindowCloseDecisionRequestPayload {
        title: "关闭主窗口".to_string(),
        message: "关闭主窗口时，选择退出应用或最小化到系统托盘。".to_string(),
        exit_label: "退出应用".to_string(),
        minimize_label: "最小化到系统托盘".to_string(),
        remember_label: "记住我的选择".to_string(),
    };

    match app.emit_to(
        MAIN_WINDOW_LABEL,
        MAIN_WINDOW_CLOSE_DECISION_REQUEST_EVENT,
        payload,
    ) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit main close decision request (source={source}): {error}"
                ),
            );
            false
        }
    }
}

pub fn minimize_main_window_to_tray(app: &AppHandle, source: &str) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
        log_manager::append_line(
            app,
            format!("main window hidden to tray (source={source})"),
        );
    }
}

pub fn handle_main_close_requested(app: &AppHandle, source: &str) -> bool {
    let close_behavior = load_main_window_close_behavior(app);
    let action = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            return false;
        };

        if state.suppress_next_main_close_requested {
            state.suppress_next_main_close_requested = false;
            0_u8
        } else if state.startup_pending && !state.allow_process_exit {
            1_u8
        } else if close_behavior == MainWindowCloseBehavior::Ask {
            if state.main_close_decision_prompt_open {
                2_u8
            } else {
                state.main_close_decision_prompt_open = true;
                3_u8
            }
        } else if close_behavior == MainWindowCloseBehavior::MinimizeToTray {
            4_u8
        } else {
            0_u8
        }
    };

    if action == 1 {
        mark_startup_guard_failed(
            app,
            StartupFailureKind::MainCloseRequestedDuringStartup,
            "主界面在启动过程中被关闭，请重试。",
            source,
            Some("main_close_requested_during_startup"),
        );
        return true;
    }

    if action == 2 {
        return true;
    }

    if action == 3 {
        let emitted = emit_main_window_close_decision_request(app, source);
        if !emitted {
            if let Ok(mut state) = shared_navigation_state().lock() {
                state.main_close_decision_prompt_open = false;
            }
            return false;
        }
        return true;
    }

    if action == 4 {
        minimize_main_window_to_tray(app, source);
        return true;
    }

    false
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MainWindowCloseDecisionOutcome {
    Exit,
    MinimizeToTray,
}

pub fn apply_main_window_close_decision(
    app: &AppHandle,
    input: MainWindowCloseDecisionInput,
    source: &str,
) -> Result<MainWindowCloseDecisionOutcome, String> {
    if let Ok(mut state) = shared_navigation_state().lock() {
        state.main_close_decision_prompt_open = false;
    }

    if input.remember {
        let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
        settings.main_window_close_behavior = match input.decision {
            MainWindowCloseDecision::Exit => MainWindowCloseBehavior::Exit,
            MainWindowCloseDecision::MinimizeToTray => MainWindowCloseBehavior::MinimizeToTray,
        };
        settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    }

    match input.decision {
        MainWindowCloseDecision::Exit => Ok(MainWindowCloseDecisionOutcome::Exit),
        MainWindowCloseDecision::MinimizeToTray => {
            minimize_main_window_to_tray(app, source);
            Ok(MainWindowCloseDecisionOutcome::MinimizeToTray)
        }
    }
}

pub fn complete_startup_monitor_route(
    app: &AppHandle,
    target_route: StartupMonitorTargetRoute,
    source: &str,
) -> Result<(), String> {
    match target_route {
        StartupMonitorTargetRoute::Workspace => {
            transition(
                app,
                NavigationStage::LocalBoot,
                Some(LocalRoute::Loading),
                source,
                true,
            );
        }
        StartupMonitorTargetRoute::Onboarding => {
            transition(
                app,
                NavigationStage::ControlCenter,
                Some(LocalRoute::Onboarding),
                source,
                true,
            );
        }
        StartupMonitorTargetRoute::Diagnostics => {
            transition(
                app,
                NavigationStage::Diagnostics,
                Some(LocalRoute::Diagnostics),
                source,
                true,
            );
        }
        StartupMonitorTargetRoute::ControlCenter => {
            transition(
                app,
                NavigationStage::ControlCenter,
                Some(LocalRoute::ControlCenter),
                source,
                true,
            );
        }
    }

    {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            return Err("navigation state mutex is poisoned".to_string());
        };
        state.handoff_requested = true;
    }

    record_startup_trace(
        app,
        format!(
            "handoff requested (source={source}, route={})",
            route_label(current_route(app))
        ),
    );
    maybe_finalize_startup_handoff(app, source);
    Ok(())
}

pub fn handle_main_window_destroyed(app: &AppHandle, source: &str) {
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while handling main destroy (source={source})"
                ),
            );
            return;
        };

        if state.suppress_next_main_destroyed {
            state.suppress_next_main_destroyed = false;
            return;
        }

        if !state.startup_pending {
            return;
        }

        state.startup_pending = false;
        state.startup_guard_failed = true;
        state.main_ready_watchdog_armed = false;
        state.frontend_ready = false;
        state.loading_rendered = false;
        state.startup_phase = StartupPhase::Failed;
        state.startup_failure_kind = Some(StartupFailureKind::MainDestroyedDuringStartup);
        state.startup_failure_detail = Some("主界面在启动过程中被销毁，请重试。".to_string());
        state.startup_exit_cause = Some("main_destroyed_during_startup".to_string());
        snapshot_from_state(&state)
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    record_startup_trace(
        app,
        format!(
            "attempt={} phase=failed:{}:{}",
            snapshot.attempt_id,
            startup_failure_kind_label(
                snapshot
                    .failure_kind
                    .unwrap_or(StartupFailureKind::MainDestroyedDuringStartup)
            ),
            source
        ),
    );
    let _ = ensure_prefill_window(app, &format!("{source}:ensure_prefill"));
    emit_prefill_status(
        app,
        PrefillStatusState::StartupFailed,
        snapshot.failure_detail.as_deref(),
        source,
    );
    focus_prefill_window(app);
}

pub fn publish_workspace_session_event(
    app: &AppHandle,
    event_name: &str,
    payload: &WorkspaceSessionBridgePayload,
    source: &str,
) {
    let should_queue = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while publishing workspace event (source={source})"
                ),
            );
            return;
        };

        if state.frontend_ready && app.get_webview_window(MAIN_WINDOW_LABEL).is_some() {
            false
        } else {
            state
                .pending_main_events
                .push(QueuedMainEvent::WorkspaceSession {
                    event_name: event_name.to_string(),
                    payload: payload.clone(),
                });
            true
        }
    };

    if should_queue {
        log_manager::append_line(
            app,
            format!(
                "queued workspace main event (source={source}, event={event_name}, action={})",
                payload.action
            ),
        );
        return;
    }

    if !emit_workspace_session_event(app, event_name, payload, source) {
        requeue_main_event(
            app,
            QueuedMainEvent::WorkspaceSession {
                event_name: event_name.to_string(),
                payload: payload.clone(),
            },
            source,
            "emit_failed",
        );
    }
}

pub fn publish_open_request_error(
    app: &AppHandle,
    payload: &OpenRequestErrorPayload,
    source: &str,
) {
    let should_queue = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while publishing open-request error (source={source})"
                ),
            );
            return;
        };

        if state.frontend_ready && app.get_webview_window(MAIN_WINDOW_LABEL).is_some() {
            false
        } else {
            state
                .pending_main_events
                .push(QueuedMainEvent::OpenRequestError(payload.clone()));
            true
        }
    };

    if should_queue {
        log_manager::append_line(
            app,
            format!(
                "queued open-request error for main window (source={source}, stage={})",
                payload.stage
            ),
        );
        return;
    }

    if !emit_open_request_error_event(app, payload, source) {
        requeue_main_event(
            app,
            QueuedMainEvent::OpenRequestError(payload.clone()),
            source,
            "emit_failed",
        );
    }
}

pub fn toggle_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            Ok(false) => {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Err(_) => {}
        }
    }
}

pub fn show_and_focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn enter_local_boot(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::LocalBoot,
        Some(LocalRoute::Loading),
        source,
        false,
    );
}

pub fn mark_backend_ready(app: &AppHandle, source: &str) {
    transition(app, NavigationStage::BackendReady, None, source, false);
}

pub fn mark_frontend_ready(app: &AppHandle, source: &str) -> FrontendReadyTransition {
    let (accepted, queued_route, queued_main_events, pending_prefill, snapshot) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned, failed to mark frontend ready (source={source})"
                ),
            );
            return FrontendReadyTransition {
                accepted: false,
                pending_prefill: None,
            };
        };

        let accepted = !state.frontend_ready;
        state.frontend_ready = true;
        state.startup_phase = StartupPhase::FrontendReady;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        let queued_route = state.queued_route.take();
        let queued_main_events = std::mem::take(&mut state.pending_main_events);
        let pending_prefill = state.pending_prefill.take();
        let snapshot = snapshot_from_state(&state);
        (
            accepted,
            queued_route,
            queued_main_events,
            pending_prefill,
            snapshot,
        )
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    if accepted {
        record_startup_trace(
            app,
            format!(
                "attempt={} phase={}:{}",
                snapshot.attempt_id,
                startup_phase_label(snapshot.phase),
                source
            ),
        );
    }

    if let Some(route) = queued_route {
        if !emit_shell_route_event(app, route, source) {
            requeue_route(app, route, source, "emit_failed_after_frontend_ready");
        }
    }

    flush_pending_main_events(app, queued_main_events, source);

    if let Some(payload) = pending_prefill.clone() {
        if !emit_prefill_event(app, &payload, source) {
            requeue_prefill(
                app,
                payload.clone(),
                source,
                "emit_failed_after_frontend_ready",
            );
        }
    }

    maybe_finalize_startup_handoff(app, source);

    FrontendReadyTransition {
        accepted,
        pending_prefill,
    }
}

pub fn complete_pending_prefill_handoff(app: &AppHandle, source: &str) {
    let should_attempt = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while recording loading render (source={source})"
                ),
            );
            return;
        };

        if state.loading_rendered {
            false
        } else {
            state.loading_rendered = true;
            true
        }
    };

    if should_attempt {
        record_startup_trace(app, format!("loading rendered (source={source})"));
    }
    maybe_finalize_startup_handoff(app, source);
}

pub fn show_missing_kimi(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::ControlCenter,
        Some(LocalRoute::Onboarding),
        source,
        false,
    );
}

pub fn show_control_center(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::ControlCenter,
        Some(LocalRoute::ControlCenter),
        source,
        false,
    );
}

pub fn show_diagnostics(app: &AppHandle, source: &str) {
    transition(
        app,
        NavigationStage::Diagnostics,
        Some(LocalRoute::Diagnostics),
        source,
        false,
    );
}

pub fn recover_main_window_boot(app: &AppHandle, source: &str) -> Result<(), String> {
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            let message = format!(
                "navigation state mutex poisoned, failed to recover main window (source={source})"
            );
            log_manager::append_line(app, &message);
            return Err(message);
        };

        state.frontend_ready = false;
        state.loading_rendered = false;
        state.startup_pending = false;
        state.startup_guard_failed = false;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        state.startup_exit_cause = None;
        snapshot_from_state(&state)
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    let _ = ensure_prefill_window(app, &format!("{source}:ensure_prefill"));
    destroy_hidden_main_window(app, &format!("{source}:destroy_main"));
    create_hidden_main_window(app, &format!("{source}:create_hidden_main"))
}

pub fn submit_prefill(app: &AppHandle, text: String, source: &str) -> SubmitPrefillAck {
    let text = text.trim().to_string();
    let text_length = text.chars().count();
    if text.is_empty() {
        return SubmitPrefillAck {
            accepted: false,
            request_id: None,
            queued: false,
            dispatched: false,
            text_length: 0,
        };
    }

    let (request_id, queued, payload) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while submitting prefill (source={source})"
                ),
            );
            return SubmitPrefillAck {
                accepted: false,
                request_id: None,
                queued: false,
                dispatched: false,
                text_length,
            };
        };

        let request_id = next_prefill_request_id_locked(&mut state);
        let payload = PrefillChatPayload {
            request_id: request_id.clone(),
            text: text.clone(),
            auto_send: true,
        };
        let queued = !state.frontend_ready || app.get_webview_window(MAIN_WINDOW_LABEL).is_none();
        if queued {
            state.pending_prefill = Some(payload.clone());
        }
        (request_id, queued, payload)
    };

    let dispatched = if queued {
        false
    } else if emit_prefill_event(app, &payload, source) {
        true
    } else {
        requeue_prefill(app, payload.clone(), source, "emit_failed_during_submit");
        false
    };

    SubmitPrefillAck {
        accepted: true,
        request_id: Some(request_id),
        queued,
        dispatched,
        text_length,
    }
}

pub fn ensure_prefill_window(app: &AppHandle, source: &str) -> Result<(), String> {
    create_prefill_window(app, source)
}

pub fn destroy_hidden_main_window(app: &AppHandle, source: &str) {
    let should_close = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while destroying hidden main (source={source})"
                ),
            );
            return;
        };

        if app.get_webview_window(MAIN_WINDOW_LABEL).is_none() {
            false
        } else {
            state.suppress_next_main_close_requested = true;
            state.suppress_next_main_destroyed = true;
            state.frontend_ready = false;
            state.loading_rendered = false;
            true
        }
    };

    if !should_close {
        return;
    }

    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
        let _ = window.close();
        log_manager::append_line(app, format!("hidden main destroyed (source={source})"));
    }
}

fn run_create_hidden_main_on_main_thread(app: &AppHandle, source: &str) {
    advance_startup_phase(app, StartupPhase::MainBuildTaskEntered, source);

    if let Some(existing) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        apply_main_window_geometry(app, &existing, source);
        let _ = existing.hide();
        advance_startup_phase(app, StartupPhase::MainWindowCreated, source);
        log_manager::append_line(
            app,
            format!("hidden main already exists, reusing (source={source})"),
        );
        return;
    }

    let config = match window_config(app, MAIN_WINDOW_LABEL) {
        Ok(config) => config,
        Err(error) => {
            mark_startup_guard_failed(
                app,
                StartupFailureKind::MainWindowMissing,
                &format!("主界面窗口配置缺失：{error}"),
                &format!("{source}:main_config_missing"),
                Some("main_config_missing"),
            );
            return;
        }
    };

    advance_startup_phase(app, StartupPhase::MainConfigLoaded, source);
    let app_for_load = app.clone();
    let chat_external_link_script = chat_external_link_bridge_script();
    let builder = match WebviewWindowBuilder::from_config(app, &config) {
        Ok(builder) => builder
            .initialization_script_for_all_frames(chat_external_link_script)
            .on_page_load(move |_window, payload| {
                let url = payload.url().to_string();
                if !is_shell_document_url(&url) {
                    return;
                }

                match payload.event() {
                    PageLoadEvent::Started => {
                        advance_startup_phase(
                            &app_for_load,
                            StartupPhase::MainPageLoadStarted,
                            &format!("main_page_load_started:{url}"),
                        );
                    }
                    PageLoadEvent::Finished => {
                        advance_startup_phase(
                            &app_for_load,
                            StartupPhase::MainPageLoadFinished,
                            &format!("main_page_load_finished:{url}"),
                        );
                    }
                }
            }),
        Err(error) => {
            mark_startup_guard_failed(
                app,
                StartupFailureKind::MainWindowMissing,
                &format!("主界面窗口创建器初始化失败：{error}"),
                &format!("{source}:main_builder_failed"),
                Some("main_builder_failed"),
            );
            return;
        }
    };

    advance_startup_phase(app, StartupPhase::MainBuilderConstructed, source);
    advance_startup_phase(app, StartupPhase::MainBuildStarted, source);

    let window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            mark_startup_guard_failed(
                app,
                StartupFailureKind::MainWebviewBuildHung,
                &format!("主界面窗口创建失败：{error}"),
                &format!("{source}:main_build_failed"),
                Some("main_build_failed"),
            );
            return;
        }
    };

    if let Err(error) = unsafe { attach_windows_download_save_hook(&window, app) } {
        log_manager::append_line(
            app,
            format!(
                "failed to access main platform webview for download hook; falling back to default download behavior: {error}"
            ),
        );
    }

    apply_main_window_geometry(app, &window, source);
    let _ = window.hide();
    advance_startup_phase(app, StartupPhase::MainWindowCreated, source);
    record_startup_trace(app, format!("hidden main created (source={source})"));
}

fn maybe_finalize_startup_handoff(app: &AppHandle, source: &str) {
    let (route, pending_prefill, queued_main_events, snapshot) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while attempting startup handoff (source={source})"
                ),
            );
            return;
        };

        if !can_finalize_handoff_locked(&state) {
            return;
        }

        let route = state.route;
        let pending_prefill = state.pending_prefill.take();
        let queued_main_events = std::mem::take(&mut state.pending_main_events);
        state.handoff_requested = false;
        state.startup_pending = false;
        state.main_ready_watchdog_armed = false;
        state.startup_guard_failed = false;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        state.startup_exit_cause = None;
        let snapshot = snapshot_from_state(&state);
        (route, pending_prefill, queued_main_events, snapshot)
    };

    sync_runtime_startup_snapshot(app, &snapshot);

    let Some(main) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        mark_startup_guard_failed(
            app,
            StartupFailureKind::MainWindowMissing,
            "主界面窗口不存在，请重试。",
            &format!("{source}:main_missing_during_handoff"),
            Some("main_missing_during_handoff"),
        );
        return;
    };

    if let Some(route) = route {
        if !emit_shell_route_event(app, route, source) {
            requeue_route(app, route, source, "emit_failed_during_handoff");
        }
    }

    flush_pending_main_events(app, queued_main_events, source);
    if let Some(payload) = pending_prefill {
        if !emit_prefill_event(app, &payload, source) {
            requeue_prefill(app, payload, source, "emit_failed_during_handoff");
        }
    }

    move_main_window_near_prefill(&main, app);
    close_prefill_window(app, &format!("{source}:handoff_close_prefill"));
    let _ = main.show();
    let _ = main.set_focus();
    record_startup_trace(app, format!("main shown (source={source})"));
}

fn prepare_hidden_main_boot_locked(state: &mut NavigationState) {
    state.startup_attempt_id = state.startup_attempt_id.saturating_add(1);
    state.frontend_ready = false;
    state.loading_rendered = false;
    state.startup_pending = true;
    state.startup_exit_cause = None;
    state.startup_phase = StartupPhase::MainBootRequested;
    state.startup_failure_kind = None;
    state.startup_failure_detail = None;
    state.startup_guard_failed = false;
    state.main_ready_watchdog_armed = true;
    state.main_ready_watchdog_generation = state.main_ready_watchdog_generation.saturating_add(1);
}

fn reset_for_retry_locked(state: &mut NavigationState) {
    state.stage = NavigationStage::Init;
    state.route = None;
    state.frontend_ready = false;
    state.loading_rendered = false;
    state.queued_route = None;
    state.pending_prefill = None;
    state.pending_main_events.clear();
    state.allow_process_exit = false;
    state.handoff_requested = false;
    state.startup_pending = false;
    state.startup_exit_cause = None;
    state.startup_phase = StartupPhase::PrefillSurfaceShown;
    state.startup_failure_kind = None;
    state.startup_failure_detail = None;
    state.startup_guard_failed = false;
    state.main_ready_watchdog_armed = false;
}

fn can_finalize_handoff_locked(state: &NavigationState) -> bool {
    state.handoff_requested
        && state.frontend_ready
        && state.loading_rendered
        && !state.startup_guard_failed
}

fn spawn_main_ready_watchdog(
    app: AppHandle,
    startup_attempt_id: u64,
    watchdog_generation: u64,
    source: String,
) {
    thread::spawn(move || {
        thread::sleep(MAIN_TASK_ENTER_TIMEOUT);
        if let Some(snapshot) = watchdog_snapshot(&app, startup_attempt_id, watchdog_generation) {
            if startup_phase_rank(snapshot.phase)
                < startup_phase_rank(StartupPhase::MainBuildTaskEntered)
            {
                mark_startup_guard_failed_for_attempt(
                    &app,
                    Some(startup_attempt_id),
                    Some(watchdog_generation),
                    StartupFailureKind::MainThreadTaskStalled,
                    "主界面启动任务没有进入主线程，请重试。",
                    &format!("{source}:main_thread_task_stalled"),
                    Some("main_thread_task_stalled"),
                );
                return;
            }
        } else {
            return;
        }

        thread::sleep(MAIN_WINDOW_READY_TIMEOUT);
        if let Some(snapshot) = watchdog_snapshot(&app, startup_attempt_id, watchdog_generation) {
            if startup_phase_rank(snapshot.phase)
                < startup_phase_rank(StartupPhase::MainWindowCreated)
            {
                mark_startup_guard_failed_for_attempt(
                    &app,
                    Some(startup_attempt_id),
                    Some(watchdog_generation),
                    StartupFailureKind::MainWebviewBuildHung,
                    "主界面窗口创建超时，请重试或打开日志排查。",
                    &format!("{source}:main_webview_build_hung"),
                    Some("main_webview_build_hung"),
                );
                return;
            }
        } else {
            return;
        }

        thread::sleep(FRONTEND_READY_TIMEOUT);
        if let Some(snapshot) = watchdog_snapshot(&app, startup_attempt_id, watchdog_generation) {
            if startup_phase_rank(snapshot.phase) < startup_phase_rank(StartupPhase::FrontendReady)
            {
                mark_startup_guard_failed_for_attempt(
                    &app,
                    Some(startup_attempt_id),
                    Some(watchdog_generation),
                    StartupFailureKind::FrontendReadyTimeout,
                    "主界面加载超时，请重试或打开日志排查。",
                    &format!("{source}:frontend_ready_timeout"),
                    Some("frontend_ready_timeout"),
                );
            }
        }
    });
}

fn watchdog_snapshot(
    app: &AppHandle,
    startup_attempt_id: u64,
    watchdog_generation: u64,
) -> Option<StartupSnapshot> {
    let lock = shared_navigation_state().lock();
    let Ok(state) = lock else {
        log_manager::append_line(
            app,
            "navigation state mutex poisoned while reading watchdog snapshot",
        );
        return None;
    };

    if state.startup_attempt_id != startup_attempt_id
        || state.main_ready_watchdog_generation != watchdog_generation
        || !state.main_ready_watchdog_armed
        || !state.startup_pending
        || state.startup_guard_failed
    {
        return None;
    }

    Some(snapshot_from_state(&state))
}

fn mark_startup_guard_failed(
    app: &AppHandle,
    kind: StartupFailureKind,
    detail: &str,
    source: &str,
    exit_cause: Option<&str>,
) {
    mark_startup_guard_failed_for_attempt(app, None, None, kind, detail, source, exit_cause);
}

fn mark_startup_guard_failed_for_attempt(
    app: &AppHandle,
    expected_attempt_id: Option<u64>,
    expected_watchdog_generation: Option<u64>,
    kind: StartupFailureKind,
    detail: &str,
    source: &str,
    exit_cause: Option<&str>,
) {
    let exit_cause_owned = exit_cause.map(|value| value.to_string());
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while setting startup guard failure (source={source})"
                ),
            );
            return;
        };

        if let Some(expected) = expected_attempt_id {
            if state.startup_attempt_id != expected {
                return;
            }
        }
        if let Some(expected) = expected_watchdog_generation {
            if state.main_ready_watchdog_generation != expected {
                return;
            }
        }
        if !state.startup_pending {
            return;
        }

        state.handoff_requested = false;
        state.startup_pending = false;
        state.main_ready_watchdog_armed = false;
        state.frontend_ready = false;
        state.loading_rendered = false;
        state.startup_guard_failed = true;
        state.startup_phase = StartupPhase::Failed;
        state.startup_failure_kind = Some(kind);
        state.startup_failure_detail = Some(detail.to_string());
        state.startup_exit_cause = exit_cause_owned.clone();
        snapshot_from_state(&state)
    };

    sync_runtime_startup_snapshot(app, &snapshot);
    record_startup_trace(
        app,
        format!(
            "attempt={} phase=failed:{}:{}",
            snapshot.attempt_id,
            startup_failure_kind_label(kind),
            source
        ),
    );
    destroy_hidden_main_window(app, &format!("{source}:destroy_hidden_main"));
    let _ = ensure_prefill_window(app, &format!("{source}:ensure_prefill"));
    emit_prefill_status(app, PrefillStatusState::StartupFailed, Some(detail), source);
    focus_prefill_window(app);
}

fn close_prefill_window(app: &AppHandle, source: &str) {
    {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while closing prefill window (source={source})"
                ),
            );
            return;
        };
        state.suppress_next_prefill_close_requested = true;
        state.suppress_next_prefill_destroyed = true;
    }

    if let Some(window) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        let _ = window.close();
        record_startup_trace(app, format!("prefill closed (source={source})"));
    }
}

fn focus_prefill_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn move_main_window_near_prefill(main: &tauri::WebviewWindow, app: &AppHandle) {
    if let Some(prefill) = app.get_webview_window(PREFILL_WINDOW_LABEL) {
        let _ = prefill.current_monitor();
    }
    let _ = main.center();
}

fn transition(
    app: &AppHandle,
    stage: NavigationStage,
    route: Option<LocalRoute>,
    source: &str,
    force_navigate: bool,
) {
    let (
        dispatch_outcome,
        final_route_for_log,
        stage_changed,
        route_changed,
        previous_stage,
        previous_route,
    ) = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!("navigation state mutex poisoned, skip transition (source={source})"),
            );
            return;
        };

        let previous_stage = state.stage;
        let previous_route = state.route;

        let stage_changed = state.stage != stage;
        if stage_changed {
            state.stage = stage;
        }

        let mut route_changed = false;
        let mut dispatch_outcome = DispatchOutcome::Skipped;
        if let Some(next_route) = route {
            route_changed = state.route != Some(next_route);
            state.route = Some(next_route);

            if force_navigate || route_changed {
                dispatch_outcome = request_route_locked(&mut state, next_route);
            }
        }

        (
            dispatch_outcome,
            state.route,
            stage_changed,
            route_changed,
            previous_stage,
            previous_route,
        )
    };

    if stage_changed || route_changed {
        log_manager::append_line(
            app,
            format!(
                "navigation transition (source={source}) stage: {} -> {}; route: {} -> {}",
                stage_label(previous_stage),
                stage_label(stage),
                route_label(previous_route),
                route_label(final_route_for_log),
            ),
        );
    }

    match dispatch_outcome {
        DispatchOutcome::Dispatch(route) => {
            if !emit_shell_route_event(app, route, source) {
                requeue_route(app, route, source, "emit_failed");
            }
        }
        DispatchOutcome::Queued(route, reason) => {
            log_manager::append_line(
                app,
                format!(
                    "navigation queued (source={source}, route={}, reason={reason})",
                    route_label(Some(route))
                ),
            );
        }
        DispatchOutcome::Skipped => {}
    }
}

fn request_route_locked(state: &mut NavigationState, route: LocalRoute) -> DispatchOutcome {
    if !state.frontend_ready {
        state.queued_route = Some(route);
        return DispatchOutcome::Queued(route, "frontend_not_ready");
    }
    DispatchOutcome::Dispatch(route)
}

fn requeue_route(app: &AppHandle, route: LocalRoute, source: &str, detail: &str) {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while re-queueing route (source={source}, detail={detail})"
            ),
        );
        return;
    };

    state.queued_route = Some(route);
    log_manager::append_line(
        app,
        format!(
            "navigation event dispatch failed and route re-queued (source={source}, route={}, detail={detail})",
            route_label(Some(route))
        ),
    );
}

fn requeue_prefill(app: &AppHandle, payload: PrefillChatPayload, source: &str, detail: &str) {
    let request_id = payload.request_id.clone();
    let text_length = payload.text.chars().count();

    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while re-queueing prefill (source={source}, detail={detail})"
            ),
        );
        return;
    };

    state.pending_prefill = Some(payload);
    log_manager::append_line(
        app,
        format!(
            "prefill event dispatch failed and payload re-queued (source={source}, request_id={request_id}, text_length={text_length}, detail={detail})"
        ),
    );
}

fn requeue_main_event(app: &AppHandle, event: QueuedMainEvent, source: &str, detail: &str) {
    let lock = shared_navigation_state().lock();
    let Ok(mut state) = lock else {
        log_manager::append_line(
            app,
            format!(
                "navigation state mutex poisoned while re-queueing main event (source={source}, detail={detail})"
            ),
        );
        return;
    };

    state.pending_main_events.push(event);
    log_manager::append_line(
        app,
        format!("main event dispatch failed and was re-queued (source={source}, detail={detail})"),
    );
}

fn flush_pending_main_events(app: &AppHandle, events: Vec<QueuedMainEvent>, source: &str) {
    for event in events {
        let dispatched = match &event {
            QueuedMainEvent::WorkspaceSession {
                event_name,
                payload,
            } => emit_workspace_session_event(app, event_name, payload, source),
            QueuedMainEvent::OpenRequestError(payload) => {
                emit_open_request_error_event(app, payload, source)
            }
        };

        if !dispatched {
            requeue_main_event(app, event, source, "flush_failed_after_frontend_ready");
        }
    }
}

fn apply_prefill_window_geometry(app: &AppHandle, window: &tauri::WebviewWindow, source: &str) {
    if let Err(error) = window.set_min_size(Some(Size::Logical(LogicalSize::new(
        PREFILL_MIN_WIDTH,
        PREFILL_MIN_HEIGHT,
    )))) {
        log_manager::append_line(
            app,
            format!("failed to set prefill min size (source={source}): {error}"),
        );
    }
    if let Err(error) = window.set_size(Size::Logical(LogicalSize::new(
        PREFILL_WIDTH,
        PREFILL_HEIGHT,
    ))) {
        log_manager::append_line(
            app,
            format!("failed to set prefill size (source={source}): {error}"),
        );
    }
    let _ = window.set_decorations(false);
    #[cfg(target_os = "windows")]
    let _ = window.set_shadow(true);
    let _ = window.center();
}

fn apply_main_window_geometry(app: &AppHandle, window: &tauri::WebviewWindow, source: &str) {
    if let Err(error) = window.set_min_size(Some(Size::Logical(LogicalSize::new(
        SHELL_MIN_WIDTH,
        SHELL_MIN_HEIGHT,
    )))) {
        log_manager::append_line(
            app,
            format!("failed to set main min size (source={source}): {error}"),
        );
    }
    if let Err(error) = window.set_size(Size::Logical(LogicalSize::new(SHELL_WIDTH, SHELL_HEIGHT)))
    {
        log_manager::append_line(
            app,
            format!("failed to set main size (source={source}): {error}"),
        );
    }
    let _ = window.set_decorations(false);
    #[cfg(target_os = "windows")]
    let _ = window.set_shadow(true);
}

fn window_config(
    app: &AppHandle,
    label: &str,
) -> Result<tauri::utils::config::WindowConfig, String> {
    app.config()
        .app
        .windows
        .iter()
        .find(|window| window.label == label)
        .cloned()
        .ok_or_else(|| format!("{label} window config is missing"))
}

fn snapshot_from_state(state: &NavigationState) -> StartupSnapshot {
    StartupSnapshot {
        attempt_id: state.startup_attempt_id,
        pending: state.startup_pending,
        exit_cause: state.startup_exit_cause.clone(),
        phase: state.startup_phase,
        failure_kind: state.startup_failure_kind,
        failure_detail: state.startup_failure_detail.clone(),
    }
}

fn sync_runtime_startup_snapshot(app: &AppHandle, snapshot: &StartupSnapshot) {
    let snapshot = snapshot.clone();
    with_runtime_state(app, move |runtime| {
        runtime.startup_pending = snapshot.pending;
        runtime.startup_exit_cause = snapshot.exit_cause;
        runtime.startup_attempt_id = snapshot.attempt_id;
        runtime.startup_phase = snapshot.phase;
        runtime.startup_failure_kind = snapshot.failure_kind;
        runtime.startup_failure_detail = snapshot.failure_detail;
    });
}

fn advance_startup_phase(
    app: &AppHandle,
    next_phase: StartupPhase,
    source: &str,
) -> Option<StartupSnapshot> {
    let snapshot = {
        let lock = shared_navigation_state().lock();
        let Ok(mut state) = lock else {
            log_manager::append_line(
                app,
                format!(
                    "navigation state mutex poisoned while advancing startup phase (source={source})"
                ),
            );
            return None;
        };

        if state.startup_attempt_id == 0
            || state.startup_phase == StartupPhase::Failed
            || startup_phase_rank(next_phase) <= startup_phase_rank(state.startup_phase)
        {
            return None;
        }

        state.startup_phase = next_phase;
        state.startup_failure_kind = None;
        state.startup_failure_detail = None;
        Some(snapshot_from_state(&state))
    }?;

    sync_runtime_startup_snapshot(app, &snapshot);
    record_startup_trace(
        app,
        format!(
            "attempt={} phase={}:{}",
            snapshot.attempt_id,
            startup_phase_label(snapshot.phase),
            source
        ),
    );
    Some(snapshot)
}

fn is_shell_document_url(url: &str) -> bool {
    url.contains("index.html#/loading") || url.contains("index.html")
}

fn startup_phase_rank(phase: StartupPhase) -> u8 {
    match phase {
        StartupPhase::Idle => 0,
        StartupPhase::PrefillSurfaceShown => 1,
        StartupPhase::MainBootRequested => 2,
        StartupPhase::MainBuildTaskPosted => 3,
        StartupPhase::MainBuildTaskEntered => 4,
        StartupPhase::MainConfigLoaded => 5,
        StartupPhase::MainBuilderConstructed => 6,
        StartupPhase::MainBuildStarted => 7,
        StartupPhase::MainWindowCreated => 8,
        StartupPhase::MainPageLoadStarted => 9,
        StartupPhase::MainPageLoadFinished => 10,
        StartupPhase::FrontendReady => 11,
        StartupPhase::Failed => 12,
    }
}

fn startup_phase_label(phase: StartupPhase) -> &'static str {
    match phase {
        StartupPhase::Idle => "idle",
        StartupPhase::PrefillSurfaceShown => "prefill_surface_shown",
        StartupPhase::MainBootRequested => "main_boot_requested",
        StartupPhase::MainBuildTaskPosted => "main_build_task_posted",
        StartupPhase::MainBuildTaskEntered => "main_build_task_entered",
        StartupPhase::MainConfigLoaded => "main_config_loaded",
        StartupPhase::MainBuilderConstructed => "main_builder_constructed",
        StartupPhase::MainBuildStarted => "main_build_started",
        StartupPhase::MainWindowCreated => "main_window_created",
        StartupPhase::MainPageLoadStarted => "main_page_load_started",
        StartupPhase::MainPageLoadFinished => "main_page_load_finished",
        StartupPhase::FrontendReady => "frontend_ready",
        StartupPhase::Failed => "failed",
    }
}

fn startup_failure_kind_label(kind: StartupFailureKind) -> &'static str {
    match kind {
        StartupFailureKind::MainThreadTaskStalled => "main_thread_task_stalled",
        StartupFailureKind::MainWebviewBuildHung => "main_webview_build_hung",
        StartupFailureKind::FrontendReadyTimeout => "frontend_ready_timeout",
        StartupFailureKind::MainNavigationFailed => "main_navigation_failed",
        StartupFailureKind::MainWindowMissing => "main_window_missing",
        StartupFailureKind::MainDestroyedDuringStartup => "main_destroyed_during_startup",
        StartupFailureKind::MainCloseRequestedDuringStartup => {
            "main_close_requested_during_startup"
        }
    }
}

fn stage_label(stage: NavigationStage) -> &'static str {
    match stage {
        NavigationStage::Init => "init",
        NavigationStage::LocalBoot => "local_boot",
        NavigationStage::BackendReady => "backend_ready",
        NavigationStage::ControlCenter => "control_center",
        NavigationStage::Diagnostics => "diagnostics",
    }
}

fn route_label(route: Option<LocalRoute>) -> &'static str {
    match route {
        Some(LocalRoute::Loading) => "loading",
        Some(LocalRoute::Onboarding) => "onboarding",
        Some(LocalRoute::Diagnostics) => "diagnostics",
        Some(LocalRoute::ControlCenter) => "control_center",
        None => "none",
    }
}

fn route_path(route: LocalRoute) -> &'static str {
    match route {
        LocalRoute::Loading => "loading",
        LocalRoute::Onboarding => "onboarding",
        LocalRoute::Diagnostics => "diagnostics",
        LocalRoute::ControlCenter => "control-center",
    }
}

fn prefill_status_label(state: PrefillStatusState) -> &'static str {
    match state {
        PrefillStatusState::Idle => "idle",
        PrefillStatusState::OpeningMain => "opening_main",
        PrefillStatusState::StartupFailed => "startup_failed",
    }
}

fn webview_runtime_kind_label(kind: WebviewRuntimeKind) -> &'static str {
    match kind {
        WebviewRuntimeKind::Evergreen => "evergreen",
        WebviewRuntimeKind::Fixed => "fixed",
        WebviewRuntimeKind::Unknown => "unknown",
    }
}

fn current_route(_app: &AppHandle) -> Option<LocalRoute> {
    let lock = shared_navigation_state().lock().ok()?;
    lock.route
}

fn emit_shell_route_event(app: &AppHandle, route: LocalRoute, source: &str) -> bool {
    let payload = ShellRoutePayload {
        route: route_path(route).to_string(),
        source: source.to_string(),
    };

    match app.emit_to(MAIN_WINDOW_LABEL, SHELL_ROUTE_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit shell route event (source={source}, route={}): {error}",
                    route_label(Some(route))
                ),
            );
            false
        }
    }
}

fn emit_prefill_event(app: &AppHandle, payload: &PrefillChatPayload, source: &str) -> bool {
    let text_length = payload.text.chars().count();
    match app.emit_to(MAIN_WINDOW_LABEL, PREFILL_CHAT_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit prefill event (source={source}, request_id={}, text_length={}): {error}",
                    payload.request_id, text_length
                ),
            );
            false
        }
    }
}

fn emit_workspace_session_event(
    app: &AppHandle,
    event_name: &str,
    payload: &WorkspaceSessionBridgePayload,
    source: &str,
) -> bool {
    match app.emit_to(MAIN_WINDOW_LABEL, event_name, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit workspace event (source={source}, event={event_name}, action={}): {error}",
                    payload.action
                ),
            );
            false
        }
    }
}

fn emit_open_request_error_event(
    app: &AppHandle,
    payload: &OpenRequestErrorPayload,
    source: &str,
) -> bool {
    match app.emit_to(MAIN_WINDOW_LABEL, OPEN_REQUEST_ERROR_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit open-request error event (source={source}, stage={}): {error}",
                    payload.stage
                ),
            );
            false
        }
    }
}

fn emit_prefill_status(
    app: &AppHandle,
    state: PrefillStatusState,
    detail: Option<&str>,
    source: &str,
) -> bool {
    let payload = PrefillStatusPayload {
        state,
        detail: detail.map(|value| value.to_string()),
    };

    match app.emit_to(PREFILL_WINDOW_LABEL, PREFILL_STATUS_EVENT, payload) {
        Ok(_) => true,
        Err(error) => {
            log_manager::append_line(
                app,
                format!(
                    "failed to emit prefill status event (source={source}, state={}): {error}",
                    prefill_status_label(state)
                ),
            );
            false
        }
    }
}

fn next_prefill_request_id_locked(state: &mut NavigationState) -> String {
    state.next_prefill_id = state.next_prefill_id.saturating_add(1);
    format!("prefill-{:010}", state.next_prefill_id)
}

fn with_runtime_state<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut crate::app_state::RuntimeState) -> T,
) -> Option<T> {
    let state = app.state::<AppState>();
    let lock = state.runtime.lock();
    let Ok(mut runtime) = lock else {
        log_manager::append_line(app, "runtime state mutex is poisoned");
        return None;
    };
    Some(f(&mut runtime))
}

fn record_startup_trace(app: &AppHandle, event: String) {
    let trace_event = event.clone();
    with_runtime_state(app, move |runtime| {
        runtime.startup_trace.push(trace_event);
        let overflow = runtime
            .startup_trace
            .len()
            .saturating_sub(STARTUP_TRACE_LIMIT);
        if overflow > 0 {
            runtime.startup_trace.drain(0..overflow);
        }
    });
    log_manager::append_line(app, format!("startup trace -> {event}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> PrefillChatPayload {
        PrefillChatPayload {
            request_id: "prefill-0000000001".to_string(),
            text: "hello".to_string(),
            auto_send: true,
        }
    }

    #[test]
    fn prepare_hidden_main_boot_resets_startup_flags_and_increments_attempt() {
        let mut state = NavigationState {
            startup_attempt_id: 4,
            startup_guard_failed: true,
            frontend_ready: true,
            loading_rendered: true,
            ..NavigationState::default()
        };

        prepare_hidden_main_boot_locked(&mut state);

        assert_eq!(state.startup_attempt_id, 5);
        assert!(state.startup_pending);
        assert!(state.main_ready_watchdog_armed);
        assert!(!state.startup_guard_failed);
        assert!(!state.frontend_ready);
        assert!(!state.loading_rendered);
        assert_eq!(state.startup_phase, StartupPhase::MainBootRequested);
    }

    #[test]
    fn can_finalize_handoff_requires_all_latches() {
        let mut state = NavigationState {
            handoff_requested: true,
            frontend_ready: true,
            loading_rendered: false,
            ..NavigationState::default()
        };

        assert!(!can_finalize_handoff_locked(&state));
        state.loading_rendered = true;
        assert!(can_finalize_handoff_locked(&state));
        state.startup_guard_failed = true;
        assert!(!can_finalize_handoff_locked(&state));
    }

    #[test]
    fn reset_for_retry_clears_route_handoff_and_queued_payloads() {
        let mut state = NavigationState {
            stage: NavigationStage::Diagnostics,
            route: Some(LocalRoute::Diagnostics),
            frontend_ready: true,
            loading_rendered: true,
            queued_route: Some(LocalRoute::Onboarding),
            pending_prefill: Some(sample_payload()),
            pending_main_events: vec![QueuedMainEvent::OpenRequestError(OpenRequestErrorPayload {
                source: "test".to_string(),
                stage: "parse".to_string(),
                message: "boom".to_string(),
                args_summary: None,
            })],
            handoff_requested: true,
            startup_pending: true,
            startup_guard_failed: true,
            startup_phase: StartupPhase::Failed,
            ..NavigationState::default()
        };

        reset_for_retry_locked(&mut state);

        assert_eq!(state.stage, NavigationStage::Init);
        assert!(state.route.is_none());
        assert!(state.queued_route.is_none());
        assert!(state.pending_prefill.is_none());
        assert!(state.pending_main_events.is_empty());
        assert!(!state.handoff_requested);
        assert!(!state.frontend_ready);
        assert!(!state.loading_rendered);
        assert!(!state.startup_pending);
        assert!(!state.startup_guard_failed);
    }

    #[test]
    fn request_route_is_queued_until_frontend_ready() {
        let mut state = NavigationState::default();
        let outcome = request_route_locked(&mut state, LocalRoute::ControlCenter);

        match outcome {
            DispatchOutcome::Queued(route, reason) => {
                assert_eq!(route, LocalRoute::ControlCenter);
                assert_eq!(reason, "frontend_not_ready");
            }
            _ => panic!("expected queued outcome"),
        }
        assert_eq!(state.queued_route, Some(LocalRoute::ControlCenter));
    }

    #[test]
    fn next_prefill_id_monotonically_increments() {
        let mut state = NavigationState::default();
        assert_eq!(
            next_prefill_request_id_locked(&mut state),
            "prefill-0000000001"
        );
        assert_eq!(
            next_prefill_request_id_locked(&mut state),
            "prefill-0000000002"
        );
    }
}
