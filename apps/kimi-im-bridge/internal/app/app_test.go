package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
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
