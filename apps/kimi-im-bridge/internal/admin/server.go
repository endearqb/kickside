package admin

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

const (
	maxAdminBodyBytes       = 1 << 20
	maxDebugPromptBodyBytes = 4 << 20
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

type AdminEnvelope struct {
	Ok        bool        `json:"ok"`
	Data      any         `json:"data,omitempty"`
	Error     *AdminError `json:"error,omitempty"`
	RequestID string      `json:"requestId"`
}

type AdminError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

func NewHandler(service Service, adminToken string) http.Handler {
	return NewHandlerWithAgentRoom(service, adminToken, nil)
}

func NewHandlerWithAgentRoom(service Service, adminToken string, agentRoomRoutes *AgentRoomRoutes) http.Handler {
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
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		status, err := service.Status(request.Context())
		if err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, status)
	})
	mux.HandleFunc("/api/v1/bindings", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodGet {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		bindings, err := service.ListBindings(request.Context())
		if err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, map[string]any{"items": bindings})
	})
	mux.HandleFunc("/api/v1/sessions", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodGet {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		sessions, err := service.ListSessions(request.Context())
		if err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, map[string]any{"items": sessions})
	})
	mux.HandleFunc("/api/v1/sessions/import", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		var payload domain.SessionImportRequest
		if !decodeAdminJSON(writer, request, &payload, maxAdminBodyBytes) {
			return
		}
		session, err := service.ImportSession(request.Context(), payload)
		if err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, session)
	})
	mux.HandleFunc("/api/v1/bindings/", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodDelete && request.Method != http.MethodPatch {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		bindingID := strings.TrimPrefix(request.URL.Path, "/api/v1/bindings/")
		if bindingID == "" || strings.Contains(bindingID, "/") {
			writeAdminError(writer, request, http.StatusBadRequest, "invalid_binding_id", "invalid binding id", nil)
			return
		}
		if request.Method == http.MethodPatch {
			var payload domain.BindingUpdate
			if !decodeAdminJSON(writer, request, &payload, maxAdminBodyBytes) {
				return
			}
			record, err := service.UpdateBinding(request.Context(), bindingID, payload)
			if err != nil {
				writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
				return
			}
			writeAdminData(writer, request, http.StatusOK, record)
			return
		}
		if err := service.ClearBinding(request.Context(), bindingID); err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/v1/approvals", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodGet {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		items, err := service.ListApprovals(request.Context(), request.URL.Query().Get("status"))
		if err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, map[string]any{"items": items})
	})
	mux.HandleFunc("/api/v1/approvals/", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		approvalID, action, ok := parseNestedAction(request.URL.Path, "/api/v1/approvals/")
		if !ok || action != "resolve" {
			writeAdminError(writer, request, http.StatusBadRequest, "invalid_approval_path", "invalid approval path", nil)
			return
		}
		var payload struct {
			Status                string `json:"status"`
			ResolutionPayloadJSON string `json:"resolutionPayloadJson,omitempty"`
		}
		if !decodeAdminJSON(writer, request, &payload, maxAdminBodyBytes) {
			return
		}
		if payload.Status == "" {
			writeAdminError(writer, request, http.StatusBadRequest, "missing_status", "status is required", nil)
			return
		}
		if err := service.ResolveApproval(request.Context(), approvalID, payload.Status, payload.ResolutionPayloadJSON); err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/api/v1/runtime/stop", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		writeAdminData(writer, request, http.StatusAccepted, map[string]string{"status": "stopping"})
		go func() {
			_ = service.RequestStop()
		}()
	})
	mux.HandleFunc("/api/v1/debug/prompt", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodPost {
			writeAdminError(writer, request, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
			return
		}
		var payload runtime.PromptRequest
		if !decodeAdminJSON(writer, request, &payload, maxDebugPromptBodyBytes) {
			return
		}
		response, err := service.DebugPrompt(request.Context(), payload)
		if err != nil {
			writeAdminError(writer, request, http.StatusInternalServerError, "internal_error", err.Error(), nil)
			return
		}
		writeAdminData(writer, request, http.StatusOK, response)
	})
	if agentRoomRoutes != nil {
		mux.HandleFunc("/api/v1/agent-room/", func(writer http.ResponseWriter, request *http.Request) {
			if !authorize(writer, request, adminToken) {
				return
			}
			agentRoomRoutes.ServeHTTP(writer, request)
		})
	}
	return mux
}

func decodeAdminJSON(writer http.ResponseWriter, request *http.Request, target any, maxBytes int64) bool {
	request.Body = http.MaxBytesReader(writer, request.Body, maxBytes)
	decoder := json.NewDecoder(request.Body)
	err := decoder.Decode(target)
	if err == nil {
		err = decoder.Decode(&struct{}{})
		if err == io.EOF {
			return true
		}
	}
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeAdminError(writer, request, http.StatusRequestEntityTooLarge, "body_too_large", "request body too large", nil)
		return false
	}
	writeAdminError(writer, request, http.StatusBadRequest, "invalid_json", "invalid JSON request body", nil)
	return false
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
		writeAdminError(writer, request, http.StatusUnauthorized, "missing_admin_token", "admin token is not configured", nil)
		return false
	}
	actualToken := request.Header.Get("X-Bridge-Admin-Token")
	if subtle.ConstantTimeCompare([]byte(actualToken), []byte(expectedToken)) != 1 {
		writeAdminError(writer, request, http.StatusUnauthorized, "unauthorized", "invalid admin token", nil)
		return false
	}
	return true
}

func writeAdminData(writer http.ResponseWriter, request *http.Request, status int, data any) {
	writeJSON(writer, status, AdminEnvelope{
		Ok:        true,
		Data:      data,
		RequestID: requestID(request),
	})
}

func writeAdminError(writer http.ResponseWriter, request *http.Request, status int, code string, message string, details any) {
	writeJSON(writer, status, AdminEnvelope{
		Ok: false,
		Error: &AdminError{
			Code:    code,
			Message: message,
			Details: details,
		},
		RequestID: requestID(request),
	})
}

func requestID(request *http.Request) string {
	if request != nil {
		if id := strings.TrimSpace(request.Header.Get("X-Request-ID")); id != "" {
			return id
		}
	}
	return fmt.Sprintf("bridge-%d", time.Now().UnixNano())
}

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(payload); err != nil {
		http.Error(writer, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
	}
}
