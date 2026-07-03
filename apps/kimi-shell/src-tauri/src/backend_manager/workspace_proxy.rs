use super::workspace_injection::inject_workspace_scripts;
use super::*;

type UpstreamResponseHead = (u16, Vec<(String, String)>, Vec<u8>);

pub(super) fn start_workspace_proxy(
    app: &AppHandle,
    generation: u64,
    upstream_port: u16,
) -> anyhow::Result<u16> {
    let listener = TcpListener::bind((KIMI_HOST, 0))
        .context("failed to bind workspace proxy listener on localhost")?;
    let proxy_port = listener
        .local_addr()
        .context("failed to read workspace proxy listener address")?
        .port();
    let server = Server::from_listener(listener, None)
        .map_err(|error| anyhow::anyhow!("failed to initialize workspace proxy server: {error}"))?;
    let app_handle = app.clone();

    thread::spawn(move || {
        run_workspace_proxy_loop(app_handle, generation, upstream_port, proxy_port, server);
    });

    Ok(proxy_port)
}

pub(super) fn run_workspace_proxy_loop(
    app: AppHandle,
    generation: u64,
    upstream_port: u16,
    proxy_port: u16,
    server: Server,
) {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            log_manager::append_line(
                &app,
                format!("workspace proxy initialization failed: {error}"),
            );
            return;
        }
    };

    log_manager::append_line(
        &app,
        format!("workspace proxy started on {proxy_port} -> {upstream_port}"),
    );

    loop {
        if !workspace_proxy_should_run(&app, generation) {
            break;
        }

        let request = match server.recv_timeout(Duration::from_millis(250)) {
            Ok(Some(request)) => request,
            Ok(None) => continue,
            Err(error) => {
                log_manager::append_line(
                    &app,
                    format!("workspace proxy receive error on {proxy_port}: {error}"),
                );
                break;
            }
        };

        handle_workspace_proxy_request(&app, &client, upstream_port, request);
    }

    log_manager::append_line(&app, format!("workspace proxy stopped on {proxy_port}"));
}

pub(super) fn workspace_proxy_should_run(app: &AppHandle, generation: u64) -> bool {
    let state = app.state::<AppState>();
    let runtime = match state.runtime.lock() {
        Ok(runtime) => runtime,
        Err(_) => return false,
    };

    runtime.generation == generation
        && matches!(
            runtime.state,
            BackendState::Starting | BackendState::Running
        )
}

pub(super) fn handle_workspace_proxy_request(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    upstream_port: u16,
    request: tiny_http::Request,
) {
    let is_websocket_upgrade = is_websocket_upgrade_request(&request);
    if request.url().contains("/stream") && !is_websocket_upgrade {
        log_manager::append_line(
            app,
            format!(
                "workspace proxy forwarded `{}` as plain HTTP (missing websocket upgrade headers: {})",
                request.url(),
                summarize_request_headers(&request)
            ),
        );
    }

    if is_websocket_upgrade {
        if let Some(session_id) = extract_session_id_from_stream_path(request.url()) {
            workspace_session::note_session_stream_activity(
                app,
                &session_id,
                "workspace_proxy_ws_upgrade",
            );
        }
        handle_workspace_websocket_upgrade(app, upstream_port, request);
        return;
    }

    handle_workspace_http_proxy(app, client, upstream_port, request);
}

pub(super) fn handle_workspace_http_proxy(
    app: &AppHandle,
    client: &reqwest::blocking::Client,
    upstream_port: u16,
    mut request: tiny_http::Request,
) {
    let upstream_url = format!("http://{KIMI_HOST}:{upstream_port}{}", request.url());
    let method = match reqwest::Method::from_bytes(request.method().as_str().as_bytes()) {
        Ok(method) => method,
        Err(_) => {
            let _ = request.respond(
                Response::from_string("Unsupported HTTP method").with_status_code(StatusCode(400)),
            );
            return;
        }
    };

    let mut body = Vec::new();
    if request.as_reader().read_to_end(&mut body).is_err() {
        let _ = request.respond(
            Response::from_string("Failed to read request body").with_status_code(StatusCode(400)),
        );
        return;
    }

    let mut upstream_builder = client
        .request(method, &upstream_url)
        .header("Accept-Encoding", "identity");
    for header in request.headers() {
        let name = header.field.to_string();
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("content-length")
            || is_hop_by_hop_header(&name)
            || name.eq_ignore_ascii_case("accept-encoding")
        {
            continue;
        }
        upstream_builder = upstream_builder.header(name, header.value.as_str());
    }
    if !body.is_empty() {
        upstream_builder = upstream_builder.body(body);
    }

    let upstream_response = match upstream_builder.send() {
        Ok(response) => response,
        Err(error) => {
            let _ = request.respond(
                Response::from_string(format!("Bad Gateway: {error}"))
                    .with_status_code(StatusCode(502)),
            );
            return;
        }
    };

    let status_code = upstream_response.status().as_u16();
    let content_type = upstream_response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let is_html = content_type
        .as_ref()
        .map(|value| value.to_ascii_lowercase().contains("text/html"))
        .unwrap_or(false);

    let response_headers =
        collect_forwardable_response_headers(upstream_response.headers(), !is_html);

    if !is_html {
        let mut response = Response::new(
            StatusCode(status_code),
            Vec::new(),
            upstream_response,
            None,
            None,
        );
        add_headers_to_response(&mut response, &response_headers);
        let _ = request.respond(response);
        return;
    }

    let mut response_body = match upstream_response.bytes() {
        Ok(bytes) => bytes.to_vec(),
        Err(error) => {
            log_manager::append_line(
                app,
                format!("workspace proxy html response read failed for `{upstream_url}`: {error}"),
            );
            let _ = request.respond(
                Response::from_string(format!("Bad Gateway (response read failed): {error}"))
                    .with_status_code(StatusCode(502)),
            );
            return;
        }
    };

    if let Ok(html) = std::str::from_utf8(&response_body) {
        let enhanced_enabled = settings_store::load_or_default(app)
            .map(|settings| matches!(settings.workspace_web_mode, WorkspaceWebMode::EnhancedLocal))
            .unwrap_or(false);
        response_body =
            inject_workspace_scripts(html, upstream_port, enhanced_enabled).into_bytes();
    }

    let mut response = Response::from_data(response_body).with_status_code(StatusCode(status_code));
    add_headers_to_response(&mut response, &response_headers);
    if response_headers
        .iter()
        .all(|(name, _)| !name.eq_ignore_ascii_case("content-type"))
    {
        if let Some(content_type_value) = content_type {
            if let Ok(header) = Header::from_bytes("Content-Type", content_type_value) {
                response.add_header(header);
            }
        }
    }

    let _ = request.respond(response);
}

pub(super) fn handle_workspace_websocket_upgrade(
    app: &AppHandle,
    upstream_port: u16,
    request: tiny_http::Request,
) {
    let upstream_addr = format!("{KIMI_HOST}:{upstream_port}");
    let request_url = request.url().to_string();

    let mut upstream_stream = match TcpStream::connect((KIMI_HOST, upstream_port)) {
        Ok(stream) => stream,
        Err(error) => {
            log_manager::append_line(
                app,
                format!("workspace proxy websocket connect failed `{request_url}`: {error}"),
            );
            let _ = request.respond(
                Response::from_string(format!("Bad Gateway: {error}"))
                    .with_status_code(StatusCode(502)),
            );
            return;
        }
    };
    let _ = upstream_stream.set_nodelay(true);
    let _ = upstream_stream.set_read_timeout(Some(Duration::from_secs(30)));
    let _ = upstream_stream.set_write_timeout(Some(Duration::from_secs(30)));

    let upstream_request = build_upstream_websocket_request(&request, &upstream_addr);
    if let Err(error) = upstream_stream.write_all(upstream_request.as_bytes()) {
        log_manager::append_line(
            app,
            format!("workspace proxy websocket write handshake failed `{request_url}`: {error}"),
        );
        let _ = request.respond(
            Response::from_string(format!("Bad Gateway: {error}"))
                .with_status_code(StatusCode(502)),
        );
        return;
    }
    if let Err(error) = upstream_stream.flush() {
        log_manager::append_line(
            app,
            format!("workspace proxy websocket flush handshake failed `{request_url}`: {error}"),
        );
        let _ = request.respond(
            Response::from_string(format!("Bad Gateway: {error}"))
                .with_status_code(StatusCode(502)),
        );
        return;
    }

    let (status_code, upstream_headers, mut upstream_prefix) =
        match read_upstream_response_head(&mut upstream_stream) {
            Ok(value) => value,
            Err(error) => {
                log_manager::append_line(
                    app,
                    format!(
                        "workspace proxy websocket read handshake failed `{request_url}`: {error:#}"
                    ),
                );
                let _ = request.respond(
                    Response::from_string("Bad Gateway (invalid upstream handshake)")
                        .with_status_code(StatusCode(502)),
                );
                return;
            }
        };

    if status_code != 101 {
        log_manager::append_line(
            app,
            format!(
                "workspace proxy websocket upstream returned status {status_code} for `{request_url}`"
            ),
        );
        let mut response_body = std::mem::take(&mut upstream_prefix);
        let _ = upstream_stream.read_to_end(&mut response_body);
        let mut response =
            Response::from_data(response_body).with_status_code(StatusCode(status_code));
        let response_headers = collect_websocket_fallback_headers(&upstream_headers);
        add_headers_to_response(&mut response, &response_headers);
        let _ = request.respond(response);
        return;
    }

    let mut upgrade_response = Response::new_empty(StatusCode(101));
    let upgrade_headers = collect_websocket_upgrade_headers(&upstream_headers);
    add_headers_to_response(&mut upgrade_response, &upgrade_headers);

    log_manager::append_line(
        app,
        format!("workspace proxy websocket tunnel opened for `{request_url}`"),
    );

    let mut client_stream = request.upgrade("websocket", upgrade_response);
    if !upstream_prefix.is_empty() {
        let _ = client_stream.write_all(&upstream_prefix);
        let _ = client_stream.flush();
    }

    match tunnel_websocket_streams(client_stream, upstream_stream) {
        Ok(upstream_to_client) => {
            log_manager::append_line(
                app,
                format!(
                    "workspace proxy websocket tunnel closed for `{request_url}` (u2c={upstream_to_client} bytes)"
                ),
            );
        }
        Err(error) => {
            log_manager::append_line(
                app,
                format!("workspace proxy websocket tunnel error for `{request_url}`: {error}"),
            );
        }
    }
}

pub(super) fn is_websocket_upgrade_request(request: &tiny_http::Request) -> bool {
    if !request.method().as_str().eq_ignore_ascii_case("GET") {
        return false;
    }

    let mut has_upgrade_websocket = false;
    let mut has_connection_upgrade = false;
    let mut has_websocket_key = false;
    for header in request.headers() {
        let name = header.field.to_string();
        let value = header.value.as_str();
        if name.eq_ignore_ascii_case("upgrade")
            && value
                .split(',')
                .any(|segment| segment.trim().eq_ignore_ascii_case("websocket"))
        {
            has_upgrade_websocket = true;
        }
        if name.eq_ignore_ascii_case("connection")
            && value
                .split(',')
                .any(|segment| segment.trim().eq_ignore_ascii_case("upgrade"))
        {
            has_connection_upgrade = true;
        }
        if name.eq_ignore_ascii_case("sec-websocket-key") && !value.trim().is_empty() {
            has_websocket_key = true;
        }
    }

    has_websocket_key || (has_upgrade_websocket && has_connection_upgrade)
}

pub(super) fn extract_session_id_from_stream_path(raw_url: &str) -> Option<String> {
    const PREFIX: &str = "/api/sessions/";
    const SUFFIX: &str = "/stream";

    let path = raw_url.split('?').next().unwrap_or(raw_url).trim();
    if !path.starts_with(PREFIX) || !path.ends_with(SUFFIX) {
        return None;
    }

    let body = &path[PREFIX.len()..path.len() - SUFFIX.len()];
    if body.is_empty() || body.contains('/') {
        return None;
    }
    Some(body.to_string())
}

pub(super) fn build_upstream_websocket_request(
    request: &tiny_http::Request,
    upstream_addr: &str,
) -> String {
    let mut output = format!(
        "{} {} HTTP/1.1\r\nHost: {upstream_addr}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n",
        request.method().as_str(),
        request.url()
    );
    for header in request.headers() {
        let name = header.field.to_string();
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("content-length")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("upgrade")
        {
            continue;
        }
        output.push_str(&name);
        output.push_str(": ");
        output.push_str(header.value.as_str());
        output.push_str("\r\n");
    }
    output.push_str("\r\n");
    output
}

pub(super) fn read_upstream_response_head(
    stream: &mut TcpStream,
) -> anyhow::Result<UpstreamResponseHead> {
    let mut buffer = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 4096];

    loop {
        let read = stream
            .read(&mut chunk)
            .context("failed to read upstream response")?;
        if read == 0 {
            return Err(anyhow::anyhow!(
                "upstream closed connection before handshake response completed"
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_UPSTREAM_HEADER_BYTES {
            return Err(anyhow::anyhow!(
                "upstream response headers exceed limit ({MAX_UPSTREAM_HEADER_BYTES} bytes)"
            ));
        }

        if let Some(header_end) = find_http_header_end(&buffer) {
            let header_text = String::from_utf8_lossy(&buffer[..header_end]);
            let mut lines = header_text.split("\r\n");
            let status_line = lines.next().unwrap_or_default();
            let status_code = status_line
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u16>().ok())
                .ok_or_else(|| anyhow::anyhow!("invalid upstream status line: `{status_line}`"))?;

            let mut headers = Vec::new();
            for line in lines {
                if line.trim().is_empty() {
                    continue;
                }
                if let Some((name, value)) = line.split_once(':') {
                    headers.push((name.trim().to_string(), value.trim().to_string()));
                }
            }

            let body_prefix = buffer[(header_end + 4)..].to_vec();
            return Ok((status_code, headers, body_prefix));
        }
    }
}

pub(super) fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

pub(super) fn collect_forwardable_response_headers(
    headers: &reqwest::header::HeaderMap,
    include_content_length: bool,
) -> Vec<(String, String)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let name = name.as_str();
            if is_hop_by_hop_header(name) {
                return None;
            }
            if !include_content_length && name.eq_ignore_ascii_case("content-length") {
                return None;
            }
            let value = value.to_str().ok()?;
            Some((name.to_string(), value.to_string()))
        })
        .collect()
}

pub(super) fn collect_websocket_upgrade_headers(
    headers: &[(String, String)],
) -> Vec<(String, String)> {
    let mut output = vec![
        ("Connection".to_string(), "Upgrade".to_string()),
        ("Upgrade".to_string(), "websocket".to_string()),
    ];
    for (name, value) in headers {
        if name.eq_ignore_ascii_case("sec-websocket-accept")
            || name.eq_ignore_ascii_case("sec-websocket-protocol")
            || name.eq_ignore_ascii_case("sec-websocket-extensions")
            || name.eq_ignore_ascii_case("set-cookie")
        {
            output.push((name.clone(), value.clone()));
        }
    }
    output
}

pub(super) fn collect_websocket_fallback_headers(
    headers: &[(String, String)],
) -> Vec<(String, String)> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            if is_hop_by_hop_header(name) {
                return None;
            }
            if name.eq_ignore_ascii_case("content-length")
                || name.eq_ignore_ascii_case("transfer-encoding")
            {
                return None;
            }
            Some((name.clone(), value.clone()))
        })
        .collect()
}

pub(super) fn tunnel_websocket_streams(
    client_stream: Box<dyn tiny_http::ReadWrite + Send>,
    upstream_stream: TcpStream,
) -> anyhow::Result<u64> {
    let shared_client: Arc<Mutex<Box<dyn tiny_http::ReadWrite + Send>>> =
        Arc::new(Mutex::new(client_stream));
    let writer_client = Arc::clone(&shared_client);
    let mut upstream_writer = upstream_stream
        .try_clone()
        .context("failed to clone upstream stream for websocket tunnel write")?;

    thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            let read = {
                let mut client = match writer_client.lock() {
                    Ok(lock) => lock,
                    Err(_) => return,
                };
                match client.read(&mut buffer) {
                    Ok(n) => n,
                    Err(_) => return,
                }
            };

            if read == 0 {
                return;
            }

            if upstream_writer.write_all(&buffer[..read]).is_err() {
                return;
            }
            if upstream_writer.flush().is_err() {
                return;
            }
        }
    });

    let mut upstream_reader = upstream_stream;
    let mut upstream_to_client_total = 0u64;
    let mut buffer = [0u8; 8192];
    while let Ok(read) = upstream_reader.read(&mut buffer) {
        if read == 0 {
            break;
        }

        upstream_to_client_total = upstream_to_client_total.saturating_add(read as u64);

        let write_ok = {
            let mut client = match shared_client.lock() {
                Ok(lock) => lock,
                Err(_) => break,
            };
            client.write_all(&buffer[..read]).is_ok() && client.flush().is_ok()
        };
        if !write_ok {
            break;
        }
    }

    Ok(upstream_to_client_total)
}

pub(super) fn add_headers_to_response<R: Read>(
    response: &mut Response<R>,
    headers: &[(String, String)],
) {
    for (name, value) in headers {
        if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            response.add_header(header);
        }
    }
}

pub(super) fn summarize_request_headers(request: &tiny_http::Request) -> String {
    let mut entries = Vec::new();
    for header in request.headers() {
        let value = header.value.as_str();
        let trimmed = if value.len() > 120 {
            format!("{}...", &value[..120])
        } else {
            value.to_string()
        };
        entries.push(format!("{}={}", header.field, trimmed));
    }
    if entries.is_empty() {
        "<none>".to_string()
    } else {
        entries.join("; ")
    }
}

pub(super) fn is_hop_by_hop_header(name: &str) -> bool {
    name.eq_ignore_ascii_case("connection")
        || name.eq_ignore_ascii_case("keep-alive")
        || name.eq_ignore_ascii_case("proxy-authenticate")
        || name.eq_ignore_ascii_case("proxy-authorization")
        || name.eq_ignore_ascii_case("te")
        || name.eq_ignore_ascii_case("trailer")
        || name.eq_ignore_ascii_case("transfer-encoding")
        || name.eq_ignore_ascii_case("upgrade")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_session_id_from_stream_path_handles_query_string() {
        let value = extract_session_id_from_stream_path(
            "/api/sessions/abc-123/stream?encoding=text&version=1",
        );
        assert_eq!(value.as_deref(), Some("abc-123"));
    }

    #[test]
    fn extract_session_id_from_stream_path_rejects_invalid_paths() {
        assert!(extract_session_id_from_stream_path("/api/sessions//stream").is_none());
        assert!(extract_session_id_from_stream_path("/api/sessions/abc/stream/extra").is_none());
        assert!(extract_session_id_from_stream_path("/api/other/abc/stream").is_none());
    }
}
