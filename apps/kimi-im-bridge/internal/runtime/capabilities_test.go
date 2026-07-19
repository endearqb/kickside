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
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestProbeRuntimeCapabilitiesReadOnlyAndRedacted(t *testing.T) {
	const token = "probe-secret-token"
	var mu sync.Mutex
	var helloCounts []int
	upgrader := websocket.Upgrader{
		Subprotocols: []string{wsBearerProtocolPrefix + token},
		CheckOrigin:  func(*http.Request) bool { return true },
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/sessions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("probe mutated runtime with %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer "+token {
			t.Fatal("missing bearer token")
		}
		items := make([]map[string]any, 12)
		for i := range items {
			items[i] = map[string]any{"id": fmt.Sprintf("session-%02d", i), "status": "idle", "last_seq": i + 10}
		}
		writeProbeEnvelope(t, w, map[string]any{"items": items, "has_more": false})
	})
	mux.HandleFunc("/api/v1/sessions/session-00/messages", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("probe mutated transcript with %s", r.Method)
		}
		writeProbeEnvelope(t, w, map[string]any{"items": []any{}})
	})
	mux.HandleFunc("/api/v1/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		defer conn.Close()
		if err := conn.WriteJSON(map[string]any{"type": "server_hello"}); err != nil {
			t.Errorf("write hello: %v", err)
			return
		}
		var hello struct {
			Type    string `json:"type"`
			Payload struct {
				Subscriptions []string            `json:"subscriptions"`
				Cursors       map[string]wsCursor `json:"cursors"`
			} `json:"payload"`
		}
		if err := conn.ReadJSON(&hello); err != nil {
			t.Errorf("read client hello: %v", err)
			return
		}
		if hello.Type != "client_hello" || len(hello.Payload.Subscriptions) != len(hello.Payload.Cursors) {
			t.Errorf("invalid client hello: %+v", hello)
			return
		}
		for _, id := range hello.Payload.Subscriptions {
			if hello.Payload.Cursors[id].Seq < 10 {
				t.Errorf("missing last_seq cursor for %s", id)
			}
		}
		mu.Lock()
		helloCounts = append(helloCounts, len(hello.Payload.Subscriptions))
		mu.Unlock()
		_ = conn.WriteJSON(map[string]any{"type": "ack", "id": "runtime-capability-probe"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "server.token")
	locatorPath := filepath.Join(dir, "locator.json")
	if err := os.WriteFile(tokenPath, []byte(token), 0o600); err != nil {
		t.Fatal(err)
	}
	locator, _ := json.Marshal(map[string]any{"origin": server.URL, "tokenPath": tokenPath, "health": "ready"})
	if err := os.WriteFile(locatorPath, locator, 0o600); err != nil {
		t.Fatal(err)
	}

	report := ProbeRuntimeCapabilities(context.Background(), RuntimeCapabilityProbeOptions{
		RuntimeLocatorPath: locatorPath,
		Timeout:            time.Second,
		ObserverCounts:     []int{1, 6},
	})
	if !report.Provider.Supported || !report.Transcript.Supported || !report.SessionState.Supported || !report.PerSessionCursors.Supported {
		t.Fatalf("expected supported read-only capabilities: %+v", report)
	}
	for _, count := range []string{"2", "6", "12"} {
		if !report.MultiSession[count].Supported {
			t.Fatalf("subscription %s unsupported: %+v", count, report.MultiSession[count])
		}
	}
	for _, count := range []string{"1", "6"} {
		if !report.ObserverTransport[count].Supported {
			t.Fatalf("SessionObserver %s unsupported: %+v", count, report.ObserverTransport[count])
		}
	}
	mu.Lock()
	gotCounts := fmt.Sprint(helloCounts)
	mu.Unlock()
	if gotCounts != "[2 6 12 1 6]" {
		t.Fatalf("hello subscription counts = %s", gotCounts)
	}
	raw, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), token) || strings.Contains(string(raw), tokenPath) {
		t.Fatalf("report leaked secret material: %s", raw)
	}
	if report.Unknown["abortConfirmation"].Supported || report.Unknown["abortConfirmation"].Degradation == "" {
		t.Fatal("mutating unknown must have explicit degradation")
	}
}

func TestProbeRuntimeCapabilitiesReportsUnavailableWithoutGuessing(t *testing.T) {
	report := ProbeRuntimeCapabilities(context.Background(), RuntimeCapabilityProbeOptions{})
	if report.Provider.Supported || report.Provider.Degradation == "" {
		t.Fatalf("unexpected provider result: %+v", report.Provider)
	}
	if report.MultiSession["2"].Supported || report.MultiSession["2"].Evidence == "" {
		t.Fatalf("unexpected multi-session result: %+v", report.MultiSession["2"])
	}
}

func TestSelectProbeSessionsCapsDefaultReport(t *testing.T) {
	items := make([]apiSession, 13)
	if got := len(selectProbeSessions(items, nil)); got != 12 {
		t.Fatalf("default probe Session count = %d, want 12", got)
	}
}

func writeProbeEnvelope(t *testing.T, w http.ResponseWriter, data any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{"code": 0, "msg": "ok", "data": data}); err != nil {
		t.Errorf("encode response: %v", err)
	}
}
