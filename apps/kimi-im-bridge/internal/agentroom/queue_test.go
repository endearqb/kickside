package agentroom

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type queueRuntime struct {
	mu     sync.Mutex
	states map[string]string
	err    error
	calls  int
}

type observedRuntimeState struct {
	state bridgeruntime.RuntimeSessionState
	ok    bool
	err   error
}

func (s observedRuntimeState) ObservedSessionState(context.Context, string) (bridgeruntime.RuntimeSessionState, bool, error) {
	return s.state, s.ok, s.err
}

func (r *queueRuntime) InspectSession(_ context.Context, sessionID string) (bridgeruntime.RuntimeSessionState, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	if r.err != nil {
		return bridgeruntime.RuntimeSessionState{}, r.err
	}
	return bridgeruntime.RuntimeSessionState{
		SessionID: sessionID, Status: r.states[sessionID], WorkspaceRoot: "", LastSeq: 9,
		ObservedAt: "2026-07-18T12:00:00Z", Generation: 4,
	}, nil
}

func (r *queueRuntime) set(sessionID, status string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.states[sessionID] = status
}

func TestQueueCoordinatorRuntimeBusyNoLeaseAndFollowUpFallback(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	run := createCoordinatorRun(t, service, dataStore, "session-1", "follow_up")
	runtime := &queueRuntime{states: map[string]string{"session-1": "running"}}
	coordinator := NewQueueCoordinator(dataStore, runtime, time.Second)
	_, decision, err := coordinator.PrepareRun(ctx, run.RunID)
	var busy *bridgecore.SessionBusyError
	if !errors.As(err, &busy) || busy.Details.ControlOrigin != "runtime_external" || busy.Details.QueueDepth != 1 {
		t.Fatalf("expected external Runtime busy details, got decision=%+v err=%v", decision, err)
	}
	if decision.EffectivePolicy != "enqueue" || decision.Degradation == "" {
		t.Fatalf("follow_up did not explicitly degrade to local FIFO: %+v", decision)
	}
	if lease, err := dataStore.GetSessionLease(ctx, "session-1", time.Now()); err != nil || lease != nil {
		t.Fatalf("runtime_external must not create local lease: %+v, %v", lease, err)
	}
	observation, err := dataStore.GetSessionObservation(ctx, "session-1")
	if err != nil || observation == nil || observation.ControlOrigin != "runtime_external" {
		t.Fatalf("expected runtime_external observation, got %+v, %v", observation, err)
	}
}

func TestRuntimeStateResolverPrefersFreshSameGenerationObserver(t *testing.T) {
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	api := &queueRuntime{states: map[string]string{"session-1": "idle"}}
	resolver := NewRuntimeStateResolver(observedRuntimeState{ok: true, state: bridgeruntime.RuntimeSessionState{
		SessionID: "session-1", Status: "running", ObservedAt: now.Add(-time.Second).Format(time.RFC3339), Generation: 7,
	}}, api, func() int64 { return 7 }, 5*time.Second)
	resolver.now = func() time.Time { return now }
	state, err := resolver.InspectSession(context.Background(), "session-1")
	if err != nil || state.Status != "running" {
		t.Fatalf("fresh observer did not outrank REST state: %+v, %v", state, err)
	}
	resolver.observer = observedRuntimeState{ok: true, state: bridgeruntime.RuntimeSessionState{
		SessionID: "session-1", Status: "running", ObservedAt: now.Add(-time.Minute).Format(time.RFC3339), Generation: 7,
	}}
	state, err = resolver.InspectSession(context.Background(), "session-1")
	if err != nil || state.Status != "idle" {
		t.Fatalf("stale observer should fall back to fresh REST state: %+v, %v", state, err)
	}
	resolver.observer = observedRuntimeState{ok: true, state: bridgeruntime.RuntimeSessionState{
		SessionID: "session-1", Status: "running", ObservedAt: now.Format(time.RFC3339), Generation: 6,
	}}
	state, err = resolver.InspectSession(context.Background(), "session-1")
	if err != nil || state.Status != "idle" {
		t.Fatalf("old generation observer should fall back to REST state: %+v, %v", state, err)
	}
}

func TestQueueCoordinatorLeaseFIFOAndCompletionTriggersNext(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	first := createCoordinatorRun(t, service, dataStore, "session-1", "enqueue")
	second := createCoordinatorMessageRun(t, service, first.RoomID, "enqueue")
	runtime := &queueRuntime{states: map[string]string{"session-1": "idle"}}
	coordinator := NewQueueCoordinator(dataStore, runtime, 30*time.Second)
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	coordinator.now = func() time.Time { return now }
	prepared, _, err := coordinator.PrepareRun(ctx, first.RunID)
	if err != nil || prepared == nil || prepared.RunID != first.RunID || prepared.Status != "submitting" {
		t.Fatalf("expected first submitting run, got %+v, %v", prepared, err)
	}
	if _, _, err := coordinator.PrepareRun(ctx, second.RunID); err == nil {
		t.Fatal("second run must not submit while first owns the lease")
	} else {
		var busy *bridgecore.SessionBusyError
		if !errors.As(err, &busy) || busy.Details.LeaseOwnerRunID != first.RunID {
			t.Fatalf("expected local lease busy details, got %v", err)
		}
	}
	next, _, err := coordinator.CompleteRun(ctx, first.RunID, "completed")
	if err != nil || next == nil || next.RunID != second.RunID || next.Status != "submitting" {
		t.Fatalf("completion did not trigger FIFO next run: %+v, %v", next, err)
	}
}

func TestQueuedAbortAtomicallyRemovesQueueItemAndWritesAuditEvent(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	run := createCoordinatorRun(t, service, dataStore, "session-cancel", "enqueue")
	runtime := &queueRuntime{states: map[string]string{"session-cancel": "running"}}
	coordinator := NewQueueCoordinator(dataStore, runtime, 30*time.Second)
	if _, _, err := coordinator.PrepareRun(ctx, run.RunID); err == nil {
		t.Fatal("busy Runtime should enqueue and return session_busy")
	} else {
		var busy *bridgecore.SessionBusyError
		if !errors.As(err, &busy) {
			t.Fatalf("expected queued busy result, got %v", err)
		}
	}
	items, err := dataStore.ListSessionQueue(ctx, "session-cancel")
	if err != nil || len(items) != 1 {
		t.Fatalf("expected one queued item before cancel, got %+v, %v", items, err)
	}
	aborted, err := service.MarkAbortRequested(ctx, run.RunID)
	if err != nil || aborted.Status != "aborted" || aborted.QueuePosition != nil {
		t.Fatalf("queued abort failed: %+v, %v", aborted, err)
	}
	items, err = dataStore.ListSessionQueue(ctx, "session-cancel")
	if err != nil || len(items) != 0 {
		t.Fatalf("cancelled run remained in FIFO queue: %+v, %v", items, err)
	}
	events, err := dataStore.ListAgentRoomEvents(ctx, store.AgentRoomEventQuery{RoomID: run.RoomID, Limit: 20})
	if err != nil || !slices.ContainsFunc(events, func(event domain.AgentRoomEvent) bool {
		return event.RunID == run.RunID && event.Kind == "run.aborted" && event.Status == "aborted"
	}) {
		t.Fatalf("abort audit event missing: %+v, %v", events, err)
	}
}

func TestQueueCoordinatorFailsClosedAndDisablesAbortReplace(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	unknown := createCoordinatorRun(t, service, dataStore, "session-1", "enqueue")
	runtime := &queueRuntime{states: map[string]string{"session-1": "unknown"}}
	coordinator := NewQueueCoordinator(dataStore, runtime, time.Second)
	if _, _, err := coordinator.PrepareRun(ctx, unknown.RunID); ErrorCode(err) != "session_state_unavailable" {
		t.Fatalf("unknown Runtime state must fail closed, got %v", err)
	}
	blocked, err := dataStore.GetAgentRun(ctx, unknown.RunID)
	if err != nil || blocked == nil || blocked.Status != "blocked" {
		t.Fatalf("unknown run was not marked blocked: %+v, %v", blocked, err)
	}

	abortRun := createCoordinatorMessageRun(t, service, unknown.RoomID, "abort_and_replace")
	runtime.set("session-1", "running")
	if _, _, err := coordinator.PrepareRun(ctx, abortRun.RunID); ErrorCode(err) != "abort_unconfirmed" {
		t.Fatalf("abort-and-replace must remain disabled, got %v", err)
	}
	abortRun, err = valueRun(dataStore.GetAgentRun(ctx, abortRun.RunID))
	if err != nil || abortRun.Status != "blocked" || abortRun.ErrorCode != "abort_unconfirmed" {
		t.Fatalf("replacement run must remain blocked: %+v, %v", abortRun, err)
	}
	items, err := dataStore.ListSessionQueue(ctx, "session-1")
	if err != nil || len(items) != 0 {
		t.Fatalf("abort replacement was queued before confirmation: %+v, %v", items, err)
	}
}

func TestQueueCoordinatorRecoveryReconcilesClaimAndActiveLease(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	run := createCoordinatorRun(t, service, dataStore, "session-1", "enqueue")
	if _, err := dataStore.EnqueueSessionRun(ctx, "session-1", run.RunID, false); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	claim, _, err := dataStore.ClaimNextSessionRun(ctx, "session-1", now, 30*time.Second)
	if err != nil || claim == nil {
		t.Fatalf("failed to prepare claimed recovery fixture: %+v, %v", claim, err)
	}
	runtime := &queueRuntime{states: map[string]string{"session-1": "running"}}
	coordinator := NewQueueCoordinator(dataStore, runtime, 30*time.Second)
	coordinator.now = func() time.Time { return now.Add(time.Second) }
	if err := coordinator.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	items, err := dataStore.ListSessionQueue(ctx, "session-1")
	if err != nil || len(items) != 1 || items[0].Status != "queued" {
		t.Fatalf("running Runtime claim should safely return to queue, got %+v, %v", items, err)
	}
	if lease, err := dataStore.GetSessionLease(ctx, "session-1", now.Add(time.Second)); err != nil || lease != nil {
		t.Fatalf("external running recovery should release unsubmitted claim lease: %+v, %v", lease, err)
	}

	if next, _, err := coordinator.PrepareNext(ctx, "session-1"); err == nil || next != nil {
		t.Fatalf("Coordinator must keep recovered queue blocked by running Runtime: next=%+v err=%v", next, err)
	}
}

func TestQueueCoordinatorRecordOnlyNeverQueues(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	run := createCoordinatorRun(t, service, dataStore, "session-1", "record_only")
	if run.Status != "completed" {
		t.Fatalf("record_only run should be completed at persistence time: %+v", run)
	}
	coordinator := NewQueueCoordinator(dataStore, &queueRuntime{states: map[string]string{"session-1": "running"}}, time.Second)
	prepared, _, err := coordinator.PrepareRun(ctx, run.RunID)
	if err != nil || prepared == nil || prepared.Status != "completed" {
		t.Fatalf("record_only preparation changed execution state: %+v, %v", prepared, err)
	}
	items, err := dataStore.ListSessionQueue(ctx, "session-1")
	if err != nil || len(items) != 0 {
		t.Fatalf("record_only created executable queue rows: %+v, %v", items, err)
	}
}

func TestQueueCoordinatorRecoveryUnknownFailsClosedAndIdleOrphansActiveRun(t *testing.T) {
	t.Run("unknown claim remains claimed", func(t *testing.T) {
		ctx := context.Background()
		service, dataStore := openTestService(t)
		run := createCoordinatorRun(t, service, dataStore, "session-1", "enqueue")
		if _, err := dataStore.EnqueueSessionRun(ctx, "session-1", run.RunID, false); err != nil {
			t.Fatal(err)
		}
		now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
		if claim, _, err := dataStore.ClaimNextSessionRun(ctx, "session-1", now, 30*time.Second); err != nil || claim == nil {
			t.Fatalf("claim fixture failed: %+v, %v", claim, err)
		}
		runtime := &queueRuntime{states: map[string]string{}, err: errors.New("runtime unavailable")}
		coordinator := NewQueueCoordinator(dataStore, runtime, 30*time.Second)
		coordinator.now = func() time.Time { return now.Add(time.Minute) }
		if err := coordinator.Recover(ctx); err != nil {
			t.Fatal(err)
		}
		claims, err := dataStore.ListClaimedSessionQueue(ctx)
		if err != nil || len(claims) != 1 || claims[0].RunID != run.RunID {
			t.Fatalf("unknown recovery must remain fail-closed: %+v, %v", claims, err)
		}
	})

	t.Run("idle active run becomes orphaned", func(t *testing.T) {
		ctx := context.Background()
		service, dataStore := openTestService(t)
		run := createCoordinatorRun(t, service, dataStore, "session-1", "enqueue")
		runtime := &queueRuntime{states: map[string]string{"session-1": "idle"}}
		coordinator := NewQueueCoordinator(dataStore, runtime, 30*time.Second)
		now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
		coordinator.now = func() time.Time { return now }
		prepared, _, err := coordinator.PrepareRun(ctx, run.RunID)
		if err != nil || prepared == nil {
			t.Fatalf("prepare fixture failed: %+v, %v", prepared, err)
		}
		coordinator.now = func() time.Time { return now.Add(time.Second) }
		if err := coordinator.Recover(ctx); err != nil {
			t.Fatal(err)
		}
		recovered, err := dataStore.GetAgentRun(ctx, run.RunID)
		if err != nil || recovered == nil || recovered.Status != "orphaned" || recovered.ErrorCode != "runtime_idle_after_restart" {
			t.Fatalf("idle active run was not orphaned: %+v, %v", recovered, err)
		}
		if lease, err := dataStore.GetSessionLease(ctx, "session-1", now.Add(time.Second)); err != nil || lease != nil {
			t.Fatalf("orphaned active run lease not released: %+v, %v", lease, err)
		}
	})

	t.Run("running active run renews owner lease", func(t *testing.T) {
		ctx := context.Background()
		service, dataStore := openTestService(t)
		run := createCoordinatorRun(t, service, dataStore, "session-1", "enqueue")
		runtime := &queueRuntime{states: map[string]string{"session-1": "idle"}}
		coordinator := NewQueueCoordinator(dataStore, runtime, 30*time.Second)
		now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
		coordinator.now = func() time.Time { return now }
		if prepared, _, err := coordinator.PrepareRun(ctx, run.RunID); err != nil || prepared == nil {
			t.Fatalf("prepare fixture failed: %+v, %v", prepared, err)
		}
		runtime.set("session-1", "running")
		coordinator.now = func() time.Time { return now.Add(10 * time.Second) }
		if err := coordinator.Recover(ctx); err != nil {
			t.Fatal(err)
		}
		lease, err := dataStore.GetSessionLease(ctx, "session-1", now.Add(10*time.Second))
		if err != nil || lease == nil || lease.Owner != run.RunID || lease.ExpiresAt != now.Add(40*time.Second).Format(time.RFC3339) {
			t.Fatalf("running active run lease was not renewed: %+v, %v", lease, err)
		}
		observation, err := dataStore.GetSessionObservation(ctx, "session-1")
		if err != nil || observation == nil || observation.ControlOrigin != "agent_room" || observation.SessionState != "running" {
			t.Fatalf("running active observation was not recovered: %+v, %v", observation, err)
		}
	})
}

func createCoordinatorRun(t *testing.T, service *Service, dataStore *store.Store, sessionID, policy string) domain.AgentRun {
	t.Helper()
	ctx := context.Background()
	workspace := t.TempDir()
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: sessionID, WorkDir: workspace}); err != nil {
		t.Fatal(err)
	}
	profile, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "Coordinator", RolePrompt: "Coordinate", DefaultWorkDir: workspace,
		SessionPolicy: domain.SessionPolicyResumeSelected, PinnedSessionID: sessionID,
	})
	if err != nil {
		t.Fatal(err)
	}
	room, err := service.CreateRoom(ctx, RoomInput{Title: "Coordinator", OrchestrationMode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.AddAgentMember(ctx, room.RoomID, profile.AgentID); err != nil {
		t.Fatal(err)
	}
	return createCoordinatorMessageRun(t, service, room.RoomID, policy)
}

func createCoordinatorMessageRun(t *testing.T, service *Service, roomID, policy string) domain.AgentRun {
	t.Helper()
	result, err := service.CreateMessageWithRuns(context.Background(), roomID, MessageInput{Content: "run", QueuePolicy: policy})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Runs) != 1 {
		t.Fatalf("expected one run, got %+v", result.Runs)
	}
	return result.Runs[0]
}

func valueRun(run *domain.AgentRun, err error) (domain.AgentRun, error) {
	if run == nil {
		return domain.AgentRun{}, err
	}
	return *run, err
}
