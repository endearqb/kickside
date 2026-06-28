use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

const KIMI_CODE_HOME_ENV: &str = "KIMI_CODE_HOME";
const SERVER_TOKEN_FILE_NAME: &str = "server.token";
const TOKEN_READ_TIMEOUT: Duration = Duration::from_secs(5);
const TOKEN_READ_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerToken {
    pub path: PathBuf,
    pub value: String,
    pub redacted: String,
}

pub fn resolve_server_token_with_retry() -> anyhow::Result<ServerToken> {
    let path = server_token_path()?;
    let deadline = Instant::now() + TOKEN_READ_TIMEOUT;
    loop {
        match read_server_token(&path) {
            Ok(token) => return Ok(token),
            Err(error) if Instant::now() < deadline => {
                let last_error = error;
                thread::sleep(TOKEN_READ_INTERVAL);
                if Instant::now() >= deadline {
                    return Err(last_error);
                }
            }
            Err(error) => return Err(error),
        }
    }
}

pub fn server_token_path() -> anyhow::Result<PathBuf> {
    Ok(resolve_kimi_code_home()?.join(SERVER_TOKEN_FILE_NAME))
}

pub fn read_server_token_at(path: &Path) -> anyhow::Result<ServerToken> {
    let value = fs::read_to_string(path)
        .map(|raw| raw.trim().to_string())
        .map_err(|error| anyhow::anyhow!("failed to read kimi-code server token: {error}"))?;
    if value.is_empty() {
        anyhow::bail!("kimi-code server token file is empty: {}", path.display());
    }
    Ok(ServerToken {
        path: path.to_path_buf(),
        redacted: redact_token(&value),
        value,
    })
}

fn read_server_token(path: &Path) -> anyhow::Result<ServerToken> {
    read_server_token_at(path)
}

pub fn resolve_kimi_code_home() -> anyhow::Result<PathBuf> {
    resolve_kimi_code_home_with(|name| env::var_os(name))
}

fn resolve_kimi_code_home_with(
    get_env: impl Fn(&str) -> Option<OsString>,
) -> anyhow::Result<PathBuf> {
    if let Some(path) = get_env(KIMI_CODE_HOME_ENV).map(PathBuf::from) {
        return Ok(path);
    }

    if let Some(home) = get_env("USERPROFILE").or_else(|| get_env("HOME")) {
        return Ok(PathBuf::from(home).join(".kimi-code"));
    }

    anyhow::bail!("{KIMI_CODE_HOME_ENV} is not set and the user home directory is unavailable")
}

pub fn build_workspace_url(origin: &str, token: Option<&str>) -> String {
    let origin = origin.trim_end_matches('/');
    match token.map(str::trim).filter(|value| !value.is_empty()) {
        Some(token) => {
            let encoded =
                url::form_urlencoded::byte_serialize(token.as_bytes()).collect::<String>();
            format!("{origin}/#token={encoded}")
        }
        None => origin.to_string(),
    }
}

pub fn redact_token(token: &str) -> String {
    let token = token.trim();
    if token.is_empty() {
        return "<empty>".to_string();
    }
    let chars = token.chars().collect::<Vec<_>>();
    if chars.len() <= 8 {
        return "***".to_string();
    }
    format!(
        "{}***{}",
        chars.iter().take(4).collect::<String>(),
        chars
            .iter()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<String>()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_home_prefers_kimi_code_home() {
        let home = resolve_kimi_code_home_with(|name| {
            if name == KIMI_CODE_HOME_ENV {
                Some(OsString::from("D:/kimi-code-home"))
            } else {
                None
            }
        })
        .expect("home");

        assert_eq!(home, PathBuf::from("D:/kimi-code-home"));
    }

    #[test]
    fn resolve_home_defaults_to_user_profile_kimi_code() {
        let home = resolve_kimi_code_home_with(|name| {
            if name == "USERPROFILE" {
                Some(OsString::from("C:/Users/example"))
            } else {
                None
            }
        })
        .expect("home");

        assert_eq!(home, PathBuf::from("C:/Users/example").join(".kimi-code"));
    }

    #[test]
    fn workspace_url_includes_encoded_token_fragment() {
        let url = build_workspace_url("http://127.0.0.1:55000/", Some("tok en/#"));
        assert_eq!(url, "http://127.0.0.1:55000/#token=tok+en%2F%23");
    }

    #[test]
    fn redact_token_keeps_only_small_edges() {
        assert_eq!(redact_token("short"), "***");
        assert_eq!(redact_token("abcdefghi"), "abcd***ghi");
    }
}
