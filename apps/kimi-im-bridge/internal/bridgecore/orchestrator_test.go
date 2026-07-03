package bridgecore

import (
	"context"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapterkit"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type fakeBindings struct {
	binding *domain.SessionBinding
}

func (f *fakeBindings) ResolveBinding(_ context.Context, _ domain.BindingKey) (*domain.SessionBinding, error) {
	return f.binding, nil
}

func (f *fakeBindings) CreateBinding(_ context.Context, key domain.BindingKey, sessionID string, workDir string, source string) (*domain.SessionBinding, error) {
	f.binding = &domain.SessionBinding{
		BindingID:     "binding-1",
		Key:           key,
		KimiSessionID: sessionID,
		WorkDir:       workDir,
		Source:        source,
		CreatedAt:     "2026-03-16T00:00:00Z",
		UpdatedAt:     "2026-03-16T00:00:00Z",
	}
	return f.binding, nil
}

func (f *fakeBindings) Rebind(_ context.Context, _ string, sessionID string) error {
	f.binding.KimiSessionID = sessionID
	return nil
}

type fakeRuntime struct {
	result          TurnResult
	events          []TurnEvent
	ensuredSession  RuntimeSession
	ensureCallCount int
	runCallCount    int
}

func (f *fakeRuntime) RunTurn(_ context.Context, _ RuntimeTarget, _ TurnRequest, sink TurnEventSink) (TurnResult, error) {
	f.runCallCount++
	for _, event := range f.events {
		if err := sink(event); err != nil {
			return TurnResult{}, err
		}
	}
	return f.result, nil
}

func (f *fakeRuntime) EnsureSession(_ context.Context, _ RuntimeTarget, _ RuntimeSessionRequest) (RuntimeSession, error) {
	f.ensureCallCount++
	return f.ensuredSession, nil
}

func (f *fakeRuntime) ResolveApproval(context.Context, string, string, string) error  { return nil }
func (f *fakeRuntime) ReconcilePendingApprovals(context.Context, string) (int, error) { return 0, nil }
func (f *fakeRuntime) Close() error                                                   { return nil }

type fakeApprovals struct {
	tickets []domain.ApprovalTicket
}

func (f *fakeApprovals) CreateApprovalTicket(_ context.Context, ticket domain.ApprovalTicket) error {
	f.tickets = append(f.tickets, ticket)
	return nil
}

type fakeTurns struct {
	turns     []domain.BridgeTurn
	sessions  []domain.BridgeSession
	createErr error
}

func (f *fakeTurns) UpsertSession(_ context.Context, session domain.BridgeSession) error {
	f.sessions = append(f.sessions, session)
	return nil
}

func (f *fakeTurns) CreateTurn(_ context.Context, turn domain.BridgeTurn) error {
	if f.createErr != nil {
		return f.createErr
	}
	f.turns = append(f.turns, turn)
	return nil
}

func (f *fakeTurns) UpdateTurn(_ context.Context, turn domain.BridgeTurn) error {
	f.turns = append(f.turns, turn)
	return nil
}

type fakeEventStore struct {
	events []domain.TurnEventRecord
}

func (f *fakeEventStore) AppendTurnEvent(_ context.Context, event domain.TurnEventRecord) error {
	f.events = append(f.events, event)
	return nil
}

func TestOrchestratorHandlesInboundAndPersistsApproval(t *testing.T) {
	t.Parallel()

	approvals := &fakeApprovals{}
	turns := &fakeTurns{}
	events := &fakeEventStore{}
	runtime := &fakeRuntime{
		result: TurnResult{Status: "completed"},
		events: []TurnEvent{
			{Kind: EventTurnStarted},
			{Kind: EventApprovalRequested, ApprovalID: "approval-1", RequestKind: "tool", Prompt: "Approve?"},
			{Kind: EventContentDelta, TextDelta: "hello"},
			{Kind: EventTurnCompleted, Status: "completed"},
		},
	}

	orchestrator := NewOrchestrator(&fakeBindings{}, runtime, approvals, turns, events)
	result, err := orchestrator.HandleInbound(context.Background(), adapterkit.NormalizedInbound{
		MessageID:  "msg-1",
		Platform:   "telegram",
		ChatID:     "chat-1",
		ThreadID:   "thread-1",
		Text:       "ping",
		ReceivedAt: "2026-03-16T00:00:00Z",
		BindingKey: domain.BindingKey{Platform: "telegram", ChatID: "chat-1", ThreadID: "thread-1"},
	}, HandleOptions{DefaultWorkDir: "D:/workspace"}, nil)
	if err != nil {
		t.Fatalf("HandleInbound returned error: %v", err)
	}
	if result.ReplyText != "hello" {
		t.Fatalf("expected aggregated reply text, got %q", result.ReplyText)
	}
	if len(approvals.tickets) != 1 || approvals.tickets[0].ApprovalID != "approval-1" {
		t.Fatalf("expected approval ticket to be persisted, got %+v", approvals.tickets)
	}
	if len(turns.turns) < 2 {
		t.Fatalf("expected turn create and update calls, got %+v", turns.turns)
	}
	if len(events.events) < 4 {
		t.Fatalf("expected accepted plus runtime events to be persisted, got %+v", events.events)
	}
	if len(turns.sessions) == 0 {
		t.Fatalf("expected session upsert to be called")
	}
	if turns.sessions[len(turns.sessions)-1].AutoApprove {
		t.Fatalf("expected AutoApprove=false for default HandleOptions, got %+v", turns.sessions[len(turns.sessions)-1])
	}
}

func TestOrchestratorPersistsSessionAutoApproveFromHandleOptions(t *testing.T) {
	t.Parallel()

	approvals := &fakeApprovals{}
	turns := &fakeTurns{}
	events := &fakeEventStore{}
	runtime := &fakeRuntime{
		result: TurnResult{Status: "completed"},
		events: []TurnEvent{
			{Kind: EventTurnStarted},
			{Kind: EventTurnCompleted, Status: "completed"},
		},
	}

	orchestrator := NewOrchestrator(&fakeBindings{}, runtime, approvals, turns, events)
	_, err := orchestrator.HandleInbound(context.Background(), adapterkit.NormalizedInbound{
		MessageID:  "msg-1",
		Platform:   "feishu",
		ChatID:     "chat-1",
		ThreadID:   "thread-1",
		Text:       "ping",
		ReceivedAt: "2026-03-16T00:00:00Z",
		BindingKey: domain.BindingKey{Platform: "feishu", ChatID: "chat-1", ThreadID: "thread-1"},
	}, HandleOptions{DefaultWorkDir: "D:/workspace", AutoApprove: true}, nil)
	if err != nil {
		t.Fatalf("HandleInbound returned error: %v", err)
	}
	if len(turns.sessions) == 0 {
		t.Fatalf("expected session upsert to be called")
	}
	if !turns.sessions[len(turns.sessions)-1].AutoApprove {
		t.Fatalf("expected AutoApprove=true to be persisted, got %+v", turns.sessions[len(turns.sessions)-1])
	}
}

func TestOrchestratorSkipsDuplicateInbound(t *testing.T) {
	t.Parallel()

	turns := &fakeTurns{createErr: domain.ErrDuplicateInbound}
	runtime := &fakeRuntime{}
	orchestrator := NewOrchestrator(&fakeBindings{
		binding: &domain.SessionBinding{
			BindingID:     "binding-1",
			KimiSessionID: "session-1",
			WorkDir:       "D:/workspace",
		},
	}, runtime, &fakeApprovals{}, turns, &fakeEventStore{})

	result, err := orchestrator.HandleInbound(context.Background(), adapterkit.NormalizedInbound{
		MessageID:   "msg-1",
		ConnectorID: "feishu-default",
		Platform:    "feishu",
		ChatID:      "chat-1",
		Text:        "ping",
		ReceivedAt:  "2026-03-16T00:00:00Z",
		BindingKey:  domain.BindingKey{ConnectorID: "feishu-default", Platform: "feishu", ChatID: "chat-1"},
	}, HandleOptions{DefaultWorkDir: "D:/workspace"}, nil)
	if err != nil {
		t.Fatalf("HandleInbound returned error: %v", err)
	}
	if !result.Duplicate {
		t.Fatalf("expected duplicate result, got %+v", result)
	}
	if runtime.runCallCount != 0 {
		t.Fatalf("expected duplicate inbound to skip runtime, got %d calls", runtime.runCallCount)
	}
}

func TestOrchestratorCreatesNewBindingWithEnsuredRuntimeSession(t *testing.T) {
	t.Parallel()

	bindings := &fakeBindings{}
	turns := &fakeTurns{}
	events := &fakeEventStore{}
	runtime := &fakeRuntime{
		ensuredSession: RuntimeSession{
			KimiSessionID: "server-session-1",
			WorkDir:       "D:/workspace",
			Source:        "server_auto",
		},
		result: TurnResult{KimiSessionID: "server-session-1", Status: "completed"},
		events: []TurnEvent{
			{Kind: EventTurnStarted, KimiSessionID: "server-session-1"},
			{Kind: EventContentDelta, KimiSessionID: "server-session-1", TextDelta: "server reply"},
			{Kind: EventTurnCompleted, KimiSessionID: "server-session-1", Status: "completed"},
		},
	}

	orchestrator := NewOrchestrator(bindings, runtime, &fakeApprovals{}, turns, events)
	result, err := orchestrator.HandleInbound(context.Background(), adapterkit.NormalizedInbound{
		MessageID:  "msg-1",
		Platform:   "telegram",
		ChatID:     "chat-1",
		Text:       "ping",
		ReceivedAt: "2026-03-16T00:00:00Z",
		BindingKey: domain.BindingKey{Platform: "telegram", ChatID: "chat-1"},
	}, HandleOptions{DefaultWorkDir: "D:/workspace"}, nil)
	if err != nil {
		t.Fatalf("HandleInbound returned error: %v", err)
	}

	if runtime.ensureCallCount != 1 {
		t.Fatalf("expected runtime EnsureSession once, got %d", runtime.ensureCallCount)
	}
	if result.SessionID != "server-session-1" || result.Binding.KimiSessionID != "server-session-1" {
		t.Fatalf("expected server session id to be persisted, got result=%+v", result)
	}
	if bindings.binding == nil || bindings.binding.Source != "server_auto" {
		t.Fatalf("expected binding source from ensured session, got %+v", bindings.binding)
	}
	if len(turns.sessions) == 0 || turns.sessions[len(turns.sessions)-1].KimiSessionID != "server-session-1" {
		t.Fatalf("expected session upsert with server id, got %+v", turns.sessions)
	}
}
