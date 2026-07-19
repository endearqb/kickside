package bridgecore

import (
	"context"
	"errors"
	"strings"
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
	result            TurnResult
	events            []TurnEvent
	runErr            error
	ensuredSession    RuntimeSession
	lastTarget        RuntimeTarget
	lastRequest       TurnRequest
	lastEnsureRequest RuntimeSessionRequest
	ensureCallCount   int
	runCallCount      int
}

func (f *fakeRuntime) RunTurn(_ context.Context, target RuntimeTarget, request TurnRequest, sink TurnEventSink) (TurnResult, error) {
	f.runCallCount++
	f.lastTarget = target
	f.lastRequest = request
	for _, event := range f.events {
		if err := sink(event); err != nil {
			return TurnResult{}, err
		}
	}
	return f.result, f.runErr
}

func (f *fakeRuntime) EnsureSession(_ context.Context, _ RuntimeTarget, request RuntimeSessionRequest) (RuntimeSession, error) {
	f.ensureCallCount++
	f.lastEnsureRequest = request
	return f.ensuredSession, nil
}

type fakeAgentBindingResolver struct {
	context *domain.ConnectorAgentContext
}

func (f fakeAgentBindingResolver) ResolveConnectorAgent(context.Context, string) (*domain.ConnectorAgentContext, error) {
	return f.context, nil
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

func TestOrchestratorAppliesConnectorAgentContextAndWorkDirPriority(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name, connectorWorkDir, want string
	}{
		{"connector override", "D:/connector", "D:/connector"},
		{"agent default", "", "D:/agent"},
	} {
		t.Run(test.name, func(t *testing.T) {
			bindings := &fakeBindings{}
			runtime := &fakeRuntime{ensuredSession: RuntimeSession{KimiSessionID: "session-1", WorkDir: test.want}, result: TurnResult{KimiSessionID: "session-1", Status: "completed"}}
			resolver := fakeAgentBindingResolver{context: &domain.ConnectorAgentContext{ConnectorID: "feishu-one", AgentID: "agent-one", SessionMode: "independent_session", RolePrompt: "review carefully", DefaultWorkDir: "D:/agent", RuntimeControls: []byte(`{"thinking":"low"}`)}}
			orchestrator := NewOrchestrator(bindings, runtime, &fakeApprovals{}, &fakeTurns{}, &fakeEventStore{}, OrchestratorOptions{AgentBindings: resolver, DefaultWorkDir: "D:/global"})
			_, err := orchestrator.HandleInbound(context.Background(), adapterkit.NormalizedInbound{MessageID: "msg", ConnectorID: "feishu-one", Platform: "feishu", ChatID: "chat", Text: "inspect", BindingKey: domain.BindingKey{ConnectorID: "feishu-one", Platform: "feishu", ChatID: "chat"}}, HandleOptions{DefaultWorkDir: test.connectorWorkDir}, nil)
			if err != nil {
				t.Fatal(err)
			}
			if runtime.lastEnsureRequest.WorkDir != test.want || !strings.Contains(runtime.lastRequest.Prompt, "Role:\nreview carefully") || !strings.Contains(runtime.lastRequest.MetadataJSON, "agent-one") || !strings.Contains(runtime.lastRequest.MetadataJSON, "runtime_controls") {
				t.Fatalf("agent context was not applied: ensure=%+v request=%+v", runtime.lastEnsureRequest, runtime.lastRequest)
			}
		})
	}
}

func TestOrchestratorSameSessionBindingIsExact(t *testing.T) {
	t.Parallel()
	bindings := &fakeBindings{}
	runtime := &fakeRuntime{result: TurnResult{KimiSessionID: "pinned", Status: "completed"}}
	resolver := fakeAgentBindingResolver{context: &domain.ConnectorAgentContext{ConnectorID: "telegram-one", AgentID: "agent-one", SessionMode: "same_session", PinnedSessionID: "pinned", PinnedWorkDir: "D:/agent"}}
	orchestrator := NewOrchestrator(bindings, runtime, &fakeApprovals{}, &fakeTurns{}, &fakeEventStore{}, OrchestratorOptions{AgentBindings: resolver, DefaultWorkDir: "D:/global"})
	_, err := orchestrator.HandleInbound(context.Background(), adapterkit.NormalizedInbound{MessageID: "msg", ConnectorID: "telegram-one", Platform: "telegram", ChatID: "chat", Text: "inspect", BindingKey: domain.BindingKey{ConnectorID: "telegram-one", Platform: "telegram", ChatID: "chat"}}, HandleOptions{DefaultWorkDir: "D:/agent"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.ensureCallCount != 0 || bindings.binding == nil || bindings.binding.KimiSessionID != "pinned" || bindings.binding.Source != "agent_binding" {
		t.Fatalf("same-session binding was not exact: ensure=%d binding=%+v", runtime.ensureCallCount, bindings.binding)
	}
	mismatchRuntime := &fakeRuntime{}
	mismatch := NewOrchestrator(&fakeBindings{}, mismatchRuntime, &fakeApprovals{}, &fakeTurns{}, &fakeEventStore{}, OrchestratorOptions{AgentBindings: resolver})
	if _, err := mismatch.HandleInbound(context.Background(), adapterkit.NormalizedInbound{MessageID: "mismatch", ConnectorID: "telegram-one", Platform: "telegram", ChatID: "chat-2", Text: "inspect", BindingKey: domain.BindingKey{ConnectorID: "telegram-one", Platform: "telegram", ChatID: "chat-2"}}, HandleOptions{DefaultWorkDir: "D:/other"}, nil); err == nil || !strings.Contains(err.Error(), "workspace_mismatch") {
		t.Fatalf("same-session workspace mismatch must fail closed, got %v", err)
	}
	if mismatchRuntime.runCallCount != 0 {
		t.Fatalf("workspace mismatch reached Runtime: %d", mismatchRuntime.runCallCount)
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

func TestOrchestratorRebindsRuntimeSessionResolvedDuringExecution(t *testing.T) {
	t.Parallel()

	bindings := &fakeBindings{binding: &domain.SessionBinding{
		BindingID:     "binding-1",
		KimiSessionID: "old-session",
		WorkDir:       "D:/workspace",
	}}
	runtime := &fakeRuntime{result: TurnResult{KimiSessionID: "real-session", Status: "completed"}}
	orchestrator := NewOrchestrator(bindings, runtime, &fakeApprovals{}, &fakeTurns{}, &fakeEventStore{})
	result, err := orchestrator.HandleInbound(context.Background(), adapterkit.NormalizedInbound{
		MessageID:  "msg-rebind",
		Platform:   "feishu",
		ChatID:     "chat-1",
		Text:       "ping",
		BindingKey: domain.BindingKey{Platform: "feishu", ChatID: "chat-1"},
	}, HandleOptions{}, nil)
	if err != nil {
		t.Fatalf("HandleInbound returned error: %v", err)
	}
	if result.SessionID != "real-session" || bindings.binding.KimiSessionID != "real-session" {
		t.Fatalf("runtime session was not rebound: result=%+v binding=%+v", result, bindings.binding)
	}
}

func TestExecutionServiceRunsRoomTargetAndProjectsEnrichedEvents(t *testing.T) {
	t.Parallel()

	artifact := domain.RuntimeArtifact{Title: "report"}
	runtime := &fakeRuntime{
		result: TurnResult{KimiSessionID: "session-room", PromptID: "prompt-room", Status: "completed"},
		events: []TurnEvent{
			{Kind: EventApprovalRequested, KimiSessionID: "session-room", ApprovalID: "approval-room", RequestKind: "tool", Prompt: "Approve?"},
			{Kind: EventContentDelta, KimiSessionID: "session-room", TextDelta: "room reply"},
			{Kind: EventArtifactReady, KimiSessionID: "session-room", Artifact: &artifact},
			{Kind: EventTurnCompleted, KimiSessionID: "session-room", Status: "completed"},
		},
	}
	approvals := &fakeApprovals{}
	turns := &fakeTurns{}
	events := &fakeEventStore{}
	service := NewExecutionService(runtime, approvals, turns, events)
	target := ExecutionTarget{OriginKind: "agent_room", RoomID: "room-1", MemberID: "member-1", AgentID: "agent-1", RunID: "run-1"}
	projected := []ExecutionEvent{}
	result, err := service.Run(context.Background(), target, ExecutionRequest{
		TurnID:              "turn-room",
		Prompt:              "review",
		WorkDir:             "D:/repo",
		KimiSessionID:       "session-room",
		RequireExactSession: true,
	}, func(event ExecutionEvent) error {
		projected = append(projected, event)
		return nil
	})
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}
	if result.ReplyText != "room reply" || result.PromptID != "prompt-room" || len(result.Artifacts) != 1 {
		t.Fatalf("unexpected execution result: %+v", result)
	}
	if !runtime.lastRequest.RequireExactSession || runtime.lastTarget.Platform != "agent_room" || runtime.lastTarget.ChatID != "room-1" {
		t.Fatalf("room execution target/request were not preserved: target=%+v request=%+v", runtime.lastTarget, runtime.lastRequest)
	}
	if len(approvals.tickets) != 1 || approvals.tickets[0].RoomID != "room-1" || approvals.tickets[0].MemberID != "member-1" || approvals.tickets[0].AgentID != "agent-1" || approvals.tickets[0].RunID != "run-1" {
		t.Fatalf("approval association was not carried: %+v", approvals.tickets)
	}
	if len(projected) != len(events.events) || len(projected) == 0 || projected[0].Target != target || projected[0].Event.EventID != events.events[0].EventID {
		t.Fatalf("turn persistence and room projection diverged: projected=%+v persisted=%+v", projected, events.events)
	}
	if len(turns.turns) != 2 || len(turns.sessions) != 1 || turns.sessions[0].KimiSessionID != "session-room" {
		t.Fatalf("turn/session persistence missing: turns=%+v sessions=%+v", turns.turns, turns.sessions)
	}
}

func TestExecutionServicePersistsRuntimeFailure(t *testing.T) {
	t.Parallel()

	runtimeErr := errors.New("runtime failed")
	runtime := &fakeRuntime{
		result: TurnResult{KimiSessionID: "session-1", Status: "failed"},
		runErr: runtimeErr,
	}
	turns := &fakeTurns{}
	service := NewExecutionService(runtime, nil, turns, &fakeEventStore{})
	result, err := service.Run(context.Background(), ExecutionTarget{Platform: "telegram", ChatID: "chat-1"}, ExecutionRequest{
		TurnID:        "turn-failed",
		Prompt:        "fail",
		KimiSessionID: "session-1",
	}, nil)
	if !errors.Is(err, runtimeErr) || result.Status != "failed" || result.Error != runtimeErr.Error() {
		t.Fatalf("unexpected failed execution result=%+v err=%v", result, err)
	}
	if len(turns.turns) != 2 || turns.turns[1].Status != "failed" || turns.turns[1].CompletedAt == "" || len(turns.sessions) != 1 {
		t.Fatalf("failed execution was not durably finalized: turns=%+v sessions=%+v", turns.turns, turns.sessions)
	}
}
