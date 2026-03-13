package runtime

import (
	"context"
	"errors"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type fakeApprovalStore struct {
	created  []domain.ApprovalTicket
	listed   []domain.ApprovalTicket
	resolved []struct {
		id      string
		status  string
		payload string
	}
}

func (f *fakeApprovalStore) CreateApprovalTicket(_ context.Context, ticket domain.ApprovalTicket) error {
	f.created = append(f.created, ticket)
	return nil
}

func (f *fakeApprovalStore) ListApprovals(_ context.Context, status string) ([]domain.ApprovalTicket, error) {
	if status == "" {
		return append([]domain.ApprovalTicket(nil), f.listed...), nil
	}
	items := []domain.ApprovalTicket{}
	for _, ticket := range f.listed {
		if ticket.Status == status {
			items = append(items, ticket)
		}
	}
	return items, nil
}

func (f *fakeApprovalStore) ResolveApproval(_ context.Context, approvalID string, status string, payload string) error {
	f.resolved = append(f.resolved, struct {
		id      string
		status  string
		payload string
	}{id: approvalID, status: status, payload: payload})
	return nil
}

type fakeApprovalResponder struct {
	err      error
	statuses []string
	payloads []string
}

func (f *fakeApprovalResponder) Respond(_ context.Context, status string, payload string) error {
	if f.err != nil {
		return f.err
	}
	f.statuses = append(f.statuses, status)
	f.payloads = append(f.payloads, payload)
	return nil
}

func TestApprovalCoordinatorRegisterAndResolve(t *testing.T) {
	t.Parallel()

	store := &fakeApprovalStore{}
	coordinator := NewApprovalCoordinator(store)
	responder := &fakeApprovalResponder{}
	ticket := domain.ApprovalTicket{
		ApprovalID:    "approval-1",
		KimiSessionID: "session-1",
		TurnID:        "turn-1",
		StepID:        "step-1",
		RequestKind:   "tool",
		Prompt:        "approve?",
		Platform:      "telegram",
		ChatID:        "chat-1",
		Status:        "pending",
		DedupeKey:     "dedupe-1",
	}

	if err := coordinator.Register(context.Background(), ticket, responder); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}
	if len(store.created) != 1 || store.created[0].TurnID != "turn-1" || store.created[0].StepID != "step-1" {
		t.Fatalf("expected ticket to be persisted with runtime ids, got %+v", store.created)
	}

	if err := coordinator.Resolve(context.Background(), "approval-1", "approved", `{"decision":"yes"}`); err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}
	if len(responder.statuses) != 1 || responder.statuses[0] != "approved" {
		t.Fatalf("expected responder to be called, got %+v", responder.statuses)
	}
	if len(store.resolved) != 1 || store.resolved[0].status != "approved" {
		t.Fatalf("expected store resolve to be recorded, got %+v", store.resolved)
	}
}

func TestApprovalCoordinatorResolveStillPersistsWithoutLiveResponder(t *testing.T) {
	t.Parallel()

	store := &fakeApprovalStore{}
	coordinator := NewApprovalCoordinator(store)

	if err := coordinator.Resolve(context.Background(), "approval-2", "denied", `{"decision":"no"}`); err != nil {
		t.Fatalf("Resolve without responder returned error: %v", err)
	}
	if len(store.resolved) != 1 || store.resolved[0].id != "approval-2" {
		t.Fatalf("expected store resolve to be recorded, got %+v", store.resolved)
	}
}

func TestApprovalCoordinatorStopsOnResponderError(t *testing.T) {
	t.Parallel()

	store := &fakeApprovalStore{}
	coordinator := NewApprovalCoordinator(store)
	responder := &fakeApprovalResponder{err: errors.New("boom")}
	if err := coordinator.Register(context.Background(), domain.ApprovalTicket{ApprovalID: "approval-3"}, responder); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}

	if err := coordinator.Resolve(context.Background(), "approval-3", "approved", "{}"); err == nil {
		t.Fatalf("expected resolve to fail when responder fails")
	}
	if len(store.resolved) != 0 {
		t.Fatalf("expected store resolve not to run when responder fails, got %+v", store.resolved)
	}
}

func TestApprovalCoordinatorReconcilePendingMarksOrphansFailed(t *testing.T) {
	t.Parallel()

	store := &fakeApprovalStore{
		listed: []domain.ApprovalTicket{
			{ApprovalID: "approval-1", Status: "pending"},
			{ApprovalID: "approval-2", Status: "pending"},
		},
	}
	coordinator := NewApprovalCoordinator(store)
	if err := coordinator.Register(context.Background(), domain.ApprovalTicket{ApprovalID: "approval-2", Status: "pending"}, &fakeApprovalResponder{}); err != nil {
		t.Fatalf("Register returned error: %v", err)
	}

	reconciled, err := coordinator.ReconcilePending(context.Background(), "runtime_restarted_before_resume")
	if err != nil {
		t.Fatalf("ReconcilePending returned error: %v", err)
	}
	if reconciled != 1 {
		t.Fatalf("expected 1 reconciled approval, got %d", reconciled)
	}
	if len(store.resolved) != 1 {
		t.Fatalf("expected one resolved orphan approval, got %+v", store.resolved)
	}
	if store.resolved[0].id != "approval-1" || store.resolved[0].status != "failed" {
		t.Fatalf("expected approval-1 to be failed, got %+v", store.resolved[0])
	}
	if store.resolved[0].payload != `{"reason":"runtime_restarted_before_resume"}` {
		t.Fatalf("unexpected reconciliation payload: %s", store.resolved[0].payload)
	}
}
