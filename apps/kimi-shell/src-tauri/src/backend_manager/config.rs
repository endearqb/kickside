use super::*;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
};

const ENV_VALUE_VISIBLE_EDGE: usize = 2;

pub(crate) const KIMI_CODING_PLAN_PROVIDER_ID: &str = "managed:kimi-code";
pub(crate) const KIMI_CODING_PLAN_MODEL_ID: &str = "kimi-code/k3";
pub(super) const KIMI_CODING_PLAN_MODEL_NAME: &str = "kimi-for-coding";
const KIMI_CODING_PLAN_MODEL_PREFIX: &str = "kimi-code/";
const LEGACY_KIMI_APP_PROVIDER_ID: &str = "kimi-app-api-key";
const LEGACY_KIMI_APP_MODEL_ID: &str = "kimi-app/kimi-for-coding";
pub(super) const LEGACY_KIMI_CODING_PLAN_PROVIDER_ID: &str = "kimi-for-coding";
pub(super) const LEGACY_KIMI_CODING_PLAN_MODEL_ID: &str = "kimi-for-coding";
pub(super) const KIMI_CODING_PLAN_BASE_URL: &str = "https://api.kimi.com/coding/v1";
pub(super) const KIMI_CODING_PLAN_SEARCH_URL: &str = "https://api.kimi.com/coding/v1/search";
pub(super) const KIMI_CODING_PLAN_FETCH_URL: &str = "https://api.kimi.com/coding/v1/fetch";
pub(super) const KIMI_CODING_PLAN_SEARCH_SERVICE_KEY: &str = "moonshot_search";
pub(super) const KIMI_CODING_PLAN_FETCH_SERVICE_KEY: &str = "moonshot_fetch";
const KIMI_CONFIG_BACKUP_KEEP: usize = 5;
const KIMI_CONFIG_REPLACE_ATTEMPTS: usize = 4;
const CONFIG_CONFLICT: &str =
    "config_conflict: Kimi Code 配置已被其他程序修改。请保留当前输入，重新打开配置面板后再保存。";

#[derive(Debug, Clone)]
struct KimiConfigSnapshot {
    raw: Option<String>,
    fingerprint: String,
}

fn config_fingerprint(raw: Option<&str>) -> String {
    match raw {
        None => "missing".to_string(),
        Some(raw) => {
            let mut hasher = DefaultHasher::new();
            raw.hash(&mut hasher);
            format!("content:{:016x}", hasher.finish())
        }
    }
}

fn read_kimi_config_snapshot(path: &Path) -> Result<KimiConfigSnapshot, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => Some(raw),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(format!(
                "failed to read config file {}: {error}",
                path.display()
            ))
        }
    };
    Ok(KimiConfigSnapshot {
        fingerprint: config_fingerprint(raw.as_deref()),
        raw,
    })
}

fn ensure_config_fingerprint(path: &Path, expected: &str) -> Result<(), String> {
    if read_kimi_config_snapshot(path)?.fingerprint == expected {
        Ok(())
    } else {
        Err(CONFIG_CONFLICT.to_string())
    }
}

pub fn load_kimi_code_access_config(app: &AppHandle) -> Result<KimiCodeAccessConfigView, String> {
    let kimi_code_home = resolve_kimi_config_dir()?;
    let config_path = kimi_code_home.join("config.toml");
    let snapshot = read_kimi_config_snapshot(&config_path)?;
    let config_exists = snapshot.raw.is_some();
    let mut provider_base_url = None;
    let mut provider_api_key = None;
    let mut models = Vec::new();
    let mut default_model = None;
    let mut search_base_url = None;
    let mut search_api_key = None;
    let mut fetch_base_url = None;
    let mut fetch_api_key = None;
    let mut config_error = None;
    let mut warnings = Vec::new();

    if let Some(raw) = snapshot.raw.as_deref() {
        let doc = match parse_kimi_config_document(raw, &config_path) {
            Ok(doc) => Some(doc),
            Err(error) => {
                warnings.push(format!("配置读取失败：{error}"));
                config_error = Some(error);
                None
            }
        };

        if let Some(doc) = doc {
            let root = doc.as_table();
            let provider = provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID)
                .or_else(|| provider_table(root, LEGACY_KIMI_APP_PROVIDER_ID))
                .or_else(|| provider_table(root, LEGACY_KIMI_CODING_PLAN_PROVIDER_ID));
            provider_base_url = provider.and_then(|table| table_string(table, "base_url"));
            provider_api_key = provider.and_then(|table| table_string(table, "api_key"));
            default_model = table_string(root, "default_model");
            models = managed_model_views(root);

            if provider_table(root, LEGACY_KIMI_APP_PROVIDER_ID).is_some()
                || provider_table(root, LEGACY_KIMI_CODING_PLAN_PROVIDER_ID).is_some()
                || root
                    .get("models")
                    .and_then(Item::as_table)
                    .is_some_and(|models| {
                        models.get(LEGACY_KIMI_APP_MODEL_ID).is_some()
                            || models.get(LEGACY_KIMI_CODING_PLAN_MODEL_ID).is_some()
                    })
            {
                warnings
                    .push("发现旧版 Kimi 小助手 API 配置；下次成功保存时会自动迁移。".to_string());
            }
            if provider_table(root, KIMI_CODING_PLAN_PROVIDER_ID).is_some_and(provider_has_oauth) {
                warnings.push(
                    "当前 managed:kimi-code 使用 OAuth 登录；API Key 保存将被阻止。".to_string(),
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
    }

    let settings = settings_store::load_or_default(app).map_err(|error| error.to_string())?;
    let provider_key_configured = provider_api_key.is_some();
    let search_uses_provider = keys_match(search_api_key.as_deref(), provider_api_key.as_deref());
    let fetch_uses_provider = keys_match(fetch_api_key.as_deref(), provider_api_key.as_deref());

    Ok(KimiCodeAccessConfigView {
        kimi_code_home: kimi_code_home.to_string_lossy().to_string(),
        config_path: config_path.to_string_lossy().to_string(),
        config_exists,
        config_fingerprint: Some(snapshot.fingerprint),
        config_error,
        provider: KimiCodeAccessConfigProviderView {
            id: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
            provider_type: "kimi".to_string(),
            base_url: provider_base_url,
            api_key_configured: provider_key_configured,
            api_key_masked: provider_api_key.as_deref().map(mask_env_value),
        },
        model: selected_model_view(default_model.as_deref(), &models),
        default_model,
        models,
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
    kimi_path: &Path,
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
    let snapshot = read_kimi_config_snapshot(&config_path)?;
    if input
        .expected_config_fingerprint
        .as_deref()
        .is_some_and(|expected| expected != snapshot.fingerprint)
    {
        return Err(CONFIG_CONFLICT.to_string());
    }
    let mut doc = match snapshot.raw.as_deref() {
        Some(raw) => parse_kimi_config_document(raw, &config_path)?,
        None => DocumentMut::new(),
    };
    let clear_provider_api_key = input.clear_provider_api_key.unwrap_or(false);
    if !clear_provider_api_key
        && provider_table(doc.as_table(), KIMI_CODING_PLAN_PROVIDER_ID)
            .is_some_and(provider_has_oauth)
    {
        return Err(
            "managed:kimi-code 当前由 OAuth 登录管理；请先退出登录，再保存 API Key 配置。"
                .to_string(),
        );
    }
    if clear_provider_api_key {
        clear_managed_access_keys(&mut doc, &input);
    } else {
        let existing_provider_api_key = managed_provider_api_key(doc.as_table());
        let next_provider_api_key = normalize_optional_string(&input.provider_api_key)
            .or(existing_provider_api_key)
            .ok_or_else(|| "Kimi API Key 不能为空；请输入 API Key 后再保存。".to_string())?;
        let synced_models = fetch_models_blocking(
            input.provider_base_url.as_str(),
            next_provider_api_key.as_str(),
        )?;
        apply_kimi_code_access_input(&mut doc, &input, &synced_models, &next_provider_api_key)?;
    }
    write_kimi_config_atomically_with_backup(&config_path, &doc, &snapshot, Some(kimi_path))?;

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
    _app: &AppHandle,
    input: KimiCodeAccessConfigTestInput,
) -> Result<KimiCodeAccessConfigTestResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))?;
    let existing_api_key = load_managed_provider_api_key()?;
    let effective_provider_api_key =
        normalize_optional_string(&input.provider_api_key).or(existing_api_key);
    let secrets = [
        effective_provider_api_key.as_deref(),
        input.search_api_key.as_deref(),
        input.fetch_api_key.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .map(str::to_string)
    .collect::<Vec<_>>();
    let api_key_configured = effective_provider_api_key.is_some();

    let (provider, models) = probe_models_endpoint(
        &client,
        &input.provider_base_url,
        effective_provider_api_key.as_deref(),
        &secrets,
    )
    .await;
    Ok(KimiCodeAccessConfigTestResult {
        provider,
        search: skipped_endpoint_result(
            &input.search_base_url,
            "未发起实际搜索请求，避免产生请求或额度消耗。",
        ),
        fetch: skipped_endpoint_result(
            &input.fetch_base_url,
            "未发起实际抓取请求，避免产生外部访问。",
        ),
        api_key_configured,
        models,
        warnings: if api_key_configured {
            vec!["Search/Fetch 仅检查配置，不执行有副作用的业务请求。".to_string()]
        } else {
            vec!["未找到 API Key，无法验证 Kimi API。".to_string()]
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
    models: &[KimiCodeAccessConfigModelView],
    provider_api_key: &str,
) -> Result<(), String> {
    patch_kimi_access_provider(doc, input.provider_base_url.trim(), Some(provider_api_key))?;
    let default_model = patch_kimi_access_models(doc, models, input.default_model.as_deref())?;
    doc["default_model"] = value(default_model);
    patch_kimi_access_service(
        doc,
        KIMI_CODING_PLAN_SEARCH_SERVICE_KEY,
        input.search_base_url.trim(),
        input
            .search_api_key_mode
            .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
        input.search_api_key.as_deref(),
        Some(provider_api_key),
    )?;
    patch_kimi_access_service(
        doc,
        KIMI_CODING_PLAN_FETCH_SERVICE_KEY,
        input.fetch_base_url.trim(),
        input
            .fetch_api_key_mode
            .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
        input.fetch_api_key.as_deref(),
        Some(provider_api_key),
    )?;
    remove_legacy_assistant_entries(doc);
    Ok(())
}

fn clear_managed_access_keys(doc: &mut DocumentMut, input: &KimiCodeAccessConfigInput) {
    if let Some(providers) = doc.get_mut("providers").and_then(Item::as_table_mut) {
        for provider_id in [
            KIMI_CODING_PLAN_PROVIDER_ID,
            LEGACY_KIMI_APP_PROVIDER_ID,
            LEGACY_KIMI_CODING_PLAN_PROVIDER_ID,
        ] {
            if let Some(provider) = providers.get_mut(provider_id).and_then(Item::as_table_mut) {
                let _ = provider.remove("api_key");
            }
        }
    }
    if let Some(services) = doc.get_mut("services").and_then(Item::as_table_mut) {
        for (service_key, mode) in [
            (
                KIMI_CODING_PLAN_SEARCH_SERVICE_KEY,
                input
                    .search_api_key_mode
                    .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
            ),
            (
                KIMI_CODING_PLAN_FETCH_SERVICE_KEY,
                input
                    .fetch_api_key_mode
                    .unwrap_or(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
            ),
        ] {
            if matches!(
                mode,
                KimiCodeAccessServiceApiKeyMode::ReuseProvider
                    | KimiCodeAccessServiceApiKeyMode::Clear
            ) {
                if let Some(service) = services.get_mut(service_key).and_then(Item::as_table_mut) {
                    let _ = service.remove("api_key");
                }
            }
        }
    }
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
        .ok_or_else(|| "providers.managed:kimi-code must be a table".to_string())?;

    provider["type"] = value("kimi");
    provider["base_url"] = value(base_url);
    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        provider["api_key"] = value(api_key);
    } else {
        let _ = provider.remove("api_key");
    }
    Ok(())
}

fn patch_kimi_access_models(
    doc: &mut DocumentMut,
    synced_models: &[KimiCodeAccessConfigModelView],
    requested_default: Option<&str>,
) -> Result<String, String> {
    if synced_models.is_empty() {
        return Err("Kimi API 未返回可用模型。".to_string());
    }
    let models = ensure_root_table_mut(doc, "models")?;
    let synced_ids = synced_models
        .iter()
        .map(|model| model.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let stale_ids = models
        .iter()
        .filter_map(|(id, item)| {
            let model = item.as_table()?;
            (id.starts_with(KIMI_CODING_PLAN_MODEL_PREFIX)
                && table_string(model, "provider").as_deref() == Some(KIMI_CODING_PLAN_PROVIDER_ID)
                && !synced_ids.contains(id))
            .then(|| id.to_string())
        })
        .collect::<Vec<_>>();
    for id in stale_ids {
        let _ = models.remove(&id);
    }

    for synced in synced_models {
        if models.get(&synced.id).and_then(Item::as_table).is_none() {
            models.insert(&synced.id, Item::Table(Table::new()));
        }
        let model = models
            .get_mut(&synced.id)
            .and_then(Item::as_table_mut)
            .ok_or_else(|| format!("models.{} must be a table", synced.id))?;
        model["provider"] = value(KIMI_CODING_PLAN_PROVIDER_ID);
        model["model"] = value(&synced.model);
        model["max_context_size"] = value(synced.max_context_size);
        set_string_array(model, "capabilities", &synced.capabilities);
        set_optional_string(model, "display_name", synced.display_name.as_deref());
        set_string_array(model, "support_efforts", &synced.support_efforts);
        set_optional_string(model, "default_effort", synced.default_effort.as_deref());
    }

    Ok(select_default_model(requested_default, synced_models))
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
    source: &KimiConfigSnapshot,
    kimi_path: Option<&Path>,
) -> Result<(), String> {
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create kimi config directory {}: {error}",
                parent.display()
            )
        })?;
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

        if let Some(kimi_path) = kimi_path {
            validate_kimi_config_candidate(kimi_path, &temp_path, doc)?;
        }
        ensure_config_fingerprint(config_path, &source.fingerprint)?;
        if let Some(raw) = source.raw.as_deref() {
            backup_kimi_config(config_path, raw)?;
        }
        for attempt in 0..KIMI_CONFIG_REPLACE_ATTEMPTS {
            ensure_config_fingerprint(config_path, &source.fingerprint)?;
            match fs::rename(&temp_path, config_path) {
                Ok(()) => return Ok(()),
                Err(error) if should_retry_config_replace(&error, attempt) => {
                    std::thread::sleep(Duration::from_millis(50 * (attempt as u64 + 1)));
                }
                Err(error) => {
                    return Err(format!(
                        "failed to replace config file {} from {}: {error}",
                        config_path.display(),
                        temp_path.display()
                    ))
                }
            }
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    write_result
}

fn validate_kimi_config_candidate(
    kimi_path: &Path,
    candidate_path: &Path,
    doc: &DocumentMut,
) -> Result<(), String> {
    let mut process = Command::new(kimi_path);
    command_utils::configure_kimi_query_command(&mut process);
    process
        .arg("doctor")
        .arg("config")
        .arg(candidate_path)
        .stdin(Stdio::null())
        .env("NO_COLOR", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1");
    if let Some(shell_path) = kimi_locator::locate_shell_path() {
        process.env("KIMI_SHELL_PATH", shell_path);
    }
    let output = process.output().map_err(|error| {
        format!(
            "failed to run `{} doctor config`: {error}",
            kimi_path.display()
        )
    })?;
    if output.status.success() {
        return Ok(());
    }

    let secrets = collect_kimi_code_access_secret_values_from_root(doc.as_table());
    let detail = [
        String::from_utf8_lossy(&output.stdout).as_ref(),
        String::from_utf8_lossy(&output.stderr).as_ref(),
    ]
    .into_iter()
    .map(str::trim)
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    let redacted = redact_secrets(&detail, &secrets);
    let limited = redacted.chars().take(2_000).collect::<String>();
    Err(format!(
        "Kimi doctor 拒绝候选配置（exit {}）：{}",
        output
            .status
            .code()
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        if limited.is_empty() {
            "未返回诊断详情".to_string()
        } else {
            limited
        }
    ))
}

fn should_retry_config_replace(error: &std::io::Error, attempt: usize) -> bool {
    #[cfg(windows)]
    {
        attempt + 1 < KIMI_CONFIG_REPLACE_ATTEMPTS
            && matches!(error.raw_os_error(), Some(5 | 32 | 33))
    }
    #[cfg(not(windows))]
    {
        let _ = (error, attempt);
        false
    }
}

fn backup_kimi_config(config_path: &Path, raw: &str) -> Result<(), String> {
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
    fs::write(&backup_path, raw).map_err(|error| {
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

async fn probe_models_endpoint(
    client: &reqwest::Client,
    raw_url: &str,
    api_key: Option<&str>,
    secrets: &[String],
) -> (
    KimiCodeAccessEndpointTestResult,
    Vec<KimiCodeAccessConfigModelView>,
) {
    let models_url = models_endpoint_url(raw_url);
    let parsed = match Url::parse(&models_url) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => url,
        Ok(url) => {
            return (
                failed_endpoint_result(
                    models_url,
                    None,
                    format!("unsupported URL scheme: {}", url.scheme()),
                ),
                Vec::new(),
            );
        }
        Err(error) => {
            return (
                failed_endpoint_result(models_url, None, format!("invalid URL: {error}")),
                Vec::new(),
            );
        }
    };

    let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) else {
        return (
            failed_endpoint_result(
                parsed.to_string(),
                None,
                "未找到 API Key，无法进行认证验证。".to_string(),
            ),
            Vec::new(),
        );
    };
    let mut request = client.get(parsed.as_str());
    request = request
        .bearer_auth(api_key)
        .header("Accept", "application/json");

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                return (
                    failed_endpoint_result(
                        parsed.to_string(),
                        Some(status.as_u16()),
                        format!("模型接口返回 HTTP {}", status.as_u16()),
                    ),
                    Vec::new(),
                );
            }
            match response.json::<serde_json::Value>().await {
                Ok(payload) => match parse_models_payload(&payload) {
                    Ok(models) => (
                        verified_endpoint_result(parsed.to_string(), status.as_u16()),
                        models,
                    ),
                    Err(error) => (
                        failed_endpoint_result(parsed.to_string(), Some(status.as_u16()), error),
                        Vec::new(),
                    ),
                },
                Err(error) => (
                    failed_endpoint_result(
                        parsed.to_string(),
                        Some(status.as_u16()),
                        format!(
                            "模型接口返回了无效 JSON：{}",
                            redact_secrets(&error.to_string(), secrets)
                        ),
                    ),
                    Vec::new(),
                ),
            }
        }
        Err(error) => (
            failed_endpoint_result(
                parsed.to_string(),
                None,
                redact_secrets(&error.to_string(), secrets),
            ),
            Vec::new(),
        ),
    }
}

fn fetch_models_blocking(
    base_url: &str,
    api_key: &str,
) -> Result<Vec<KimiCodeAccessConfigModelView>, String> {
    let url = models_endpoint_url(base_url);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("failed to build HTTP client: {error}"))?;
    let response = client
        .get(&url)
        .bearer_auth(api_key)
        .header("Accept", "application/json")
        .send()
        .map_err(|error| {
            format!(
                "Kimi 模型接口连接失败：{}",
                redact_secrets(&error.to_string(), &[api_key.to_string()])
            )
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Kimi 模型接口验证失败：HTTP {}", status.as_u16()));
    }
    let payload = response
        .json::<serde_json::Value>()
        .map_err(|error| format!("Kimi 模型接口返回了无效 JSON：{error}"))?;
    parse_models_payload(&payload)
}

fn models_endpoint_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim().trim_end_matches('/'))
}

fn parse_models_payload(
    payload: &serde_json::Value,
) -> Result<Vec<KimiCodeAccessConfigModelView>, String> {
    let items = payload
        .get("data")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "模型接口响应缺少 data 数组。".to_string())?;
    let mut models = Vec::new();
    for item in items {
        let Some(id) = item
            .get("id")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let context_length = item
            .get("context_length")
            .and_then(serde_json::Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or_else(|| {
                format!("Kimi Code model \"{id}\" must include a positive context_length.")
            })?;
        let supports_thinking_type = item
            .get("supports_thinking_type")
            .and_then(serde_json::Value::as_str);
        let mut capabilities = Vec::new();
        match supports_thinking_type {
            Some("only") => {
                capabilities.push("thinking".to_string());
                capabilities.push("always_thinking".to_string());
            }
            Some("both") => capabilities.push("thinking".to_string()),
            Some("no") => {}
            _ if item
                .get("supports_reasoning")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false) =>
            {
                capabilities.push("thinking".to_string())
            }
            _ => {}
        }
        for (field, capability) in [
            ("supports_image_in", "image_in"),
            ("supports_video_in", "video_in"),
        ] {
            if item
                .get(field)
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false)
            {
                capabilities.push(capability.to_string());
            }
        }
        if item
            .get("supports_tool_use")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(true)
        {
            capabilities.push("tool_use".to_string());
        }
        let think_efforts = item.get("think_efforts");
        let supports_efforts = think_efforts
            .and_then(|value| value.get("support"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        let support_efforts = if supports_efforts {
            json_string_array(think_efforts.and_then(|value| value.get("valid_efforts")))
        } else {
            Vec::new()
        };
        let default_effort = supports_efforts
            .then(|| {
                think_efforts
                    .and_then(|value| value.get("default_effort"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
            })
            .flatten();
        models.push(KimiCodeAccessConfigModelView {
            id: format!("{KIMI_CODING_PLAN_MODEL_PREFIX}{id}"),
            provider: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
            model: id.to_string(),
            max_context_size: context_length,
            exists: true,
            capabilities,
            display_name: item
                .get("display_name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string),
            support_efforts,
            default_effort,
        });
    }
    if models.is_empty() {
        return Err("Kimi API 未返回可用模型。".to_string());
    }
    Ok(models)
}

fn json_string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_string)
        .collect()
}

fn verified_endpoint_result(url: String, status_code: u16) -> KimiCodeAccessEndpointTestResult {
    KimiCodeAccessEndpointTestResult {
        url,
        reachable: true,
        status_code: Some(status_code),
        error: None,
        state: KimiCodeAccessTestState::Verified,
    }
}

fn failed_endpoint_result(
    url: String,
    status_code: Option<u16>,
    error: String,
) -> KimiCodeAccessEndpointTestResult {
    KimiCodeAccessEndpointTestResult {
        url,
        reachable: false,
        status_code,
        error: Some(error),
        state: KimiCodeAccessTestState::Failed,
    }
}

fn skipped_endpoint_result(url: &str, message: &str) -> KimiCodeAccessEndpointTestResult {
    KimiCodeAccessEndpointTestResult {
        url: url.trim().to_string(),
        reachable: false,
        status_code: None,
        error: Some(message.to_string()),
        state: KimiCodeAccessTestState::Skipped,
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
    let mut values = match parse_kimi_config_document(&raw, &config_path) {
        Ok(doc) => collect_kimi_code_access_secret_values_from_root(doc.as_table()),
        Err(_) => collect_kimi_code_access_secret_values_from_raw(&raw),
    };
    values.sort_by_key(|value| std::cmp::Reverse(value.len()));
    values.dedup();
    Ok(values)
}

fn collect_kimi_code_access_secret_values_from_raw(raw: &str) -> Vec<String> {
    raw.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            let value = trimmed.strip_prefix("api_key")?.trim_start();
            let value = value.strip_prefix('=')?.trim();
            Some(value.trim_matches(['"', '\'']).trim().to_string())
        })
        .filter(|value| !value.is_empty())
        .collect()
}

fn collect_kimi_code_access_secret_values_from_root(root: &Table) -> Vec<String> {
    let mut values = Vec::new();
    for provider_id in [
        KIMI_CODING_PLAN_PROVIDER_ID,
        LEGACY_KIMI_APP_PROVIDER_ID,
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
    if !doc.as_table().get(key).is_some_and(Item::is_table) {
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

fn provider_has_oauth(provider: &Table) -> bool {
    provider.get("oauth").is_some()
}

fn managed_provider_api_key(root: &Table) -> Option<String> {
    [
        KIMI_CODING_PLAN_PROVIDER_ID,
        LEGACY_KIMI_APP_PROVIDER_ID,
        LEGACY_KIMI_CODING_PLAN_PROVIDER_ID,
    ]
    .into_iter()
    .find_map(|id| provider_table(root, id).and_then(|table| table_string(table, "api_key")))
}

fn load_managed_provider_api_key() -> Result<Option<String>, String> {
    let path = resolve_kimi_config_path()?;
    let snapshot = read_kimi_config_snapshot(&path)?;
    let Some(raw) = snapshot.raw.as_deref() else {
        return Ok(None);
    };
    let doc = parse_kimi_config_document(raw, &path)?;
    Ok(managed_provider_api_key(doc.as_table()))
}

fn managed_model_views(root: &Table) -> Vec<KimiCodeAccessConfigModelView> {
    root.get("models")
        .and_then(Item::as_table)
        .into_iter()
        .flat_map(Table::iter)
        .filter_map(|(id, item)| {
            let model = item.as_table()?;
            (id.starts_with(KIMI_CODING_PLAN_MODEL_PREFIX)
                && table_string(model, "provider").as_deref() == Some(KIMI_CODING_PLAN_PROVIDER_ID))
            .then(|| KimiCodeAccessConfigModelView {
                id: id.to_string(),
                provider: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
                model: table_string(model, "model").unwrap_or_default(),
                max_context_size: table_i64(model, "max_context_size").unwrap_or_default(),
                exists: true,
                capabilities: table_string_array(model, "capabilities"),
                display_name: table_string(model, "display_name"),
                support_efforts: table_string_array(model, "support_efforts"),
                default_effort: table_string(model, "default_effort"),
            })
        })
        .collect()
}

fn selected_model_view(
    default_model: Option<&str>,
    models: &[KimiCodeAccessConfigModelView],
) -> KimiCodeAccessConfigModelView {
    models
        .iter()
        .find(|model| Some(model.id.as_str()) == default_model)
        .or_else(|| models.first())
        .cloned()
        .unwrap_or_else(|| KimiCodeAccessConfigModelView {
            id: KIMI_CODING_PLAN_MODEL_ID.to_string(),
            provider: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
            model: "k3".to_string(),
            max_context_size: 0,
            exists: false,
            capabilities: Vec::new(),
            display_name: None,
            support_efforts: Vec::new(),
            default_effort: None,
        })
}

fn select_default_model(
    requested_default: Option<&str>,
    models: &[KimiCodeAccessConfigModelView],
) -> String {
    requested_default
        .and_then(|requested| models.iter().find(|model| model.id == requested))
        .or_else(|| {
            models
                .iter()
                .find(|model| model.id == KIMI_CODING_PLAN_MODEL_ID)
        })
        .or_else(|| models.first())
        .map(|model| model.id.clone())
        .unwrap_or_else(|| KIMI_CODING_PLAN_MODEL_ID.to_string())
}

fn table_string_array(table: &Table, key: &str) -> Vec<String> {
    table
        .get(key)
        .and_then(Item::as_value)
        .and_then(toml_edit::Value::as_array)
        .into_iter()
        .flat_map(Array::iter)
        .filter_map(toml_edit::Value::as_str)
        .map(str::to_string)
        .collect()
}

fn set_string_array(table: &mut Table, key: &str, values: &[String]) {
    if values.is_empty() {
        let _ = table.remove(key);
        return;
    }
    let mut array = Array::new();
    for item in values {
        array.push(item.as_str());
    }
    table[key] = value(array);
}

fn set_optional_string(table: &mut Table, key: &str, value_to_set: Option<&str>) {
    if let Some(value_to_set) = value_to_set.filter(|value| !value.is_empty()) {
        table[key] = value(value_to_set);
    } else {
        let _ = table.remove(key);
    }
}

fn remove_legacy_assistant_entries(doc: &mut DocumentMut) {
    if let Some(models) = doc.get_mut("models").and_then(Item::as_table_mut) {
        for (id, provider_id) in [
            (LEGACY_KIMI_APP_MODEL_ID, LEGACY_KIMI_APP_PROVIDER_ID),
            (
                LEGACY_KIMI_CODING_PLAN_MODEL_ID,
                LEGACY_KIMI_CODING_PLAN_PROVIDER_ID,
            ),
        ] {
            let removable = models
                .get(id)
                .and_then(Item::as_table)
                .is_some_and(|model| {
                    table_string(model, "provider").as_deref() == Some(provider_id)
                        && table_string(model, "model").as_deref()
                            == Some(KIMI_CODING_PLAN_MODEL_NAME)
                        && model.iter().all(|(key, _)| {
                            matches!(key, "provider" | "model" | "max_context_size")
                        })
                });
            if removable {
                let _ = models.remove(id);
            }
        }
    }

    for provider_id in [
        LEGACY_KIMI_APP_PROVIDER_ID,
        LEGACY_KIMI_CODING_PLAN_PROVIDER_ID,
    ] {
        let referenced = doc
            .get("models")
            .and_then(Item::as_table)
            .into_iter()
            .flat_map(Table::iter)
            .filter_map(|(_, item)| item.as_table())
            .any(|model| table_string(model, "provider").as_deref() == Some(provider_id));
        if referenced {
            continue;
        }
        let removable = provider_table(doc.as_table(), provider_id).is_some_and(|provider| {
            table_string(provider, "type").as_deref() == Some("kimi")
                && (provider_id == LEGACY_KIMI_APP_PROVIDER_ID
                    || table_string(provider, "base_url").as_deref()
                        == Some(KIMI_CODING_PLAN_BASE_URL))
                && provider
                    .iter()
                    .all(|(key, _)| matches!(key, "type" | "base_url" | "api_key"))
        });
        if removable {
            if let Some(providers) = doc.get_mut("providers").and_then(Item::as_table_mut) {
                let _ = providers.remove(provider_id);
            }
        }
    }
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

    fn synced_model(id: &str, context: i64) -> KimiCodeAccessConfigModelView {
        KimiCodeAccessConfigModelView {
            id: format!("{KIMI_CODING_PLAN_MODEL_PREFIX}{id}"),
            provider: KIMI_CODING_PLAN_PROVIDER_ID.to_string(),
            model: id.to_string(),
            max_context_size: context,
            exists: true,
            capabilities: vec!["thinking".to_string(), "tool_use".to_string()],
            display_name: Some(id.to_uppercase()),
            support_efforts: vec!["max".to_string()],
            default_effort: Some("max".to_string()),
        }
    }

    #[test]
    fn access_config_patch_preserves_unrelated_tables_and_existing_keys() {
        let mut doc = r#"
default_model = "gpt-4.1"

[providers.openai]
type = "openai"
api_key = "sk-openai"

[providers."managed:kimi-code"]
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
                expected_config_fingerprint: None,
                provider_base_url: KIMI_CODING_PLAN_BASE_URL.to_string(),
                provider_api_key: None,
                clear_provider_api_key: Some(false),
                default_model: Some("kimi-code/k3".to_string()),
                search_base_url: KIMI_CODING_PLAN_SEARCH_URL.to_string(),
                search_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
                search_api_key: None,
                fetch_base_url: KIMI_CODING_PLAN_FETCH_URL.to_string(),
                fetch_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::Custom),
                fetch_api_key: Some("sk-fetch".to_string()),
                agent_swarm_max_concurrency: None,
                clear_agent_swarm_max_concurrency: Some(false),
            },
            &[synced_model("k3", 1_048_576)],
            "sk-existing",
        )
        .expect("apply access input");

        let root = doc.as_table();
        assert_eq!(
            table_string(root, "default_model").as_deref(),
            Some("kimi-code/k3")
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
        assert_eq!(table_string(model, "model").as_deref(), Some("k3"));
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
        let snapshot = read_kimi_config_snapshot(&config_path).expect("read source config");

        write_kimi_config_atomically_with_backup(&config_path, &doc, &snapshot, None)
            .expect("write config");

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
    fn access_config_fingerprint_tracks_exact_snapshot_and_missing_file() {
        let config_path = temp_config_path("access-config-fingerprint");
        let missing = read_kimi_config_snapshot(&config_path).expect("read missing config");
        assert!(missing.raw.is_none());
        assert_eq!(missing.fingerprint, "missing");

        fs::write(&config_path, "key = 1\n").expect("write first config");
        let first = read_kimi_config_snapshot(&config_path).expect("read first config");
        assert_eq!(first.fingerprint, config_fingerprint(Some("key = 1\n")));
        fs::write(&config_path, "key = 2\n").expect("write changed config");
        let second = read_kimi_config_snapshot(&config_path).expect("read changed config");
        assert_ne!(first.fingerprint, second.fingerprint);

        let _ = fs::remove_dir_all(config_path.parent().expect("temp parent"));
    }

    #[test]
    fn access_config_write_creates_a_missing_config() {
        let config_path = temp_config_path("access-config-create");
        let snapshot = read_kimi_config_snapshot(&config_path).expect("read missing config");
        let doc = "created = true\n"
            .parse::<DocumentMut>()
            .expect("new config");

        write_kimi_config_atomically_with_backup(&config_path, &doc, &snapshot, None)
            .expect("create config");
        assert_eq!(
            fs::read_to_string(&config_path).expect("read created config"),
            "created = true\n"
        );

        let _ = fs::remove_dir_all(config_path.parent().expect("temp parent"));
    }

    #[test]
    fn access_config_write_rejects_external_change_without_overwrite() {
        let config_path = temp_config_path("access-config-conflict");
        fs::write(&config_path, "key = 1\n").expect("seed config");
        let snapshot = read_kimi_config_snapshot(&config_path).expect("read source config");
        fs::write(&config_path, "external = true\n").expect("simulate external writer");
        let doc = "shell = true\n".parse::<DocumentMut>().expect("new config");

        let error = write_kimi_config_atomically_with_backup(&config_path, &doc, &snapshot, None)
            .expect_err("stale write must fail");
        assert!(error.starts_with("config_conflict:"));
        assert_eq!(
            fs::read_to_string(&config_path).expect("read retained external config"),
            "external = true\n"
        );
        assert!(fs::read_dir(config_path.parent().expect("temp parent"))
            .expect("list temp parent")
            .filter_map(Result::ok)
            .all(|entry| !entry.file_name().to_string_lossy().contains("kimi-app-tmp")));

        let _ = fs::remove_dir_all(config_path.parent().expect("temp parent"));
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

    #[test]
    fn raw_secret_collection_redacts_keys_when_config_is_damaged() {
        let values = collect_kimi_code_access_secret_values_from_raw(
            r#"
[providers."kimi-app-api-key"]
api_key = "sk-provider"
bad toml
[services.moonshot_search]
api_key = 'sk-search'
"#,
        );

        assert_eq!(
            values,
            vec!["sk-provider".to_string(), "sk-search".to_string()]
        );
    }

    #[test]
    fn models_payload_maps_current_kimi_metadata() {
        let payload = serde_json::json!({
            "data": [{
                "id": "k3",
                "context_length": 1048576,
                "display_name": "K3",
                "supports_thinking_type": "only",
                "supports_image_in": true,
                "supports_video_in": true,
                "supports_tool_use": true,
                "think_efforts": {
                    "support": true,
                    "valid_efforts": ["max"],
                    "default_effort": "max"
                }
            }]
        });

        let models = parse_models_payload(&payload).expect("models should parse");
        assert_eq!(models[0].id, "kimi-code/k3");
        assert_eq!(models[0].max_context_size, 1_048_576);
        assert_eq!(
            models[0].capabilities,
            vec![
                "thinking",
                "always_thinking",
                "image_in",
                "video_in",
                "tool_use"
            ]
        );
        assert_eq!(models[0].support_efforts, vec!["max"]);
        assert_eq!(models[0].default_effort.as_deref(), Some("max"));
    }

    #[test]
    fn models_payload_rejects_empty_and_invalid_context() {
        assert!(parse_models_payload(&serde_json::json!({"data": []})).is_err());
        assert!(parse_models_payload(&serde_json::json!({
            "data": [{"id": "k3", "context_length": 0}]
        }))
        .is_err());
    }

    #[test]
    fn canonical_patch_migrates_owned_legacy_entries_idempotently() {
        let mut doc = format!(
            r#"
default_model = "{LEGACY_KIMI_APP_MODEL_ID}"

[providers."{LEGACY_KIMI_APP_PROVIDER_ID}"]
type = "kimi"
base_url = "{KIMI_CODING_PLAN_BASE_URL}"
api_key = "sk-old"

[models."{LEGACY_KIMI_APP_MODEL_ID}"]
provider = "{LEGACY_KIMI_APP_PROVIDER_ID}"
model = "kimi-for-coding"
max_context_size = 262144

[unrelated]
keep = true
"#
        )
        .parse::<DocumentMut>()
        .expect("valid toml");
        let input = KimiCodeAccessConfigInput {
            provider_base_url: KIMI_CODING_PLAN_BASE_URL.to_string(),
            default_model: Some("kimi-code/k3".to_string()),
            search_base_url: KIMI_CODING_PLAN_SEARCH_URL.to_string(),
            search_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
            fetch_base_url: KIMI_CODING_PLAN_FETCH_URL.to_string(),
            fetch_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
            ..Default::default()
        };
        let models = vec![
            synced_model("k3", 1_048_576),
            synced_model("kimi-for-coding", 262_144),
        ];

        apply_kimi_code_access_input(&mut doc, &input, &models, "sk-new").expect("first patch");
        let first = doc.to_string();
        apply_kimi_code_access_input(&mut doc, &input, &models, "sk-new").expect("second patch");

        assert_eq!(doc.to_string(), first);
        assert!(provider_table(doc.as_table(), LEGACY_KIMI_APP_PROVIDER_ID).is_none());
        assert!(doc
            .get("models")
            .and_then(Item::as_table)
            .is_some_and(|models| models.get(LEGACY_KIMI_APP_MODEL_ID).is_none()));
        assert!(provider_table(doc.as_table(), KIMI_CODING_PLAN_PROVIDER_ID).is_some());
        assert_eq!(
            table_string(doc.as_table(), "default_model").as_deref(),
            Some("kimi-code/k3")
        );
        assert!(doc
            .get("unrelated")
            .and_then(Item::as_table)
            .is_some_and(|table| table.get("keep").is_some()));
    }

    #[test]
    fn migration_preserves_legacy_provider_with_remaining_reference() {
        let mut doc = format!(
            r#"
[providers."{LEGACY_KIMI_APP_PROVIDER_ID}"]
type = "kimi"
base_url = "{KIMI_CODING_PLAN_BASE_URL}"
api_key = "sk-old"

[models.custom]
provider = "{LEGACY_KIMI_APP_PROVIDER_ID}"
model = "custom"
max_context_size = 1
"#
        )
        .parse::<DocumentMut>()
        .expect("valid toml");

        remove_legacy_assistant_entries(&mut doc);

        assert!(provider_table(doc.as_table(), LEGACY_KIMI_APP_PROVIDER_ID).is_some());
    }

    #[test]
    fn clearing_provider_key_keeps_custom_service_key() {
        let mut doc = r#"
[providers."managed:kimi-code"]
type = "kimi"
api_key = "sk-provider"

[services.moonshot_search]
api_key = "sk-provider"

[services.moonshot_fetch]
api_key = "sk-custom"
"#
        .parse::<DocumentMut>()
        .expect("valid toml");
        let input = KimiCodeAccessConfigInput {
            clear_provider_api_key: Some(true),
            search_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::ReuseProvider),
            fetch_api_key_mode: Some(KimiCodeAccessServiceApiKeyMode::KeepExisting),
            ..Default::default()
        };

        clear_managed_access_keys(&mut doc, &input);

        assert!(provider_table(doc.as_table(), KIMI_CODING_PLAN_PROVIDER_ID)
            .and_then(|provider| table_string(provider, "api_key"))
            .is_none());
        assert!(
            service_table(doc.as_table(), KIMI_CODING_PLAN_SEARCH_SERVICE_KEY)
                .and_then(|service| table_string(service, "api_key"))
                .is_none()
        );
        assert_eq!(
            service_table(doc.as_table(), KIMI_CODING_PLAN_FETCH_SERVICE_KEY)
                .and_then(|service| table_string(service, "api_key"))
                .as_deref(),
            Some("sk-custom")
        );
    }

    #[test]
    fn oauth_provider_is_detected_before_api_key_save() {
        let doc = r#"
[providers."managed:kimi-code"]
type = "kimi"
base_url = "https://api.kimi.com/coding/v1"
oauth = { key = "oauth/kimi-code" }
"#
        .parse::<DocumentMut>()
        .expect("valid toml");

        assert!(provider_table(doc.as_table(), KIMI_CODING_PLAN_PROVIDER_ID)
            .is_some_and(provider_has_oauth));
    }

    #[test]
    fn default_model_prefers_requested_then_k3_then_first() {
        let models = vec![
            synced_model("kimi-for-coding", 262_144),
            synced_model("k3", 1_048_576),
        ];
        assert_eq!(
            select_default_model(Some("kimi-code/kimi-for-coding"), &models),
            "kimi-code/kimi-for-coding"
        );
        assert_eq!(
            select_default_model(Some("kimi-code/missing"), &models),
            "kimi-code/k3"
        );
        assert_eq!(
            select_default_model(None, &models[..1]),
            "kimi-code/kimi-for-coding"
        );
    }

    #[test]
    fn blocking_model_probe_rejects_http_errors() {
        for status in [401, 404, 500] {
            let server = Server::http("127.0.0.1:0").expect("server should bind");
            let base_url = format!("http://{}", server.server_addr());
            let responder = thread::spawn(move || {
                let request = server.recv().expect("request should arrive");
                assert_eq!(request.url(), "/models");
                request
                    .respond(Response::empty(StatusCode(status)))
                    .expect("response should send");
            });

            let error = fetch_models_blocking(&base_url, "sk-test")
                .expect_err("HTTP error must not pass validation");

            responder.join().expect("responder should finish");
            assert!(error.contains(&format!("HTTP {status}")));
            assert!(!error.contains("sk-test"));
        }
    }

    #[test]
    fn blocking_model_probe_rejects_invalid_json() {
        let server = Server::http("127.0.0.1:0").expect("server should bind");
        let base_url = format!("http://{}", server.server_addr());
        let responder = thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            request
                .respond(Response::from_string("not-json").with_status_code(StatusCode(200)))
                .expect("response should send");
        });

        let error =
            fetch_models_blocking(&base_url, "sk-test").expect_err("invalid JSON must fail");

        responder.join().expect("responder should finish");
        assert!(error.contains("无效 JSON"));
    }
}
