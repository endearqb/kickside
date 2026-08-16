use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
};

const KIMI_CODE_HOME_ENV: &str = "KIMI_CODE_HOME";
const SERVER_TOKEN_FILE_NAME: &str = "server.token";
const KIMI_ONBOARDED_QUERY: &str = "kimi_onboarded=1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerToken {
    pub path: PathBuf,
    pub value: String,
    pub redacted: String,
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
    let workspace_root = format!("{origin}/?{KIMI_ONBOARDED_QUERY}");
    match token.map(str::trim).filter(|value| !value.is_empty()) {
        Some(token) => {
            let encoded = percent_encode_fragment_value(token);
            format!("{workspace_root}#token={encoded}")
        }
        None => workspace_root,
    }
}

pub(crate) fn percent_encode_fragment_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
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
        assert_eq!(
            url,
            "http://127.0.0.1:55000/?kimi_onboarded=1#token=tok%20en%2F%23"
        );
    }

    #[test]
    fn workspace_url_skips_repeated_kimi_web_onboarding_without_a_token() {
        let url = build_workspace_url("http://127.0.0.1:55000/", None);
        assert_eq!(url, "http://127.0.0.1:55000/?kimi_onboarded=1");
    }

    #[test]
    fn redact_token_keeps_only_small_edges() {
        assert_eq!(redact_token("short"), "***");
        assert_eq!(redact_token("abcdefghi"), "abcd***ghi");
    }
}
