use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Context};
use chrono::{
    DateTime, Datelike, Duration as ChronoDuration, Local, LocalResult, NaiveDate, NaiveDateTime,
    NaiveTime, TimeZone, Utc,
};
use cron::Schedule;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::{
    acp::{self, AcpExecutionPermission, AcpRunInput, AcpRunOutcome},
    kimi_locator, log_manager, settings_store, workspaces,
};

static RUNNING_WORKSPACES: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScheduleOutcome {
    Planned,
    Executing,
    Executed,
    Failed,
    Skipped,
    BlockedByPermission,
    ScheduleError,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatConfig {
    pub id: String,
    pub workspace_id: String,
    pub enabled: bool,
    pub interval_minutes: u64,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub last_outcome: Option<ScheduleOutcome>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ScheduleCadence {
    Daily { at: String },
    Weekday { at: String },
    Cron { expression: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTask {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub prompt: String,
    pub cadence: ScheduleCadence,
    pub enabled: bool,
    #[serde(default)]
    pub execution_permission: AcpExecutionPermission,
    #[serde(default = "default_max_run_minutes")]
    pub max_run_minutes: u64,
    #[serde(default)]
    pub last_run_at: Option<String>,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub last_outcome: Option<ScheduleOutcome>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleStore {
    #[serde(default)]
    pub heartbeats: Vec<HeartbeatConfig>,
    #[serde(default)]
    pub tasks: Vec<ScheduledTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub kind: String,
    pub workspace_id: String,
    #[serde(default)]
    pub task_id: Option<String>,
    pub task_name: String,
    pub outcome: ScheduleOutcome,
    #[serde(default)]
    pub acp_session_id: Option<String>,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub raw_events_path: Option<String>,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeartbeatInput {
    pub workspace_id: String,
    pub enabled: bool,
    #[serde(default)]
    pub interval_minutes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskInput {
    pub workspace_id: String,
    pub name: String,
    pub prompt: String,
    pub cadence: ScheduleCadence,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub execution_permission: AcpExecutionPermission,
    #[serde(default)]
    pub max_run_minutes: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledTaskPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default)]
    pub cadence: Option<ScheduleCadence>,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub execution_permission: Option<AcpExecutionPermission>,
    #[serde(default)]
    pub max_run_minutes: Option<u64>,
}

fn default_max_run_minutes() -> u64 {
    20
}

pub fn start(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(60));
        if let Err(error) = tick(&app) {
            log_manager::append_line(&app, format!("scheduler tick failed: {error:#}"));
        }
    });
}

fn tick(app: &AppHandle) -> anyhow::Result<()> {
    let now = Utc::now();
    let state = load_state(app)?;
    let due_heartbeats = state
        .heartbeats
        .iter()
        .filter(|heartbeat| heartbeat.enabled && is_due(heartbeat.next_run_at.as_deref(), now))
        .map(|heartbeat| heartbeat.id.clone())
        .collect::<Vec<_>>();
    let due_tasks = state
        .tasks
        .iter()
        .filter(|task| task.enabled && is_due(task.next_run_at.as_deref(), now))
        .map(|task| task.id.clone())
        .collect::<Vec<_>>();

    for id in due_heartbeats {
        let app = app.clone();
        thread::spawn(move || {
            if let Err(error) = run_now_inner(&app, "heartbeat", &id) {
                log_manager::append_line(&app, format!("scheduler heartbeat failed: {error:#}"));
            }
        });
    }
    for id in due_tasks {
        let app = app.clone();
        thread::spawn(move || {
            if let Err(error) = run_now_inner(&app, "task", &id) {
                log_manager::append_line(&app, format!("scheduler task failed: {error:#}"));
            }
        });
    }
    Ok(())
}

fn is_due(value: Option<&str>, now: DateTime<Utc>) -> bool {
    value
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc) <= now)
        .unwrap_or(false)
}

fn run_now_inner(app: &AppHandle, kind: &str, ref_id: &str) -> anyhow::Result<RunRecord> {
    match kind {
        "heartbeat" => run_heartbeat(app, ref_id),
        "task" => run_task(app, ref_id),
        _ => bail!("unsupported schedule run kind: {kind}"),
    }
}

fn run_heartbeat(app: &AppHandle, heartbeat_id: &str) -> anyhow::Result<RunRecord> {
    let state = load_state(app)?;
    let heartbeat = state
        .heartbeats
        .iter()
        .find(|heartbeat| heartbeat.id == heartbeat_id || heartbeat.workspace_id == heartbeat_id)
        .cloned()
        .ok_or_else(|| anyhow!("heartbeat not found: {heartbeat_id}"))?;
    let started = Utc::now();
    let instant = Instant::now();
    let workspace = workspaces::find(app, &heartbeat.workspace_id)?;
    let exists = Path::new(&workspace.cwd).is_dir();
    let outcome = if exists {
        ScheduleOutcome::Executed
    } else {
        ScheduleOutcome::Failed
    };
    let record = RunRecord {
        id: run_id("heartbeat"),
        kind: "heartbeat".to_string(),
        workspace_id: workspace.id.clone(),
        task_id: None,
        task_name: "只读心跳".to_string(),
        outcome,
        acp_session_id: None,
        plan: Some("只读检查：确认工作区注册记录与目录可达，不写入文件。".to_string()),
        result: Some(if exists {
            format!("工作区目录可达：{}", workspace.cwd)
        } else {
            format!("工作区目录不存在：{}", workspace.cwd)
        }),
        error: if exists {
            None
        } else {
            Some("workspace_cwd_missing".to_string())
        },
        raw_events_path: None,
        started_at: started.to_rfc3339(),
        finished_at: Utc::now().to_rfc3339(),
        duration_ms: instant.elapsed().as_millis(),
    };
    append_run(app, &record)?;
    update_heartbeat_after_run(app, &heartbeat.id, outcome)?;
    Ok(record)
}

fn run_task(app: &AppHandle, task_id: &str) -> anyhow::Result<RunRecord> {
    let state = load_state(app)?;
    let task = state
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .cloned()
        .ok_or_else(|| anyhow!("scheduled task not found: {task_id}"))?;
    let workspace = workspaces::find(app, &task.workspace_id)?;
    let guard = match WorkspaceRunGuard::acquire(&workspace.id) {
        Some(guard) => guard,
        None => {
            let record = skipped_record(&workspace.id, &task);
            append_run(app, &record)?;
            return Ok(record);
        }
    };

    let started = Utc::now();
    let instant = Instant::now();
    let settings = settings_store::load_or_default(app)?;
    let kimi_bin = match kimi_locator::locate(&settings) {
        Ok(path) => path,
        Err(error) => {
            drop(guard);
            let record = failed_record(
                &workspace.id,
                &task,
                started,
                instant.elapsed().as_millis(),
                error,
            );
            append_run(app, &record)?;
            update_task_after_run(app, &task.id, ScheduleOutcome::Failed)?;
            return Ok(record);
        }
    };

    let result = acp::run_plan_then_run(
        &kimi_bin,
        Path::new(&workspace.cwd),
        AcpRunInput {
            task_name: task.name.clone(),
            prompt: task.prompt.clone(),
            permission: task.execution_permission,
            timeout: Duration::from_secs(task.max_run_minutes.saturating_mul(60).max(60)),
        },
    );
    drop(guard);

    let outcome = match result.outcome {
        AcpRunOutcome::Executed => ScheduleOutcome::Executed,
        AcpRunOutcome::Failed => ScheduleOutcome::Failed,
        AcpRunOutcome::BlockedByPermission => ScheduleOutcome::BlockedByPermission,
    };
    let raw_events_path = write_raw_events(app, &result.raw_events)?;
    let record = RunRecord {
        id: run_id("run"),
        kind: "task".to_string(),
        workspace_id: workspace.id,
        task_id: Some(task.id.clone()),
        task_name: task.name,
        outcome,
        acp_session_id: result.acp_session_id,
        plan: result.plan,
        result: result.result,
        error: result.error,
        raw_events_path,
        started_at: started.to_rfc3339(),
        finished_at: Utc::now().to_rfc3339(),
        duration_ms: instant.elapsed().as_millis(),
    };
    append_run(app, &record)?;
    update_task_after_run(app, &task.id, outcome)?;
    Ok(record)
}

struct WorkspaceRunGuard {
    workspace_id: String,
}

impl WorkspaceRunGuard {
    fn acquire(workspace_id: &str) -> Option<Self> {
        let running = RUNNING_WORKSPACES.get_or_init(|| Mutex::new(HashSet::new()));
        let mut guard = running.lock().ok()?;
        if guard.contains(workspace_id) {
            return None;
        }
        guard.insert(workspace_id.to_string());
        Some(Self {
            workspace_id: workspace_id.to_string(),
        })
    }
}

impl Drop for WorkspaceRunGuard {
    fn drop(&mut self) {
        if let Some(running) = RUNNING_WORKSPACES.get() {
            if let Ok(mut guard) = running.lock() {
                guard.remove(&self.workspace_id);
            }
        }
    }
}

fn skipped_record(workspace_id: &str, task: &ScheduledTask) -> RunRecord {
    let now = Utc::now().to_rfc3339();
    RunRecord {
        id: run_id("run"),
        kind: "task".to_string(),
        workspace_id: workspace_id.to_string(),
        task_id: Some(task.id.clone()),
        task_name: task.name.clone(),
        outcome: ScheduleOutcome::Skipped,
        acp_session_id: None,
        plan: None,
        result: None,
        error: Some("workspace_already_running".to_string()),
        raw_events_path: None,
        started_at: now.clone(),
        finished_at: now,
        duration_ms: 0,
    }
}

fn failed_record(
    workspace_id: &str,
    task: &ScheduledTask,
    started: DateTime<Utc>,
    duration_ms: u128,
    error: String,
) -> RunRecord {
    RunRecord {
        id: run_id("run"),
        kind: "task".to_string(),
        workspace_id: workspace_id.to_string(),
        task_id: Some(task.id.clone()),
        task_name: task.name.clone(),
        outcome: ScheduleOutcome::Failed,
        acp_session_id: None,
        plan: None,
        result: None,
        error: Some(error),
        raw_events_path: None,
        started_at: started.to_rfc3339(),
        finished_at: Utc::now().to_rfc3339(),
        duration_ms,
    }
}

fn update_heartbeat_after_run(
    app: &AppHandle,
    heartbeat_id: &str,
    outcome: ScheduleOutcome,
) -> anyhow::Result<()> {
    let mut state = load_state(app)?;
    if let Some(heartbeat) = state
        .heartbeats
        .iter_mut()
        .find(|heartbeat| heartbeat.id == heartbeat_id)
    {
        let now = Utc::now();
        heartbeat.last_run_at = Some(now.to_rfc3339());
        heartbeat.next_run_at = if heartbeat.enabled {
            Some((now + ChronoDuration::minutes(heartbeat.interval_minutes as i64)).to_rfc3339())
        } else {
            None
        };
        heartbeat.last_outcome = Some(outcome);
        heartbeat.updated_at = now.to_rfc3339();
        save_state(app, &state)?;
    }
    Ok(())
}

fn update_task_after_run(
    app: &AppHandle,
    task_id: &str,
    outcome: ScheduleOutcome,
) -> anyhow::Result<()> {
    let mut state = load_state(app)?;
    if let Some(task) = state.tasks.iter_mut().find(|task| task.id == task_id) {
        let now = Utc::now();
        let mut stored_outcome = outcome;
        task.last_run_at = Some(now.to_rfc3339());
        task.next_run_at = if task.enabled {
            match compute_next_run(&task.cadence, now) {
                Ok(next) => next.map(|date| date.to_rfc3339()),
                Err(error) => {
                    stored_outcome = ScheduleOutcome::ScheduleError;
                    log_manager::append_line(
                        app,
                        format!("scheduler next_run failed task={} err={error:#}", task.id),
                    );
                    Some((now + ChronoDuration::hours(1)).to_rfc3339())
                }
            }
        } else {
            None
        };
        task.last_outcome = Some(stored_outcome);
        task.updated_at = now.to_rfc3339();
        save_state(app, &state)?;
    }
    Ok(())
}

fn load_state(app: &AppHandle) -> anyhow::Result<ScheduleStore> {
    let path = schedule_file(app)?;
    if !path.exists() {
        return Ok(ScheduleStore::default());
    }
    let raw =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("failed to parse {}", path.display()))
}

fn save_state(app: &AppHandle, state: &ScheduleStore) -> anyhow::Result<()> {
    let path = schedule_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    fs::write(&path, serde_json::to_string_pretty(state)?)
        .with_context(|| format!("failed to write {}", path.display()))
}

fn load_runs(app: &AppHandle) -> anyhow::Result<Vec<RunRecord>> {
    let path = runs_index_file(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw =
        fs::read_to_string(&path).with_context(|| format!("failed to read {}", path.display()))?;
    serde_json::from_str(&raw).with_context(|| format!("failed to parse {}", path.display()))
}

fn append_run(app: &AppHandle, record: &RunRecord) -> anyhow::Result<()> {
    let mut runs = load_runs(app)?;
    runs.push(record.clone());
    runs.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    if runs.len() > 500 {
        runs.truncate(500);
    }
    let path = runs_index_file(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    fs::write(&path, serde_json::to_string_pretty(&runs)?)
        .with_context(|| format!("failed to write {}", path.display()))
}

fn write_raw_events(
    app: &AppHandle,
    events: &[serde_json::Value],
) -> anyhow::Result<Option<String>> {
    if events.is_empty() {
        return Ok(None);
    }
    let path = runs_dir(app)?.join(format!("{}.events.json", run_id("acp")));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    fs::write(&path, serde_json::to_string_pretty(events)?)
        .with_context(|| format!("failed to write {}", path.display()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

fn schedule_file(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .context("failed to resolve app data dir")?
        .join("scheduler")
        .join("schedule.json"))
}

fn runs_index_file(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(runs_dir(app)?.join("index.json"))
}

fn runs_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .context("failed to resolve app data dir")?
        .join("scheduler")
        .join("runs"))
}

fn run_id(prefix: &str) -> String {
    format!("{prefix}_{}", Utc::now().timestamp_millis())
}

fn compute_next_run(
    cadence: &ScheduleCadence,
    after: DateTime<Utc>,
) -> anyhow::Result<Option<DateTime<Utc>>> {
    match cadence {
        ScheduleCadence::Daily { at } => next_daily(parse_hhmm(at)?, after).map(Some),
        ScheduleCadence::Weekday { at } => next_weekday(parse_hhmm(at)?, after).map(Some),
        ScheduleCadence::Cron { expression } => {
            let schedule = Schedule::from_str(expression)
                .with_context(|| format!("invalid cron expression: {expression}"))?;
            Ok(schedule
                .upcoming(Local)
                .next()
                .map(|date| date.with_timezone(&Utc)))
        }
    }
}

fn parse_hhmm(value: &str) -> anyhow::Result<NaiveTime> {
    NaiveTime::parse_from_str(value.trim(), "%H:%M")
        .with_context(|| format!("invalid time, expected HH:MM: {value}"))
}

fn next_daily(at: NaiveTime, after: DateTime<Utc>) -> anyhow::Result<DateTime<Utc>> {
    let local_after = after.with_timezone(&Local);
    let mut date = local_after.date_naive();
    let mut candidate = local_datetime(date, at)?;
    if candidate <= local_after {
        date += ChronoDuration::days(1);
        candidate = local_datetime(date, at)?;
    }
    Ok(candidate.with_timezone(&Utc))
}

fn next_weekday(at: NaiveTime, after: DateTime<Utc>) -> anyhow::Result<DateTime<Utc>> {
    let local_after = after.with_timezone(&Local);
    let start = local_after.date_naive();
    for offset in 0..8 {
        let date = start + ChronoDuration::days(offset);
        let weekday = date.weekday();
        if weekday.num_days_from_monday() >= 5 {
            continue;
        }
        let candidate = local_datetime(date, at)?;
        if candidate > local_after {
            return Ok(candidate.with_timezone(&Utc));
        }
    }
    bail!("failed to compute next weekday run")
}

fn local_datetime(date: NaiveDate, time: NaiveTime) -> anyhow::Result<DateTime<Local>> {
    let mut naive = NaiveDateTime::new(date, time);
    for _ in 0..3 {
        match Local.from_local_datetime(&naive) {
            LocalResult::Single(value) => return Ok(value),
            LocalResult::Ambiguous(earliest, _) => return Ok(earliest),
            LocalResult::None => naive += ChronoDuration::hours(1),
        }
    }
    bail!("invalid local schedule time: {naive}")
}

#[tauri::command]
pub fn schedule_list(app: AppHandle) -> Result<ScheduleStore, String> {
    load_state(&app).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn schedule_set_heartbeat(
    app: AppHandle,
    input: HeartbeatInput,
) -> Result<HeartbeatConfig, String> {
    workspaces::find(&app, &input.workspace_id).map_err(|error| format!("{error:#}"))?;
    let mut state = load_state(&app).map_err(|error| format!("{error:#}"))?;
    let now = Utc::now();
    let interval = input.interval_minutes.unwrap_or(30).clamp(5, 24 * 60);
    let next_run_at = if input.enabled {
        Some((now + ChronoDuration::minutes(interval as i64)).to_rfc3339())
    } else {
        None
    };
    let heartbeat = if let Some(existing) = state
        .heartbeats
        .iter_mut()
        .find(|heartbeat| heartbeat.workspace_id == input.workspace_id)
    {
        existing.enabled = input.enabled;
        existing.interval_minutes = interval;
        existing.next_run_at = next_run_at;
        existing.updated_at = now.to_rfc3339();
        existing.clone()
    } else {
        let heartbeat = HeartbeatConfig {
            id: format!("heartbeat_{}", now.timestamp_millis()),
            workspace_id: input.workspace_id,
            enabled: input.enabled,
            interval_minutes: interval,
            last_run_at: None,
            next_run_at,
            last_outcome: None,
            updated_at: now.to_rfc3339(),
        };
        state.heartbeats.push(heartbeat.clone());
        heartbeat
    };
    save_state(&app, &state).map_err(|error| format!("{error:#}"))?;
    Ok(heartbeat)
}

#[tauri::command]
pub fn schedule_create_task(
    app: AppHandle,
    input: ScheduledTaskInput,
) -> Result<ScheduledTask, String> {
    workspaces::find(&app, &input.workspace_id).map_err(|error| format!("{error:#}"))?;
    if input.name.trim().is_empty() {
        return Err("task name is required".to_string());
    }
    if input.prompt.trim().is_empty() {
        return Err("task prompt is required".to_string());
    }
    let mut state = load_state(&app).map_err(|error| format!("{error:#}"))?;
    let now = Utc::now();
    let enabled = input.enabled.unwrap_or(true);
    let next_run_at = if enabled {
        Some(
            compute_next_run(&input.cadence, now)
                .map_err(|error| format!("{error:#}"))?
                .ok_or_else(|| "schedule has no next run".to_string())?
                .to_rfc3339(),
        )
    } else {
        None
    };
    let task = ScheduledTask {
        id: random_task_id(),
        workspace_id: input.workspace_id,
        name: input.name.trim().to_string(),
        prompt: input.prompt.trim().to_string(),
        cadence: input.cadence,
        enabled,
        execution_permission: input.execution_permission,
        max_run_minutes: input
            .max_run_minutes
            .unwrap_or(default_max_run_minutes())
            .clamp(1, 240),
        last_run_at: None,
        next_run_at,
        last_outcome: None,
        created_at: now.to_rfc3339(),
        updated_at: now.to_rfc3339(),
    };
    state.tasks.push(task.clone());
    save_state(&app, &state).map_err(|error| format!("{error:#}"))?;
    Ok(task)
}

fn random_task_id() -> String {
    let mut bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "task_{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0],
        bytes[1],
        bytes[2],
        bytes[3],
        bytes[4],
        bytes[5],
        bytes[6],
        bytes[7],
        bytes[8],
        bytes[9],
        bytes[10],
        bytes[11],
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15]
    )
}

#[tauri::command]
pub fn schedule_update_task(
    app: AppHandle,
    id: String,
    patch: ScheduledTaskPatch,
) -> Result<ScheduledTask, String> {
    let mut state = load_state(&app).map_err(|error| format!("{error:#}"))?;
    let task = state
        .tasks
        .iter_mut()
        .find(|task| task.id == id)
        .ok_or_else(|| format!("scheduled task not found: {id}"))?;
    if let Some(name) = patch.name {
        if name.trim().is_empty() {
            return Err("task name is required".to_string());
        }
        task.name = name.trim().to_string();
    }
    if let Some(prompt) = patch.prompt {
        if prompt.trim().is_empty() {
            return Err("task prompt is required".to_string());
        }
        task.prompt = prompt.trim().to_string();
    }
    if let Some(cadence) = patch.cadence {
        task.cadence = cadence;
    }
    if let Some(permission) = patch.execution_permission {
        task.execution_permission = permission;
    }
    if let Some(max_run_minutes) = patch.max_run_minutes {
        task.max_run_minutes = max_run_minutes.clamp(1, 240);
    }
    if let Some(enabled) = patch.enabled {
        task.enabled = enabled;
    }
    let now = Utc::now();
    task.next_run_at = if task.enabled {
        Some(
            compute_next_run(&task.cadence, now)
                .map_err(|error| format!("{error:#}"))?
                .ok_or_else(|| "schedule has no next run".to_string())?
                .to_rfc3339(),
        )
    } else {
        None
    };
    task.updated_at = now.to_rfc3339();
    let out = task.clone();
    save_state(&app, &state).map_err(|error| format!("{error:#}"))?;
    Ok(out)
}

#[tauri::command]
pub fn schedule_delete_task(app: AppHandle, id: String) -> Result<(), String> {
    let mut state = load_state(&app).map_err(|error| format!("{error:#}"))?;
    state.tasks.retain(|task| task.id != id);
    save_state(&app, &state).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn schedule_run_now(app: AppHandle, kind: String, ref_id: String) -> Result<RunRecord, String> {
    run_now_inner(&app, &kind, &ref_id).map_err(|error| format!("{error:#}"))
}

#[tauri::command]
pub fn schedule_list_runs(
    app: AppHandle,
    workspace_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<RunRecord>, String> {
    let mut runs = load_runs(&app).map_err(|error| format!("{error:#}"))?;
    if let Some(workspace_id) = workspace_id {
        runs.retain(|run| run.workspace_id == workspace_id);
    }
    runs.truncate(limit.unwrap_or(50).min(200));
    Ok(runs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;

    #[test]
    fn parses_hhmm() {
        assert_eq!(parse_hhmm("09:30").unwrap().hour(), 9);
        assert!(parse_hhmm("9:30").is_err());
    }

    #[test]
    fn daily_next_run_moves_to_tomorrow_after_time_passed() {
        let after = DateTime::parse_from_rfc3339("2026-07-01T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let next = compute_next_run(
            &ScheduleCadence::Daily {
                at: "00:01".to_string(),
            },
            after,
        )
        .unwrap()
        .unwrap();
        assert!(next > after);
    }

    #[test]
    fn task_ids_are_uuid_shaped() {
        let first = random_task_id();
        let second = random_task_id();
        assert!(first.starts_with("task_"));
        assert_eq!(
            first.len(),
            "task_00000000-0000-4000-8000-000000000000".len()
        );
        assert_ne!(first, second);
    }
}
