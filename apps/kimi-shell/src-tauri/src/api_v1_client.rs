use std::time::Duration;

use anyhow::{bail, Context};
use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct ApiV1Client {
    origin: String,
    bearer_token: String,
    client: Client,
}

#[derive(Debug, Deserialize)]
#[serde(bound(deserialize = "T: Deserialize<'de>"))]
struct ApiEnvelope<T> {
    code: i64,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    data: Option<T>,
    #[serde(default)]
    request_id: Option<String>,
}

impl ApiV1Client {
    pub fn new(origin: impl Into<String>, bearer_token: impl Into<String>) -> anyhow::Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(12))
            .build()
            .context("failed to build kimi-code api client")?;
        Ok(Self {
            origin: origin.into().trim_end_matches('/').to_string(),
            bearer_token: bearer_token.into(),
            client,
        })
    }

    pub fn get<T>(&self, path: &str) -> anyhow::Result<T>
    where
        T: DeserializeOwned,
    {
        self.request(reqwest::Method::GET, path)?
            .send()
            .context("failed to send kimi-code GET request")
            .and_then(decode_envelope)
    }

    pub fn post<B, T>(&self, path: &str, body: &B) -> anyhow::Result<T>
    where
        B: Serialize + ?Sized,
        T: DeserializeOwned,
    {
        self.request(reqwest::Method::POST, path)?
            .json(body)
            .send()
            .context("failed to send kimi-code POST request")
            .and_then(decode_envelope)
    }

    pub fn post_empty<B>(&self, path: &str, body: &B) -> anyhow::Result<()>
    where
        B: Serialize + ?Sized,
    {
        self.request(reqwest::Method::POST, path)?
            .json(body)
            .send()
            .context("failed to send kimi-code POST request")
            .and_then(decode_envelope_empty)
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> anyhow::Result<reqwest::blocking::RequestBuilder> {
        Ok(self
            .client
            .request(
                method,
                format!("{}{}", self.origin, normalize_api_v1_path(path)),
            )
            .bearer_auth(&self.bearer_token)
            .header(reqwest::header::ACCEPT, "application/json"))
    }
}

fn normalize_api_v1_path(path: &str) -> String {
    let path = path.trim();
    if path.starts_with("/api/v1/") || path == "/api/v1" {
        path.to_string()
    } else if path.starts_with('/') {
        format!("/api/v1{path}")
    } else {
        format!("/api/v1/{path}")
    }
}

fn decode_envelope<T>(response: reqwest::blocking::Response) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    let status = response.status();
    let body = response
        .text()
        .context("failed to read kimi-code response body")?;
    decode_envelope_body(status.as_u16(), &body)
}

fn decode_envelope_empty(response: reqwest::blocking::Response) -> anyhow::Result<()> {
    let status = response.status();
    let body = response
        .text()
        .context("failed to read kimi-code response body")?;
    decode_envelope_empty_body(status.as_u16(), &body)
}

fn decode_envelope_body<T>(status: u16, body: &str) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    let envelope = decode_envelope_status::<T>(status, body)?;
    envelope
        .data
        .ok_or_else(|| anyhow::anyhow!("kimi-code API envelope missing data"))
}

fn decode_envelope_empty_body(status: u16, body: &str) -> anyhow::Result<()> {
    let _ = decode_envelope_status::<serde_json::Value>(status, body)?;
    Ok(())
}

fn decode_envelope_status<T>(status: u16, body: &str) -> anyhow::Result<ApiEnvelope<T>>
where
    T: DeserializeOwned,
{
    if !(200..300).contains(&status) {
        bail!(
            "kimi-code API returned HTTP {status}: {}",
            truncate_for_error(&body, 240)
        );
    }

    let envelope: ApiEnvelope<T> = serde_json::from_str(body).with_context(|| {
        format!(
            "failed to decode kimi-code API envelope: {}",
            truncate_for_error(body, 240)
        )
    })?;
    if envelope.code != 0 {
        let request_id = envelope
            .request_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!(" request_id={value}"))
            .unwrap_or_default();
        bail!(
            "kimi-code API returned code={}{}: {}",
            envelope.code,
            request_id,
            envelope.msg.unwrap_or_else(|| "unknown error".to_string())
        );
    }

    Ok(envelope)
}

fn truncate_for_error(value: &str, max_chars: usize) -> String {
    let mut result = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        result.push_str("...");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    struct Payload {
        session_id: String,
    }

    #[test]
    fn normalize_paths_under_api_v1() {
        assert_eq!(normalize_api_v1_path("sessions"), "/api/v1/sessions");
        assert_eq!(normalize_api_v1_path("/sessions"), "/api/v1/sessions");
        assert_eq!(
            normalize_api_v1_path("/api/v1/sessions"),
            "/api/v1/sessions"
        );
    }

    #[test]
    fn decode_success_envelope() {
        let payload = decode_envelope_body::<Payload>(
            200,
            r#"{"code":0,"msg":"ok","data":{"session_id":"s1"},"request_id":"r1"}"#,
        )
        .expect("payload");
        assert_eq!(
            payload,
            Payload {
                session_id: "s1".to_string()
            }
        );
    }

    #[test]
    fn decode_error_envelope_includes_request_id() {
        let error = decode_envelope_body::<Payload>(
            200,
            r#"{"code":40101,"msg":"unauthorized","request_id":"r1"}"#,
        )
        .expect_err("error");
        let message = error.to_string();
        assert!(message.contains("40101"));
        assert!(message.contains("request_id=r1"));
        assert!(message.contains("unauthorized"));
    }

    #[test]
    fn decode_empty_success_envelope_allows_missing_data() {
        decode_envelope_empty_body(200, r#"{"code":0,"msg":"ok","request_id":"r1"}"#)
            .expect("empty response");
    }
}
