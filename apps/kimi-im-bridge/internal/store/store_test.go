package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/migrations"
)

func testConnectors() []config.ConnectorConfig {
	return []config.ConnectorConfig{
		{ID: "telegram-default", Platform: "telegram", Label: "Telegram", Enabled: true, Mode: "polling"},
		{ID: "feishu-default", Platform: "feishu", Label: "Feishu", Enabled: true, Mode: "websocket", FeishuAutoApprove: true, FeishuReplyRenderer: config.FeishuReplyRendererInteractive},
	}
}

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

func TestCreateTurnRejectsDuplicateInboundMessage(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	base := domain.BridgeTurn{
		TurnID:           "turn-1",
		ConnectorID:      "feishu-default",
		KimiSessionID:    "session-1",
		Platform:         "feishu",
		ChatID:           "chat-1",
		InboundMessageID: "message-1",
		PromptText:       "ping",
		Status:           "accepted",
		ProviderName:     "kimi",
		StartedAt:        "2026-03-16T00:00:00Z",
		CreatedAt:        "2026-03-16T00:00:00Z",
		UpdatedAt:        "2026-03-16T00:00:00Z",
	}
	if err := store.CreateTurn(ctx, base); err != nil {
		t.Fatalf("CreateTurn returned error: %v", err)
	}
	base.TurnID = "turn-2"
	if err := store.CreateTurn(ctx, base); !errors.Is(err, domain.ErrDuplicateInbound) {
		t.Fatalf("expected ErrDuplicateInbound, got %v", err)
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

	if err := store.SyncConfiguredChannels(ctx, testConnectors()); err != nil {
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

	offset, ok, err := reopened.GetOffset(ctx, "telegram-default", "telegram_update")
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

func TestSyncConfiguredChannelsPrunesRemovedConnectorData(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	connectors := []config.ConnectorConfig{
		{ID: "feishu-default", Platform: "feishu", Label: "Feishu A", Enabled: true, Mode: "websocket"},
		{ID: "feishu-2", Platform: "feishu", Label: "Feishu B", Enabled: true, Mode: "websocket"},
	}
	if err := store.SyncConfiguredChannels(ctx, connectors); err != nil {
		t.Fatalf("initial SyncConfiguredChannels returned error: %v", err)
	}

	for _, sessionID := range []string{"session-a", "session-b"} {
		if err := store.UpsertSession(ctx, domain.BridgeSession{
			KimiSessionID: sessionID,
			CreatedAt:     "2026-03-25T00:00:00Z",
			UpdatedAt:     "2026-03-25T00:00:00Z",
		}); err != nil {
			t.Fatalf("UpsertSession(%s) returned error: %v", sessionID, err)
		}
	}
	if err := store.CreateBinding(ctx, domain.SessionBinding{
		BindingID: "binding-a",
		Key: domain.BindingKey{
			ConnectorID: "feishu-default",
			Platform:    "feishu",
			ChatID:      "chat-a",
		},
		KimiSessionID: "session-a",
		Source:        "auto",
		CreatedAt:     "2026-03-25T00:00:00Z",
		UpdatedAt:     "2026-03-25T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateBinding(binding-a) returned error: %v", err)
	}
	if err := store.CreateBinding(ctx, domain.SessionBinding{
		BindingID: "binding-b",
		Key: domain.BindingKey{
			ConnectorID: "feishu-2",
			Platform:    "feishu",
			ChatID:      "chat-b",
		},
		KimiSessionID: "session-b",
		Source:        "auto",
		CreatedAt:     "2026-03-25T00:00:00Z",
		UpdatedAt:     "2026-03-25T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateBinding(binding-b) returned error: %v", err)
	}
	if err := store.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID:         "approval-a",
		ConnectorID:        "feishu-default",
		KimiSessionID:      "session-a",
		Platform:           "feishu",
		ChatID:             "chat-a",
		RequestKind:        "tool",
		Prompt:             "approve a",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "approval-a",
		CreatedAt:          "2026-03-25T00:00:00Z",
		UpdatedAt:          "2026-03-25T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket(approval-a) returned error: %v", err)
	}
	if err := store.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID:         "approval-b",
		ConnectorID:        "feishu-2",
		KimiSessionID:      "session-b",
		Platform:           "feishu",
		ChatID:             "chat-b",
		RequestKind:        "tool",
		Prompt:             "approve b",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "approval-b",
		CreatedAt:          "2026-03-25T00:00:00Z",
		UpdatedAt:          "2026-03-25T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket(approval-b) returned error: %v", err)
	}

	if err := store.SyncConfiguredChannels(ctx, connectors[:1]); err != nil {
		t.Fatalf("pruning SyncConfiguredChannels returned error: %v", err)
	}

	statuses, err := store.ListChannelStatuses(ctx)
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) != 1 || statuses[0].ConnectorID != "feishu-default" {
		t.Fatalf("expected only kept connector channel to remain, got %+v", statuses)
	}

	bindings, err := store.ListBindings(ctx)
	if err != nil {
		t.Fatalf("ListBindings returned error: %v", err)
	}
	if len(bindings) != 1 || bindings[0].ConnectorID != "feishu-default" {
		t.Fatalf("expected only kept connector binding to remain, got %+v", bindings)
	}

	approvals, err := store.ListApprovals(ctx, "pending")
	if err != nil {
		t.Fatalf("ListApprovals returned error: %v", err)
	}
	if len(approvals) != 1 || approvals[0].ConnectorID != "feishu-default" {
		t.Fatalf("expected only kept connector approval to remain, got %+v", approvals)
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

func TestOpenMigratesV3DatabaseToLatestSchema(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	ordered, err := migrations.Ordered()
	if err != nil {
		t.Fatalf("Ordered returned error: %v", err)
	}
	for _, migration := range ordered {
		if migration.Version > 3 {
			break
		}
		if _, err := raw.Exec(migration.SQL); err != nil {
			t.Fatalf("failed to apply migration %s: %v", migration.Name, err)
		}
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
		t.Fatalf("expected latest user_version %d, got %d", ExpectedUserVersion(), version)
	}

	if err := store.CreateTurn(ctx, domain.BridgeTurn{
		TurnID:        "turn-v7",
		KimiSessionID: "session-v7",
		Platform:      "telegram",
		ChatID:        "chat-v7",
		PromptText:    "ping",
		Status:        "accepted",
		ProviderName:  "kimi",
		StartedAt:     "2026-03-16T00:00:00Z",
		CreatedAt:     "2026-03-16T00:00:00Z",
		UpdatedAt:     "2026-03-16T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateTurn returned error after migration: %v", err)
	}
	if err := store.AppendTurnEvent(ctx, domain.TurnEventRecord{
		EventID:       "event-v7",
		TurnID:        "turn-v7",
		KimiSessionID: "session-v7",
		Platform:      "telegram",
		ChatID:        "chat-v7",
		Kind:          "turn.accepted",
		CreatedAt:     "2026-03-16T00:00:00Z",
	}); err != nil {
		t.Fatalf("AppendTurnEvent returned error after migration: %v", err)
	}
	if err := store.CommitCheckpoint(ctx, "telegram-default", "telegram_update", "101", "101"); err != nil {
		t.Fatalf("CommitCheckpoint returned error after migration: %v", err)
	}
	checkpoint, err := store.GetCheckpoint(ctx, "telegram-default", "telegram_update")
	if err != nil {
		t.Fatalf("GetCheckpoint returned error after migration: %v", err)
	}
	if checkpoint == nil || checkpoint.CommittedValue != "101" {
		t.Fatalf("expected checkpoint to be queryable after migration, got %+v", checkpoint)
	}
}

func TestListChannelStatusesHandlesNullHeartbeatColumn(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	if err := store.SyncConfiguredChannels(ctx, testConnectors()); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}
	if _, err := store.db.ExecContext(
		ctx,
		`UPDATE bridge_channels SET last_heartbeat_at = NULL WHERE platform = ?`,
		"feishu",
	); err != nil {
		t.Fatalf("failed to set last_heartbeat_at NULL: %v", err)
	}

	statuses, err := store.ListChannelStatuses(ctx)
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) == 0 {
		t.Fatalf("expected channel statuses, got none")
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

	if err := store.SyncConfiguredChannels(ctx, testConnectors()); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}
	if err := store.UpdateChannelState(ctx, "telegram-default", domain.ChannelStateReady, "", ""); err != nil {
		t.Fatalf("UpdateChannelState returned error: %v", err)
	}
	if err := store.UpdateChannelOffset(ctx, "telegram-default", "telegram_update", "100"); err != nil {
		t.Fatalf("UpdateChannelOffset returned error: %v", err)
	}
	if err := store.TouchChannelInbound(ctx, "telegram-default", "2026-03-13T10:00:00Z"); err != nil {
		t.Fatalf("TouchChannelInbound returned error: %v", err)
	}
	if err := store.TouchChannelOutbound(ctx, "telegram-default", "2026-03-13T10:01:00Z"); err != nil {
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
	if telegramStatus.LastErrorCode != "" || telegramStatus.LastError != "" {
		t.Fatalf("expected empty channel error fields, got %+v", *telegramStatus)
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

func TestChannelStatusPersistsErrorCodeAndMessageWithoutMigration(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	if err := store.SyncConfiguredChannels(ctx, []config.ConnectorConfig{{
		ID:       "telegram-default",
		Platform: "telegram",
		Label:    "Telegram",
		Enabled:  true,
		Mode:     "polling",
	}}); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}
	if err := store.UpdateChannelState(
		ctx,
		"telegram-default",
		domain.ChannelStateError,
		"invalid_credentials",
		"telegram getMe failed (401): Unauthorized",
	); err != nil {
		t.Fatalf("UpdateChannelState returned error: %v", err)
	}

	statuses, err := store.ListChannelStatuses(ctx)
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) != 1 {
		t.Fatalf("expected one channel status, got %+v", statuses)
	}
	if statuses[0].LastErrorCode != "invalid_credentials" {
		t.Fatalf("expected invalid_credentials code, got %+v", statuses[0])
	}
	if statuses[0].LastError != "telegram getMe failed (401): Unauthorized" {
		t.Fatalf("expected persisted message, got %+v", statuses[0])
	}
}

func TestChannelDiagnosticsPersistRecoveryFields(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	if err := store.SyncConfiguredChannels(ctx, []config.ConnectorConfig{{
		ID:                  "feishu-default",
		Platform:            "feishu",
		Label:               "Feishu",
		Enabled:             true,
		Mode:                "websocket",
		FeishuAutoApprove:   true,
		FeishuReplyRenderer: config.FeishuReplyRendererInteractive,
	}}); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}

	lastReadyAt := "2026-03-20T01:00:00Z"
	lastFailureAt := "2026-03-20T01:25:41Z"
	lastFailureOperation := "long_connection"
	lastFailureRetryable := true
	consecutiveFailures := 2
	nextRetryAt := "2026-03-20T01:25:43Z"
	lastRecoveryAt := "2026-03-20T01:26:10Z"
	recoveryHint := "host_connection_aborted"
	if err := store.UpdateChannelDiagnostics(ctx, "feishu-default", domain.ChannelDiagnosticsUpdate{
		State:                domain.ChannelStateDegraded,
		LastErrorCode:        "transient_network",
		LastError:            "wsasend aborted by host machine",
		LastReadyAt:          &lastReadyAt,
		LastFailureAt:        &lastFailureAt,
		LastFailureOperation: &lastFailureOperation,
		LastFailureRetryable: &lastFailureRetryable,
		ConsecutiveFailures:  &consecutiveFailures,
		NextRetryAt:          &nextRetryAt,
		LastRecoveryAt:       &lastRecoveryAt,
		RecoveryHint:         &recoveryHint,
	}); err != nil {
		t.Fatalf("UpdateChannelDiagnostics returned error: %v", err)
	}

	statuses, err := store.ListChannelStatuses(ctx)
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) != 1 {
		t.Fatalf("expected one channel status, got %+v", statuses)
	}
	status := statuses[0]
	if status.LastReadyAt != lastReadyAt || status.LastFailureAt != lastFailureAt || status.LastRecoveryAt != lastRecoveryAt {
		t.Fatalf("expected recovery timestamps to persist, got %+v", status)
	}
	if status.LastFailureOperation != lastFailureOperation || !status.LastFailureRetryable {
		t.Fatalf("expected failure operation/retryable to persist, got %+v", status)
	}
	if status.ConsecutiveFailures != consecutiveFailures || status.NextRetryAt != nextRetryAt || status.RecoveryHint != recoveryHint {
		t.Fatalf("expected recovery counters and hint to persist, got %+v", status)
	}
}

func TestListSessionsAndBindingWorkDirUpdates(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	if err := store.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: "session-a",
		WorkDir:       "D:/repo-a",
		LastMessageAt: "2026-03-17T10:00:00Z",
		Summary:       "A",
		CreatedAt:     "2026-03-17T10:00:00Z",
		UpdatedAt:     "2026-03-17T10:00:00Z",
	}); err != nil {
		t.Fatalf("UpsertSession(session-a) returned error: %v", err)
	}
	if err := store.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: "session-b",
		WorkDir:       "D:/repo-b",
		LastMessageAt: "2026-03-17T11:00:00Z",
		Summary:       "B",
		CreatedAt:     "2026-03-17T11:00:00Z",
		UpdatedAt:     "2026-03-17T11:00:00Z",
	}); err != nil {
		t.Fatalf("UpsertSession(session-b) returned error: %v", err)
	}
	if err := store.CreateBinding(ctx, domain.SessionBinding{
		BindingID:     "binding-a",
		Key:           domain.BindingKey{Platform: "feishu", ChatID: "chat-a"},
		KimiSessionID: "session-a",
		WorkDir:       "D:/repo-a",
		Source:        "auto",
		CreatedAt:     "2026-03-17T10:00:00Z",
		UpdatedAt:     "2026-03-17T10:00:00Z",
	}); err != nil {
		t.Fatalf("CreateBinding returned error: %v", err)
	}

	sessions, err := store.ListSessions(ctx)
	if err != nil {
		t.Fatalf("ListSessions returned error: %v", err)
	}
	if len(sessions) != 2 || sessions[0].KimiSessionID != "session-b" {
		t.Fatalf("expected sessions ordered by latest activity, got %+v", sessions)
	}

	if err := store.UpdateBindingWorkDir(ctx, "binding-a", "D:/repo-a-updated"); err != nil {
		t.Fatalf("UpdateBindingWorkDir returned error: %v", err)
	}
	binding, err := store.GetBindingByID(ctx, "binding-a")
	if err != nil {
		t.Fatalf("GetBindingByID returned error: %v", err)
	}
	if binding == nil || binding.WorkDir != "D:/repo-a-updated" {
		t.Fatalf("expected binding workdir to be updated, got %+v", binding)
	}
	session, err := store.GetSessionByID(ctx, "session-a")
	if err != nil {
		t.Fatalf("GetSessionByID returned error: %v", err)
	}
	if session == nil || session.WorkDir != "D:/repo-a-updated" {
		t.Fatalf("expected session workdir to follow binding update, got %+v", session)
	}

	if err := store.Rebind(ctx, "binding-a", "session-b", "D:/repo-b", "manual_rebind"); err != nil {
		t.Fatalf("Rebind returned error: %v", err)
	}
	rebound, err := store.GetBindingByID(ctx, "binding-a")
	if err != nil {
		t.Fatalf("GetBindingByID(after rebind) returned error: %v", err)
	}
	if rebound == nil || rebound.KimiSessionID != "session-b" || rebound.WorkDir != "D:/repo-b" {
		t.Fatalf("expected rebind to update session and workdir, got %+v", rebound)
	}
}

func TestBindingOnboardingMetadataMigratesAndPersists(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open returned error: %v", err)
	}
	ordered, err := migrations.Ordered()
	if err != nil {
		t.Fatalf("Ordered returned error: %v", err)
	}
	for _, migration := range ordered {
		if migration.Version > 7 {
			break
		}
		if _, err := raw.Exec(migration.SQL); err != nil {
			t.Fatalf("failed to apply migration %s: %v", migration.Name, err)
		}
	}
	if err := raw.Close(); err != nil {
		t.Fatalf("failed to close raw db: %v", err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer store.Close()

	if err := store.CreateBinding(ctx, domain.SessionBinding{
		BindingID:     "binding-onboard-1",
		Key:           domain.BindingKey{Platform: "feishu", ChatID: "chat-onboard-1"},
		KimiSessionID: "session-onboard-1",
		Source:        "auto",
		CreatedAt:     "2026-03-17T00:00:00Z",
		UpdatedAt:     "2026-03-17T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateBinding returned error: %v", err)
	}
	if err := store.UpdateBindingOnboarding(ctx, "binding-onboard-1", "feishu_bridge_v1"); err != nil {
		t.Fatalf("UpdateBindingOnboarding returned error: %v", err)
	}

	binding, err := store.GetBindingByID(ctx, "binding-onboard-1")
	if err != nil {
		t.Fatalf("GetBindingByID returned error: %v", err)
	}
	if binding == nil || binding.OnboardingVersion != "feishu_bridge_v1" || binding.OnboardedAt == "" {
		t.Fatalf("expected onboarding metadata to persist, got %+v", binding)
	}

	records, err := store.ListBindings(ctx)
	if err != nil {
		t.Fatalf("ListBindings returned error: %v", err)
	}
	if len(records) != 1 || records[0].OnboardingVersion != "feishu_bridge_v1" || records[0].OnboardedAt == "" {
		t.Fatalf("expected onboarding metadata in binding records, got %+v", records)
	}
}
