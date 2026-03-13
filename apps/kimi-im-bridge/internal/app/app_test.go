package app

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

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
