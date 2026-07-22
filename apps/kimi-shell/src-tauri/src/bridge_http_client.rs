use std::time::Duration;

use anyhow::{bail, Context};
use reqwest::blocking::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

use crate::types::{
    AgentConnectorBinding, AgentConnectorBindingInput, AgentProfile, AgentProfileInput,
    AgentProfilePatchInput, AgentRoom, AgentRoomCapability, AgentRoomCommandError, AgentRoomDetail,
    AgentRoomDispatchResult, AgentRoomEventPage, AgentRoomInput, AgentRoomList, AgentRoomMember,
    AgentRoomMemberInput, AgentRoomMemberPatchInput, AgentRoomMutationResult,
    AgentRoomObservationPage, AgentRoomObservationPinResult, AgentRoomPage, AgentRoomPatchInput,
    AgentRoomPostMessageInput, AgentRoomTimeline, AgentRun, AgentRunRetryInput, BindingRecord,
    BridgeApprovalRecord, BridgeApprovalResolveInput, BridgeSessionImportInput,
    BridgeSessionRecord, BridgeStatus, PaneSessionSyncInput, PaneSessionSyncResult,
};

const ADMIN_TOKEN_HEADER: &str = "X-Bridge-Admin-Token";

#[derive(Clone)]
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
struct BridgeAdminEnvelope {
    ok: bool,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<BridgeAdminError>,
    #[serde(default)]
    request_id: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BridgeAdminError {
    code: String,
    message: String,
    #[serde(default)]
    details: Option<Value>,
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
    #[serde(default)]
    auto_approve: bool,
    provider_name: Option<String>,
    runtime_metadata_json: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingUpdateInput {
    pub kimi_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_dir: Option<String>,
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
        decode_admin_response(response, "status")
    }

    pub fn list_bindings(&self) -> anyhow::Result<Vec<BindingRecord>> {
        let payload = self
            .request(reqwest::Method::GET, "/api/v1/bindings")?
            .send()
            .context("failed to request bridge bindings")
            .and_then(|response| {
                decode_admin_response::<BindingListResponse>(response, "bindings")
            })?;
        Ok(payload.items)
    }

    pub fn list_sessions(&self) -> anyhow::Result<Vec<BridgeSessionRecord>> {
        let payload = self
            .request(reqwest::Method::GET, "/api/v1/sessions")?
            .send()
            .context("failed to request bridge sessions")
            .and_then(|response| {
                decode_admin_response::<SessionListResponse>(response, "sessions")
            })?;
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
        .context("failed to clear bridge binding")
        .and_then(|response| decode_admin_empty(response, "clear binding"))?;
        Ok(())
    }

    pub fn update_binding(
        &self,
        binding_id: &str,
        input: &BindingUpdateInput,
    ) -> anyhow::Result<BindingRecord> {
        self.request(
            reqwest::Method::PATCH,
            &format!("/api/v1/bindings/{binding_id}"),
        )?
        .json(input)
        .send()
        .context("failed to update bridge binding")
        .and_then(|response| decode_admin_response::<BindingRecord>(response, "update binding"))
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
            .context("failed to request bridge approvals")
            .and_then(|response| {
                decode_admin_response::<ApprovalListResponse>(response, "approvals")
            })?;
        Ok(payload.items)
    }

    pub fn resolve_approval(&self, input: &BridgeApprovalResolveInput) -> anyhow::Result<()> {
        self.request(
            reqwest::Method::POST,
            &format!("/api/v1/approvals/{}/resolve", input.approval_id),
        )?
        .json(input)
        .send()
        .context("failed to resolve bridge approval")
        .and_then(|response| decode_admin_empty(response, "resolve approval"))?;
        Ok(())
    }

    pub fn import_session(
        &self,
        input: &BridgeSessionImportInput,
    ) -> anyhow::Result<BridgeSessionRecord> {
        self.request(reqwest::Method::POST, "/api/v1/sessions/import")?
            .json(input)
            .send()
            .context("failed to import bridge session")
            .and_then(|response| {
                decode_admin_response::<AdminBridgeSessionRecord>(response, "import session")
            })
            .map(map_admin_session_record)
    }

    pub fn stop_runtime(&self) -> anyhow::Result<()> {
        self.request(reqwest::Method::POST, "/api/v1/runtime/stop")?
            .send()
            .context("failed to request bridge runtime stop")
            .and_then(|response| decode_admin_empty(response, "runtime stop"))?;
        Ok(())
    }

    pub fn agent_room_list_agents(
        &self,
    ) -> Result<AgentRoomList<AgentProfile>, AgentRoomCommandError> {
        self.agent_room_get("/api/v1/agent-room/agents", "list agents")
    }

    pub fn agent_room_create_agent(
        &self,
        input: &AgentProfileInput,
    ) -> Result<AgentProfile, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            "/api/v1/agent-room/agents",
            input,
            "create agent",
        )
    }

    pub fn agent_room_update_agent(
        &self,
        agent_id: &str,
        input: &AgentProfilePatchInput,
    ) -> Result<AgentProfile, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::PATCH,
            &format!("/api/v1/agent-room/agents/{agent_id}"),
            input,
            "update agent",
        )
    }

    pub fn agent_room_delete_agent(
        &self,
        agent_id: &str,
    ) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
        self.agent_room_get_with_method(
            reqwest::Method::DELETE,
            &format!("/api/v1/agent-room/agents/{agent_id}"),
            "delete agent",
        )
    }

    pub fn agent_room_list_rooms(
        &self,
        archived: Option<bool>,
        limit: usize,
        cursor: Option<&str>,
    ) -> Result<AgentRoomPage<AgentRoom>, AgentRoomCommandError> {
        let mut request = self.agent_room_request(reqwest::Method::GET, "/api/v1/agent-room/rooms");
        request = request.query(&[("limit", limit.to_string())]);
        if let Some(archived) = archived {
            request = request.query(&[("archived", archived)]);
        }
        if let Some(cursor) = cursor.filter(|value| !value.trim().is_empty()) {
            request = request.query(&[("cursor", cursor)]);
        }
        send_agent_room(request, "list rooms", &self.admin_token)
    }

    pub fn agent_room_get_room(
        &self,
        room_id: &str,
    ) -> Result<AgentRoomDetail, AgentRoomCommandError> {
        self.agent_room_get(&format!("/api/v1/agent-room/rooms/{room_id}"), "get room")
    }

    pub fn agent_room_create_room(
        &self,
        input: &AgentRoomInput,
    ) -> Result<AgentRoom, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            "/api/v1/agent-room/rooms",
            input,
            "create room",
        )
    }

    pub fn agent_room_update_room(
        &self,
        room_id: &str,
        input: &AgentRoomPatchInput,
    ) -> Result<AgentRoom, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::PATCH,
            &format!("/api/v1/agent-room/rooms/{room_id}"),
            input,
            "update room",
        )
    }

    pub fn agent_room_delete_room(
        &self,
        room_id: &str,
    ) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::DELETE,
            &format!("/api/v1/agent-room/rooms/{room_id}"),
            &serde_json::json!({"confirm": true}),
            "delete room",
        )
    }

    pub fn agent_room_list_members(
        &self,
        room_id: &str,
    ) -> Result<AgentRoomList<AgentRoomMember>, AgentRoomCommandError> {
        self.agent_room_get(
            &format!("/api/v1/agent-room/rooms/{room_id}/members"),
            "list members",
        )
    }

    pub fn agent_room_add_member(
        &self,
        room_id: &str,
        input: &AgentRoomMemberInput,
    ) -> Result<AgentRoomMember, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            &format!("/api/v1/agent-room/rooms/{room_id}/members"),
            input,
            "add member",
        )
    }

    pub fn agent_room_update_member(
        &self,
        room_id: &str,
        member_id: &str,
        input: &AgentRoomMemberPatchInput,
    ) -> Result<AgentRoomMember, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::PATCH,
            &format!("/api/v1/agent-room/rooms/{room_id}/members/{member_id}"),
            input,
            "update member",
        )
    }

    pub fn agent_room_delete_member(
        &self,
        room_id: &str,
        member_id: &str,
    ) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
        self.agent_room_get_with_method(
            reqwest::Method::DELETE,
            &format!("/api/v1/agent-room/rooms/{room_id}/members/{member_id}"),
            "delete member",
        )
    }

    pub fn agent_room_get_timeline(
        &self,
        room_id: &str,
        after_seq: i64,
        before_seq: i64,
        limit: usize,
    ) -> Result<AgentRoomTimeline, AgentRoomCommandError> {
        let request = self
            .agent_room_request(
                reqwest::Method::GET,
                &format!("/api/v1/agent-room/rooms/{room_id}/timeline"),
            )
            .query(&[
                ("afterSeq", after_seq.to_string()),
                ("beforeSeq", before_seq.to_string()),
                ("limit", limit.to_string()),
            ]);
        send_agent_room(request, "get timeline", &self.admin_token)
    }

    pub fn agent_room_post_message(
        &self,
        room_id: &str,
        input: &AgentRoomPostMessageInput,
    ) -> Result<AgentRoomDispatchResult, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            &format!("/api/v1/agent-room/rooms/{room_id}/messages"),
            input,
            "post message",
        )
    }

    pub fn agent_room_resolve_workflow(
        &self,
        room_id: &str,
        message_id: &str,
        decision: &str,
    ) -> Result<AgentRoomDispatchResult, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            &format!("/api/v1/agent-room/rooms/{room_id}/workflows/{message_id}/resolve"),
            &serde_json::json!({"decision": decision}),
            "resolve workflow",
        )
    }

    pub fn agent_room_list_connector_bindings(
        &self,
    ) -> Result<AgentRoomList<AgentConnectorBinding>, AgentRoomCommandError> {
        self.agent_room_get(
            "/api/v1/agent-room/connector-bindings",
            "list connector bindings",
        )
    }

    pub fn agent_room_put_connector_binding(
        &self,
        connector_id: &str,
        input: &AgentConnectorBindingInput,
    ) -> Result<AgentConnectorBinding, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::PUT,
            &format!("/api/v1/agent-room/connector-bindings/{connector_id}"),
            input,
            "put connector binding",
        )
    }

    pub fn agent_room_delete_connector_binding(
        &self,
        connector_id: &str,
    ) -> Result<AgentRoomMutationResult, AgentRoomCommandError> {
        self.agent_room_get_with_method(
            reqwest::Method::DELETE,
            &format!("/api/v1/agent-room/connector-bindings/{connector_id}"),
            "delete connector binding",
        )
    }

    pub fn agent_room_get_run(&self, run_id: &str) -> Result<AgentRun, AgentRoomCommandError> {
        self.agent_room_get(&format!("/api/v1/agent-room/runs/{run_id}"), "get run")
    }

    pub fn agent_room_abort_run(&self, run_id: &str) -> Result<AgentRun, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            &format!("/api/v1/agent-room/runs/{run_id}/abort"),
            &serde_json::json!({}),
            "abort run",
        )
    }

    pub fn agent_room_retry_run(
        &self,
        run_id: &str,
        input: &AgentRunRetryInput,
    ) -> Result<AgentRun, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            &format!("/api/v1/agent-room/runs/{run_id}/retry"),
            input,
            "retry run",
        )
    }

    pub fn agent_room_list_observations(
        &self,
    ) -> Result<AgentRoomObservationPage, AgentRoomCommandError> {
        self.agent_room_get("/api/v1/agent-room/observations", "list observations")
    }

    pub fn agent_room_set_observation_pin(
        &self,
        session_id: &str,
        pinned: bool,
    ) -> Result<AgentRoomObservationPinResult, AgentRoomCommandError> {
        self.agent_room_get_with_method(
            if pinned {
                reqwest::Method::POST
            } else {
                reqwest::Method::DELETE
            },
            &format!("/api/v1/agent-room/observations/{session_id}/pin"),
            if pinned {
                "pin observation"
            } else {
                "unpin observation"
            },
        )
    }

    pub fn agent_room_sync_pane_sessions(
        &self,
        input: &PaneSessionSyncInput,
    ) -> Result<PaneSessionSyncResult, AgentRoomCommandError> {
        self.agent_room_json(
            reqwest::Method::POST,
            "/api/v1/agent-room/pane-sessions/sync",
            input,
            "sync pane sessions",
        )
    }

    pub fn agent_room_get_capabilities(
        &self,
    ) -> Result<AgentRoomCapability, AgentRoomCommandError> {
        self.agent_room_get("/api/v1/agent-room/capabilities", "get capabilities")
    }

    pub fn agent_room_resolve_approval(
        &self,
        input: &BridgeApprovalResolveInput,
    ) -> Result<(), AgentRoomCommandError> {
        let approvals = self.agent_room_list_all_approvals(None)?;
        let approval = approvals
            .iter()
            .find(|item| item.approval_id == input.approval_id)
            .ok_or_else(|| {
                AgentRoomCommandError::local(
                    "approval_not_found",
                    "Agent Room approval was not found",
                )
            })?;
        if approval.platform != crate::types::BridgeApprovalPlatform::AgentRoom {
            return Err(AgentRoomCommandError::local(
                "approval_conflict",
                "Approval does not belong to Agent Room",
            ));
        }
        let request = self
            .agent_room_request(
                reqwest::Method::POST,
                &format!("/api/v1/approvals/{}/resolve", input.approval_id),
            )
            .json(input);
        let _: Value = send_agent_room(request, "resolve approval", &self.admin_token)?;
        Ok(())
    }

    fn agent_room_list_all_approvals(
        &self,
        status: Option<&str>,
    ) -> Result<Vec<BridgeApprovalRecord>, AgentRoomCommandError> {
        let mut request = self.agent_room_request(reqwest::Method::GET, "/api/v1/approvals");
        if let Some(status) = status.filter(|value| !value.trim().is_empty()) {
            request = request.query(&[("status", status)]);
        }
        let payload: ApprovalListResponse =
            send_agent_room(request, "list Agent Room approvals", &self.admin_token)?;
        Ok(payload.items)
    }

    pub fn agent_room_poll_events(
        &self,
        after_seq: i64,
        room_id: Option<&str>,
        limit: usize,
        wait_ms: u64,
    ) -> Result<AgentRoomEventPage, AgentRoomCommandError> {
        let mut request = self
            .agent_room_request(reqwest::Method::GET, "/api/v1/agent-room/events")
            .query(&[
                ("afterSeq", after_seq.to_string()),
                ("limit", limit.to_string()),
                ("waitMs", wait_ms.to_string()),
            ])
            .timeout(Duration::from_millis(wait_ms.saturating_add(5_000)));
        if let Some(room_id) = room_id.filter(|value| !value.trim().is_empty()) {
            request = request.query(&[("roomId", room_id)]);
        }
        send_agent_room(request, "poll events", &self.admin_token)
    }

    fn agent_room_get<T>(&self, path: &str, label: &str) -> Result<T, AgentRoomCommandError>
    where
        T: DeserializeOwned,
    {
        send_agent_room(
            self.agent_room_request(reqwest::Method::GET, path),
            label,
            &self.admin_token,
        )
    }

    fn agent_room_get_with_method<T>(
        &self,
        method: reqwest::Method,
        path: &str,
        label: &str,
    ) -> Result<T, AgentRoomCommandError>
    where
        T: DeserializeOwned,
    {
        send_agent_room(
            self.agent_room_request(method, path),
            label,
            &self.admin_token,
        )
    }

    fn agent_room_json<T, B>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: &B,
        label: &str,
    ) -> Result<T, AgentRoomCommandError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        send_agent_room(
            self.agent_room_request(method, path).json(body),
            label,
            &self.admin_token,
        )
    }

    fn agent_room_request(
        &self,
        method: reqwest::Method,
        path: &str,
    ) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(method, format!("{}{}", self.base_url, path))
            .header(ADMIN_TOKEN_HEADER, &self.admin_token)
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

fn send_agent_room<T>(
    request: reqwest::blocking::RequestBuilder,
    label: &str,
    admin_token: &str,
) -> Result<T, AgentRoomCommandError>
where
    T: DeserializeOwned,
{
    let response = request.send().map_err(|_| {
        AgentRoomCommandError::local(
            "bridge_unavailable",
            format!("Agent Room {label} request failed"),
        )
    })?;
    decode_agent_room_response(response, label, admin_token)
}

fn decode_agent_room_response<T>(
    response: reqwest::blocking::Response,
    label: &str,
    admin_token: &str,
) -> Result<T, AgentRoomCommandError>
where
    T: DeserializeOwned,
{
    let status = response.status().as_u16();
    let value = response
        .json::<Value>()
        .map_err(|_| AgentRoomCommandError {
            code: "invalid_bridge_response".to_string(),
            message: format!("Agent Room {label} returned invalid JSON"),
            details: None,
            request_id: None,
            http_status: Some(status),
        })?;
    let envelope = serde_json::from_value::<BridgeAdminEnvelope>(value).map_err(|_| {
        AgentRoomCommandError {
            code: "invalid_bridge_response".to_string(),
            message: format!("Agent Room {label} returned an invalid envelope"),
            details: None,
            request_id: None,
            http_status: Some(status),
        }
    })?;
    if !envelope.ok || !(200..300).contains(&status) {
        let error = envelope.error.unwrap_or(BridgeAdminError {
            code: "bridge_error".to_string(),
            message: format!("Agent Room {label} failed"),
            details: None,
        });
        return Err(AgentRoomCommandError {
            code: redact_agent_room_text(&error.code, admin_token),
            message: redact_agent_room_text(&error.message, admin_token),
            details: error
                .details
                .map(|details| redact_agent_room_value(details, admin_token)),
            request_id: envelope
                .request_id
                .map(|request_id| redact_agent_room_text(&request_id, admin_token)),
            http_status: Some(status),
        });
    }
    serde_json::from_value(envelope.data.unwrap_or(Value::Null)).map_err(|_| {
        AgentRoomCommandError {
            code: "invalid_bridge_response".to_string(),
            message: format!("Agent Room {label} returned an invalid payload"),
            details: None,
            request_id: envelope.request_id,
            http_status: Some(status),
        }
    })
}

fn redact_agent_room_text(value: &str, admin_token: &str) -> String {
    if admin_token.is_empty() {
        value.to_string()
    } else {
        value.replace(admin_token, "[REDACTED]")
    }
}

fn redact_agent_room_value(value: Value, admin_token: &str) -> Value {
    match value {
        Value::String(value) => Value::String(redact_agent_room_text(&value, admin_token)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| redact_agent_room_value(item, admin_token))
                .collect(),
        ),
        Value::Object(items) => Value::Object(
            items
                .into_iter()
                .map(|(key, value)| {
                    (
                        redact_agent_room_text(&key, admin_token),
                        redact_agent_room_value(value, admin_token),
                    )
                })
                .collect(),
        ),
        value => value,
    }
}

fn decode_admin_empty(response: reqwest::blocking::Response, label: &str) -> anyhow::Result<()> {
    let status = response.status();
    let body = response
        .text()
        .with_context(|| format!("failed to read bridge {label} response body"))?;
    if body.trim().is_empty() {
        if status.is_success() {
            return Ok(());
        }
        bail!("bridge {label} returned error status {status} with an empty body");
    }
    let _: Value = decode_admin_response_body(status, &body, label)?;
    Ok(())
}

fn decode_admin_response<T>(response: reqwest::blocking::Response, label: &str) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    let status = response.status();
    let body = response
        .text()
        .with_context(|| format!("failed to read bridge {label} response body"))?;
    decode_admin_response_body(status, &body, label)
}

fn decode_admin_response_body<T>(
    status: reqwest::StatusCode,
    body: &str,
    label: &str,
) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    let value = serde_json::from_str::<Value>(body).with_context(|| {
        format!(
            "failed to decode bridge {label} response JSON: {}",
            truncate_for_error(body, 240)
        )
    })?;
    let is_envelope = value.get("ok").and_then(Value::as_bool).is_some()
        && (value.get("data").is_some() || value.get("error").is_some());

    if !status.is_success() {
        if is_envelope {
            return bridge_envelope_error(label, status.as_u16(), value);
        }
        bail!(
            "bridge {label} returned error status {status}: {}",
            truncate_for_error(body, 240)
        );
    }

    let payload = if is_envelope {
        let envelope: BridgeAdminEnvelope = serde_json::from_value(value)
            .with_context(|| format!("failed to decode bridge {label} envelope"))?;
        if !envelope.ok {
            return bridge_admin_error(label, status.as_u16(), &envelope);
        }
        envelope.data.unwrap_or(Value::Null)
    } else {
        value
    };

    serde_json::from_value(payload)
        .with_context(|| format!("failed to decode bridge {label} payload"))
}

fn bridge_envelope_error<T>(label: &str, status: u16, value: Value) -> anyhow::Result<T> {
    let envelope: BridgeAdminEnvelope = serde_json::from_value(value)
        .with_context(|| format!("failed to decode bridge {label} error envelope"))?;
    bridge_admin_error(label, status, &envelope)
}

fn bridge_admin_error<T>(
    label: &str,
    status: u16,
    envelope: &BridgeAdminEnvelope,
) -> anyhow::Result<T> {
    let request_id = envelope
        .request_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!(" request_id={value}"))
        .unwrap_or_default();
    if let Some(error) = envelope.error.as_ref() {
        bail!(
            "bridge {label} returned error status {status}{request_id}: {} ({})",
            error.message,
            error.code
        );
    }
    bail!("bridge {label} returned error status {status}{request_id}")
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
                r#"{"ok":true,"data":{"state":"running","adminPort":60110,"channels":[],"pendingApprovals":0,"bindings":0},"requestId":"r1"}"#,
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
        assert!(status.connectors.is_empty());
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
    fn envelope_error_includes_code_and_request_id() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());

        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            let response = Response::from_string(
                r#"{"ok":false,"error":{"code":"unauthorized","message":"invalid admin token"},"requestId":"r-error"}"#,
            )
            .with_status_code(401)
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client = BridgeHttpClient::new(address, "bad-token").expect("client should be created");
        let error = client.get_status().expect_err("status should fail");
        let message = error.to_string();
        assert!(message.contains("unauthorized"));
        assert!(message.contains("request_id=r-error"));
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
    fn list_sessions_defaults_missing_auto_approve_to_false() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());

        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            let response = Response::from_string(
                r#"{"items":[{"kimiSessionId":"session-2","workDir":"D:/repo","summary":"summary","createdAt":"2026-03-17T00:00:00Z","updatedAt":"2026-03-17T00:00:00Z"}]}"#,
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
        assert_eq!(sessions[0].session_id, "session-2");
        assert!(!sessions[0].auto_approve);
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

    #[test]
    fn update_binding_patches_payload_and_decodes_response() {
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
            let response = Response::from_string(
                r#"{"bindingId":"binding-1","platform":"telegram","chatId":"chat-1","kimiSessionId":"session-next","workDir":"D:/repo","createdAt":"2026-03-19T00:00:00Z","updatedAt":"2026-03-19T00:00:01Z"}"#,
            )
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        let updated = client
            .update_binding(
                "binding-1",
                &BindingUpdateInput {
                    kimi_session_id: "session-next".to_string(),
                    work_dir: Some("D:/repo".to_string()),
                },
            )
            .expect("update binding should succeed");

        let (method, url, body) = receiver.recv().expect("payload should be captured");
        assert_eq!(method, "PATCH");
        assert_eq!(url, "/api/v1/bindings/binding-1");
        assert!(body.contains(r#""kimiSessionId":"session-next""#));
        assert!(body.contains(r#""workDir":"D:/repo""#));
        assert_eq!(updated.binding_id, "binding-1");
        assert_eq!(updated.kimi_session_id, "session-next");
    }

    #[test]
    fn agent_room_preserves_typed_error_without_raw_body_or_token() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            let response = Response::from_string(
                r#"{"ok":false,"error":{"code":"stale_generation","message":"stale admin-token-secret","details":{"acceptedGeneration":7,"token":"admin-token-secret","admin-token-secret":"nested"}},"requestId":"req-7","raw":"admin-token-secret"}"#,
            )
            .with_status_code(409)
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "admin-token-secret").expect("client should be created");
        let error = client
            .agent_room_sync_pane_sessions(&PaneSessionSyncInput {
                generation: 1,
                panes: Vec::new(),
            })
            .expect_err("stale generation should fail");
        assert_eq!(error.code, "stale_generation");
        assert_eq!(error.request_id.as_deref(), Some("req-7"));
        assert_eq!(error.http_status, Some(409));
        assert_eq!(
            error
                .details
                .as_ref()
                .and_then(|v| v["acceptedGeneration"].as_i64()),
            Some(7)
        );
        let display = error.to_string();
        let debug = format!("{error:?}");
        let serialized = serde_json::to_string(&error).expect("error should serialize");
        assert!(!error.message.contains("admin-token-secret"));
        assert!(!error
            .details
            .as_ref()
            .is_some_and(|value| value.to_string().contains("admin-token-secret")));
        assert!(!display.contains("admin-token-secret"));
        assert!(!debug.contains("admin-token-secret"));
        assert!(!serialized.contains("admin-token-secret"));
    }

    #[test]
    fn agent_room_long_poll_overrides_short_client_timeout() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        thread::spawn(move || {
            let request = server.recv().expect("request should arrive");
            assert!(request.url().contains("waitMs=3100"));
            thread::sleep(Duration::from_millis(3_100));
            let response = Response::from_string(
                r#"{"ok":true,"data":{"items":[],"nextSeq":9,"hasMore":false,"serverTime":"2026-07-19T00:00:00Z"},"requestId":"req-poll"}"#,
            )
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        let page = client
            .agent_room_poll_events(9, None, 100, 3_100)
            .expect("long poll should outlive the default three second timeout");
        assert_eq!(page.next_seq, 9);
    }

    #[test]
    fn agent_room_decodes_core_admin_contracts() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        thread::spawn(move || {
            for _ in 0..11 {
                let request = server.recv().expect("request should arrive");
                let path = request.url().split('?').next().unwrap_or_default();
                let data = match path {
                    "/api/v1/agent-room/agents" => {
                        r#"{"items":[{"agentId":"a1","name":"Agent","rolePrompt":"Review","defaultWorkDir":"D:/repo","sessionPolicy":"per_room","autoApprove":false,"enabled":true,"revision":1,"createdAt":"t1","updatedAt":"t1"}]}"#
                    }
                    "/api/v1/agent-room/rooms" => {
                        r#"{"items":[{"roomId":"r1","title":"Room","orchestrationMode":"direct","archived":false,"createdAt":"t1","updatedAt":"t1"}],"cursor":"next"}"#
                    }
                    "/api/v1/agent-room/rooms/r1" => {
                        r#"{"room":{"roomId":"r1","title":"Room","orchestrationMode":"direct","archived":false,"createdAt":"t1","updatedAt":"t1"},"members":[]}"#
                    }
                    "/api/v1/agent-room/rooms/r1/members" => {
                        r#"{"items":[{"memberId":"m1","roomId":"r1","memberKind":"agent","displayName":"Agent","sessionPolicy":"per_room","followMode":"pin_session","autoApprove":false,"status":"ready","createdAt":"t1","updatedAt":"t1"}]}"#
                    }
                    "/api/v1/agent-room/rooms/r1/timeline" => {
                        r#"{"messages":[],"runs":[],"events":[]}"#
                    }
                    "/api/v1/agent-room/runs/run1" => {
                        r#"{"runId":"run1","roomId":"r1","sourceMessageId":"msg1","memberId":"m1","originKind":"agent_room","queuePolicy":"enqueue","status":"queued","createdAt":"t1","updatedAt":"t1"}"#
                    }
                    "/api/v1/agent-room/observations" => {
                        r#"{"items":[],"panes":[{"paneId":"pane-1","effectiveSessionId":"s1","visible":true,"active":true,"maximized":false,"mountPolicy":"eager","loadState":"ready"}],"pinnedSessionIds":["s1"],"observerRunning":true}"#
                    }
                    "/api/v1/agent-room/capabilities" => {
                        r#"{"runtimeProvider":"server","core":true,"observer":true,"multiSessionObservation":true,"sessionTranscript":true,"userPromptEvents":true,"abort":false,"approval":true,"nativeFollowUp":false}"#
                    }
                    "/api/v1/agent-room/pane-sessions/sync" => {
                        r#"{"acceptedGeneration":4,"observedSessionIds":["s1"]}"#
                    }
                    "/api/v1/approvals" => {
                        r#"{"items":[{"approvalId":"ap1","kimiSessionId":"s1","requestKind":"confirm","prompt":"Continue?","platform":"agent_room","chatId":"r1","status":"pending","requestPayloadJson":"{}","dedupeKey":"approval-ap1","createdAt":"t1","updatedAt":"t1"}]}"#
                    }
                    "/api/v1/approvals/ap1/resolve" => r#"{}"#,
                    _ => panic!("unexpected path: {path}"),
                };
                let response = Response::from_string(format!(
                    r#"{{"ok":true,"data":{data},"requestId":"req-core"}}"#
                ))
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                        .expect("content type header"),
                );
                request.respond(response).expect("response should be sent");
            }
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        assert_eq!(
            client.agent_room_list_agents().unwrap().items[0].agent_id,
            "a1"
        );
        assert_eq!(
            client.agent_room_list_rooms(None, 50, None).unwrap().cursor,
            "next"
        );
        assert_eq!(client.agent_room_get_room("r1").unwrap().room.room_id, "r1");
        assert_eq!(
            client.agent_room_list_members("r1").unwrap().items[0].member_id,
            "m1"
        );
        assert!(client
            .agent_room_get_timeline("r1", 0, 0, 100)
            .unwrap()
            .events
            .is_empty());
        assert_eq!(client.agent_room_get_run("run1").unwrap().status, "queued");
        let observations = client.agent_room_list_observations().unwrap();
        assert_eq!(observations.pinned_session_ids, ["s1"]);
        assert_eq!(
            observations.panes[0].effective_session_id.as_deref(),
            Some("s1")
        );
        assert!(client.agent_room_get_capabilities().unwrap().observer);
        assert_eq!(
            client
                .agent_room_sync_pane_sessions(&PaneSessionSyncInput {
                    generation: 4,
                    panes: Vec::new(),
                })
                .unwrap()
                .accepted_generation,
            4
        );
        client
            .agent_room_resolve_approval(&BridgeApprovalResolveInput {
                approval_id: "ap1".to_string(),
                status: "approved".to_string(),
                resolution_payload_json: None,
            })
            .unwrap();
    }

    #[test]
    fn agent_room_refuses_to_resolve_connector_approval() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        thread::spawn(move || {
            let request = server.recv().expect("approval preflight should arrive");
            assert_eq!(request.url(), "/api/v1/approvals");
            let response = Response::from_string(
                r#"{"ok":true,"data":{"items":[{"approvalId":"connector-ap1","kimiSessionId":"s1","requestKind":"confirm","prompt":"Continue?","platform":"telegram","chatId":"chat1","status":"pending","requestPayloadJson":"{}","dedupeKey":"connector-ap1","createdAt":"t1","updatedAt":"t1"}]},"requestId":"req-connector"}"#,
            )
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                    .expect("content type header"),
            );
            request.respond(response).expect("response should be sent");
        });

        let client =
            BridgeHttpClient::new(address, "bridge-token").expect("client should be created");
        let error = client
            .agent_room_resolve_approval(&BridgeApprovalResolveInput {
                approval_id: "connector-ap1".to_string(),
                status: "approved".to_string(),
                resolution_payload_json: None,
            })
            .expect_err("connector approval must not be resolved by Agent Room");
        assert_eq!(error.code, "approval_conflict");
    }

    #[test]
    fn agent_room_crud_uses_exact_methods_and_paths() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            for _ in 0..11 {
                let request = server.recv().expect("request should arrive");
                let method = request.method().as_str().to_string();
                let path = request.url().to_string();
                sender
                    .send((method.clone(), path.clone()))
                    .expect("route captured");
                let data = if path.contains("/agents/a1") && method == "PATCH" {
                    r#"{"agentId":"a1","name":"Agent","rolePrompt":"Review","defaultWorkDir":"D:/repo","sessionPolicy":"per_room","autoApprove":false,"enabled":true,"revision":2,"createdAt":"t1","updatedAt":"t2"}"#
                } else if path == "/api/v1/agent-room/rooms" && method == "POST" {
                    r#"{"roomId":"r1","title":"Room","orchestrationMode":"direct","archived":false,"createdAt":"t1","updatedAt":"t1"}"#
                } else if path == "/api/v1/agent-room/rooms/r1" && method == "PATCH" {
                    r#"{"roomId":"r1","title":"Updated","orchestrationMode":"direct","archived":false,"createdAt":"t1","updatedAt":"t2"}"#
                } else if path.ends_with("/members") && method == "POST" {
                    r#"{"memberId":"m1","roomId":"r1","memberKind":"agent","displayName":"Agent","sessionPolicy":"per_room","followMode":"pin_session","autoApprove":false,"status":"ready","createdAt":"t1","updatedAt":"t1"}"#
                } else if path.ends_with("/members/m1") && method == "PATCH" {
                    r#"{"memberId":"m1","roomId":"r1","memberKind":"agent","displayName":"Updated","sessionPolicy":"per_room","followMode":"pin_session","autoApprove":false,"status":"ready","createdAt":"t1","updatedAt":"t2"}"#
                } else if path.ends_with("/retry") {
                    r#"{"runId":"run2","roomId":"r1","sourceMessageId":"msg1","memberId":"m1","originKind":"agent_room","queuePolicy":"enqueue","status":"queued","createdAt":"t1","updatedAt":"t1"}"#
                } else if path.ends_with("/pin") {
                    if method == "POST" {
                        r#"{"sessionId":"s1","pinned":true,"observerRunning":true}"#
                    } else {
                        r#"{"sessionId":"s1","pinned":false,"observerRunning":true}"#
                    }
                } else {
                    r#"{"status":"deleted"}"#
                };
                request
                    .respond(
                        Response::from_string(format!(
                            r#"{{"ok":true,"data":{data},"requestId":"req-crud"}}"#
                        ))
                        .with_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                                .expect("content type header"),
                        ),
                    )
                    .expect("response sent");
            }
        });
        let client = BridgeHttpClient::new(address, "bridge-token").unwrap();
        client
            .agent_room_update_agent(
                "a1",
                &AgentProfilePatchInput {
                    revision: 1,
                    name: None,
                    avatar: None,
                    description: Some("Updated".to_string()),
                    role_prompt: None,
                    default_work_dir: None,
                    session_policy: None,
                    pinned_session_id: None,
                    auto_approve: None,
                    runtime_controls: None,
                    enabled: None,
                },
            )
            .unwrap();
        client.agent_room_delete_agent("a1").unwrap();
        client
            .agent_room_create_room(&AgentRoomInput {
                title: "Room".to_string(),
                description: None,
                shared_brief: None,
                orchestration_mode: "direct".to_string(),
                archived: None,
            })
            .unwrap();
        client
            .agent_room_update_room(
                "r1",
                &AgentRoomPatchInput {
                    title: Some("Updated".to_string()),
                    description: None,
                    shared_brief: None,
                    orchestration_mode: None,
                    archived: None,
                },
            )
            .unwrap();
        client.agent_room_delete_room("r1").unwrap();
        client
            .agent_room_add_member(
                "r1",
                &AgentRoomMemberInput {
                    member_kind: "agent".to_string(),
                    agent_id: Some("a1".to_string()),
                    display_name: None,
                    pinned_session_id: None,
                    workspace_root: None,
                    followed_pane_id: None,
                    auto_approve: None,
                    runtime_controls: None,
                },
            )
            .unwrap();
        client
            .agent_room_update_member(
                "r1",
                "m1",
                &AgentRoomMemberPatchInput {
                    display_name: Some("Updated".to_string()),
                    auto_approve: None,
                    runtime_controls: None,
                    binding: Some(crate::types::AgentRoomMemberBindingInput {
                        follow_mode: "pin_session".to_string(),
                        followed_pane_id: None,
                        pinned_session_id: Some("s1".to_string()),
                        workspace_root: Some("D:/repo".to_string()),
                    }),
                },
            )
            .unwrap();
        client.agent_room_delete_member("r1", "m1").unwrap();
        client
            .agent_room_retry_run("run1", &AgentRunRetryInput::default())
            .unwrap();
        client.agent_room_set_observation_pin("s1", true).unwrap();
        client.agent_room_set_observation_pin("s1", false).unwrap();

        let routes = receiver.iter().take(11).collect::<Vec<_>>();
        assert!(routes.contains(&(
            "PATCH".to_string(),
            "/api/v1/agent-room/agents/a1".to_string()
        )));
        assert!(routes.contains(&(
            "DELETE".to_string(),
            "/api/v1/agent-room/rooms/r1".to_string()
        )));
        assert!(routes.contains(&(
            "POST".to_string(),
            "/api/v1/agent-room/runs/run1/retry".to_string()
        )));
        assert!(routes.contains(&(
            "DELETE".to_string(),
            "/api/v1/agent-room/observations/s1/pin".to_string()
        )));
    }

    #[test]
    fn agent_room_workflow_and_connector_binding_paths_are_exact() {
        let server = Server::http("127.0.0.1:0").expect("test server should bind");
        let address = format!("http://{}", server.server_addr());
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            for _ in 0..4 {
                let mut request = server.recv().expect("request should arrive");
                let method = request.method().as_str().to_string();
                let path = request.url().to_string();
                let mut body = String::new();
                request.as_reader().read_to_string(&mut body).unwrap();
                sender.send((method.clone(), path.clone(), body)).unwrap();
                let data = if path.ends_with("/resolve") {
                    r#"{"message":{"messageId":"msg1","roomId":"r1","senderKind":"user","content":"task","createdAt":"t1"},"runs":[],"failures":[]}"#
                } else if path == "/api/v1/agent-room/connector-bindings" {
                    r#"{"items":[]}"#
                } else if method == "PUT" {
                    r#"{"connectorId":"feishu-one","agentId":"agent-one","sessionMode":"independent_session","createdAt":"t1","updatedAt":"t1"}"#
                } else {
                    r#"{"status":"deleted"}"#
                };
                request
                    .respond(
                        Response::from_string(format!(
                            r#"{{"ok":true,"data":{data},"requestId":"req"}}"#
                        ))
                        .with_header(
                            Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                                .unwrap(),
                        ),
                    )
                    .unwrap();
            }
        });
        let client = BridgeHttpClient::new(address, "bridge-token").unwrap();
        client
            .agent_room_resolve_workflow("r1", "msg1", "continue")
            .unwrap();
        client.agent_room_list_connector_bindings().unwrap();
        client
            .agent_room_put_connector_binding(
                "feishu-one",
                &AgentConnectorBindingInput {
                    agent_id: "agent-one".into(),
                    session_mode: "independent_session".into(),
                },
            )
            .unwrap();
        client
            .agent_room_delete_connector_binding("feishu-one")
            .unwrap();
        let routes = receiver.iter().take(4).collect::<Vec<_>>();
        assert_eq!(routes[0].0, "POST");
        assert_eq!(
            routes[0].1,
            "/api/v1/agent-room/rooms/r1/workflows/msg1/resolve"
        );
        assert!(routes[0].2.contains(r#""decision":"continue""#));
        assert_eq!(routes[2].0, "PUT");
        assert_eq!(routes[3].0, "DELETE");
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
