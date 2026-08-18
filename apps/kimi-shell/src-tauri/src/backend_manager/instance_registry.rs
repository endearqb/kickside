use std::{
    fs,
    net::IpAddr,
    path::{Path, PathBuf},
};

#[cfg(windows)]
use std::collections::{HashMap, HashSet};

use serde::Deserialize;

const MAX_INSTANCE_FILE_BYTES: u64 = 64 * 1024;
const MAX_SERVER_ID_BYTES: usize = 256;
const MAX_HOST_VERSION_BYTES: usize = 128;
const OWNED_LAUNCH_CLOCK_TOLERANCE_MS: u64 = 5_000;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub(super) struct ServerInstance {
    pub server_id: String,
    pub pid: u32,
    pub host: String,
    pub port: u16,
    pub started_at: u64,
    pub heartbeat_at: u64,
    #[serde(default)]
    pub host_version: Option<String>,
}

impl ServerInstance {
    pub(super) fn origin(&self) -> Option<String> {
        loopback_origin(&self.host, self.port)
    }

    pub(super) fn owned_probe_origin(&self) -> Option<String> {
        owned_local_probe_origin(&self.host, self.port)
    }
}

#[derive(Debug, Default)]
pub(super) struct RegistryScan {
    pub instances: Vec<ServerInstance>,
    pub warnings: Vec<String>,
}

pub(super) fn read_live_instances(kimi_home: &Path) -> RegistryScan {
    let directory = kimi_home.join("server").join("instances");
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return RegistryScan::default();
        }
        Err(error) => {
            return RegistryScan {
                warnings: vec![format!(
                    "could not read instance registry {}: {error}",
                    directory.display()
                )],
                ..RegistryScan::default()
            };
        }
    };

    let mut scan = RegistryScan::default();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                scan.warnings.push(format!(
                    "could not inspect instance registry entry: {error}"
                ));
                continue;
            }
        };
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        match read_instance_file(&path) {
            Ok(instance) => scan.instances.push(instance),
            Err(error) => scan.warnings.push(format!(
                "ignored invalid instance registry file {}: {error}",
                display_file_name(&path)
            )),
        }
    }
    scan.instances.sort_by(|left, right| {
        left.started_at
            .cmp(&right.started_at)
            .then_with(|| left.server_id.cmp(&right.server_id))
    });
    scan
}

pub(super) fn owned_candidates(
    instances: &[ServerInstance],
    child_pid: u32,
    launch_time_ms: u64,
) -> Vec<ServerInstance> {
    owned_candidates_matching(
        instances,
        child_pid,
        launch_time_ms,
        belongs_to_owned_launcher,
    )
}

#[cfg(not(windows))]
fn belongs_to_owned_launcher(pid: u32, launcher_pid: u32) -> bool {
    if pid == launcher_pid {
        return true;
    }
    let Ok(pid) = i32::try_from(pid) else {
        return false;
    };
    let Ok(launcher_pid) = i32::try_from(launcher_pid) else {
        return false;
    };
    nix::unistd::getpgid(Some(nix::unistd::Pid::from_raw(pid)))
        .map(|group| group.as_raw() == launcher_pid)
        .unwrap_or(false)
}

#[cfg(windows)]
fn belongs_to_owned_launcher(pid: u32, launcher_pid: u32) -> bool {
    owned_process_ids(launcher_pid).contains(&pid)
}

fn owned_candidates_matching(
    instances: &[ServerInstance],
    child_pid: u32,
    launch_time_ms: u64,
    belongs_to_launcher: impl Fn(u32, u32) -> bool,
) -> Vec<ServerInstance> {
    instances
        .iter()
        .filter(|instance| {
            belongs_to_launcher(instance.pid, child_pid)
                && instance
                    .started_at
                    .saturating_add(OWNED_LAUNCH_CLOCK_TOLERANCE_MS)
                    >= launch_time_ms
        })
        .cloned()
        .collect()
}

#[cfg(windows)]
fn owned_process_ids(launcher_pid: u32) -> HashSet<u32> {
    use windows::Win32::{
        Foundation::CloseHandle,
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
    };

    let Ok(snapshot) = (unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }) else {
        return HashSet::from([launcher_pid]);
    };
    let parents = (|| {
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        unsafe { Process32FirstW(snapshot, &mut entry) }.ok()?;
        let mut parents = HashMap::new();
        loop {
            parents.insert(entry.th32ProcessID, entry.th32ParentProcessID);
            if unsafe { Process32NextW(snapshot, &mut entry) }.is_err() {
                break;
            }
        }
        Some(parents)
    })();
    let _ = unsafe { CloseHandle(snapshot) };

    let Some(parents) = parents else {
        return HashSet::from([launcher_pid]);
    };

    let mut owned = HashSet::from([launcher_pid]);
    loop {
        let before = owned.len();
        for (&pid, &parent) in &parents {
            if owned.contains(&parent) {
                owned.insert(pid);
            }
        }
        if owned.len() == before {
            return owned;
        }
    }
}

fn read_instance_file(path: &Path) -> Result<ServerInstance, String> {
    let metadata = fs::metadata(path).map_err(|error| format!("metadata unavailable: {error}"))?;
    if !metadata.is_file() {
        return Err("entry is not a regular file".to_string());
    }
    if metadata.len() > MAX_INSTANCE_FILE_BYTES {
        return Err(format!(
            "record exceeds {MAX_INSTANCE_FILE_BYTES} byte limit"
        ));
    }
    let raw = fs::read(path).map_err(|error| format!("record is unreadable: {error}"))?;
    if raw.len() as u64 > MAX_INSTANCE_FILE_BYTES {
        return Err(format!(
            "record exceeds {MAX_INSTANCE_FILE_BYTES} byte limit"
        ));
    }
    let instance: ServerInstance =
        serde_json::from_slice(&raw).map_err(|error| format!("JSON is invalid: {error}"))?;
    validate_instance(instance)
}

fn validate_instance(instance: ServerInstance) -> Result<ServerInstance, String> {
    let server_id = instance.server_id.trim();
    if server_id.is_empty()
        || server_id.len() > MAX_SERVER_ID_BYTES
        || server_id.chars().any(char::is_control)
    {
        return Err("server_id is empty or too long".to_string());
    }
    if instance.pid == 0 || i32::try_from(instance.pid).is_err() {
        return Err("pid is invalid".to_string());
    }
    if instance.port == 0 {
        return Err("port is invalid".to_string());
    }
    if loopback_origin(&instance.host, instance.port).is_none()
        && owned_local_probe_origin(&instance.host, instance.port).is_none()
    {
        return Err("host is neither loopback nor an owned wildcard bind".to_string());
    }
    if instance.started_at > instance.heartbeat_at.saturating_add(60_000) {
        return Err("heartbeat predates started_at beyond tolerance".to_string());
    }
    if instance.host_version.as_ref().is_some_and(|version| {
        version.len() > MAX_HOST_VERSION_BYTES || version.chars().any(char::is_control)
    }) {
        return Err("host_version is too long".to_string());
    }
    if !pid_alive(instance.pid) {
        return Err("pid is not alive".to_string());
    }
    Ok(instance)
}

fn loopback_origin(host: &str, port: u16) -> Option<String> {
    if port == 0 {
        return None;
    }
    let normalized = host.trim().trim_matches(['[', ']']);
    if normalized.eq_ignore_ascii_case("localhost") {
        return Some(format!("http://127.0.0.1:{port}"));
    }
    let address = normalized.parse::<IpAddr>().ok()?;
    if !address.is_loopback() {
        return None;
    }
    match address {
        IpAddr::V4(address) => Some(format!("http://{address}:{port}")),
        IpAddr::V6(address) => Some(format!("http://[{address}]:{port}")),
    }
}

fn owned_local_probe_origin(host: &str, port: u16) -> Option<String> {
    let normalized = host.trim().trim_matches(['[', ']']).to_ascii_lowercase();
    match normalized.as_str() {
        "0.0.0.0" => Some(format!("http://127.0.0.1:{port}")),
        "::" => Some(format!("http://[::1]:{port}")),
        _ => loopback_origin(host, port),
    }
}

#[cfg(unix)]
pub(super) fn pid_alive(pid: u32) -> bool {
    use nix::{errno::Errno, sys::signal, unistd::Pid};

    match signal::kill(Pid::from_raw(pid as i32), None) {
        Ok(()) | Err(Errno::EPERM) => true,
        Err(Errno::ESRCH) => false,
        Err(_) => true,
    }
}

#[cfg(windows)]
pub(super) fn pid_alive(pid: u32) -> bool {
    use windows::{
        core::HRESULT,
        Win32::{
            Foundation::{CloseHandle, ERROR_ACCESS_DENIED},
            System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        },
    };

    match unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) } {
        Ok(handle) => {
            let _ = unsafe { CloseHandle(handle) };
            true
        }
        Err(error) => error.code() == HRESULT::from_win32(ERROR_ACCESS_DENIED.0),
    }
}

#[cfg(not(any(unix, windows)))]
pub(super) fn pid_alive(_pid: u32) -> bool {
    true
}

fn display_file_name(path: &Path) -> String {
    path.file_name()
        .map(|value| {
            value
                .to_string_lossy()
                .chars()
                .take(256)
                .map(|character| {
                    if character.is_control() {
                        '?'
                    } else {
                        character
                    }
                })
                .collect()
        })
        .unwrap_or_else(|| PathBuf::from("<unknown>").display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "kimi-instance-registry-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(path.join("server").join("instances")).unwrap();
        path
    }

    fn write_instance(home: &Path, name: &str, value: serde_json::Value) {
        fs::write(
            home.join("server")
                .join("instances")
                .join(format!("{name}.json")),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }

    fn fixture(server_id: &str, started_at: u64) -> serde_json::Value {
        serde_json::json!({
            "server_id": server_id,
            "pid": std::process::id(),
            "host": "127.0.0.1",
            "port": 58627,
            "started_at": started_at,
            "heartbeat_at": started_at,
            "host_version": "0.34.0"
        })
    }

    #[test]
    fn registry_filters_invalid_records_and_sorts_oldest_first() {
        let home = temp_home("scan");
        write_instance(&home, "new", fixture("new", 2_000));
        write_instance(&home, "old", fixture("old", 1_000));
        let mut remote = fixture("remote", 500);
        remote["host"] = serde_json::Value::String("192.0.2.1".to_string());
        write_instance(&home, "remote", remote);
        write_instance(&home, "damaged", serde_json::json!({"pid": 1}));

        let scan = read_live_instances(&home);
        assert_eq!(
            scan.instances
                .iter()
                .map(|instance| instance.server_id.as_str())
                .collect::<Vec<_>>(),
            vec!["old", "new"]
        );
        assert_eq!(scan.warnings.len(), 2);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn registry_rejects_oversized_record() {
        let home = temp_home("oversized");
        fs::write(
            home.join("server").join("instances").join("huge.json"),
            vec![b' '; MAX_INSTANCE_FILE_BYTES as usize + 1],
        )
        .unwrap();

        let scan = read_live_instances(&home);
        assert!(scan.instances.is_empty());
        assert_eq!(scan.warnings.len(), 1);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn owned_candidate_accepts_only_the_spawned_child_pid() {
        let child_pid = std::process::id();
        let instances = vec![
            ServerInstance {
                server_id: "new-wrapper".to_string(),
                pid: child_pid.saturating_add(1),
                host: "127.0.0.1".to_string(),
                port: 58628,
                started_at: 10_000,
                heartbeat_at: 10_000,
                host_version: None,
            },
            ServerInstance {
                server_id: "child".to_string(),
                pid: child_pid,
                host: "127.0.0.1".to_string(),
                port: 58627,
                started_at: 10_001,
                heartbeat_at: 10_001,
                host_version: None,
            },
            ServerInstance {
                server_id: "old".to_string(),
                pid: child_pid.saturating_add(2),
                host: "127.0.0.1".to_string(),
                port: 58629,
                started_at: 1,
                heartbeat_at: 1,
                host_version: None,
            },
        ];
        let candidates = owned_candidates(&instances, child_pid, 10_000);
        assert_eq!(
            candidates
                .iter()
                .map(|instance| instance.server_id.as_str())
                .collect::<Vec<_>>(),
            vec!["child"]
        );
    }

    #[test]
    fn owned_candidate_accepts_a_new_launcher_descendant() {
        let child_pid = 100;
        let instances = vec![
            ServerInstance {
                server_id: "descendant".to_string(),
                pid: 102,
                host: "127.0.0.1".to_string(),
                port: 58627,
                started_at: 10_001,
                heartbeat_at: 10_001,
                host_version: None,
            },
            ServerInstance {
                server_id: "unrelated".to_string(),
                pid: 103,
                host: "127.0.0.1".to_string(),
                port: 58628,
                started_at: 10_002,
                heartbeat_at: 10_002,
                host_version: None,
            },
        ];

        let candidates =
            owned_candidates_matching(&instances, child_pid, 10_000, |pid, launcher| {
                launcher == child_pid && pid == 102
            });
        assert_eq!(candidates, vec![instances[0].clone()]);
    }

    #[cfg(windows)]
    #[test]
    fn windows_process_snapshot_tracks_cmd_descendants() {
        use std::{process::Command, thread, time::Duration};

        let mut launcher = Command::new("cmd")
            .args(["/D", "/S", "/C", "ping -n 10 127.0.0.1 > nul"])
            .spawn()
            .expect("cmd launcher should start");
        let launcher_pid = launcher.id();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let owned = loop {
            let owned = owned_process_ids(launcher_pid);
            if owned.iter().any(|pid| *pid != launcher_pid) || std::time::Instant::now() >= deadline
            {
                break owned;
            }
            thread::sleep(Duration::from_millis(25));
        };

        let _ = Command::new("taskkill")
            .args(["/PID", &launcher_pid.to_string(), "/T", "/F"])
            .status();
        let _ = launcher.wait();
        assert!(owned.contains(&launcher_pid));
        assert!(owned.iter().any(|pid| *pid != launcher_pid));
    }

    #[test]
    fn owned_candidate_rejects_stale_record_after_pid_reuse() {
        let child_pid = std::process::id();
        let instances = vec![ServerInstance {
            server_id: "stale-child".to_string(),
            pid: child_pid,
            host: "127.0.0.1".to_string(),
            port: 58627,
            started_at: 1_000,
            heartbeat_at: 1_000,
            host_version: None,
        }];

        assert!(owned_candidates(&instances, child_pid, 10_000).is_empty());
    }

    #[test]
    fn loopback_origin_rejects_wildcard_and_remote_hosts() {
        assert_eq!(
            loopback_origin("localhost", 58627).as_deref(),
            Some("http://127.0.0.1:58627")
        );
        assert_eq!(
            loopback_origin("::1", 58627).as_deref(),
            Some("http://[::1]:58627")
        );
        assert!(loopback_origin("0.0.0.0", 58627).is_none());
        assert!(loopback_origin("192.0.2.1", 58627).is_none());
        assert_eq!(
            owned_local_probe_origin("0.0.0.0", 58627).as_deref(),
            Some("http://127.0.0.1:58627")
        );
        assert_eq!(
            owned_local_probe_origin("::", 58627).as_deref(),
            Some("http://[::1]:58627")
        );
        assert!(owned_local_probe_origin("192.0.2.1", 58627).is_none());
    }
}
