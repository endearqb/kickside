package agentroom

import (
	"context"
	"strings"
	"testing"
	"time"

	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

func TestObservedEventPredatesRun(t *testing.T) {
	if !observedEventPredatesRun("2026-07-19T07:45:19.411Z", "2026-07-19T07:50:56Z") {
		t.Fatal("older replayed event must not attach to a newer active Run")
	}
	if observedEventPredatesRun("2026-07-19T07:50:56.100Z", "2026-07-19T07:50:56Z") {
		t.Fatal("new event was incorrectly rejected")
	}
	if observedEventPredatesRun("invalid", "2026-07-19T07:50:56Z") {
		t.Fatal("unparseable event timestamp must use existing conservative matching")
	}
}

func TestObserverProjectorMirrorsRunReplyApprovalTerminalAndUnknownSafely(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	run := createCoordinatorRun(t, service, dataStore, "session-observed", "enqueue")
	projector := NewObserverProjector(dataStore)
	base, err := time.Parse(time.RFC3339Nano, run.CreatedAt)
	if err != nil {
		t.Fatal(err)
	}
	at := func(offset time.Duration) string { return base.Add(offset).Format(time.RFC3339Nano) }
	events := []bridgeruntime.ObservedRuntimeEvent{
		{EventID: "observed-1", Seq: 1, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, PromptID: "prompt-1", TurnID: "turn-1", Type: "turn.started", Known: true, Timestamp: at(time.Second)},
		{EventID: "observed-2", Seq: 2, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, PromptID: "prompt-1", TurnID: "turn-1", Type: "assistant.delta", TextDelta: "reply", Known: true, Timestamp: at(2 * time.Second)},
		{EventID: "observed-3", Seq: 3, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, PromptID: "prompt-1", TurnID: "turn-1", Type: "approval.requested", ApprovalID: "approval-1", Known: true, Timestamp: at(3 * time.Second)},
		{EventID: "observed-4", Seq: 4, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, PromptID: "prompt-1", TurnID: "turn-1", Type: "approval.resolved", ApprovalID: "approval-1", Known: true, Timestamp: at(4 * time.Second)},
		{EventID: "observed-5", Seq: 5, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, PromptID: "prompt-1", TurnID: "turn-1", Type: "turn.ended", Status: "failed", ErrorCode: "model.not_configured", Known: true, Timestamp: at(5 * time.Second)},
		{EventID: "observed-6", Seq: 6, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, Type: "future.secret", Payload: []byte(`{"token":"must-not-persist"}`), Timestamp: at(6 * time.Second)},
	}
	for _, event := range events {
		if err := projector.ApplyBatch(ctx, bridgeruntime.ObserverBatch{Generation: 4, Epoch: "epoch-1", Events: []bridgeruntime.ObservedRuntimeEvent{event}}); err != nil {
			t.Fatalf("project event %s: %v", event.Type, err)
		}
	}
	storedRun, err := dataStore.GetAgentRun(ctx, run.RunID)
	if err != nil || storedRun == nil || storedRun.Status != "failed" || storedRun.ErrorCode != "model_not_configured" || storedRun.ErrorMessage != "Runtime model is not configured" || storedRun.PromptID != "prompt-1" || storedRun.TurnID != "turn-1" {
		t.Fatalf("unexpected projected Run: %+v err=%v", storedRun, err)
	}
	approval, err := dataStore.GetApprovalByID(ctx, "approval-1")
	if err != nil || approval == nil || approval.Status != "approved" || approval.RunID != run.RunID || approval.RoomID != run.RoomID {
		t.Fatalf("unexpected mirrored approval: %+v err=%v", approval, err)
	}
	observation, err := dataStore.GetSessionObservation(ctx, run.SessionID)
	if err != nil || observation == nil || observation.Generation != 4 || observation.LastSeq != 6 || observation.LastReply != "reply" || observation.SessionState != "failed" {
		t.Fatalf("unexpected observation: %+v err=%v", observation, err)
	}
	roomEvents, err := dataStore.ListAgentRoomEvents(ctx, store.AgentRoomEventQuery{SessionID: run.SessionID, Limit: 20})
	if err != nil || len(roomEvents) != 6 {
		t.Fatalf("unexpected Room events: %+v err=%v", roomEvents, err)
	}
	last := roomEvents[len(roomEvents)-1]
	if last.Kind != "observer.unknown" || strings.Contains(string(last.Payload), "must-not-persist") {
		t.Fatalf("unknown Runtime payload was not redacted: %+v", last)
	}
	state, ok, err := projector.ObservedSessionState(ctx, run.SessionID)
	if err != nil || !ok || state.Generation != 4 || state.LastSeq != 6 || state.Status != "failed" {
		t.Fatalf("unexpected observed Runtime state: %+v ok=%v err=%v", state, ok, err)
	}
	late := bridgeruntime.ObservedRuntimeEvent{EventID: "observed-7", Seq: 7, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, Type: "turn.started", Known: true}
	if err := projector.ApplyBatch(ctx, bridgeruntime.ObserverBatch{Events: []bridgeruntime.ObservedRuntimeEvent{late}}); err != nil {
		t.Fatal(err)
	}
	storedRun, _ = dataStore.GetAgentRun(ctx, run.RunID)
	if storedRun.Status != "failed" {
		t.Fatalf("late active event revived terminal Run: %+v", storedRun)
	}
	for _, event := range []bridgeruntime.ObservedRuntimeEvent{
		{EventID: "observed-8", Seq: 8, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, Type: "approval.resolved", ApprovalID: "approval-2", Decision: "rejected", Known: true},
		{EventID: "observed-9", Seq: 9, Generation: 4, Epoch: "epoch-1", SessionID: run.SessionID, Type: "approval.requested", ApprovalID: "approval-2", Known: true},
	} {
		if err := projector.ApplyBatch(ctx, bridgeruntime.ObserverBatch{Events: []bridgeruntime.ObservedRuntimeEvent{event}}); err != nil {
			t.Fatal(err)
		}
	}
	outOfOrder, err := dataStore.GetApprovalByID(ctx, "approval-2")
	if err != nil || outOfOrder == nil || outOfOrder.Status != "rejected" {
		t.Fatalf("late requested event reverted resolved approval: %+v err=%v", outOfOrder, err)
	}
}

func TestObserverProjectorReconcileIsRequiredForEpochChange(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	run := createCoordinatorRun(t, service, dataStore, "session-resync", "enqueue")
	projector := NewObserverProjector(dataStore)
	first := bridgeruntime.ObservedRuntimeEvent{EventID: "resync-1", Seq: 1, Generation: 3, Epoch: "epoch-1", SessionID: run.SessionID, Type: "turn.started", Known: true}
	if err := projector.ApplyBatch(ctx, bridgeruntime.ObserverBatch{Events: []bridgeruntime.ObservedRuntimeEvent{first}}); err != nil {
		t.Fatal(err)
	}
	if err := projector.ApplyBatch(ctx, bridgeruntime.ObserverBatch{ResyncRequired: true}); err != ErrObserverResyncRequired {
		t.Fatalf("expected explicit resync signal, got %v", err)
	}
	if err := projector.ReconcileSession(ctx, bridgeruntime.RuntimeSessionState{SessionID: run.SessionID, WorkspaceRoot: run.WorkDir, Status: "idle", LastSeq: 0, Generation: 4, ObservedAt: "2026-07-18T02:00:00Z"}, "epoch-2"); err != nil {
		t.Fatal(err)
	}
	cursor, ok, err := projector.LoadCursor(ctx, run.SessionID)
	if err != nil || !ok || cursor.Seq != 0 || cursor.Epoch != "epoch-2" {
		t.Fatalf("unexpected reconciled cursor: %+v ok=%v err=%v", cursor, ok, err)
	}
}
