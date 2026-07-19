package bridgecore

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type guardedRuntime struct {
	mu       sync.Mutex
	state    string
	calls    int
	started  chan struct{}
	release  chan struct{}
	stateErr error
}

func (r *guardedRuntime) InspectSession(_ context.Context, sessionID string) (bridgeruntime.RuntimeSessionState, error) {
	if r.stateErr != nil {
		return bridgeruntime.RuntimeSessionState{}, r.stateErr
	}
	return bridgeruntime.RuntimeSessionState{SessionID: sessionID, Status: r.state, ObservedAt: "2026-07-18T12:00:00Z", Generation: 7}, nil
}

func (r *guardedRuntime) RunTurn(_ context.Context, _ RuntimeTarget, request TurnRequest, _ TurnEventSink) (TurnResult, error) {
	r.mu.Lock()
	r.calls++
	r.mu.Unlock()
	if r.started != nil {
		select {
		case r.started <- struct{}{}:
		default:
		}
	}
	if r.release != nil {
		<-r.release
	}
	return TurnResult{KimiSessionID: request.KimiSessionID, Status: "completed"}, nil
}

func (r *guardedRuntime) ResolveApproval(context.Context, string, string, string) error { return nil }
func (r *guardedRuntime) ReconcilePendingApprovals(context.Context, string) (int, error) {
	return 0, nil
}
func (r *guardedRuntime) Close() error { return nil }

func TestExecutionServiceGuardBlocksRuntimeBusyWithoutLease(t *testing.T) {
	ctx := context.Background()
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer dataStore.Close()
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1"}); err != nil {
		t.Fatal(err)
	}
	runtime := &guardedRuntime{state: "running"}
	service := NewExecutionService(runtime, dataStore, dataStore, dataStore)
	_, err = service.Run(ctx, ExecutionTarget{OriginKind: "agent_room", RoomID: "room-1", RunID: "run-1"}, ExecutionRequest{
		TurnID: "turn-1", Prompt: "hello", KimiSessionID: "session-1", RequireExactSession: true,
	}, nil)
	var busy *SessionBusyError
	if !errors.As(err, &busy) || busy.Code != "session_busy" || busy.Details.ControlOrigin != "runtime_external" {
		t.Fatalf("expected runtime busy details, got %T %v", err, err)
	}
	if runtime.calls != 0 {
		t.Fatalf("runtime received %d concurrent prompt(s)", runtime.calls)
	}
}

func TestExecutionServiceGuardSerializesSameSessionAndReleasesLease(t *testing.T) {
	ctx := context.Background()
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer dataStore.Close()
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1"}); err != nil {
		t.Fatal(err)
	}
	runtime := &guardedRuntime{state: "idle", started: make(chan struct{}, 1), release: make(chan struct{})}
	service := NewExecutionService(runtime, dataStore, dataStore, dataStore)
	firstErr := make(chan error, 1)
	go func() {
		_, err := service.Run(ctx, ExecutionTarget{OriginKind: "agent_room", RoomID: "room-1", RunID: "run-1"}, ExecutionRequest{
			TurnID: "turn-1", Prompt: "first", KimiSessionID: "session-1", RequireExactSession: true,
		}, nil)
		firstErr <- err
	}()
	<-runtime.started
	_, err = service.Run(ctx, ExecutionTarget{OriginKind: "agent_room", RoomID: "room-1", RunID: "run-2"}, ExecutionRequest{
		TurnID: "turn-2", Prompt: "second", KimiSessionID: "session-1", RequireExactSession: true,
	}, nil)
	var busy *SessionBusyError
	if !errors.As(err, &busy) || busy.Details.LeaseOwnerRunID != "run-1" {
		t.Fatalf("expected first run lease to block second, got %v", err)
	}
	close(runtime.release)
	if err := <-firstErr; err != nil {
		t.Fatal(err)
	}
	if lease, err := dataStore.GetSessionLease(ctx, "session-1", time.Now()); err != nil || lease != nil {
		t.Fatalf("execution did not owner-release lease: %+v, %v", lease, err)
	}
}

type failingHeartbeatLeases struct {
	renews atomic.Int32
}

type heartbeatFailingStore struct {
	*store.Store
}

func (s *heartbeatFailingStore) RenewSessionLease(context.Context, string, string, time.Time, time.Duration) (domain.SessionLease, bool, error) {
	return domain.SessionLease{}, false, errors.New("database unavailable")
}

func (s *failingHeartbeatLeases) AcquireSessionLease(_ context.Context, sessionID, owner string, now time.Time, ttl time.Duration) (domain.SessionLease, bool, error) {
	return domain.SessionLease{SessionID: sessionID, Owner: owner, ExpiresAt: now.Add(ttl).Format(time.RFC3339)}, true, nil
}
func (s *failingHeartbeatLeases) RenewSessionLease(context.Context, string, string, time.Time, time.Duration) (domain.SessionLease, bool, error) {
	s.renews.Add(1)
	return domain.SessionLease{}, false, errors.New("database unavailable")
}
func (s *failingHeartbeatLeases) ReleaseSessionLease(context.Context, string, string) (bool, error) {
	return true, nil
}
func (s *failingHeartbeatLeases) GetSessionLease(context.Context, string, time.Time) (*domain.SessionLease, error) {
	return nil, nil
}

func TestSessionExecutionGuardReportsThreeHeartbeatFailures(t *testing.T) {
	leasing := &failingHeartbeatLeases{}
	runtime := &guardedRuntime{state: "idle"}
	guard := NewSessionExecutionGuard(leasing, runtime, 30*time.Second, 2*time.Millisecond)
	handle, err := guard.Begin(context.Background(), "session-1", "run-1", true)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(12 * time.Millisecond)
	err = handle.Finish(context.Background())
	if err == nil || leasing.renews.Load() < 3 {
		t.Fatalf("expected three heartbeat failures, renews=%d err=%v", leasing.renews.Load(), err)
	}
}

func TestSessionExecutionGuardFailsClosedForStrictUnknownState(t *testing.T) {
	leasing := &failingHeartbeatLeases{}
	runtime := &guardedRuntime{stateErr: errors.New("runtime unavailable")}
	guard := NewSessionExecutionGuard(leasing, runtime, time.Second, time.Second)
	if _, err := guard.Begin(context.Background(), "session-1", "run-1", true); err == nil {
		t.Fatal("strict execution must fail closed when runtime state is unavailable")
	}
}

func TestExecutionServiceHeartbeatFailureBlocksRoomRunAndEmitsWarning(t *testing.T) {
	ctx := context.Background()
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer dataStore.Close()
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1", WorkDir: "D:/repo"}); err != nil {
		t.Fatal(err)
	}
	profile, err := dataStore.CreateAgentProfile(ctx, domain.AgentProfile{AgentID: "agent-1", Name: "A", RolePrompt: "R", DefaultWorkDir: "D:/repo", SessionPolicy: domain.SessionPolicyPerRoom, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	room, err := dataStore.CreateAgentRoom(ctx, domain.AgentRoom{RoomID: "room-1", Title: "R", OrchestrationMode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	member, err := dataStore.CreateAgentRoomMember(ctx, domain.AgentRoomMember{MemberID: "member-1", RoomID: room.RoomID, MemberKind: "agent", AgentID: profile.AgentID, DisplayName: "A", SessionPolicy: domain.SessionPolicyPerRoom, FollowMode: "pin_session", Status: "idle"})
	if err != nil {
		t.Fatal(err)
	}
	message, err := dataStore.CreateAgentRoomMessage(ctx, domain.AgentRoomMessage{MessageID: "message-1", RoomID: room.RoomID, SenderKind: "user", Content: "run"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dataStore.CreateAgentRun(ctx, domain.AgentRun{RunID: "run-1", RoomID: room.RoomID, SourceMessageID: message.MessageID, MemberID: member.MemberID, AgentID: profile.AgentID, SessionID: "session-1", OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "submitting"}); err != nil {
		t.Fatal(err)
	}
	runtime := &guardedRuntime{state: "idle", release: make(chan struct{})}
	failing := &heartbeatFailingStore{Store: dataStore}
	service := NewExecutionService(runtime, failing, failing, failing)
	service.guard = NewSessionExecutionGuard(failing, runtime, 30*time.Second, 2*time.Millisecond)
	go func() {
		time.Sleep(12 * time.Millisecond)
		close(runtime.release)
	}()
	_, err = service.Run(ctx, ExecutionTarget{OriginKind: "agent_room", RoomID: room.RoomID, MemberID: member.MemberID, AgentID: profile.AgentID, RunID: "run-1"}, ExecutionRequest{
		TurnID: "turn-1", Prompt: "run", KimiSessionID: "session-1", RequireExactSession: true,
	}, nil)
	if err == nil || !strings.Contains(err.Error(), "lease_heartbeat_lost") {
		t.Fatalf("expected redacted heartbeat failure, got %v", err)
	}
	run, err := dataStore.GetAgentRun(ctx, "run-1")
	if err != nil || run == nil || run.Status != "blocked" || run.ErrorCode != "lease_heartbeat_lost" {
		t.Fatalf("heartbeat failure did not block run: %+v, %v", run, err)
	}
	events, err := dataStore.ListAgentRoomEvents(ctx, store.AgentRoomEventQuery{RoomID: room.RoomID, Limit: 10})
	if err != nil || len(events) != 1 || events[0].Kind != "system.warning" {
		t.Fatalf("heartbeat warning was not projected: %+v, %v", events, err)
	}
}
