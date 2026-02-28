use std::{path::Path, process::Command};

const REQUIRED_WEB_FLAGS: [&str; 3] = ["--no-open", "--host", "--port"];

pub fn verify_kimi_web_contract(kimi_path: &Path) -> Result<(), String> {
    let output = Command::new(kimi_path)
        .arg("web")
        .arg("--help")
        .output()
        .map_err(|error| {
            format!(
                "failed to run `{} web --help`: {}",
                kimi_path.display(),
                error
            )
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let merged = format!("{stdout}\n{stderr}").to_lowercase();
    let missing = missing_required_flags(&merged);

    if missing.is_empty() {
        return Ok(());
    }

    let status = output
        .status
        .code()
        .map(|code| code.to_string())
        .unwrap_or_else(|| "terminated".to_string());
    Err(format!(
        "incompatible `kimi web` help output (status {status}), missing flags: {}",
        missing.join(", ")
    ))
}

fn missing_required_flags(help_text_lowercase: &str) -> Vec<&'static str> {
    REQUIRED_WEB_FLAGS
        .iter()
        .copied()
        .filter(|flag| !help_text_lowercase.contains(flag))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn required_flags_parser_detects_all_flags_present() {
        let help = "usage: kimi web [--no-open] [--host 127.0.0.1] [--port 5494]";
        let missing = missing_required_flags(&help.to_lowercase());
        assert!(missing.is_empty());
    }

    #[test]
    fn required_flags_parser_detects_missing_flags() {
        let help = "usage: kimi web [--host 127.0.0.1]";
        let missing = missing_required_flags(&help.to_lowercase());
        assert_eq!(missing, vec!["--no-open", "--port"]);
    }
}
