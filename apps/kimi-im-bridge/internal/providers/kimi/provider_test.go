package kimi

import (
	"context"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type fakeDriver struct {
	session DriverSession
}

func (f fakeDriver) OpenSession(Request) (DriverSession, error) {
	return f.session, nil
}

type fakeSession struct {
	stream PromptStream
}

func (f fakeSession) StartPrompt(context.Context, Request) (PromptStream, error) {
	return f.stream, nil
}

func (fakeSession) Close() error { return nil }

type fakeStream struct {
	events chan DriverEvent
	result chan DriverResult
}

func (f *fakeStream) Events() <-chan DriverEvent  { return f.events }
func (f *fakeStream) Result() <-chan DriverResult { return f.result }
func (f *fakeStream) Close() error                { return nil }

type fakeApprovalStore struct {
	resolved []string
}

func (f *fakeApprovalStore) ListApprovals(context.Context, string) ([]domain.ApprovalTicket, error) {
	return []domain.ApprovalTicket{{ApprovalID: "approval-stale", Status: "pending"}}, nil
}

func (f *fakeApprovalStore) ResolveApproval(_ context.Context, approvalID string, status string, _ string) error {
	f.resolved = append(f.resolved, approvalID+":"+status)
	return nil
}

type fakeSessionStore struct {
	sessions []domain.BridgeSession
}

func (f *fakeSessionStore) UpsertSession(_ context.Context, session domain.BridgeSession) error {
	f.sessions = append(f.sessions, session)
	return nil
}

type fakeResponder struct {
	statuses []string
}

func (f *fakeResponder) Respond(_ context.Context, status string, _ string) error {
	f.statuses = append(f.statuses, status)
	return nil
}

func TestProviderRunTurnAndResolveApproval(t *testing.T) {
	t.Parallel()

	responder := &fakeResponder{}
	stream := &fakeStream{
		events: make(chan DriverEvent, 3),
		result: make(chan DriverResult, 1),
	}
	stream.events <- DriverEvent{Type: driverEventStepStarted, StepIndex: 1}
	stream.events <- DriverEvent{Type: driverEventApprovalRequested, StepIndex: 1, ApprovalID: "approval-1", RequestKind: "tool", Prompt: "Approve?", Responder: responder}
	stream.events <- DriverEvent{Type: driverEventContentDelta, StepIndex: 1, Text: "reply"}
	close(stream.events)
	stream.result <- DriverResult{Status: "completed"}
	close(stream.result)

	approvals := &fakeApprovalStore{}
	sessions := &fakeSessionStore{}
	provider := NewProvider(fakeDriver{session: fakeSession{stream: stream}}, approvals, sessions)

	var seen []bridgecore.EventKind
	result, err := provider.RunTurn(context.Background(), bridgecore.RuntimeTarget{Platform: "telegram", ChatID: "chat-1"}, bridgecore.TurnRequest{
		TurnID:        "turn-1",
		KimiSessionID: "session-1",
		Prompt:        "ping",
		WorkDir:       "D:/workspace",
	}, func(event bridgecore.TurnEvent) error {
		seen = append(seen, event.Kind)
		return nil
	})
	if err != nil {
		t.Fatalf("RunTurn returned error: %v", err)
	}
	if result.Status != "completed" {
		t.Fatalf("expected completed result, got %+v", result)
	}
	if len(seen) < 4 || seen[0] != bridgecore.EventTurnStarted {
		t.Fatalf("unexpected event sequence: %+v", seen)
	}
	if err := provider.ResolveApproval(context.Background(), "approval-1", "approved", `{"ok":true}`); err != nil {
		t.Fatalf("ResolveApproval returned error: %v", err)
	}
	if len(responder.statuses) != 1 || responder.statuses[0] != "approved" {
		t.Fatalf("expected responder to receive approval, got %+v", responder.statuses)
	}
	if len(approvals.resolved) != 1 {
		t.Fatalf("expected approval store resolution, got %+v", approvals.resolved)
	}
	if len(sessions.sessions) != 1 || sessions.sessions[0].ProviderName != "kimi" {
		t.Fatalf("expected session persistence, got %+v", sessions.sessions)
	}
}

func TestProviderReconcilePendingApprovals(t *testing.T) {
	t.Parallel()

	approvals := &fakeApprovalStore{}
	provider := NewProvider(fakeDriver{}, approvals, nil)
	count, err := provider.ReconcilePendingApprovals(context.Background(), "restart")
	if err != nil {
		t.Fatalf("ReconcilePendingApprovals returned error: %v", err)
	}
	if count != 1 || len(approvals.resolved) != 1 || approvals.resolved[0] != "approval-stale:failed" {
		t.Fatalf("unexpected reconciliation result count=%d resolved=%+v", count, approvals.resolved)
	}
}
