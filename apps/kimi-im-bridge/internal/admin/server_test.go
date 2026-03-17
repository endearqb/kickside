package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

type fakeService struct {
	status          domain.BridgeStatus
	bindings        []domain.BindingRecord
	sessions        []domain.BridgeSession
	approvals       []domain.ApprovalTicket
	debugResponse   runtime.PromptResponse
	cleared         []string
	resolved        []string
	updated         []string
	imported        []domain.SessionImportRequest
	requestStopCall int
}

func (f *fakeService) Status(context.Context) (domain.BridgeStatus, error) {
	return f.status, nil
}

func (f *fakeService) ListBindings(context.Context) ([]domain.BindingRecord, error) {
	return f.bindings, nil
}

func (f *fakeService) ListSessions(context.Context) ([]domain.BridgeSession, error) {
	return f.sessions, nil
}

func (f *fakeService) ClearBinding(_ context.Context, bindingID string) error {
	f.cleared = append(f.cleared, bindingID)
	return nil
}

func (f *fakeService) UpdateBinding(_ context.Context, bindingID string, input domain.BindingUpdate) error {
	if input.WorkDir != nil {
		f.updated = append(f.updated, bindingID+":"+*input.WorkDir)
		return nil
	}
	f.updated = append(f.updated, bindingID+":"+input.KimiSessionID)
	return nil
}

func (f *fakeService) ListApprovals(_ context.Context, _ string) ([]domain.ApprovalTicket, error) {
	return f.approvals, nil
}

func (f *fakeService) ResolveApproval(_ context.Context, approvalID string, _ string, _ string) error {
	f.resolved = append(f.resolved, approvalID)
	return nil
}

func (f *fakeService) ImportSession(_ context.Context, input domain.SessionImportRequest) (domain.BridgeSession, error) {
	f.imported = append(f.imported, input)
	return domain.BridgeSession{
		KimiSessionID: "imported-1",
		WorkDir:       input.WorkDir,
		Summary:       input.Summary,
		CreatedAt:     "2026-03-17T00:00:00Z",
		UpdatedAt:     "2026-03-17T00:00:00Z",
	}, nil
}

func (f *fakeService) DebugPrompt(_ context.Context, _ runtime.PromptRequest) (runtime.PromptResponse, error) {
	return f.debugResponse, nil
}

func (f *fakeService) RequestStop() error {
	f.requestStopCall++
	return nil
}

func TestHealthz(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(NewHandler(&fakeService{}, "token-1"))
	defer server.Close()

	response, err := http.Get(server.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz returned error: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.StatusCode)
	}
}

func TestStatusRequiresAdminToken(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(NewHandler(&fakeService{}, "token-1"))
	defer server.Close()

	request, err := http.NewRequest(http.MethodGet, server.URL+"/api/v1/status", nil)
	if err != nil {
		t.Fatalf("NewRequest returned error: %v", err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("status request returned error: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", response.StatusCode)
	}
}

func TestStatusAndBindingsEndpoints(t *testing.T) {
	t.Parallel()

	fake := &fakeService{
		status: domain.BridgeStatus{
			State:            domain.BridgeStateRunning,
			AdminPort:        60110,
			Bindings:         1,
			PendingApprovals: 0,
		},
		bindings: []domain.BindingRecord{
			{
				BindingID:     "binding-1",
				Platform:      "telegram",
				ChatID:        "chat-1",
				KimiSessionID: "session-1",
				CreatedAt:     "2026-03-12T00:00:00Z",
				UpdatedAt:     "2026-03-12T00:00:00Z",
			},
		},
		sessions: []domain.BridgeSession{
			{
				KimiSessionID: "session-1",
				WorkDir:       "D:/repo",
				SessionState:  "active",
				CreatedAt:     "2026-03-12T00:00:00Z",
				UpdatedAt:     "2026-03-12T00:00:00Z",
			},
		},
	}
	server := httptest.NewServer(NewHandler(fake, "token-1"))
	defer server.Close()

	statusRequest, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/status", nil)
	statusRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	statusResponse, err := http.DefaultClient.Do(statusRequest)
	if err != nil {
		t.Fatalf("status request returned error: %v", err)
	}
	defer statusResponse.Body.Close()
	if statusResponse.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", statusResponse.StatusCode)
	}
	var status domain.BridgeStatus
	if err := json.NewDecoder(statusResponse.Body).Decode(&status); err != nil {
		t.Fatalf("failed to decode status response: %v", err)
	}
	if status.AdminPort != 60110 {
		t.Fatalf("expected admin port 60110, got %d", status.AdminPort)
	}

	bindingsRequest, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/bindings", nil)
	bindingsRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	bindingsResponse, err := http.DefaultClient.Do(bindingsRequest)
	if err != nil {
		t.Fatalf("bindings request returned error: %v", err)
	}
	defer bindingsResponse.Body.Close()
	if bindingsResponse.StatusCode != http.StatusOK {
		t.Fatalf("expected bindings 200, got %d", bindingsResponse.StatusCode)
	}
	var payload struct {
		Items []domain.BindingRecord `json:"items"`
	}
	if err := json.NewDecoder(bindingsResponse.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode bindings response: %v", err)
	}
	if len(payload.Items) != 1 {
		t.Fatalf("expected 1 binding, got %d", len(payload.Items))
	}

	sessionsRequest, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/sessions", nil)
	sessionsRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	sessionsResponse, err := http.DefaultClient.Do(sessionsRequest)
	if err != nil {
		t.Fatalf("sessions request returned error: %v", err)
	}
	defer sessionsResponse.Body.Close()
	if sessionsResponse.StatusCode != http.StatusOK {
		t.Fatalf("expected sessions 200, got %d", sessionsResponse.StatusCode)
	}
	var sessionsPayload struct {
		Items []domain.BridgeSession `json:"items"`
	}
	if err := json.NewDecoder(sessionsResponse.Body).Decode(&sessionsPayload); err != nil {
		t.Fatalf("failed to decode sessions response: %v", err)
	}
	if len(sessionsPayload.Items) != 1 || sessionsPayload.Items[0].KimiSessionID != "session-1" {
		t.Fatalf("expected session-1 in sessions payload, got %+v", sessionsPayload.Items)
	}
}

func TestStatusEndpointReturnsDegradedSnapshotPayload(t *testing.T) {
	t.Parallel()

	fake := &fakeService{
		status: domain.BridgeStatus{
			State:     domain.BridgeStateDegraded,
			AdminPort: 60110,
			Channels: []domain.ChannelStatus{
				{
					Platform:      "feishu",
					Enabled:       true,
					State:         domain.ChannelStateDegraded,
					LastErrorCode: "platform_unavailable",
					LastError:     "status snapshot failed: list channel statuses: database is closed",
				},
			},
			LastErrorCode: "platform_unavailable",
			LastError:     "status snapshot failed: list channel statuses: database is closed",
		},
	}
	server := httptest.NewServer(NewHandler(fake, "token-1"))
	defer server.Close()

	request, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/status", nil)
	request.Header.Set("X-Bridge-Admin-Token", "token-1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("status request returned error: %v", err)
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected degraded snapshot to still return 200, got %d", response.StatusCode)
	}
	var status domain.BridgeStatus
	if err := json.NewDecoder(response.Body).Decode(&status); err != nil {
		t.Fatalf("failed to decode status response: %v", err)
	}
	if status.State != domain.BridgeStateDegraded || len(status.Channels) != 1 {
		t.Fatalf("unexpected degraded snapshot payload: %+v", status)
	}
}

func TestDeleteBindingEndpoint(t *testing.T) {
	t.Parallel()

	fake := &fakeService{}
	server := httptest.NewServer(NewHandler(fake, "token-1"))
	defer server.Close()

	request, _ := http.NewRequest(http.MethodDelete, server.URL+"/api/v1/bindings/binding-1", nil)
	request.Header.Set("X-Bridge-Admin-Token", "token-1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("delete request returned error: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected delete 200, got %d", response.StatusCode)
	}
	if len(fake.cleared) != 1 || fake.cleared[0] != "binding-1" {
		t.Fatalf("expected binding-1 to be cleared, got %+v", fake.cleared)
	}
}

func TestPatchBindingAndImportSessionEndpoints(t *testing.T) {
	t.Parallel()

	fake := &fakeService{}
	server := httptest.NewServer(NewHandler(fake, "token-1"))
	defer server.Close()

	patchRequest, _ := http.NewRequest(
		http.MethodPatch,
		server.URL+"/api/v1/bindings/binding-1",
		strings.NewReader(`{"workDir":"D:/workspace"}`),
	)
	patchRequest.Header.Set("Content-Type", "application/json")
	patchRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	patchResponse, err := http.DefaultClient.Do(patchRequest)
	if err != nil {
		t.Fatalf("patch request returned error: %v", err)
	}
	defer patchResponse.Body.Close()
	if patchResponse.StatusCode != http.StatusOK {
		t.Fatalf("expected patch 200, got %d", patchResponse.StatusCode)
	}
	if len(fake.updated) != 1 || fake.updated[0] != "binding-1:D:/workspace" {
		t.Fatalf("expected binding update to be recorded, got %+v", fake.updated)
	}

	importRequest, _ := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/v1/sessions/import",
		strings.NewReader(`{"source":"shell-web","sourceSessionId":"web-1","workDir":"D:/repo","summary":"Imported from shell"}`),
	)
	importRequest.Header.Set("Content-Type", "application/json")
	importRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	importResponse, err := http.DefaultClient.Do(importRequest)
	if err != nil {
		t.Fatalf("import request returned error: %v", err)
	}
	defer importResponse.Body.Close()
	if importResponse.StatusCode != http.StatusOK {
		t.Fatalf("expected import 200, got %d", importResponse.StatusCode)
	}
	if len(fake.imported) != 1 || fake.imported[0].SourceSessionID != "web-1" {
		t.Fatalf("expected imported session request to be recorded, got %+v", fake.imported)
	}
}

func TestApprovalsAndRuntimeStopEndpoints(t *testing.T) {
	t.Parallel()

	fake := &fakeService{
		approvals: []domain.ApprovalTicket{
			{
				ApprovalID:    "approval-1",
				KimiSessionID: "session-1",
				TurnID:        "turn-1",
				StepID:        "step-1",
				RequestKind:   "tool",
				Prompt:        "approve?",
				Platform:      "telegram",
				ChatID:        "chat-1",
				Status:        "pending",
				DedupeKey:     "dedupe-1",
			},
		},
	}
	server := httptest.NewServer(NewHandler(fake, "token-1"))
	defer server.Close()

	listRequest, _ := http.NewRequest(http.MethodGet, server.URL+"/api/v1/approvals?status=pending", nil)
	listRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	listResponse, err := http.DefaultClient.Do(listRequest)
	if err != nil {
		t.Fatalf("approvals request returned error: %v", err)
	}
	defer listResponse.Body.Close()
	if listResponse.StatusCode != http.StatusOK {
		t.Fatalf("expected approvals 200, got %d", listResponse.StatusCode)
	}

	resolveRequest, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/approvals/approval-1/resolve", strings.NewReader(`{"status":"approved"}`))
	resolveRequest.Header.Set("Content-Type", "application/json")
	resolveRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	resolveResponse, err := http.DefaultClient.Do(resolveRequest)
	if err != nil {
		t.Fatalf("resolve request returned error: %v", err)
	}
	defer resolveResponse.Body.Close()
	if resolveResponse.StatusCode != http.StatusOK {
		t.Fatalf("expected resolve 200, got %d", resolveResponse.StatusCode)
	}
	if len(fake.resolved) != 1 || fake.resolved[0] != "approval-1" {
		t.Fatalf("expected approval-1 to be resolved, got %+v", fake.resolved)
	}

	stopRequest, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/runtime/stop", nil)
	stopRequest.Header.Set("X-Bridge-Admin-Token", "token-1")
	stopResponse, err := http.DefaultClient.Do(stopRequest)
	if err != nil {
		t.Fatalf("stop request returned error: %v", err)
	}
	defer stopResponse.Body.Close()
	if stopResponse.StatusCode != http.StatusAccepted {
		t.Fatalf("expected stop 202, got %d", stopResponse.StatusCode)
	}
	if fake.requestStopCall == 0 {
		t.Fatalf("expected RequestStop to be called")
	}
}

func TestDebugPromptEndpoint(t *testing.T) {
	t.Parallel()

	fake := &fakeService{
		debugResponse: runtime.PromptResponse{
			KimiSessionID: "session-1",
			TurnID:        "turn-1",
			Events: []runtime.PromptEvent{
				{Type: runtime.EventTypeTurnStarted},
				{Type: runtime.EventTypeContentDelta, StepIndex: 1, Text: "hello"},
				{Type: runtime.EventTypeTurnCompleted, Status: "finished"},
			},
			Result: runtime.PromptResult{Status: "finished"},
		},
	}
	server := httptest.NewServer(NewHandler(fake, "token-1"))
	defer server.Close()

	request, _ := http.NewRequest(http.MethodPost, server.URL+"/api/v1/debug/prompt", strings.NewReader(`{"prompt":"hello"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Bridge-Admin-Token", "token-1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("debug prompt request returned error: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected debug prompt 200, got %d", response.StatusCode)
	}

	var payload runtime.PromptResponse
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("failed to decode debug prompt response: %v", err)
	}
	if payload.KimiSessionID != "session-1" {
		t.Fatalf("expected session-1, got %s", payload.KimiSessionID)
	}
	if len(payload.Events) != 3 {
		t.Fatalf("expected 3 events, got %d", len(payload.Events))
	}
}
