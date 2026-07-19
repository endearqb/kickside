package runtimeadapter

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

type fakeAdapter struct {
	mu                 sync.Mutex
	ensureRequests     []bridgeruntime.EnsureSessionRequest
	ensureErrors       []error
	promptRequests     []bridgeruntime.AdapterPromptRequest
	approvalsBySession map[string][]bridgeruntime.RuntimeApproval
	approvalListErrors map[string]error
}

func (f *fakeAdapter) EnsureWorkspace(_ context.Context, root string) (bridgeruntime.WorkspaceRef, error) {
	return bridgeruntime.WorkspaceRef{WorkspaceID: "ws_1", Root: root}, nil
}

func (f *fakeAdapter) EnsureSession(_ context.Context, request bridgeruntime.EnsureSessionRequest) (bridgeruntime.SessionRef, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.ensureRequests = append(f.ensureRequests, request)
	if len(f.ensureErrors) > 0 {
		err := f.ensureErrors[0]
		f.ensureErrors = f.ensureErrors[1:]
		if err != nil {
			return bridgeruntime.SessionRef{}, err
		}
	}
	return bridgeruntime.SessionRef{
		KimiCodeSessionID: "server-session-1",
		WorkspaceRoot:     request.WorkspaceRoot,
		WorkspaceID:       "ws_1",
		SessionSource:     "server_auto",
		RuntimeAdapter:    bridgeruntime.RuntimeAdapterServer,
	}, nil
}

func (f *fakeAdapter) SubmitPrompt(_ context.Context, request bridgeruntime.AdapterPromptRequest, sink bridgeruntime.AdapterEventSink) (bridgeruntime.AdapterPromptResult, error) {
	f.mu.Lock()
	f.promptRequests = append(f.promptRequests, request)
	f.mu.Unlock()
	if err := sink(bridgeruntime.AdapterEvent{Type: "content_delta", Text: "server reply"}); err != nil {
		return bridgeruntime.AdapterPromptResult{}, err
	}
	if err := sink(bridgeruntime.AdapterEvent{Type: "turn_completed", Status: "completed"}); err != nil {
		return bridgeruntime.AdapterPromptResult{}, err
	}
	return bridgeruntime.AdapterPromptResult{PromptID: "prompt_1", Status: "completed"}, nil
}

func (f *fakeAdapter) ListApprovals(_ context.Context, sessionID string) ([]bridgeruntime.RuntimeApproval, error) {
	if f.approvalListErrors != nil {
		if err := f.approvalListErrors[sessionID]; err != nil {
			return nil, err
		}
	}
	return append([]bridgeruntime.RuntimeApproval(nil), f.approvalsBySession[sessionID]...), nil
}

func (f *fakeAdapter) ResolveApproval(context.Context, string, string, bridgeruntime.ApprovalDecision) error {
	return nil
}

func (f *fakeAdapter) AbortPrompt(context.Context, string, string) error {
	return nil
}

func (f *fakeAdapter) Close() error {
	return nil
}

type fakeSessionStore struct {
	sessions []domain.BridgeSession
	bindings []domain.BindingRecord
}

func (s *fakeSessionStore) UpsertSession(_ context.Context, session domain.BridgeSession) error {
	s.sessions = append(s.sessions, session)
	return nil
}

func (s *fakeSessionStore) ListSessions(context.Context) ([]domain.BridgeSession, error) {
	return append([]domain.BridgeSession(nil), s.sessions...), nil
}

func (s *fakeSessionStore) ListBindings(context.Context) ([]domain.BindingRecord, error) {
	return append([]domain.BindingRecord(nil), s.bindings...), nil
}

type fakeApprovalStore struct {
	tickets map[string]domain.ApprovalTicket
}

func newFakeApprovalStore(tickets ...domain.ApprovalTicket) *fakeApprovalStore {
	store := &fakeApprovalStore{tickets: map[string]domain.ApprovalTicket{}}
	for _, ticket := range tickets {
		store.tickets[ticket.ApprovalID] = ticket
	}
	return store
}

func (s *fakeApprovalStore) CreateApprovalTicket(_ context.Context, ticket domain.ApprovalTicket) error {
	if _, ok := s.tickets[ticket.ApprovalID]; ok {
		return fmt.Errorf("approval %s already exists", ticket.ApprovalID)
	}
	s.tickets[ticket.ApprovalID] = ticket
	return nil
}

func (s *fakeApprovalStore) ListApprovals(_ context.Context, status string) ([]domain.ApprovalTicket, error) {
	items := []domain.ApprovalTicket{}
	for _, ticket := range s.tickets {
		if status == "" || ticket.Status == status {
			items = append(items, ticket)
		}
	}
	return items, nil
}

func (s *fakeApprovalStore) GetApprovalByID(_ context.Context, approvalID string) (*domain.ApprovalTicket, error) {
	ticket, ok := s.tickets[approvalID]
	if !ok {
		return nil, nil
	}
	return &ticket, nil
}

func (s *fakeApprovalStore) ResolveApproval(_ context.Context, approvalID string, status string, payload string) error {
	ticket, ok := s.tickets[approvalID]
	if !ok {
		return fmt.Errorf("approval %s not found", approvalID)
	}
	ticket.Status = status
	ticket.ResolutionPayloadJSON = payload
	s.tickets[approvalID] = ticket
	return nil
}

func TestProviderRunTurnUsesServerSessionAndMapsEvents(t *testing.T) {
	adapter := &fakeAdapter{}
	sessions := &fakeSessionStore{}
	provider := NewProvider(adapter, nil, sessions)

	events := []bridgecore.TurnEvent{}
	result, err := provider.RunTurn(context.Background(), bridgecore.RuntimeTarget{
		Platform: "telegram",
		ChatID:   "chat-1",
	}, bridgecore.TurnRequest{
		TurnID:        "turn-1",
		KimiSessionID: "synthetic-session",
		WorkDir:       "D:/repo",
		Prompt:        "hello",
		AutoApprove:   true,
	}, func(event bridgecore.TurnEvent) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatalf("RunTurn returned error: %v", err)
	}

	if result.KimiSessionID != "server-session-1" || result.PromptID != "prompt_1" || result.Status != "completed" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(adapter.ensureRequests) != 1 || adapter.ensureRequests[0].KimiCodeSessionID != "synthetic-session" || adapter.ensureRequests[0].CreateMode != bridgeruntime.SessionCreateIfMissing {
		t.Fatalf("expected ensure call with prior session id, got %+v", adapter.ensureRequests)
	}
	if len(adapter.promptRequests) != 1 || adapter.promptRequests[0].SessionID != "server-session-1" {
		t.Fatalf("expected prompt against server session, got %+v", adapter.promptRequests)
	}
	if adapter.promptRequests[0].Controls.PermissionMode != "auto" {
		t.Fatalf("expected auto permission control, got %+v", adapter.promptRequests[0].Controls)
	}
	if len(events) < 3 {
		t.Fatalf("expected runtime events, got %+v", events)
	}
	if events[1].Kind != bridgecore.EventContentDelta || events[1].TextDelta != "server reply" {
		t.Fatalf("expected content delta event, got %+v", events)
	}
	if len(sessions.sessions) != 1 || sessions.sessions[0].KimiSessionID != "server-session-1" {
		t.Fatalf("expected server session upsert, got %+v", sessions.sessions)
	}
}

func TestProviderRunTurnUsesResumeExactWhenRequired(t *testing.T) {
	adapter := &fakeAdapter{}
	provider := NewProvider(adapter, nil, nil)
	_, err := provider.RunTurn(context.Background(), bridgecore.RuntimeTarget{}, bridgecore.TurnRequest{
		KimiSessionID:       "session-exact",
		WorkDir:             "D:/repo",
		Prompt:              "hello",
		RequireExactSession: true,
	}, nil)
	if err != nil {
		t.Fatalf("RunTurn returned error: %v", err)
	}
	if len(adapter.ensureRequests) != 1 || adapter.ensureRequests[0].CreateMode != bridgeruntime.SessionResumeExact {
		t.Fatalf("strict execution did not use resume_exact: %+v", adapter.ensureRequests)
	}
}

func TestProviderMapsPromptIDToTurnEvent(t *testing.T) {
	provider := NewProvider(&fakeAdapter{}, nil, nil)
	events := []bridgecore.TurnEvent{}
	err := provider.emitAdapterEvent(func(event bridgecore.TurnEvent) error {
		events = append(events, event)
		return nil
	}, bridgecore.RuntimeTarget{}, "session-1", bridgeruntime.AdapterEvent{Type: "prompt_submitted", PromptID: "prompt-1"})
	if err != nil || len(events) != 1 || events[0].PromptID != "prompt-1" {
		t.Fatalf("prompt id was not mapped: events=%+v err=%v", events, err)
	}
}

func TestProviderDoesNotRebindResumeExactFailure(t *testing.T) {
	adapter := &fakeAdapter{ensureErrors: []error{fmt.Errorf("session not found")}}
	provider := NewProvider(adapter, nil, nil)
	_, err := provider.ensureSession(context.Background(), bridgeruntime.EnsureSessionRequest{
		KimiCodeSessionID: "missing-session",
		WorkspaceRoot:     "D:/repo",
		CreateMode:        bridgeruntime.SessionResumeExact,
	})
	if err == nil {
		t.Fatal("expected resume_exact failure")
	}
	if len(adapter.ensureRequests) != 1 || adapter.ensureRequests[0].KimiCodeSessionID != "missing-session" {
		t.Fatalf("resume_exact unexpectedly rebound: %+v", adapter.ensureRequests)
	}
}

func TestProviderEnsureSessionAlwaysCreatesForNewBinding(t *testing.T) {
	adapter := &fakeAdapter{}
	provider := NewProvider(adapter, nil, nil)
	_, err := provider.EnsureSession(context.Background(), bridgecore.RuntimeTarget{}, bridgecore.RuntimeSessionRequest{WorkDir: "D:/repo"})
	if err != nil {
		t.Fatalf("EnsureSession returned error: %v", err)
	}
	if len(adapter.ensureRequests) != 1 || adapter.ensureRequests[0].CreateMode != bridgeruntime.SessionCreateAlways || adapter.ensureRequests[0].KimiCodeSessionID != "" {
		t.Fatalf("new binding did not request an isolated session: %+v", adapter.ensureRequests)
	}
}

func TestProviderRetainsIfMissingCompatibilityRebind(t *testing.T) {
	adapter := &fakeAdapter{ensureErrors: []error{fmt.Errorf("old session not found")}}
	provider := NewProvider(adapter, nil, nil)
	session, err := provider.ensureSession(context.Background(), bridgeruntime.EnsureSessionRequest{
		KimiCodeSessionID: "old-session",
		WorkspaceRoot:     "D:/repo",
		SessionSource:     "server",
		CreateMode:        bridgeruntime.SessionCreateIfMissing,
	})
	if err != nil || session.KimiCodeSessionID != "server-session-1" {
		t.Fatalf("if_missing compatibility rebind returned session=%+v err=%v", session, err)
	}
	if len(adapter.ensureRequests) != 2 || adapter.ensureRequests[0].KimiCodeSessionID != "old-session" || adapter.ensureRequests[1].KimiCodeSessionID != "" || adapter.ensureRequests[1].CreateMode != bridgeruntime.SessionCreateIfMissing || adapter.ensureRequests[1].SessionSource != "server" {
		t.Fatalf("unexpected if_missing rebind requests: %+v", adapter.ensureRequests)
	}
}

func TestProviderRunTurnMapsMetadataControls(t *testing.T) {
	adapter := &fakeAdapter{}
	provider := NewProvider(adapter, nil, &fakeSessionStore{})

	_, err := provider.RunTurn(context.Background(), bridgecore.RuntimeTarget{
		Platform: "feishu",
		ChatID:   "chat-1",
	}, bridgecore.TurnRequest{
		TurnID:        "turn-1",
		KimiSessionID: "server-session-1",
		WorkDir:       "D:/repo",
		Prompt:        "hello",
		MetadataJSON:  `{"runtime_controls":{"model":"kimi-k2","thinking":"high","permission_mode":"manual","plan_mode":true,"swarm_mode":true,"goal_objective":"ship it","goal_control":"resume"}}`,
	}, nil)
	if err != nil {
		t.Fatalf("RunTurn returned error: %v", err)
	}
	if len(adapter.promptRequests) != 1 {
		t.Fatalf("expected one prompt request, got %+v", adapter.promptRequests)
	}
	controls := adapter.promptRequests[0].Controls
	if controls.Model != "kimi-k2" ||
		controls.Thinking != "high" ||
		controls.PermissionMode != "manual" ||
		!controls.PlanMode ||
		!controls.SwarmMode ||
		controls.GoalObjective != "ship it" ||
		controls.GoalControl != "resume" {
		t.Fatalf("unexpected controls: %+v", controls)
	}
}

func TestProviderReconcilePendingApprovalsUsesServerState(t *testing.T) {
	adapter := &fakeAdapter{approvalsBySession: map[string][]bridgeruntime.RuntimeApproval{
		"server-session-1": {
			{ApprovalID: "approval-kept", SessionID: "server-session-1", ToolName: "edit", Action: "Edit file"},
			{ApprovalID: "approval-new", SessionID: "server-session-1", ToolName: "shell", Action: "Run command"},
		},
	}}
	approvals := newFakeApprovalStore(
		domain.ApprovalTicket{
			ApprovalID:         "approval-kept",
			KimiSessionID:      "server-session-1",
			Status:             "pending",
			RequestPayloadJSON: "{}",
		},
		domain.ApprovalTicket{
			ApprovalID:         "approval-stale",
			KimiSessionID:      "server-session-1",
			Status:             "pending",
			RequestPayloadJSON: "{}",
		},
	)
	sessions := &fakeSessionStore{
		sessions: []domain.BridgeSession{{KimiSessionID: "server-session-1", ProviderName: bridgeruntime.RuntimeAdapterServer}},
		bindings: []domain.BindingRecord{{
			ConnectorID:   "feishu-default",
			Platform:      "feishu",
			ChatID:        "chat-1",
			ThreadID:      "thread-1",
			KimiSessionID: "server-session-1",
		}},
	}
	provider := NewProvider(adapter, approvals, sessions)

	reconciled, err := provider.ReconcilePendingApprovals(context.Background(), "restart")
	if err != nil {
		t.Fatalf("ReconcilePendingApprovals returned error: %v", err)
	}
	if reconciled != 2 {
		t.Fatalf("expected 2 reconciled approvals, got %d", reconciled)
	}
	if approvals.tickets["approval-kept"].Status != "pending" {
		t.Fatalf("expected server-kept approval to remain pending, got %+v", approvals.tickets["approval-kept"])
	}
	if approvals.tickets["approval-stale"].Status != "stale_failed" {
		t.Fatalf("expected stale approval to be marked stale_failed, got %+v", approvals.tickets["approval-stale"])
	}
	created := approvals.tickets["approval-new"]
	if created.Status != "pending" || created.ConnectorID != "feishu-default" || created.Platform != "feishu" || created.ChatID != "chat-1" || created.ThreadID != "thread-1" {
		t.Fatalf("expected server-only projection, got %+v", created)
	}
}

func TestProviderReconcilePendingApprovalsLeavesSessionPendingWhenServerUnavailable(t *testing.T) {
	adapter := &fakeAdapter{
		approvalListErrors: map[string]error{"server-session-1": fmt.Errorf("server unavailable")},
	}
	approvals := newFakeApprovalStore(domain.ApprovalTicket{
		ApprovalID:         "approval-pending",
		KimiSessionID:      "server-session-1",
		Status:             "pending",
		RequestPayloadJSON: "{}",
	})
	sessions := &fakeSessionStore{sessions: []domain.BridgeSession{{KimiSessionID: "server-session-1", ProviderName: bridgeruntime.RuntimeAdapterServer}}}
	provider := NewProvider(adapter, approvals, sessions)

	reconciled, err := provider.ReconcilePendingApprovals(context.Background(), "restart")
	if err != nil {
		t.Fatalf("ReconcilePendingApprovals returned error: %v", err)
	}
	if reconciled != 0 {
		t.Fatalf("expected no reconciled approvals, got %d", reconciled)
	}
	if approvals.tickets["approval-pending"].Status != "pending" {
		t.Fatalf("expected pending approval to remain pending, got %+v", approvals.tickets["approval-pending"])
	}
}
