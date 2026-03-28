package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

type Service interface {
	Status(context.Context) (domain.BridgeStatus, error)
	ListBindings(context.Context) ([]domain.BindingRecord, error)
	ListSessions(context.Context) ([]domain.BridgeSession, error)
	ClearBinding(context.Context, string) error
	UpdateBinding(context.Context, string, domain.BindingUpdate) (domain.BindingRecord, error)
	ListApprovals(context.Context, string) ([]domain.ApprovalTicket, error)
	ResolveApproval(context.Context, string, string, string) error
	ImportSession(context.Context, domain.SessionImportRequest) (domain.BridgeSession, error)
	DebugPrompt(context.Context, runtime.PromptRequest) (runtime.PromptResponse, error)
	RequestStop() error
}

func NewHandler(service Service, adminToken string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]bool{"ok": true})
	})
	mux.HandleFunc("/api/v1/status", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodGet {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		status, err := service.Status(request.Context())
		if err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, status)
	})
	mux.HandleFunc("/api/v1/bindings", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodGet {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		bindings, err := service.ListBindings(request.Context())
		if err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"items": bindings})
	})
	mux.HandleFunc("/api/v1/sessions", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodGet {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		sessions, err := service.ListSessions(request.Context())
		if err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"items": sessions})
	})
	mux.HandleFunc("/api/v1/sessions/import", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		var payload domain.SessionImportRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		session, err := service.ImportSession(request.Context(), payload)
		if err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, session)
	})
	mux.HandleFunc("/api/v1/bindings/", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodDelete && request.Method != http.MethodPatch {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		bindingID := strings.TrimPrefix(request.URL.Path, "/api/v1/bindings/")
		if bindingID == "" || strings.Contains(bindingID, "/") {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_binding_id"})
			return
		}
		if request.Method == http.MethodPatch {
			var payload domain.BindingUpdate
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
				writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
				return
			}
			record, err := service.UpdateBinding(request.Context(), bindingID, payload)
			if err != nil {
				writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(writer, http.StatusOK, record)
			return
		}
		if err := service.ClearBinding(request.Context(), bindingID); err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/v1/approvals", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodGet {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		items, err := service.ListApprovals(request.Context(), request.URL.Query().Get("status"))
		if err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("/api/v1/approvals/", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		approvalID, action, ok := parseNestedAction(request.URL.Path, "/api/v1/approvals/")
		if !ok || action != "resolve" {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_approval_path"})
			return
		}
		var payload struct {
			Status                string `json:"status"`
			ResolutionPayloadJSON string `json:"resolutionPayloadJson,omitempty"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		if payload.Status == "" {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "missing_status"})
			return
		}
		if err := service.ResolveApproval(request.Context(), approvalID, payload.Status, payload.ResolutionPayloadJSON); err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/v1/runtime/stop", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		writeJSON(writer, http.StatusAccepted, map[string]string{"status": "stopping"})
		go func() {
			_ = service.RequestStop()
		}()
	})
	mux.HandleFunc("/api/v1/debug/prompt", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		var payload runtime.PromptRequest
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_json"})
			return
		}
		response, err := service.DebugPrompt(request.Context(), payload)
		if err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, response)
	})
	return mux
}

func parseNestedAction(path string, prefix string) (string, string, bool) {
	trimmed := strings.TrimPrefix(path, prefix)
	if trimmed == "" || strings.Contains(trimmed, "//") {
		return "", "", false
	}
	parts := strings.Split(trimmed, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func authorize(writer http.ResponseWriter, request *http.Request, expectedToken string) bool {
	if request.URL.Path == "/healthz" {
		return true
	}
	if expectedToken == "" {
		writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "missing_admin_token"})
		return false
	}
	if request.Header.Get("X-Bridge-Admin-Token") != expectedToken {
		writeJSON(writer, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return false
	}
	return true
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(payload); err != nil {
		http.Error(writer, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
	}
}
