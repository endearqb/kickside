package fakeruntime_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	bridgeRuntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime/fakeruntime"
	"github.com/gorilla/websocket"
)

func TestHarnessCoreProtocol(t *testing.T) {
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "runtime.token")
	if err := os.WriteFile(tokenPath, []byte("test-secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake, err := fakeruntime.New(fakeruntime.Config{TokenPath: tokenPath, Transcript: true})
	if err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(fake)
	defer httpServer.Close()
	locatorPath := filepath.Join(dir, "locator.json")
	locator, _ := json.Marshal(map[string]any{"origin": httpServer.URL, "tokenPath": tokenPath, "health": "ready"})
	if err := os.WriteFile(locatorPath, locator, 0o600); err != nil {
		t.Fatal(err)
	}
	adapter, err := bridgeRuntime.NewKimiCodeServerAdapter(bridgeRuntime.KimiCodeServerAdapterOptions{RuntimeLocatorPath: locatorPath})
	if err != nil {
		t.Fatal(err)
	}

	first, err := adapter.EnsureSession(context.Background(), bridgeRuntime.EnsureSessionRequest{WorkspaceRoot: "D:/one"})
	if err != nil {
		t.Fatal(err)
	}
	second := post(t, httpServer.URL+"/api/v1/sessions", `{"metadata":{"cwd":"D:/two"}}`)["id"].(string)
	result, err := adapter.SubmitPrompt(context.Background(), bridgeRuntime.AdapterPromptRequest{SessionID: first.KimiCodeSessionID, Text: "hello"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "running" {
		t.Fatalf("unexpected prompt: %+v", result)
	}

	fake.AddApproval(first.KimiCodeSessionID, "approval_1")
	items, err := adapter.ListApprovals(context.Background(), first.KimiCodeSessionID)
	if err != nil || len(items) != 1 {
		t.Fatalf("approvals=%+v err=%v", items, err)
	}
	if err := adapter.ResolveApproval(context.Background(), first.KimiCodeSessionID, "approval_1", bridgeRuntime.ApprovalDecision{Decision: "approved"}); err != nil {
		t.Fatal(err)
	}
	if err := adapter.AbortPrompt(context.Background(), first.KimiCodeSessionID, result.PromptID); err != nil {
		t.Fatal(err)
	}

	fake.Inject(fakeruntime.Event{Type: "assistant.delta", SessionID: second, Seq: 7, Payload: map[string]any{"delta": "a"}})
	fake.Inject(fakeruntime.Event{Type: "assistant.delta", SessionID: second, Seq: 7, Payload: map[string]any{"delta": "duplicate"}})
	fake.Inject(fakeruntime.Event{Type: "assistant.delta", SessionID: second, Seq: 6, Payload: map[string]any{"delta": "out-of-order"}})
	conn := connect(t, httpServer.URL, map[string]int{first.KimiCodeSessionID: 0, second: 5}, "")
	defer conn.Close()
	seen := map[string]int{}
	for i := 0; i < 9; i++ {
		var frame struct {
			Type      string `json:"type"`
			SessionID string `json:"session_id"`
			Seq       int    `json:"seq"`
		}
		if err := conn.ReadJSON(&frame); err != nil {
			t.Fatal(err)
		}
		seen[frame.SessionID+":"+frame.Type]++
	}
	if seen[second+":assistant.delta"] != 3 {
		t.Fatalf("duplicate/out-of-order replay missing: %#v", seen)
	}

	reconnected := connect(t, httpServer.URL, map[string]int{second: 7}, fake.Epoch())
	defer reconnected.Close()
	fake.Inject(fakeruntime.Event{Type: "thinking.delta", SessionID: second, Payload: map[string]any{"delta": "live"}})
	var live struct{ Type string }
	if err := reconnected.ReadJSON(&live); err != nil || live.Type != "thinking.delta" {
		t.Fatalf("live=%+v err=%v", live, err)
	}
	oldEpoch := fake.Epoch()
	fake.Restart()
	stale := connect(t, httpServer.URL, map[string]int{second: 8}, oldEpoch)
	defer stale.Close()
	var resync struct{ Type string }
	if err := stale.ReadJSON(&resync); err != nil || resync.Type != "resync_required" {
		t.Fatalf("resync=%+v err=%v", resync, err)
	}

	if status := getStatus(t, httpServer.URL+"/api/v1/sessions/"+first.KimiCodeSessionID+"/messages"); status != http.StatusOK {
		t.Fatalf("transcript status=%d", status)
	}
	post(t, httpServer.URL+"/api/v1/_fake/transcript", `{"enabled":false}`)
	if status := getStatus(t, httpServer.URL+"/api/v1/sessions/"+first.KimiCodeSessionID+"/messages"); status != http.StatusNotFound {
		t.Fatalf("disabled transcript status=%d", status)
	}
}

func connect(t *testing.T, origin string, cursors map[string]int, epoch string) *websocket.Conn {
	t.Helper()
	parsed, _ := url.Parse(origin)
	parsed.Scheme = "ws"
	parsed.Path = "/api/v1/ws"
	dialer := *websocket.DefaultDialer
	dialer.Subprotocols = []string{"kimi-code.bearer.test-secret"}
	conn, _, err := dialer.Dial(parsed.String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var hello map[string]any
	if err := conn.ReadJSON(&hello); err != nil {
		t.Fatal(err)
	}
	encoded := map[string]any{}
	subscriptions := []string{}
	for id, seq := range cursors {
		subscriptions = append(subscriptions, id)
		encoded[id] = map[string]any{"seq": seq, "epoch": epoch}
	}
	if err := conn.WriteJSON(map[string]any{"type": "client_hello", "id": "test", "payload": map[string]any{"subscriptions": subscriptions, "cursors": encoded}}); err != nil {
		t.Fatal(err)
	}
	var ack map[string]any
	if err := conn.ReadJSON(&ack); err != nil || ack["type"] != "ack" {
		t.Fatalf("ack=%#v err=%v", ack, err)
	}
	return conn
}

func post(t *testing.T, endpoint, body string) map[string]any {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer test-secret")
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var envelope struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if res.StatusCode >= 300 {
		t.Fatalf("POST %s returned %d", endpoint, res.StatusCode)
	}
	return envelope.Data
}

func getStatus(t *testing.T, endpoint string) int {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, endpoint, nil)
	req.Header.Set("Authorization", "Bearer test-secret")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode
}
