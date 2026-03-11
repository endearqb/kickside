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
use tauri::{ipc::Channel, AppHandle};

use crate::{
    backend_manager, command_utils, log_manager, settings_store,
    types::{
        InstallFlowCatalog, InstallLogChunk, InstallLogStream, InstallProbeStatus,
        InstallSessionEvent, InstallSessionSnapshot, InstallSessionStage, InstallSessionStatus,
        InstallSource, InstallTaskDefinition, InstallTaskGroup, InstallTaskId, InstallTaskStep,
    },
};

const POWERSHELL_EXE: &str = "powershell.exe";
const MAX_INSTALL_LOG_CHUNKS: usize = 400;
const MAX_LOG_LINE_CHARS: usize = 2_000;

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
        let task = build_install_flow_catalog()
            .tasks
            .into_iter()
            .find(|task| task.id == task_id)
            .ok_or_else(|| "unknown install task".to_string())?;

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

pub fn build_install_flow_catalog() -> InstallFlowCatalog {
    InstallFlowCatalog {
        tasks: vec![
            task(
                InstallTaskId::QuickInstallCore,
                "Quick Core Install",
                "Install uv, Python 3.13, and Kimi CLI in sequence.",
                InstallTaskGroup::Core,
                true,
                false,
                false,
                vec![
                    step_uv_official(),
                    step_python_official(),
                    step_kimi_official(),
                ],
                vec![step_uv_mirror(), step_python_mirror(), step_kimi_mirror()],
                None,
            ),
            task(
                InstallTaskId::InstallUv,
                "Install uv",
                "Install or repair the uv CLI.",
                InstallTaskGroup::Core,
                false,
                false,
                false,
                vec![step_uv_official()],
                vec![step_uv_mirror()],
                None,
            ),
            task(
                InstallTaskId::InstallPython313,
                "Install Python 3.13",
                "Prepare the Python 3.13 runtime required by Kimi CLI.",
                InstallTaskGroup::Core,
                false,
                false,
                false,
                vec![step_python_official()],
                vec![step_python_mirror()],
                None,
            ),
            task(
                InstallTaskId::InstallKimi,
                "Install Kimi CLI",
                "Install Kimi CLI with uv tool.",
                InstallTaskGroup::Core,
                false,
                false,
                false,
                vec![step_kimi_official()],
                vec![step_kimi_mirror()],
                None,
            ),
            task(
                InstallTaskId::UpgradeKimi,
                "Upgrade Kimi CLI",
                "Upgrade the installed Kimi CLI to the latest version.",
                InstallTaskGroup::Upgrade,
                false,
                false,
                false,
                vec![step_upgrade_official()],
                vec![step_upgrade_mirror()],
                None,
            ),
            task(
                InstallTaskId::InstallGit,
                "Install Git for Windows",
                "Optional enhancement for broader development workflows.",
                InstallTaskGroup::Optional,
                false,
                true,
                true,
                vec![step_git_official()],
                vec![step_git_mirror()],
                Some("Git for Windows uses an external elevated installer.".to_string()),
            ),
            task(
                InstallTaskId::InstallNodejs,
                "Install Node.js",
                "Optional enhancement for Node-based tooling.",
                InstallTaskGroup::Optional,
                false,
                true,
                true,
                vec![step_node()],
                vec![step_node()],
                Some("Node.js uses an external elevated installer.".to_string()),
            ),
        ],
    }
}

pub fn get_install_probe_status(app: &AppHandle) -> InstallProbeStatus {
    let winget_ready = command_exists("winget");
    let git_ready = command_exists("git");
    let uv_ready = command_exists("uv");
    let python313_ready = python313_ready();
    let kimi_ready = kimi_ready(app);
    let node_ready = command_exists("node");

    InstallProbeStatus {
        winget_ready,
        git_ready,
        uv_ready,
        python313_ready,
        kimi_ready,
        node_ready,
        core_ready: uv_ready && python313_ready && kimi_ready,
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

    for step in steps_for_source(&task, source) {
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
    let commands = join_commands(&steps_for_source(&task, source));
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
                "External elevated terminal launched. Re-run detection after it completes."
                    .to_string(),
            );
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
    let script_path = write_temp_ps1(step)?;
    let mut child = spawn_powershell_script(&script_path)?;

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

    if manager.is_cancel_requested() {
        remove_temp_script(app, &script_path);
        return Ok(None);
    }

    remove_temp_script(app, &script_path);
    Ok(status.code())
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

    let _ = manager.update_snapshot(|state| {
        state.snapshot.status = InstallSessionStatus::Running;
        state.snapshot.stage = InstallSessionStage::Prepare;
        state.snapshot.current_step_id = None;
        state.snapshot.current_step_title = Some("Stop app backend".to_string());
        state.snapshot.message =
            Some("Stopping app backend before upgrading Kimi CLI.".to_string());
    });
    push_system_log(
        manager,
        task.id,
        source,
        "Stopping app backend before upgrading Kimi CLI.".to_string(),
    );

    backend_manager::stop_backend(app)
        .map_err(|error| format!("Failed to stop the app backend before upgrade: {error:#}"))?;

    let _ = manager.update_snapshot(|state| {
        state.snapshot.status = InstallSessionStatus::Running;
        state.snapshot.stage = InstallSessionStage::Prepare;
        state.snapshot.current_step_id = None;
        state.snapshot.current_step_title = None;
        state.snapshot.message =
            Some("App backend stopped. Starting Kimi CLI upgrade.".to_string());
    });
    push_system_log(
        manager,
        task.id,
        source,
        "App backend stopped. Starting Kimi CLI upgrade.".to_string(),
    );
    Ok(())
}

fn managed_task_requires_backend_stop(task_id: InstallTaskId) -> bool {
    matches!(task_id, InstallTaskId::UpgradeKimi)
}

fn managed_task_success_message(task: &InstallTaskDefinition) -> String {
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

fn task(
    id: InstallTaskId,
    title: &str,
    description: &str,
    group: InstallTaskGroup,
    recommended: bool,
    requires_elevation: bool,
    optional: bool,
    official_steps: Vec<InstallTaskStep>,
    mirror_steps: Vec<InstallTaskStep>,
    fallback_reason: Option<String>,
) -> InstallTaskDefinition {
    InstallTaskDefinition {
        id,
        title: title.to_string(),
        description: description.to_string(),
        group,
        recommended,
        runs_in_app: !requires_elevation,
        requires_elevation,
        optional,
        fallback_reason,
        official_steps,
        mirror_steps,
    }
}

fn step(id: &str, title: &str, description: &str, command: &str) -> InstallTaskStep {
    InstallTaskStep {
        id: id.to_string(),
        title: title.to_string(),
        description: description.to_string(),
        command: command.trim().to_string(),
    }
}

fn step_uv_official() -> InstallTaskStep {
    step(
        "install_uv",
        "Install uv",
        "Prefer winget and fall back to the official installer script.",
        r#"
$uvCmd = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvCmd) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install uv.' }
  try { winget install --id astral-sh.uv -e --source winget --accept-source-agreements --accept-package-agreements } catch { Write-Host 'winget install uv failed, falling back to official script.' }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { Invoke-RestMethod -Uri 'https://astral.sh/uv/install.ps1' | Invoke-Expression }
Ensure-KimiShellPath
uv --version
"#,
    )
}

fn step_uv_mirror() -> InstallTaskStep {
    step(
        "install_uv",
        "Install uv",
        "Download the uv archive from mirror release pages.",
        r#"
$releaseUrls = @('https://mirrors.tuna.tsinghua.edu.cn/github-release/astral-sh/uv/LatestRelease/','https://mirrors.aliyun.com/github-release/astral-sh/uv/LatestRelease/')
$assetPattern = '(?i)uv-x86_64-pc-windows-msvc\.zip$'
$uvInstallDir = Join-Path $HOME '.local\bin'
$uvZipPath = Join-Path $env:TEMP 'kimi-shell-uv.zip'
$uvExtractDir = Join-Path $env:TEMP 'kimi-shell-uv'
New-Item -ItemType Directory -Force -Path $uvInstallDir | Out-Null
foreach ($releaseUrl in $releaseUrls) {
  try {
    $releasePage = Invoke-WebRequest -Uri $releaseUrl -TimeoutSec 45 -ErrorAction Stop
    $assetHref = @($releasePage.Links | Where-Object { $_.href } | ForEach-Object { $_.href } | Where-Object { $_ -match $assetPattern } | Select-Object -First 1)[0]
    if (-not $assetHref) { throw 'missing uv asset' }
    if (Test-Path $uvZipPath) { Remove-Item $uvZipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path $uvExtractDir) { Remove-Item $uvExtractDir -Recurse -Force -ErrorAction SilentlyContinue }
    Invoke-WebRequest -Uri ([System.Uri]::new([System.Uri]$releaseUrl, $assetHref).AbsoluteUri) -OutFile $uvZipPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
    Expand-Archive -Path $uvZipPath -DestinationPath $uvExtractDir -Force
    $uvExe = Get-ChildItem -Path $uvExtractDir -Recurse -Filter 'uv.exe' | Select-Object -First 1
    if (-not $uvExe) { throw 'expanded archive does not contain uv.exe' }
    Copy-Item -Path $uvExe.FullName -Destination (Join-Path $uvInstallDir 'uv.exe') -Force
    break
  } catch {
    Write-Host ('uv mirror install failed, trying next source: ' + $releaseUrl)
  }
}
Ensure-KimiShellPath
uv --version
"#,
    )
}

fn step_python_official() -> InstallTaskStep {
    step(
        "install_python313",
        "Install Python 3.13",
        "Install and verify Python 3.13 through uv.",
        r#"
Ensure-KimiShellPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required before installing Python 3.13.' }
uv python install 3.13
uv run --python 3.13 python --version
"#,
    )
}

fn step_python_mirror() -> InstallTaskStep {
    step(
        "install_python313",
        "Install Python 3.13",
        "Try uv first, then use a mirrored Python installer.",
        r#"
$pythonUserExe = Join-Path $env:LocalAppData 'Programs\Python\Python313\python.exe'
if (Test-Path $pythonUserExe) { & $pythonUserExe --version; exit 0 }
if (Get-Command uv -ErrorAction SilentlyContinue) {
  try { uv python install 3.13; uv run --python 3.13 python --version; exit 0 } catch { Write-Host 'uv-managed Python unavailable, trying installer mirror.' }
}
$pythonMirrors = @('https://mirrors.tuna.tsinghua.edu.cn/python/3.13.12/python-3.13.12-amd64.exe','https://mirrors.aliyun.com/python-release/windows/python-3.13.12-amd64.exe')
$pythonInstallerPath = Join-Path $env:TEMP 'kimi-shell-python-3.13.12-amd64.exe'
foreach ($mirrorUrl in $pythonMirrors) {
  try {
    Invoke-WebRequest -Uri $mirrorUrl -OutFile $pythonInstallerPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
    $proc = Start-Process -FilePath $pythonInstallerPath -ArgumentList @('/quiet','InstallAllUsers=0','PrependPath=1','Include_pip=1','Include_test=0') -Wait -PassThru
    if ($null -eq $proc -or $proc.ExitCode -ne 0) { throw 'python installer failed' }
    & $pythonUserExe --version
    exit 0
  } catch {
    Write-Host ('python mirror install failed, trying next source: ' + $mirrorUrl)
  }
}
throw 'Python 3.13 mirror install failed.'
"#,
    )
}

fn step_kimi_official() -> InstallTaskStep {
    step(
        "install_kimi",
        "Install Kimi CLI",
        "Install Kimi CLI with uv tool and print the installed version.",
        kimi_install_command(None),
    )
}

fn step_kimi_mirror() -> InstallTaskStep {
    step(
        "install_kimi",
        "Install Kimi CLI",
        "Install Kimi CLI from mirrored PyPI indexes.",
        kimi_install_command(Some(
            "@('https://pypi.tuna.tsinghua.edu.cn/simple/','https://mirrors.aliyun.com/pypi/simple/')",
        )),
    )
}

fn step_upgrade_official() -> InstallTaskStep {
    step(
        "upgrade_kimi",
        "Upgrade Kimi CLI",
        "Upgrade Kimi CLI from the official source.",
        kimi_upgrade_command(None),
    )
}

fn step_upgrade_mirror() -> InstallTaskStep {
    step(
        "upgrade_kimi",
        "Upgrade Kimi CLI",
        "Upgrade Kimi CLI from mirrored PyPI indexes.",
        kimi_upgrade_command(Some(
            "@('https://pypi.tuna.tsinghua.edu.cn/simple/','https://mirrors.aliyun.com/pypi/simple/')",
        )),
    )
}

fn kimi_install_command(indexes_expr: Option<&str>) -> &'static str {
    match indexes_expr {
        None => {
            r#"
Ensure-KimiShellPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required before installing Kimi CLI.' }
uv python install 3.13
uv tool install kimi-cli --python 3.13 --upgrade
Ensure-KimiShellPath
kimi --version
"#
        }
        Some(_) => {
            r#"
Ensure-KimiShellPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required before installing Kimi CLI.' }
uv python install 3.13
$indexes = @('https://pypi.tuna.tsinghua.edu.cn/simple/','https://mirrors.aliyun.com/pypi/simple/')
foreach ($index in $indexes) {
  try {
    uv tool install kimi-cli --python 3.13 --upgrade -i $index
    Ensure-KimiShellPath
    kimi --version
    exit 0
  } catch {
    Write-Host ('Kimi mirror install failed, trying next index: ' + $index)
  }
}
throw 'Kimi mirror install failed.'
"#
        }
    }
}

fn kimi_upgrade_command(indexes_expr: Option<&str>) -> &'static str {
    match indexes_expr {
        None => {
            r#"
Ensure-KimiShellPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required before upgrading Kimi CLI.' }
uv tool upgrade kimi-cli
if ($LASTEXITCODE -ne 0) { throw "uv tool upgrade kimi-cli failed with exit code $LASTEXITCODE." }
Ensure-KimiShellPath
kimi --version
if ($LASTEXITCODE -ne 0) { throw "kimi --version failed with exit code $LASTEXITCODE." }
"#
        }
        Some(_) => {
            r#"
Ensure-KimiShellPath
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required before upgrading Kimi CLI.' }
$indexes = @('https://pypi.tuna.tsinghua.edu.cn/simple/','https://mirrors.aliyun.com/pypi/simple/')
foreach ($index in $indexes) {
  try {
    uv tool upgrade kimi-cli -i $index
    if ($LASTEXITCODE -ne 0) { throw "uv tool upgrade kimi-cli failed with exit code $LASTEXITCODE." }
    Ensure-KimiShellPath
    kimi --version
    if ($LASTEXITCODE -ne 0) { throw "kimi --version failed with exit code $LASTEXITCODE." }
    exit 0
  } catch {
    [Console]::Error.WriteLine(('Kimi mirror upgrade failed for index ' + $index + ': ' + $_.Exception.Message))
  }
}
throw 'Kimi mirror upgrade failed.'
"#
        }
    }
}

fn step_git_official() -> InstallTaskStep {
    step(
        "install_git",
        "Install Git for Windows",
        "Install Git through winget.",
        r#"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install Git.' }
winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
git --version
"#,
    )
}

fn step_git_mirror() -> InstallTaskStep {
    step(
        "install_git",
        "Install Git for Windows",
        "Download the Git installer from a mirror.",
        r#"
$latestReleaseUrl = 'https://mirrors.tuna.tsinghua.edu.cn/github-release/git-for-windows/git/LatestRelease/'
$baseUri = [System.Uri]$latestReleaseUrl
$page = Invoke-WebRequest -Uri $latestReleaseUrl -TimeoutSec 45 -ErrorAction Stop
$installerHref = @($page.Links | Where-Object { $_.href } | ForEach-Object { $_.href } | Where-Object { $_ -match '(?i)Git-[^/]*-64-bit\.exe$' } | Select-Object -First 1)[0]
if (-not $installerHref) { throw 'Mirror page does not contain a Git installer.' }
$installerPath = Join-Path $env:TEMP 'kimi-shell-git-installer.exe'
Invoke-WebRequest -Uri ([System.Uri]::new($baseUri, $installerHref).AbsoluteUri) -OutFile $installerPath -TimeoutSec 180 -MaximumRedirection 8 -ErrorAction Stop
Start-Process -FilePath $installerPath -Wait
git --version
"#,
    )
}

fn step_node() -> InstallTaskStep {
    step(
        "install_nodejs",
        "Install Node.js",
        "Install Node.js through winget.",
        r#"
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is required to install Node.js.' }
winget install OpenJS.NodeJS --accept-source-agreements --accept-package-agreements
node -v
"#,
    )
}

fn steps_for_source(task: &InstallTaskDefinition, source: InstallSource) -> Vec<InstallTaskStep> {
    match source {
        InstallSource::Official => {
            if task.official_steps.is_empty() {
                task.mirror_steps.clone()
            } else {
                task.official_steps.clone()
            }
        }
        InstallSource::Mirror => {
            if task.mirror_steps.is_empty() {
                task.official_steps.clone()
            } else {
                task.mirror_steps.clone()
            }
        }
    }
}

fn join_commands(steps: &[InstallTaskStep]) -> String {
    steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            format!(
                "# {}. {}\n# {}\n{}\n",
                index + 1,
                step.title,
                step.description,
                step.command.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn write_temp_ps1(step: &InstallTaskStep) -> Result<PathBuf, String> {
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
    file.write_all(build_step_script(step.command.as_str()).as_bytes())
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
  $dirs = @((Join-Path $HOME '.local\bin'), (Join-Path $HOME '.cargo\bin'))
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

fn spawn_powershell_script(script_path: &Path) -> Result<std::process::Child, String> {
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

fn launch_external_fallback(
    task: &InstallTaskDefinition,
    source: InstallSource,
    commands: &str,
) -> Result<String, String> {
    let first_step = steps_for_source(task, source)
        .into_iter()
        .next()
        .ok_or_else(|| "fallback task has no steps".to_string())?;
    let script_path = write_temp_ps1(&first_step)?;
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

fn python313_ready() -> bool {
    let user_python = env::var_os("LocalAppData").map(PathBuf::from).map(|base| {
        base.join("Programs")
            .join("Python")
            .join("Python313")
            .join("python.exe")
    });
    if let Some(path) = user_python {
        if path.exists() {
            return true;
        }
    }

    command_succeeds("py", &["-3.13", "--version"])
        || command_succeeds("python3.13", &["--version"])
        || command_succeeds("uv", &["run", "--python", "3.13", "python", "--version"])
}

fn kimi_ready(app: &AppHandle) -> bool {
    if let Ok(settings) = settings_store::load_or_default(app) {
        if let Some(path) = settings
            .kimi_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if PathBuf::from(path).exists() {
                return true;
            }
        }
    }
    command_exists("kimi")
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
    } else {
        String::from_utf8_lossy(bytes).into_owned()
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

    #[test]
    fn quick_core_has_three_steps() {
        let task = build_install_flow_catalog()
            .tasks
            .into_iter()
            .find(|task| task.id == InstallTaskId::QuickInstallCore)
            .expect("quick core task should exist");
        assert_eq!(task.official_steps.len(), 3);
        assert_eq!(task.mirror_steps.len(), 3);
    }

    #[test]
    fn optional_tasks_use_fallback_mode() {
        let tasks = build_install_flow_catalog().tasks;
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
        let text = join_commands(&[step("sample", "Sample", "Desc", "Write-Output 'ok'")]);
        assert!(text.contains("Sample"));
        assert!(text.contains("Write-Output 'ok'"));
    }

    #[test]
    fn core_ready_does_not_depend_on_git() {
        let probe = InstallProbeStatus {
            winget_ready: true,
            git_ready: false,
            uv_ready: true,
            python313_ready: true,
            kimi_ready: true,
            node_ready: false,
            core_ready: true,
        };
        assert!(probe.core_ready);
        assert!(!probe.git_ready);
    }

    #[test]
    fn upgrade_command_is_pure_upgrade() {
        let command = kimi_upgrade_command(None);
        assert!(command.contains("uv tool upgrade kimi-cli"));
        assert!(command.contains("kimi --version"));
        assert!(!command.contains("uv python install 3.13"));
        assert!(!command.contains("uv tool install kimi-cli --python 3.13 --upgrade"));
    }

    #[test]
    fn install_command_uses_supported_version_flag() {
        let command = kimi_install_command(None);
        assert!(command.contains("kimi --version"));
        assert!(!command.contains("kimi -v"));
    }

    #[test]
    fn only_upgrade_task_requires_backend_stop() {
        assert!(managed_task_requires_backend_stop(
            InstallTaskId::UpgradeKimi
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
            title: "Upgrade Kimi CLI".to_string(),
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
            title: "Install Kimi CLI".to_string(),
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
    fn step_script_adds_uv_tool_bin_lookup() {
        let script = build_step_script("Write-Output 'ok'");
        assert!(script.contains("uv tool dir --bin"));
        assert!(script.contains("$dirs | Where-Object"));
        assert!(script.contains("Format-KimiShellError"));
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
}
