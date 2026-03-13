use std::time::Duration;

use anyhow::Context;
use reqwest::blocking::Client;

use crate::types::{BindingRecord, BridgeStatus};

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
        self.request(reqwest::Method::GET, "/api/v1/status")?
            .send()
            .context("failed to request bridge status")?
            .error_for_status()
            .context("bridge status returned error status")?
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
}
