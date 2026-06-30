use std::{
    env,
    ffi::OsString,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::Context;
use tauri::{AppHandle, Manager};

use crate::{
    app_state::{AppState, BridgeProcessState},
    bridge_host_control,
    bridge_http_client::{BindingUpdateInput, BridgeHttpClient},
    bridge_settings_store::{self, DEFAULT_BRIDGE_ADMIN_PORT},
    log_manager, settings_store,
    types::{
        BindingRecord, BridgeApprovalRecord, BridgeApprovalResolveInput, BridgeChannelState,
        BridgeChannelStatus, BridgeConnectorSecretsMaskView, BridgeFeishuSecretsMaskView,
        BridgeMaskedSecretValue, BridgeRuntimeAdapterStatus, BridgeRuntimeLocatorStatus,
        BridgeRuntimeState, BridgeSecretsMaskView, BridgeSessionImportInput, BridgeSessionRecord,
        BridgeSettings, BridgeStatus, BridgeTelegramSecretsMaskView, BridgeWeixinSecretsMaskView,
    },
};

const BRIDGE_START_TIMEOUT: Duration = Duration::from_secs(20);
const BRIDGE_STOP_TIMEOUT: Duration = Duration::from_secs(2);
const BRIDGE_POLL_INTERVAL: Duration = Duration::from_millis(120);
const BRIDGE_START_BIND_RETRY_LIMIT: usize = 1;
const DEV_WORKSPACE_FALLBACK_ENV: &str = "KIMI_DEV_ALLOW_WORKSPACE_FALLBACK";
const BRIDGE_ADMIN_TOKEN_ENV: &str = "KIMI_IM_BRIDGE_ADMIN_TOKEN";
const BRIDGE_ADMIN_TOKEN_FILE_ENV: &str = "KIMI_IM_BRIDGE_ADMIN_TOKEN_FILE";
const BRIDGE_HOST_CONTROL_TOKEN_ENV: &str = "KIMI_IM_BRIDGE_HOST_CONTROL_TOKEN";
const BRIDGE_HOST_CONTROL_TOKEN_FILE_ENV: &str = "KIMI_IM_BRIDGE_HOST_CONTROL_TOKEN_FILE";
const KIMI_APP_RUNTIME_LOCATOR_FILE_ENV: &str = "KIMI_APP_RUNTIME_LOCATOR_FILE";

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone)]
struct ResolvedBridgeAdminPort {
    configured_port: u16,
    launch_port: u16,
    explicit_override: bool,
    fallback_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedSourcePath {
    path: PathBuf,
    source: &'static str,
}

pub fn get_bridge_status(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    refresh_child_state(app)?;
    let settings = bridge_settings_store::load_or_default(app)?;
    let (admin_port, admin_token, runtime_state) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.admin_port,
            runtime.admin_token.clone(),
            runtime.state,
        )
    };

    if matches!(
        runtime_state,
        BridgeRuntimeState::Starting | BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
        match client.get_status() {
            Ok(status) => {
                apply_status_snapshot(app, &status)?;
                return Ok(status);
            }
            Err(error) => {
                if let Ok(mut runtime) = app.state::<AppState>().bridge_runtime.lock() {
                    if runtime.state == BridgeRuntimeState::Running {
                        runtime.state = BridgeRuntimeState::Degraded;
                    }
                    let next_error = format!("bridge status probe failed: {error}");
                    if runtime
                        .last_error_code
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .is_none()
                    {
                        runtime.last_error_code = Some("platform_unavailable".to_string());
                    }
                    runtime.last_error = Some(next_error);
                }
            }
        }
    }

    build_local_status(app, &settings)
}

pub fn start_bridge(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    bridge_settings_store::ensure_bridge_files(app)?;
    refresh_child_state(app)?;

    {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        if matches!(
            runtime.state,
            BridgeRuntimeState::Starting | BridgeRuntimeState::Running
        ) {
            drop(runtime);
            return get_bridge_status(app);
        }
    }

    let settings = bridge_settings_store::load_or_default(app)?;
    let resolved_binary = resolve_bridge_binary_path(app)?;
    let binary_path = resolved_binary.path.clone();
    if let Ok(metadata) = fs::metadata(&binary_path) {
        let modified_secs = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs())
            .unwrap_or(0);
        log_manager::append_line(
            app,
            format!(
                "bridge binary resolved: source={}, size_bytes={}, modified_epoch_utc={}",
                resolved_binary.source,
                metadata.len(),
                modified_secs
            ),
        );
    } else {
        log_manager::append_line(
            app,
            format!("bridge binary resolved: source={}", resolved_binary.source),
        );
    }
    let state = app.state::<AppState>();
    let admin_token = {
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        runtime.admin_token.clone()
    };

    let resolved_port = resolve_bridge_admin_port(app, &settings)?;
    if let Some(reason) = resolved_port.fallback_reason.as_deref() {
        log_manager::append_line(
            app,
            format!(
                "bridge admin port fallback selected: configured_port={}, launch_port={}, reason={reason}",
                resolved_port.configured_port, resolved_port.launch_port
            ),
        );
    } else if !resolved_port.explicit_override {
        log_manager::append_line(
            app,
            format!(
                "bridge admin port auto-selected at startup: launch_port={}",
                resolved_port.launch_port
            ),
        );
    }

    let mut effective_settings = settings.clone();
    effective_settings.admin_port = resolved_port.launch_port;

    let mut attempts = 0usize;
    loop {
        match start_bridge_once(
            app,
            &binary_path,
            resolved_binary.source,
            &effective_settings,
            &admin_token,
        ) {
            Ok(status) => return Ok(status),
            Err(error) => {
                let should_retry = is_bridge_admin_port_bind_failure(&error.to_string())
                    && attempts < BRIDGE_START_BIND_RETRY_LIMIT;
                if !should_retry {
                    return Err(error);
                }

                attempts += 1;
                let previous_port = effective_settings.admin_port;
                let retry_port = select_ephemeral_local_port(Some(previous_port))?;
                log_manager::append_line(
                    app,
                    format!(
                        "bridge admin port bind failed during startup; retrying with a new port (attempt={}, previous_port={}, next_port={})",
                        attempts, previous_port, retry_port
                    ),
                );
                effective_settings.admin_port = retry_port;
            }
        }
    }
}

pub fn stop_bridge(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    let settings = bridge_settings_store::load_or_default(app)?;
    let (runtime_state, admin_port, admin_token, child) = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        let previous_state = runtime.state;
        runtime.state = BridgeRuntimeState::Stopping;
        (
            previous_state,
            runtime.admin_port,
            runtime.admin_token.clone(),
            runtime.child.take(),
        )
    };

    if let Some(mut child) = child {
        let client = if matches!(
            runtime_state,
            BridgeRuntimeState::Starting
                | BridgeRuntimeState::Running
                | BridgeRuntimeState::Degraded
        ) {
            BridgeHttpClient::for_local_admin_port(admin_port, admin_token).ok()
        } else {
            None
        };
        let reason = stop_child_process(&mut child, client.as_ref(), BRIDGE_STOP_TIMEOUT)?;
        log_manager::append_line(app, format!("bridge stop finished ({reason})"));
    }

    {
        let state = app.state::<AppState>();
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        finish_stop_transition(&mut runtime);
        runtime.channels = settings_channels(&settings, BridgeRuntimeState::Stopped);
    }

    build_local_status(app, &settings)
}

pub fn restart_bridge(app: &AppHandle) -> anyhow::Result<BridgeStatus> {
    let _ = stop_bridge(app);
    start_bridge(app)
}

pub fn list_bridge_bindings(app: &AppHandle) -> anyhow::Result<Vec<BindingRecord>> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Ok(Vec::new());
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.list_bindings()
}

pub fn list_bridge_sessions(app: &AppHandle) -> anyhow::Result<Vec<BridgeSessionRecord>> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Ok(Vec::new());
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.list_sessions()
}

pub fn clear_bridge_binding(app: &AppHandle, binding_id: &str) -> anyhow::Result<()> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Err(anyhow::anyhow!("bridge is not running"));
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.clear_binding(binding_id)?;
    Ok(())
}

pub fn reset_bridge_binding_session(app: &AppHandle, binding_id: &str) -> anyhow::Result<()> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Err(anyhow::anyhow!("bridge is not running"));
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    let binding = client
        .list_bindings()?
        .into_iter()
        .find(|item| item.binding_id == binding_id)
        .ok_or_else(|| anyhow::anyhow!("bridge binding not found: {binding_id}"))?;
    let next_session_id = generate_bridge_session_id();
    client.update_binding(
        binding_id,
        &BindingUpdateInput {
            kimi_session_id: next_session_id,
            work_dir: binding.work_dir,
        },
    )?;
    Ok(())
}

pub fn reset_bridge_binding_to_default_work_dir(
    app: &AppHandle,
    binding_id: &str,
) -> anyhow::Result<()> {
    refresh_child_state(app)?;
    let settings = bridge_settings_store::load_or_default(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Err(anyhow::anyhow!("bridge is not running"));
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    let binding = client
        .list_bindings()?
        .into_iter()
        .find(|item| item.binding_id == binding_id)
        .ok_or_else(|| anyhow::anyhow!("bridge binding not found: {binding_id}"))?;
    let default_work_dir = resolve_connector_default_work_dir(&settings, &binding.connector_id)
        .ok_or_else(|| anyhow::anyhow!("IM bridge default work directory is not configured"))?;
    let next_session_id = generate_bridge_session_id();
    client.update_binding(
        binding_id,
        &BindingUpdateInput {
            kimi_session_id: next_session_id,
            work_dir: Some(default_work_dir.clone()),
        },
    )?;
    log_manager::append_line(
        app,
        format!(
            "bridge binding reset to default workdir requested (binding_id={}, previous_work_dir={}, next_work_dir={})",
            binding_id,
            binding.work_dir.as_deref().unwrap_or("<none>"),
            default_work_dir
        ),
    );
    Ok(())
}

pub fn list_bridge_approvals(
    app: &AppHandle,
    status: Option<&str>,
) -> anyhow::Result<Vec<BridgeApprovalRecord>> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Ok(Vec::new());
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.list_approvals(status)
}

pub fn resolve_bridge_approval(
    app: &AppHandle,
    input: &BridgeApprovalResolveInput,
) -> anyhow::Result<()> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Err(anyhow::anyhow!("bridge is not running"));
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.resolve_approval(input)?;
    Ok(())
}

pub fn import_bridge_session(
    app: &AppHandle,
    input: &BridgeSessionImportInput,
) -> anyhow::Result<BridgeSessionRecord> {
    refresh_child_state(app)?;
    let (runtime_state, admin_port, admin_token) = {
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        (
            runtime.state,
            runtime.admin_port,
            runtime.admin_token.clone(),
        )
    };

    if !matches!(
        runtime_state,
        BridgeRuntimeState::Running | BridgeRuntimeState::Degraded
    ) {
        return Err(anyhow::anyhow!("bridge is not running"));
    }

    let client = BridgeHttpClient::for_local_admin_port(admin_port, admin_token)?;
    client.import_session(input)
}

pub fn get_bridge_log_tail(
    app: &AppHandle,
    max_lines: Option<usize>,
) -> anyhow::Result<Vec<String>> {
    let path = log_manager::bridge_log_path(app)?;
    let limit = max_lines.unwrap_or(80).clamp(1, 400);
    let secrets = bridge_redaction_values(app, None);
    Ok(log_manager::read_log_tail(&path, limit)
        .into_iter()
        .map(|line| redact_bridge_log_line(&line, &secrets))
        .collect())
}

pub fn get_bridge_secrets_mask_view(app: &AppHandle) -> anyhow::Result<BridgeSecretsMaskView> {
    let secrets = bridge_settings_store::load_secrets_or_default(app)?;
    let settings = bridge_settings_store::load_or_default(app)?;
    Ok(BridgeSecretsMaskView {
        connectors: settings
            .connectors
            .iter()
            .map(|connector| {
                let connector_secrets = secrets.connectors.get(&connector.id);
                BridgeConnectorSecretsMaskView {
                    connector_id: connector.id.clone(),
                    connector_label: connector.label.clone(),
                    platform: connector.platform,
                    telegram: connector_secrets
                        .and_then(|item| item.telegram.as_ref())
                        .map(|telegram| BridgeTelegramSecretsMaskView {
                            bot_token: mask_optional_secret(Some(
                                telegram.bot_token.as_deref().unwrap_or_default(),
                            )),
                        }),
                    feishu: connector_secrets
                        .and_then(|item| item.feishu.as_ref())
                        .map(|feishu| BridgeFeishuSecretsMaskView {
                            app_id: mask_optional_secret(Some(
                                feishu.app_id.as_deref().unwrap_or_default(),
                            )),
                            app_secret: mask_optional_secret(Some(
                                feishu.app_secret.as_deref().unwrap_or_default(),
                            )),
                            verification_token: mask_optional_secret(Some(
                                feishu.verification_token.as_deref().unwrap_or_default(),
                            )),
                            encrypt_key: mask_optional_secret(Some(
                                feishu.encrypt_key.as_deref().unwrap_or_default(),
                            )),
                        }),
                    weixin: connector_secrets
                        .and_then(|item| item.weixin.as_ref())
                        .map(|weixin| BridgeWeixinSecretsMaskView {
                            bot_token: mask_optional_secret(Some(
                                weixin.bot_token.as_deref().unwrap_or_default(),
                            )),
                            base_url: weixin.base_url.clone(),
                            account_id: weixin.account_id.clone(),
                            owner_user_id: weixin.owner_user_id.clone(),
                        }),
                }
            })
            .collect(),
        telegram: BridgeTelegramSecretsMaskView {
            bot_token: mask_optional_secret(Some(
                secrets.telegram.bot_token.as_deref().unwrap_or_default(),
            )),
        },
        feishu: BridgeFeishuSecretsMaskView {
            app_id: mask_optional_secret(Some(
                secrets.feishu.app_id.as_deref().unwrap_or_default(),
            )),
            app_secret: mask_optional_secret(Some(
                secrets.feishu.app_secret.as_deref().unwrap_or_default(),
            )),
            verification_token: mask_optional_secret(Some(
                secrets
                    .feishu
                    .verification_token
                    .as_deref()
                    .unwrap_or_default(),
            )),
            encrypt_key: mask_optional_secret(Some(
                secrets.feishu.encrypt_key.as_deref().unwrap_or_default(),
            )),
        },
        weixin: BridgeWeixinSecretsMaskView {
            bot_token: mask_optional_secret(Some(
                secrets.weixin.bot_token.as_deref().unwrap_or_default(),
            )),
            base_url: secrets.weixin.base_url,
            account_id: secrets.weixin.account_id,
            owner_user_id: secrets.weixin.owner_user_id,
        },
    })
}

fn start_bridge_once(
    app: &AppHandle,
    binary_path: &Path,
    binary_source: &str,
    settings: &BridgeSettings,
    admin_token: &str,
) -> anyhow::Result<BridgeStatus> {
    let state = app.state::<AppState>();
    let mut command = build_bridge_command(app, binary_path, settings, admin_token)?;
    log_manager::append_line(
        app,
        format!(
            "bridge spawn command prepared: binary_source={}, config={}, secrets={}, db={}, admin_port={}",
            binary_source,
            state.bridge_settings_path.display(),
            state.bridge_secrets_path.display(),
            state.bridge_db_path.display(),
            settings.admin_port
        ),
    );
    let mut child = command
        .spawn()
        .with_context(|| format!("failed to spawn bridge sidecar from {binary_source}"))?;
    spawn_bridge_stdio_redactors(
        app,
        &mut child,
        bridge_redaction_values(app, Some(admin_token)),
    )?;
    let pid = child.id();

    {
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        begin_start_transition(
            &mut runtime,
            settings.admin_port,
            binary_path.to_path_buf(),
            pid,
        );
        runtime.child = Some(child);
        runtime.channels = settings_channels(settings, BridgeRuntimeState::Starting);
    }

    log_manager::append_line(
        app,
        format!(
            "bridge start requested (pid={pid}, admin_port={})",
            settings.admin_port
        ),
    );

    let client = BridgeHttpClient::for_local_admin_port(settings.admin_port, admin_token)?;
    if let Err(error) = wait_for_bridge_ready(app, &client) {
        cleanup_failed_start(app, error.to_string())?;
        return Err(error);
    }
    let status = match wait_for_bridge_status(app, &client) {
        Ok(status) => status,
        Err(error) => {
            if let Some(status) =
                recover_start_after_status_probe_failure(app, settings, &client, &error)?
            {
                return Ok(status);
            }
            cleanup_failed_start(app, error.to_string())?;
            return Err(error);
        }
    };
    apply_status_snapshot(app, &status)?;
    let rotated_count = rotate_binding_sessions_on_bridge_start(app, settings, &client)?;
    if rotated_count > 0 {
        log_manager::append_line(
            app,
            format!(
                "bridge session rotation completed on start (bindings_rotated={rotated_count})"
            ),
        );
    }
    log_manager::append_line(
        app,
        format!(
            "bridge ready (pid={}, state={:?}, bindings={})",
            status.pid.unwrap_or(pid),
            status.state,
            status.bindings
        ),
    );
    Ok(status)
}

fn resolve_bridge_admin_port(
    app: &AppHandle,
    settings: &BridgeSettings,
) -> anyhow::Result<ResolvedBridgeAdminPort> {
    let app_settings = settings_store::load_or_default(app)?;
    let configured_port = if settings.admin_port == 0 {
        DEFAULT_BRIDGE_ADMIN_PORT
    } else {
        settings.admin_port
    };
    let explicit_override = app_settings.bridge_admin_port_override.is_some()
        || configured_port != DEFAULT_BRIDGE_ADMIN_PORT;

    if !explicit_override {
        return Ok(ResolvedBridgeAdminPort {
            configured_port,
            launch_port: select_ephemeral_local_port(None)?,
            explicit_override,
            fallback_reason: None,
        });
    }

    match probe_local_port(configured_port) {
        Ok(()) => Ok(ResolvedBridgeAdminPort {
            configured_port,
            launch_port: configured_port,
            explicit_override,
            fallback_reason: None,
        }),
        Err(error) => Ok(ResolvedBridgeAdminPort {
            configured_port,
            launch_port: select_ephemeral_local_port(Some(configured_port))?,
            explicit_override,
            fallback_reason: Some(error),
        }),
    }
}

fn probe_local_port(port: u16) -> Result<(), String> {
    TcpListener::bind(("127.0.0.1", port))
        .map(|listener| drop(listener))
        .map_err(|error| {
            format!(
                "requested admin port {port} is unavailable: {}",
                describe_bridge_bind_failure(&error.to_string())
            )
        })
}

fn select_ephemeral_local_port(exclude: Option<u16>) -> anyhow::Result<u16> {
    for _ in 0..16 {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .context("failed to bind an ephemeral localhost port for bridge admin")?;
        let port = listener
            .local_addr()
            .context("failed to read ephemeral bridge admin port")?
            .port();
        drop(listener);
        if exclude != Some(port) {
            return Ok(port);
        }
    }

    anyhow::bail!("failed to choose a distinct ephemeral bridge admin port")
}

fn build_bridge_command(
    app: &AppHandle,
    binary_path: &Path,
    settings: &BridgeSettings,
    admin_token: &str,
) -> anyhow::Result<Command> {
    let state = app.state::<AppState>();
    let mut command = Command::new(binary_path);
    command
        .arg("--config")
        .arg(&state.bridge_settings_path)
        .arg("--secrets")
        .arg(&state.bridge_secrets_path)
        .arg("--db")
        .arg(&state.bridge_db_path)
        .arg("--log-file")
        .arg(log_manager::bridge_log_path(app)?)
        .arg("--admin-port")
        .arg(settings.admin_port.to_string())
        .arg("--kimi-runtime-locator")
        .arg(&state.runtime_locator_path)
        .env(
            KIMI_APP_RUNTIME_LOCATOR_FILE_ENV,
            &state.runtime_locator_path,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_bridge_token_env(&mut command, admin_token, None);

    match bridge_host_control::ensure_running(app) {
        Ok(port) => {
            command
                .arg("--host-control-url")
                .arg(format!("http://127.0.0.1:{port}"));
            configure_bridge_token_env(&mut command, admin_token, Some(admin_token));
        }
        Err(error) => {
            log_manager::append_line(
                app,
                format!("bridge host control unavailable; restart via Feishu ops will be disabled: {error:#}"),
            );
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    Ok(command)
}

fn configure_bridge_token_env(
    command: &mut Command,
    admin_token: &str,
    host_control_token: Option<&str>,
) {
    command
        .env_remove(BRIDGE_ADMIN_TOKEN_FILE_ENV)
        .env(BRIDGE_ADMIN_TOKEN_ENV, admin_token)
        .env_remove(BRIDGE_HOST_CONTROL_TOKEN_FILE_ENV);
    match host_control_token {
        Some(token) => {
            command.env(BRIDGE_HOST_CONTROL_TOKEN_ENV, token);
        }
        None => {
            command.env_remove(BRIDGE_HOST_CONTROL_TOKEN_ENV);
        }
    }
}

fn spawn_bridge_stdio_redactors(
    app: &AppHandle,
    child: &mut Child,
    secrets: Vec<String>,
) -> anyhow::Result<()> {
    let path = log_manager::bridge_log_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create bridge log directory before stdio setup: {}",
                parent.display()
            )
        })?;
    }
    if let Some(stdout) = child.stdout.take() {
        spawn_bridge_stdio_redactor(path.clone(), stdout, secrets.clone(), "stdout");
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_bridge_stdio_redactor(path, stderr, secrets, "stderr");
    }
    Ok(())
}

fn spawn_bridge_stdio_redactor<R>(
    path: PathBuf,
    reader: R,
    secrets: Vec<String>,
    stream_name: &'static str,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&path) else {
            return;
        };
        let mut reader = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let redacted = redact_bridge_log_line(&line, &secrets);
                    if write!(file, "[bridge {stream_name}] {redacted}").is_err() {
                        break;
                    }
                    if !redacted.ends_with('\n') && writeln!(file).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn resolve_bridge_binary_path(app: &AppHandle) -> anyhow::Result<ResolvedSourcePath> {
    let env_override = std::env::var_os("KIMI_IM_BRIDGE_BIN").map(PathBuf::from);
    let dev_path = development_binary_path();
    let resource_dir = app.path().resource_dir().ok();
    resolve_bridge_binary_from_sources(
        env_override,
        dev_path,
        resource_dir,
        dev_workspace_fallback_enabled(),
    )
}

fn resolve_bridge_binary_from_sources(
    env_override: Option<PathBuf>,
    development_path: PathBuf,
    resource_dir: Option<PathBuf>,
    allow_workspace_fallback: bool,
) -> anyhow::Result<ResolvedSourcePath> {
    if let Some(path) = env_override {
        if path.exists() {
            return Ok(ResolvedSourcePath {
                path,
                source: "env_override",
            });
        }
        return Err(anyhow::anyhow!(
            "bridge binary not found: env override KIMI_IM_BRIDGE_BIN points to a missing file"
        ));
    }

    let mut checked = Vec::new();
    if let Some(resource_dir) = resource_dir {
        let resource_candidates = vec![
            (
                "resource_bundle:binaries",
                resource_dir.join("binaries").join(binary_name()),
            ),
            ("resource_bundle:root", resource_dir.join(binary_name())),
        ];
        for (source, candidate) in resource_candidates {
            if candidate.exists() {
                return Ok(ResolvedSourcePath {
                    path: candidate,
                    source,
                });
            }
            checked.push(format!("{source}:missing"));
        }
    } else {
        checked.push("resource_bundle:unavailable".to_string());
    }
    if allow_workspace_fallback {
        if development_path.exists() {
            return Ok(ResolvedSourcePath {
                path: development_path,
                source: "workspace_fallback",
            });
        }
        checked.push("workspace_fallback:missing".to_string());
    } else {
        checked.push("workspace_fallback:disabled".to_string());
    }
    Err(anyhow::anyhow!(
        "bridge binary not found; checked_sources={}",
        checked.join(", ")
    ))
}

fn development_binary_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("kimi-im-bridge")
        .join("bin")
        .join(binary_name())
}

fn binary_name() -> OsString {
    #[cfg(windows)]
    {
        return OsString::from("kimi-im-bridge.exe");
    }

    #[cfg(not(windows))]
    {
        OsString::from("kimi-im-bridge")
    }
}

fn rotate_binding_sessions_on_bridge_start(
    app: &AppHandle,
    settings: &BridgeSettings,
    client: &BridgeHttpClient,
) -> anyhow::Result<usize> {
    let bindings = client.list_bindings()?;
    if bindings.is_empty() {
        return Ok(0);
    }

    let mut rotated = 0usize;
    let mut failures = 0usize;
    for binding in &bindings {
        let should_rotate = settings
            .connectors
            .iter()
            .find(|connector| connector.id == binding.connector_id)
            .and_then(|connector| connector.reset_binding_session_on_start)
            .unwrap_or(settings.reset_binding_session_on_bridge_start);
        if !should_rotate {
            continue;
        }
        let next_session_id = generate_bridge_session_id();
        if let Err(error) = client
            .update_binding(
                &binding.binding_id,
                &BindingUpdateInput {
                    kimi_session_id: next_session_id,
                    work_dir: binding.work_dir.clone(),
                },
            )
            .with_context(|| {
                format!(
                    "failed to rotate bridge session on start for binding {}",
                    binding.binding_id
                )
            })
        {
            failures += 1;
            log_manager::append_line(
                app,
                format!(
                    "bridge session rotation skipped after error (binding_id={}, connector_id={}, error={error:#})",
                    binding.binding_id, binding.connector_id
                ),
            );
            continue;
        }
        rotated += 1;
    }

    if rotated > 0 {
        log_manager::append_line(
            app,
            format!(
                "bridge session rotation requested on start (bindings_rotated={rotated}, bindings_found={})",
                bindings.len()
            ),
        );
    }
    if failures > 0 {
        log_manager::append_line(
            app,
            format!(
                "bridge session rotation completed with partial failures (bindings_rotated={rotated}, failures={failures}, bindings_found={})",
                bindings.len()
            ),
        );
    }
    Ok(rotated)
}

fn generate_bridge_session_id() -> String {
    let epoch_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let entropy = rand::random::<u64>();
    format!("bridge-{epoch_ms:x}-{entropy:016x}")
}

fn wait_for_bridge_ready(app: &AppHandle, client: &BridgeHttpClient) -> anyhow::Result<()> {
    let deadline = Instant::now() + BRIDGE_START_TIMEOUT;
    loop {
        if client.healthz().is_ok() {
            return Ok(());
        }

        refresh_child_state(app)?;
        let state = app.state::<AppState>();
        let runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        if runtime.state == BridgeRuntimeState::Crashed {
            return Err(anyhow::anyhow!(runtime.last_error.clone().unwrap_or_else(
                || "bridge crashed before becoming ready".to_string()
            )));
        }
        drop(runtime);

        if Instant::now() >= deadline {
            let message = "bridge did not become ready within startup timeout".to_string();
            record_failure(app, &message)?;
            return Err(anyhow::anyhow!(message));
        }
        thread::sleep(BRIDGE_POLL_INTERVAL);
    }
}

fn wait_for_bridge_status(
    app: &AppHandle,
    client: &BridgeHttpClient,
) -> anyhow::Result<BridgeStatus> {
    let deadline = Instant::now() + BRIDGE_START_TIMEOUT;
    loop {
        match client.get_status() {
            Ok(status) => return Ok(status),
            Err(error) => {
                refresh_child_state(app)?;
                let state = app.state::<AppState>();
                let runtime = state
                    .bridge_runtime
                    .lock()
                    .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
                if runtime.state == BridgeRuntimeState::Crashed {
                    return Err(anyhow::anyhow!(runtime.last_error.clone().unwrap_or_else(
                        || "bridge crashed before status became available".to_string()
                    )));
                }
                drop(runtime);

                if Instant::now() >= deadline {
                    return Err(anyhow::anyhow!(
                        "bridge status did not become available within startup timeout: {error}"
                    ));
                }
            }
        }
        thread::sleep(BRIDGE_POLL_INTERVAL);
    }
}

fn recover_start_after_status_probe_failure(
    app: &AppHandle,
    settings: &BridgeSettings,
    client: &BridgeHttpClient,
    error: &anyhow::Error,
) -> anyhow::Result<Option<BridgeStatus>> {
    refresh_child_state(app)?;
    {
        let state = app.state::<AppState>();
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        if runtime.state == BridgeRuntimeState::Crashed || runtime.child.is_none() {
            return Ok(None);
        }
        if client.healthz().is_err() {
            return Ok(None);
        }
        runtime.state = BridgeRuntimeState::Degraded;
        runtime.last_error_code = Some("platform_unavailable".to_string());
        runtime.last_error = Some(format!("bridge status probe failed after startup: {error}"));
    }
    log_manager::append_line(
        app,
        format!("bridge started but status probe failed; keep process running: {error}"),
    );
    let status = build_local_status(app, settings)?;
    Ok(Some(status))
}

fn apply_status_snapshot(app: &AppHandle, status: &BridgeStatus) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
    apply_status_transition(&mut runtime, status);
    Ok(())
}

fn build_local_status(app: &AppHandle, settings: &BridgeSettings) -> anyhow::Result<BridgeStatus> {
    let state = app.state::<AppState>();
    let runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;

    let connectors = local_status_channels(settings, &runtime.channels, runtime.state);

    Ok(BridgeStatus {
        state: runtime.state,
        started_at: runtime.started_at.clone(),
        pid: runtime.pid,
        admin_port: if runtime.admin_port == 0 {
            settings.admin_port
        } else {
            runtime.admin_port
        },
        version: runtime.version.clone(),
        kimi_runtime_locator: BridgeRuntimeLocatorStatus::default(),
        runtime_adapter: BridgeRuntimeAdapterStatus::default(),
        connectors,
        pending_approvals: runtime.pending_approvals,
        bindings: runtime.bindings,
        last_error_code: runtime.last_error_code.clone(),
        last_error: runtime.last_error.clone(),
    })
}

fn local_status_channels(
    settings: &BridgeSettings,
    runtime_channels: &[BridgeChannelStatus],
    runtime_state: BridgeRuntimeState,
) -> Vec<BridgeChannelStatus> {
    if runtime_channels.is_empty() {
        return settings_channels(settings, runtime_state);
    }

    match runtime_state {
        BridgeRuntimeState::Degraded | BridgeRuntimeState::Crashed => {
            settings_channels(settings, runtime_state)
        }
        _ => merge_channels(settings, runtime_channels, runtime_state),
    }
}

fn merge_channels(
    settings: &BridgeSettings,
    runtime_channels: &[BridgeChannelStatus],
    runtime_state: BridgeRuntimeState,
) -> Vec<BridgeChannelStatus> {
    settings
        .connectors
        .iter()
        .map(|connector| {
            runtime_channels
                .iter()
                .find(|item| item.connector_id == connector.id)
                .cloned()
                .unwrap_or_else(|| BridgeChannelStatus {
                    connector_id: connector.id.clone(),
                    connector_label: connector.label.clone(),
                    platform: connector.platform,
                    enabled: connector.enabled,
                    state: default_channel_state(connector.enabled, runtime_state),
                    last_heartbeat_at: None,
                    last_inbound_at: None,
                    last_outbound_at: None,
                    last_offset: None,
                    last_error_code: None,
                    last_error: None,
                    last_ready_at: None,
                    last_failure_at: None,
                    last_failure_operation: None,
                    last_failure_retryable: None,
                    consecutive_failures: None,
                    next_retry_at: None,
                    last_recovery_at: None,
                    recovery_hint: None,
                })
        })
        .collect()
}

fn settings_channels(
    settings: &BridgeSettings,
    runtime_state: BridgeRuntimeState,
) -> Vec<BridgeChannelStatus> {
    settings
        .connectors
        .iter()
        .map(|connector| BridgeChannelStatus {
            connector_id: connector.id.clone(),
            connector_label: connector.label.clone(),
            platform: connector.platform,
            enabled: connector.enabled,
            state: default_channel_state(connector.enabled, runtime_state),
            last_heartbeat_at: None,
            last_inbound_at: None,
            last_outbound_at: None,
            last_offset: None,
            last_error_code: None,
            last_error: None,
            last_ready_at: None,
            last_failure_at: None,
            last_failure_operation: None,
            last_failure_retryable: None,
            consecutive_failures: None,
            next_retry_at: None,
            last_recovery_at: None,
            recovery_hint: None,
        })
        .collect()
}

fn resolve_connector_default_work_dir(
    settings: &BridgeSettings,
    connector_id: &str,
) -> Option<String> {
    settings
        .connectors
        .iter()
        .find(|connector| connector.id == connector_id)
        .and_then(|connector| connector.default_work_dir.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            settings
                .default_work_dir
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn dev_workspace_fallback_enabled() -> bool {
    env_flag_enabled(env::var(DEV_WORKSPACE_FALLBACK_ENV).ok().as_deref())
}

fn env_flag_enabled(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(|value| value.to_ascii_lowercase())
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn default_channel_state(enabled: bool, runtime_state: BridgeRuntimeState) -> BridgeChannelState {
    if !enabled {
        return BridgeChannelState::Idle;
    }

    match runtime_state {
        BridgeRuntimeState::Starting => BridgeChannelState::Connecting,
        BridgeRuntimeState::Running => BridgeChannelState::Ready,
        BridgeRuntimeState::Degraded | BridgeRuntimeState::Crashed => BridgeChannelState::Degraded,
        _ => BridgeChannelState::Idle,
    }
}

fn refresh_child_state(app: &AppHandle) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;

    let mut exit_message = None;
    let mut stopping_exit = false;
    if let Some(child) = runtime.child.as_mut() {
        match child.try_wait() {
            Ok(Some(status)) => {
                runtime.child = None;
                runtime.pid = None;
                if runtime.state == BridgeRuntimeState::Stopping {
                    stopping_exit = true;
                } else {
                    exit_message = Some(enrich_bridge_failure_message(
                        app,
                        &format!("bridge sidecar exited: {status}"),
                    ));
                }
            }
            Ok(None) => {}
            Err(error) => {
                exit_message = Some(enrich_bridge_failure_message(
                    app,
                    &format!("failed to inspect bridge process: {error}"),
                ));
                runtime.child = None;
                runtime.pid = None;
            }
        }
    }

    if stopping_exit {
        finish_stop_transition(&mut runtime);
    } else if let Some(message) = exit_message {
        runtime.state = BridgeRuntimeState::Crashed;
        runtime.last_error_code = Some("platform_unavailable".to_string());
        runtime.last_error = Some(message);
    }

    Ok(())
}

fn record_failure(app: &AppHandle, message: &str) -> anyhow::Result<()> {
    let state = app.state::<AppState>();
    let mut runtime = state
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
    runtime.state = BridgeRuntimeState::Crashed;
    runtime.child = None;
    runtime.pid = None;
    runtime.last_error_code = Some("platform_unavailable".to_string());
    runtime.last_error = Some(enrich_bridge_failure_message(app, message));
    Ok(())
}

fn cleanup_failed_start(app: &AppHandle, message: String) -> anyhow::Result<()> {
    let detailed_message = enrich_bridge_failure_message(app, &message);
    let child = {
        let state = app.state::<AppState>();
        let mut runtime = state
            .bridge_runtime
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))?;
        runtime.state = BridgeRuntimeState::Crashed;
        runtime.last_error_code = Some("platform_unavailable".to_string());
        runtime.last_error = Some(detailed_message.clone());
        runtime.pid = None;
        runtime.child.take()
    };

    if let Some(mut child) = child {
        let _ = terminate_child(&mut child, Duration::from_millis(250));
    }

    log_manager::append_line(app, format!("bridge start failed: {detailed_message}"));
    Ok(())
}

fn enrich_bridge_failure_message(app: &AppHandle, message: &str) -> String {
    let secrets = bridge_redaction_values(app, None);
    let tail = log_manager::read_log_tail(&app.state::<AppState>().bridge_log_path, 12);
    let relevant = tail
        .into_iter()
        .map(|line| redact_bridge_log_line(&line, &secrets))
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default();
    let mut enriched = if relevant.is_empty() {
        message.to_string()
    } else {
        format!("{message}; recent bridge log: {relevant}")
    };
    if let Some(hint) = bridge_bind_failure_hint(&enriched) {
        enriched.push_str("; hint: ");
        enriched.push_str(hint);
    }
    enriched
}

fn is_bridge_admin_port_bind_failure(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    (normalized.contains("listen tcp") || normalized.contains("address already in use"))
        && (normalized.contains("bind:")
            || normalized.contains("access permissions")
            || normalized.contains("forbidden by its access permissions")
            || normalized.contains("only one usage of each socket address"))
}

fn bridge_bind_failure_hint(message: &str) -> Option<&'static str> {
    if !is_bridge_admin_port_bind_failure(message) {
        return None;
    }
    Some(
        "bridge admin port bind failed; on Windows this is often caused by an excluded port range created by Docker Desktop, WSL2, or Hyper-V. The shell will try a fallback port automatically.",
    )
}

fn describe_bridge_bind_failure(message: &str) -> String {
    let trimmed = message.trim();
    if let Some(hint) = bridge_bind_failure_hint(trimmed) {
        return format!("{trimmed}; {hint}");
    }
    trimmed.to_string()
}

fn begin_start_transition(
    runtime: &mut BridgeProcessState,
    admin_port: u16,
    binary_path: PathBuf,
    pid: u32,
) {
    runtime.state = BridgeRuntimeState::Starting;
    runtime.admin_port = if admin_port == 0 {
        DEFAULT_BRIDGE_ADMIN_PORT
    } else {
        admin_port
    };
    runtime.pid = Some(pid);
    runtime.binary_path = Some(binary_path);
    runtime.started_at = Some(now_epoch_string());
    runtime.version = None;
    runtime.last_error_code = None;
    runtime.last_error = None;
    runtime.bindings = 0;
    runtime.pending_approvals = 0;
}

fn apply_status_transition(runtime: &mut BridgeProcessState, status: &BridgeStatus) {
    runtime.state = status.state;
    runtime.admin_port = status.admin_port;
    runtime.pid = status.pid;
    runtime.started_at = status.started_at.clone();
    runtime.version = status.version.clone();
    runtime.last_error_code = status.last_error_code.clone();
    runtime.last_error = status.last_error.clone();
    runtime.channels = status.connectors.clone();
    runtime.bindings = status.bindings;
    runtime.pending_approvals = status.pending_approvals;
}

fn finish_stop_transition(runtime: &mut BridgeProcessState) {
    runtime.state = BridgeRuntimeState::Stopped;
    runtime.child = None;
    runtime.pid = None;
    runtime.started_at = None;
}

fn terminate_child(child: &mut Child, timeout: Duration) -> anyhow::Result<&'static str> {
    let pid = child.id();
    soft_terminate(pid);
    if wait_for_child_exit(child, timeout)? {
        return Ok("graceful_exit");
    }

    force_terminate(pid);
    let _ = wait_for_child_exit(child, Duration::from_secs(1));
    let _ = child.wait();
    Ok("force_kill")
}

fn stop_child_process(
    child: &mut Child,
    client: Option<&BridgeHttpClient>,
    timeout: Duration,
) -> anyhow::Result<&'static str> {
    if let Some(client) = client {
        match client.stop_runtime() {
            Ok(()) => {
                if wait_for_child_exit(child, timeout)? {
                    return Ok("cooperative_exit");
                }
            }
            Err(error) => {
                let _ = error;
            }
        }
    }

    terminate_child(child, timeout)
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> anyhow::Result<bool> {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(true),
            Ok(None) => {
                if Instant::now() >= deadline {
                    return Ok(false);
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                return Err(anyhow::anyhow!(
                    "failed to query bridge child exit status: {error}"
                ));
            }
        }
    }
}

fn now_epoch_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn mask_optional_secret(value: Option<&str>) -> BridgeMaskedSecretValue {
    let trimmed = value.unwrap_or_default().trim();
    if trimmed.is_empty() {
        return BridgeMaskedSecretValue {
            configured: false,
            masked_value: None,
        };
    }

    BridgeMaskedSecretValue {
        configured: true,
        masked_value: Some(mask_secret_value(trimmed)),
    }
}

fn mask_secret_value(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() < 6 {
        return "***".to_string();
    }

    let prefix: String = chars.iter().take(3).collect();
    let suffix: String = chars[chars.len().saturating_sub(2)..].iter().collect();
    format!("{prefix}***{suffix}")
}

fn bridge_redaction_values(app: &AppHandle, extra_secret: Option<&str>) -> Vec<String> {
    let mut values = Vec::new();
    push_bridge_redaction_value(&mut values, extra_secret);

    if let Ok(runtime) = app
        .state::<AppState>()
        .bridge_runtime
        .lock()
        .map_err(|_| anyhow::anyhow!("bridge runtime mutex is poisoned"))
    {
        push_bridge_redaction_value(&mut values, Some(runtime.admin_token.as_str()));
    }

    if let Ok(secrets) = bridge_settings_store::load_secrets_or_default(app) {
        push_bridge_secret_values(
            &mut values,
            &secrets.telegram,
            &secrets.feishu,
            &secrets.weixin,
        );
        for connector in secrets.connectors.values() {
            if let Some(telegram) = &connector.telegram {
                push_bridge_redaction_value(&mut values, telegram.bot_token.as_deref());
            }
            if let Some(feishu) = &connector.feishu {
                push_bridge_redaction_value(&mut values, feishu.app_secret.as_deref());
                push_bridge_redaction_value(&mut values, feishu.verification_token.as_deref());
                push_bridge_redaction_value(&mut values, feishu.encrypt_key.as_deref());
            }
            if let Some(weixin) = &connector.weixin {
                push_bridge_redaction_value(&mut values, weixin.bot_token.as_deref());
            }
        }
    }

    values.sort_by(|left, right| right.len().cmp(&left.len()).then_with(|| left.cmp(right)));
    values.dedup();
    values
}

fn push_bridge_secret_values(
    values: &mut Vec<String>,
    telegram: &crate::types::BridgeTelegramSecrets,
    feishu: &crate::types::BridgeFeishuSecrets,
    weixin: &crate::types::BridgeWeixinSecrets,
) {
    push_bridge_redaction_value(values, telegram.bot_token.as_deref());
    push_bridge_redaction_value(values, feishu.app_secret.as_deref());
    push_bridge_redaction_value(values, feishu.verification_token.as_deref());
    push_bridge_redaction_value(values, feishu.encrypt_key.as_deref());
    push_bridge_redaction_value(values, weixin.bot_token.as_deref());
}

fn push_bridge_redaction_value(values: &mut Vec<String>, value: Option<&str>) {
    let Some(value) = value else {
        return;
    };
    let trimmed = value.trim();
    if trimmed.len() >= 4 {
        values.push(trimmed.to_string());
    }
}

fn redact_bridge_log_line(line: &str, secrets: &[String]) -> String {
    let mut redacted = line.to_string();
    let mut ordered = secrets.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| right.len().cmp(&left.len()));
    for secret in ordered {
        redacted = redacted.replace(secret, "[REDACTED]");
    }
    redacted
}

#[cfg(unix)]
fn soft_terminate(pid: u32) {
    use nix::{sys::signal, unistd::Pid};
    let _ = signal::kill(Pid::from_raw(pid as i32), signal::Signal::SIGTERM);
}

#[cfg(unix)]
fn force_terminate(pid: u32) {
    use nix::{sys::signal, unistd::Pid};
    let _ = signal::kill(Pid::from_raw(pid as i32), signal::Signal::SIGKILL);
}

#[cfg(windows)]
fn soft_terminate(pid: u32) {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let _ = command.status();
}

#[cfg(windows)]
fn force_terminate(pid: u32) {
    use std::os::windows::process::CommandExt;
    let mut command = Command::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    let _ = command.status();
}

#[cfg(not(any(unix, windows)))]
fn soft_terminate(_pid: u32) {}

#[cfg(not(any(unix, windows)))]
fn force_terminate(_pid: u32) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use crate::types::{
        BridgeChannelMode, BridgeConnectorConfig, BridgePlatform, BridgeSkillsMode,
    };

    struct TempDirGuard {
        path: PathBuf,
    }

    impl TempDirGuard {
        fn new(label: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "kimi-shell-bridge-manager-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("temp dir should be created");
            Self { path }
        }
    }

    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn resolve_binary_prefers_env_override_before_other_candidates() {
        let temp = TempDirGuard::new("binary-priority");
        let env_path = temp.path.join("env").join(binary_name());
        let dev_path = temp.path.join("dev").join(binary_name());
        let resource_dir = temp.path.join("resource");

        fs::create_dir_all(env_path.parent().expect("env parent")).expect("env parent");
        fs::create_dir_all(dev_path.parent().expect("dev parent")).expect("dev parent");
        fs::create_dir_all(resource_dir.join("binaries")).expect("resource parent");
        fs::write(&env_path, b"env").expect("env binary");
        fs::write(&dev_path, b"dev").expect("dev binary");
        fs::write(
            resource_dir.join("binaries").join(binary_name()),
            b"resource",
        )
        .expect("resource binary");

        let resolved = resolve_bridge_binary_from_sources(
            Some(env_path.clone()),
            dev_path,
            Some(resource_dir),
            false,
        )
        .expect("binary should resolve");

        assert_eq!(
            resolved,
            ResolvedSourcePath {
                path: env_path,
                source: "env_override",
            }
        );
    }

    #[test]
    fn resolve_binary_prefers_resource_candidate_before_development_binary() {
        let temp = TempDirGuard::new("binary-resource-priority");
        let dev_path = temp.path.join("dev").join(binary_name());
        let resource_dir = temp.path.join("resource");
        let resource_binary = resource_dir.join("binaries").join(binary_name());
        fs::create_dir_all(dev_path.parent().expect("dev parent")).expect("dev parent");
        fs::create_dir_all(resource_binary.parent().expect("resource parent"))
            .expect("resource parent");
        fs::write(&dev_path, b"dev").expect("dev binary");
        fs::write(&resource_binary, b"resource").expect("resource binary");

        let resolved =
            resolve_bridge_binary_from_sources(None, dev_path, Some(resource_dir.clone()), false)
                .expect("binary should resolve");

        assert_eq!(
            resolved,
            ResolvedSourcePath {
                path: resource_binary,
                source: "resource_bundle:binaries",
            }
        );
    }

    #[test]
    fn resolve_binary_disables_workspace_fallback_by_default() {
        let err = resolve_bridge_binary_from_sources(
            None,
            PathBuf::from("D:\\MyProject\\kimi-app\\apps\\kimi-im-bridge\\bin\\kimi-im-bridge.exe"),
            None,
            false,
        )
        .expect_err("workspace fallback should be disabled by default");

        let message = err.to_string();
        assert!(message.contains("workspace_fallback:disabled"));
        assert!(!message.contains("D:\\MyProject\\kimi-app"));
    }

    #[test]
    fn resolve_binary_allows_workspace_fallback_when_explicitly_enabled() {
        let temp = TempDirGuard::new("binary-workspace-fallback");
        let dev_path = temp.path.join("dev").join(binary_name());
        fs::create_dir_all(dev_path.parent().expect("dev parent")).expect("dev parent");
        fs::write(&dev_path, b"dev").expect("dev binary");

        let resolved = resolve_bridge_binary_from_sources(None, dev_path.clone(), None, true)
            .expect("workspace fallback should resolve when explicitly enabled");

        assert_eq!(
            resolved,
            ResolvedSourcePath {
                path: dev_path,
                source: "workspace_fallback",
            }
        );
    }

    #[test]
    fn resolve_binary_missing_env_override_error_is_sanitized() {
        let err = resolve_bridge_binary_from_sources(
            Some(PathBuf::from(
                "D:\\MyProject\\kimi-app\\apps\\kimi-im-bridge\\bin\\kimi-im-bridge.exe",
            )),
            PathBuf::from("ignored"),
            None,
            false,
        )
        .expect_err("missing env override should fail");

        let message = err.to_string();
        assert!(message.contains("KIMI_IM_BRIDGE_BIN"));
        assert!(!message.contains("D:\\MyProject\\kimi-app"));
    }

    #[test]
    fn resolve_connector_default_work_dir_prefers_connector_override_then_legacy_default() {
        let settings = BridgeSettings {
            enabled: true,
            auto_start: false,
            admin_port: 60_110,
            skills_mode: BridgeSkillsMode::Disabled,
            feishu_reply_renderer: crate::types::FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: Some("D:/global-default".to_string()),
            work_dir_presets: vec![],
            connectors: vec![
                BridgeConnectorConfig {
                    id: "telegram-default".to_string(),
                    platform: BridgePlatform::Telegram,
                    enabled: true,
                    mode: BridgeChannelMode::Polling,
                    label: "Telegram 机器人 01".to_string(),
                    default_work_dir: Some("D:/telegram".to_string()),
                    reset_binding_session_on_start: Some(true),
                    feishu_auto_approve: None,
                    feishu_reply_renderer: None,
                    weixin_reply_mode: None,
                },
                BridgeConnectorConfig {
                    id: "feishu-default".to_string(),
                    platform: BridgePlatform::Feishu,
                    enabled: true,
                    mode: BridgeChannelMode::Websocket,
                    label: "飞书机器人 01".to_string(),
                    default_work_dir: None,
                    reset_binding_session_on_start: Some(false),
                    feishu_auto_approve: Some(true),
                    feishu_reply_renderer: Some(crate::types::FeishuReplyRenderer::Interactive),
                    weixin_reply_mode: None,
                },
            ],
        };

        assert_eq!(
            resolve_connector_default_work_dir(&settings, "telegram-default").as_deref(),
            Some("D:/telegram")
        );
        assert_eq!(
            resolve_connector_default_work_dir(&settings, "feishu-default").as_deref(),
            Some("D:/global-default")
        );
        assert_eq!(
            resolve_connector_default_work_dir(&settings, "missing").as_deref(),
            Some("D:/global-default")
        );
    }

    #[test]
    fn lifecycle_transition_helpers_update_bridge_runtime_state() {
        let mut runtime = BridgeProcessState::new("token".to_string());
        begin_start_transition(&mut runtime, 60_110, PathBuf::from("bridge.exe"), 4242);
        assert_eq!(runtime.state, BridgeRuntimeState::Starting);
        assert_eq!(runtime.pid, Some(4242));
        assert!(runtime.last_error_code.is_none());
        assert!(runtime.last_error.is_none());

        let status = BridgeStatus {
            state: BridgeRuntimeState::Running,
            started_at: Some("123".to_string()),
            pid: Some(4242),
            admin_port: 60_110,
            version: Some("0.1.0".to_string()),
            kimi_runtime_locator: BridgeRuntimeLocatorStatus::default(),
            runtime_adapter: BridgeRuntimeAdapterStatus::default(),
            connectors: vec![BridgeChannelStatus {
                connector_id: "telegram-default".to_string(),
                connector_label: "Telegram 机器人 01".to_string(),
                platform: BridgePlatform::Telegram,
                enabled: true,
                state: BridgeChannelState::Ready,
                last_heartbeat_at: None,
                last_inbound_at: None,
                last_outbound_at: None,
                last_offset: None,
                last_error_code: None,
                last_error: None,
                last_ready_at: None,
                last_failure_at: None,
                last_failure_operation: None,
                last_failure_retryable: None,
                consecutive_failures: None,
                next_retry_at: None,
                last_recovery_at: None,
                recovery_hint: None,
            }],
            pending_approvals: 1,
            bindings: 2,
            last_error_code: None,
            last_error: None,
        };
        apply_status_transition(&mut runtime, &status);
        assert_eq!(runtime.state, BridgeRuntimeState::Running);
        assert_eq!(runtime.version.as_deref(), Some("0.1.0"));
        assert_eq!(runtime.bindings, 2);

        runtime.state = BridgeRuntimeState::Crashed;
        runtime.last_error = Some("boom".to_string());
        finish_stop_transition(&mut runtime);
        assert_eq!(runtime.state, BridgeRuntimeState::Stopped);
        assert_eq!(runtime.pid, None);
    }

    #[test]
    fn bridge_bind_failure_detection_matches_windows_socket_permission_error() {
        let message = "bridge startup phase=start error=listen tcp 127.0.0.1:60110: bind: An attempt was made to access a socket in a way forbidden by its access permissions.";
        assert!(is_bridge_admin_port_bind_failure(message));
        let described = describe_bridge_bind_failure(message);
        assert!(described.contains("excluded port range"));
        assert!(described.contains("Docker Desktop"));
    }

    #[test]
    fn probe_local_port_reports_bound_listener_as_unavailable() {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).expect("listener should bind to an ephemeral port");
        let port = listener
            .local_addr()
            .expect("listener addr should be available")
            .port();

        let error = probe_local_port(port).expect_err("probe should fail while port is in use");
        assert!(error.contains(&port.to_string()));
    }

    #[test]
    fn select_ephemeral_local_port_avoids_excluded_candidate() {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).expect("listener should bind to an ephemeral port");
        let port = listener
            .local_addr()
            .expect("listener addr should be available")
            .port();

        let selected = select_ephemeral_local_port(Some(port)).expect("ephemeral port should bind");
        assert_ne!(selected, port);
    }

    #[test]
    fn local_status_channels_degrade_enabled_channels_when_runtime_is_degraded() {
        let settings = BridgeSettings {
            enabled: true,
            auto_start: false,
            admin_port: 60_110,
            skills_mode: BridgeSkillsMode::Disabled,
            feishu_reply_renderer: crate::types::FeishuReplyRenderer::Interactive,
            feishu_auto_approve: true,
            reset_binding_session_on_bridge_start: true,
            feishu_reply_cards: None,
            default_work_dir: None,
            work_dir_presets: vec![],
            connectors: vec![
                BridgeConnectorConfig {
                    id: "telegram-default".to_string(),
                    platform: BridgePlatform::Telegram,
                    enabled: false,
                    mode: BridgeChannelMode::Polling,
                    label: "Telegram 机器人 01".to_string(),
                    default_work_dir: None,
                    reset_binding_session_on_start: Some(true),
                    feishu_auto_approve: None,
                    feishu_reply_renderer: None,
                    weixin_reply_mode: None,
                },
                BridgeConnectorConfig {
                    id: "feishu-default".to_string(),
                    platform: BridgePlatform::Feishu,
                    enabled: true,
                    mode: BridgeChannelMode::Websocket,
                    label: "飞书机器人 01".to_string(),
                    default_work_dir: None,
                    reset_binding_session_on_start: Some(true),
                    feishu_auto_approve: Some(true),
                    feishu_reply_renderer: Some(crate::types::FeishuReplyRenderer::Interactive),
                    weixin_reply_mode: None,
                },
            ],
        };
        let runtime_channels = vec![BridgeChannelStatus {
            connector_id: "feishu-default".to_string(),
            connector_label: "飞书机器人 01".to_string(),
            platform: BridgePlatform::Feishu,
            enabled: true,
            state: BridgeChannelState::Connecting,
            last_heartbeat_at: None,
            last_inbound_at: None,
            last_outbound_at: None,
            last_offset: None,
            last_error_code: None,
            last_error: None,
            last_ready_at: None,
            last_failure_at: None,
            last_failure_operation: None,
            last_failure_retryable: None,
            consecutive_failures: None,
            next_retry_at: None,
            last_recovery_at: None,
            recovery_hint: None,
        }];

        let channels =
            local_status_channels(&settings, &runtime_channels, BridgeRuntimeState::Degraded);

        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].platform, BridgePlatform::Telegram);
        assert_eq!(channels[0].state, BridgeChannelState::Idle);
        assert_eq!(channels[1].platform, BridgePlatform::Feishu);
        assert_eq!(channels[1].state, BridgeChannelState::Degraded);
    }

    #[test]
    fn mask_secret_value_hides_short_and_long_tokens() {
        assert_eq!(mask_secret_value("short"), "***");
        assert_eq!(mask_secret_value("abcdef"), "abc***ef");
        assert_eq!(mask_secret_value("telegram-secret-token"), "tel***en");
    }

    #[test]
    fn mask_optional_secret_tracks_configured_flag() {
        let empty = mask_optional_secret(Some("   "));
        assert!(!empty.configured);
        assert!(empty.masked_value.is_none());

        let masked = mask_optional_secret(Some("secret-token"));
        assert!(masked.configured);
        assert_eq!(masked.masked_value.as_deref(), Some("sec***en"));
    }

    #[test]
    fn redact_bridge_log_line_hides_registered_values() {
        let secrets = vec![
            "admin-token-secret".to_string(),
            "host-control-secret".to_string(),
        ];

        let redacted = redact_bridge_log_line(
            "admin=admin-token-secret host=host-control-secret",
            &secrets,
        );

        assert!(!redacted.contains("admin-token-secret"));
        assert!(!redacted.contains("host-control-secret"));
        assert_eq!(redacted, "admin=[REDACTED] host=[REDACTED]");
    }

    #[test]
    fn redact_bridge_log_line_uses_longest_values_first() {
        let secrets = vec!["abcdef".to_string(), "abcd".to_string()];

        let redacted = redact_bridge_log_line("token=abcdef", &secrets);

        assert_eq!(redacted, "token=[REDACTED]");
    }

    #[test]
    fn configure_bridge_token_env_keeps_tokens_out_of_args() {
        let mut command = Command::new("kimi-im-bridge");
        command.arg("--admin-port").arg("60110");

        configure_bridge_token_env(&mut command, "admin-secret", Some("host-secret"));

        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(!args.iter().any(|arg| arg.contains("secret")));

        let envs = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<Vec<_>>();

        assert!(envs.contains(&(
            BRIDGE_ADMIN_TOKEN_ENV.to_string(),
            Some("admin-secret".to_string())
        )));
        assert!(envs.contains(&(
            BRIDGE_HOST_CONTROL_TOKEN_ENV.to_string(),
            Some("host-secret".to_string())
        )));
        assert!(envs.contains(&(BRIDGE_ADMIN_TOKEN_FILE_ENV.to_string(), None)));
        assert!(envs.contains(&(BRIDGE_HOST_CONTROL_TOKEN_FILE_ENV.to_string(), None)));
    }

    #[test]
    fn wait_for_child_exit_is_bounded() {
        let mut child = spawn_long_running_process();
        let exited = wait_for_child_exit(&mut child, Duration::from_millis(50))
            .expect("wait should succeed");
        assert!(!exited);
        let _ = terminate_child(&mut child, Duration::from_millis(50));
    }

    #[cfg(windows)]
    fn spawn_long_running_process() -> Child {
        Command::new("cmd")
            .args(["/C", "ping -n 6 127.0.0.1 >NUL"])
            .spawn()
            .expect("child process should start")
    }

    #[cfg(not(windows))]
    fn spawn_long_running_process() -> Child {
        Command::new("sh")
            .args(["-c", "sleep 5"])
            .spawn()
            .expect("child process should start")
    }
}
