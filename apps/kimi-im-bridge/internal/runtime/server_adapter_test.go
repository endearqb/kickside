package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/gorilla/websocket"
)

func TestKimiCodeServerAdapterRejectsAttachmentsExplicitly(t *testing.T) {
	adapter := &KimiCodeServerAdapter{}
	_, err := adapter.SubmitPrompt(context.Background(), AdapterPromptRequest{
		SessionID: "session-1", Text: "review", Attachments: []domain.PromptAttachment{{Kind: domain.AttachmentKindFile, LocalPath: `C:\review.txt`}},
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "attachments_unsupported") {
		t.Fatalf("expected explicit attachments_unsupported error, got %v", err)
	}
}

func TestSessionRuntimeStatusSupportsRealServerActivityFields(t *testing.T) {
	tests := []struct {
		name    string
		session apiSession
		want    string
	}{
		{name: "legacy status", session: apiSession{Status: "completed", Busy: true}, want: "completed"},
		{name: "new session idle", session: apiSession{PendingInteraction: "none"}, want: "idle"},
		{name: "busy", session: apiSession{Busy: true, PendingInteraction: "none"}, want: "running"},
		{name: "main turn", session: apiSession{MainTurnActive: true, PendingInteraction: "none"}, want: "running"},
		{name: "pending interaction", session: apiSession{PendingInteraction: "approval"}, want: "waiting_approval"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := sessionRuntimeStatus(test.session); got != test.want {
				t.Fatalf("sessionRuntimeStatus()=%q want %q", got, test.want)
			}
		})
	}
}

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

func TestKimiCodeServerAdapterGetsTranscriptWithExactCursorQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireBearer(t, r)
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/sessions/session-1/messages" {
			t.Fatalf("unexpected transcript request: %s %s", r.Method, r.URL.String())
		}
		if r.URL.Query().Get("before_id") != "before-1" || r.URL.Query().Get("after_id") != "after-1" || r.URL.Query().Get("role") != "assistant" || r.URL.Query().Get("page_size") != "25" {
			t.Fatalf("unexpected transcript query: %s", r.URL.RawQuery)
		}
		writeEnvelope(t, w, map[string]any{"items": []any{map[string]any{"id": "message-1", "role": "assistant", "text": "reply"}}, "has_more": true})
	}))
	defer server.Close()
	adapter := newTestServerAdapter(t, server.URL)
	page, err := adapter.GetSessionTranscript(context.Background(), "session-1", SessionTranscriptQuery{BeforeID: "before-1", AfterID: "after-1", Role: "assistant", PageSize: 25})
	if err != nil || len(page.Items) != 1 || !page.HasMore || !strings.Contains(string(page.Items[0]), "reply") {
		t.Fatalf("unexpected transcript: %+v err=%v", page, err)
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

func TestKimiCodeServerAdapterEnsureSessionHonorsExplicitCreateModes(t *testing.T) {
	var created int
	var listed int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireBearer(t, r)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/workspaces":
			writeEnvelope(t, w, map[string]any{"id": "ws_repo", "root": "D:/repo"})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions":
			listed++
			writeEnvelope(t, w, map[string]any{"items": []map[string]any{
				{"id": "sess_latest", "workspace_id": "ws_repo", "metadata": map[string]any{"cwd": "D:/repo"}},
				{"id": "sess_older", "workspace_id": "ws_repo", "metadata": map[string]any{"cwd": "D:/repo"}},
			}})
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/sessions":
			created++
			writeEnvelope(t, w, map[string]any{"id": fmt.Sprintf("sess_created_%d", created)})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions/sess_exact":
			writeEnvelope(t, w, map[string]any{"id": "sess_exact", "workspace_id": "ws_repo", "metadata": map[string]any{"cwd": "D:/repo"}})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/sessions/sess_missing":
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 40404, "msg": "session not found"})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))
	defer server.Close()

	adapter := newTestServerAdapter(t, server.URL)
	first, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{WorkspaceRoot: "D:/repo", CreateMode: SessionCreateAlways})
	if err != nil {
		t.Fatalf("first always create: %v", err)
	}
	second, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{WorkspaceRoot: "D:/repo", CreateMode: SessionCreateAlways})
	if err != nil {
		t.Fatalf("second always create: %v", err)
	}
	if first.KimiCodeSessionID == second.KimiCodeSessionID || first.WorkspaceID != "ws_repo" || first.WorkspaceRoot != "D:/repo" {
		t.Fatalf("always mode did not create isolated sessions with workspace context: first=%+v second=%+v", first, second)
	}
	if listed != 0 {
		t.Fatalf("always mode listed existing sessions %d times", listed)
	}

	reused, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{WorkspaceRoot: "D:/repo", CreateMode: SessionReuseLatest})
	if err != nil || reused.KimiCodeSessionID != "sess_latest" || reused.SessionSource != "server_reused_latest" {
		t.Fatalf("reuse_latest returned ref=%+v err=%v", reused, err)
	}
	compatible, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{WorkspaceRoot: "D:/repo"})
	if err != nil || compatible.KimiCodeSessionID != "sess_latest" {
		t.Fatalf("default if_missing compatibility returned ref=%+v err=%v", compatible, err)
	}

	exact, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{KimiCodeSessionID: "sess_exact", CreateMode: SessionResumeExact, SessionSource: "pinned"})
	if err != nil || exact.KimiCodeSessionID != "sess_exact" || exact.WorkspaceID != "ws_repo" || exact.WorkspaceRoot != "D:/repo" || exact.SessionSource != "pinned" {
		t.Fatalf("resume_exact returned ref=%+v err=%v", exact, err)
	}
	if _, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{KimiCodeSessionID: "sess_missing", CreateMode: SessionResumeExact}); err == nil {
		t.Fatal("resume_exact unexpectedly replaced a missing session")
	}
	for _, request := range []EnsureSessionRequest{
		{KimiCodeSessionID: "sess_exact", WorkspaceID: "ws_other", CreateMode: SessionResumeExact},
		{KimiCodeSessionID: "sess_exact", WorkspaceRoot: "D:/other", CreateMode: SessionResumeExact},
	} {
		if _, err := adapter.EnsureSession(context.Background(), request); err == nil || !strings.Contains(err.Error(), "workspace_mismatch") {
			t.Fatalf("resume_exact accepted mismatched workspace: request=%+v err=%v", request, err)
		}
	}
	if created != 2 {
		t.Fatalf("expected only the two explicit always creates, got %d", created)
	}
}

func TestKimiCodeServerAdapterEnsureSessionRejectsInvalidModeInputsBeforeIO(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("invalid request reached runtime: %s %s", r.Method, r.URL.String())
	}))
	defer server.Close()
	adapter := newTestServerAdapter(t, server.URL)

	for _, request := range []EnsureSessionRequest{
		{CreateMode: SessionCreateMode("unknown")},
		{CreateMode: SessionResumeExact},
		{CreateMode: SessionCreateAlways, KimiCodeSessionID: "sess_1"},
		{CreateMode: SessionReuseLatest, KimiCodeSessionID: "sess_1"},
	} {
		if _, err := adapter.EnsureSession(context.Background(), request); err == nil {
			t.Fatalf("expected request to fail: %+v", request)
		}
	}
	encoded, err := json.Marshal(EnsureSessionRequest{CreateMode: SessionCreateAlways})
	if err != nil || !strings.Contains(string(encoded), `"createMode":"always"`) {
		t.Fatalf("unexpected createMode JSON contract: %s err=%v", encoded, err)
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
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/config":
			writeEnvelope(t, w, map[string]any{"default_model": "kimi-code/k3"})
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
	if promptBody["model"] != "kimi-code/k3" || promptBody["permission_mode"] != "manual" || promptBody["thinking"] != "low" || promptBody["plan_mode"] != true {
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
				"last_seq": 0,
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
				{"type": "turn.started", "seq": 1, "session_id": "sess_1", "payload": map[string]any{"turnId": 1}},
				{"type": "turn.ended", "seq": 2, "session_id": "sess_1", "payload": map[string]any{"turnId": 1, "reason": "completed"}},
				{"type": "prompt.completed", "seq": 3, "session_id": "sess_1", "payload": map[string]any{"promptId": "old_prompt", "reason": "completed"}},
				{"type": "turn.started", "seq": 4, "session_id": "sess_1", "payload": map[string]any{"turnId": 2}},
				{"type": "turn.step.started", "seq": 5, "session_id": "sess_1", "payload": map[string]any{"turnId": 2, "step": 0}},
				{"type": "assistant.delta", "seq": 6, "session_id": "sess_1", "payload": map[string]any{"delta": "hello "}},
				{"type": "assistant.delta", "seq": 7, "session_id": "sess_1", "payload": map[string]any{"delta": "world"}},
				{"type": "turn.ended", "seq": 8, "session_id": "sess_1", "payload": map[string]any{"turnId": 2, "reason": "completed"}},
				{"type": "prompt.completed", "seq": 9, "session_id": "sess_1", "payload": map[string]any{"promptId": "prompt_1", "reason": "completed"}},
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
		Controls:  RuntimeControls{Model: "kimi-code/k3"},
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

func TestHandlePromptWSFrameReturnsStructuredFailure(t *testing.T) {
	var events []AdapterEvent
	status, terminal, err := handlePromptWSFrame(nil, wsFrame{
		Type:    "turn.ended",
		Payload: json.RawMessage(`{"promptId":"prompt-1","reason":"failed","error":{"code":"model.not_configured","message":"Model not set"}}`),
	}, "session-1", "prompt-1", func(event AdapterEvent) error {
		events = append(events, event)
		return nil
	})
	failure, ok := err.(*PromptFailureError)
	if status != "failed" || !terminal || !ok || failure.Code != "model.not_configured" {
		t.Fatalf("unexpected terminal failure: status=%q terminal=%v err=%T %v", status, terminal, err, err)
	}
	if len(events) != 1 || events[0].Type != "turn_failed" || events[0].ErrorCode != "model.not_configured" {
		t.Fatalf("unexpected failure event: %+v", events)
	}
}

func TestKimiCodeServerAdapterInspectSessionReturnsFreshSafeState(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requireBearer(t, r)
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/sessions/session-1" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
		writeEnvelope(t, w, map[string]any{
			"id": "session-1", "workspace_id": "workspace-1", "status": "running", "last_seq": 42,
			"metadata": map[string]any{"cwd": "D:/repo"},
		})
	}))
	defer server.Close()
	state, err := newTestServerAdapter(t, server.URL).InspectSession(context.Background(), "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if state.SessionID != "session-1" || state.Status != "running" || state.LastSeq != 42 || state.WorkspaceRoot != "D:/repo" || state.Generation != 3 || state.ObservedAt == "" {
		t.Fatalf("unexpected inspected state: %+v", state)
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
		"origin":     origin,
		"tokenPath":  tokenPath,
		"health":     "ready",
		"generation": 3,
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
