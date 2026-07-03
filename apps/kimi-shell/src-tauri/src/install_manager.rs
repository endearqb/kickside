mod catalog;

use std::{
    env, fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use chrono::Utc;
use encoding_rs::GBK;
use tauri::{ipc::Channel, AppHandle};

use crate::{
    backend_manager, command_utils, kimi_locator, log_manager, settings_store,
    types::{
        AppSettings, InstallCustomMirrorConfig, InstallFlowCatalog, InstallLogChunk,
        InstallLogStream, InstallMirrorHealthCategory, InstallMirrorHealthEntry,
        InstallMirrorHealthReport, InstallMirrorPreset, InstallProbeStatus, InstallSessionEvent,
        InstallSessionSnapshot, InstallSessionStage, InstallSessionStatus, InstallSettingsView,
        InstallSource, InstallTaskDefinition, InstallTaskId, InstallTaskStep,
        PowerShellDiagnosticKind, PowerShellExecutionPolicyItem, PowerShellPreflightSummary,
    },
};

const POWERSHELL_EXE: &str = "powershell.exe";
const MAX_INSTALL_LOG_CHUNKS: usize = 400;
const MAX_LOG_LINE_CHARS: usize = 2_000;
const FALLBACK_REPROBE_INTERVAL_MS: u64 = 2_000;
const FALLBACK_REPROBE_TIMEOUT_MS: u64 = 120_000;
const EXECUTION_POLICY_SUGGESTION: &str =
    "Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned";
const KIMI_CODE_INSTALL_SCRIPT_URL: &str = "https://code.kimi.com/kimi-code/install.ps1";
const KIMI_CODE_NPM_PACKAGE: &str = "@moonshot-ai/kimi-code";
const DEFAULT_GIT_MIRROR_RELEASE_PAGES: &[&str] = &[
    "https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/LatestRelease/",
    "https://mirrors.ustc.edu.cn/github-release/git-for-windows/git/LatestRelease/",
    "https://mirror.nju.edu.cn/github-release/git-for-windows/git/LatestRelease/",
];
const DEFAULT_UV_MIRROR_RELEASE_PAGES: &[&str] =
    &["https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/LatestRelease/"];
const DEFAULT_PYTHON_MIRROR_INSTALLERS: &[&str] = &[
    "https://mirrors.tuna.tsinghua.edu.cn/python/3.13.12/python-3.13.12-amd64.exe",
    "https://mirrors.aliyun.com/python-release/windows/python-3.13.12-amd64.exe",
    "https://mirrors.ustc.edu.cn/python/3.13.12/python-3.13.12-amd64.exe",
    "https://mirrors.huaweicloud.com/python/3.13.12/python-3.13.12-amd64.exe",
];
const DEFAULT_PYPI_INDEXES: &[&str] = &[
    "https://pypi.tuna.tsinghua.edu.cn/simple/",
    "https://mirrors.aliyun.com/pypi/simple/",
    "https://mirrors.ustc.edu.cn/pypi/simple/",
    "https://mirror.nju.edu.cn/pypi/web/simple/",
];
const TUNA_GIT_MIRROR_RELEASE_PAGES: &[&str] =
    &["https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/LatestRelease/"];
const TUNA_UV_MIRROR_RELEASE_PAGES: &[&str] =
    &["https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/LatestRelease/"];
const TUNA_PYTHON_MIRROR_INSTALLERS: &[&str] =
    &["https://mirrors.tuna.tsinghua.edu.cn/python/3.13.12/python-3.13.12-amd64.exe"];
const TUNA_PYPI_INDEXES: &[&str] = &["https://pypi.tuna.tsinghua.edu.cn/simple/"];
const USTC_GIT_MIRROR_RELEASE_PAGES: &[&str] =
    &["https://mirrors.ustc.edu.cn/github-release/git-for-windows/git/LatestRelease/"];
const USTC_UV_MIRROR_RELEASE_PAGES: &[&str] =
    &["https://mirrors.ustc.edu.cn/github-release/astral-sh/uv/LatestRelease/"];
const USTC_PYTHON_MIRROR_INSTALLERS: &[&str] =
    &["https://mirrors.ustc.edu.cn/python/3.13.12/python-3.13.12-amd64.exe"];
const USTC_PYPI_INDEXES: &[&str] = &["https://mirrors.ustc.edu.cn/pypi/simple/"];

#[derive(Debug, Clone)]
struct ResolvedMirrorConfig {
    git_release_pages: Vec<String>,
    uv_release_pages: Vec<String>,
    python_installer_urls: Vec<String>,
    pypi_index_urls: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct RunningInstallProcess {
    pid: Option<u32>,
}

#[derive(Default)]
struct InstallManagerState {
    snapshot: InstallSessionSnapshot,
    channel: Option<Channel<InstallSessionEvent>>,
    running: Option<RunningInstallProcess>,
    cancel_requested: bool,
}

#[derive(Clone, Default)]
pub struct InstallManager {
    inner: Arc<Mutex<InstallManagerState>>,
}

impl InstallManager {
    pub fn register_channel(
        &self,
        channel: Channel<InstallSessionEvent>,
    ) -> Result<InstallSessionSnapshot, String> {
        let snapshot = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "install manager mutex is poisoned".to_string())?;
            state.channel = Some(channel.clone());
            state.snapshot.clone()
        };
        let _ = channel.send(InstallSessionEvent::Snapshot {
            snapshot: snapshot.clone(),
        });
        Ok(snapshot)
    }

    pub fn snapshot(&self) -> Result<InstallSessionSnapshot, String> {
        let state = self
            .inner
            .lock()
            .map_err(|_| "install manager mutex is poisoned".to_string())?;
        Ok(state.snapshot.clone())
    }

    pub fn start_task(
        &self,
        app: &AppHandle,
        task_id: InstallTaskId,
        source: InstallSource,
    ) -> Result<InstallSessionSnapshot, String> {
        let task = build_install_flow_catalog(app)
            .tasks
            .into_iter()
            .find(|task| task.id == task_id)
            .ok_or_else(|| "unknown install task".to_string())?;
        let powershell_diagnostic = Some(get_powershell_preflight());

        {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "install manager mutex is poisoned".to_string())?;
            if state.running.is_some()
                || matches!(
                    state.snapshot.status,
                    InstallSessionStatus::Starting
                        | InstallSessionStatus::Running
                        | InstallSessionStatus::Cancelling
                )
            {
                return Err("another install task is already running".to_string());
            }

            state.running = Some(RunningInstallProcess { pid: None });
            state.cancel_requested = false;
            state.snapshot = InstallSessionSnapshot {
                status: InstallSessionStatus::Starting,
                stage: InstallSessionStage::Prepare,
                task_id: Some(task_id),
                source: Some(source),
                title: Some(task.title.clone()),
                current_step_id: None,
                current_step_title: None,
                started_at: Some(now_rfc3339()),
                finished_at: None,
                exit_code: None,
                message: Some("Starting install task.".to_string()),
                failure_summary: None,
                last_stdout: None,
                last_stderr: None,
                fallback_reason: task.fallback_reason.clone(),
                powershell_diagnostic,
                logs_truncated: false,
                probe: Some(get_install_probe_status(app)),
                logs: Vec::new(),
            };
        }

        let snapshot = self.emit_snapshot()?;
        let manager = self.clone();
        let app = app.clone();
        if task.runs_in_app {
            thread::spawn(move || run_managed_task(&manager, &app, task, source));
        } else {
            thread::spawn(move || run_fallback_task(&manager, &app, task, source));
        }
        Ok(snapshot)
    }

    pub fn cancel_task(&self) -> Result<InstallSessionSnapshot, String> {
        let pid = {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "install manager mutex is poisoned".to_string())?;
            if state.running.is_none() {
                return Err("no install task is running".to_string());
            }
            state.cancel_requested = true;
            state.snapshot.status = InstallSessionStatus::Cancelling;
            state.snapshot.message = Some("Cancelling install task.".to_string());
            state.running.and_then(|running| running.pid)
        };

        let snapshot = self.emit_snapshot()?;
        if let Some(pid) = pid {
            terminate_process_tree(pid);
        }
        Ok(snapshot)
    }

    fn emit_snapshot(&self) -> Result<InstallSessionSnapshot, String> {
        let (snapshot, channel) = {
            let state = self
                .inner
                .lock()
                .map_err(|_| "install manager mutex is poisoned".to_string())?;
            (state.snapshot.clone(), state.channel.clone())
        };
        if let Some(channel) = channel {
            let _ = channel.send(InstallSessionEvent::Snapshot {
                snapshot: snapshot.clone(),
            });
        }
        Ok(snapshot)
    }

    fn update_snapshot<F>(&self, mutator: F) -> Result<InstallSessionSnapshot, String>
    where
        F: FnOnce(&mut InstallManagerState),
    {
        {
            let mut state = self
                .inner
                .lock()
                .map_err(|_| "install manager mutex is poisoned".to_string())?;
            mutator(&mut state);
        }
        self.emit_snapshot()
    }

    fn push_log(&self, chunk: InstallLogChunk) {
        let channel = {
            let mut state = match self.inner.lock() {
                Ok(lock) => lock,
                Err(_) => return,
            };
            match chunk.stream {
                InstallLogStream::Stdout => state.snapshot.last_stdout = Some(chunk.text.clone()),
                InstallLogStream::Stderr => state.snapshot.last_stderr = Some(chunk.text.clone()),
                InstallLogStream::System => {}
            }
            state.snapshot.logs.push(chunk.clone());
            if state.snapshot.logs.len() > MAX_INSTALL_LOG_CHUNKS {
                let overflow = state.snapshot.logs.len() - MAX_INSTALL_LOG_CHUNKS;
                state.snapshot.logs.drain(0..overflow);
                state.snapshot.logs_truncated = true;
            }
            state.channel.clone()
        };
        if let Some(channel) = channel {
            let _ = channel.send(InstallSessionEvent::Log { chunk });
        }
    }

    fn is_cancel_requested(&self) -> bool {
        let Ok(state) = self.inner.lock() else {
            return false;
        };
        state.cancel_requested
    }

    fn set_running_pid(&self, pid: u32) {
        let _ = self.update_snapshot(|state| {
            if let Some(running) = state.running.as_mut() {
                running.pid = Some(pid);
            }
            state.snapshot.status = InstallSessionStatus::Running;
            state.snapshot.message = Some(format!("Install task is running (pid={pid})."));
        });
    }

    fn finish(
        &self,
        app: &AppHandle,
        status: InstallSessionStatus,
        exit_code: Option<i32>,
        message: String,
    ) {
        let probe = get_install_probe_status(app);
        let _ = self.update_snapshot(|state| {
            state.running = None;
            state.cancel_requested = false;
            state.snapshot.status = status;
            state.snapshot.stage = InstallSessionStage::Done;
            state.snapshot.exit_code = exit_code;
            state.snapshot.message = Some(message);
            if status != InstallSessionStatus::Failed {
                state.snapshot.failure_summary = None;
            }
            state.snapshot.finished_at = Some(now_rfc3339());
            state.snapshot.current_step_id = None;
            state.snapshot.current_step_title = None;
            state.snapshot.probe = Some(probe);
        });
    }

    fn finish_failure(
        &self,
        app: &AppHandle,
        step_title: &str,
        exit_code: Option<i32>,
        explicit_error: Option<String>,
    ) {
        let probe = get_install_probe_status(app);
        let _ = self.update_snapshot(|state| {
            let detail = explicit_error
                .clone()
                .or_else(|| preferred_failure_detail(&state.snapshot))
                .unwrap_or_else(|| "No stderr/stdout details were captured.".to_string());
            let summary = format_failure_summary(step_title, exit_code, &detail);

            state.running = None;
            state.cancel_requested = false;
            state.snapshot.status = InstallSessionStatus::Failed;
            state.snapshot.stage = InstallSessionStage::Done;
            state.snapshot.exit_code = exit_code;
            state.snapshot.message = Some(summary.clone());
            state.snapshot.failure_summary = Some(summary);
            state.snapshot.finished_at = Some(now_rfc3339());
            state.snapshot.current_step_id = None;
            state.snapshot.current_step_title = None;
            state.snapshot.probe = Some(probe);
        });
    }
}

pub fn get_install_settings(app: &AppHandle) -> InstallSettingsView {
    let settings = settings_store::load_or_default(app).unwrap_or_default();
    build_install_settings_view(&settings)
}

pub fn save_install_settings(
    app: &AppHandle,
    input: InstallSettingsView,
) -> Result<InstallSettingsView, String> {
    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.preferred_install_source = input.preferred_source;
    settings.mirror_preset = normalize_install_mirror_preset(input.mirror_preset);
    settings.custom_mirror_config = validate_custom_mirror_config(&input.custom_mirror_config)?;
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    Ok(build_install_settings_view(&settings))
}

pub fn get_install_mirror_health_report(
    input: InstallSettingsView,
) -> Result<InstallMirrorHealthReport, String> {
    let config = resolved_mirror_config_from_view(&input)?;
    Ok(check_install_mirror_health(&config))
}

pub fn build_install_flow_catalog(app: &AppHandle) -> InstallFlowCatalog {
    let mirror_config = resolved_mirror_config(app);
    catalog::build_install_flow_catalog_with_mirror_config(&mirror_config)
}

pub fn get_powershell_preflight() -> PowerShellPreflightSummary {
    let (execution_policies, language_mode) = collect_powershell_environment();
    let smoke = run_powershell_file_smoke_test();
    classify_powershell_preflight(execution_policies, language_mode, smoke)
}

pub fn get_install_probe_status(app: &AppHandle) -> InstallProbeStatus {
    let winget_ready = command_exists("winget");
    let git_ready = git_ready();
    let kimi_shell_path = kimi_locator::locate_shell_path();
    let git_bash_ready = kimi_shell_path.is_some();
    let uv_ready = uv_ready();
    let python313_ready = python313_ready();
    let kimi_ready = kimi_ready(app);
    let node_ready = node_ready();

    InstallProbeStatus {
        winget_ready,
        git_ready,
        git_bash_ready,
        kimi_shell_path: kimi_shell_path.map(|path| path.display().to_string()),
        uv_ready,
        python313_ready,
        kimi_ready,
        node_ready,
        core_ready: kimi_ready,
    }
}

fn build_install_settings_view(settings: &AppSettings) -> InstallSettingsView {
    InstallSettingsView {
        preferred_source: settings.preferred_install_source,
        mirror_preset: normalize_install_mirror_preset(settings.mirror_preset),
        custom_mirror_config: settings.custom_mirror_config.clone(),
    }
}

fn normalize_install_mirror_preset(preset: InstallMirrorPreset) -> InstallMirrorPreset {
    match preset {
        InstallMirrorPreset::Aliyun => InstallMirrorPreset::Mixed,
        _ => preset,
    }
}

fn validate_custom_mirror_config(
    config: &InstallCustomMirrorConfig,
) -> Result<InstallCustomMirrorConfig, String> {
    Ok(InstallCustomMirrorConfig {
        git_release_pages: validate_https_url_list(
            &config.git_release_pages,
            "Git mirror release pages",
        )?,
        uv_release_pages: validate_https_url_list(
            &config.uv_release_pages,
            "uv mirror release pages",
        )?,
        python_installer_urls: validate_https_url_list(
            &config.python_installer_urls,
            "Python mirror installers",
        )?,
        pypi_index_urls: validate_https_url_list(&config.pypi_index_urls, "PyPI mirror indexes")?,
    })
}

fn validate_https_url_list(values: &[String], label: &str) -> Result<Vec<String>, String> {
    let normalized = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    if normalized.is_empty() {
        return Err(format!("{label} cannot be empty."));
    }
    if let Some(invalid) = normalized.iter().find(|value| !is_https_url(value)) {
        return Err(format!("{label} must use https URLs: {invalid}"));
    }
    Ok(normalized)
}

fn is_https_url(value: &str) -> bool {
    value.starts_with("https://")
}

fn resolved_mirror_config(app: &AppHandle) -> ResolvedMirrorConfig {
    let settings = settings_store::load_or_default(app).unwrap_or_default();
    resolved_mirror_config_from_settings(&settings)
}

fn resolved_mirror_config_from_view(
    input: &InstallSettingsView,
) -> Result<ResolvedMirrorConfig, String> {
    let custom_mirror_config = if input.mirror_preset == InstallMirrorPreset::Custom {
        validate_custom_mirror_config(&input.custom_mirror_config)?
    } else {
        input.custom_mirror_config.clone()
    };
    Ok(resolved_mirror_config_from_settings(&AppSettings {
        preferred_install_source: input.preferred_source,
        mirror_preset: normalize_install_mirror_preset(input.mirror_preset),
        custom_mirror_config,
        ..AppSettings::default()
    }))
}

fn resolved_mirror_config_from_settings(settings: &AppSettings) -> ResolvedMirrorConfig {
    match normalize_install_mirror_preset(settings.mirror_preset) {
        InstallMirrorPreset::Mixed => ResolvedMirrorConfig {
            git_release_pages: DEFAULT_GIT_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            uv_release_pages: DEFAULT_UV_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            python_installer_urls: DEFAULT_PYTHON_MIRROR_INSTALLERS
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            pypi_index_urls: DEFAULT_PYPI_INDEXES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        },
        InstallMirrorPreset::Tuna => ResolvedMirrorConfig {
            git_release_pages: TUNA_GIT_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            uv_release_pages: TUNA_UV_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            python_installer_urls: TUNA_PYTHON_MIRROR_INSTALLERS
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            pypi_index_urls: TUNA_PYPI_INDEXES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        },
        InstallMirrorPreset::Ustc => ResolvedMirrorConfig {
            git_release_pages: USTC_GIT_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            uv_release_pages: USTC_UV_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            python_installer_urls: USTC_PYTHON_MIRROR_INSTALLERS
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            pypi_index_urls: USTC_PYPI_INDEXES
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        },
        InstallMirrorPreset::Aliyun => resolved_mirror_config_from_settings(&AppSettings {
            mirror_preset: InstallMirrorPreset::Mixed,
            ..settings.clone()
        }),
        InstallMirrorPreset::Custom => {
            if let Ok(custom) = validate_custom_mirror_config(&settings.custom_mirror_config) {
                ResolvedMirrorConfig {
                    git_release_pages: custom.git_release_pages,
                    uv_release_pages: custom.uv_release_pages,
                    python_installer_urls: custom.python_installer_urls,
                    pypi_index_urls: custom.pypi_index_urls,
                }
            } else {
                resolved_mirror_config_from_settings(&AppSettings {
                    mirror_preset: InstallMirrorPreset::Mixed,
                    ..settings.clone()
                })
            }
        }
    }
}

fn check_install_mirror_health(config: &ResolvedMirrorConfig) -> InstallMirrorHealthReport {
    let client = match reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            let checked_at = now_rfc3339();
            let detail = format!("client build failed: {error}");
            return InstallMirrorHealthReport {
                entries: [
                    (
                        InstallMirrorHealthCategory::GitReleasePage,
                        &config.git_release_pages,
                    ),
                    (
                        InstallMirrorHealthCategory::UvReleasePage,
                        &config.uv_release_pages,
                    ),
                    (
                        InstallMirrorHealthCategory::PythonInstaller,
                        &config.python_installer_urls,
                    ),
                    (
                        InstallMirrorHealthCategory::PypiIndex,
                        &config.pypi_index_urls,
                    ),
                ]
                .into_iter()
                .flat_map(|(category, urls)| {
                    let detail = detail.clone();
                    let checked_at = checked_at.clone();
                    urls.iter().map(move |url| InstallMirrorHealthEntry {
                        category,
                        url: url.clone(),
                        healthy: false,
                        status_code: None,
                        detail: detail.clone(),
                        checked_at: checked_at.clone(),
                    })
                })
                .collect(),
            };
        }
    };

    let mut entries = Vec::new();
    for url in &config.git_release_pages {
        entries.push(check_release_page_health(
            &client,
            InstallMirrorHealthCategory::GitReleasePage,
            url,
        ));
    }
    for url in &config.uv_release_pages {
        entries.push(check_release_page_health(
            &client,
            InstallMirrorHealthCategory::UvReleasePage,
            url,
        ));
    }
    for url in &config.python_installer_urls {
        entries.push(check_python_installer_health(&client, url));
    }
    for url in &config.pypi_index_urls {
        entries.push(check_pypi_index_health(&client, url));
    }

    InstallMirrorHealthReport { entries }
}

fn check_release_page_health(
    client: &reqwest::blocking::Client,
    category: InstallMirrorHealthCategory,
    url: &str,
) -> InstallMirrorHealthEntry {
    let checked_at = now_rfc3339();
    let response = client.get(url).send();
    match response {
        Ok(response) => {
            let status_code = Some(response.status().as_u16());
            let body = response.text().unwrap_or_default();
            let healthy = match category {
                InstallMirrorHealthCategory::GitReleasePage => {
                    body.contains("Git-") && body.contains("-64-bit.exe")
                }
                InstallMirrorHealthCategory::UvReleasePage => {
                    body.contains("uv-x86_64-pc-windows-msvc.zip")
                }
                _ => false,
            };
            InstallMirrorHealthEntry {
                category,
                url: url.to_string(),
                healthy,
                status_code,
                detail: if healthy {
                    "release page contains expected asset".to_string()
                } else {
                    "release page missing expected asset link".to_string()
                },
                checked_at,
            }
        }
        Err(error) => InstallMirrorHealthEntry {
            category,
            url: url.to_string(),
            healthy: false,
            status_code: error.status().map(|status| status.as_u16()),
            detail: error.to_string(),
            checked_at,
        },
    }
}

fn check_python_installer_health(
    client: &reqwest::blocking::Client,
    url: &str,
) -> InstallMirrorHealthEntry {
    let checked_at = now_rfc3339();
    if let Ok(response) = client.head(url).send() {
        let status_code = Some(response.status().as_u16());
        if response.status().is_success() || response.status().is_redirection() {
            return InstallMirrorHealthEntry {
                category: InstallMirrorHealthCategory::PythonInstaller,
                url: url.to_string(),
                healthy: true,
                status_code,
                detail: "HEAD succeeded".to_string(),
                checked_at,
            };
        }
    }

    match client.get(url).send() {
        Ok(response) => InstallMirrorHealthEntry {
            category: InstallMirrorHealthCategory::PythonInstaller,
            url: url.to_string(),
            healthy: response.status().is_success() || response.status().is_redirection(),
            status_code: Some(response.status().as_u16()),
            detail: if response.status().is_success() || response.status().is_redirection() {
                "GET fallback succeeded".to_string()
            } else {
                format!("GET returned {}", response.status().as_u16())
            },
            checked_at,
        },
        Err(error) => InstallMirrorHealthEntry {
            category: InstallMirrorHealthCategory::PythonInstaller,
            url: url.to_string(),
            healthy: false,
            status_code: error.status().map(|status| status.as_u16()),
            detail: error.to_string(),
            checked_at,
        },
    }
}

fn check_pypi_index_health(
    client: &reqwest::blocking::Client,
    url: &str,
) -> InstallMirrorHealthEntry {
    let checked_at = now_rfc3339();
    match client.get(url).send() {
        Ok(response) => {
            let status_code = Some(response.status().as_u16());
            let body = response.text().unwrap_or_default();
            let healthy = body.to_ascii_lowercase().contains("<html");
            InstallMirrorHealthEntry {
                category: InstallMirrorHealthCategory::PypiIndex,
                url: url.to_string(),
                healthy,
                status_code,
                detail: if healthy {
                    "HTML index returned".to_string()
                } else {
                    "response does not look like an HTML index".to_string()
                },
                checked_at,
            }
        }
        Err(error) => InstallMirrorHealthEntry {
            category: InstallMirrorHealthCategory::PypiIndex,
            url: url.to_string(),
            healthy: false,
            status_code: error.status().map(|status| status.as_u16()),
            detail: error.to_string(),
            checked_at,
        },
    }
}

pub fn start_compat_task(
    app: &AppHandle,
    manager: &InstallManager,
    task_id: InstallTaskId,
    source: InstallSource,
) -> Result<String, String> {
    let snapshot = manager.start_task(app, task_id, source)?;
    Ok(snapshot
        .message
        .unwrap_or_else(|| "Install task started.".to_string()))
}

fn run_managed_task(
    manager: &InstallManager,
    app: &AppHandle,
    task: InstallTaskDefinition,
    source: InstallSource,
) {
    if let Err(error) = prepare_managed_task(manager, app, &task, source) {
        manager.finish_failure(app, "Stop app backend", Some(1), Some(error));
        return;
    }

    for step in catalog::steps_for_source(&task, source) {
        if manager.is_cancel_requested() {
            manager.finish(
                app,
                InstallSessionStatus::Cancelled,
                None,
                "Install task cancelled.".to_string(),
            );
            return;
        }

        let _ = manager.update_snapshot(|state| {
            state.snapshot.status = InstallSessionStatus::Running;
            state.snapshot.stage = InstallSessionStage::ExecuteStep;
            state.snapshot.current_step_id = Some(step.id.clone());
            state.snapshot.current_step_title = Some(step.title.clone());
            state.snapshot.message = Some(format!("Running step: {}", step.title));
        });

        match run_step_script(manager, app, task.id, source, &step) {
            Ok(Some(0)) => {}
            Ok(Some(code)) => {
                manager.finish_failure(app, &step.title, Some(code), None);
                return;
            }
            Ok(None) => {
                manager.finish(
                    app,
                    InstallSessionStatus::Cancelled,
                    None,
                    format!("Install task cancelled during step: {}", step.title),
                );
                return;
            }
            Err(error) => {
                manager.finish_failure(app, &step.title, Some(1), Some(error));
                return;
            }
        }
    }

    let _ = manager.update_snapshot(|state| {
        state.snapshot.stage = InstallSessionStage::Probe;
        state.snapshot.message = Some("Re-checking installation environment.".to_string());
    });
    manager.finish(
        app,
        InstallSessionStatus::Succeeded,
        Some(0),
        managed_task_success_message(&task),
    );
}

fn run_fallback_task(
    manager: &InstallManager,
    app: &AppHandle,
    task: InstallTaskDefinition,
    source: InstallSource,
) {
    let commands = catalog::join_commands(&catalog::steps_for_source(&task, source));
    let preflight = get_powershell_preflight();
    if preflight.kind != PowerShellDiagnosticKind::Ok {
        push_system_log(
            manager,
            task.id,
            source,
            format!("PowerShell preflight: {}", preflight.detail),
        );
    }
    match launch_external_fallback(&task, source, &commands) {
        Ok(summary) => {
            manager.push_log(InstallLogChunk {
                task_id: task.id,
                step_id: None,
                source,
                stream: InstallLogStream::System,
                text: summary,
                at: now_rfc3339(),
            });
            manager.finish(
                app,
                InstallSessionStatus::FallbackRequired,
                None,
                "External elevated terminal launched. Waiting for automatic re-check.".to_string(),
            );
            wait_for_fallback_probe_completion(manager, app, &task, source);
        }
        Err(error) => manager.finish(app, InstallSessionStatus::Failed, Some(1), error),
    }
}

fn run_step_script(
    manager: &InstallManager,
    app: &AppHandle,
    task_id: InstallTaskId,
    source: InstallSource,
    step: &InstallTaskStep,
) -> Result<Option<i32>, String> {
    let script_text = build_step_script(step.command.as_str());
    let script_path = write_temp_ps1(step, &script_text)?;
    let file_status = run_powershell_child(
        manager,
        task_id,
        source,
        step,
        spawn_powershell_script_file(&script_path)?,
    )?;

    if manager.is_cancel_requested() {
        remove_temp_script(app, &script_path);
        return Ok(None);
    }
    remove_temp_script(app, &script_path);

    if file_status.code().unwrap_or(1) == 0 {
        return Ok(file_status.code());
    }

    if should_retry_powershell_inline(manager.snapshot()?.last_stderr.as_deref()) {
        push_system_log(
            manager,
            task_id,
            source,
            "PowerShell file execution was blocked; retrying with inline command mode.".to_string(),
        );
        let inline_status = run_powershell_child(
            manager,
            task_id,
            source,
            step,
            spawn_powershell_inline_script(&script_text)?,
        )?;
        if manager.is_cancel_requested() {
            return Ok(None);
        }
        return Ok(inline_status.code());
    }

    Ok(file_status.code())
}

fn prepare_managed_task(
    manager: &InstallManager,
    app: &AppHandle,
    task: &InstallTaskDefinition,
    source: InstallSource,
) -> Result<(), String> {
    if !managed_task_requires_backend_stop(task.id) {
        return Ok(());
    }

    let action_label = if task.id == InstallTaskId::UninstallKimi {
        "uninstalling"
    } else {
        "upgrading"
    };

    let _ = manager.update_snapshot(|state| {
        state.snapshot.status = InstallSessionStatus::Running;
        state.snapshot.stage = InstallSessionStage::Prepare;
        state.snapshot.current_step_id = None;
        state.snapshot.current_step_title = Some("Stop app backend".to_string());
        state.snapshot.message = Some(format!(
            "Stopping app backend before {action_label} Kimi Code."
        ));
    });
    push_system_log(
        manager,
        task.id,
        source,
        format!("Stopping app backend before {action_label} Kimi Code."),
    );

    backend_manager::stop_backend(app)
        .map_err(|error| format!("Failed to stop the app backend before upgrade: {error:#}"))?;

    let _ = manager.update_snapshot(|state| {
        state.snapshot.status = InstallSessionStatus::Running;
        state.snapshot.stage = InstallSessionStage::Prepare;
        state.snapshot.current_step_id = None;
        state.snapshot.current_step_title = None;
        state.snapshot.message = Some(if task.id == InstallTaskId::UninstallKimi {
            "App backend stopped. Starting Kimi Code uninstall.".to_string()
        } else {
            "App backend stopped. Starting Kimi Code upgrade.".to_string()
        });
    });
    push_system_log(
        manager,
        task.id,
        source,
        if task.id == InstallTaskId::UninstallKimi {
            "App backend stopped. Starting Kimi Code uninstall.".to_string()
        } else {
            "App backend stopped. Starting Kimi Code upgrade.".to_string()
        },
    );
    Ok(())
}

fn managed_task_requires_backend_stop(task_id: InstallTaskId) -> bool {
    matches!(
        task_id,
        InstallTaskId::UpgradeKimi | InstallTaskId::UninstallKimi
    )
}

fn managed_task_success_message(task: &InstallTaskDefinition) -> String {
    if task.id == InstallTaskId::UninstallKimi {
        return format!(
            "Install task completed: {}. Kimi Code is removed and the app backend remains stopped.",
            task.title
        );
    }
    if managed_task_requires_backend_stop(task.id) {
        return format!(
            "Install task completed: {}. The app backend remains stopped; click restart backend to relaunch.",
            task.title
        );
    }
    format!("Install task completed: {}", task.title)
}

fn push_system_log(
    manager: &InstallManager,
    task_id: InstallTaskId,
    source: InstallSource,
    text: String,
) {
    manager.push_log(InstallLogChunk {
        task_id,
        step_id: None,
        source,
        stream: InstallLogStream::System,
        text,
        at: now_rfc3339(),
    });
}

fn run_powershell_child(
    manager: &InstallManager,
    task_id: InstallTaskId,
    source: InstallSource,
    step: &InstallTaskStep,
    mut child: std::process::Child,
) -> Result<std::process::ExitStatus, String> {
    manager.set_running_pid(child.id());
    if manager.is_cancel_requested() {
        terminate_process_tree(child.id());
    }

    let stdout_handle = child.stdout.take().map(|pipe| {
        let manager = manager.clone();
        let step_id = step.id.clone();
        thread::spawn(move || {
            stream_output(
                manager,
                task_id,
                source,
                Some(step_id),
                InstallLogStream::Stdout,
                pipe,
            )
        })
    });
    let stderr_handle = child.stderr.take().map(|pipe| {
        let manager = manager.clone();
        let step_id = step.id.clone();
        thread::spawn(move || {
            stream_output(
                manager,
                task_id,
                source,
                Some(step_id),
                InstallLogStream::Stderr,
                pipe,
            )
        })
    });

    let status = child
        .wait()
        .map_err(|error| format!("failed to wait for PowerShell step: {error}"))?;

    if let Some(handle) = stdout_handle {
        let _ = handle.join();
    }
    if let Some(handle) = stderr_handle {
        let _ = handle.join();
    }
    Ok(status)
}

fn wait_for_fallback_probe_completion(
    manager: &InstallManager,
    app: &AppHandle,
    task: &InstallTaskDefinition,
    source: InstallSource,
) {
    let started_at = SystemTime::now();
    loop {
        if manager.is_cancel_requested() {
            return;
        }
        thread::sleep(Duration::from_millis(FALLBACK_REPROBE_INTERVAL_MS));
        let probe = get_install_probe_status(app);
        if fallback_probe_satisfied(task.id, &probe) {
            push_system_log(
                manager,
                task.id,
                source,
                "External install detected successfully during automatic re-check.".to_string(),
            );
            manager.finish(
                app,
                InstallSessionStatus::Succeeded,
                Some(0),
                format!("Install task completed: {}", task.title),
            );
            return;
        }

        let elapsed = started_at
            .elapsed()
            .unwrap_or(Duration::from_millis(FALLBACK_REPROBE_TIMEOUT_MS));
        if elapsed.as_millis() as u64 >= FALLBACK_REPROBE_TIMEOUT_MS {
            push_system_log(
                manager,
                task.id,
                source,
                "Automatic re-check timed out; manual re-check is still available.".to_string(),
            );
            let _ = manager.update_snapshot(|state| {
                state.snapshot.probe = Some(probe.clone());
                state.snapshot.message = Some(
                    "Automatic re-check timed out. You can keep the elevated terminal open and click re-check later."
                        .to_string(),
                );
            });
            return;
        }
    }
}

fn fallback_probe_satisfied(task_id: InstallTaskId, probe: &InstallProbeStatus) -> bool {
    match task_id {
        InstallTaskId::InstallGit => probe.git_ready,
        InstallTaskId::InstallNodejs => probe.node_ready,
        _ => false,
    }
}

fn stream_output<R>(
    manager: InstallManager,
    task_id: InstallTaskId,
    source: InstallSource,
    step_id: Option<String>,
    stream: InstallLogStream,
    reader: R,
) where
    R: std::io::Read,
{
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();

    loop {
        let mut chunk = [0_u8; 4096];
        let read = match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => break,
        };
        buffer.extend_from_slice(&chunk[..read]);

        while let Some(position) = buffer.iter().position(|byte| *byte == b'\n') {
            let line = buffer.drain(..=position).collect::<Vec<_>>();
            push_stream_line(&manager, task_id, source, step_id.clone(), stream, &line);
        }
    }

    if !buffer.is_empty() {
        push_stream_line(&manager, task_id, source, step_id, stream, &buffer);
    }
}

fn write_temp_ps1(step: &InstallTaskStep, script_text: &str) -> Result<PathBuf, String> {
    let mut path = env::temp_dir();
    path.push(format!(
        "kimi-shell-install-{}-{}.ps1",
        step.id,
        unique_suffix()
    ));

    let mut file = fs::File::create(&path)
        .map_err(|error| format!("failed to create temp PowerShell script: {error}"))?;
    file.write_all(&[0xEF, 0xBB, 0xBF])
        .map_err(|error| format!("failed to write BOM to temp PowerShell script: {error}"))?;
    file.write_all(script_text.as_bytes())
        .map_err(|error| format!("failed to write temp PowerShell script: {error}"))?;
    Ok(path)
}

fn build_step_script(command: &str) -> String {
    format!(
        r#"$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {{
  $PSNativeCommandUseErrorActionPreference = $true
}}
function Ensure-KimiShellPath {{
  $dirs = @((Join-Path $HOME '.kimi-code\bin'), (Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
  if ($env:APPDATA) {{
    $dirs += (Join-Path $env:APPDATA 'npm')
  }}
  if (Get-Command uv -ErrorAction SilentlyContinue) {{
    try {{
      $uvBinDir = (uv tool dir --bin 2>$null | Select-Object -First 1)
      if ($uvBinDir) {{
        $dirs += $uvBinDir.Trim()
      }}
    }} catch {{
    }}
  }}
  foreach ($dir in $dirs | Where-Object {{ $_ }} | Select-Object -Unique) {{
    if ((Test-Path $dir) -and ($env:Path -notlike "*$dir*")) {{
      $env:Path = "$dir;$env:Path"
    }}
  }}
}}
function Resolve-KimiShellCommandPath([string]$CommandName, [string[]]$CandidatePaths) {{
  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {{
    return $command.Source
  }}

  foreach ($candidate in $CandidatePaths | Where-Object {{ $_ }}) {{
    if (Test-Path $candidate) {{
      try {{
        return (Resolve-Path $candidate -ErrorAction Stop).Path
      }} catch {{
        return $candidate
      }}
    }}
  }}

  return $null
}}
function Ensure-KimiShellCommandPath([string]$CommandName, [string[]]$CandidatePaths) {{
  Ensure-KimiShellPath
  $resolved = Resolve-KimiShellCommandPath $CommandName $CandidatePaths
  if (-not $resolved) {{
    throw "$CommandName not found after installation."
  }}
  $resolvedDir = Split-Path -Parent $resolved
  if ($resolvedDir -and (Test-Path $resolvedDir) -and ($env:Path -notlike "*$resolvedDir*")) {{
    $env:Path = "$resolvedDir;$env:Path"
  }}
  return $resolved
}}
function Invoke-KimiShellVersionCheck([string]$CommandName, [string[]]$CandidatePaths, [string[]]$Arguments) {{
  $resolved = Ensure-KimiShellCommandPath $CommandName $CandidatePaths
  & $resolved @Arguments
  if ($LASTEXITCODE -ne 0) {{
    throw "$CommandName version check failed with exit code $LASTEXITCODE."
  }}
}}
function Invoke-KimiShellPython313Check {{
  Ensure-KimiShellPath
  $pythonCandidatePaths = @(
    (Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'),
    (Join-Path $env:ProgramFiles 'Python313\python.exe'),
    (Join-Path ${{env:ProgramFiles(x86)}} 'Python313\python.exe')
  )

  foreach ($candidate in $pythonCandidatePaths | Where-Object {{ $_ }}) {{
    if (-not (Test-Path $candidate)) {{
      continue
    }}
    & $candidate --version
    if ($LASTEXITCODE -eq 0) {{
      return
    }}
  }}

  if (Get-Command py -ErrorAction SilentlyContinue) {{
    & py -3.13 --version
    if ($LASTEXITCODE -eq 0) {{
      return
    }}
  }}

  $python313 = Get-Command python3.13 -ErrorAction SilentlyContinue
  if ($python313 -and $python313.Source) {{
    & $python313.Source --version
    if ($LASTEXITCODE -eq 0) {{
      return
    }}
  }}

  $uvPath = Resolve-KimiShellCommandPath 'uv' @((Join-Path $HOME '.local\bin\uv.exe'), (Join-Path $HOME '.cargo\bin\uv.exe'))
  if ($uvPath) {{
    & $uvPath run --python 3.13 python --version
    if ($LASTEXITCODE -eq 0) {{
      return
    }}
  }}

  throw 'Python 3.13 version check failed after installation.'
}}
function Format-KimiShellError($errorRecord) {{
  if ($null -eq $errorRecord) {{
    return ''
  }}

  $lines = @()
  if ($errorRecord.Exception -and $errorRecord.Exception.Message) {{
    $lines += $errorRecord.Exception.Message.Trim()
  }}
  if ($errorRecord.InvocationInfo -and $errorRecord.InvocationInfo.PositionMessage) {{
    $lines += $errorRecord.InvocationInfo.PositionMessage.Trim()
  }}
  if ($errorRecord.ScriptStackTrace) {{
    $lines += $errorRecord.ScriptStackTrace.Trim()
  }}
  $fallback = ($errorRecord | Out-String).Trim()
  if ($fallback) {{
    $lines += $fallback
  }}

  return ($lines | Where-Object {{ $_ }} | Select-Object -Unique) -join [Environment]::NewLine
}}

try {{
{command}
  if ($LASTEXITCODE -ne 0) {{
    exit $LASTEXITCODE
  }}
}} catch {{
  $detail = Format-KimiShellError $_
  if ($detail) {{
    [Console]::Error.WriteLine($detail)
  }}
  exit 1
}}
"#
    )
}

fn spawn_powershell_script_file(script_path: &Path) -> Result<std::process::Child, String> {
    let mut command = Command::new(POWERSHELL_EXE);
    command_utils::configure_system_command(&mut command);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(script_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to spawn PowerShell: {error}"))
}

fn spawn_powershell_inline_script(script_text: &str) -> Result<std::process::Child, String> {
    let mut command = Command::new(POWERSHELL_EXE);
    command_utils::configure_system_command(&mut command);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
        ])
        .arg(script_text)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to spawn inline PowerShell: {error}"))
}

fn launch_external_fallback(
    task: &InstallTaskDefinition,
    source: InstallSource,
    commands: &str,
) -> Result<String, String> {
    let first_step = catalog::steps_for_source(task, source)
        .into_iter()
        .next()
        .ok_or_else(|| "fallback task has no steps".to_string())?;
    let script_text = build_step_script(first_step.command.as_str());
    let script_path = write_temp_ps1(&first_step, &script_text)?;
    let command_text = format!(
        "Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoLogo','-NoExit','-ExecutionPolicy','Bypass','-File',{})",
        ps_quote(&script_path.display().to_string())
    );

    let mut command = Command::new(POWERSHELL_EXE);
    command_utils::configure_system_command(&mut command);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
        ])
        .arg(command_text)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|error| format!("failed to launch elevated PowerShell: {error}"))?;

    Ok(format!(
        "External fallback launched for {}.\n\n# PowerShell\n{}\n",
        task.title, commands
    ))
}

fn git_ready() -> bool {
    command_succeeds("git", &["--version"])
        || git_candidate_paths()
            .iter()
            .any(|path| command_succeeds_path(path, &["--version"]))
}

fn uv_ready() -> bool {
    command_succeeds("uv", &["--version"])
        || uv_candidate_paths()
            .iter()
            .any(|path| command_succeeds_path(path, &["--version"]))
}

fn node_ready() -> bool {
    command_succeeds("node", &["-v"])
        || node_candidate_paths()
            .iter()
            .any(|path| command_succeeds_path(path, &["-v"]))
}

fn python313_ready() -> bool {
    command_succeeds("py", &["-3.13", "--version"])
        || command_succeeds("python3.13", &["--version"])
        || python_candidate_paths()
            .iter()
            .any(|path| command_succeeds_path(path, &["--version"]))
        || command_succeeds("uv", &["run", "--python", "3.13", "python", "--version"])
        || uv_candidate_paths().iter().any(|path| {
            command_succeeds_path(path, &["run", "--python", "3.13", "python", "--version"])
        })
}

fn kimi_ready(app: &AppHandle) -> bool {
    if let Ok(settings) = settings_store::load_or_default(app) {
        if let Some(path) = settings
            .kimi_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let configured = PathBuf::from(path);
            if command_succeeds_path(&configured, &["--version"])
                || command_succeeds_path(&configured, &["-v"])
            {
                return true;
            }
        }
    }

    command_succeeds("kimi", &["--version"])
        || command_succeeds("kimi", &["-v"])
        || kimi_candidate_paths().iter().any(|path| {
            command_succeeds_path(path, &["--version"]) || command_succeeds_path(path, &["-v"])
        })
}

fn command_exists(name: &str) -> bool {
    resolve_command_path(name).is_some()
}

fn resolve_command_path(name: &str) -> Option<PathBuf> {
    let direct = PathBuf::from(name);
    if direct.is_absolute() && direct.exists() {
        return Some(direct);
    }

    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        let joined = dir.join(name);
        if joined.exists() {
            return Some(joined);
        }
        #[cfg(windows)]
        {
            if joined.extension().is_none() {
                for ext in [".exe", ".cmd", ".bat"] {
                    let candidate = dir.join(format!("{name}{ext}"));
                    if candidate.exists() {
                        return Some(candidate);
                    }
                }
            }
        }
    }
    None
}

fn command_succeeds_path(path: &Path, args: &[&str]) -> bool {
    if !path.exists() {
        return false;
    }
    let mut command = Command::new(path);
    command_utils::configure_system_command(&mut command);
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn command_succeeds(program: &str, args: &[&str]) -> bool {
    let mut command = Command::new(program);
    command_utils::configure_system_command(&mut command);
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn user_home_dir() -> Option<PathBuf> {
    env::var_os("USERPROFILE").map(PathBuf::from)
}

#[cfg(not(windows))]
fn user_home_dir() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn local_app_data_dir() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

#[cfg(not(windows))]
fn local_app_data_dir() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
fn program_files_dirs() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|key| env::var_os(key).map(PathBuf::from))
        .collect()
}

#[cfg(not(windows))]
fn program_files_dirs() -> Vec<PathBuf> {
    Vec::new()
}

fn git_candidate_paths() -> Vec<PathBuf> {
    program_files_dirs()
        .into_iter()
        .map(|base| base.join("Git").join("cmd").join("git.exe"))
        .collect()
}

fn uv_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home_dir) = user_home_dir() {
        candidates.push(home_dir.join(".local").join("bin").join("uv.exe"));
        candidates.push(home_dir.join(".cargo").join("bin").join("uv.exe"));
    }
    candidates
}

fn node_candidate_paths() -> Vec<PathBuf> {
    program_files_dirs()
        .into_iter()
        .map(|base| base.join("nodejs").join("node.exe"))
        .collect()
}

fn python_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(local_app_data) = local_app_data_dir() {
        candidates.push(
            local_app_data
                .join("Programs")
                .join("Python")
                .join("Python313")
                .join("python.exe"),
        );
    }
    candidates
}

fn kimi_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home_dir) = user_home_dir() {
        candidates.push(home_dir.join(".kimi-code").join("bin").join("kimi.exe"));
        candidates.push(home_dir.join(".local").join("bin").join("kimi.exe"));
        candidates.push(home_dir.join(".cargo").join("bin").join("kimi.exe"));
    }
    if let Some(app_data) = env::var_os("APPDATA").map(PathBuf::from) {
        candidates.push(app_data.join("npm").join("kimi.cmd"));
    }
    candidates
}

#[derive(Default)]
struct PowerShellSmokeResult {
    stdout: Option<String>,
    stderr: Option<String>,
    exit_code: Option<i32>,
}

fn collect_powershell_environment() -> (Vec<PowerShellExecutionPolicyItem>, Option<String>) {
    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Get-ExecutionPolicy -List | ForEach-Object { "{0}:{1}" -f $_.Scope, $_.ExecutionPolicy }
Write-Output ("LanguageMode:" + $ExecutionContext.SessionState.LanguageMode)
"#;
    let mut command = Command::new(POWERSHELL_EXE);
    command_utils::configure_system_command(&mut command);
    let output = command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
        ])
        .arg(script)
        .output();
    let Ok(output) = output else {
        return (Vec::new(), None);
    };
    let stdout = decode_stream_bytes(&output.stdout);
    let mut execution_policies = Vec::new();
    let mut language_mode = None;
    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        if let Some(value) = line.strip_prefix("LanguageMode:") {
            language_mode = Some(value.trim().to_string());
            continue;
        }
        if let Some((scope, policy)) = line.split_once(':') {
            execution_policies.push(PowerShellExecutionPolicyItem {
                scope: scope.trim().to_string(),
                policy: policy.trim().to_string(),
            });
        }
    }
    (execution_policies, language_mode)
}

fn run_powershell_file_smoke_test() -> PowerShellSmokeResult {
    let script_text = "Write-Output 'KimiShellPowerShellSmoke'";
    let script_path = env::temp_dir().join(format!("kimi-shell-smoke-{}.ps1", unique_suffix()));
    let result = (|| -> Result<PowerShellSmokeResult, String> {
        {
            let mut file = fs::File::create(&script_path)
                .map_err(|error| format!("failed to create PowerShell smoke script: {error}"))?;
            file.write_all(&[0xEF, 0xBB, 0xBF])
                .map_err(|error| format!("failed to write smoke BOM: {error}"))?;
            file.write_all(script_text.as_bytes())
                .map_err(|error| format!("failed to write smoke script: {error}"))?;
            file.flush()
                .map_err(|error| format!("failed to flush smoke script: {error}"))?;
        }

        let mut command = Command::new(POWERSHELL_EXE);
        command_utils::configure_system_command(&mut command);
        let output = command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&script_path)
            .output()
            .map_err(|error| format!("failed to run PowerShell smoke test: {error}"))?;
        Ok(PowerShellSmokeResult {
            stdout: Some(decode_stream_bytes(&output.stdout)),
            stderr: Some(decode_stream_bytes(&output.stderr)),
            exit_code: output.status.code(),
        })
    })()
    .unwrap_or_else(|error| PowerShellSmokeResult {
        stderr: Some(error),
        ..PowerShellSmokeResult::default()
    });

    let _ = fs::remove_file(&script_path);
    result
}

fn classify_powershell_preflight(
    execution_policies: Vec<PowerShellExecutionPolicyItem>,
    language_mode: Option<String>,
    smoke: PowerShellSmokeResult,
) -> PowerShellPreflightSummary {
    let stdout = smoke.stdout.filter(|value| !value.trim().is_empty());
    let stderr = smoke.stderr.filter(|value| !value.trim().is_empty());
    let detail = stderr
        .clone()
        .or_else(|| stdout.clone())
        .unwrap_or_else(|| "PowerShell preflight completed.".to_string());
    let mut kind = PowerShellDiagnosticKind::Ok;
    let mut suggested_fix = None;

    let normalized = detail.to_lowercase();
    let group_policy_present = execution_policies.iter().any(|item| {
        matches!(item.scope.as_str(), "MachinePolicy" | "UserPolicy")
            && !matches!(
                item.policy.as_str(),
                "Undefined" | "Bypass" | "RemoteSigned" | "Unrestricted"
            )
    });

    if smoke.exit_code.unwrap_or(1) != 0 {
        kind = if normalized.contains("running scripts is disabled")
            || normalized.contains("script execution is disabled")
            || normalized.contains("authorizationmanager check failed")
            || normalized.contains("not digitally signed")
        {
            suggested_fix = Some(EXECUTION_POLICY_SUGGESTION.to_string());
            if group_policy_present {
                PowerShellDiagnosticKind::GroupPolicy
            } else {
                PowerShellDiagnosticKind::ExecutionPolicy
            }
        } else if normalized.contains("applocker")
            || normalized.contains("wdac")
            || normalized.contains("windows defender application control")
            || normalized.contains("blocked by your administrator")
        {
            PowerShellDiagnosticKind::AppLockerOrWdac
        } else if language_mode.as_deref() != Some("FullLanguage") {
            PowerShellDiagnosticKind::ConstrainedLanguage
        } else if normalized.contains("powershell")
            || normalized.contains("parentcontainserrorrecordexception")
            || normalized.contains("objectnotfound")
            || normalized.contains("无法")
            || normalized.contains("不能")
            || normalized.contains("文件")
        {
            PowerShellDiagnosticKind::CommandLaunch
        } else {
            PowerShellDiagnosticKind::Unknown
        };
    }

    PowerShellPreflightSummary {
        kind,
        detail,
        suggested_fix,
        language_mode,
        smoke_test_ok: smoke.exit_code.unwrap_or(1) == 0,
        smoke_test_exit_code: smoke.exit_code,
        smoke_test_stdout: stdout,
        smoke_test_stderr: stderr,
        execution_policies,
    }
}

fn should_retry_powershell_inline(stderr: Option<&str>) -> bool {
    let Some(stderr) = stderr else {
        return false;
    };
    let normalized = stderr.to_lowercase();
    normalized.contains("running scripts is disabled")
        || normalized.contains("script execution is disabled")
        || normalized.contains("authorizationmanager check failed")
        || normalized.contains("not digitally signed")
}

fn terminate_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command_utils::configure_system_command(&mut command);
        let _ = command
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }

    #[cfg(not(windows))]
    {
        let _ = pid;
    }
}

fn truncate_log_line(line: &str) -> String {
    if line.chars().count() <= MAX_LOG_LINE_CHARS {
        return line.to_string();
    }
    let truncated: String = line.chars().take(MAX_LOG_LINE_CHARS).collect();
    format!("{truncated} ...")
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn unique_suffix() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_millis(0));
    format!("{}-{}", std::process::id(), now.as_millis())
}

fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn remove_temp_script(app: &AppHandle, script_path: &Path) {
    if let Err(error) = fs::remove_file(script_path) {
        log_manager::append_line(
            app,
            format!(
                "failed to remove temp install script {}: {error}",
                script_path.display()
            ),
        );
    }
}

fn push_stream_line(
    manager: &InstallManager,
    task_id: InstallTaskId,
    source: InstallSource,
    step_id: Option<String>,
    stream: InstallLogStream,
    bytes: &[u8],
) {
    let line = decode_stream_bytes(bytes);
    if line.trim().is_empty() {
        return;
    }
    manager.push_log(InstallLogChunk {
        task_id,
        step_id,
        source,
        stream,
        text: truncate_log_line(&line),
        at: now_rfc3339(),
    });
}

fn decode_stream_bytes(bytes: &[u8]) -> String {
    let bytes = if bytes.starts_with(&[0xFF, 0xFE]) {
        &bytes[2..]
    } else {
        bytes
    };

    let zero_bytes = bytes.iter().filter(|byte| **byte == 0).count();
    let utf16_candidate = bytes.len() >= 2
        && bytes.chunks_exact(2).remainder().is_empty()
        && zero_bytes * 4 >= bytes.len();

    let decoded = if utf16_candidate {
        let units = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        String::from_utf16_lossy(&units)
    } else if let Ok(decoded) = String::from_utf8(bytes.to_vec()) {
        decoded
    } else {
        let (decoded, _, had_errors) = GBK.decode(bytes);
        if had_errors {
            String::from_utf8_lossy(bytes).into_owned()
        } else {
            decoded.into_owned()
        }
    };

    decoded.trim_end_matches(['\r', '\n']).trim().to_string()
}

fn preferred_failure_detail(snapshot: &InstallSessionSnapshot) -> Option<String> {
    [snapshot.last_stderr.as_ref(), snapshot.last_stdout.as_ref()]
        .into_iter()
        .flatten()
        .map(|line| line.trim())
        .find(|line| !line.is_empty() && !is_low_signal_console_line(line))
        .map(|line| line.to_string())
        .or_else(|| {
            [snapshot.last_stderr.as_ref(), snapshot.last_stdout.as_ref()]
                .into_iter()
                .flatten()
                .map(|line| line.trim())
                .find(|line| !line.is_empty())
                .map(|line| line.to_string())
        })
}

fn is_low_signal_console_line(line: &str) -> bool {
    let normalized = line.trim();
    normalized.eq_ignore_ascii_case("windows powershell")
        || normalized.starts_with("Copyright (C)")
        || normalized.starts_with("For the latest PowerShell features")
}

fn format_failure_summary(step_title: &str, exit_code: Option<i32>, detail: &str) -> String {
    match exit_code {
        Some(code) => format!("Step failed: {step_title} (exit_code={code})\n{detail}"),
        None => format!("Step failed: {step_title}\n{detail}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::InstallTaskGroup;

    #[test]
    fn quick_core_has_three_steps() {
        let task = catalog::build_install_flow_catalog_with_mirror_config(
            &resolved_mirror_config_from_settings(&AppSettings::default()),
        )
        .tasks
        .into_iter()
        .find(|task| task.id == InstallTaskId::QuickInstallCore)
        .expect("quick core task should exist");
        assert_eq!(task.official_steps.len(), 3);
        assert_eq!(task.mirror_steps.len(), 3);
    }

    #[test]
    fn optional_tasks_use_fallback_mode() {
        let tasks = catalog::build_install_flow_catalog_with_mirror_config(
            &resolved_mirror_config_from_settings(&AppSettings::default()),
        )
        .tasks;
        let git = tasks
            .iter()
            .find(|task| task.id == InstallTaskId::InstallGit)
            .unwrap();
        let node = tasks
            .iter()
            .find(|task| task.id == InstallTaskId::InstallNodejs)
            .unwrap();
        assert!(!git.runs_in_app);
        assert!(!node.runs_in_app);
        assert!(git.requires_elevation);
        assert!(node.requires_elevation);
    }

    #[test]
    fn join_commands_contains_titles_and_commands() {
        let text = catalog::join_commands(&[catalog::step(
            "sample",
            "Sample",
            "Desc",
            "Write-Output 'ok'",
        )]);
        assert!(text.contains("Sample"));
        assert!(text.contains("Write-Output 'ok'"));
    }

    #[test]
    fn core_ready_only_tracks_kimi_code() {
        let probe = InstallProbeStatus {
            winget_ready: true,
            git_ready: false,
            git_bash_ready: false,
            kimi_shell_path: None,
            uv_ready: false,
            python313_ready: false,
            kimi_ready: true,
            node_ready: false,
            core_ready: true,
        };
        assert!(probe.core_ready);
        assert!(!probe.git_ready);
        assert!(!probe.uv_ready);
        assert!(!probe.python313_ready);
    }

    #[test]
    fn upgrade_command_uses_kimi_upgrade() {
        let command = catalog::kimi_upgrade_command(None);
        assert!(command.contains("& $kimi upgrade"));
        assert!(command.contains("Invoke-KimiShellVersionCheck 'kimi'"));
        assert!(!command.contains("uv tool upgrade kimi-cli"));
        assert!(!command.contains("uv python install 3.13"));
        assert!(!command.contains("uv tool install kimi-cli --python 3.13 --upgrade"));
    }

    #[test]
    fn install_command_uses_official_kimi_code_installer() {
        let command = catalog::kimi_install_command(None);
        assert!(command.contains(KIMI_CODE_INSTALL_SCRIPT_URL));
        assert!(command.contains("Invoke-KimiShellVersionCheck 'kimi'"));
        assert!(!command.contains("uv tool install kimi-cli"));
        assert!(!command.contains("uv python install 3.13"));
        assert!(!command.contains("kimi -v"));
    }

    #[test]
    fn python_install_command_uses_python313_helper() {
        let command = catalog::python_install_command();
        assert!(command.contains("uv python install 3.13"));
        assert!(command.contains("Invoke-KimiShellPython313Check"));
        assert!(!command.contains("Invoke-KimiShellVersionCheck 'python'"));
    }

    #[test]
    fn upgrade_and_uninstall_require_backend_stop() {
        assert!(managed_task_requires_backend_stop(
            InstallTaskId::UpgradeKimi
        ));
        assert!(managed_task_requires_backend_stop(
            InstallTaskId::UninstallKimi
        ));
        assert!(!managed_task_requires_backend_stop(
            InstallTaskId::InstallKimi
        ));
        assert!(!managed_task_requires_backend_stop(
            InstallTaskId::QuickInstallCore
        ));
    }

    #[test]
    fn upgrade_success_message_requests_restart() {
        let upgrade = InstallTaskDefinition {
            id: InstallTaskId::UpgradeKimi,
            title: "Upgrade Kimi Code".to_string(),
            description: String::new(),
            group: InstallTaskGroup::Upgrade,
            recommended: false,
            runs_in_app: true,
            requires_elevation: false,
            optional: false,
            fallback_reason: None,
            official_steps: vec![],
            mirror_steps: vec![],
        };
        let install = InstallTaskDefinition {
            id: InstallTaskId::InstallKimi,
            title: "Install Kimi Code".to_string(),
            description: String::new(),
            group: InstallTaskGroup::Core,
            recommended: false,
            runs_in_app: true,
            requires_elevation: false,
            optional: false,
            fallback_reason: None,
            official_steps: vec![],
            mirror_steps: vec![],
        };

        assert!(managed_task_success_message(&upgrade).contains("click restart backend"));
        assert!(!managed_task_success_message(&install).contains("click restart backend"));
    }

    #[test]
    fn uninstall_success_message_keeps_backend_stopped_without_restart_prompt() {
        let uninstall = InstallTaskDefinition {
            id: InstallTaskId::UninstallKimi,
            title: "Uninstall Kimi Code".to_string(),
            description: String::new(),
            group: InstallTaskGroup::Core,
            recommended: false,
            runs_in_app: true,
            requires_elevation: false,
            optional: false,
            fallback_reason: None,
            official_steps: vec![],
            mirror_steps: vec![],
        };
        let message = managed_task_success_message(&uninstall);
        assert!(message.contains("backend remains stopped"));
        assert!(!message.contains("click restart backend"));
    }

    #[test]
    fn step_script_adds_uv_tool_bin_lookup() {
        let script = build_step_script("Write-Output 'ok'");
        assert!(script.contains(".kimi-code\\bin"));
        assert!(script.contains("Join-Path $env:APPDATA 'npm'"));
        assert!(script.contains("uv tool dir --bin"));
        assert!(script.contains("$dirs | Where-Object"));
        assert!(script.contains("Format-KimiShellError"));
        assert!(script.contains("Resolve-KimiShellCommandPath"));
        assert!(script.contains("Invoke-KimiShellVersionCheck"));
        assert!(script.contains("Invoke-KimiShellPython313Check"));
        assert!(script.contains("py -3.13 --version"));
        assert!(script.contains("run --python 3.13 python --version"));
    }

    #[test]
    fn failure_detail_prefers_stderr_then_stdout_then_fallback() {
        let snapshot = InstallSessionSnapshot {
            last_stdout: Some("stdout detail".to_string()),
            last_stderr: Some("stderr detail".to_string()),
            ..InstallSessionSnapshot::default()
        };
        assert_eq!(
            preferred_failure_detail(&snapshot).as_deref(),
            Some("stderr detail")
        );

        let stdout_only = InstallSessionSnapshot {
            last_stdout: Some("stdout detail".to_string()),
            ..InstallSessionSnapshot::default()
        };
        assert_eq!(
            preferred_failure_detail(&stdout_only).as_deref(),
            Some("stdout detail")
        );

        let low_signal = InstallSessionSnapshot {
            last_stdout: Some("Windows PowerShell".to_string()),
            last_stderr: Some("".to_string()),
            ..InstallSessionSnapshot::default()
        };
        assert_eq!(
            preferred_failure_detail(&low_signal).as_deref(),
            Some("Windows PowerShell")
        );
    }

    #[test]
    fn decode_stream_bytes_supports_utf8_and_utf16le() {
        assert_eq!(decode_stream_bytes(b"plain stderr\r\n"), "plain stderr");

        let utf16 = vec![
            0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x0d, 0x00, 0x0a, 0x00,
        ];
        assert_eq!(decode_stream_bytes(&utf16), "Test");
    }

    #[test]
    fn decode_stream_bytes_supports_gbk() {
        let (encoded, _, _) = GBK.encode("文件");
        assert_eq!(decode_stream_bytes(encoded.as_ref()), "文件");
    }

    #[test]
    fn smoke_script_can_be_reopened_after_write_scope_ends() {
        let script_path =
            env::temp_dir().join(format!("kimi-shell-smoke-test-{}.ps1", unique_suffix()));
        {
            let mut file =
                fs::File::create(&script_path).expect("failed to create test smoke file");
            file.write_all(b"Write-Output 'ok'")
                .expect("failed to write test smoke file");
            file.flush().expect("failed to flush test smoke file");
        }

        let reopened = fs::OpenOptions::new()
            .read(true)
            .open(&script_path)
            .expect("smoke script should be reopenable after write handle drops");

        drop(reopened);
        let _ = fs::remove_file(&script_path);
    }

    #[test]
    fn custom_mirror_config_requires_https_urls() {
        let config = InstallCustomMirrorConfig {
            git_release_pages: vec!["http://example.com".to_string()],
            uv_release_pages: vec!["https://example.com/uv".to_string()],
            python_installer_urls: vec!["https://example.com/python.exe".to_string()],
            pypi_index_urls: vec!["https://example.com/simple/".to_string()],
        };
        assert!(validate_custom_mirror_config(&config).is_err());
    }

    #[test]
    fn custom_mirror_catalog_uses_saved_urls() {
        let settings = AppSettings {
            mirror_preset: InstallMirrorPreset::Custom,
            custom_mirror_config: InstallCustomMirrorConfig {
                git_release_pages: vec!["https://mirror.example/git/".to_string()],
                uv_release_pages: vec!["https://mirror.example/uv/".to_string()],
                python_installer_urls: vec!["https://mirror.example/python.exe".to_string()],
                pypi_index_urls: vec!["https://mirror.example/simple/".to_string()],
            },
            ..AppSettings::default()
        };
        let catalog = catalog::build_install_flow_catalog_with_mirror_config(
            &resolved_mirror_config_from_settings(&settings),
        );
        let uv_task = catalog
            .tasks
            .iter()
            .find(|task| task.id == InstallTaskId::InstallUv)
            .expect("uv task should exist");
        assert!(uv_task.mirror_steps[0]
            .command
            .contains("https://mirror.example/uv/"));
    }

    #[test]
    fn aliyun_preset_normalizes_to_mixed() {
        assert_eq!(
            normalize_install_mirror_preset(InstallMirrorPreset::Aliyun),
            InstallMirrorPreset::Mixed
        );
    }

    #[test]
    fn ustc_preset_uses_only_ustc_urls() {
        let config = resolved_mirror_config_from_settings(&AppSettings {
            mirror_preset: InstallMirrorPreset::Ustc,
            ..AppSettings::default()
        });
        assert_eq!(
            config.git_release_pages,
            USTC_GIT_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            config.uv_release_pages,
            USTC_UV_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            config.python_installer_urls,
            USTC_PYTHON_MIRROR_INSTALLERS
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            config.pypi_index_urls,
            USTC_PYPI_INDEXES
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn mixed_preset_uses_curated_default_order() {
        let config = resolved_mirror_config_from_settings(&AppSettings::default());
        assert_eq!(
            config.git_release_pages,
            DEFAULT_GIT_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            config.uv_release_pages,
            DEFAULT_UV_MIRROR_RELEASE_PAGES
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            config.python_installer_urls,
            DEFAULT_PYTHON_MIRROR_INSTALLERS
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            config.pypi_index_urls,
            DEFAULT_PYPI_INDEXES
                .iter()
                .map(|value| (*value).to_string())
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn release_page_health_requires_expected_asset_link() {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("server should start");
        let address = format!("http://{}", server.server_addr());
        let thread = std::thread::spawn(move || {
            for _ in 0..2 {
                let request = server.recv().expect("request should arrive");
                let body = "<html><body>no asset here</body></html>";
                let response = tiny_http::Response::from_string(body).with_status_code(200);
                request.respond(response).expect("response should send");
            }
        });

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("client should build");

        let git_entry = check_release_page_health(
            &client,
            InstallMirrorHealthCategory::GitReleasePage,
            &address,
        );
        let uv_entry = check_release_page_health(
            &client,
            InstallMirrorHealthCategory::UvReleasePage,
            &address,
        );
        thread.join().expect("server thread should complete");

        assert!(!git_entry.healthy);
        assert_eq!(git_entry.status_code, Some(200));
        assert!(!uv_entry.healthy);
        assert_eq!(uv_entry.status_code, Some(200));
    }

    #[test]
    fn execution_policy_preflight_suggests_current_user_fix() {
        let summary = classify_powershell_preflight(
            vec![PowerShellExecutionPolicyItem {
                scope: "CurrentUser".to_string(),
                policy: "Restricted".to_string(),
            }],
            Some("FullLanguage".to_string()),
            PowerShellSmokeResult {
                stderr: Some("File C:\\test.ps1 cannot be loaded because running scripts is disabled on this system.".to_string()),
                exit_code: Some(1),
                ..PowerShellSmokeResult::default()
            },
        );
        assert_eq!(summary.kind, PowerShellDiagnosticKind::ExecutionPolicy);
        assert_eq!(
            summary.suggested_fix.as_deref(),
            Some(EXECUTION_POLICY_SUGGESTION)
        );
    }

    #[test]
    fn powershell_inline_retry_detects_script_policy_errors() {
        assert!(should_retry_powershell_inline(Some(
            "running scripts is disabled on this system"
        )));
        assert!(!should_retry_powershell_inline(Some("uv command failed")));
    }

    #[test]
    fn fallback_probe_completion_is_task_specific() {
        let probe = InstallProbeStatus {
            winget_ready: true,
            git_ready: true,
            git_bash_ready: false,
            kimi_shell_path: None,
            uv_ready: false,
            python313_ready: false,
            kimi_ready: false,
            node_ready: false,
            core_ready: false,
        };
        assert!(fallback_probe_satisfied(InstallTaskId::InstallGit, &probe));
        assert!(!fallback_probe_satisfied(
            InstallTaskId::InstallNodejs,
            &probe
        ));
    }
}
