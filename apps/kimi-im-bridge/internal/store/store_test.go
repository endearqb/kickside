package store

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestOpenInitializesUserVersionAndWAL(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	version, err := store.UserVersion(ctx)
	if err != nil {
		t.Fatalf("UserVersion returned error: %v", err)
	}
	if version != ExpectedUserVersion() {
		t.Fatalf("expected user_version %d, got %d", ExpectedUserVersion(), version)
	}

	mode, err := store.JournalMode(ctx)
	if err != nil {
		t.Fatalf("JournalMode returned error: %v", err)
	}
	if mode != "wal" {
		t.Fatalf("expected journal mode wal, got %q", mode)
	}
}

func TestChannelBindingUniqueIndexHandlesNullFields(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	first := domain.SessionBinding{
		BindingID:     "binding-1",
		Key:           domain.BindingKey{Platform: "telegram", ChatID: "chat-1"},
		KimiSessionID: "session-1",
		Source:        "auto",
		CreatedAt:     "2026-03-12T00:00:00Z",
		UpdatedAt:     "2026-03-12T00:00:00Z",
	}
	if err := store.CreateBinding(ctx, first); err != nil {
		t.Fatalf("CreateBinding(first) returned error: %v", err)
	}

	second := first
	second.BindingID = "binding-2"
	second.KimiSessionID = "session-2"
	if err := store.CreateBinding(ctx, second); err == nil {
		t.Fatalf("expected unique constraint error for duplicate nullable binding key")
	}
}

func TestOffsetsApprovalsDeliveryAndReopenRecovery(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}

	if err := store.SyncConfiguredChannels(ctx, config.DefaultSettings().Channels); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}
	if err := store.UpsertOffset(ctx, "telegram", "telegram_update", "42"); err != nil {
		t.Fatalf("UpsertOffset returned error: %v", err)
	}
	if err := store.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: "session-1",
		CreatedAt:     "2026-03-12T00:00:00Z",
	}); err != nil {
		t.Fatalf("UpsertSession returned error: %v", err)
	}
	if err := store.CreateBinding(ctx, domain.SessionBinding{
		BindingID:     "binding-1",
		Key:           domain.BindingKey{Platform: "telegram", ChatID: "chat-1"},
		KimiSessionID: "session-1",
		Source:        "auto",
		CreatedAt:     "2026-03-12T00:00:00Z",
		UpdatedAt:     "2026-03-12T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateBinding returned error: %v", err)
	}
	if err := store.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID:         "approval-1",
		KimiSessionID:      "session-1",
		Platform:           "telegram",
		ChatID:             "chat-1",
		RequestKind:        "tool",
		Prompt:             "approve?",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "approval-dedupe-1",
		CreatedAt:          "2026-03-12T00:00:00Z",
		UpdatedAt:          "2026-03-12T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket returned error: %v", err)
	}
	inserted, err := store.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
		EventID:     "event-1",
		Platform:    "telegram",
		ChatID:      "chat-1",
		Direction:   "outbound",
		DeliveryKey: "delivery-1",
		PayloadJSON: "{}",
		Status:      "sent",
		CreatedAt:   "2026-03-12T00:00:00Z",
		UpdatedAt:   "2026-03-12T00:00:00Z",
	})
	if err != nil {
		t.Fatalf("RecordDeliveryEventIfAbsent returned error: %v", err)
	}
	if !inserted {
		t.Fatalf("expected first delivery insert to succeed")
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}

	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatalf("reopen returned error: %v", err)
	}
	defer reopened.Close()

	offset, ok, err := reopened.GetOffset(ctx, "telegram", "telegram_update")
	if err != nil {
		t.Fatalf("GetOffset returned error: %v", err)
	}
	if !ok || offset != "42" {
		t.Fatalf("expected recovered offset 42, got ok=%v value=%q", ok, offset)
	}

	bindings, err := reopened.ListBindings(ctx)
	if err != nil {
		t.Fatalf("ListBindings returned error: %v", err)
	}
	if len(bindings) != 1 {
		t.Fatalf("expected 1 recovered binding, got %d", len(bindings))
	}

	duplicateApproval, err := reopened.HasApprovalDedupeKey(ctx, "approval-dedupe-1")
	if err != nil {
		t.Fatalf("HasApprovalDedupeKey returned error: %v", err)
	}
	if !duplicateApproval {
		t.Fatalf("expected approval dedupe key to survive reopen")
	}

	reinserted, err := reopened.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
		EventID:     "event-2",
		Platform:    "telegram",
		ChatID:      "chat-1",
		Direction:   "outbound",
		DeliveryKey: "delivery-1",
		PayloadJSON: "{}",
		Status:      "sent",
	})
	if err != nil {
		t.Fatalf("RecordDeliveryEventIfAbsent(second) returned error: %v", err)
	}
	if reinserted {
		t.Fatalf("expected duplicate delivery key to be ignored")
	}
}
