use super::*;

const ENV_VALUE_VISIBLE_EDGE: usize = 2;

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

pub fn collect_kimi_code_access_secret_values() -> Result<Vec<String>, String> {
    let config_path = resolve_kimi_config_path()?;
    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&config_path).map_err(|error| {
        format!(
            "failed to read config file {}: {error}",
            config_path.display()
        )
    })?;
    let doc = parse_kimi_config_document(&raw, &config_path)?;
    let mut values = collect_kimi_code_access_secret_values_from_root(doc.as_table());
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup();
    Ok(values)
}

fn collect_kimi_code_access_secret_values_from_root(root: &Table) -> Vec<String> {
    let mut values = Vec::new();
    for provider_id in [
        KIMI_CODING_PLAN_PROVIDER_ID,
        LEGACY_KIMI_CODING_PLAN_PROVIDER_ID,
    ] {
        if let Some(provider) = provider_table(root, provider_id) {
            push_secret_value(&mut values, table_string(provider, "api_key"));
        }
    }
    for service_key in [
        KIMI_CODING_PLAN_SEARCH_SERVICE_KEY,
        KIMI_CODING_PLAN_FETCH_SERVICE_KEY,
    ] {
        if let Some(service) = service_table(root, service_key) {
            push_secret_value(&mut values, table_string(service, "api_key"));
        }
    }
    values
}

fn push_secret_value(values: &mut Vec<String>, value: Option<String>) {
    if let Some(value) = value {
        values.push(value);
    }
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

pub(super) fn normalize_optional_string(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
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

pub(super) fn table_i64(table: &Table, key: &str) -> Option<i64> {
    table.get(key).and_then(Item::as_value).and_then(|value| {
        value.as_integer().or_else(|| {
            value
                .as_str()
                .and_then(|raw| raw.trim().parse::<i64>().ok())
        })
    })
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
    use std::time::{SystemTime, UNIX_EPOCH};

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
        assert_eq!(
            search
                .get("oauth")
                .and_then(Item::as_value)
                .and_then(|value| value.as_bool()),
            Some(true)
        );
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
    fn access_secret_collection_only_tracks_managed_access_keys() {
        let doc = r#"
[providers.openai]
type = "openai"
api_key = "sk-openai"

[providers."kimi-app-api-key"]
type = "kimi"
api_key = "sk-provider"

[providers."kimi-for-coding"]
type = "kimi"
api_key = "sk-legacy"

[services.moonshot_search]
api_key = "sk-search"

[services.moonshot_fetch]
api_key = "sk-fetch"

[services.other]
api_key = "sk-other"
"#
        .parse::<DocumentMut>()
        .expect("valid toml");

        let mut values = collect_kimi_code_access_secret_values_from_root(doc.as_table());
        values.sort();
        assert_eq!(
            values,
            vec![
                "sk-fetch".to_string(),
                "sk-legacy".to_string(),
                "sk-provider".to_string(),
                "sk-search".to_string(),
            ]
        );
    }
}
