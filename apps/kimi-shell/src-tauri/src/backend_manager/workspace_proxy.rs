use super::*;

type RawResponseHead = (String, Vec<(String, String)>, Vec<u8>);
const SHELL_FRAME_ANCESTORS: &str =
    "'self' tauri: http://tauri.localhost https://tauri.localhost http://localhost:1420";
const MAX_CONCURRENT_CONNECTIONS: usize = 64;

#[derive(Debug)]
struct RawHttpRequest {
    request_line: String,
    method: String,
    target: String,
    headers: Vec<(String, String)>,
    body_prefix: Vec<u8>,
}

struct ActiveConnectionGuard(Arc<AtomicUsize>);

impl Drop for ActiveConnectionGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(super) fn start_workspace_proxy(
    app: &AppHandle,
    generation: u64,
    upstream_port: u16,
) -> anyhow::Result<u16> {
    let listener = TcpListener::bind((KIMI_HOST, 0))
        .context("failed to bind workspace proxy listener on localhost")?;
    listener
        .set_nonblocking(true)
        .context("failed to configure workspace proxy listener")?;
    let proxy_port = listener.local_addr()?.port();
    let app_handle = app.clone();
    thread::spawn(move || {
        run_workspace_proxy_loop(app_handle, generation, upstream_port, proxy_port, listener);
    });
    Ok(proxy_port)
}

fn run_workspace_proxy_loop(
    app: AppHandle,
    generation: u64,
    upstream_port: u16,
    proxy_port: u16,
    listener: TcpListener,
) {
    log_manager::append_line(
        &app,
        format!("workspace proxy started on {proxy_port} -> {upstream_port}"),
    );
    let active_connections = Arc::new(AtomicUsize::new(0));

    while workspace_proxy_should_run(&app, generation) {
        let (stream, peer) = match listener.accept() {
            Ok(connection) => connection,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
                continue;
            }
            Err(error) => {
                log_manager::append_line(
                    &app,
                    format!("workspace proxy accept error on {proxy_port}: {error}"),
                );
                break;
            }
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        if let Err(error) = stream.set_nonblocking(false) {
            log_manager::append_line(
                &app,
                format!("workspace proxy failed to configure accepted socket: {error}"),
            );
            continue;
        }

        let previous = active_connections.fetch_add(1, Ordering::AcqRel);
        if previous >= MAX_CONCURRENT_CONNECTIONS {
            active_connections.fetch_sub(1, Ordering::AcqRel);
            let mut stream = stream;
            let _ = write_simple_response(&mut stream, 503, "Service Unavailable");
            continue;
        }

        let app_handle = app.clone();
        let active_guard = ActiveConnectionGuard(Arc::clone(&active_connections));
        thread::spawn(move || {
            let _active_guard = active_guard;
            if let Err(error) = handle_workspace_connection(&app_handle, upstream_port, stream) {
                log_manager::append_line(
                    &app_handle,
                    format!("workspace proxy connection error: {error:#}"),
                );
            }
        });
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

fn handle_workspace_connection(
    app: &AppHandle,
    upstream_port: u16,
    mut client: TcpStream,
) -> anyhow::Result<()> {
    client.set_nodelay(true).ok();
    client.set_read_timeout(Some(Duration::from_secs(90))).ok();
    client.set_write_timeout(Some(Duration::from_secs(90))).ok();
    let request = read_raw_http_request(&mut client)?;
    if is_websocket_upgrade_request(&request) {
        if let Some(session_id) = extract_session_id_from_stream_path(&request.target) {
            workspace_session::note_session_stream_activity(
                app,
                &session_id,
                "workspace_proxy_ws_upgrade",
            );
        }
        handle_workspace_websocket_upgrade(app, upstream_port, client, request)
    } else {
        handle_workspace_http_proxy(upstream_port, client, request)
    }
}

fn handle_workspace_http_proxy(
    upstream_port: u16,
    mut client: TcpStream,
    request: RawHttpRequest,
) -> anyhow::Result<()> {
    let mut upstream = TcpStream::connect((KIMI_HOST, upstream_port))
        .context("failed to connect workspace HTTP upstream")?;
    upstream.set_nodelay(true).ok();
    upstream
        .set_read_timeout(Some(Duration::from_secs(90)))
        .ok();
    upstream
        .set_write_timeout(Some(Duration::from_secs(90)))
        .ok();

    let content_length = request_content_length(&request.headers)?;
    if has_chunked_transfer_encoding(&request.headers) {
        write_simple_response(&mut client, 501, "Chunked request bodies are not supported")?;
        return Ok(());
    }
    if request.body_prefix.len() as u64 > content_length {
        return Err(anyhow::anyhow!(
            "workspace request body exceeds declared Content-Length"
        ));
    }
    write_upstream_request_head(&mut upstream, upstream_port, &request, false)?;
    upstream.write_all(&request.body_prefix)?;
    let remaining = content_length.saturating_sub(request.body_prefix.len() as u64);
    if remaining > 0 {
        std::io::copy(
            &mut std::io::Read::by_ref(&mut client).take(remaining),
            &mut upstream,
        )
        .context("failed to forward workspace request body")?;
    }
    upstream.flush()?;

    let (status_line, mut headers, body_prefix) = read_raw_response_head(&mut upstream)?;
    let is_html = header_value(&headers, "content-type")
        .map(|value| value.to_ascii_lowercase().contains("text/html"))
        .unwrap_or(false);
    if is_html {
        adapt_html_embedding_headers(&mut headers);
    }
    headers.retain(|(name, _)| !name.eq_ignore_ascii_case("connection"));
    headers.push(("Connection".to_string(), "close".to_string()));
    write_response_head(&mut client, &status_line, &headers)?;
    client.write_all(&body_prefix)?;
    std::io::copy(&mut upstream, &mut client)
        .context("failed to stream workspace upstream response")?;
    client.flush()?;
    Ok(())
}

fn handle_workspace_websocket_upgrade(
    app: &AppHandle,
    upstream_port: u16,
    mut client: TcpStream,
    request: RawHttpRequest,
) -> anyhow::Result<()> {
    let request_url = request.target.clone();
    let mut upstream = TcpStream::connect((KIMI_HOST, upstream_port))
        .context("failed to connect workspace WebSocket upstream")?;
    upstream.set_nodelay(true).ok();
    upstream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .ok();
    upstream
        .set_write_timeout(Some(Duration::from_secs(30)))
        .ok();
    write_upstream_request_head(&mut upstream, upstream_port, &request, true)?;
    upstream.write_all(&request.body_prefix)?;
    upstream.flush()?;

    let (status_line, headers, upstream_prefix) = read_raw_response_head(&mut upstream)?;
    if parse_status_code(&status_line)? != 101 {
        write_response_head(&mut client, &status_line, &headers)?;
        client.write_all(&upstream_prefix)?;
        std::io::copy(&mut upstream, &mut client)?;
        client.flush()?;
        return Ok(());
    }

    write_response_head(
        &mut client,
        &status_line,
        &collect_websocket_upgrade_headers(&headers),
    )?;
    client.write_all(&upstream_prefix)?;
    client.flush()?;
    client.set_read_timeout(None).ok();
    client.set_write_timeout(None).ok();
    upstream.set_read_timeout(None).ok();
    upstream.set_write_timeout(None).ok();

    log_manager::append_line(
        app,
        format!("workspace proxy websocket tunnel opened for `{request_url}`"),
    );
    let upstream_to_client = tunnel_websocket_streams(&client, &upstream)?;
    log_manager::append_line(
        app,
        format!(
            "workspace proxy websocket tunnel closed for `{request_url}` (u2c={upstream_to_client} bytes)"
        ),
    );
    Ok(())
}

fn read_raw_http_request(stream: &mut TcpStream) -> anyhow::Result<RawHttpRequest> {
    let (head, body_prefix) = read_http_head(stream)?;
    let text = std::str::from_utf8(&head).context("workspace request headers are not UTF-8")?;
    let mut lines = text.split("\r\n");
    let request_line = lines.next().unwrap_or_default().to_string();
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let target = request_parts.next().unwrap_or_default().to_string();
    let version = request_parts.next().unwrap_or_default();
    if method.is_empty() || target.is_empty() || !version.starts_with("HTTP/1.") {
        return Err(anyhow::anyhow!("invalid workspace HTTP request line"));
    }
    Ok(RawHttpRequest {
        request_line,
        method,
        target,
        headers: parse_header_lines(lines)?,
        body_prefix,
    })
}

fn read_raw_response_head(stream: &mut TcpStream) -> anyhow::Result<RawResponseHead> {
    let (head, body_prefix) = read_http_head(stream)?;
    let text = std::str::from_utf8(&head).context("workspace response headers are not UTF-8")?;
    let mut lines = text.split("\r\n");
    let status_line = lines.next().unwrap_or_default().to_string();
    parse_status_code(&status_line)?;
    Ok((status_line, parse_header_lines(lines)?, body_prefix))
}

fn read_http_head(stream: &mut TcpStream) -> anyhow::Result<(Vec<u8>, Vec<u8>)> {
    let mut buffer = Vec::with_capacity(8 * 1024);
    let mut chunk = [0u8; 4096];
    loop {
        let read = stream.read(&mut chunk)?;
        if read == 0 {
            return Err(anyhow::anyhow!(
                "connection closed before HTTP headers completed"
            ));
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.len() > MAX_UPSTREAM_HEADER_BYTES {
            return Err(anyhow::anyhow!(
                "HTTP headers exceed limit ({MAX_UPSTREAM_HEADER_BYTES} bytes)"
            ));
        }
        if let Some(header_end) = find_http_header_end(&buffer) {
            return Ok((
                buffer[..header_end].to_vec(),
                buffer[(header_end + 4)..].to_vec(),
            ));
        }
    }
}

fn parse_header_lines<'a>(
    lines: impl Iterator<Item = &'a str>,
) -> anyhow::Result<Vec<(String, String)>> {
    let mut headers = Vec::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| anyhow::anyhow!("invalid HTTP header line"))?;
        if name.is_empty() || name.bytes().any(|byte| byte <= b' ' || byte >= 0x7f) {
            return Err(anyhow::anyhow!("invalid HTTP header name"));
        }
        headers.push((name.to_string(), value.trim().to_string()));
    }
    Ok(headers)
}

fn write_upstream_request_head(
    upstream: &mut TcpStream,
    upstream_port: u16,
    request: &RawHttpRequest,
    websocket: bool,
) -> anyhow::Result<()> {
    upstream.write_all(request.request_line.as_bytes())?;
    upstream.write_all(b"\r\n")?;
    upstream.write_all(format!("Host: {KIMI_HOST}:{upstream_port}\r\n").as_bytes())?;
    for (name, value) in &request.headers {
        if name.eq_ignore_ascii_case("host")
            || name.eq_ignore_ascii_case("connection")
            || name.eq_ignore_ascii_case("upgrade")
            || name.eq_ignore_ascii_case("proxy-authorization")
            || (!websocket && is_hop_by_hop_header(name))
            || (!websocket && name.eq_ignore_ascii_case("accept-encoding"))
        {
            continue;
        }
        upstream.write_all(name.as_bytes())?;
        upstream.write_all(b": ")?;
        upstream.write_all(value.as_bytes())?;
        upstream.write_all(b"\r\n")?;
    }
    if websocket {
        upstream.write_all(b"Connection: Upgrade\r\nUpgrade: websocket\r\n")?;
    } else {
        upstream.write_all(b"Connection: close\r\nAccept-Encoding: identity\r\n")?;
    }
    upstream.write_all(b"\r\n")?;
    Ok(())
}

fn write_response_head(
    stream: &mut TcpStream,
    status_line: &str,
    headers: &[(String, String)],
) -> anyhow::Result<()> {
    stream.write_all(status_line.as_bytes())?;
    stream.write_all(b"\r\n")?;
    for (name, value) in headers {
        stream.write_all(name.as_bytes())?;
        stream.write_all(b": ")?;
        stream.write_all(value.as_bytes())?;
        stream.write_all(b"\r\n")?;
    }
    stream.write_all(b"\r\n")?;
    stream.flush()?;
    Ok(())
}

fn write_simple_response(stream: &mut TcpStream, code: u16, text: &str) -> anyhow::Result<()> {
    let reason = match code {
        501 => "Not Implemented",
        503 => "Service Unavailable",
        _ => "Error",
    };
    write!(
        stream,
        "HTTP/1.1 {code} {reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        text.len()
    )?;
    stream.write_all(text.as_bytes())?;
    stream.flush()?;
    Ok(())
}

fn parse_status_code(status_line: &str) -> anyhow::Result<u16> {
    status_line
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u16>().ok())
        .ok_or_else(|| anyhow::anyhow!("invalid upstream HTTP status line"))
}

fn request_content_length(headers: &[(String, String)]) -> anyhow::Result<u64> {
    let values = headers
        .iter()
        .filter(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.as_str())
        .collect::<Vec<_>>();
    if values.len() > 1 {
        return Err(anyhow::anyhow!(
            "duplicate workspace request Content-Length"
        ));
    }
    match values.first() {
        Some(value) => value
            .parse::<u64>()
            .context("invalid workspace request Content-Length"),
        None => Ok(0),
    }
}

fn has_chunked_transfer_encoding(headers: &[(String, String)]) -> bool {
    header_value(headers, "transfer-encoding")
        .map(|value| {
            value
                .split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("chunked"))
        })
        .unwrap_or(false)
}

fn header_value<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
}

fn is_websocket_upgrade_request(request: &RawHttpRequest) -> bool {
    if !request.method.eq_ignore_ascii_case("GET") {
        return false;
    }
    let has_key = header_value(&request.headers, "sec-websocket-key")
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    let has_upgrade = header_value(&request.headers, "upgrade")
        .map(|value| value.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);
    let has_connection = header_value(&request.headers, "connection")
        .map(|value| {
            value
                .split(',')
                .any(|part| part.trim().eq_ignore_ascii_case("upgrade"))
        })
        .unwrap_or(false);
    has_key && has_upgrade && has_connection
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

pub(super) fn find_http_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

fn adapt_html_embedding_headers(headers: &mut Vec<(String, String)>) {
    let mut found_csp = false;
    headers.retain_mut(|(name, value)| {
        if name.eq_ignore_ascii_case("x-frame-options") {
            return false;
        }
        if name.eq_ignore_ascii_case("content-security-policy") {
            *value = rewrite_frame_ancestors(value);
            found_csp = true;
        }
        true
    });
    if !found_csp {
        headers.push((
            "Content-Security-Policy".to_string(),
            format!("frame-ancestors {SHELL_FRAME_ANCESTORS}"),
        ));
    }
}

fn rewrite_frame_ancestors(policy: &str) -> String {
    let mut found = false;
    let mut directives = policy
        .split(';')
        .filter_map(|raw| {
            let directive = raw.trim();
            if directive.is_empty() {
                return None;
            }
            let name = directive.split_whitespace().next().unwrap_or_default();
            if name.eq_ignore_ascii_case("frame-ancestors") {
                found = true;
                Some(format!("frame-ancestors {SHELL_FRAME_ANCESTORS}"))
            } else {
                Some(directive.to_string())
            }
        })
        .collect::<Vec<_>>();
    if !found {
        directives.push(format!("frame-ancestors {SHELL_FRAME_ANCESTORS}"));
    }
    directives.join("; ")
}

fn collect_websocket_upgrade_headers(headers: &[(String, String)]) -> Vec<(String, String)> {
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

fn tunnel_websocket_streams(client: &TcpStream, upstream: &TcpStream) -> anyhow::Result<u64> {
    let mut client_reader = client.try_clone()?;
    let mut client_writer = client.try_clone()?;
    let mut upstream_reader = upstream.try_clone()?;
    let mut upstream_writer = upstream.try_clone()?;
    let client_shutdown = client.try_clone()?;
    let upstream_shutdown = upstream.try_clone()?;
    let client_to_upstream = thread::spawn(move || {
        let copied = std::io::copy(&mut client_reader, &mut upstream_writer);
        let _ = upstream_writer.shutdown(std::net::Shutdown::Write);
        copied
    });
    let copied = std::io::copy(&mut upstream_reader, &mut client_writer)
        .context("failed to copy upstream WebSocket stream to client")?;
    let _ = client_writer.shutdown(std::net::Shutdown::Write);
    let _ = client_shutdown.shutdown(std::net::Shutdown::Both);
    let _ = upstream_shutdown.shutdown(std::net::Shutdown::Both);
    let _ = client_to_upstream.join();
    Ok(copied)
}

fn is_hop_by_hop_header(name: &str) -> bool {
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

    fn raw_request(method: &str, headers: &[(&str, &str)]) -> RawHttpRequest {
        RawHttpRequest {
            request_line: format!("{method} /api/v1/ws HTTP/1.1"),
            method: method.to_string(),
            target: "/api/v1/ws".to_string(),
            headers: headers
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            body_prefix: Vec::new(),
        }
    }

    #[test]
    fn websocket_upgrade_requires_all_standard_headers() {
        let valid = raw_request(
            "GET",
            &[
                ("Connection", "keep-alive, Upgrade"),
                ("Upgrade", "websocket"),
                ("Sec-WebSocket-Key", "opaque"),
            ],
        );
        assert!(is_websocket_upgrade_request(&valid));
        let missing_key = raw_request(
            "GET",
            &[("Connection", "Upgrade"), ("Upgrade", "websocket")],
        );
        assert!(!is_websocket_upgrade_request(&missing_key));
    }

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

    #[test]
    fn html_embedding_policy_preserves_csp_and_replaces_only_frame_ancestors() {
        let rewritten = rewrite_frame_ancestors(
            "default-src 'self'; script-src 'self'; frame-ancestors 'self'",
        );
        assert!(rewritten.contains("default-src 'self'"));
        assert!(rewritten.contains("script-src 'self'"));
        assert!(rewritten.contains("frame-ancestors 'self' tauri:"));
        assert!(!rewritten.ends_with("frame-ancestors 'self'"));
    }

    #[test]
    fn html_embedding_policy_adds_a_bounded_ancestor_rule_when_missing() {
        let rewritten = rewrite_frame_ancestors("default-src 'self'");
        assert_eq!(
            rewritten,
            format!("default-src 'self'; frame-ancestors {SHELL_FRAME_ANCESTORS}")
        );
    }

    #[test]
    fn request_content_length_and_chunked_detection_are_fail_closed() {
        assert_eq!(
            request_content_length(&[("Content-Length".into(), "42".into())]).unwrap(),
            42
        );
        assert!(request_content_length(&[("Content-Length".into(), "oops".into())]).is_err());
        assert!(request_content_length(&[
            ("Content-Length".into(), "1".into()),
            ("content-length".into(), "1".into()),
        ])
        .is_err());
        assert!(has_chunked_transfer_encoding(&[(
            "Transfer-Encoding".into(),
            "gzip, chunked".into()
        )]));
    }

    #[test]
    fn websocket_tunnel_copies_both_directions_without_lock_starvation() {
        let client_listener = TcpListener::bind((KIMI_HOST, 0)).unwrap();
        client_listener.set_nonblocking(true).unwrap();
        let upstream_listener = TcpListener::bind((KIMI_HOST, 0)).unwrap();
        let mut browser = TcpStream::connect(client_listener.local_addr().unwrap()).unwrap();
        let proxy_client = loop {
            match client_listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::yield_now();
                }
                Err(error) => panic!("failed to accept test client: {error}"),
            }
        };
        proxy_client.set_nonblocking(false).unwrap();
        let mut kimi = TcpStream::connect(upstream_listener.local_addr().unwrap()).unwrap();
        let (proxy_upstream, _) = upstream_listener.accept().unwrap();
        browser
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        kimi.set_read_timeout(Some(Duration::from_secs(2))).unwrap();

        let tunnel = thread::spawn(move || {
            tunnel_websocket_streams(&proxy_client, &proxy_upstream).unwrap()
        });
        browser.write_all(b"client-hello").unwrap();
        kimi.write_all(b"stream-delta").unwrap();

        let mut upstream_received = [0u8; 12];
        kimi.read_exact(&mut upstream_received).unwrap();
        assert_eq!(&upstream_received, b"client-hello");
        let mut browser_received = [0u8; 12];
        browser.read_exact(&mut browser_received).unwrap();
        assert_eq!(&browser_received, b"stream-delta");

        browser.shutdown(std::net::Shutdown::Both).unwrap();
        kimi.shutdown(std::net::Shutdown::Both).unwrap();
        assert_eq!(tunnel.join().unwrap(), 12);
    }
}
