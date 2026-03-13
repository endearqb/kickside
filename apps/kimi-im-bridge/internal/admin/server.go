package admin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type Service interface {
	Status(context.Context) (domain.BridgeStatus, error)
	ListBindings(context.Context) ([]domain.BindingRecord, error)
	ClearBinding(context.Context, string) error
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
	mux.HandleFunc("/api/v1/bindings/", func(writer http.ResponseWriter, request *http.Request) {
		if !authorize(writer, request, adminToken) {
			return
		}
		if request.Method != http.MethodDelete {
			writeJSON(writer, http.StatusMethodNotAllowed, map[string]string{"error": "method_not_allowed"})
			return
		}
		bindingID := strings.TrimPrefix(request.URL.Path, "/api/v1/bindings/")
		if bindingID == "" || strings.Contains(bindingID, "/") {
			writeJSON(writer, http.StatusBadRequest, map[string]string{"error": "invalid_binding_id"})
			return
		}
		if err := service.ClearBinding(request.Context(), bindingID); err != nil {
			writeJSON(writer, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	})
	return mux
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
