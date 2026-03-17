use std::time::Duration;

use anyhow::{bail, Context};
use reqwest::blocking::Client;

use crate::types::{
    BindingRecord, BridgeApprovalRecord, BridgeApprovalResolveInput, BridgeSessionImportInput,
    BridgeSessionRecord, BridgeStatus,
};

const ADMIN_TOKEN_HEADER: &str = "X-Bridge-Admin-Token";

#[derive(Debug, Clone)]
pub struct BridgeHttpClient {
    base_url: String,
    admin_token: String,
    client: Client,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BindingListResponse {
    items: Vec<BindingRecord>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalListResponse {
    items: Vec<BridgeApprovalRecord>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionListResponse {
    items: Vec<AdminBridgeSessionRecord>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdminBridgeSessionRecord {
    kimi_session_id: String,
    work_dir: Option<String>,
    last_message_at: Option<String>,
    summary: Option<String>,
    session_state: Option<String>,
    lease_owner: Option<String>,
    lease_expires_at: Option<String>,
    auto_approve: bool,
    provider_name: Option<String>,
    runtime_metadata_json: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

impl BridgeHttpClient {
    pub fn new(
        base_url: impl Into<String>,
        admin_token: impl Into<String>,
    ) -> anyhow::Result<Self> {
        let client = Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .context("failed to build bridge http client")?;
        Ok(Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            admin_token: admin_token.into(),
            client,
        })
    }

    pub fn for_local_admin_port(
        admin_port: u16,
        admin_token: impl Into<String>,
    ) -> anyhow::Result<Self> {
        Self::new(format!("http://127.0.0.1:{admin_port}"), admin_token)
    }

    pub fn healthz(&self) -> anyhow::Result<()> {
        let response = self
            .client
            .get(format!("{}/healthz", self.base_url))
            .send()
            .context("failed to request bridge health")?;
        response
            .error_for_status()
            .context("bridge health returned error status")?;
        Ok(())
    }

    pub fn get_status(&self) -> anyhow::Result<BridgeStatus> {
        let response = self
            .request(reqwest::Method::GET, "/api/v1/status")?
            .send()
            .context("failed to request bridge status")?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            let detail = body.trim();
            if detail.is_empty() {
                bail!("bridge status returned error status: {status}");
            }
            bail!("bridge status returned error status: {status} {detail}");
        }
        response
            .json::<BridgeStatus>()
            .context("failed to decode bridge status")
    }

    pub fn list_bindings(&self) -> anyhow::Result<Vec<BindingRecord>> {
        let payload = self
            .request(reqwest::Method::GET, "/api/v1/bindings")?
            .send()
            .context("failed to request bridge bindings")?
            .error_for_status()
            .context("bridge bindings returned error status")?
            .json::<BindingListResponse>()
            .context("failed to decode bridge bindings payload")?;
        Ok(payload.items)
    }

    pub fn list_sessions(&self) -> anyhow::Result<Vec<BridgeSessionRecord>> {
        let payload = self
            .request(reqwest::Method::GET, "/api/v1/sessions")?
            .send()
            .context("failed to request bridge sessions")?
            .error_for_status()
            .context("bridge sessions returned error status")?
            .json::<SessionListResponse>()
            .context("failed to decode bridge sessions payload")?;
        Ok(payload
            .items
            .into_iter()
            .map(map_admin_session_record)
            .collect())
    }

    pub fn clear_binding(&self, binding_id: &str) -> anyhow::Result<()> {
        self.request(
            reqwest::Method::DELETE,
            &format!("/api/v1/bindings/{binding_id}"),
        )?
        .send()
        .context("failed to clear bridge binding")?
        .error_for_status()
        .context("bridge clear binding returned error status")?;
        Ok(())
    }

    pub fn list_approvals(
        &self,
        status: Option<&str>,
    ) -> anyhow::Result<Vec<BridgeApprovalRecord>> {
        let mut request = self.request(reqwest::Method::GET, "/api/v1/approvals")?;
        if let Some(status) = status.filter(|value| !value.trim().is_empty()) {
            request = request.query(&[("status", status)]);
        }
        let payload = request
            .send()
            .context("failed to request bridge approvals")?
            .error_for_status()
            .context("bridge approvals returned error status")?
            .json::<ApprovalListResponse>()
            .context("failed to decode bridge approvals payload")?;
        Ok(payload.items)
    }

    pub fn resolve_approval(&self, input: &BridgeApprovalResolveInput) -> anyhow::Result<()> {
        self.request(
            reqwest::Method::POST,
            &format!("/api/v1/approvals/{}/resolve", input.approval_id),
        )?
        .json(input)
        .send()
        .context("failed to resolve bridge approval")?
        .error_for_status()
        .context("bridge resolve approval returned error status")?;
        Ok(())
    }

    pub fn import_session(
        &self,
        input: &BridgeSessionImportInput,
    ) -> anyhow::Result<BridgeSessionRecord> {
        self.request(reqwest::Method::POST, "/api/v1/sessions/import")?
            .json(input)
            .send()
            .context("failed to import bridge session")?
            .error_for_status()
            .context("bridge import session returned error status")?
            .json::<AdminBridgeSessionRecord>()
            .map(map_admin_session_record)
            .context("failed to decode imported bridge session")
    }

    pub fn stop_runtime(&self) -> anyhow::Result<()> {
        self.request(reqwest::Method::POST, "/api/v1/runtime/stop")?
            .send()
            .context("failed to request bridge runtime stop")?
            .error_for_status()
            .context("bridge runtime stop returned error status")?;
        Ok(())
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> anyhow::Result<reqwest::blocking::RequestBuilder> {
        Ok(self
            .client
            .request(method, format!("{}{}", self.base_url, path))
            .header(ADMIN_TOKEN_HEADER, &self.admin_token))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread};

    use tiny_http::{Header, Response, Server};

    #[test]
    fn requests_include_admin_token_header() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            let header = request
                .headers()
                .iter()
                .find(|item| item.field.equiv(ADMIN_TOKEN_HEADER))
                .map(|item| item.value.as_str().to_string());
            sender.send(header).expect("header should be forwarded");

            let response = Response::from_string(
                r#"{"state":"running","adminPort":60110,"channels":[],"pendingApprovals":0,"bindings":0}"#,
            )
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        let status = client.get_status().expect("status should decode");

        assert_eq!(status.state, crate::types::BridgeRuntimeState::Running);
        assert_eq!(
            receiver
                .recv()
                .expect("header should be captured")
                .as_deref(),
            Some("bridge-token")
        );
    }

    #[test]
    fn stop_runtime_uses_post_method() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            sender
                .send(request.method().as_str().to_string())
                .expect("method should be forwarded");
            let response = Response::empty(202);
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        client
            .stop_runtime()
            .expect("stop_runtime should accept 202 response");

        assert_eq!(
            receiver.recv().expect("method should be captured"),
            "POST".to_string()
        );
    }

    #[test]
    fn list_approvals_uses_status_query_and_decodes_payload() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            sender
                .send(request.url().to_string())
                .expect("url should be forwarded");
            let response = Response::from_string(
                r#"{"items":[{"approvalId":"approval-1","kimiSessionId":"session-1","requestKind":"confirm","prompt":"Ship it?","platform":"telegram","chatId":"chat-1","status":"pending","requestPayloadJson":"{}","dedupeKey":"dedupe-1","createdAt":"2026-03-13T10:00:00Z","updatedAt":"2026-03-13T10:00:00Z"}]}"#,
            )
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        let approvals = client
            .list_approvals(Some("pending"))
            .expect("approvals should decode");

        assert_eq!(approvals.len(), 1);
        assert_eq!(approvals[0].approval_id, "approval-1");
        assert_eq!(
            receiver.recv().expect("url should be captured"),
            "/api/v1/approvals?status=pending".to_string()
        );
    }

    #[test]
    fn resolve_approval_posts_json_payload() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            let mut request = server.recv().expect("request should arrive");
            let mut body = String::new();
            request
                .as_reader()
                .read_to_string(&mut body)
                .expect("request body should be readable");
            sender
                .send((
                    request.method().as_str().to_string(),
                    request.url().to_string(),
                    body,
                ))
                .expect("payload should be forwarded");
            let response = Response::empty(200);
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        client
            .resolve_approval(&BridgeApprovalResolveInput {
                approval_id: "approval-1".to_string(),
                status: "approved".to_string(),
                resolution_payload_json: Some(r#"{"decision":"yes"}"#.to_string()),
            })
            .expect("resolve_approval should succeed");

        let (method, url, body) = receiver.recv().expect("payload should be captured");
        assert_eq!(method, "POST");
        assert_eq!(url, "/api/v1/approvals/approval-1/resolve");
        assert!(body.contains(r#""status":"approved""#));
        assert!(body.contains(r#""resolutionPayloadJson":"{\"decision\":\"yes\"}""#));
    }

    #[test]
    fn list_sessions_decodes_payload() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());

        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            let response = Response::from_string(
                r#"{"items":[{"kimiSessionId":"session-1","workDir":"D:/repo","summary":"summary","autoApprove":false,"createdAt":"2026-03-17T00:00:00Z","updatedAt":"2026-03-17T00:00:00Z"}]}"#,
            )
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        let sessions = client.list_sessions().expect("sessions should decode");

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "session-1");
        assert!(sessions[0].switchable);
    }

    #[test]
    fn import_session_posts_payload_and_decodes_response() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            let mut request = server.recv().expect("request should arrive");
            let mut body = String::new();
            request
                .as_reader()
                .read_to_string(&mut body)
                .expect("request body should be readable");
            sender.send(body).expect("payload should be forwarded");
            let response = Response::from_string(
                r#"{"kimiSessionId":"session-9","workDir":"D:/repo","summary":"Imported","autoApprove":false,"createdAt":"2026-03-17T00:00:00Z","updatedAt":"2026-03-17T00:00:00Z"}"#,
            )
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        let imported = client
            .import_session(&BridgeSessionImportInput {
                source: crate::types::BridgeSessionSource::ShellWeb,
                source_session_id: "web-1".to_string(),
                work_dir: Some("D:/repo".to_string()),
                summary: Some("Imported".to_string()),
            })
            .expect("import_session should succeed");

        let body = receiver.recv().expect("payload should be captured");
        assert!(body.contains(r#""source":"shell_web""#));
        assert!(body.contains(r#""sourceSessionId":"web-1""#));
        assert_eq!(imported.session_id, "session-9");
    }
}

fn map_admin_session_record(session: AdminBridgeSessionRecord) -> BridgeSessionRecord {
    BridgeSessionRecord {
        source: crate::types::BridgeSessionSource::Bridge,
        session_id: session.kimi_session_id,
        work_dir: session.work_dir,
        last_message_at: session.last_message_at,
        summary: session.summary,
        session_state: session.session_state,
        lease_owner: session.lease_owner,
        lease_expires_at: session.lease_expires_at,
        auto_approve: session.auto_approve,
        provider_name: session.provider_name,
        runtime_metadata_json: session.runtime_metadata_json,
        created_at: session.created_at,
        updated_at: session.updated_at,
        switchable: true,
        importable: false,
    }
}
