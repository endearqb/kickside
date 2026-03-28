package runtime

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type fakeDriver struct {
	stream PromptStream
}

func (d *fakeDriver) OpenSession(PromptRequest) (DriverSession, error) {
	return &fakeDriverSession{stream: d.stream}, nil
}

type fakeDriverSession struct {
	stream PromptStream
}

func (s *fakeDriverSession) StartPrompt(context.Context, PromptRequest) (PromptStream, error) {
	return s.stream, nil
}

func (s *fakeDriverSession) Close() error {
	return nil
}

type fakePromptStream struct {
	events chan DriverEvent
	result chan DriverResult
}

func newFakePromptStream() *fakePromptStream {
	return &fakePromptStream{
		events: make(chan DriverEvent),
		result: make(chan DriverResult, 1),
	}
}

func (s *fakePromptStream) Events() <-chan DriverEvent {
	return s.events
}

func (s *fakePromptStream) Result() <-chan DriverResult {
	return s.result
}

func (s *fakePromptStream) Close() error {
	return nil
}

type turnRunnerApprovalStore struct {
	mu       sync.Mutex
	tickets  map[string]domain.ApprovalTicket
	resolved map[string]string
}

func newTurnRunnerApprovalStore() *turnRunnerApprovalStore {
	return &turnRunnerApprovalStore{
		tickets:  make(map[string]domain.ApprovalTicket),
		resolved: make(map[string]string),
	}
}

func (s *turnRunnerApprovalStore) CreateApprovalTicket(_ context.Context, ticket domain.ApprovalTicket) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tickets[ticket.ApprovalID] = ticket
	return nil
}

func (s *turnRunnerApprovalStore) ListApprovals(_ context.Context, status string) ([]domain.ApprovalTicket, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	items := make([]domain.ApprovalTicket, 0, len(s.tickets))
	for _, ticket := range s.tickets {
		if status == "" || ticket.Status == status {
			items = append(items, ticket)
		}
	}
	return items, nil
}

func (s *turnRunnerApprovalStore) ResolveApproval(_ context.Context, approvalID string, status string, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resolved[approvalID] = status
	return nil
}

func (s *turnRunnerApprovalStore) ticket(approvalID string) (domain.ApprovalTicket, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ticket, ok := s.tickets[approvalID]
	return ticket, ok
}

func (s *turnRunnerApprovalStore) resolvedStatus(approvalID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.resolved[approvalID]
}

type fakeSessionStore struct {
	mu       sync.Mutex
	sessions []domain.BridgeSession
}

func (s *fakeSessionStore) UpsertSession(_ context.Context, session domain.BridgeSession) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions = append(s.sessions, session)
	return nil
}

func (s *fakeSessionStore) lastSession() domain.BridgeSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sessions[len(s.sessions)-1]
}

type fakeResponder struct {
	done   chan struct{}
	status string
}

func (r *fakeResponder) Respond(_ context.Context, status string, _ string) error {
	r.status = status
	close(r.done)
	return nil
}

func TestTurnRunnerRunPromptApprovalFlow(t *testing.T) {
	t.Parallel()

	stream := newFakePromptStream()
	driver := &fakeDriver{stream: stream}
	approvalStore := newTurnRunnerApprovalStore()
	approvals := NewApprovalCoordinator(approvalStore)
	sessionStore := &fakeSessionStore{}
	runner := NewTurnRunner(driver, NewSessionRegistry(), approvals, sessionStore)
	responder := &fakeResponder{done: make(chan struct{})}

	done := make(chan PromptResponse, 1)
	errs := make(chan error, 1)
	go func() {
		response, err := runner.RunPrompt(context.Background(), PromptRequest{
			Prompt: "hello",
		})
		if err != nil {
			errs <- err
			return
		}
		done <- response
	}()

	go func() {
		stream.events <- DriverEvent{Type: driverEventStepStarted, StepIndex: 1}
		stream.events <- DriverEvent{Type: driverEventContentDelta, StepIndex: 1, Text: "before approval"}
		stream.events <- DriverEvent{
			Type:               driverEventApprovalRequested,
			StepIndex:          1,
			ApprovalID:         "approval-1",
			RequestKind:        "shell",
			Prompt:             "approve?",
			RequestPayloadJSON: `{"id":"approval-1"}`,
			Responder:          responder,
		}
		<-responder.done
		stream.events <- DriverEvent{Type: driverEventApprovalResolved, StepIndex: 1, ApprovalID: "approval-1", Status: responder.status}
		close(stream.events)
		stream.result <- DriverResult{
			Status:       "finished",
			ContextUsage: 0.5,
			TokenUsage: TokenUsage{
				InputOther: 10,
				Output:     5,
			},
		}
		close(stream.result)
	}()

	var ticket domain.ApprovalTicket
	deadline := time.Now().Add(2 * time.Second)
	for {
		current, ok := approvalStore.ticket("approval-1")
		if ok {
			ticket = current
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("approval ticket was not registered")
		}
		time.Sleep(10 * time.Millisecond)
	}

	if ticket.Status != "pending" {
		t.Fatalf("expected pending ticket, got %s", ticket.Status)
	}
	if ticket.TurnID == "" {
		t.Fatal("expected turn id to be persisted")
	}
	if ticket.StepID == "" {
		t.Fatal("expected step id to be persisted")
	}

	if err := approvals.Resolve(context.Background(), "approval-1", "approved", `{"decision":"ok"}`); err != nil {
		t.Fatalf("Resolve returned error: %v", err)
	}

	select {
	case err := <-errs:
		t.Fatalf("RunPrompt returned error: %v", err)
	case response := <-done:
		if response.KimiSessionID == "" {
			t.Fatal("expected generated session id")
		}
		if response.Result.Status != "finished" {
			t.Fatalf("expected finished result, got %s", response.Result.Status)
		}
		if len(response.Events) != 6 {
			t.Fatalf("expected 6 events, got %d", len(response.Events))
		}
		if response.Events[0].Type != EventTypeTurnStarted {
			t.Fatalf("expected first event turn_started, got %s", response.Events[0].Type)
		}
		if response.Events[3].Type != EventTypeApprovalRequested {
			t.Fatalf("expected approval_requested event, got %s", response.Events[3].Type)
		}
		if response.Events[4].Type != EventTypeApprovalResolved {
			t.Fatalf("expected approval_resolved event, got %s", response.Events[4].Type)
		}
		if response.Events[5].Type != EventTypeTurnCompleted {
			t.Fatalf("expected turn_completed event, got %s", response.Events[5].Type)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RunPrompt timed out")
	}

	if approvalStore.resolvedStatus("approval-1") != "approved" {
		t.Fatalf("expected resolved status approved, got %s", approvalStore.resolvedStatus("approval-1"))
	}

	session := sessionStore.lastSession()
	if session.KimiSessionID == "" {
		t.Fatal("expected session to be persisted")
	}
	if session.LastTurnID == "" {
		t.Fatal("expected last turn id to be persisted")
	}
	if session.AutoApprove {
		t.Fatalf("expected AutoApprove to default false, got %+v", session)
	}
}

func TestTurnRunnerExecuteBindingPromptUsesBindingApprovalTarget(t *testing.T) {
	t.Parallel()

	stream := newFakePromptStream()
	driver := &fakeDriver{stream: stream}
	approvalStore := newTurnRunnerApprovalStore()
	approvals := NewApprovalCoordinator(approvalStore)
	sessionStore := &fakeSessionStore{}
	runner := NewTurnRunner(driver, NewSessionRegistry(), approvals, sessionStore)

	events := []PromptEvent{}
	done := make(chan error, 1)
	go func() {
		_, err := runner.ExecuteBindingPrompt(context.Background(), domain.SessionBinding{
			BindingID:     "binding-1",
			Key:           domain.BindingKey{Platform: "telegram", ChatID: "chat-1", ThreadID: "42"},
			KimiSessionID: "session-1",
			WorkDir:       "D:/work",
		}, PromptRequest{
			Prompt: "hello",
		}, func(event PromptEvent) error {
			events = append(events, event)
			return nil
		})
		done <- err
	}()

	go func() {
		stream.events <- DriverEvent{
			Type:               driverEventApprovalRequested,
			StepIndex:          1,
			ApprovalID:         "approval-1",
			RequestKind:        "tool",
			Prompt:             "approve?",
			RequestPayloadJSON: `{"id":"approval-1"}`,
		}
		close(stream.events)
		stream.result <- DriverResult{Status: "finished"}
		close(stream.result)
	}()

	if err := <-done; err != nil {
		t.Fatalf("ExecuteBindingPrompt returned error: %v", err)
	}

	ticket, ok := approvalStore.ticket("approval-1")
	if !ok {
		t.Fatal("expected approval ticket to be created")
	}
	if ticket.Platform != "telegram" || ticket.ChatID != "chat-1" || ticket.ThreadID != "42" {
		t.Fatalf("expected binding target to be copied into approval ticket, got %+v", ticket)
	}
	if ticket.DedupeKey != "telegram:chat-1:42:approval-1" {
		t.Fatalf("unexpected approval dedupe key: %s", ticket.DedupeKey)
	}
	if len(events) != 3 {
		t.Fatalf("expected 3 sink events, got %d", len(events))
	}
	if events[0].Type != EventTypeTurnStarted || events[1].Type != EventTypeApprovalRequested || events[2].Type != EventTypeTurnCompleted {
		t.Fatalf("unexpected sink event order: %+v", events)
	}
}

func TestTurnRunnerRunPromptPersistsAutoApprove(t *testing.T) {
	t.Parallel()

	stream := newFakePromptStream()
	driver := &fakeDriver{stream: stream}
	approvalStore := newTurnRunnerApprovalStore()
	approvals := NewApprovalCoordinator(approvalStore)
	sessionStore := &fakeSessionStore{}
	runner := NewTurnRunner(driver, NewSessionRegistry(), approvals, sessionStore)

	done := make(chan error, 1)
	go func() {
		_, err := runner.RunPrompt(context.Background(), PromptRequest{
			Prompt:      "hello",
			AutoApprove: true,
		})
		done <- err
	}()

	go func() {
		close(stream.events)
		stream.result <- DriverResult{Status: "finished"}
		close(stream.result)
	}()

	if err := <-done; err != nil {
		t.Fatalf("RunPrompt returned error: %v", err)
	}

	session := sessionStore.lastSession()
	if !session.AutoApprove {
		t.Fatalf("expected AutoApprove=true to be persisted, got %+v", session)
	}
}
