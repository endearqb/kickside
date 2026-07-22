package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/agentroom"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

func TestAgentRoomAdminPhase3CoreFlowAndAuth(t *testing.T) {
	storeHandle, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer storeHandle.Close()
	core := agentroom.NewService(storeHandle)
	routes := NewAgentRoomRoutes(core, storeHandle, func(context.Context) AgentRoomCapabilitySnapshot {
		return AgentRoomCapabilitySnapshot{RuntimeProvider: "server", Core: true, Observer: true, Approval: true, Degradations: []string{"abort_unconfirmed"}}
	})
	server := httptest.NewServer(NewHandlerWithAgentRoom(&fakeService{}, "token-1", routes))
	defer server.Close()

	if status, _ := agentRoomRequest(t, server.URL, "", http.MethodGet, "/api/v1/agent-room/agents", nil); status != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated 401, got %d", status)
	}
	workspace := t.TempDir()
	status, envelope := agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/agents", map[string]any{
		"name": "Architect", "rolePrompt": "Review boundaries", "defaultWorkDir": workspace,
		"sessionPolicy": "per_room", "autoApprove": false, "runtimeControls": map[string]any{},
	})
	if status != http.StatusCreated || !envelope.Ok {
		t.Fatalf("create agent failed: status=%d envelope=%+v", status, envelope)
	}
	agent := dataMap(t, envelope)
	agentID := agent["agentId"].(string)
	revision := int64(agent["revision"].(float64))
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPatch, "/api/v1/agent-room/agents/"+agentID, map[string]any{"revision": revision, "description": "updated"})
	if status != http.StatusOK || dataMap(t, envelope)["description"] != "updated" {
		t.Fatalf("partial patch failed: status=%d envelope=%+v", status, envelope)
	}

	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms", map[string]any{"title": "Core Gate", "orchestrationMode": "direct"})
	if status != http.StatusCreated {
		t.Fatalf("create room failed: %+v", envelope)
	}
	roomID := dataMap(t, envelope)["roomId"].(string)
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms/"+roomID+"/members", map[string]any{"memberKind": "agent", "agentId": agentID})
	if status != http.StatusCreated {
		t.Fatalf("create member failed: %+v", envelope)
	}
	memberID := dataMap(t, envelope)["memberId"].(string)
	if err := storeHandle.UpsertSession(context.Background(), domain.BridgeSession{KimiSessionID: "admin-session", WorkDir: workspace}); err != nil {
		t.Fatal(err)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPatch, "/api/v1/agent-room/rooms/"+roomID+"/members/"+memberID, map[string]any{
		"binding": map[string]any{"followMode": "pin_session", "pinnedSessionId": "admin-session", "workspaceRoot": workspace},
	})
	if status != http.StatusOK || dataMap(t, envelope)["effectiveSessionId"] != "admin-session" {
		t.Fatalf("member binding patch failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms/"+roomID+"/messages", map[string]any{"content": "inspect", "targetMemberIds": []string{memberID}, "queuePolicy": "enqueue"})
	if status != http.StatusCreated {
		t.Fatalf("create message failed: %+v", envelope)
	}
	result := dataMap(t, envelope)
	runs := result["runs"].([]any)
	runID := runs[0].(map[string]any)["runId"].(string)
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/runs/"+runID+"/abort", map[string]any{"reason": "user_takeover"})
	if status != http.StatusOK || dataMap(t, envelope)["status"] != "aborted" {
		t.Fatalf("queued abort failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms/"+roomID+"/messages", map[string]any{"content": "running", "targetMemberIds": []string{memberID}, "mode": "parallel", "queuePolicy": "enqueue", "sharedRunIds": []string{runID}})
	if status != http.StatusCreated {
		t.Fatalf("create running fixture failed: %+v", envelope)
	}
	runningID := dataMap(t, envelope)["runs"].([]any)[0].(map[string]any)["runId"].(string)
	running, err := storeHandle.GetAgentRun(context.Background(), runningID)
	if err != nil || running == nil {
		t.Fatalf("get running fixture: run=%+v err=%v", running, err)
	}
	running.Status = "running"
	if _, err := storeHandle.UpdateAgentRun(context.Background(), *running); err != nil {
		t.Fatal(err)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/runs/"+runningID+"/abort", map[string]any{"reason": "replace"})
	if status != http.StatusConflict || envelope.Error == nil || envelope.Error.Code != "abort_unconfirmed" {
		t.Fatalf("running abort must remain unconfirmed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/rooms/"+roomID+"/timeline?limit=20", nil)
	if status != http.StatusOK || len(dataMap(t, envelope)["messages"].([]any)) != 2 {
		t.Fatalf("timeline failed: status=%d envelope=%+v", status, envelope)
	}

	if _, err := storeHandle.AppendAgentRoomEvent(context.Background(), domain.AgentRoomEvent{EventID: "admin-event-1", RoomID: roomID, Kind: "run.completed"}); err != nil {
		t.Fatal(err)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/events?afterSeq=0&limit=1", nil)
	if status != http.StatusOK || len(dataMap(t, envelope)["items"].([]any)) != 1 {
		t.Fatalf("event page failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/capabilities", nil)
	if status != http.StatusOK || dataMap(t, envelope)["runtimeProvider"] != "server" {
		t.Fatalf("capabilities failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/observations", nil)
	if status != http.StatusOK || dataMap(t, envelope)["observerRunning"] != true {
		t.Fatalf("observation status must use live capability: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms", map[string]any{"title": "Second", "orchestrationMode": "direct"})
	if status != http.StatusCreated {
		t.Fatalf("create second room failed: %+v", envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/rooms?limit=1", nil)
	page := dataMap(t, envelope)
	if status != http.StatusOK || len(page["items"].([]any)) != 1 || page["cursor"] == "" {
		t.Fatalf("room first page failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/rooms?limit=1&cursor="+page["cursor"].(string), nil)
	if status != http.StatusOK || len(dataMap(t, envelope)["items"].([]any)) != 1 {
		t.Fatalf("room second page failed: status=%d envelope=%+v", status, envelope)
	}
}

func TestAgentRoomAdminWorkflowAndConnectorBindingContracts(t *testing.T) {
	ctx := context.Background()
	storeHandle, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer storeHandle.Close()
	if err := storeHandle.SyncConfiguredChannels(ctx, []config.ConnectorConfig{{ID: "feishu-one", Platform: "feishu", Enabled: true, Mode: "websocket"}}); err != nil {
		t.Fatal(err)
	}
	core := agentroom.NewService(storeHandle)
	workspace := t.TempDir()
	profile, err := core.CreateAgentProfile(ctx, agentroom.AgentProfileInput{Name: "Reviewer", RolePrompt: "review", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	if err != nil {
		t.Fatal(err)
	}
	room, err := core.CreateRoom(ctx, agentroom.RoomInput{Title: "Workflow", OrchestrationMode: "workflow"})
	if err != nil {
		t.Fatal(err)
	}
	member, err := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewHandlerWithAgentRoom(&fakeService{}, "token-1", NewAgentRoomRoutes(core, storeHandle, nil)))
	defer server.Close()
	status, envelope := agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms/"+room.RoomID+"/messages", map[string]any{
		"content": "review", "mode": "workflow", "queuePolicy": "enqueue",
		"workflowDefinition": map[string]any{"version": "1", "stages": []any{map[string]any{"stageId": "review", "targetMemberIds": []string{member.MemberID}, "aggregation": "all", "promptTemplate": "find defects", "failurePolicy": "stop"}}},
	})
	if status != http.StatusCreated || !envelope.Ok {
		t.Fatalf("workflow contract failed: status=%d envelope=%+v", status, envelope)
	}
	run := dataMap(t, envelope)["runs"].([]any)[0].(map[string]any)
	if run["workflowStageId"] != "review" {
		t.Fatalf("workflow stage serialization missing: %+v", run)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms/"+room.RoomID+"/messages", map[string]any{"content": "unsafe", "mode": "workflow"})
	if status != http.StatusBadRequest || envelope.Error == nil || envelope.Error.Code != "workflow_definition_required" {
		t.Fatalf("workflow must fail closed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPut, "/api/v1/agent-room/connector-bindings/feishu-one", map[string]any{"agentId": profile.AgentID, "sessionMode": "independent_session"})
	if status != http.StatusOK || dataMap(t, envelope)["agentId"] != profile.AgentID {
		t.Fatalf("connector binding put failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/connector-bindings", nil)
	if status != http.StatusOK || len(dataMap(t, envelope)["items"].([]any)) != 1 {
		t.Fatalf("connector binding list failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodDelete, "/api/v1/agent-room/connector-bindings/feishu-one", nil)
	if status != http.StatusOK {
		t.Fatalf("connector binding delete failed: status=%d envelope=%+v", status, envelope)
	}
}

func TestAgentRoomAdminFlagOffStrictBodyPaneGenerationAndSafeErrors(t *testing.T) {
	off := httptest.NewServer(NewHandler(&fakeService{}, "token-1"))
	defer off.Close()
	if status, _ := agentRoomRequest(t, off.URL, "token-1", http.MethodGet, "/api/v1/agent-room/agents", nil); status != http.StatusNotFound {
		t.Fatalf("flag-off routes must be absent, got %d", status)
	}

	storeHandle, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer storeHandle.Close()
	server := httptest.NewServer(NewHandlerWithAgentRoom(&fakeService{}, "token-1", NewAgentRoomRoutes(agentroom.NewService(storeHandle), storeHandle, nil)))
	defer server.Close()
	status, envelope := agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms", map[string]any{"title": "x", "orchestrationMode": "direct", "unknown": true})
	if status != http.StatusBadRequest || envelope.Error == nil || envelope.Error.Code != "invalid_json" {
		t.Fatalf("unknown fields must fail strict decode: status=%d envelope=%+v", status, envelope)
	}

	pane := map[string]any{"paneId": "pane-1", "persistedSessionId": "session-old", "activeSessionId": "session-active", "effectiveSessionId": "session-active", "visible": true, "active": true, "maximized": false, "mountPolicy": "eager", "loadState": "ready"}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/pane-sessions/sync", map[string]any{"generation": 2, "panes": []any{pane}})
	if status != http.StatusOK || dataMap(t, envelope)["observedSessionIds"].([]any)[0] != "session-active" {
		t.Fatalf("pane sync failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodGet, "/api/v1/agent-room/observations", nil)
	panes := dataMap(t, envelope)["panes"].([]any)
	if status != http.StatusOK || len(panes) != 1 || panes[0].(map[string]any)["effectiveSessionId"] != "session-active" {
		t.Fatalf("observation pane projection failed: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/pane-sessions/sync", map[string]any{"generation": 1, "panes": []any{pane}})
	details := map[string]any{}
	if envelope.Error != nil {
		details, _ = envelope.Error.Details.(map[string]any)
	}
	if status != http.StatusConflict || envelope.Error == nil || envelope.Error.Code != "stale_generation" || details["acceptedGeneration"] != float64(2) {
		t.Fatalf("stale generation must conflict: status=%d envelope=%+v", status, envelope)
	}
	badPane := map[string]any{"paneId": "pane-2", "persistedSessionId": "session-a", "activeSessionId": "session-b", "effectiveSessionId": "session-a"}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/pane-sessions/sync", map[string]any{"generation": 3, "panes": []any{badPane}})
	if status != http.StatusBadRequest || envelope.Error == nil || envelope.Error.Code != "invalid_pane_session" || strings.Contains(envelope.Error.Message, "session-a") {
		t.Fatalf("invalid pane details must remain safe: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/observations/session-a/pin", nil)
	if status != http.StatusNotFound {
		t.Fatalf("missing Session must not be pinned: status=%d envelope=%+v", status, envelope)
	}
	if err := storeHandle.UpsertSession(context.Background(), domain.BridgeSession{KimiSessionID: "session-a", WorkDir: "D:/repo"}); err != nil {
		t.Fatal(err)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/observations/session-a/pin", nil)
	if status != http.StatusOK || dataMap(t, envelope)["observerRunning"] != false {
		t.Fatalf("pin must persist intent without faking Observer: status=%d envelope=%+v", status, envelope)
	}
	status, envelope = agentRoomRequest(t, server.URL, "token-1", http.MethodPost, "/api/v1/agent-room/rooms", map[string]any{"title": strings.Repeat("x", (1<<20)+1), "orchestrationMode": "direct"})
	if status != http.StatusRequestEntityTooLarge || envelope.Error == nil || envelope.Error.Code != "body_too_large" {
		t.Fatalf("body limit must be enforced: status=%d envelope=%+v", status, envelope)
	}
}

type agentRoomEnvelope struct {
	Ok    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error *AdminError     `json:"error"`
}

func agentRoomRequest(t *testing.T, baseURL, token, method, path string, body any) (int, agentRoomEnvelope) {
	t.Helper()
	var raw []byte
	if body != nil {
		var err error
		raw, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, baseURL+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("X-Bridge-Admin-Token", token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var envelope agentRoomEnvelope
	_ = json.NewDecoder(resp.Body).Decode(&envelope)
	return resp.StatusCode, envelope
}

func dataMap(t *testing.T, envelope agentRoomEnvelope) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		t.Fatalf("decode data: %v (%s)", err, envelope.Data)
	}
	return result
}
