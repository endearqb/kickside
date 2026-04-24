use super::config::resolve_kimi_config_dir;
use super::*;

pub fn open_logs_folder(app: &AppHandle) -> Result<(), String> {
    let logs_dir = log_manager::ensure_logs_dir(app).map_err(|error| error.to_string())?;
    open_with_system_file_manager(&logs_dir).map_err(|error| error.to_string())
}

pub fn open_external_url(app: &AppHandle, url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("url cannot be empty".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|error| format!("invalid url: {error}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("unsupported url scheme: {scheme}"));
    }

    log_manager::append_line(
        app,
        format!("external-link bridge open url={}", parsed.as_str()),
    );
    open_with_system_browser(parsed.as_str()).map_err(|error| error.to_string())
}

pub fn open_folder(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path cannot be empty".to_string());
    }

    let folder = PathBuf::from(trimmed);
    if !folder.exists() {
        return Err(format!("folder does not exist: {}", folder.display()));
    }
    if !folder.is_dir() {
        return Err(format!("path is not a folder: {}", folder.display()));
    }

    open_with_system_file_manager(&folder).map_err(|error| error.to_string())
}

pub fn open_kimi_config_dir() -> Result<(), String> {
    let config_dir = resolve_kimi_config_dir()?;
    fs::create_dir_all(&config_dir).map_err(|error| {
        format!(
            "failed to create kimi config directory {}: {error}",
            config_dir.display()
        )
    })?;
    open_with_system_file_manager(&config_dir).map_err(|error| error.to_string())
}

fn open_with_system_file_manager(path: &Path) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(path)
            .spawn()
            .context("failed to open folder with explorer")?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .context("failed to open folder with open")?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .context("failed to open folder with xdg-open")?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!("unsupported platform for opening folder"))
}

fn open_with_system_browser(url: &str) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(url)
            .spawn()
            .context("failed to open url with explorer")?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .context("failed to open url with open")?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .context("failed to open url with xdg-open")?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(anyhow::anyhow!(
        "unsupported platform for opening external url"
    ))
}
