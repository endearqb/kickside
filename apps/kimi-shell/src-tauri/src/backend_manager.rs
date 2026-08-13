use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use anyhow::Context;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Response, Server, StatusCode};
use toml_edit::{value, Array, DocumentMut, Item, Table};
use url::Url;

use crate::{
    app_state::{unix_time_millis, AppState},
    command_utils, kimi_locator, log_manager, port_manager, runtime_locator, settings_store,
    skill_center, token_resolver,
    types::{
        AppSettings, BackendState, KimiCodeAccessConfigInput, KimiCodeAccessConfigModelView,
        KimiCodeAccessConfigProviderView, KimiCodeAccessConfigServiceView,
        KimiCodeAccessConfigServicesView, KimiCodeAccessConfigTestInput,
        KimiCodeAccessConfigTestResult, KimiCodeAccessConfigView, KimiCodeAccessEndpointTestResult,
        KimiCodeAccessServiceApiKeyMode, KimiCodeAccessTestState, KimiCodeRuntimeLimitsView,
        RuntimeOwnership, WorkspaceWebMode,
    },
    window_manager, workspace_session,
};

#[allow(dead_code)]
mod config;
mod instance_registry;
mod lifecycle;
mod redaction;
mod system_open;
#[allow(dead_code)]
mod workspace_injection;
#[allow(dead_code)]
mod workspace_proxy;

#[cfg(test)]
pub(crate) use config::KIMI_CODING_PLAN_PROVIDER_ID;
pub use config::{
    collect_kimi_code_access_secret_values, load_kimi_code_access_config,
    save_kimi_code_access_config, test_kimi_code_access_config,
};
pub use lifecycle::{restart_backend, set_session_work_dir, start_backend, stop_backend};
pub use system_open::{
    open_external_url, open_folder, open_kimi_config_dir, open_logs_folder, open_system_terminal,
};

pub fn redact_backend_text(input: &str) -> String {
    redaction::redact_backend_text(input)
}

pub fn redact_backend_lines(lines: Vec<String>) -> Vec<String> {
    let redactor = redaction::SecretRedactor::from_system();
    lines
        .into_iter()
        .map(|line| redactor.redact(&line))
        .collect()
}

const SHUTDOWN_TIMEOUT_SECS: u64 = 4;
#[allow(dead_code)]
const KIMI_HOST: &str = "127.0.0.1";
#[allow(dead_code)]
const MAX_UPSTREAM_HEADER_BYTES: usize = 64 * 1024;
