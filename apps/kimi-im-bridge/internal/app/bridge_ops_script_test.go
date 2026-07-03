package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestBridgeOpsScriptStatusAcceptsExplicitAuthFileWithoutEnv(t *testing.T) {
	t.Parallel()

	if runtime.GOOS != "windows" {
		t.Skip("PowerShell bridge ops script test is only supported on Windows")
	}

	if _, err := exec.LookPath("powershell"); err != nil {
		t.Skipf("powershell is not available: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if got := strings.TrimSpace(request.Header.Get("X-Bridge-Admin-Token")); got != "admin-token" {
			t.Fatalf("unexpected admin token header %q", got)
		}

		switch request.URL.Path {
		case "/api/v1/status":
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"state":            "running",
				"startedAt":        "2026-03-21T09:15:30+08:00",
				"channels":         []any{},
				"bindings":         0,
				"pendingApprovals": 0,
			})
		case "/api/v1/sessions":
			_ = json.NewEncoder(writer).Encode(map[string]any{
				"items": []map[string]any{
					{
						"kimiSessionId": "session-1",
						"summary":       "Test session",
						"workDir":       "D:/repo",
						"sessionState":  "ready",
					},
				},
			})
		default:
			t.Fatalf("unexpected request path: %s", request.URL.Path)
		}
	}))
	defer server.Close()

	dir := t.TempDir()
	authPath := filepath.Join(dir, "bridge_skill_auth.json")
	authPayload := bridgeSkillsAuthPayload{
		AdminBaseURL: server.URL,
		AdminToken:   "admin-token",
		GeneratedAt:  "2026-03-20T00:00:00Z",
	}
	raw, err := json.Marshal(authPayload)
	if err != nil {
		t.Fatalf("Marshal returned error: %v", err)
	}
	if err := os.WriteFile(authPath, raw, 0o600); err != nil {
		t.Fatalf("WriteFile returned error: %v", err)
	}

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	scriptPath := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "..", "skills", "bridge-ops", "scripts", "bridge_ops.ps1"))
	if _, err := os.Stat(scriptPath); err != nil {
		if os.IsNotExist(err) {
			t.Skipf("bridge ops skill script is not present: %s", scriptPath)
		}
		t.Fatalf("failed to stat bridge ops script: %v", err)
	}

	cmd := exec.Command(
		"powershell",
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		scriptPath,
		"status",
		"--auth-file",
		authPath,
	)
	cmd.Env = withoutEnv(os.Environ(), "KIMI_BRIDGE_AUTH_FILE")
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("bridge_ops.ps1 returned error: %v\noutput: %s", err, string(output))
	}

	var result struct {
		Ok              bool   `json:"ok"`
		Action          string `json:"action"`
		Message         string `json:"message"`
		BridgeState     string `json:"bridge_state"`
		BridgeStartedAt string `json:"bridge_started_at"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		t.Fatalf("Unmarshal returned error: %v\noutput: %s", err, string(output))
	}
	if !result.Ok {
		t.Fatalf("expected ok result, got %+v", result)
	}
	if result.Action != "status" || result.BridgeState != "running" {
		t.Fatalf("unexpected script result: %+v", result)
	}
	if strings.TrimSpace(result.BridgeStartedAt) == "" {
		t.Fatalf("expected bridge_started_at to be returned, got %+v", result)
	}
}

func withoutEnv(env []string, key string) []string {
	prefix := key + "="
	filtered := make([]string, 0, len(env))
	for _, item := range env {
		if strings.HasPrefix(strings.ToUpper(item), strings.ToUpper(prefix)) {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}
