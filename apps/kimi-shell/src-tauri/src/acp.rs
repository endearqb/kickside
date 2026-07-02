use std::{
    collections::HashMap,
    io::{self, BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicI64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpExecutionPermission {
    Auto,
    Yolo,
}

impl Default for AcpExecutionPermission {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AcpRunOutcome {
    Executed,
    Failed,
    BlockedByPermission,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpRunResult {
    pub acp_session_id: Option<String>,
    pub outcome: AcpRunOutcome,
    pub plan: Option<String>,
    pub result: Option<String>,
    pub error: Option<String>,
    pub raw_events: Vec<Value>,
}

#[derive(Debug, Clone)]
pub struct AcpRunInput {
    pub task_name: String,
    pub prompt: String,
    pub permission: AcpExecutionPermission,
    pub timeout: Duration,
}

type Pending = Arc<Mutex<HashMap<i64, mpsc::Sender<Value>>>>;

#[derive(Clone, Copy)]
enum PermissionPhase {
    Plan,
    Run(AcpExecutionPermission),
}

struct AcpClient {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    updates: Arc<Mutex<Vec<Value>>>,
    permission_blocked: Arc<AtomicBool>,
    phase: Arc<Mutex<PermissionPhase>>,
    next_id: AtomicI64,
}

impl AcpClient {
    fn spawn(kimi_bin: &Path) -> Result<Self, String> {
        let mut child = Command::new(kimi_bin)
            .arg("acp")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to start `{} acp`: {error}", kimi_bin.display()))?;

        let Some(child_stdin) = child.stdin.take() else {
            return Err("kimi acp did not expose stdin".to_string());
        };
        let Some(child_stdout) = child.stdout.take() else {
            return Err("kimi acp did not expose stdout".to_string());
        };

        let stdin = Arc::new(Mutex::new(child_stdin));
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
        let updates = Arc::new(Mutex::new(Vec::new()));
        let permission_blocked = Arc::new(AtomicBool::new(false));
        let phase = Arc::new(Mutex::new(PermissionPhase::Plan));

        {
            let stdin = Arc::clone(&stdin);
            let pending = Arc::clone(&pending);
            let updates = Arc::clone(&updates);
            let permission_blocked = Arc::clone(&permission_blocked);
            let phase = Arc::clone(&phase);
            thread::spawn(move || {
                for line in BufReader::new(child_stdout).lines().map_while(Result::ok) {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                        continue;
                    };
                    route_message(
                        &stdin,
                        &pending,
                        &updates,
                        &permission_blocked,
                        &phase,
                        message,
                    );
                }
            });
        }

        Ok(Self {
            child,
            stdin,
            pending,
            updates,
            permission_blocked,
            phase,
            next_id: AtomicI64::new(1),
        })
    }

    fn set_phase(&self, next: PermissionPhase) {
        if let Ok(mut phase) = self.phase.lock() {
            *phase = next;
        }
    }

    fn request(&self, method: &str, params: Value, timeout: Duration) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "acp pending lock poisoned".to_string())?
            .insert(id, tx);

        let message = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.write_json(&message)
            .map_err(|error| format!("failed to write ACP request {method}: {error}"))?;

        match rx.recv_timeout(timeout) {
            Ok(response) => {
                if let Some(error) = response.get("error") {
                    Err(format!("ACP request {method} failed: {error}"))
                } else {
                    Ok(response.get("result").cloned().unwrap_or(Value::Null))
                }
            }
            Err(_) => {
                let _ = self.pending.lock().map(|mut pending| pending.remove(&id));
                Err(format!("ACP request {method} timed out"))
            }
        }
    }

    fn write_json(&self, message: &Value) -> io::Result<()> {
        write_json(&self.stdin, message)
    }

    fn drain_updates(&self) -> Vec<Value> {
        self.updates
            .lock()
            .map(|updates| updates.clone())
            .unwrap_or_default()
    }

    fn permission_blocked(&self) -> bool {
        self.permission_blocked.load(Ordering::SeqCst)
    }

    fn shutdown(mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn route_message(
    stdin: &Arc<Mutex<ChildStdin>>,
    pending: &Pending,
    updates: &Arc<Mutex<Vec<Value>>>,
    permission_blocked: &Arc<AtomicBool>,
    phase: &Arc<Mutex<PermissionPhase>>,
    message: Value,
) {
    let has_id = message.get("id").is_some_and(|value| !value.is_null());
    let method = message.get("method").and_then(Value::as_str);

    match (has_id, method) {
        (true, None) => {
            if let Some(id) = message.get("id").and_then(Value::as_i64) {
                if let Ok(mut pending) = pending.lock() {
                    if let Some(tx) = pending.remove(&id) {
                        let _ = tx.send(message);
                    }
                }
            }
        }
        (true, Some("session/request_permission")) => {
            handle_permission_request(stdin, permission_blocked, phase, &message);
        }
        (_, Some("session/update")) => {
            if let Some(params) = message.get("params") {
                if let Ok(mut updates) = updates.lock() {
                    updates.push(params.clone());
                }
            }
        }
        _ => {}
    }
}

fn handle_permission_request(
    stdin: &Arc<Mutex<ChildStdin>>,
    permission_blocked: &Arc<AtomicBool>,
    phase: &Arc<Mutex<PermissionPhase>>,
    message: &Value,
) {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let should_allow = should_allow_permission_request(permission_blocked, phase);

    let outcome = if should_allow {
        json!({ "outcome": { "outcome": "selected", "optionId": pick_allow_option(message) } })
    } else {
        json!({ "outcome": { "outcome": "cancelled" } })
    };
    let response = json!({ "jsonrpc": "2.0", "id": id, "result": outcome });
    let _ = write_json(stdin, &response);
}

fn should_allow_permission_request(
    permission_blocked: &Arc<AtomicBool>,
    phase: &Arc<Mutex<PermissionPhase>>,
) -> bool {
    let current_phase = phase
        .lock()
        .map(|phase| *phase)
        .unwrap_or(PermissionPhase::Plan);
    match current_phase {
        PermissionPhase::Plan => true,
        PermissionPhase::Run(AcpExecutionPermission::Yolo) => true,
        PermissionPhase::Run(AcpExecutionPermission::Auto) => {
            permission_blocked.store(true, Ordering::SeqCst);
            false
        }
    }
}

fn write_json(stdin: &Arc<Mutex<ChildStdin>>, message: &Value) -> io::Result<()> {
    let serialized = serde_json::to_string(message).map_err(io::Error::other)?;
    let mut guard = stdin
        .lock()
        .map_err(|_| io::Error::other("acp stdin lock poisoned"))?;
    guard.write_all(serialized.as_bytes())?;
    guard.write_all(b"\n")?;
    guard.flush()
}

fn pick_allow_option(message: &Value) -> String {
    message
        .pointer("/params/options")
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .find(|option| {
                    option
                        .get("kind")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| kind.contains("allow") || kind.contains("approve"))
                })
                .or_else(|| options.first())
        })
        .and_then(|option| option.get("optionId").and_then(Value::as_str))
        .unwrap_or("allow")
        .to_string()
}

pub fn run_plan_then_run(kimi_bin: &Path, cwd: &Path, input: AcpRunInput) -> AcpRunResult {
    let client = match AcpClient::spawn(kimi_bin) {
        Ok(client) => client,
        Err(error) => return failed(error),
    };

    if let Err(error) = client.request(
        "initialize",
        json!({
            "protocolVersion": 1,
            "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } }
        }),
        Duration::from_secs(20),
    ) {
        client.shutdown();
        return failed(error);
    }

    let session = match client.request(
        "session/new",
        json!({ "cwd": cwd.to_string_lossy(), "mcpServers": [] }),
        Duration::from_secs(20),
    ) {
        Ok(value) => value,
        Err(error) => {
            client.shutdown();
            return failed(error);
        }
    };
    let session_id = session
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string);
    let Some(session_id_value) = session_id.clone() else {
        client.shutdown();
        return failed("ACP session/new did not return sessionId".to_string());
    };

    let _ = client.request(
        "session/set_mode",
        json!({ "sessionId": session_id_value, "modeId": "plan" }),
        Duration::from_secs(20),
    );

    let plan_prompt = format!(
        "你正在为一个定时任务制定执行计划。此阶段只做规划，不修改文件。\n\n任务：{}\n用户目标：\n{}\n\n要求：\n1. 给出最多 6 步执行计划。\n2. 标明哪些步骤会写入或修改文件。\n3. 不执行写入，不运行会改变工作区状态的命令。",
        input.task_name, input.prompt
    );
    if let Err(error) = client.request(
        "session/prompt",
        json!({ "sessionId": session_id_value, "prompt": [{ "type": "text", "text": plan_prompt }] }),
        input.timeout,
    ) {
        let raw_events = client.drain_updates();
        client.shutdown();
        return AcpRunResult {
            acp_session_id: session_id,
            outcome: AcpRunOutcome::Failed,
            plan: extract_plan(&raw_events),
            result: None,
            error: Some(error),
            raw_events,
        };
    }

    let plan_events = client.drain_updates();
    let Some(plan) = extract_plan(&plan_events) else {
        client.shutdown();
        return AcpRunResult {
            acp_session_id: session_id,
            outcome: AcpRunOutcome::Failed,
            plan: None,
            result: None,
            error: Some("plan_missing".to_string()),
            raw_events: plan_events,
        };
    };

    client.set_phase(PermissionPhase::Run(input.permission));
    let mode = match input.permission {
        AcpExecutionPermission::Auto => "auto",
        AcpExecutionPermission::Yolo => "yolo",
    };
    let _ = client.request(
        "session/set_mode",
        json!({ "sessionId": session_id_value, "modeId": mode }),
        Duration::from_secs(20),
    );

    let execute_prompt = format!(
        "按下面的计划执行任务。不要重新发散规划，除非发现计划无法执行。\n\n任务：{}\n原始目标：\n{}\n\n已批准自动执行的计划：\n{}\n\n执行要求：\n1. 按计划执行。\n2. 如果遇到权限限制或高风险操作，停止并说明原因。\n3. 结束时输出：完成了什么、写入了哪些文件、是否有失败项。",
        input.task_name, input.prompt, plan
    );
    let execute_error = client
        .request(
            "session/prompt",
            json!({ "sessionId": session_id_value, "prompt": [{ "type": "text", "text": execute_prompt }] }),
            input.timeout,
        )
        .err();

    let raw_events = client.drain_updates();
    let result = extract_result(&raw_events);
    let permission_blocked = client.permission_blocked();
    client.shutdown();

    let outcome = if permission_blocked {
        AcpRunOutcome::BlockedByPermission
    } else if execute_error.is_some() {
        AcpRunOutcome::Failed
    } else {
        AcpRunOutcome::Executed
    };

    AcpRunResult {
        acp_session_id: session_id,
        outcome,
        plan: Some(plan),
        result,
        error: execute_error,
        raw_events,
    }
}

fn failed(error: String) -> AcpRunResult {
    AcpRunResult {
        acp_session_id: None,
        outcome: AcpRunOutcome::Failed,
        plan: None,
        result: None,
        error: Some(error),
        raw_events: Vec::new(),
    }
}

fn extract_plan(events: &[Value]) -> Option<String> {
    let mut lines = Vec::new();
    for event in events {
        let update = event.get("update").unwrap_or(event);
        if update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .is_some_and(|kind| kind == "plan")
        {
            if let Some(entries) = update.get("entries").and_then(Value::as_array) {
                for (index, entry) in entries.iter().enumerate() {
                    let content = entry
                        .get("content")
                        .and_then(Value::as_str)
                        .or_else(|| entry.as_str())
                        .unwrap_or("");
                    if !content.trim().is_empty() {
                        lines.push(format!("{}. {}", index + 1, content.trim()));
                    }
                }
            }
        }
        collect_plan_review_text(update, &mut lines);
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn collect_plan_review_text(value: &Value, lines: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if text.contains("Plan saved to:") || text.contains("计划") {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    lines.push(trimmed.to_string());
                }
            }
        }
        Value::Array(items) => items
            .iter()
            .for_each(|item| collect_plan_review_text(item, lines)),
        Value::Object(map) => map
            .values()
            .for_each(|item| collect_plan_review_text(item, lines)),
        _ => {}
    }
}

fn extract_result(events: &[Value]) -> Option<String> {
    let mut text = String::new();
    for event in events {
        let update = event.get("update").unwrap_or(event);
        if update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .is_some_and(|kind| kind == "agent_message_chunk")
        {
            if let Some(chunk) = update.pointer("/content/text").and_then(Value::as_str) {
                text.push_str(chunk);
            }
        }
    }
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_plan_entries() {
        let events = vec![json!({ "update": { "sessionUpdate": "plan", "entries": [
            { "content": "read inbox" },
            { "content": "write summary" }
        ] } })];
        let plan = extract_plan(&events).expect("plan");
        assert!(plan.contains("read inbox"));
        assert!(plan.contains("write summary"));
    }

    #[test]
    fn auto_permission_blocks_run_phase() {
        let flag = Arc::new(AtomicBool::new(false));
        let phase = Arc::new(Mutex::new(PermissionPhase::Run(
            AcpExecutionPermission::Auto,
        )));
        assert!(!should_allow_permission_request(&flag, &phase));
        assert!(flag.load(Ordering::SeqCst));
    }
}
