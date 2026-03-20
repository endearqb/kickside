use std::{net::TcpListener, thread, time::Duration};

use anyhow::Context;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response, Server, StatusCode};

use crate::{app_state::AppState, bridge_manager, log_manager};

const HOST_CONTROL_TOKEN_HEADER: &str = "X-Bridge-Host-Token";
const HOST_CONTROL_RESTART_PATH: &str = "/api/v1/bridge/restart";
const HOST_CONTROL_HEALTH_PATH: &str = "/healthz";

pub fn ensure_running(app: &AppHandle) -> anyhow::Result<u16> {
    let state = app.state::<AppState>();
    {
        let guard = state
            .bridge_host_control_port
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge host control mutex is poisoned"))?;
        if let Some(port) = *guard {
            return Ok(port);
        }
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .context("failed to bind bridge host control listener on localhost")?;
    let port = listener
        .local_addr()
        .context("failed to read bridge host control listener address")?
        .port();
    let server = Server::from_listener(listener, None).map_err(|error| {
        anyhow::anyhow!("failed to initialize bridge host control server: {error}")
    })?;

    {
        let mut guard = state
            .bridge_host_control_port
            .lock()
            .map_err(|_| anyhow::anyhow!("bridge host control mutex is poisoned"))?;
        if let Some(existing) = *guard {
            return Ok(existing);
        }
        *guard = Some(port);
    }

    let app_handle = app.clone();
    thread::spawn(move || run_bridge_host_control_loop(app_handle, port, server));

    log_manager::append_line(app, format!("bridge host control started on {port}"));
    Ok(port)
}

fn run_bridge_host_control_loop(app: AppHandle, port: u16, server: Server) {
    loop {
        let request = match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(error) => {
                log_manager::append_line(
                    &app,
                    format!("bridge host control receive error on {port}: {error}"),
                );
                break;
            }
        };
        handle_bridge_host_control_request(&app, request);
    }

    log_manager::append_line(&app, format!("bridge host control stopped on {port}"));
}

fn handle_bridge_host_control_request(app: &AppHandle, request: tiny_http::Request) {
    let method = request.method().clone();
    let url = request.url().to_string();

    if method == Method::Get && url == HOST_CONTROL_HEALTH_PATH {
        let _ = respond_json(request, StatusCode(200), r#"{"ok":true}"#);
        return;
    }

    if !is_authorized(app, &request) {
        let _ = respond_json(request, StatusCode(401), r#"{"error":"unauthorized"}"#);
        return;
    }

    if method == Method::Post && url == HOST_CONTROL_RESTART_PATH {
        let _ = respond_json(request, StatusCode(202), r#"{"status":"accepted"}"#);
        let app_handle = app.clone();
        thread::spawn(move || {
            log_manager::append_line(&app_handle, "bridge host control restart requested");
            match bridge_manager::restart_bridge(&app_handle) {
                Ok(status) => {
                    log_manager::append_line(
                        &app_handle,
                        format!(
                            "bridge host control restart completed: state={:?} bindings={}",
                            status.state, status.bindings
                        ),
                    );
                }
                Err(error) => {
                    log_manager::append_line(
                        &app_handle,
                        format!("bridge host control restart failed: {error:#}"),
                    );
                }
            }
        });
        return;
    }

    let _ = respond_json(request, StatusCode(404), r#"{"error":"not_found"}"#);
}

fn is_authorized(app: &AppHandle, request: &tiny_http::Request) -> bool {
    let expected = match app.state::<AppState>().bridge_runtime.lock() {
        Ok(runtime) => runtime.admin_token.clone(),
        Err(_) => return false,
    };
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(HOST_CONTROL_TOKEN_HEADER))
        .map(|header| header.value.as_str() == expected)
        .unwrap_or(false)
}

fn respond_json(
    request: tiny_http::Request,
    status: StatusCode,
    body: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let content_type =
        Header::from_bytes("Content-Type", "application/json").expect("valid content-type header");
    let response = Response::from_string(body)
        .with_status_code(status)
        .with_header(content_type);
    request.respond(response)?;
    Ok(())
}
