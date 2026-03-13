package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/migrations"
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
		TurnID:             "turn-1",
		StepID:             "step-1",
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

	approvals, err := reopened.ListApprovals(ctx, "pending")
	if err != nil {
		t.Fatalf("ListApprovals returned error: %v", err)
	}
	if len(approvals) != 1 || approvals[0].TurnID != "turn-1" || approvals[0].StepID != "step-1" {
		t.Fatalf("expected approval runtime ids to survive reopen, got %+v", approvals)
	}

	if err := reopened.ResolveApproval(ctx, "approval-1", "approved", `{"decision":"yes"}`); err != nil {
		t.Fatalf("ResolveApproval returned error: %v", err)
	}
	resolved, err := reopened.ListApprovals(ctx, "approved")
	if err != nil {
		t.Fatalf("ListApprovals(resolved) returned error: %v", err)
	}
	if len(resolved) != 1 || resolved[0].ResolutionPayloadJSON != `{"decision":"yes"}` || resolved[0].ResolvedAt == "" {
		t.Fatalf("expected resolved approval to be queryable, got %+v", resolved)
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

func TestOpenMigratesApprovalRuntimeColumns(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	if _, err := raw.Exec(migrations.InitialSchema()); err != nil {
		t.Fatalf("failed to apply v1 schema: %v", err)
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("failed to close raw db: %v", err)
	}

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
		t.Fatalf("expected migrated user_version %d, got %d", ExpectedUserVersion(), version)
	}

	if err := store.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID:         "approval-1",
		KimiSessionID:      "session-1",
		TurnID:             "turn-9",
		StepID:             "step-9",
		Platform:           "telegram",
		ChatID:             "chat-1",
		RequestKind:        "tool",
		Prompt:             "approve?",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "approval-dedupe-9",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket returned error after migration: %v", err)
	}
	approvals, err := store.ListApprovals(ctx, "pending")
	if err != nil {
		t.Fatalf("ListApprovals returned error after migration: %v", err)
	}
	if len(approvals) != 1 || approvals[0].TurnID != "turn-9" || approvals[0].StepID != "step-9" {
		t.Fatalf("expected migrated schema to include turn_id/step_id, got %+v", approvals)
	}
}

func TestChannelActivityApprovalLookupAndDeliveryStatus(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	if err := store.SyncConfiguredChannels(ctx, config.DefaultSettings().Channels); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}
	if err := store.UpdateChannelState(ctx, "telegram", domain.ChannelStateReady, ""); err != nil {
		t.Fatalf("UpdateChannelState returned error: %v", err)
	}
	if err := store.UpdateChannelOffset(ctx, "telegram", "100"); err != nil {
		t.Fatalf("UpdateChannelOffset returned error: %v", err)
	}
	if err := store.TouchChannelInbound(ctx, "telegram", "2026-03-13T10:00:00Z"); err != nil {
		t.Fatalf("TouchChannelInbound returned error: %v", err)
	}
	if err := store.TouchChannelOutbound(ctx, "telegram", "2026-03-13T10:01:00Z"); err != nil {
		t.Fatalf("TouchChannelOutbound returned error: %v", err)
	}

	statuses, err := store.ListChannelStatuses(ctx)
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	var telegramStatus *domain.ChannelStatus
	for index := range statuses {
		if statuses[index].Platform == "telegram" {
			telegramStatus = &statuses[index]
			break
		}
	}
	if telegramStatus == nil {
		t.Fatalf("expected telegram channel status to be returned, got %+v", statuses)
	}
	if telegramStatus.LastInboundAt == "" || telegramStatus.LastOutboundAt == "" || telegramStatus.LastOffset != "100" {
		t.Fatalf("expected channel activity fields to be populated, got %+v", *telegramStatus)
	}

	if err := store.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID:         "approval-lookup-1",
		KimiSessionID:      "session-1",
		TurnID:             "turn-1",
		StepID:             "step-1",
		Platform:           "telegram",
		ChatID:             "chat-1",
		RequestKind:        "tool",
		Prompt:             "approve?",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "approval-lookup-dedupe-1",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket returned error: %v", err)
	}
	approval, err := store.GetApprovalByID(ctx, "approval-lookup-1")
	if err != nil {
		t.Fatalf("GetApprovalByID returned error: %v", err)
	}
	if approval == nil || approval.TurnID != "turn-1" || approval.StepID != "step-1" {
		t.Fatalf("expected approval lookup to return runtime ids, got %+v", approval)
	}

	inserted, err := store.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
		EventID:         "delivery-lookup-1",
		Platform:        "telegram",
		ChatID:          "chat-1",
		Direction:       "outbound",
		DeliveryKey:     "telegram:chat-1:msg-1:reply:0",
		SourceMessageID: "msg-1",
		PayloadJSON:     "{}",
		Status:          "pending",
	})
	if err != nil {
		t.Fatalf("RecordDeliveryEventIfAbsent returned error: %v", err)
	}
	if !inserted {
		t.Fatal("expected delivery event to be inserted")
	}
	if err := store.UpdateDeliveryEventStatus(ctx, "telegram:chat-1:msg-1:reply:0", "failed", "boom"); err != nil {
		t.Fatalf("UpdateDeliveryEventStatus returned error: %v", err)
	}
	event, err := store.GetDeliveryEventByKey(ctx, "telegram:chat-1:msg-1:reply:0")
	if err != nil {
		t.Fatalf("GetDeliveryEventByKey returned error: %v", err)
	}
	if event == nil || event.Status != "failed" || event.ErrorMessage != "boom" {
		t.Fatalf("expected delivery event lookup to reflect updated status, got %+v", event)
	}
}
