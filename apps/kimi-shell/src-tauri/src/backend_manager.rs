use std::{
    collections::HashSet,
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
use toml_edit::{value, Array, DocumentMut, Item, Table, Value};
use url::Url;

use crate::{
    app_state::{unix_time_millis, AppState},
    cli_contract, command_utils, kimi_locator, log_manager, port_manager, runtime_locator,
    settings_store, skill_center, token_resolver,
    types::{
        AppSettings, BackendState, EnvOverrideStatus, KeyValueEntry, KimiCliApiConfigInput,
        KimiCliApiConfigView, KimiCliConfigCenterInput, KimiCliConfigCenterView,
        KimiCodeAccessConfigInput, KimiCodeAccessConfigModelView, KimiCodeAccessConfigProviderView,
        KimiCodeAccessConfigServiceView, KimiCodeAccessConfigServicesView,
        KimiCodeAccessConfigTestInput, KimiCodeAccessConfigTestResult, KimiCodeAccessConfigView,
        KimiCodeAccessEndpointTestResult, KimiCodeAccessServiceApiKeyMode,
        KimiCodeRuntimeLimitsView, LoopControlEntry, McpServerEntry, ModelEntry, ProviderEntry,
        ServiceEntry, TypedFieldEntry, TypedFieldType, WorkspaceWebMode,
    },
    window_manager, workspace_session,
};

#[allow(dead_code)]
mod config;
mod lifecycle;
mod system_open;
#[allow(dead_code)]
mod workspace_injection;
#[allow(dead_code)]
mod workspace_proxy;

#[allow(unused_imports)]
pub(crate) use config::{
    kimi_api_default_selected_in_view, KIMI_CODING_PLAN_MODEL_ID, KIMI_CODING_PLAN_PROVIDER_ID,
};
pub use config::{
    load_kimi_cli_api_config, load_kimi_cli_config_center, load_kimi_code_access_config,
    save_kimi_cli_api_config, save_kimi_cli_config_center, save_kimi_code_access_config,
    set_kimi_cli_api_as_default, set_kimi_login_as_default, test_kimi_code_access_config,
};
pub use lifecycle::{restart_backend, set_session_work_dir, start_backend, stop_backend};
pub use system_open::{open_external_url, open_folder, open_kimi_config_dir, open_logs_folder};

const SHUTDOWN_TIMEOUT_SECS: u64 = 4;
#[allow(dead_code)]
const KIMI_HOST: &str = "127.0.0.1";
#[allow(dead_code)]
const MAX_UPSTREAM_HEADER_BYTES: usize = 64 * 1024;
