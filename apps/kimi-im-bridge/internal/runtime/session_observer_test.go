package runtime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime/fakeruntime"
)

func TestSessionObserverOrdersDeduplicatesAndDecodesEvents(t *testing.T) {
	fake, server, adapter := newObserverHarness(t)
	defer server.Close()
	sessionID := createObserverSession(t, adapter, "D:/observer")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	batches := make(chan ObserverBatch, 4)
	observer, err := NewSessionObserver(SessionObserverOptions{
		Adapter: adapter,
		Sink: func(_ context.Context, batch ObserverBatch) error {
			batches <- batch
			return nil
		},
		RetryMinDelay: 10 * time.Millisecond,
		RetryMaxDelay: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	updates := make(chan ObserverSubscription, 1)
	done := make(chan error, 1)
	go func() { done <- observer.Run(ctx, updates) }()
	updates <- ObserverSubscription{Generation: 3, SessionIDs: []string{sessionID, sessionID}}
	time.Sleep(30 * time.Millisecond)
	fake.Inject(fakeruntime.Event{Type: "assistant.delta", Seq: 2, SessionID: sessionID, Payload: map[string]any{"delta": "second"}})
	fake.Inject(fakeruntime.Event{Type: "assistant.delta", Seq: 2, SessionID: sessionID, Payload: map[string]any{"delta": "duplicate"}})
	fake.Inject(fakeruntime.Event{Type: "turn.started", Seq: 1, SessionID: sessionID, Payload: map[string]any{"turnId": 42, "metadata": map[string]any{"agent_room": map[string]any{"run_id": "run-1"}}}})

	var events []ObservedRuntimeEvent
	deadline := time.After(2 * time.Second)
	for len(events) < 2 {
		select {
		case batch := <-batches:
			events = append(events, batch.Events...)
		case <-deadline:
			t.Fatalf("timed out waiting for ordered events: %+v", events)
		}
	}
	if events[0].Seq != 1 || events[0].TurnID != "42" || events[0].RunID != "run-1" {
		t.Fatalf("unexpected first event: %+v", events[0])
	}
	if events[1].Seq != 2 || events[1].TextDelta != "second" {
		t.Fatalf("unexpected second event: %+v", events[1])
	}
	cancel()
	<-done
}

func TestDecodeObservedRuntimeFailureUsesNestedCode(t *testing.T) {
	event := decodeObservedRuntimeEvent(wsFrame{
		Type: "event.turn.ended", Seq: 9, SessionID: "session-1", Timestamp: "2026-07-19T08:00:00Z",
		Payload: json.RawMessage(`{"reason":"failed","error":{"code":"model.not_configured","message":"Model not set"}}`),
	}, 4, "epoch-1")
	if !event.Known || event.Status != "failed" || event.ErrorCode != "model.not_configured" || event.Error != "Model not set" {
		t.Fatalf("unexpected decoded failure: %+v", event)
	}
}

func TestSessionObserverResyncAndEmptySubscription(t *testing.T) {
	fake, server, adapter := newObserverHarness(t)
	defer server.Close()
	sessionID := createObserverSession(t, adapter, "D:/resync")

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var mu sync.Mutex
	cursorEpoch := "stale-epoch"
	batches := make(chan ObserverBatch, 2)
	observer, err := NewSessionObserver(SessionObserverOptions{
		Adapter: adapter,
		LoadCursor: func(context.Context, string) (ObserverCursor, bool, error) {
			mu.Lock()
			defer mu.Unlock()
			return ObserverCursor{Seq: 3, Epoch: cursorEpoch}, true, nil
		},
		Sink: func(_ context.Context, batch ObserverBatch) error {
			batches <- batch
			return nil
		},
		RetryMinDelay: 10 * time.Millisecond,
		RetryMaxDelay: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	updates := make(chan ObserverSubscription, 2)
	done := make(chan error, 1)
	go func() { done <- observer.Run(ctx, updates) }()
	updates <- ObserverSubscription{Generation: 3, SessionIDs: []string{sessionID}}
	select {
	case batch := <-batches:
		if !batch.ResyncRequired || batch.Epoch != fake.Epoch() {
			t.Fatalf("unexpected resync batch: %+v", batch)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for resync")
	}
	updates <- ObserverSubscription{Generation: 3}
	close(updates)
	if err := <-done; err != nil {
		t.Fatalf("observer did not stop cleanly: %v", err)
	}
}

func TestSessionObserverReadDeadlineReconnects(t *testing.T) {
	fake, server, adapter := newObserverHarness(t)
	defer server.Close()
	sessionID := createObserverSession(t, adapter, "D:/deadline")
	ctx, cancel := context.WithCancel(context.Background())
	observer, err := NewSessionObserver(SessionObserverOptions{
		Adapter: adapter, Sink: func(context.Context, ObserverBatch) error { return nil },
		HelloTimeout: time.Second, ReadTimeout: 50 * time.Millisecond, RetryMinDelay: 10 * time.Millisecond, RetryMaxDelay: 20 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	updates := make(chan ObserverSubscription, 1)
	done := make(chan error, 1)
	go func() { done <- observer.Run(ctx, updates) }()
	updates <- ObserverSubscription{Generation: 3, SessionIDs: []string{sessionID}}
	deadline := time.Now().Add(2 * time.Second)
	for fake.ConnectionCount() < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if fake.ConnectionCount() < 2 {
		t.Fatalf("read deadline did not reconnect; connections=%d", fake.ConnectionCount())
	}
	cancel()
	<-done
}

func newObserverHarness(t *testing.T) (*fakeruntime.Server, *httptest.Server, *KimiCodeServerAdapter) {
	t.Helper()
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "server.token")
	if err := os.WriteFile(tokenPath, []byte("secret-token"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake, err := fakeruntime.New(fakeruntime.Config{TokenPath: tokenPath, Transcript: true})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(fake)
	locatorPath := filepath.Join(dir, "locator.json")
	raw, _ := json.Marshal(map[string]any{"origin": server.URL, "tokenPath": tokenPath, "health": "ready", "generation": 3})
	if err := os.WriteFile(locatorPath, raw, 0o600); err != nil {
		server.Close()
		t.Fatal(err)
	}
	adapter, err := NewKimiCodeServerAdapter(KimiCodeServerAdapterOptions{RuntimeLocatorPath: locatorPath, HTTPClient: &http.Client{}})
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	return fake, server, adapter
}

func createObserverSession(t *testing.T, adapter *KimiCodeServerAdapter, root string) string {
	t.Helper()
	ref, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{WorkspaceRoot: root, CreateMode: SessionCreateAlways})
	if err != nil {
		t.Fatal(err)
	}
	return ref.KimiCodeSessionID
}
