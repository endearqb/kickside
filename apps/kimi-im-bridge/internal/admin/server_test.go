package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type fakeService struct {
	status   domain.BridgeStatus
	bindings []domain.BindingRecord
	cleared  []string
}

func (f *fakeService) Status(context.Context) (domain.BridgeStatus, error) {
	return f.status, nil
}

func (f *fakeService) ListBindings(context.Context) ([]domain.BindingRecord, error) {
	return f.bindings, nil
}

func (f *fakeService) ClearBinding(_ context.Context, bindingID string) error {
	f.cleared = append(f.cleared, bindingID)
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
