use std::env;

use crate::token_resolver;

const REDACTED: &str = "[REDACTED]";

#[derive(Clone)]
pub(crate) struct SecretRedactor {
    secrets: Vec<String>,
}

impl SecretRedactor {
    pub(crate) fn from_system() -> Self {
        let mut secrets = super::collect_kimi_code_access_secret_values().unwrap_or_default();
        secrets.extend(env::vars().filter_map(|(name, value)| {
            (value.len() >= 4 && is_sensitive_env_name(&name)).then_some(value)
        }));
        if let Ok(path) = token_resolver::server_token_path() {
            if let Ok(token) = token_resolver::read_server_token_at(&path) {
                secrets.push(token.value);
            }
        }

        let mut encoded = secrets
            .iter()
            .flat_map(|secret| {
                let upper = token_resolver::percent_encode_fragment_value(secret);
                let lower = lowercase_percent_hex(&upper);
                [upper, lower]
            })
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();
        secrets.append(&mut encoded);
        secrets.retain(|value| !value.is_empty());
        secrets.sort_by_key(|value| std::cmp::Reverse(value.len()));
        secrets.dedup();
        Self { secrets }
    }

    #[cfg(test)]
    fn new(secrets: Vec<String>) -> Self {
        Self { secrets }
    }

    pub(crate) fn redact(&self, input: &str) -> String {
        let mut output = input.to_string();
        for secret in &self.secrets {
            output = output.replace(secret, REDACTED);
        }
        for marker in ["authorization: bearer ", "#token=", "token:"] {
            output = redact_marker_values(output, marker);
        }
        output
    }
}

pub(crate) fn redact_backend_text(input: &str) -> String {
    SecretRedactor::from_system().redact(input)
}

fn is_sensitive_env_name(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    ["TOKEN", "API_KEY", "SECRET", "PASSWORD", "KEY"]
        .iter()
        .any(|suffix| name == *suffix || name.ends_with(&format!("_{suffix}")))
}

fn lowercase_percent_hex(input: &str) -> String {
    let mut bytes = input.as_bytes().to_vec();
    let mut index = 0;
    while index + 2 < bytes.len() {
        if bytes[index] == b'%' {
            bytes[index + 1].make_ascii_lowercase();
            bytes[index + 2].make_ascii_lowercase();
            index += 3;
        } else {
            index += 1;
        }
    }
    String::from_utf8(bytes).expect("percent encoding preserves UTF-8")
}

fn redact_marker_values(mut input: String, marker: &str) -> String {
    let mut search_from = 0;
    loop {
        let lower = input.to_ascii_lowercase();
        let Some(relative_start) = lower[search_from..].find(marker) else {
            return input;
        };
        let value_start = search_from + relative_start + marker.len();
        let value_start = value_start
            + input[value_start..]
                .bytes()
                .take_while(u8::is_ascii_whitespace)
                .count();
        let value_len = input[value_start..]
            .bytes()
            .take_while(|byte| {
                !byte.is_ascii_whitespace() && !matches!(byte, b'&' | b'\"' | b'\'' | b'<' | b'>')
            })
            .count();
        if value_len == 0 {
            search_from = value_start;
            if search_from >= input.len() {
                return input;
            }
            continue;
        }
        input.replace_range(value_start..value_start + value_len, REDACTED);
        search_from = value_start + REDACTED.len();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_known_encoded_and_structured_secrets() {
        let redactor =
            SecretRedactor::new(vec!["api secret".to_string(), "api%20secret".to_string()]);
        let output = redactor.redact(
            "Token: generated-token\nurl=/#token=url-token&x=1\nAuthorization: Bearer bearer-token\napi secret api%20secret",
        );

        for secret in [
            "generated-token",
            "url-token",
            "bearer-token",
            "api secret",
            "api%20secret",
        ] {
            assert!(!output.contains(secret));
        }
        assert!(output.contains("Token: [REDACTED]"));
        assert!(output.contains("/#token=[REDACTED]&x=1"));
        assert_eq!(lowercase_percent_hex("Ab%2F%3D"), "Ab%2f%3d");
        assert!(is_sensitive_env_name("KIMI_CODE_PASSWORD"));
        assert!(is_sensitive_env_name("OPENAI_API_KEY"));
        assert!(!is_sensitive_env_name("KIMI_SHELL_PATH"));
    }
}
