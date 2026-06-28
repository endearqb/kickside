use super::*;

const ENV_VALUE_VISIBLE_EDGE: usize = 2;

struct EnvOverrideDefinition {
    key: &'static str,
    overrides: &'static [&'static str],
    priority: &'static str,
}

const ENV_OVERRIDE_DEFINITIONS: &[EnvOverrideDefinition] = &[
    EnvOverrideDefinition {
        key: "KIMI_PROVIDER",
        overrides: &["provider"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_MODEL",
        overrides: &["model", "default_model"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_SERVICE",
        overrides: &["default_service"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_EDITOR",
        overrides: &["default_editor"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_YOLO_MODE",
        overrides: &["default_yolo_mode", "default_yolo"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_DEFAULT_THINKING_MODE",
        overrides: &["default_thinking_mode", "default_thinking"],
        priority: "Environment overrides config.toml values.",
    },
    EnvOverrideDefinition {
        key: "KIMI_API_KEY",
        overrides: &["providers.<active>.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "MOONSHOT_API_KEY",
        overrides: &["providers.moonshot.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "OPENAI_API_KEY",
        overrides: &["providers.openai.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "OPENAI_BASE_URL",
        overrides: &["providers.openai.base_url"],
        priority: "Environment overrides provider endpoint from config.toml.",
    },
    EnvOverrideDefinition {
        key: "ANTHROPIC_API_KEY",
        overrides: &["providers.anthropic.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "AZURE_OPENAI_API_KEY",
        overrides: &["providers.azure.api_key"],
        priority: "Environment overrides provider credentials from config.toml.",
    },
    EnvOverrideDefinition {
        key: "AZURE_OPENAI_ENDPOINT",
        overrides: &["providers.azure.base_url", "providers.azure.deployment"],
        priority: "Environment overrides provider endpoint from config.toml.",
    },
    EnvOverrideDefinition {
        key: "KIMI_SHARE_DIR",
        overrides: &["CLI data location"],
        priority: "Environment overrides default data directory location.",
    },
    EnvOverrideDefinition {
        key: "KIMI_CLI_DATA_DIR",
        overrides: &["CLI data location"],
        priority: "Environment overrides default data directory location.",
    },
];

pub(crate) const KIMI_CODING_PLAN_PROVIDER_ID: &str = "kimi-app-api-key";
pub(crate) const KIMI_CODING_PLAN_MODEL_ID: &str = "kimi-app/kimi-for-coding";
pub(super) const KIMI_CODING_PLAN_MODEL_NAME: &str = "kimi-for-coding";
pub(super) const LEGACY_KIMI_CODING_PLAN_PROVIDER_ID: &str = "kimi-for-coding";
pub(super) const LEGACY_KIMI_CODING_PLAN_MODEL_ID: &str = "kimi-for-coding";
pub(super) const KIMI_CODING_PLAN_BASE_URL: &str = "https://api.kimi.com/coding/v1";
pub(super) const KIMI_CODING_PLAN_SEARCH_URL: &str = "https://api.kimi.com/coding/v1/search";
pub(super) const KIMI_CODING_PLAN_FETCH_URL: &str = "https://api.kimi.com/coding/v1/fetch";
pub(super) const KIMI_CODING_PLAN_MAX_CONTEXT_SIZE: i64 = 262144;
pub(super) const KIMI_CODING_PLAN_SEARCH_SERVICE_KEY: &str = "moonshot_search";
pub(super) const KIMI_CODING_PLAN_FETCH_SERVICE_KEY: &str = "moonshot_fetch";
const KIMI_CONFIG_BACKUP_KEEP: usize = 5;

pub fn load_kimi_cli_api_config() -> Result<KimiCliApiConfigView, String> {
    let config_path = resolve_kimi_config_path()?;
    let mut has_api_key = false;
    let mut template_configured = false;
    let mut is_default = false;

    if config_path.exists() {
        let raw = fs::read_to_string(&config_path).map_err(|error| {
            format!(
                "failed to read config file {}: {error}",
                config_path.display()
            )
        })?;
        let doc = parse_kimi_config_document(&raw, &config_path)?;
        let root = doc.as_table();
        has_api_key = resolve_existing_kimi_api_key(root).is_some();
        template_configured = kimi_api_template_configured(root);
        is_default = kimi_api_default_selected(root);
    }

    Ok(KimiCliApiConfigView {
        config_path: config_path.to_string_lossy().to_string(),
        provider_id: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
        model: KIMI_CODING_PLAN_MODEL_ID.to_string(),
        base_url: KIMI_CODING_PLAN_BASE_URL.to_string(),
        has_api_key,
        template_configured,
        is_default,
    })
}

pub fn save_kimi_cli_api_config(
    app: &AppHandle,
    input: KimiCliApiConfigInput,
) -> Result<(), String> {
    let input = KimiCodeAccessConfigInput {
        provider_base_url: KIMI_CODING_PLAN_BASE_URL.to_string(),
        provider_api_key: input.api_key,
        clear_provider_api_key: Some(false),
        search_base_url: KIMI_CODING_PLAN_SEARCH_URL.to_string(),
        search_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
        search_api_key: None,
        fetch_base_url: KIMI_CODING_PLAN_FETCH_URL.to_string(),
        fetch_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
        fetch_api_key: None,
        agent_swarm_max_concurrency: None,
        clear_agent_swarm_max_concurrency: Some(false),
    };
    let _ = save_kimi_code_access_config(app, input)?;
    Ok(())
}

pub fn set_kimi_cli_api_as_default(app: &AppHandle) -> Result<(), String> {
    let config_path = resolve_kimi_config_path()?;
    set_kimi_api_default_at_path(&config_path)?;

    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.onboarding_step_acks.api_config_ack = true;
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn set_kimi_login_as_default(_app: &AppHandle) -> Result<(), String> {
    let config_path = resolve_kimi_config_path()?;
    set_kimi_login_default_at_path(&config_path)
}

pub(crate) fn kimi_api_default_selected_in_view(view: &KimiCliConfigCenterView) -> bool {
    view.default_provider.as_deref().map(str::trim) == Some(KIMI_CODING_PLAN_PROVIDER_ID)
        && view.model.as_deref().map(str::trim) == Some(KIMI_CODING_PLAN_MODEL_ID)
        && view.default_model.as_deref().map(str::trim) == Some(KIMI_CODING_PLAN_MODEL_ID)
}

pub fn load_kimi_cli_config_center() -> Result<KimiCliConfigCenterView, String> {
    let config_dir = resolve_kimi_config_dir()?;
    let config_path = resolve_kimi_config_path()?;
    let (data_dir, data_dir_env_source) = resolve_kimi_data_dir()?;

    let mut view = KimiCliConfigCenterView {
        config_path: config_path.to_string_lossy().to_string(),
        config_dir: config_dir.to_string_lossy().to_string(),
        data_dir,
        data_dir_env_source,
        ..Default::default()
    };

    if config_path.exists() {
        let raw = fs::read_to_string(&config_path).map_err(|error| {
            format!(
                "failed to read config file {}: {error}",
                config_path.display()
            )
        })?;
        let doc = parse_kimi_config_document(&raw, &config_path)?;
        let root = doc.as_table();

        view.default_provider = table_string(root, "provider");
        view.model = table_string(root, "model");
        view.default_model = table_string(root, "default_model");
        view.default_service = table_string(root, "default_service");
        view.default_editor = table_string(root, "default_editor");
        view.default_yolo = table_bool(root, "default_yolo");
        view.default_yolo_mode = table_string(root, "default_yolo_mode");
        view.default_thinking = table_bool(root, "default_thinking");
        view.default_thinking_mode = table_string(root, "default_thinking_mode");
        view.local_model_disable_auto_pull = table_bool(root, "local_model_disable_auto_pull");
        view.providers = parse_provider_entries(root);
        view.models = parse_model_entries(root);
        view.services = parse_service_entries(root);
        view.loop_control = parse_loop_control_entry(root);
        view.mcp_servers = parse_mcp_server_entries(root);
    }

    view.env_overrides = collect_env_override_statuses();
    view.warnings = collect_config_center_warnings(&view);
    Ok(view)
}

pub fn save_kimi_cli_config_center(
    app: &AppHandle,
    input: KimiCliConfigCenterInput,
) -> Result<(), String> {
    let _ = (app, input);
    Err("Kimi App 不再支持全量 config.toml 编辑，请使用 Kimi Code 接入配置。".to_string())
}

pub fn load_kimi_code_access_config(app: &AppHandle) -> Result<KimiCodeAccessConfigView, String> {
    let kimi_code_home = resolve_kimi_config_dir()?;
    let config_path = kimi_code_home.join("config.toml");
    let config_exists = config_path.exists();
    let mut provider_base_url = None;
    let mut provider_api_key = None;
    let mut model_exists = false;
    let mut search_base_url = None;
    let mut search_api_key = None;
    let mut fetch_base_url = None;
    let mut fetch_api_key = None;
    let mut warnings = Vec::new();

    if config_exists {
        let raw = fs::read_to_string(&config_path).map_err(|error| {
            format!(
                "failed to read config file {}: {error}",
                config_path.display()
            )
        })?;
        let doc = parse_kimi_config_document(&raw, &config_path)?;
        let root = doc.as_table();
        let provider = provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID);
        provider_base_url = provider.and_then(|table| table_string(table, "base_url"));
        provider_api_key = provider.and_then(|table| table_string(table, "api_key"));

        model_exists = root
            .get("models")
            .and_then(Item::as_table)
            .and_then(|models| models.get(KIMI_CODING_PLAN_MODEL_ID))
            .and_then(Item::as_table)
            .is_some_and(|table| {
                table_string(table, "provider").as_deref() == Some(KIMI_CODING_PLAN_PROVIDER_ID)
                    && table_string(table, "model").as_deref() == Some(KIMI_CODING_PLAN_MODEL_NAME)
                    && table_i64(table, "max_context_size")
                        == Some(KIMI_CODING_PLAN_MAX_CONTEXT_SIZE)
            });

        if provider_table(root, LEGACY_KIMI_CODING_PLAN_PROVIDER_ID).is_some()
            || root
                .get("models")
                .and_then(Item::as_table)
                .and_then(|models| models.get(LEGACY_KIMI_CODING_PLAN_MODEL_ID))
                .and_then(Item::as_table)
                .is_some()
        {
            warnings.push(
                "发现旧版 Kimi App API 配置。建议迁移到新的 kimi-app-api-key provider。"
                    .to_string(),
            );
        }

        search_base_url =
            service_table(root, KIMI_CODING_PLAN_SEARCH_SERVICE_KEY).and_then(service_base_url);
        search_api_key = service_table(root, KIMI_CODING_PLAN_SEARCH_SERVICE_KEY)
            .and_then(|table| table_string(table, "api_key"));
        fetch_base_url =
            service_table(root, KIMI_CODING_PLAN_FETCH_SERVICE_KEY).and_then(service_base_url);
        fetch_api_key = service_table(root, KIMI_CODING_PLAN_FETCH_SERVICE_KEY)
            .and_then(|table| table_string(table, "api_key"));
    }

    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let provider_key_configured = provider_api_key.is_some();
    let search_uses_provider = keys_match(search_api_key.as_deref(), provider_api_key.as_deref());
    let fetch_uses_provider = keys_match(fetch_api_key.as_deref(), provider_api_key.as_deref());

    Ok(KimiCodeAccessConfigView {
        kimi_code_home: kimi_code_home.to_string_lossy().to_string(),
        config_path: config_path.to_string_lossy().to_string(),
        config_exists,
        provider: KimiCodeAccessConfigProviderView {
            id: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
            provider_type: "kimi".to_string(),
            base_url: provider_base_url,
            api_key_configured: provider_key_configured,
            api_key_masked: provider_api_key.as_deref().map(mask_env_value),
        },
        model: KimiCodeAccessConfigModelView {
            id: KIMI_CODING_PLAN_MODEL_ID.to_string(),
            provider: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
            model: KIMI_CODING_PLAN_MODEL_NAME.to_string(),
            max_context_size: KIMI_CODING_PLAN_MAX_CONTEXT_SIZE,
            exists: model_exists,
        },
        services: KimiCodeAccessConfigServicesView {
            search: KimiCodeAccessConfigServiceView {
                key: KIMI_CODING_PLAN_SEARCH_SERVICE_KEY.to_string(),
                base_url: search_base_url,
                api_key_configured: search_api_key.is_some(),
                api_key_masked: search_api_key.as_deref().map(mask_env_value),
                uses_provider_api_key: search_uses_provider,
            },
            fetch: KimiCodeAccessConfigServiceView {
                key: KIMI_CODING_PLAN_FETCH_SERVICE_KEY.to_string(),
                base_url: fetch_base_url,
                api_key_configured: fetch_api_key.is_some(),
                api_key_masked: fetch_api_key.as_deref().map(mask_env_value),
                uses_provider_api_key: fetch_uses_provider,
            },
        },
        runtime_limits: KimiCodeRuntimeLimitsView {
            agent_swarm_max_concurrency: settings.kimi_runtime_launch.agent_swarm_max_concurrency,
        },
        warnings,
    })
}

pub fn save_kimi_code_access_config(
    app: &AppHandle,
    input: KimiCodeAccessConfigInput,
) -> Result<KimiCodeAccessConfigView, String> {
    validate_kimi_code_access_input(&input)?;

    let config_dir = resolve_kimi_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|error| {
        format!(
            "failed to create kimi config directory {}: {error}",
            config_dir.display()
        )
    })?;

    let config_path = config_dir.join("config.toml");
    let mut doc = read_or_init_kimi_config(&config_path)?;
    apply_kimi_code_access_input(&mut doc, &input)?;
    write_kimi_config_atomically_with_backup(&config_path, &doc)?;

    let mut settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    settings.onboarding_step_acks.api_config_ack = true;
    if input.clear_agent_swarm_max_concurrency.unwrap_or(false) {
        settings.kimi_runtime_launch.agent_swarm_max_concurrency = None;
    } else if let Some(value) = input.agent_swarm_max_concurrency {
        settings.kimi_runtime_launch.agent_swarm_max_concurrency = Some(value);
    }
    settings_store::save(app, &settings).map_err(|error| error.to_string())?;
    load_kimi_code_access_config(app)
}

pub async fn test_kimi_code_access_config(
    input: KimiCodeAccessConfigTestInput,
) -> Result<KimiCodeAccessConfigTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))?;
    let secrets = [
        input.provider_api_key.as_deref(),
        input.search_api_key.as_deref(),
        input.fetch_api_key.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
    .collect::<Vec<_>>();
    let api_key_configured = !secrets.is_empty();

    Ok(KimiCodeAccessConfigTestResult {
        provider: probe_access_endpoint(
            &client,
            &input.provider_base_url,
            input.provider_api_key.as_deref(),
            &secrets,
        )
        .await,
        search: probe_access_endpoint(
            &client,
            &input.search_base_url,
            input.search_api_key.as_deref(),
            &secrets,
        )
        .await,
        fetch: probe_access_endpoint(
            &client,
            &input.fetch_base_url,
            input.fetch_api_key.as_deref(),
            &secrets,
        )
        .await,
        api_key_configured,
        warnings: if api_key_configured {
            Vec::new()
        } else {
            vec!["未提供 API Key，连接测试只检查 URL 可达性。".to_string()]
        },
    })
}

fn validate_kimi_code_access_input(input: &KimiCodeAccessConfigInput) -> Result<(), String> {
    validate_http_url_value("providerBaseUrl", &input.provider_base_url)?;
    validate_http_url_value("searchBaseUrl", &input.search_base_url)?;
    validate_http_url_value("fetchBaseUrl", &input.fetch_base_url)?;

    for (label, mode, key) in [
        (
            "searchApiKey",
            input
                .search_api_key_mode
                .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
            input.search_api_key.as_deref(),
        ),
        (
            "fetchApiKey",
            input
                .fetch_api_key_mode
                .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
            input.fetch_api_key.as_deref(),
        ),
    ] {
        if mode == KimiCodeAccessServiceApiKeyMode::Custom
            && key
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .is_none()
        {
            return Err(format!("{label} is required when api key mode is custom"));
        }
    }

    if input.agent_swarm_max_concurrency == Some(0) {
        return Err("agentSwarmMaxConcurrency must be a positive integer".to_string());
    }

    Ok(())
}

fn validate_http_url_value(label: &str, raw: &str) -> Result<(), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    let parsed =
        Url::parse(trimmed).map_err(|error| format!("{label} must be a valid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!("{label} must use http or https, got {scheme}")),
    }
}

fn apply_kimi_code_access_input(
    doc: &mut DocumentMut,
    input: &KimiCodeAccessConfigInput,
) -> Result<(), String> {
    let existing_provider_api_key = provider_table(doc.as_table(), KIMI_CODING_PLAN_PROVIDER_ID)
        .and_then(|table| table_string(table, "api_key"));
    let requested_provider_api_key = normalize_optional_string(&input.provider_api_key);
    let next_provider_api_key = if input.clear_provider_api_key.unwrap_or(false) {
        None
    } else {
        requested_provider_api_key.or(existing_provider_api_key)
    };

    patch_kimi_access_provider(
        doc,
        input.provider_base_url.trim(),
        next_provider_api_key.as_deref(),
    )?;
    patch_kimi_access_model(doc)?;
    patch_kimi_access_service(
        doc,
        KIMI_CODING_PLAN_SEARCH_SERVICE_KEY,
        input.search_base_url.trim(),
        input
            .search_api_key_mode
            .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
        input.search_api_key.as_deref(),
        next_provider_api_key.as_deref(),
    )?;
    patch_kimi_access_service(
        doc,
        KIMI_CODING_PLAN_FETCH_SERVICE_KEY,
        input.fetch_base_url.trim(),
        input
            .fetch_api_key_mode
            .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
        input.fetch_api_key.as_deref(),
        next_provider_api_key.as_deref(),
    )?;
    Ok(())
}

fn patch_kimi_access_provider(
    doc: &mut DocumentMut,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<(), String> {
    let providers = ensure_root_table_mut(doc, "providers")?;
    if providers
        .get(KIMI_CODING_PLAN_PROVIDER_ID)
        .and_then(Item::as_table)
        .is_none()
    {
        providers.insert(KIMI_CODING_PLAN_PROVIDER_ID, Item::Table(Table::new()));
    }
    let provider = providers
        .get_mut(KIMI_CODING_PLAN_PROVIDER_ID)
        .and_then(Item::as_table_mut)
        .ok_or_else(|| "providers.kimi-app-api-key must be a table".to_string())?;

    provider["type"] = value("kimi");
    provider["base_url"] = value(base_url);
    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        provider["api_key"] = value(api_key);
    } else {
        let _ = provider.remove("api_key");
    }
    Ok(())
}

fn patch_kimi_access_model(doc: &mut DocumentMut) -> Result<(), String> {
    let models = ensure_root_table_mut(doc, "models")?;
    if models
        .get(KIMI_CODING_PLAN_MODEL_ID)
        .and_then(Item::as_table)
        .is_none()
    {
        models.insert(KIMI_CODING_PLAN_MODEL_ID, Item::Table(Table::new()));
    }
    let model = models
        .get_mut(KIMI_CODING_PLAN_MODEL_ID)
        .and_then(Item::as_table_mut)
        .ok_or_else(|| "models.kimi-app/kimi-for-coding must be a table".to_string())?;

    model["provider"] = value(KIMI_CODING_PLAN_PROVIDER_ID);
    model["model"] = value(KIMI_CODING_PLAN_MODEL_NAME);
    model["max_context_size"] = value(KIMI_CODING_PLAN_MAX_CONTEXT_SIZE);
    Ok(())
}

fn patch_kimi_access_service(
    doc: &mut DocumentMut,
    service_key: &str,
    base_url: &str,
    mode: KimiCodeAccessServiceApiKeyMode,
    requested_api_key: Option<&str>,
    provider_api_key: Option<&str>,
) -> Result<(), String> {
    let services = ensure_root_table_mut(doc, "services")?;
    if services.get(service_key).and_then(Item::as_table).is_none() {
        services.insert(service_key, Item::Table(Table::new()));
    }
    let service = services
        .get_mut(service_key)
        .and_then(Item::as_table_mut)
        .ok_or_else(|| format!("services.{service_key} must be a table"))?;

    service["base_url"] = value(base_url);
    match mode {
        KimiCodeAccessServiceApiKeyMode::ReuseProvider => {
            if let Some(api_key) = provider_api_key
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                service["api_key"] = value(api_key);
            } else {
                let _ = service.remove("api_key");
            }
        }
        KimiCodeAccessServiceApiKeyMode::Custom => {
            if let Some(api_key) = requested_api_key
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                service["api_key"] = value(api_key);
            }
        }
        KimiCodeAccessServiceApiKeyMode::KeepExisting => {}
        KimiCodeAccessServiceApiKeyMode::Clear => {
            let _ = service.remove("api_key");
        }
    }
    Ok(())
}

fn write_kimi_config_atomically_with_backup(
    config_path: &Path,
    doc: &DocumentMut,
) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create kimi config directory {}: {error}",
                parent.display()
            )
        })?;
    }
    if config_path.exists() {
        backup_kimi_config(config_path)?;
    }

    let parent = config_path
        .parent()
        .ok_or_else(|| format!("config path has no parent: {}", config_path.display()))?;
    let file_name = config_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "config path has invalid file name: {}",
                config_path.display()
            )
        })?;
    let temp_path = parent.join(format!(
        ".{file_name}.kimi-app-tmp-{}-{}-{}",
        std::process::id(),
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        unix_time_millis()
    ));
    let raw = doc.to_string();

    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "failed to create temp config file {}: {error}",
                    temp_path.display()
                )
            })?;
        file.write_all(raw.as_bytes()).map_err(|error| {
            format!(
                "failed to write temp config file {}: {error}",
                temp_path.display()
            )
        })?;
        file.sync_all().map_err(|error| {
            format!(
                "failed to fsync temp config file {}: {error}",
                temp_path.display()
            )
        })?;
        drop(file);
        fs::rename(&temp_path, config_path).map_err(|error| {
            format!(
                "failed to replace config file {} from {}: {error}",
                config_path.display(),
                temp_path.display()
            )
        })?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn backup_kimi_config(config_path: &Path) -> Result<(), String> {
    let parent = config_path
        .parent()
        .ok_or_else(|| format!("config path has no parent: {}", config_path.display()))?;
    let file_name = config_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "config path has invalid file name: {}",
                config_path.display()
            )
        })?;
    let backup_stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut backup_path = parent.join(format!("{file_name}.kimi-app-backup-{backup_stamp}"));
    for index in 1..100 {
        if !backup_path.exists() {
            break;
        }
        backup_path = parent.join(format!(
            "{file_name}.kimi-app-backup-{backup_stamp}-{index}"
        ));
    }
    fs::copy(config_path, &backup_path).map_err(|error| {
        format!(
            "failed to create config backup {}: {error}",
            backup_path.display()
        )
    })?;
    prune_kimi_config_backups(parent, file_name)
}

fn prune_kimi_config_backups(parent: &Path, file_name: &str) -> Result<(), String> {
    let prefix = format!("{file_name}.kimi-app-backup-");
    let mut backups = fs::read_dir(parent)
        .map_err(|error| {
            format!(
                "failed to list config backups {}: {error}",
                parent.display()
            )
        })?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.starts_with(&prefix))
        })
        .collect::<Vec<_>>();
    backups.sort_by(|left, right| {
        right
            .file_name()
            .and_then(|value| value.to_str())
            .cmp(&left.file_name().and_then(|value| value.to_str()))
    });
    for path in backups.into_iter().skip(KIMI_CONFIG_BACKUP_KEEP) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

async fn probe_access_endpoint(
    client: &reqwest::Client,
    raw_url: &str,
    api_key: Option<&str>,
    secrets: &[String],
) -> KimiCodeAccessEndpointTestResult {
    let trimmed = raw_url.trim();
    let parsed = match Url::parse(trimmed) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => url,
        Ok(url) => {
            return KimiCodeAccessEndpointTestResult {
                url: trimmed.to_string(),
                reachable: false,
                status_code: None,
                error: Some(format!("unsupported URL scheme: {}", url.scheme())),
            }
        }
        Err(error) => {
            return KimiCodeAccessEndpointTestResult {
                url: trimmed.to_string(),
                reachable: false,
                status_code: None,
                error: Some(format!("invalid URL: {error}")),
            }
        }
    };

    let mut request = client.get(parsed.as_str());
    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        request = request.bearer_auth(api_key);
    }

    match request.send().await {
        Ok(response) => KimiCodeAccessEndpointTestResult {
            url: parsed.to_string(),
            reachable: true,
            status_code: Some(response.status().as_u16()),
            error: None,
        },
        Err(error) => KimiCodeAccessEndpointTestResult {
            url: parsed.to_string(),
            reachable: false,
            status_code: None,
            error: Some(redact_secrets(&error.to_string(), secrets)),
        },
    }
}

fn redact_secrets(message: &str, secrets: &[String]) -> String {
    let mut output = message.to_string();
    for secret in secrets {
        if !secret.is_empty() {
            output = output.replace(secret, &mask_env_value(secret));
        }
    }
    output
}

fn keys_match(left: Option<&str>, right: Option<&str>) -> bool {
    let left = left.map(str::trim).filter(|value| !value.is_empty());
    let right = right.map(str::trim).filter(|value| !value.is_empty());
    matches!((left, right), (Some(left), Some(right)) if left == right)
}

pub(super) fn save_kimi_api_template_to_path(
    config_path: &Path,
    requested_api_key: Option<String>,
) -> Result<(), String> {
    let mut doc = read_or_init_kimi_config(config_path)?;
    let api_key = {
        let root = doc.as_table();
        resolve_requested_kimi_api_key(root, requested_api_key)?
    };
    apply_kimi_api_template(&mut doc, &api_key)?;
    write_kimi_config_atomically_with_backup(config_path, &doc)
}

pub(super) fn set_kimi_api_default_at_path(config_path: &Path) -> Result<(), String> {
    let mut doc = read_or_init_kimi_config(config_path)?;
    if !kimi_api_template_configured(doc.as_table()) {
        return Err("请先保存 Kimi Coding Plan 配置，再设为默认。".to_string());
    }

    doc["provider"] = value(KIMI_CODING_PLAN_PROVIDER_ID);
    doc["model"] = value(KIMI_CODING_PLAN_MODEL_ID);
    doc["default_model"] = value(KIMI_CODING_PLAN_MODEL_ID);

    write_kimi_config_atomically_with_backup(config_path, &doc)
}

pub(super) fn set_kimi_login_default_at_path(config_path: &Path) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }

    let mut doc = read_or_init_kimi_config(config_path)?;
    let mut changed = false;
    for (key, expected_value) in [
        ("provider", KIMI_CODING_PLAN_PROVIDER_ID),
        ("model", KIMI_CODING_PLAN_MODEL_ID),
        ("default_model", KIMI_CODING_PLAN_MODEL_ID),
    ] {
        if table_string(doc.as_table(), key).as_deref() == Some(expected_value) {
            let _ = doc.as_table_mut().remove(key);
            changed = true;
        }
    }

    if changed {
        return write_kimi_config_atomically_with_backup(config_path, &doc);
    }
    Ok(())
}

pub(super) fn resolve_requested_kimi_api_key(
    root: &Table,
    requested_api_key: Option<String>,
) -> Result<String, String> {
    if let Some(api_key) = requested_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(api_key.to_string());
    }

    resolve_existing_kimi_api_key(root).ok_or_else(|| {
        "请先填写 API 密钥，或在已有 Kimi Coding Plan 配置基础上继续保存。".to_string()
    })
}

pub(super) fn resolve_existing_kimi_api_key(root: &Table) -> Option<String> {
    provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID)
        .and_then(|table| table_string(table, "api_key"))
        .or_else(|| {
            service_table(root, KIMI_CODING_PLAN_SEARCH_SERVICE_KEY)
                .and_then(|table| table_string(table, "api_key"))
        })
        .or_else(|| {
            service_table(root, KIMI_CODING_PLAN_FETCH_SERVICE_KEY)
                .and_then(|table| table_string(table, "api_key"))
        })
}

pub(super) fn kimi_api_template_configured(root: &Table) -> bool {
    let provider_ready = provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID).is_some_and(|table| {
        table_string(table, "type").as_deref() == Some("kimi")
            && table_string(table, "base_url").as_deref() == Some(KIMI_CODING_PLAN_BASE_URL)
            && table_string(table, "api_key").is_some()
    });
    let model_ready = root
        .get("models")
        .and_then(Item::as_table)
        .and_then(|models| models.get(KIMI_CODING_PLAN_MODEL_ID))
        .and_then(Item::as_table)
        .is_some_and(|table| {
            table_string(table, "provider").as_deref() == Some(KIMI_CODING_PLAN_PROVIDER_ID)
                && table_string(table, "model").as_deref() == Some(KIMI_CODING_PLAN_MODEL_NAME)
                && table_i64(table, "max_context_size") == Some(KIMI_CODING_PLAN_MAX_CONTEXT_SIZE)
        });
    let search_ready =
        service_table(root, KIMI_CODING_PLAN_SEARCH_SERVICE_KEY).is_some_and(|table| {
            service_base_url(table).as_deref() == Some(KIMI_CODING_PLAN_SEARCH_URL)
                && table_string(table, "api_key").is_some()
        });
    let fetch_ready =
        service_table(root, KIMI_CODING_PLAN_FETCH_SERVICE_KEY).is_some_and(|table| {
            service_base_url(table).as_deref() == Some(KIMI_CODING_PLAN_FETCH_URL)
                && table_string(table, "api_key").is_some()
        });

    provider_ready && model_ready && search_ready && fetch_ready
}

pub(super) fn kimi_api_default_selected(root: &Table) -> bool {
    table_string(root, "provider").as_deref() == Some(KIMI_CODING_PLAN_PROVIDER_ID)
        && table_string(root, "model").as_deref() == Some(KIMI_CODING_PLAN_MODEL_ID)
        && table_string(root, "default_model").as_deref() == Some(KIMI_CODING_PLAN_MODEL_ID)
}

pub(super) fn apply_kimi_api_template(doc: &mut DocumentMut, api_key: &str) -> Result<(), String> {
    let providers = ensure_root_table_mut(doc, "providers")?;
    providers.insert(
        KIMI_CODING_PLAN_PROVIDER_ID,
        Item::Table(build_kimi_provider_table(api_key)),
    );

    let models = ensure_root_table_mut(doc, "models")?;
    models.insert(
        KIMI_CODING_PLAN_MODEL_ID,
        Item::Table(build_kimi_model_table()),
    );

    let services = ensure_root_table_mut(doc, "services")?;
    services.insert(
        KIMI_CODING_PLAN_SEARCH_SERVICE_KEY,
        Item::Table(build_kimi_service_table(
            KIMI_CODING_PLAN_SEARCH_URL,
            api_key,
        )),
    );
    services.insert(
        KIMI_CODING_PLAN_FETCH_SERVICE_KEY,
        Item::Table(build_kimi_service_table(
            KIMI_CODING_PLAN_FETCH_URL,
            api_key,
        )),
    );

    Ok(())
}

pub(super) fn build_kimi_provider_table(api_key: &str) -> Table {
    let mut table = Table::new();
    table["type"] = value("kimi");
    table["base_url"] = value(KIMI_CODING_PLAN_BASE_URL);
    table["api_key"] = value(api_key);
    table
}

pub(super) fn build_kimi_model_table() -> Table {
    let mut table = Table::new();
    table["provider"] = value(KIMI_CODING_PLAN_PROVIDER_ID);
    table["model"] = value(KIMI_CODING_PLAN_MODEL_NAME);
    table["max_context_size"] = value(KIMI_CODING_PLAN_MAX_CONTEXT_SIZE);
    table
}

pub(super) fn build_kimi_service_table(base_url: &str, api_key: &str) -> Table {
    let mut table = Table::new();
    table["base_url"] = value(base_url);
    table["api_key"] = value(api_key);
    table
}

pub(super) fn ensure_root_table_mut<'a>(
    doc: &'a mut DocumentMut,
    key: &str,
) -> Result<&'a mut Table, String> {
    if !doc[key].is_table() {
        doc[key] = Item::Table(Table::new());
    }
    doc[key]
        .as_table_mut()
        .ok_or_else(|| format!("{key} must be a table"))
}

pub(super) fn service_table<'a>(root: &'a Table, key: &str) -> Option<&'a Table> {
    root.get("services")
        .and_then(Item::as_table)
        .and_then(|services| services.get(key))
        .and_then(Item::as_table)
}

pub(super) fn service_base_url(table: &Table) -> Option<String> {
    table_string(table, "base_url").or_else(|| table_string(table, "endpoint"))
}

pub(super) fn collect_config_center_warnings(view: &KimiCliConfigCenterView) -> Vec<String> {
    let mut warnings = Vec::new();

    if let Some(default_model) = normalize_optional_string(&view.default_model) {
        let model_exists = view
            .models
            .iter()
            .any(|entry| entry.key.trim() == default_model);
        if !model_exists {
            warnings.push(format!(
                "default_model `{default_model}` not found in models table (allowed but may be overridden)."
            ));
        }
    }

    let active_provider = normalize_optional_string(&view.default_provider).or_else(|| {
        view.providers
            .first()
            .map(|entry| entry.key.trim().to_string())
            .filter(|value| !value.is_empty())
    });

    if let Some(provider_key) = active_provider {
        let provider_entry = view
            .providers
            .iter()
            .find(|entry| entry.key.trim() == provider_key);
        if let Some(provider) = provider_entry {
            let has_key_in_config = normalize_optional_string(&provider.api_key).is_some();
            let has_key_in_env = [
                "KIMI_API_KEY",
                "MOONSHOT_API_KEY",
                "OPENAI_API_KEY",
                "ANTHROPIC_API_KEY",
                "AZURE_OPENAI_API_KEY",
            ]
            .iter()
            .any(|key| env_var_trimmed(key).is_some());

            if !has_key_in_config && !has_key_in_env {
                warnings.push(format!(
                    "provider `{provider_key}` has no API key in config or env overrides."
                ));
            }
        }
    }

    warnings
}

pub(super) fn collect_env_override_statuses() -> Vec<EnvOverrideStatus> {
    ENV_OVERRIDE_DEFINITIONS
        .iter()
        .map(|definition| {
            let value = env_var_trimmed(definition.key);
            EnvOverrideStatus {
                key: definition.key.to_string(),
                is_set: value.is_some(),
                masked_value: value.as_deref().map(mask_env_value),
                overrides: definition
                    .overrides
                    .iter()
                    .map(|item| item.to_string())
                    .collect(),
                priority: definition.priority.to_string(),
            }
        })
        .collect()
}

pub(super) fn mask_env_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "***".to_string();
    }

    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= ENV_VALUE_VISIBLE_EDGE * 2 {
        return "*".repeat(chars.len());
    }

    let prefix: String = chars[..ENV_VALUE_VISIBLE_EDGE].iter().collect();
    let suffix: String = chars[chars.len() - ENV_VALUE_VISIBLE_EDGE..]
        .iter()
        .collect();
    format!("{prefix}***{suffix}")
}

pub(super) fn resolve_kimi_data_dir() -> Result<(String, Option<String>), String> {
    if let Some(path) = env_var_trimmed("KIMI_SHARE_DIR") {
        return Ok((path, Some("KIMI_SHARE_DIR".to_string())));
    }
    if let Some(path) = env_var_trimmed("KIMI_CLI_DATA_DIR") {
        return Ok((path, Some("KIMI_CLI_DATA_DIR".to_string())));
    }

    let fallback = resolve_kimi_config_dir()?;
    Ok((fallback.to_string_lossy().to_string(), None))
}

pub(super) fn env_var_trimmed(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn parse_provider_entries(root: &Table) -> Vec<ProviderEntry> {
    let mut entries = Vec::new();
    let Some(providers) = root.get("providers").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in providers.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        let mut entry = ProviderEntry {
            key: key.to_string(),
            provider_type: table_string(table, "type"),
            api_key: table_string(table, "api_key"),
            base_url: table_string(table, "base_url"),
            auth_token: table_string(table, "auth_token"),
            app_id: table_string(table, "app_id"),
            access_key_id: table_string(table, "access_key_id"),
            secret_access_key: table_string(table, "secret_access_key"),
            region: table_string(table, "region"),
            api_version: table_string(table, "api_version"),
            deployment: table_string(table, "deployment"),
            model_name: table_string(table, "model_name"),
            env: table_to_key_value_entries(table, "env"),
            custom_headers: table_to_key_value_entries(table, "custom_headers"),
            extra_fields: collect_extra_fields(
                table,
                &[
                    "name",
                    "type",
                    "api_key",
                    "base_url",
                    "auth_token",
                    "app_id",
                    "access_key_id",
                    "secret_access_key",
                    "region",
                    "api_version",
                    "deployment",
                    "model_name",
                    "env",
                    "custom_headers",
                ],
            ),
        };

        if entry.provider_type.is_none() {
            entry.provider_type = table_string(table, "name");
        }

        entries.push(entry);
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

pub(super) fn parse_model_entries(root: &Table) -> Vec<ModelEntry> {
    let mut entries = Vec::new();
    let Some(models) = root.get("models").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in models.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        entries.push(ModelEntry {
            key: key.to_string(),
            provider: table_string(table, "provider"),
            model: table_string(table, "model"),
            max_context_size: table_i64(table, "max_context_size"),
            capabilities: table_string_array(table, "capabilities"),
            extra_fields: collect_extra_fields(
                table,
                &["provider", "model", "max_context_size", "capabilities"],
            ),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

pub(super) fn parse_service_entries(root: &Table) -> Vec<ServiceEntry> {
    let mut entries = Vec::new();
    let Some(services) = root.get("services").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in services.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        entries.push(ServiceEntry {
            key: key.to_string(),
            provider: table_string(table, "provider"),
            model: table_string(table, "model"),
            endpoint: table_string(table, "endpoint").or_else(|| table_string(table, "base_url")),
            api_key: table_string(table, "api_key"),
            timeout_ms: table_i64(table, "timeout_ms"),
            max_retries: table_i64(table, "max_retries"),
            extra_fields: collect_extra_fields(
                table,
                &[
                    "provider",
                    "model",
                    "endpoint",
                    "base_url",
                    "api_key",
                    "timeout_ms",
                    "max_retries",
                ],
            ),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

pub(super) fn parse_loop_control_entry(root: &Table) -> LoopControlEntry {
    let Some(loop_control) = root.get("loop_control").and_then(Item::as_table) else {
        return LoopControlEntry::default();
    };

    LoopControlEntry {
        enabled: table_bool(loop_control, "enabled"),
        max_steps: table_i64(loop_control, "max_steps"),
        max_retries: table_i64(loop_control, "max_retries"),
        timeout_ms: table_i64(loop_control, "timeout_ms"),
        extra_fields: collect_extra_fields(
            loop_control,
            &["enabled", "max_steps", "max_retries", "timeout_ms"],
        ),
    }
}

pub(super) fn parse_mcp_server_entries(root: &Table) -> Vec<McpServerEntry> {
    let mut entries = Vec::new();
    let Some(mcp_servers) = root.get("mcp_servers").and_then(Item::as_table) else {
        return entries;
    };

    for (key, item) in mcp_servers.iter() {
        let Some(table) = item.as_table() else {
            continue;
        };

        entries.push(McpServerEntry {
            key: key.to_string(),
            command: table_string(table, "command"),
            args: table_string_array(table, "args"),
            env: table_to_key_value_entries(table, "env"),
            enabled: table_bool(table, "enabled"),
            working_directory: table_string(table, "working_directory"),
            timeout_ms: table_i64(table, "timeout_ms"),
            extra_fields: collect_extra_fields(
                table,
                &[
                    "command",
                    "args",
                    "env",
                    "enabled",
                    "working_directory",
                    "timeout_ms",
                ],
            ),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

pub(super) fn table_to_key_value_entries(table: &Table, key: &str) -> Vec<KeyValueEntry> {
    let mut entries = Vec::new();
    let Some(child) = table.get(key).and_then(Item::as_table) else {
        return entries;
    };

    for (child_key, child_item) in child.iter() {
        let Some(value_item) = child_item.as_value() else {
            continue;
        };
        entries.push(KeyValueEntry {
            key: child_key.to_string(),
            value: toml_value_to_string(value_item),
        });
    }

    entries.sort_by(|left, right| left.key.cmp(&right.key));
    entries
}

pub(super) fn collect_extra_fields(table: &Table, known_keys: &[&str]) -> Vec<TypedFieldEntry> {
    let known: HashSet<&str> = known_keys.iter().copied().collect();
    let mut fields = Vec::new();

    for (key, item) in table.iter() {
        if known.contains(key) {
            continue;
        }
        if let Some(field) = typed_field_from_item(key, item) {
            fields.push(field);
        }
    }

    fields.sort_by(|left, right| left.key.cmp(&right.key));
    fields
}

pub(super) fn typed_field_from_item(key: &str, item: &Item) -> Option<TypedFieldEntry> {
    let value_item = item.as_value()?;

    if let Some(value) = value_item.as_str() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::String,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_integer() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::Integer,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_float() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::Float,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_bool() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::Boolean,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_array() {
        if value.iter().all(|entry| entry.as_str().is_some()) {
            let joined = value
                .iter()
                .filter_map(|entry| entry.as_str())
                .map(|entry| entry.to_string())
                .collect::<Vec<String>>()
                .join("\n");
            return Some(TypedFieldEntry {
                key: key.to_string(),
                value_type: TypedFieldType::StringArray,
                value: joined,
            });
        }
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::String,
            value: value.to_string(),
        });
    }
    if let Some(value) = value_item.as_datetime() {
        return Some(TypedFieldEntry {
            key: key.to_string(),
            value_type: TypedFieldType::String,
            value: value.to_string(),
        });
    }
    None
}

pub(super) fn validate_config_center_input(input: &KimiCliConfigCenterInput) -> Result<(), String> {
    let provider_keys = validate_named_keys(&input.providers, "providers", |entry| &entry.key)?;
    let _ = validate_named_keys(&input.models, "models", |entry| &entry.key)?;
    let _ = validate_named_keys(&input.services, "services", |entry| &entry.key)?;
    let _ = validate_named_keys(&input.mcp_servers, "mcp_servers", |entry| &entry.key)?;

    for provider in &input.providers {
        validate_key_value_entries(
            &provider.env,
            &format!("providers.{}.env", provider.key.trim()),
        )?;
        validate_key_value_entries(
            &provider.custom_headers,
            &format!("providers.{}.custom_headers", provider.key.trim()),
        )?;
        validate_typed_fields(
            &provider.extra_fields,
            &format!("providers.{}.extra_fields", provider.key.trim()),
        )?;
    }

    for model in &input.models {
        if let Some(provider) = normalize_optional_string(&model.provider) {
            if !provider_keys.contains(&provider) {
                return Err(format!(
                    "models.{} references unknown provider `{provider}`",
                    model.key.trim()
                ));
            }
        }
        validate_typed_fields(
            &model.extra_fields,
            &format!("models.{}.extra_fields", model.key.trim()),
        )?;
    }

    for service in &input.services {
        if let Some(provider) = normalize_optional_string(&service.provider) {
            if !provider_keys.contains(&provider) {
                return Err(format!(
                    "services.{} references unknown provider `{provider}`",
                    service.key.trim()
                ));
            }
        }
        validate_typed_fields(
            &service.extra_fields,
            &format!("services.{}.extra_fields", service.key.trim()),
        )?;
    }

    validate_typed_fields(
        &input.loop_control.extra_fields,
        "loop_control.extra_fields",
    )?;

    for server in &input.mcp_servers {
        validate_key_value_entries(
            &server.env,
            &format!("mcp_servers.{}.env", server.key.trim()),
        )?;
        validate_typed_fields(
            &server.extra_fields,
            &format!("mcp_servers.{}.extra_fields", server.key.trim()),
        )?;
    }

    Ok(())
}

pub(super) fn validate_named_keys<T>(
    entries: &[T],
    label: &str,
    key_selector: impl Fn(&T) -> &str,
) -> Result<HashSet<String>, String> {
    let mut seen = HashSet::new();
    for entry in entries {
        let key = key_selector(entry).trim();
        if key.is_empty() {
            return Err(format!("{label} contains an empty key"));
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("{label} contains duplicate key `{key}`"));
        }
    }
    Ok(seen)
}

pub(super) fn validate_key_value_entries(
    entries: &[KeyValueEntry],
    label: &str,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for entry in entries {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err(format!("{label} contains an empty key"));
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("{label} contains duplicate key `{key}`"));
        }
    }
    Ok(())
}

pub(super) fn validate_typed_fields(
    entries: &[TypedFieldEntry],
    label: &str,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for entry in entries {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err(format!("{label} contains an empty key"));
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("{label} contains duplicate key `{key}`"));
        }

        match entry.value_type {
            TypedFieldType::String => {}
            TypedFieldType::Integer => {
                let value = entry.value.trim();
                if value.parse::<i64>().is_err() {
                    return Err(format!("{label}.{key} must be a valid integer"));
                }
            }
            TypedFieldType::Float => {
                let value = entry.value.trim();
                if value.parse::<f64>().is_err() {
                    return Err(format!("{label}.{key} must be a valid float"));
                }
            }
            TypedFieldType::Boolean => {
                let value = entry.value.trim();
                if parse_bool_text(value).is_none() {
                    return Err(format!("{label}.{key} must be true/false"));
                }
            }
            TypedFieldType::StringArray => {}
        }
    }
    Ok(())
}

pub(super) fn apply_config_center_input(
    doc: &mut DocumentMut,
    input: &KimiCliConfigCenterInput,
) -> Result<(), String> {
    set_or_remove_string_key(
        doc,
        "provider",
        normalize_optional_string(&input.default_provider),
    );
    set_or_remove_string_key(doc, "model", normalize_optional_string(&input.model));
    set_or_remove_string_key(
        doc,
        "default_model",
        normalize_optional_string(&input.default_model),
    );
    set_or_remove_string_key(
        doc,
        "default_service",
        normalize_optional_string(&input.default_service),
    );
    set_or_remove_string_key(
        doc,
        "default_editor",
        normalize_optional_string(&input.default_editor),
    );
    set_or_remove_bool_key(doc, "default_yolo", input.default_yolo);
    set_or_remove_string_key(
        doc,
        "default_yolo_mode",
        normalize_optional_string(&input.default_yolo_mode),
    );
    set_or_remove_bool_key(doc, "default_thinking", input.default_thinking);
    set_or_remove_string_key(
        doc,
        "default_thinking_mode",
        normalize_optional_string(&input.default_thinking_mode),
    );
    set_or_remove_bool_key(
        doc,
        "local_model_disable_auto_pull",
        input.local_model_disable_auto_pull,
    );

    set_or_remove_table_key(doc, "providers", build_providers_table(&input.providers)?);
    set_or_remove_table_key(doc, "models", build_models_table(&input.models)?);
    set_or_remove_table_key(doc, "services", build_services_table(&input.services)?);
    set_or_remove_table_key(
        doc,
        "loop_control",
        build_loop_control_table(&input.loop_control)?,
    );
    set_or_remove_table_key(
        doc,
        "mcp_servers",
        build_mcp_servers_table(&input.mcp_servers)?,
    );
    Ok(())
}

pub(super) fn set_or_remove_string_key(
    doc: &mut DocumentMut,
    key: &str,
    next_value: Option<String>,
) {
    if let Some(next_value) = next_value {
        doc[key] = value(next_value);
        return;
    }
    let _ = doc.as_table_mut().remove(key);
}

pub(super) fn set_or_remove_bool_key(doc: &mut DocumentMut, key: &str, next_value: Option<bool>) {
    if let Some(next_value) = next_value {
        doc[key] = value(next_value);
        return;
    }
    let _ = doc.as_table_mut().remove(key);
}

pub(super) fn set_or_remove_table_key(doc: &mut DocumentMut, key: &str, table: Option<Table>) {
    if let Some(table) = table {
        doc[key] = Item::Table(table);
        return;
    }
    let _ = doc.as_table_mut().remove(key);
}

pub(super) fn build_providers_table(entries: &[ProviderEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut providers = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("providers contains an empty key".to_string());
        }

        let mut provider = Table::new();
        provider["name"] = value(key);
        set_if_string(&mut provider, "type", &entry.provider_type);
        set_if_string(&mut provider, "api_key", &entry.api_key);
        set_if_string(&mut provider, "base_url", &entry.base_url);
        set_if_string(&mut provider, "auth_token", &entry.auth_token);
        set_if_string(&mut provider, "app_id", &entry.app_id);
        set_if_string(&mut provider, "access_key_id", &entry.access_key_id);
        set_if_string(&mut provider, "secret_access_key", &entry.secret_access_key);
        set_if_string(&mut provider, "region", &entry.region);
        set_if_string(&mut provider, "api_version", &entry.api_version);
        set_if_string(&mut provider, "deployment", &entry.deployment);
        set_if_string(&mut provider, "model_name", &entry.model_name);

        if let Some(env) = build_key_value_table(&entry.env)? {
            provider["env"] = Item::Table(env);
        }
        if let Some(headers) = build_key_value_table(&entry.custom_headers)? {
            provider["custom_headers"] = Item::Table(headers);
        }
        apply_typed_fields(&mut provider, &entry.extra_fields)?;

        providers.insert(key, Item::Table(provider));
    }

    Ok(Some(providers))
}

pub(super) fn build_models_table(entries: &[ModelEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut models = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("models contains an empty key".to_string());
        }

        let mut model = Table::new();
        set_if_string(&mut model, "provider", &entry.provider);
        set_if_string(&mut model, "model", &entry.model);
        if let Some(max_context_size) = entry.max_context_size {
            model["max_context_size"] = value(max_context_size);
        }
        set_if_string_array(&mut model, "capabilities", &entry.capabilities);
        apply_typed_fields(&mut model, &entry.extra_fields)?;
        models.insert(key, Item::Table(model));
    }

    Ok(Some(models))
}

pub(super) fn build_services_table(entries: &[ServiceEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut services = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("services contains an empty key".to_string());
        }

        let mut service = Table::new();
        set_if_string(&mut service, "provider", &entry.provider);
        set_if_string(&mut service, "model", &entry.model);
        set_if_string(&mut service, "endpoint", &entry.endpoint);
        set_if_string(&mut service, "api_key", &entry.api_key);
        if let Some(timeout_ms) = entry.timeout_ms {
            service["timeout_ms"] = value(timeout_ms);
        }
        if let Some(max_retries) = entry.max_retries {
            service["max_retries"] = value(max_retries);
        }
        apply_typed_fields(&mut service, &entry.extra_fields)?;
        services.insert(key, Item::Table(service));
    }

    Ok(Some(services))
}

pub(super) fn build_loop_control_table(entry: &LoopControlEntry) -> Result<Option<Table>, String> {
    let mut loop_control = Table::new();
    if let Some(enabled) = entry.enabled {
        loop_control["enabled"] = value(enabled);
    }
    if let Some(max_steps) = entry.max_steps {
        loop_control["max_steps"] = value(max_steps);
    }
    if let Some(max_retries) = entry.max_retries {
        loop_control["max_retries"] = value(max_retries);
    }
    if let Some(timeout_ms) = entry.timeout_ms {
        loop_control["timeout_ms"] = value(timeout_ms);
    }
    apply_typed_fields(&mut loop_control, &entry.extra_fields)?;

    if loop_control.is_empty() {
        return Ok(None);
    }
    Ok(Some(loop_control))
}

pub(super) fn build_mcp_servers_table(entries: &[McpServerEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut servers = Table::new();
    let mut sorted = entries.to_vec();
    sorted.sort_by(|left, right| left.key.trim().cmp(right.key.trim()));

    for entry in sorted {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("mcp_servers contains an empty key".to_string());
        }

        let mut server = Table::new();
        set_if_string(&mut server, "command", &entry.command);
        set_if_string_array(&mut server, "args", &entry.args);
        if let Some(env) = build_key_value_table(&entry.env)? {
            server["env"] = Item::Table(env);
        }
        if let Some(enabled) = entry.enabled {
            server["enabled"] = value(enabled);
        }
        set_if_string(&mut server, "working_directory", &entry.working_directory);
        if let Some(timeout_ms) = entry.timeout_ms {
            server["timeout_ms"] = value(timeout_ms);
        }
        apply_typed_fields(&mut server, &entry.extra_fields)?;
        servers.insert(key, Item::Table(server));
    }

    Ok(Some(servers))
}

pub(super) fn build_key_value_table(entries: &[KeyValueEntry]) -> Result<Option<Table>, String> {
    if entries.is_empty() {
        return Ok(None);
    }

    let mut table = Table::new();
    let mut seen = HashSet::new();
    for entry in entries {
        let key = entry.key.trim();
        if key.is_empty() {
            return Err("key/value table contains empty key".to_string());
        }
        if !seen.insert(key.to_string()) {
            return Err(format!("key/value table contains duplicate key `{key}`"));
        }
        table.insert(key, value(entry.value.trim().to_string()));
    }

    if table.is_empty() {
        return Ok(None);
    }
    Ok(Some(table))
}

pub(super) fn set_if_string(table: &mut Table, key: &str, raw_value: &Option<String>) {
    if let Some(next_value) = normalize_optional_string(raw_value) {
        table[key] = value(next_value);
    }
}

pub(super) fn set_if_string_array(table: &mut Table, key: &str, values: &[String]) {
    let filtered = values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .collect::<Vec<String>>();

    if filtered.is_empty() {
        return;
    }

    let mut array = Array::new();
    for value in filtered {
        array.push(value);
    }
    table[key] = Item::Value(Value::Array(array));
}

pub(super) fn apply_typed_fields(
    table: &mut Table,
    fields: &[TypedFieldEntry],
) -> Result<(), String> {
    for field in fields {
        let key = field.key.trim();
        if key.is_empty() {
            return Err("extra field key cannot be empty".to_string());
        }

        match field.value_type {
            TypedFieldType::String => {
                table.insert(key, value(field.value.clone()));
            }
            TypedFieldType::Integer => {
                let parsed = field
                    .value
                    .trim()
                    .parse::<i64>()
                    .map_err(|_| format!("extra field `{key}` must be a valid integer"))?;
                table.insert(key, value(parsed));
            }
            TypedFieldType::Float => {
                let parsed = field
                    .value
                    .trim()
                    .parse::<f64>()
                    .map_err(|_| format!("extra field `{key}` must be a valid float"))?;
                table.insert(key, value(parsed));
            }
            TypedFieldType::Boolean => {
                let parsed = parse_bool_text(field.value.trim())
                    .ok_or_else(|| format!("extra field `{key}` must be true/false"))?;
                table.insert(key, value(parsed));
            }
            TypedFieldType::StringArray => {
                let mut array = Array::new();
                for line in field
                    .value
                    .lines()
                    .map(|line| line.trim())
                    .filter(|line| !line.is_empty())
                {
                    array.push(line);
                }
                table[key] = Item::Value(Value::Array(array));
            }
        }
    }
    Ok(())
}

pub(super) fn parse_bool_text(value: &str) -> Option<bool> {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "true" | "1" | "yes" => Some(true),
        "false" | "0" | "no" => Some(false),
        _ => None,
    }
}

pub(super) fn normalize_optional_string(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn toml_value_to_string(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(number) = value.as_integer() {
        return number.to_string();
    }
    if let Some(number) = value.as_float() {
        return number.to_string();
    }
    if let Some(flag) = value.as_bool() {
        return flag.to_string();
    }
    if let Some(datetime) = value.as_datetime() {
        return datetime.to_string();
    }
    if let Some(array) = value.as_array() {
        return array.to_string();
    }
    value.to_string()
}

pub(super) fn resolve_working_directory(
    settings: &AppSettings,
    session_work_dir: Option<&PathBuf>,
) -> anyhow::Result<PathBuf> {
    if let Some(session_dir) = session_work_dir {
        if !session_dir.exists() {
            return Err(anyhow::anyhow!(
                "Session work directory does not exist: {}",
                session_dir.display()
            ));
        }
        if !session_dir.is_dir() {
            return Err(anyhow::anyhow!(
                "Session work directory is not a folder: {}",
                session_dir.display()
            ));
        }
        return Ok(session_dir.clone());
    }

    if let Some(configured) = settings
        .work_dir
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let work_dir = PathBuf::from(configured);
        if !work_dir.exists() {
            return Err(anyhow::anyhow!(
                "Configured work directory does not exist: {}",
                work_dir.display()
            ));
        }
        if !work_dir.is_dir() {
            return Err(anyhow::anyhow!(
                "Configured work directory is not a folder: {}",
                work_dir.display()
            ));
        }

        return Ok(work_dir);
    }

    default_working_directory()
        .ok_or_else(|| anyhow::anyhow!("failed to determine default work directory"))
}

pub(super) fn default_working_directory() -> Option<PathBuf> {
    home_directory().or_else(|| std::env::current_dir().ok())
}

pub(super) fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}

pub(super) fn resolve_kimi_config_dir() -> Result<PathBuf, String> {
    token_resolver::resolve_kimi_code_home().map_err(|error| error.to_string())
}

pub(super) fn resolve_kimi_config_path() -> Result<PathBuf, String> {
    Ok(resolve_kimi_config_dir()?.join("config.toml"))
}

pub(super) fn parse_kimi_config_document(raw: &str, path: &Path) -> Result<DocumentMut, String> {
    raw.parse::<DocumentMut>()
        .map_err(|error| format!("failed to parse TOML config {}: {error}", path.display()))
}

pub(super) fn read_or_init_kimi_config(path: &Path) -> Result<DocumentMut, String> {
    if !path.exists() {
        return Ok(DocumentMut::new());
    }

    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read config file {}: {error}", path.display()))?;
    parse_kimi_config_document(&raw, path)
}

pub(super) fn table_string(table: &Table, key: &str) -> Option<String> {
    table
        .get(key)
        .and_then(Item::as_value)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn table_bool(table: &Table, key: &str) -> Option<bool> {
    table.get(key).and_then(Item::as_value).and_then(|value| {
        value
            .as_bool()
            .or_else(|| value.as_str().and_then(parse_bool_text))
    })
}

pub(super) fn table_i64(table: &Table, key: &str) -> Option<i64> {
    table.get(key).and_then(Item::as_value).and_then(|value| {
        value.as_integer().or_else(|| {
            value
                .as_str()
                .and_then(|raw| raw.trim().parse::<i64>().ok())
        })
    })
}

pub(super) fn table_string_array(table: &Table, key: &str) -> Vec<String> {
    table
        .get(key)
        .and_then(Item::as_value)
        .and_then(Value::as_array)
        .map(|array| {
            array
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default()
}

pub(super) fn provider_table<'a>(root: &'a Table, provider: &str) -> Option<&'a Table> {
    root.get("providers")
        .and_then(Item::as_table)
        .and_then(|providers| providers.get(provider))
        .and_then(Item::as_table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn temp_config_path(test_name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("kimi-app-{test_name}-{suffix}"));
        fs::create_dir_all(&dir).expect("temp test dir should be created");
        dir.join("config.toml")
    }

    fn read_test_config(path: &Path) -> DocumentMut {
        let raw = fs::read_to_string(path).expect("test config should exist");
        parse_kimi_config_document(&raw, path).expect("test config should parse")
    }

    #[test]
    fn config_center_validation_rejects_unknown_provider_reference() {
        let input = KimiCliConfigCenterInput {
            providers: vec![ProviderEntry {
                key: "moonshot".to_string(),
                ..Default::default()
            }],
            models: vec![ModelEntry {
                key: "kimi-k2".to_string(),
                provider: Some("unknown".to_string()),
                ..Default::default()
            }],
            services: vec![],
            default_provider: None,
            model: None,
            default_model: None,
            default_service: None,
            default_editor: None,
            default_yolo: None,
            default_yolo_mode: None,
            default_thinking: None,
            default_thinking_mode: None,
            local_model_disable_auto_pull: None,
            loop_control: LoopControlEntry::default(),
            mcp_servers: vec![],
        };

        let result = validate_config_center_input(&input);
        assert!(result.is_err());
        let error = result.err().unwrap_or_default();
        assert!(error.contains("unknown provider"));
    }

    #[test]
    fn config_center_apply_rewrites_managed_sections() {
        let mut doc = r#"
    provider = "legacy"
    [providers.legacy]
    api_key = "legacy-key"
    "#
        .parse::<DocumentMut>()
        .expect("valid toml document");

        let input = KimiCliConfigCenterInput {
            providers: vec![ProviderEntry {
                key: "moonshot".to_string(),
                provider_type: Some("moonshot".to_string()),
                api_key: Some("new-key".to_string()),
                base_url: Some("https://api.moonshot.cn/v1".to_string()),
                auth_token: None,
                app_id: None,
                access_key_id: None,
                secret_access_key: None,
                region: None,
                api_version: None,
                deployment: None,
                model_name: None,
                env: vec![KeyValueEntry {
                    key: "MOONSHOT_API_KEY".to_string(),
                    value: "${MOONSHOT_API_KEY}".to_string(),
                }],
                custom_headers: vec![],
                extra_fields: vec![],
            }],
            models: vec![ModelEntry {
                key: "kimi-k2".to_string(),
                provider: Some("moonshot".to_string()),
                model: Some("kimi-k2-turbo-preview".to_string()),
                max_context_size: Some(128000),
                capabilities: vec!["chat".to_string(), "vision".to_string()],
                extra_fields: vec![],
            }],
            services: vec![ServiceEntry {
                key: "default".to_string(),
                provider: Some("moonshot".to_string()),
                model: Some("kimi-k2".to_string()),
                endpoint: Some("https://api.moonshot.cn/v1".to_string()),
                api_key: None,
                timeout_ms: Some(60000),
                max_retries: Some(3),
                extra_fields: vec![],
            }],
            default_provider: Some("moonshot".to_string()),
            model: Some("kimi-k2".to_string()),
            default_model: Some("kimi-k2".to_string()),
            default_service: Some("default".to_string()),
            default_editor: Some("vim".to_string()),
            default_yolo: Some(false),
            default_yolo_mode: Some("safe".to_string()),
            default_thinking: Some(true),
            default_thinking_mode: Some("balanced".to_string()),
            local_model_disable_auto_pull: Some(true),
            loop_control: LoopControlEntry {
                enabled: Some(true),
                max_steps: Some(4),
                max_retries: Some(2),
                timeout_ms: Some(120000),
                extra_fields: vec![],
            },
            mcp_servers: vec![McpServerEntry {
                key: "filesystem".to_string(),
                command: Some("npx".to_string()),
                args: vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-filesystem".to_string(),
                ],
                env: vec![],
                enabled: Some(true),
                working_directory: Some("D:/Projects".to_string()),
                timeout_ms: Some(45000),
                extra_fields: vec![],
            }],
        };

        apply_config_center_input(&mut doc, &input).expect("apply config center input");
        let root = doc.as_table();

        assert_eq!(table_string(root, "provider").as_deref(), Some("moonshot"));
        assert_eq!(
            table_string(root, "default_model").as_deref(),
            Some("kimi-k2")
        );
        assert!(provider_table(root, "legacy").is_none());
        assert!(provider_table(root, "moonshot").is_some());
        assert!(root
            .get("models")
            .and_then(Item::as_table)
            .and_then(|table| table.get("kimi-k2"))
            .is_some());
        assert!(root
            .get("services")
            .and_then(Item::as_table)
            .and_then(|table| table.get("default"))
            .is_some());
        assert!(root
            .get("mcp_servers")
            .and_then(Item::as_table)
            .and_then(|table| table.get("filesystem"))
            .is_some());
    }

    #[test]
    fn save_kimi_api_template_from_empty_config_writes_fixed_sections() {
        let config_path = temp_config_path("save-kimi-api-template-empty");
        save_kimi_api_template_to_path(&config_path, Some("sk-test-123".to_string()))
            .expect("save kimi api template");

        let doc = read_test_config(&config_path);
        let root = doc.as_table();
        let provider = provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID)
            .expect("kimi provider section should exist");
        assert_eq!(table_string(provider, "type").as_deref(), Some("kimi"));
        assert_eq!(
            table_string(provider, "base_url").as_deref(),
            Some(KIMI_CODING_PLAN_BASE_URL)
        );
        assert_eq!(
            table_string(provider, "api_key").as_deref(),
            Some("sk-test-123")
        );

        let model = root
            .get("models")
            .and_then(Item::as_table)
            .and_then(|models| models.get(KIMI_CODING_PLAN_MODEL_ID))
            .and_then(Item::as_table)
            .expect("kimi model section should exist");
        assert_eq!(
            table_string(model, "provider").as_deref(),
            Some(KIMI_CODING_PLAN_PROVIDER_ID)
        );
        assert_eq!(
            table_string(model, "model").as_deref(),
            Some(KIMI_CODING_PLAN_MODEL_NAME)
        );
        assert_eq!(
            table_i64(model, "max_context_size"),
            Some(KIMI_CODING_PLAN_MAX_CONTEXT_SIZE)
        );

        let search_service = service_table(root, KIMI_CODING_PLAN_SEARCH_SERVICE_KEY)
            .expect("search service should exist");
        assert_eq!(
            service_base_url(search_service).as_deref(),
            Some(KIMI_CODING_PLAN_SEARCH_URL)
        );
        assert_eq!(
            table_string(search_service, "api_key").as_deref(),
            Some("sk-test-123")
        );

        let fetch_service = service_table(root, KIMI_CODING_PLAN_FETCH_SERVICE_KEY)
            .expect("fetch service should exist");
        assert_eq!(
            service_base_url(fetch_service).as_deref(),
            Some(KIMI_CODING_PLAN_FETCH_URL)
        );
        assert_eq!(
            table_string(fetch_service, "api_key").as_deref(),
            Some("sk-test-123")
        );

        assert!(kimi_api_template_configured(root));
        let _ = fs::remove_dir_all(
            config_path
                .parent()
                .expect("config path should have temp parent directory"),
        );
    }

    #[test]
    fn save_kimi_api_template_preserves_unrelated_config_sections() {
        let config_path = temp_config_path("save-kimi-api-template-preserve");
        fs::write(
            &config_path,
            r#"
    provider = "openai"
    model = "gpt-4.1"
    default_model = "gpt-4.1"
    
    [providers.openai]
    type = "openai"
    api_key = "sk-openai"
    
    [models.gpt-4.1]
    provider = "openai"
    model = "gpt-4.1"
    
    [services.docs]
    endpoint = "https://docs.example.com"
    api_key = "docs-key"
    "#,
        )
        .expect("seed config should be written");

        save_kimi_api_template_to_path(&config_path, Some("sk-kimi-456".to_string()))
            .expect("save kimi api template");

        let doc = read_test_config(&config_path);
        let root = doc.as_table();
        assert_eq!(table_string(root, "provider").as_deref(), Some("openai"));
        assert_eq!(table_string(root, "model").as_deref(), Some("gpt-4.1"));
        assert_eq!(
            table_string(root, "default_model").as_deref(),
            Some("gpt-4.1")
        );
        assert!(provider_table(root, "openai").is_some());
        assert!(service_table(root, "docs").is_some());
        assert!(provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID).is_some());
        assert!(service_table(root, KIMI_CODING_PLAN_SEARCH_SERVICE_KEY).is_some());
        assert!(service_table(root, KIMI_CODING_PLAN_FETCH_SERVICE_KEY).is_some());
        let _ = fs::remove_dir_all(
            config_path
                .parent()
                .expect("config path should have temp parent directory"),
        );
    }

    #[test]
    fn access_config_patch_preserves_unrelated_tables_and_existing_keys() {
        let mut doc = r#"
default_model = "gpt-4.1"

[providers.openai]
type = "openai"
api_key = "sk-openai"

[providers."kimi-app-api-key"]
type = "kimi"
base_url = "https://old.example.com"
api_key = "sk-existing"
custom = "keep"

[services.moonshot_search]
base_url = "https://old.example.com/search"
api_key = "sk-search"
oauth = true

[services.other]
base_url = "https://other.example.com"
api_key = "other-key"
"#
        .parse::<DocumentMut>()
        .expect("valid toml");

        apply_kimi_code_access_input(
            &mut doc,
            &KimiCodeAccessConfigInput {
                provider_base_url: KIMI_CODING_PLAN_BASE_URL.to_string(),
                provider_api_key: None,
                clear_provider_api_key: Some(false),
                search_base_url: KIMI_CODING_PLAN_SEARCH_URL.to_string(),
                search_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
                search_api_key: None,
                fetch_base_url: KIMI_CODING_PLAN_FETCH_URL.to_string(),
                fetch_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::Custom),
                fetch_api_key: Some("sk-fetch".to_string()),
                agent_swarm_max_concurrency: None,
                clear_agent_swarm_max_concurrency: Some(false),
            },
        )
        .expect("apply access input");

        let root = doc.as_table();
        assert_eq!(
            table_string(root, "default_model").as_deref(),
            Some("gpt-4.1")
        );
        assert!(provider_table(root, "openai").is_some());
        let provider = provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID).expect("provider");
        assert_eq!(
            table_string(provider, "api_key").as_deref(),
            Some("sk-existing")
        );
        assert_eq!(table_string(provider, "custom").as_deref(), Some("keep"));
        let model = root
            .get("models")
            .and_then(Item::as_table)
            .and_then(|models| models.get(KIMI_CODING_PLAN_MODEL_ID))
            .and_then(Item::as_table)
            .expect("model");
        assert_eq!(
            table_string(model, "model").as_deref(),
            Some(KIMI_CODING_PLAN_MODEL_NAME)
        );
        let search = service_table(root, KIMI_CODING_PLAN_SEARCH_SERVICE_KEY).expect("search");
        assert_eq!(table_bool(search, "oauth"), Some(true));
        assert_eq!(
            table_string(search, "api_key").as_deref(),
            Some("sk-existing")
        );
        let fetch = service_table(root, KIMI_CODING_PLAN_FETCH_SERVICE_KEY).expect("fetch");
        assert_eq!(table_string(fetch, "api_key").as_deref(), Some("sk-fetch"));
        assert_eq!(
            table_string(
                service_table(root, "other").expect("other service"),
                "api_key"
            )
            .as_deref(),
            Some("other-key")
        );
    }

    #[test]
    fn access_config_write_creates_backup_before_replace() {
        let config_path = temp_config_path("access-config-backup");
        fs::write(&config_path, "old_key = true\n").expect("seed config");
        let doc = "new_key = true\n"
            .parse::<DocumentMut>()
            .expect("new config");

        write_kimi_config_atomically_with_backup(&config_path, &doc).expect("write config");

        let raw = fs::read_to_string(&config_path).expect("read config");
        assert!(raw.contains("new_key"));
        let backups = fs::read_dir(config_path.parent().expect("parent"))
            .expect("list backups")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("config.toml.kimi-app-backup-")
            })
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);

        let _ = fs::remove_dir_all(
            config_path
                .parent()
                .expect("config path should have temp parent directory"),
        );
    }

    #[test]
    fn set_kimi_api_default_only_updates_top_level_defaults() {
        let config_path = temp_config_path("set-kimi-api-default");
        fs::write(
            &config_path,
            r#"
    provider = "openai"
    model = "gpt-4.1"
    default_model = "gpt-4.1"
    
    [providers.openai]
    type = "openai"
    api_key = "sk-openai"
    "#,
        )
        .expect("seed config should be written");
        save_kimi_api_template_to_path(&config_path, Some("sk-kimi-789".to_string()))
            .expect("save kimi api template");

        set_kimi_api_default_at_path(&config_path).expect("set kimi api default");

        let doc = read_test_config(&config_path);
        let root = doc.as_table();
        assert_eq!(
            table_string(root, "provider").as_deref(),
            Some(KIMI_CODING_PLAN_PROVIDER_ID)
        );
        assert_eq!(
            table_string(root, "model").as_deref(),
            Some(KIMI_CODING_PLAN_MODEL_ID)
        );
        assert_eq!(
            table_string(root, "default_model").as_deref(),
            Some(KIMI_CODING_PLAN_MODEL_ID)
        );
        assert!(provider_table(root, "openai").is_some());
        assert!(provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID).is_some());
        assert!(kimi_api_default_selected(root));
        let _ = fs::remove_dir_all(
            config_path
                .parent()
                .expect("config path should have temp parent directory"),
        );
    }

    #[test]
    fn set_kimi_api_default_requires_saved_template() {
        let config_path = temp_config_path("set-kimi-api-default-missing-template");
        fs::write(
            &config_path,
            r#"
    [providers.openai]
    type = "openai"
    api_key = "sk-openai"
    "#,
        )
        .expect("seed config should be written");

        let error = set_kimi_api_default_at_path(&config_path)
            .expect_err("setting default without template should fail");
        assert!(error.contains("请先保存 Kimi Coding Plan 配置"));
        let _ = fs::remove_dir_all(
            config_path
                .parent()
                .expect("config path should have temp parent directory"),
        );
    }

    #[test]
    fn set_kimi_login_default_clears_only_kimi_top_level_defaults() {
        let config_path = temp_config_path("set-kimi-login-default");
        save_kimi_api_template_to_path(&config_path, Some("sk-kimi-login".to_string()))
            .expect("save kimi api template");
        set_kimi_api_default_at_path(&config_path).expect("set kimi api default");

        set_kimi_login_default_at_path(&config_path).expect("set kimi login default");

        let doc = read_test_config(&config_path);
        let root = doc.as_table();
        assert!(table_string(root, "provider").is_none());
        assert!(table_string(root, "model").is_none());
        assert!(table_string(root, "default_model").is_none());
        assert!(provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID).is_some());
        assert_eq!(
            resolve_existing_kimi_api_key(root).as_deref(),
            Some("sk-kimi-login")
        );
        assert!(kimi_api_template_configured(root));
        assert!(!kimi_api_default_selected(root));
        let _ = fs::remove_dir_all(
            config_path
                .parent()
                .expect("config path should have temp parent directory"),
        );
    }

    #[test]
    fn env_override_status_masks_sensitive_values() {
        let _guard = env_lock().lock().expect("env lock should not be poisoned");

        std::env::set_var("KIMI_API_KEY", "sk-test-secret");
        let statuses = collect_env_override_statuses();
        std::env::remove_var("KIMI_API_KEY");

        let record = statuses
            .iter()
            .find(|status| status.key == "KIMI_API_KEY")
            .expect("KIMI_API_KEY status should exist");
        assert!(record.is_set);
        let masked = record.masked_value.clone().unwrap_or_default();
        assert!(masked.contains("***"));
        assert_ne!(masked, "sk-test-secret");
    }
}
