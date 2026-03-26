package binding

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

func TestResolveOrCreateRebindAndClear(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	st, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()

	router := NewRouter(st)
	key := domain.BindingKey{Platform: "telegram", ChatID: "chat-1"}
	sessionCounter := 0
	createSession := func(_ context.Context, _ domain.BindingKey) (string, error) {
		sessionCounter++
		return fmt.Sprintf("session-%02d", sessionCounter), nil
	}

	first, created, err := router.ResolveOrCreate(ctx, key, createSession)
	if err != nil {
		t.Fatalf("ResolveOrCreate(first) returned error: %v", err)
	}
	if !created {
		t.Fatalf("expected first ResolveOrCreate to create a binding")
	}
	if first.KimiSessionID != "session-01" {
		t.Fatalf("expected first session id session-01, got %q", first.KimiSessionID)
	}

	second, created, err := router.ResolveOrCreate(ctx, key, createSession)
	if err != nil {
		t.Fatalf("ResolveOrCreate(second) returned error: %v", err)
	}
	if created {
		t.Fatalf("expected second ResolveOrCreate to reuse the existing binding")
	}
	if second.BindingID != first.BindingID {
		t.Fatalf("expected same binding id, got %q and %q", first.BindingID, second.BindingID)
	}

	if err := router.Rebind(ctx, first.BindingID, "session-99"); err != nil {
		t.Fatalf("Rebind returned error: %v", err)
	}
	rebound, err := router.ResolveBinding(ctx, key)
	if err != nil {
		t.Fatalf("ResolveBinding returned error: %v", err)
	}
	if rebound.KimiSessionID != "session-99" {
		t.Fatalf("expected rebind to update session id to session-99, got %q", rebound.KimiSessionID)
	}

	duplicate, err := router.MarkInboundConsumed(ctx, first.BindingID, "message-1")
	if err != nil {
		t.Fatalf("MarkInboundConsumed(first) returned error: %v", err)
	}
	if duplicate {
		t.Fatalf("expected first inbound message to be accepted")
	}
	duplicate, err = router.MarkInboundConsumed(ctx, first.BindingID, "message-1")
	if err != nil {
		t.Fatalf("MarkInboundConsumed(second) returned error: %v", err)
	}
	if !duplicate {
		t.Fatalf("expected duplicate inbound message to be detected")
	}

	approvalDuplicate, err := router.IsDuplicateApproval(ctx, "approval-1")
	if err != nil {
		t.Fatalf("IsDuplicateApproval(initial) returned error: %v", err)
	}
	if approvalDuplicate {
		t.Fatalf("expected fresh approval dedupe key to be absent")
	}

	if err := st.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID:         "approval-record-1",
		KimiSessionID:      "session-99",
		Platform:           "telegram",
		ChatID:             "chat-1",
		RequestKind:        "tool",
		Prompt:             "approve?",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "approval-1",
		CreatedAt:          "2026-03-12T00:00:00Z",
		UpdatedAt:          "2026-03-12T00:00:00Z",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket returned error: %v", err)
	}
	approvalDuplicate, err = router.IsDuplicateApproval(ctx, "approval-1")
	if err != nil {
		t.Fatalf("IsDuplicateApproval(after insert) returned error: %v", err)
	}
	if !approvalDuplicate {
		t.Fatalf("expected approval dedupe key to be detected after insert")
	}

	inserted, err := router.RecordDeliveryIfAbsent(ctx, domain.DeliveryEvent{
		EventID:     "event-1",
		Platform:    "telegram",
		ChatID:      "chat-1",
		Direction:   "outbound",
		DeliveryKey: "delivery-1",
		PayloadJSON: "{}",
		Status:      "sent",
	})
	if err != nil {
		t.Fatalf("RecordDeliveryIfAbsent(first) returned error: %v", err)
	}
	if !inserted {
		t.Fatalf("expected first delivery event to be inserted")
	}
	inserted, err = router.RecordDeliveryIfAbsent(ctx, domain.DeliveryEvent{
		EventID:     "event-2",
		Platform:    "telegram",
		ChatID:      "chat-1",
		Direction:   "outbound",
		DeliveryKey: "delivery-1",
		PayloadJSON: "{}",
		Status:      "sent",
	})
	if err != nil {
		t.Fatalf("RecordDeliveryIfAbsent(second) returned error: %v", err)
	}
	if inserted {
		t.Fatalf("expected duplicate delivery key to be ignored")
	}

	if err := router.ClearBinding(ctx, first.BindingID); err != nil {
		t.Fatalf("ClearBinding returned error: %v", err)
	}
	cleared, err := router.ResolveBinding(ctx, key)
	if err != nil {
		t.Fatalf("ResolveBinding(after clear) returned error: %v", err)
	}
	if cleared != nil {
		t.Fatalf("expected binding to be removed after clear")
	}
}

func TestRebindRejectsSessionAlreadyUsedByAnotherBinding(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	st, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	defer st.Close()

	router := NewRouter(st)
	firstKey := domain.BindingKey{ConnectorID: "feishu-default", Platform: "feishu", ChatID: "chat-1"}
	secondKey := domain.BindingKey{ConnectorID: "feishu-2", Platform: "feishu", ChatID: "chat-2"}

	first, _, err := router.ResolveOrCreate(ctx, firstKey, func(_ context.Context, _ domain.BindingKey) (string, error) {
		return "session-a", nil
	})
	if err != nil {
		t.Fatalf("ResolveOrCreate(first) returned error: %v", err)
	}
	second, _, err := router.ResolveOrCreate(ctx, secondKey, func(_ context.Context, _ domain.BindingKey) (string, error) {
		return "session-b", nil
	})
	if err != nil {
		t.Fatalf("ResolveOrCreate(second) returned error: %v", err)
	}

	err = router.Rebind(ctx, second.BindingID, first.KimiSessionID)
	if err == nil {
		t.Fatalf("expected rebind conflict when another binding already uses the session")
	}
	if got := err.Error(); got == "" || !strings.Contains(got, "already bound") {
		t.Fatalf("expected session conflict error, got %v", err)
	}
}
