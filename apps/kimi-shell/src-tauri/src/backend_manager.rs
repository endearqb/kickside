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
    cli_contract, command_utils, kimi_locator, log_manager, port_manager, settings_store,
    skill_center,
    types::{
        AppSettings, BackendState, EnvOverrideStatus, InstallCommandCatalog, InstallCommandEntry,
        InstallCommandStep, InstallProbeStatus, KeyValueEntry, KimiCliApiConfigInput,
        KimiCliApiConfigView, KimiCliConfigCenterInput, KimiCliConfigCenterView, LoopControlEntry,
        McpServerEntry, ModelEntry, ProviderEntry, ServiceEntry, TypedFieldEntry, TypedFieldType,
        WorkspaceWebMode,
    },
    window_manager, workspace_session,
};

mod config;
mod install_compat;
mod lifecycle;
mod system_open;
mod workspace_injection;
mod workspace_proxy;

#[allow(unused_imports)]
pub(crate) use config::{
    kimi_api_default_selected_in_view, KIMI_CODING_PLAN_MODEL_ID, KIMI_CODING_PLAN_PROVIDER_ID,
};
pub use config::{
    load_kimi_cli_api_config, load_kimi_cli_config_center, save_kimi_cli_api_config,
    save_kimi_cli_config_center, set_kimi_cli_api_as_default, set_kimi_login_as_default,
};
#[allow(unused_imports)]
pub use install_compat::{
    get_install_command_catalog, get_install_probe_status, install_kimi_cli,
    install_kimi_dependencies, install_nodejs, upgrade_kimi_cli,
};
pub use lifecycle::{restart_backend, set_session_work_dir, start_backend, stop_backend};
pub use system_open::{open_external_url, open_folder, open_kimi_config_dir, open_logs_folder};

const SHUTDOWN_TIMEOUT_SECS: u64 = 4;
const KIMI_HOST: &str = "127.0.0.1";
const MAX_UPSTREAM_HEADER_BYTES: usize = 64 * 1024;
