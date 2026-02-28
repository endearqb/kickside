use std::path::PathBuf;

use crate::types::AppSettings;

pub fn locate(settings: &AppSettings) -> Result<PathBuf, String> {
    if let Some(configured) = settings
        .kimi_path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(configured);
        if path.exists() {
            return Ok(path);
        }
        return Err(format!(
            "Configured kimi path does not exist: {}",
            path.display()
        ));
    }

    which::which("kimi").map_err(|_| {
        "Could not find `kimi` in PATH. Install Kimi CLI or configure the executable path."
            .to_string()
    })
}
