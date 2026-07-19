package app

import (
	"context"
	"encoding/json"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime/fakeruntime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

func TestInspectRuntimeLocatorReadsHealth(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "kimi_runtime_locator.json")
	if err := os.WriteFile(path, []byte(`{"health":"ready","tokenRedacted":"abcd***xyz"}`), 0o600); err != nil {
		t.Fatalf("write locator: %v", err)
	}

	status := inspectRuntimeLocator(path)
	if !status.Configured || !status.Readable || status.Health != "ready" {
		t.Fatalf("unexpected locator status: %+v", status)
	}
}

func TestAgentRoomObserverLifecycleAndCapabilitiesUseReadyServer(t *testing.T) {
	dir := t.TempDir()
	tokenPath := filepath.Join(dir, "runtime.token")
	if err := os.WriteFile(tokenPath, []byte("runtime-secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake, err := fakeruntime.New(fakeruntime.Config{TokenPath: tokenPath, Transcript: true})
	if err != nil {
		t.Fatal(err)
	}
	runtimeServer := httptest.NewServer(fake)
	defer runtimeServer.Close()
	locatorPath := filepath.Join(dir, "locator.json")
	locator, _ := json.Marshal(map[string]any{"origin": runtimeServer.URL, "tokenPath": tokenPath, "health": "ready", "generation": 7})
	if err := os.WriteFile(locatorPath, locator, 0o600); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	service, err := New(Options{
		Version: "test", ConfigPath: filepath.Join(dir, "settings.json"), SecretsPath: filepath.Join(dir, "secrets.json"),
		DBPath: filepath.Join(dir, "bridge.db"), LogFilePath: filepath.Join(dir, "bridge.log"), AdminPort: port,
		AdminToken: "admin-secret", KimiRuntimeLocatorPath: locatorPath, AgentRoomEnabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	if err := service.Start(); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		status, err := service.Status(context.Background())
		if err == nil && status.AgentRoom.Observer == "running" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	status, err := service.Status(context.Background())
	if err != nil || status.AgentRoom.Observer != "running" || containsString(status.AgentRoom.Degradations, "observer_not_running") {
		t.Fatalf("unexpected Observer status: %+v err=%v", status.AgentRoom, err)
	}
	capabilities := service.agentRoomCapabilities(context.Background())
	if !capabilities.Observer || !capabilities.MultiSessionObservation || !capabilities.UserPromptEvents || !capabilities.SessionTranscript {
		t.Fatalf("unexpected ready Server capabilities: %+v", capabilities)
	}
	if err := service.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if service.agentRoomObserver != nil {
		t.Fatal("Observer reference survived shutdown")
	}
}

func TestRuntimeAdapterStatusFollowsLocator(t *testing.T) {
	t.Parallel()

	ready := runtimeAdapterStatus(domain.RuntimeLocatorStatus{
		Configured: true,
		Readable:   true,
		Health:     "ready",
	})
	if ready.Name != "server" || ready.State != "ready" || ready.LastError != "" {
		t.Fatalf("unexpected ready adapter status: %+v", ready)
	}

	degraded := runtimeAdapterStatus(domain.RuntimeLocatorStatus{
		Configured: true,
		LastError:  "read locator: missing",
	})
	if degraded.State != "degraded" || degraded.LastError == "" {
		t.Fatalf("unexpected degraded adapter status: %+v", degraded)
	}
}

func TestAgentRoomStatusReportsFlagAndActualProviderDegradation(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	service, err := New(Options{
		Version:          "test",
		ConfigPath:       filepath.Join(dir, "bridge_settings.json"),
		SecretsPath:      filepath.Join(dir, "bridge_secrets.json"),
		DBPath:           filepath.Join(dir, "bridge.db"),
		LogFilePath:      filepath.Join(dir, "bridge.log"),
		AdminPort:        60110,
		AdminToken:       "token-1",
		AgentRoomEnabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	status, err := service.Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !status.AgentRoom.Enabled || status.AgentRoom.Core != "running" || status.AgentRoom.Observer != "not_running" {
		t.Fatalf("unexpected Agent Room status: %+v", status.AgentRoom)
	}
	if !containsString(status.AgentRoom.Degradations, "server_provider_required") || !containsString(status.AgentRoom.Degradations, "observer_not_running") {
		t.Fatalf("expected truthful SDK/Observer degradation: %+v", status.AgentRoom.Degradations)
	}
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func TestConnectorWorkDirUsesOverrideThenGlobalFallback(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name      string
		connector config.ConnectorConfig
		fallback  string
		want      string
	}{
		{name: "telegram override", connector: config.ConnectorConfig{Platform: "telegram", DefaultWorkDir: " D:/telegram "}, fallback: "D:/global", want: "D:/telegram"},
		{name: "feishu override", connector: config.ConnectorConfig{Platform: "feishu", DefaultWorkDir: "D:/feishu"}, fallback: "D:/global", want: "D:/feishu"},
		{name: "weixin override", connector: config.ConnectorConfig{Platform: "weixin", DefaultWorkDir: "D:/weixin"}, fallback: "D:/global", want: "D:/weixin"},
		{name: "global fallback", connector: config.ConnectorConfig{Platform: "feishu"}, fallback: " D:/global ", want: "D:/global"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := connectorWorkDir(test.connector, test.fallback); got != test.want {
				t.Fatalf("connectorWorkDir returned %q, want %q", got, test.want)
			}
		})
	}
}

func TestNewReconcilesPendingApprovalsFromPreviousRuntime(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	dbPath := filepath.Join(dir, "bridge.db")
	storeHandle, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	if err := storeHandle.CreateApprovalTicket(context.Background(), domain.ApprovalTicket{
		ApprovalID:         "approval-1",
		KimiSessionID:      "session-1",
		TurnID:             "turn-1",
		StepID:             "step-1",
		Platform:           "telegram",
		ChatID:             "chat-1",
		RequestKind:        "tool",
		Prompt:             "approve?",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "dedupe-1",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket returned error: %v", err)
	}
	if err := storeHandle.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	service, err := New(Options{
		Version:     "test",
		ConfigPath:  filepath.Join(dir, "bridge_settings.json"),
		SecretsPath: filepath.Join(dir, "bridge_secrets.json"),
		DBPath:      dbPath,
		LogFilePath: filepath.Join(dir, "logs", "bridge.log"),
		AdminPort:   60110,
		AdminToken:  "token-1",
	})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Close()

	pending, err := service.ListApprovals(context.Background(), "pending")
	if err != nil {
		t.Fatalf("ListApprovals(pending) returned error: %v", err)
	}
	if len(pending) != 0 {
		t.Fatalf("expected no pending approvals after reconciliation, got %+v", pending)
	}

	failed, err := service.ListApprovals(context.Background(), "failed")
	if err != nil {
		t.Fatalf("ListApprovals(failed) returned error: %v", err)
	}
	if len(failed) != 1 {
		t.Fatalf("expected one failed approval after reconciliation, got %+v", failed)
	}
	if failed[0].ResolutionPayloadJSON != `{"reason":"runtime_restarted_before_resume"}` {
		t.Fatalf("unexpected reconciliation payload: %s", failed[0].ResolutionPayloadJSON)
	}
}

func TestNewStatusHandlesFreshDatabaseChannelRows(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	service, err := New(Options{
		Version:     "test",
		ConfigPath:  filepath.Join(dir, "bridge_settings.json"),
		SecretsPath: filepath.Join(dir, "bridge_secrets.json"),
		DBPath:      filepath.Join(dir, "bridge.db"),
		LogFilePath: filepath.Join(dir, "logs", "bridge.log"),
		AdminPort:   60110,
		AdminToken:  "token-1",
	})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	defer service.Close()

	status, err := service.Status(context.Background())
	if err != nil {
		t.Fatalf("Status returned error for fresh database: %v", err)
	}
	if len(status.Channels) != 0 {
		t.Fatalf("expected fresh database status to start without connectors, got %+v", status.Channels)
	}
}

func TestServiceSerializesConcurrentLifecycleCalls(t *testing.T) {
	run := func(calls ...func() error) {
		t.Helper()
		var wait sync.WaitGroup
		errs := make(chan error, len(calls))
		for _, call := range calls {
			wait.Add(1)
			go func(call func() error) {
				defer wait.Done()
				errs <- call()
			}(call)
		}
		wait.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Errorf("lifecycle call returned error: %v", err)
			}
		}
	}

	concurrentStartService := newLifecycleTestService(t)
	defer concurrentStartService.Close()
	run(concurrentStartService.Start, concurrentStartService.Start)
	if err := concurrentStartService.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown after concurrent Start returned error: %v", err)
	}

	interleavedService := newLifecycleTestService(t)
	defer interleavedService.Close()
	run(interleavedService.Start, func() error { return interleavedService.Shutdown(context.Background()) })
	if err := interleavedService.Shutdown(context.Background()); err != nil {
		t.Fatalf("final Shutdown returned error: %v", err)
	}
	interleavedService.mu.RLock()
	state := interleavedService.state
	interleavedService.mu.RUnlock()
	if state != domain.BridgeStateStopped {
		t.Fatalf("expected final state %q, got %q", domain.BridgeStateStopped, state)
	}
}

func newLifecycleTestService(t *testing.T) *Service {
	t.Helper()
	dir := t.TempDir()
	service, err := New(Options{
		Version:     "test",
		ConfigPath:  filepath.Join(dir, "bridge_settings.json"),
		SecretsPath: filepath.Join(dir, "bridge_secrets.json"),
		DBPath:      filepath.Join(dir, "bridge.db"),
		LogFilePath: filepath.Join(dir, "logs", "bridge.log"),
		AdminPort:   reserveTCPPort(t),
		AdminToken:  "token-1",
	})
	if err != nil {
		t.Fatalf("New returned error: %v", err)
	}
	return service
}

func reserveTCPPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("reserve TCP port: %v", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	if err := listener.Close(); err != nil {
		t.Fatalf("release reserved TCP port: %v", err)
	}
	return port
}

func TestStatusFallsBackToConfiguredChannelsWhenStoreSnapshotFails(t *testing.T) {
	t.Parallel()

	storeHandle, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	if err := storeHandle.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	service := &Service{
		options: Options{
			Version:    "test",
			AdminPort:  60110,
			AdminToken: "token-1",
		},
		settings: config.BridgeSettings{
			Channels: []config.ChannelConfig{
				{Platform: "telegram", Enabled: false},
				{Platform: "feishu", Enabled: true},
			},
		},
		store:     storeHandle,
		state:     domain.BridgeStateDegraded,
		startedAt: "2026-03-17T00:00:00Z",
	}

	status, err := service.Status(context.Background())
	if err != nil {
		t.Fatalf("Status returned error: %v", err)
	}

	if status.State != domain.BridgeStateDegraded {
		t.Fatalf("expected degraded bridge state, got %+v", status)
	}
	if status.Bindings != 0 || status.PendingApprovals != 0 {
		t.Fatalf("expected zero counters on snapshot fallback, got %+v", status)
	}
	if len(status.Channels) != 2 {
		t.Fatalf("expected fallback channels, got %+v", status.Channels)
	}
	if status.Channels[0].Platform != "telegram" || status.Channels[0].State != domain.ChannelStateIdle {
		t.Fatalf("expected disabled telegram fallback to idle, got %+v", status.Channels[0])
	}
	if status.Channels[1].Platform != "feishu" || status.Channels[1].State != domain.ChannelStateDegraded {
		t.Fatalf("expected enabled feishu fallback to degraded, got %+v", status.Channels[1])
	}
	if status.LastErrorCode != "platform_unavailable" {
		t.Fatalf("expected platform_unavailable fallback code, got %+v", status)
	}
	for _, fragment := range []string{
		"status snapshot failed: list channel statuses",
		"status snapshot failed: count bindings",
		"status snapshot failed: count pending approvals",
	} {
		if !strings.Contains(status.LastError, fragment) {
			t.Fatalf("expected %q in last error, got %q", fragment, status.LastError)
		}
	}
}

func TestStatusPreservesExistingSpecificErrorCodeWhenSnapshotFallbackFails(t *testing.T) {
	t.Parallel()

	storeHandle, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	if err := storeHandle.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	service := &Service{
		options: Options{
			Version:    "test",
			AdminPort:  60110,
			AdminToken: "token-1",
		},
		settings: config.BridgeSettings{
			Channels: []config.ChannelConfig{
				{Platform: "feishu", Enabled: true},
			},
		},
		store:         storeHandle,
		state:         domain.BridgeStateRunning,
		lastErrorCode: "invalid_credentials",
		lastError:     "feishu: invalid app secret",
	}

	status, err := service.Status(context.Background())
	if err != nil {
		t.Fatalf("Status returned error: %v", err)
	}

	if status.LastErrorCode != "invalid_credentials" {
		t.Fatalf("expected specific error code to be preserved, got %+v", status)
	}
	if !strings.Contains(status.LastError, "feishu: invalid app secret") {
		t.Fatalf("expected original error to be preserved, got %q", status.LastError)
	}
	if !strings.Contains(status.LastError, "status snapshot failed: list channel statuses") {
		t.Fatalf("expected snapshot failure context to be appended, got %q", status.LastError)
	}
	if len(status.Channels) != 1 || status.Channels[0].State != domain.ChannelStateReady {
		t.Fatalf("expected running fallback channels to stay ready, got %+v", status.Channels)
	}
}
