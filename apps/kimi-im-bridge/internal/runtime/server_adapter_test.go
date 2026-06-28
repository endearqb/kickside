package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gorilla/websocket"
)

func TestKimiCodeServerAdapterEnsureSessionUsesWorkspaceID(t *testing.T) {
	var createdSessionBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireBearer(t, r)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/workspaces":
			var body map[string]any
			decodeJSON(t, r, &body)
			if body["root"] != "D:/repo" {
				t.Fatalf("expected workspace root D:/repo, got %#v", body["root"])
			}
			writeEnvelope(t, w, map[string]any{
				"id":   "wd_repo_0123456789ab",
				"root": "D:/repo",
				"name": "repo",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions":
			if r.URL.Query().Get("workspace_id") != "wd_repo_0123456789ab" {
				t.Fatalf("expected workspace_id query, got %q", r.URL.RawQuery)
			}
			writeEnvelope(t, w, map[string]any{"items": []any{}, "has_more": false})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions":
			decodeJSON(t, r, &createdSessionBody)
			writeEnvelope(t, w, map[string]any{
				"id":           "sess_1",
				"workspace_id": "wd_repo_0123456789ab",
				"metadata":     map[string]any{"cwd": "D:/repo"},
				"status":       "idle",
				"updated_at":   "2026-06-28T09:00:00Z",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	adapter := newTestServerAdapter(t, server.URL)
	ref, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{
		WorkspaceRoot: "D:/repo",
	})
	if err != nil {
		t.Fatalf("EnsureSession returned error: %v", err)
	}
	if ref.KimiCodeSessionID != "sess_1" || ref.WorkspaceID != "wd_repo_0123456789ab" || ref.RuntimeAdapter != RuntimeAdapterServer {
		t.Fatalf("unexpected session ref: %+v", ref)
	}
	if createdSessionBody["workspace_id"] != "wd_repo_0123456789ab" {
		t.Fatalf("expected create session body to use workspace_id, got %#v", createdSessionBody)
	}
}

func TestKimiCodeServerAdapterEnsureSessionFallsBackToMetadataCwd(t *testing.T) {
	var createdSessionBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireBearer(t, r)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/workspaces":
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 40409, "msg": "not found"})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions":
			writeEnvelope(t, w, map[string]any{"items": []any{}, "has_more": false})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions":
			decodeJSON(t, r, &createdSessionBody)
			writeEnvelope(t, w, map[string]any{
				"id":         "sess_cwd",
				"metadata":   map[string]any{"cwd": "D:/repo"},
				"status":     "idle",
				"updated_at": "2026-06-28T09:00:00Z",
			})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	adapter := newTestServerAdapter(t, server.URL)
	ref, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{
		WorkspaceRoot: "D:/repo",
	})
	if err != nil {
		t.Fatalf("EnsureSession returned error: %v", err)
	}
	if ref.KimiCodeSessionID != "sess_cwd" || ref.WorkspaceRoot != "D:/repo" {
		t.Fatalf("unexpected session ref: %+v", ref)
	}
	metadata, ok := createdSessionBody["metadata"].(map[string]any)
	if !ok || metadata["cwd"] != "D:/repo" {
		t.Fatalf("expected metadata.cwd fallback, got %#v", createdSessionBody)
	}
}

func TestKimiCodeServerAdapterPromptAndApprovalEndpoints(t *testing.T) {
	var promptBody map[string]any
	var approvalBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireBearer(t, r)
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions/sess_1":
			writeEnvelope(t, w, map[string]any{
				"id":           "sess_1",
				"workspace_id": "ws_1",
				"status":       "idle",
				"metadata":     map[string]any{"cwd": "D:/repo"},
				"last_seq":     7,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions/sess_1/prompts":
			decodeJSON(t, r, &promptBody)
			writeEnvelope(t, w, map[string]any{
				"prompt_id":       "prompt_1",
				"user_message_id": "msg_1",
				"status":          "running",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions/sess_1/approvals":
			if r.URL.Query().Get("status") != "pending" {
				t.Fatalf("expected pending approvals query, got %q", r.URL.RawQuery)
			}
			writeEnvelope(t, w, map[string]any{
				"items": []map[string]any{{
					"approval_id":        "approval_1",
					"session_id":         "sess_1",
					"tool_call_id":       "tool_1",
					"tool_name":          "bash",
					"action":             "run",
					"tool_input_display": "echo hi",
					"created_at":         "2026-06-28T09:00:00Z",
					"expires_at":         "2026-06-28T10:00:00Z",
				}},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions/sess_1/approvals/approval_1":
			decodeJSON(t, r, &approvalBody)
			writeEnvelope(t, w, map[string]any{
				"resolved":    true,
				"resolved_at": "2026-06-28T09:01:00Z",
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions/sess_1/prompts/prompt_1:abort":
			writeEnvelope(t, w, map[string]any{"aborted": true, "at_seq": 3})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	adapter := newTestServerAdapter(t, server.URL)
	result, err := adapter.SubmitPrompt(context.Background(), AdapterPromptRequest{
		SessionID: "sess_1",
		Text:      "hello",
		Controls:  RuntimeControls{PermissionMode: "manual", Thinking: "low", PlanMode: true},
	}, nil)
	if err != nil {
		t.Fatalf("SubmitPrompt returned error: %v", err)
	}
	if result.PromptID != "prompt_1" || result.Status != "running" {
		t.Fatalf("unexpected prompt result: %+v", result)
	}
	if promptBody["permission_mode"] != "manual" || promptBody["thinking"] != "low" || promptBody["plan_mode"] != true {
		t.Fatalf("expected prompt controls in snake_case body, got %#v", promptBody)
	}

	approvals, err := adapter.ListApprovals(context.Background(), "sess_1")
	if err != nil {
		t.Fatalf("ListApprovals returned error: %v", err)
	}
	if len(approvals) != 1 || approvals[0].ApprovalID != "approval_1" || approvals[0].ToolName != "bash" {
		t.Fatalf("unexpected approvals: %+v", approvals)
	}
	if err := adapter.ResolveApproval(context.Background(), "sess_1", "approval_1", ApprovalDecision{
		Decision:      "approved",
		Scope:         "session",
		SelectedLabel: "Allow",
	}); err != nil {
		t.Fatalf("ResolveApproval returned error: %v", err)
	}
	if approvalBody["decision"] != "approved" || approvalBody["scope"] != "session" || approvalBody["selected_label"] != "Allow" {
		t.Fatalf("expected approval body in server schema, got %#v", approvalBody)
	}
	if err := adapter.AbortPrompt(context.Background(), "sess_1", "prompt_1"); err != nil {
		t.Fatalf("AbortPrompt returned error: %v", err)
	}
}

func TestKimiCodeServerAdapterSubmitPromptStreamsWebSocketEvents(t *testing.T) {
	upgrader := websocket.Upgrader{Subprotocols: []string{wsBearerProtocolPrefix + "secret-token"}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions/sess_1":
			requireBearer(t, r)
			writeEnvelope(t, w, map[string]any{
				"id":       "sess_1",
				"status":   "idle",
				"metadata": map[string]any{"cwd": "D:/repo"},
				"last_seq": 4,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions/sess_1/prompts":
			requireBearer(t, r)
			writeEnvelope(t, w, map[string]any{
				"prompt_id":       "prompt_1",
				"user_message_id": "msg_1",
				"status":          "running",
			})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/ws":
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("upgrade websocket: %v", err)
			}
			defer conn.Close()
			if conn.Subprotocol() != wsBearerProtocolPrefix+"secret-token" {
				t.Fatalf("expected bearer subprotocol, got %q", conn.Subprotocol())
			}
			if err := conn.WriteJSON(map[string]any{
				"type":      "server_hello",
				"timestamp": "2026-06-28T00:00:00Z",
				"payload": map[string]any{
					"ws_connection_id":      "conn_1",
					"protocol_version":      1,
					"heartbeat_ms":          30_000,
					"max_event_buffer_size": 100,
					"capabilities":          map[string]any{"event_batching": false, "compression": false},
				},
			}); err != nil {
				t.Fatalf("write server hello: %v", err)
			}
			var hello map[string]any
			if err := conn.ReadJSON(&hello); err != nil {
				t.Fatalf("read client hello: %v", err)
			}
			if hello["type"] != "client_hello" {
				t.Fatalf("expected client hello, got %#v", hello)
			}
			if err := conn.WriteJSON(map[string]any{
				"type": "ack",
				"id":   "bridge-client-hello",
				"code": 0,
				"msg":  "success",
				"payload": map[string]any{
					"accepted_subscriptions": []string{"sess_1"},
				},
			}); err != nil {
				t.Fatalf("write ack: %v", err)
			}
			for _, frame := range []map[string]any{
				{"type": "turn.started", "seq": 5, "session_id": "sess_1", "payload": map[string]any{"turnId": 1}},
				{"type": "turn.step.started", "seq": 6, "session_id": "sess_1", "payload": map[string]any{"turnId": 1, "step": 0}},
				{"type": "assistant.delta", "seq": 6, "session_id": "sess_1", "payload": map[string]any{"delta": "hello "}},
				{"type": "assistant.delta", "seq": 6, "session_id": "sess_1", "payload": map[string]any{"delta": "world"}},
				{"type": "turn.ended", "seq": 7, "session_id": "sess_1", "payload": map[string]any{"reason": "completed"}},
			} {
				if err := conn.WriteJSON(frame); err != nil {
					t.Fatalf("write event frame: %v", err)
				}
			}
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	adapter := newTestServerAdapter(t, server.URL)
	events := []AdapterEvent{}
	result, err := adapter.SubmitPrompt(context.Background(), AdapterPromptRequest{
		SessionID: "sess_1",
		Text:      "hello",
	}, func(event AdapterEvent) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatalf("SubmitPrompt returned error: %v", err)
	}
	if result.Status != "completed" {
		t.Fatalf("expected completed result, got %+v", result)
	}
	var content string
	for _, event := range events {
		if event.Type == "content_delta" {
			content += event.Text
		}
	}
	if content != "hello world" {
		t.Fatalf("expected streamed content, got %q from %+v", content, events)
	}
}

func newTestServerAdapter(t *testing.T, origin string) *KimiCodeServerAdapter {
	t.Helper()
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "server.token")
	if err := os.WriteFile(tokenPath, []byte("secret-token"), 0o600); err != nil {
		t.Fatalf("write token: %v", err)
	}
	locatorPath := filepath.Join(dir, "locator.json")
	raw, err := json.Marshal(map[string]any{
		"origin":    origin,
		"tokenPath": tokenPath,
		"health":    "ready",
	})
	if err != nil {
		t.Fatalf("marshal locator: %v", err)
	}
	if err := os.WriteFile(locatorPath, raw, 0o600); err != nil {
		t.Fatalf("write locator: %v", err)
	}
	adapter, err := NewKimiCodeServerAdapter(KimiCodeServerAdapterOptions{
		RuntimeLocatorPath: locatorPath,
		HTTPClient:         &http.Client{},
	})
	if err != nil {
		t.Fatalf("NewKimiCodeServerAdapter returned error: %v", err)
	}
	return adapter
}

func requireBearer(t *testing.T, r *http.Request) {
	t.Helper()
	if got := r.Header.Get("Authorization"); got != "Bearer secret-token" {
		t.Fatalf("expected bearer token from token file, got %q", got)
	}
}

func decodeJSON(t *testing.T, r *http.Request, target any) {
	t.Helper()
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
}

func writeEnvelope(t *testing.T, w http.ResponseWriter, data any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{
		"code":       0,
		"msg":        "ok",
		"data":       data,
		"request_id": "test",
	}); err != nil {
		t.Fatalf("write envelope: %v", err)
	}
}
