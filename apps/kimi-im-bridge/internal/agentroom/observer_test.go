package agentroom

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime/fakeruntime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

func TestObserverCoordinatorDiscoversSixPaneSessionsMirrorsAndRecoversEpoch(t *testing.T) {
	fake, server, adapter := newCoordinatorRuntime(t)
	defer server.Close()
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer dataStore.Close()
	panes := make([]domain.PaneSessionObservation, 0, 6)
	sessionIDs := make([]string, 0, 6)
	for index := 0; index < 6; index++ {
		ref, err := adapter.EnsureSession(context.Background(), bridgeruntime.EnsureSessionRequest{WorkspaceRoot: "D:/observer/" + string(rune('a'+index)), CreateMode: bridgeruntime.SessionCreateAlways})
		if err != nil {
			t.Fatal(err)
		}
		sessionIDs = append(sessionIDs, ref.KimiCodeSessionID)
		panes = append(panes, domain.PaneSessionObservation{PaneID: "pane-" + string(rune('1'+index)), ActiveSessionID: ref.KimiCodeSessionID, EffectiveSessionID: ref.KimiCodeSessionID, Visible: true})
	}
	if _, err := dataStore.SyncPaneSessionObservations(context.Background(), 1, panes); err != nil {
		t.Fatal(err)
	}
	coordinator := NewObserverCoordinator(dataStore, adapter, 10*time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- coordinator.Run(ctx) }()
	waitFor(t, 3*time.Second, func() bool {
		for _, sessionID := range sessionIDs {
			if item, _ := dataStore.GetSessionByID(context.Background(), sessionID); item == nil {
				return false
			}
		}
		return coordinator.Running()
	})
	waitFor(t, 3*time.Second, func() bool { return fake.SubscriptionCount() == 1 && len(fake.SubscribedSessionIDs()) == 6 })
	fake.Ping()
	waitFor(t, 3*time.Second, func() bool { return fake.PongCount() > 0 })
	for _, sessionID := range sessionIDs {
		fake.Inject(fakeruntime.Event{Type: "turn.started", Seq: 1, SessionID: sessionID, Payload: map[string]any{"turnId": 1}})
	}
	waitFor(t, 3*time.Second, func() bool {
		items, _ := dataStore.ListSessionObservations(context.Background())
		return len(items) == 6
	})
	target := sessionIDs[0]
	fake.Inject(fakeruntime.Event{Type: "assistant.delta", Seq: 3, SessionID: target, Payload: map[string]any{"delta": "B"}})
	fake.Inject(fakeruntime.Event{Type: "assistant.delta", Seq: 2, SessionID: target, Payload: map[string]any{"delta": "A"}})
	waitFor(t, 3*time.Second, func() bool {
		item, _ := dataStore.GetSessionObservation(context.Background(), target)
		return item != nil && item.LastSeq == 3 && item.LastReply == "AB"
	})
	observation, _ := dataStore.GetSessionObservation(context.Background(), target)
	if observation.ControlOrigin != "pane_manual" {
		t.Fatalf("unmatched Pane event has wrong origin: %+v", observation)
	}
	fake.AddApproval(target, "approval-pane")
	waitFor(t, 3*time.Second, func() bool {
		approval, _ := dataStore.GetApprovalByID(context.Background(), "approval-pane")
		return approval != nil && approval.Status == "pending" && approval.KimiSessionID == target
	})
	oldEpoch := fake.Epoch()
	fake.Restart()
	waitFor(t, 3*time.Second, func() bool {
		_, epoch, _, ok, _ := dataStore.GetSessionWatchCursor(context.Background(), target)
		return ok && epoch != "" && epoch != oldEpoch
	})
	fake.Inject(fakeruntime.Event{Type: "turn.started", Seq: 1, SessionID: target})
	waitFor(t, 3*time.Second, func() bool {
		item, _ := dataStore.GetSessionObservation(context.Background(), target)
		return item != nil && item.LastSeq == 1 && item.SessionState == "running"
	})
	if _, err := dataStore.SyncPaneSessionObservations(context.Background(), 2, nil); err != nil {
		t.Fatal(err)
	}
	if err := dataStore.ResolveApproval(context.Background(), "approval-pane", "approved", `{}`); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 3*time.Second, func() bool { return fake.SubscriptionCount() == 0 })
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("unexpected coordinator stop: %v", err)
	}
	if coordinator.Running() {
		t.Fatal("coordinator still reports running after cancellation")
	}
}

func newCoordinatorRuntime(t *testing.T) (*fakeruntime.Server, *httptest.Server, *bridgeruntime.KimiCodeServerAdapter) {
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
	adapter, err := bridgeruntime.NewKimiCodeServerAdapter(bridgeruntime.KimiCodeServerAdapterOptions{RuntimeLocatorPath: locatorPath, HTTPClient: &http.Client{}})
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	return fake, server, adapter
}

func waitFor(t *testing.T, timeout time.Duration, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition was not met before timeout")
}
