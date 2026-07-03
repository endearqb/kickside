use std::{error::Error as _, time::Duration};

#[cfg(windows)]
use std::process::Command;

use anyhow::{anyhow, bail, Context};
use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tauri::AppHandle;

use crate::{command_utils, log_manager};

const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 10;
const DEFAULT_RESPONSE_SNIPPET_LIMIT: usize = 240;
const ONBOARDING_HTTP_USER_AGENT: &str = "KimiDesktopShell/0.0.33 (onboarding-http)";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpRequestMethod {
    Get,
    PostForm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpResponseSource {
    Reqwest,
    WindowsNative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportFailureKind {
    Timeout,
    Connect,
    Dns,
    Tls,
    ConnectionReset,
    UnexpectedEof,
    Network,
    Unknown,
}

#[derive(Debug, Clone)]
struct TransportFailure {
    kind: TransportFailureKind,
    message: String,
}

#[derive(Debug, Clone)]
struct HttpRequestSpec {
    service: &'static str,
    operation: &'static str,
    method: HttpRequestMethod,
    url: String,
    headers: Vec<(String, String)>,
    form_body: Option<String>,
    timeout: Duration,
}

#[derive(Debug, Clone)]
struct RawHttpResponse {
    source: HttpResponseSource,
    status: u16,
    body: String,
}

#[cfg(windows)]
#[derive(Debug, Serialize)]
struct PowerShellHeaderItem<'a> {
    name: &'a str,
    value: &'a str,
}

#[cfg(windows)]
#[derive(Debug, Deserialize)]
struct PowerShellResponse {
    status: Option<u16>,
    body: Option<String>,
    error: Option<String>,
}

pub fn get_json<T>(
    app: Option<&AppHandle>,
    service: &'static str,
    operation: &'static str,
    url: String,
    headers: Vec<(String, String)>,
    timeout: Duration,
) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    let response = execute_request(
        app,
        HttpRequestSpec {
            service,
            operation,
            method: HttpRequestMethod::Get,
            url,
            headers,
            form_body: None,
            timeout,
        },
    )?;
    parse_json_response(service, operation, response)
}

pub fn post_form_json<T>(
    app: Option<&AppHandle>,
    service: &'static str,
    operation: &'static str,
    url: String,
    headers: Vec<(String, String)>,
    form_pairs: Vec<(String, String)>,
    timeout: Duration,
) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    let form_body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(
            form_pairs
                .iter()
                .map(|(key, value)| (key.as_str(), value.as_str())),
        )
        .finish();
    let response = execute_request(
        app,
        HttpRequestSpec {
            service,
            operation,
            method: HttpRequestMethod::PostForm,
            url,
            headers,
            form_body: Some(form_body),
            timeout,
        },
    )?;
    parse_json_response(service, operation, response)
}

fn execute_request(
    app: Option<&AppHandle>,
    request: HttpRequestSpec,
) -> anyhow::Result<RawHttpResponse> {
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(DEFAULT_CONNECT_TIMEOUT_SECS))
        .timeout(request.timeout)
        .user_agent(ONBOARDING_HTTP_USER_AGENT)
        .build()
        .with_context(|| {
            format!(
                "failed to build {} onboarding http client for {}",
                request.service, request.operation
            )
        })?;

    match send_via_reqwest(&client, &request) {
        Ok(response) => {
            log_onboarding(
                app,
                format!(
                    "onboarding http success service={} operation={} source=reqwest status={} url={}",
                    request.service, request.operation, response.status, request.url
                ),
            );
            Ok(response)
        }
        Err(failure) => {
            log_onboarding(
                app,
                format!(
                    "onboarding http transport failure service={} operation={} kind={} message={} url={}",
                    request.service,
                    request.operation,
                    transport_failure_label(failure.kind),
                    failure.message,
                    request.url
                ),
            );
            #[cfg(windows)]
            {
                if should_try_windows_native_fallback(&failure) {
                    return match send_via_windows_native(&request) {
                        Ok(response) => {
                            log_onboarding(
                                app,
                                format!(
                                    "onboarding http fallback success service={} operation={} source=windows_native status={} url={}",
                                    request.service, request.operation, response.status, request.url
                                ),
                            );
                            Ok(response)
                        }
                        Err(fallback_error) => {
                            log_onboarding(
                                app,
                                format!(
                                    "onboarding http fallback failure service={} operation={} url={} err={}",
                                    request.service, request.operation, request.url, fallback_error
                                ),
                            );
                            Err(anyhow!(
                                "{} {} request failed via reqwest ({}) and windows native fallback ({})",
                                request.service,
                                request.operation,
                                failure.message,
                                fallback_error
                            ))
                        }
                    };
                }
            }
            Err(anyhow!(
                "{} {} request failed: {}",
                request.service,
                request.operation,
                failure.message
            ))
        }
    }
}

fn send_via_reqwest(
    client: &Client,
    request: &HttpRequestSpec,
) -> Result<RawHttpResponse, TransportFailure> {
    let mut builder = match request.method {
        HttpRequestMethod::Get => client.get(&request.url),
        HttpRequestMethod::PostForm => client
            .post(&request.url)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(request.form_body.clone().unwrap_or_default()),
    };
    for (name, value) in &request.headers {
        builder = builder.header(name, value);
    }
    let response = builder
        .send()
        .map_err(|error| classify_reqwest_transport_failure(&error))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .map_err(|error| classify_reqwest_transport_failure(&error))?;
    Ok(RawHttpResponse {
        source: HttpResponseSource::Reqwest,
        status,
        body,
    })
}

fn parse_json_response<T>(
    service: &'static str,
    operation: &'static str,
    response: RawHttpResponse,
) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    if !(200..=299).contains(&response.status) {
        bail!(
            "{} {} request failed (status={}, source={}): {}",
            service,
            operation,
            response.status,
            response_source_label(response.source),
            summarize_body(response.body.as_str())
        );
    }
    serde_json::from_str::<T>(&response.body).with_context(|| {
        format!(
            "failed to parse {} {} response (status={}, source={}): {}",
            service,
            operation,
            response.status,
            response_source_label(response.source),
            summarize_body(response.body.as_str())
        )
    })
}

fn classify_reqwest_transport_failure(error: &reqwest::Error) -> TransportFailure {
    let mut message = error.to_string();
    for cause in error.source().into_iter().flat_map(source_chain) {
        if !cause.is_empty() {
            message.push_str(" | ");
            message.push_str(cause.as_str());
        }
    }
    let lower = message.to_ascii_lowercase();
    let kind = if error.is_timeout() || lower.contains("timed out") {
        TransportFailureKind::Timeout
    } else if (error.is_connect()
        && (lower.contains("dns") || lower.contains("name or service not known")))
        || lower.contains("dns")
        || lower.contains("no such host")
    {
        TransportFailureKind::Dns
    } else if lower.contains("tls") || lower.contains("certificate") || lower.contains("handshake")
    {
        TransportFailureKind::Tls
    } else if lower.contains("connection reset") || lower.contains("forcibly closed") {
        TransportFailureKind::ConnectionReset
    } else if lower.contains("unexpected eof") || lower.contains("eof") {
        TransportFailureKind::UnexpectedEof
    } else if error.is_connect() {
        TransportFailureKind::Connect
    } else if lower.contains("network") || lower.contains("connection aborted") {
        TransportFailureKind::Network
    } else {
        TransportFailureKind::Unknown
    };
    TransportFailure { kind, message }
}

fn source_chain<'a>(source: &'a (dyn std::error::Error + 'static)) -> Vec<String> {
    let mut chain = Vec::new();
    let mut current = Some(source);
    while let Some(item) = current {
        chain.push(item.to_string());
        current = item.source();
    }
    chain
}

#[cfg(windows)]
fn send_via_windows_native(request: &HttpRequestSpec) -> anyhow::Result<RawHttpResponse> {
    let header_items = request
        .headers
        .iter()
        .map(|(name, value)| PowerShellHeaderItem {
            name: name.as_str(),
            value: value.as_str(),
        })
        .chain(std::iter::once(PowerShellHeaderItem {
            name: "User-Agent",
            value: ONBOARDING_HTTP_USER_AGENT,
        }))
        .collect::<Vec<_>>();
    let headers_json =
        serde_json::to_string(&header_items).context("failed to serialize onboarding headers")?;
    let script = r#"
$ErrorActionPreference = 'Stop'
function Read-ResponseBody($response) {
  if ($null -eq $response) { return '' }
  if ($response.Content -is [byte[]]) {
    return [System.Text.Encoding]::UTF8.GetString($response.Content)
  }
  return [string]$response.Content
}
try {
  $headers = @{}
  if ($env:KIMI_ONBOARDING_HEADERS_JSON) {
    $headerItems = $env:KIMI_ONBOARDING_HEADERS_JSON | ConvertFrom-Json
    foreach ($item in $headerItems) {
      $headers[[string]$item.name] = [string]$item.value
    }
  }
  $invokeArgs = @{
    Uri = $env:KIMI_ONBOARDING_URL
    Method = $env:KIMI_ONBOARDING_METHOD
    Headers = $headers
    TimeoutSec = [int]$env:KIMI_ONBOARDING_TIMEOUT_SEC
    UseBasicParsing = $true
    ErrorAction = 'Stop'
  }
  if ($env:KIMI_ONBOARDING_METHOD -eq 'POST') {
    $invokeArgs['ContentType'] = 'application/x-www-form-urlencoded'
    $invokeArgs['Body'] = [string]$env:KIMI_ONBOARDING_FORM_BODY
  }
  $response = Invoke-WebRequest @invokeArgs
  [pscustomobject]@{
    status = [int]$response.StatusCode
    body = (Read-ResponseBody $response)
    error = $null
  } | ConvertTo-Json -Compress -Depth 4
}
catch {
  $status = $null
  $body = ''
  if ($_.Exception.Response) {
    try { $status = [int]$_.Exception.Response.StatusCode } catch {}
    try { $body = Read-ResponseBody $_.Exception.Response } catch {}
  }
  [pscustomobject]@{
    status = $status
    body = $body
    error = [string]$_.Exception.Message
  } | ConvertTo-Json -Compress -Depth 4
  exit 1
}
"#;
    let mut command = Command::new("powershell.exe");
    command_utils::configure_system_command(&mut command);
    let output = command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("KIMI_ONBOARDING_URL", request.url.as_str())
        .env(
            "KIMI_ONBOARDING_METHOD",
            if request.method == HttpRequestMethod::Get {
                "GET"
            } else {
                "POST"
            },
        )
        .env(
            "KIMI_ONBOARDING_TIMEOUT_SEC",
            request.timeout.as_secs().max(1).to_string(),
        )
        .env("KIMI_ONBOARDING_HEADERS_JSON", headers_json)
        .env(
            "KIMI_ONBOARDING_FORM_BODY",
            request.form_body.clone().unwrap_or_default(),
        )
        .output()
        .context("failed to launch windows native onboarding fallback")?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stdout.is_empty() {
        let fallback: PowerShellResponse = serde_json::from_str(&stdout).with_context(|| {
            format!("failed to parse windows native onboarding payload: {stdout}")
        })?;
        if let Some(status) = fallback.status {
            return Ok(RawHttpResponse {
                source: HttpResponseSource::WindowsNative,
                status,
                body: fallback.body.unwrap_or_default(),
            });
        }
        bail!(
            "windows native onboarding fallback returned no status: {} {}",
            fallback.error.unwrap_or_default(),
            stderr
        );
    }
    bail!(
        "windows native onboarding fallback produced no structured output (exit={}, stderr={})",
        output.status,
        stderr
    );
}

#[cfg(not(windows))]
fn should_try_windows_native_fallback(_: &TransportFailure) -> bool {
    false
}

#[cfg(windows)]
fn should_try_windows_native_fallback(failure: &TransportFailure) -> bool {
    matches!(
        failure.kind,
        TransportFailureKind::Timeout
            | TransportFailureKind::Connect
            | TransportFailureKind::Dns
            | TransportFailureKind::Tls
            | TransportFailureKind::ConnectionReset
            | TransportFailureKind::UnexpectedEof
            | TransportFailureKind::Network
    )
}

fn transport_failure_label(kind: TransportFailureKind) -> &'static str {
    match kind {
        TransportFailureKind::Timeout => "timeout",
        TransportFailureKind::Connect => "connect",
        TransportFailureKind::Dns => "dns",
        TransportFailureKind::Tls => "tls",
        TransportFailureKind::ConnectionReset => "connection_reset",
        TransportFailureKind::UnexpectedEof => "unexpected_eof",
        TransportFailureKind::Network => "network",
        TransportFailureKind::Unknown => "unknown",
    }
}

fn response_source_label(source: HttpResponseSource) -> &'static str {
    match source {
        HttpResponseSource::Reqwest => "reqwest",
        HttpResponseSource::WindowsNative => "windows_native",
    }
}

fn summarize_body(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let summary = chars
        .by_ref()
        .take(DEFAULT_RESPONSE_SNIPPET_LIMIT)
        .collect::<String>();
    if chars.next().is_some() {
        format!("{summary}...")
    } else {
        summary
    }
}

fn log_onboarding(app: Option<&AppHandle>, message: String) {
    if let Some(app) = app {
        log_manager::append_line(app, message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use tiny_http::{Header, Response, Server};

    #[derive(Debug, Deserialize)]
    struct WaitPayload {
        status: String,
    }

    #[test]
    fn classify_transport_failure_recognizes_connection_reset_and_eof() {
        let reset = TransportFailure {
            kind: TransportFailureKind::ConnectionReset,
            message: "connection reset by peer".to_string(),
        };
        assert!(should_try_windows_native_fallback(&reset) || cfg!(not(windows)));

        let eof = TransportFailure {
            kind: TransportFailureKind::UnexpectedEof,
            message: "unexpected EOF".to_string(),
        };
        assert!(should_try_windows_native_fallback(&eof) || cfg!(not(windows)));
    }

    #[test]
    fn get_json_reads_mock_response() {
        let server = Server::http("127.0.0.1:0").expect("mock server");
        let base_url = format!("http://{}", server.server_addr());
        let handle = std::thread::spawn(move || {
            let request = server.recv().expect("request");
            let response = Response::from_string(r#"{"status":"wait"}"#).with_header(
                Header::from_bytes("Content-Type", "application/json").expect("header"),
            );
            request.respond(response).expect("respond");
        });

        let payload = get_json::<WaitPayload>(
            None,
            "test",
            "wait",
            format!("{base_url}/wait"),
            Vec::new(),
            Duration::from_secs(5),
        )
        .expect("payload");
        assert_eq!(payload.status, "wait");
        handle.join().expect("join");
    }
}
