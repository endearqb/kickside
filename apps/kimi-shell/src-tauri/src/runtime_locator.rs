use std::{fs, path::Path};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct KimiRuntimeLocatorSnapshot {
    pub origin: Option<String>,
    pub token_path: Option<String>,
    pub token_redacted: Option<String>,
    pub generation: u64,
    pub ownership: RuntimeOwnership,
    pub health: RuntimeHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeOwnership {
    OwnedByShell,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeHealth {
    Ready,
    Unavailable,
}

pub fn write_ready(
    path: &Path,
    origin: &str,
    token_path: &Path,
    token_redacted: &str,
    generation: u64,
) -> anyhow::Result<()> {
    write_snapshot(
        path,
        &KimiRuntimeLocatorSnapshot {
            origin: Some(origin.to_string()),
            token_path: Some(token_path.to_string_lossy().to_string()),
            token_redacted: Some(token_redacted.to_string()),
            generation,
            ownership: RuntimeOwnership::OwnedByShell,
            health: RuntimeHealth::Ready,
        },
    )
}

pub fn write_unavailable(path: &Path, generation: u64) -> anyhow::Result<()> {
    write_snapshot(
        path,
        &KimiRuntimeLocatorSnapshot {
            origin: None,
            token_path: None,
            token_redacted: None,
            generation,
            ownership: RuntimeOwnership::Unavailable,
            health: RuntimeHealth::Unavailable,
        },
    )
}

fn write_snapshot(path: &Path, snapshot: &KimiRuntimeLocatorSnapshot) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_vec_pretty(snapshot)?;
    fs::write(path, raw)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_snapshot_does_not_contain_plain_token() {
        let snapshot = KimiRuntimeLocatorSnapshot {
            origin: Some("http://127.0.0.1:55000".to_string()),
            token_path: Some("C:/Users/example/.kimi-code/server.token".to_string()),
            token_redacted: Some("abcd***xyz".to_string()),
            generation: 7,
            ownership: RuntimeOwnership::OwnedByShell,
            health: RuntimeHealth::Ready,
        };
        let raw = serde_json::to_string(&snapshot).expect("json");

        assert!(raw.contains("abcd***xyz"));
        assert!(!raw.contains("plain-secret-token"));
    }
}
