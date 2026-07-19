package store

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestPaneSnapshotGenerationPersistsAcrossEmptySnapshotAndRestart(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	storeHandle, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	pane := domain.PaneSessionObservation{PaneID: "pane-1", PersistedSessionID: "session-old", ActiveSessionID: "session-active", EffectiveSessionID: "session-active", Visible: true, MountPolicy: "eager", LoadState: "ready"}
	ids, err := storeHandle.SyncPaneSessionObservations(ctx, 5, []domain.PaneSessionObservation{pane})
	if err != nil || len(ids) != 1 || ids[0] != "session-active" {
		t.Fatalf("initial sync: ids=%v err=%v", ids, err)
	}
	if _, err := storeHandle.SyncPaneSessionObservations(ctx, 5, []domain.PaneSessionObservation{pane}); err != nil {
		t.Fatalf("same generation/snapshot must be idempotent: %v", err)
	}
	changed := pane
	changed.Active = true
	if _, err := storeHandle.SyncPaneSessionObservations(ctx, 5, []domain.PaneSessionObservation{changed}); !errors.Is(err, ErrPaneGenerationConflict) {
		t.Fatalf("same generation with different payload must conflict, got %v", err)
	}
	if ids, err := storeHandle.SyncPaneSessionObservations(ctx, 6, nil); err != nil || len(ids) != 0 {
		t.Fatalf("empty snapshot must advance generation: ids=%v err=%v", ids, err)
	}
	if items, err := storeHandle.ListPaneSessionObservations(ctx); err != nil || len(items) != 0 {
		t.Fatalf("empty snapshot must delete stale panes: items=%v err=%v", items, err)
	}
	if err := storeHandle.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err := reopened.SyncPaneSessionObservations(ctx, 5, nil); !errors.Is(err, ErrPaneGenerationStale) {
		t.Fatalf("empty generation must survive restart, got %v", err)
	}
}

func TestPaneSnapshotRejectsOversizedAndInvalidEnumInputs(t *testing.T) {
	ctx := context.Background()
	storeHandle := openAgentRoomTestStore(t)
	panes := make([]domain.PaneSessionObservation, 13)
	for index := range panes {
		panes[index] = domain.PaneSessionObservation{PaneID: fmt.Sprintf("pane-%d", index), MountPolicy: "eager", LoadState: "ready"}
	}
	if _, err := storeHandle.SyncPaneSessionObservations(ctx, 1, panes); !errors.Is(err, ErrPaneObservationInvalid) {
		t.Fatalf("oversized snapshot must fail, got %v", err)
	}
	if _, err := storeHandle.SyncPaneSessionObservations(ctx, 1, []domain.PaneSessionObservation{{PaneID: "pane-1", MountPolicy: "unknown", LoadState: "ready"}}); !errors.Is(err, ErrPaneObservationInvalid) {
		t.Fatalf("invalid mount policy must fail, got %v", err)
	}
}

func TestObserverWatchSetAndRunResolutionUseExactReferences(t *testing.T) {
	ctx := context.Background()
	storeHandle := openAgentRoomTestStore(t)
	for _, sessionID := range []string{"session-pane", "session-member", "session-run", "session-approval", "session-pin"} {
		if err := storeHandle.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: sessionID, WorkDir: "D:/repo"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := storeHandle.SyncPaneSessionObservations(ctx, 1, []domain.PaneSessionObservation{{PaneID: "pane-1", EffectiveSessionID: "session-pane", ActiveSessionID: "session-pane"}}); err != nil {
		t.Fatal(err)
	}
	profile, err := storeHandle.CreateAgentProfile(ctx, domain.AgentProfile{AgentID: "agent-watch", Name: "Watch", RolePrompt: "watch", DefaultWorkDir: "D:/repo", SessionPolicy: domain.SessionPolicyPerRoom, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	room, err := storeHandle.CreateAgentRoom(ctx, domain.AgentRoom{RoomID: "room-watch", Title: "Watch", OrchestrationMode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	member, err := storeHandle.CreateAgentRoomMember(ctx, domain.AgentRoomMember{MemberID: "member-watch", RoomID: room.RoomID, MemberKind: "agent", AgentID: profile.AgentID, DisplayName: "Watch", SessionPolicy: domain.SessionPolicyPerRoom, FollowMode: "pin_session", EffectiveSessionID: "session-member", Status: "idle"})
	if err != nil {
		t.Fatal(err)
	}
	message, err := storeHandle.CreateAgentRoomMessage(ctx, domain.AgentRoomMessage{MessageID: "message-watch", RoomID: room.RoomID, SenderKind: "user", Content: "watch"})
	if err != nil {
		t.Fatal(err)
	}
	run, err := storeHandle.CreateAgentRun(ctx, domain.AgentRun{RunID: "run-watch", RoomID: room.RoomID, SourceMessageID: message.MessageID, MemberID: member.MemberID, AgentID: profile.AgentID, SessionID: "session-run", TurnID: "turn-watch", PromptID: "prompt-watch", OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "running"})
	if err != nil {
		t.Fatal(err)
	}
	approvalRun, err := storeHandle.CreateAgentRun(ctx, domain.AgentRun{RunID: "run-approval", RoomID: room.RoomID, SourceMessageID: message.MessageID, MemberID: member.MemberID, SessionID: "session-approval", OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	if err := storeHandle.CreateApprovalTicket(ctx, domain.ApprovalTicket{ApprovalID: "approval-watch", KimiSessionID: "session-approval", Platform: "agent_room", ChatID: room.RoomID, RequestKind: "tool", Prompt: "approve", Status: "pending", RequestPayloadJSON: `{}`, DedupeKey: "approval-watch", OriginKind: "agent_room", RoomID: room.RoomID, MemberID: member.MemberID, RunID: approvalRun.RunID}); err != nil {
		t.Fatal(err)
	}
	if _, err := storeHandle.PinSessionObservation(ctx, "session-pin"); err != nil {
		t.Fatal(err)
	}
	ids, err := storeHandle.ListAgentRoomWatchSessionIDs(ctx)
	want := []string{"session-approval", "session-member", "session-pane", "session-pin", "session-run"}
	if err != nil || !reflect.DeepEqual(ids, want) {
		t.Fatalf("unexpected watch set: got=%v want=%v err=%v", ids, want, err)
	}
	for _, query := range [][3]string{{run.RunID, "", ""}, {"", run.PromptID, ""}, {"", "", run.TurnID}, {"", "", ""}} {
		resolved, err := storeHandle.ResolveObservedAgentRun(ctx, "session-run", query[0], query[1], query[2])
		if err != nil || resolved == nil || resolved.RunID != run.RunID {
			t.Fatalf("failed run attribution for %v: run=%+v err=%v", query, resolved, err)
		}
	}
	if _, err := storeHandle.CreateAgentRun(ctx, domain.AgentRun{RunID: "run-watch-2", RoomID: room.RoomID, SourceMessageID: message.MessageID, MemberID: member.MemberID, SessionID: "session-run", OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "queued"}); err != nil {
		t.Fatal(err)
	}
	if resolved, err := storeHandle.ResolveObservedAgentRun(ctx, "session-run", "", "", ""); err != nil || resolved != nil {
		t.Fatalf("ambiguous active Runs must remain unmatched: run=%+v err=%v", resolved, err)
	}
}

func TestObservationPinsAreIdempotentDurableAndSessionBound(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	storeHandle, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := storeHandle.PinSessionObservation(ctx, "missing"); !errors.Is(err, ErrAgentRoomNotFound) {
		t.Fatalf("missing Session must not be pinned: %v", err)
	}
	if err := storeHandle.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1", WorkDir: "D:/repo"}); err != nil {
		t.Fatal(err)
	}
	if created, err := storeHandle.PinSessionObservation(ctx, "session-1"); err != nil || !created {
		t.Fatalf("pin Session: created=%v err=%v", created, err)
	}
	if created, err := storeHandle.PinSessionObservation(ctx, "session-1"); err != nil || created {
		t.Fatalf("duplicate pin must be idempotent: created=%v err=%v", created, err)
	}
	if err := storeHandle.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if pins, err := reopened.ListPinnedSessionObservations(ctx); err != nil || len(pins) != 1 || pins[0] != "session-1" {
		t.Fatalf("pin must survive restart: pins=%v err=%v", pins, err)
	}
	if deleted, err := reopened.UnpinSessionObservation(ctx, "session-1"); err != nil || !deleted {
		t.Fatalf("unpin: deleted=%v err=%v", deleted, err)
	}
	if deleted, err := reopened.UnpinSessionObservation(ctx, "session-1"); err != nil || deleted {
		t.Fatalf("duplicate unpin must be idempotent: deleted=%v err=%v", deleted, err)
	}
}

func TestApplySessionObservationBatchIsAtomicMonotonicAndDurable(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	storeHandle, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := storeHandle.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1", WorkDir: "D:/repo"}); err != nil {
		t.Fatal(err)
	}
	batch := SessionObservationBatch{
		Generation: 3, Epoch: "epoch-1", FirstSeq: 1, LastSeq: 1, LastEventAt: "2026-07-18T01:00:00Z",
		Observation: domain.SessionObservation{SessionID: "session-1", WorkDir: "D:/repo", SessionState: "running", ControlOrigin: "pane_manual", CurrentTurnID: "turn-1"},
		Events:      []domain.AgentRoomEvent{{EventID: "runtime-event-1", SessionID: "session-1", Kind: "run.started", Payload: []byte(`{"runtimeEventType":"turn.started"}`)}},
	}
	if duplicate, err := storeHandle.ApplySessionObservationBatch(ctx, batch); err != nil || duplicate {
		t.Fatalf("apply initial batch: duplicate=%v err=%v", duplicate, err)
	}
	if duplicate, err := storeHandle.ApplySessionObservationBatch(ctx, batch); err != nil || !duplicate {
		t.Fatalf("replay must be idempotent: duplicate=%v err=%v", duplicate, err)
	}
	gap := batch
	gap.FirstSeq, gap.LastSeq = 3, 3
	if _, err := storeHandle.ApplySessionObservationBatch(ctx, gap); !errors.Is(err, ErrObserverSequenceGap) {
		t.Fatalf("expected sequence gap, got %v", err)
	}
	wrongEpoch := batch
	wrongEpoch.Epoch, wrongEpoch.FirstSeq, wrongEpoch.LastSeq = "epoch-2", 2, 2
	if _, err := storeHandle.ApplySessionObservationBatch(ctx, wrongEpoch); !errors.Is(err, ErrObserverEpochConflict) {
		t.Fatalf("expected epoch conflict, got %v", err)
	}
	stale := batch
	stale.Generation, stale.FirstSeq, stale.LastSeq = 2, 2, 2
	if _, err := storeHandle.ApplySessionObservationBatch(ctx, stale); !errors.Is(err, ErrObserverCheckpointStale) {
		t.Fatalf("expected generation rejection, got %v", err)
	}
	conflict := batch
	conflict.FirstSeq, conflict.LastSeq = 2, 2
	conflict.Events[0].Kind = "run.status"
	if _, err := storeHandle.ApplySessionObservationBatch(ctx, conflict); !errors.Is(err, ErrAgentRoomConflict) {
		t.Fatalf("expected event conflict, got %v", err)
	}
	if seq, _, _, ok, err := storeHandle.GetSessionWatchCursor(ctx, "session-1"); err != nil || !ok || seq != 1 {
		t.Fatalf("failed transaction advanced cursor: seq=%d ok=%v err=%v", seq, ok, err)
	}
	reconciled := batch
	reconciled.Epoch, reconciled.FirstSeq, reconciled.LastSeq, reconciled.Reconciled, reconciled.Events = "epoch-2", 0, 0, true, nil
	reconciled.Observation.SessionState, reconciled.Observation.CurrentTurnID = "idle", ""
	if duplicate, err := storeHandle.ApplySessionObservationBatch(ctx, reconciled); err != nil || duplicate {
		t.Fatalf("reconcile new epoch: duplicate=%v err=%v", duplicate, err)
	}
	if err := storeHandle.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	observation, err := reopened.GetSessionObservation(ctx, "session-1")
	if err != nil || observation == nil || observation.Generation != 3 || observation.Epoch != "epoch-2" || observation.LastSeq != 0 {
		t.Fatalf("checkpoint did not survive restart: observation=%+v err=%v", observation, err)
	}
}

func TestObservationBatchDoesNotEraseExecutionIdentifiers(t *testing.T) {
	ctx := context.Background()
	storeHandle, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer storeHandle.Close()
	createQueueFixture(t, storeHandle, "session-preserve", "run-preserve")
	run, err := storeHandle.GetAgentRun(ctx, "run-preserve")
	if err != nil || run == nil {
		t.Fatalf("load Run: %+v %v", run, err)
	}
	run.TurnID, run.PromptID = "turn-execution", "prompt-execution"
	if _, err := storeHandle.UpdateAgentRun(ctx, *run); err != nil {
		t.Fatal(err)
	}
	staleProjection := *run
	staleProjection.TurnID, staleProjection.PromptID, staleProjection.Status = "", "", "completed"
	_, err = storeHandle.ApplySessionObservationBatch(ctx, SessionObservationBatch{
		Generation: 1, Epoch: "epoch-1", FirstSeq: 1, LastSeq: 1,
		Observation: domain.SessionObservation{SessionID: "session-preserve", SessionState: "completed", ControlOrigin: "agent_room"},
		Events:      []domain.AgentRoomEvent{{EventID: "event-preserve", SessionID: "session-preserve", RunID: run.RunID, Kind: "run.completed"}},
		Run:         &staleProjection,
	})
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := storeHandle.GetAgentRun(ctx, run.RunID)
	if stored == nil || stored.TurnID != "turn-execution" || stored.PromptID != "prompt-execution" || stored.Status != "completed" {
		t.Fatalf("observer erased newer execution identifiers: %+v", stored)
	}
}
