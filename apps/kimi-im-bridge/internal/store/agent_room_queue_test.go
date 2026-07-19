package store

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestSessionQueueFIFOClaimFinalizeCancelAndFront(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	createQueueFixture(t, store, "session-1", "run-a", "run-b", "run-front")
	a, err := store.EnqueueSessionRun(ctx, "session-1", "run-a", false)
	if err != nil {
		t.Fatal(err)
	}
	b, err := store.EnqueueSessionRun(ctx, "session-1", "run-b", false)
	if err != nil {
		t.Fatal(err)
	}
	front, err := store.EnqueueSessionRun(ctx, "session-1", "run-front", true)
	if err != nil {
		t.Fatal(err)
	}
	if !(front.Position < a.Position && a.Position < b.Position) {
		t.Fatalf("unexpected queue positions: front=%d a=%d b=%d", front.Position, a.Position, b.Position)
	}
	duplicate, err := store.EnqueueSessionRun(ctx, "session-1", "run-a", false)
	if err != nil || duplicate.QueueID != a.QueueID {
		t.Fatalf("expected idempotent enqueue, got %+v, %v", duplicate, err)
	}
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	claimed, lease, err := store.ClaimNextSessionRun(ctx, "session-1", now, 30*time.Second)
	if err != nil || claimed == nil || claimed.RunID != "run-front" || lease == nil || lease.Owner != "run-front" {
		t.Fatalf("expected front run claim, got item=%+v lease=%+v err=%v", claimed, lease, err)
	}
	if next, _, err := store.ClaimNextSessionRun(ctx, "session-1", now, 30*time.Second); err != nil || next != nil {
		t.Fatalf("expected live lease to block next claim, got %+v, %v", next, err)
	}
	run, err := store.FinalizeSessionQueueClaim(ctx, claimed.QueueID, claimed.RunID)
	if err != nil || run.Status != "submitting" || run.QueuePosition != nil {
		t.Fatalf("expected finalized submitting run, got %+v, %v", run, err)
	}
	if released, err := store.ReleaseSessionLease(ctx, "session-1", "run-front"); err != nil || !released {
		t.Fatalf("release finalized run lease: %v, %v", released, err)
	}
	claimed, _, err = store.ClaimNextSessionRun(ctx, "session-1", now.Add(time.Second), 30*time.Second)
	if err != nil || claimed == nil || claimed.RunID != "run-a" {
		t.Fatalf("expected FIFO run-a, got %+v, %v", claimed, err)
	}
	if err := store.ReturnSessionQueueClaim(ctx, claimed.QueueID, claimed.RunID); err != nil {
		t.Fatal(err)
	}
	if cancelled, err := store.CancelQueuedRun(ctx, "run-a"); err != nil || !cancelled {
		t.Fatalf("expected queued cancellation, cancelled=%v err=%v", cancelled, err)
	}
	if _, err := store.EnqueueSessionRun(ctx, "session-1", "run-a", false); !errors.Is(err, ErrAgentRoomConflict) {
		t.Fatalf("terminal run must not be revived by enqueue, got %v", err)
	}
	items, err := store.ListSessionQueue(ctx, "session-1")
	if err != nil || len(items) != 1 || items[0].RunID != "run-b" {
		t.Fatalf("unexpected remaining queue: %+v, %v", items, err)
	}
}

func TestSessionQueueConcurrentPositionsLimitAndMissingSession(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	runIDs := make([]string, MaxSessionQueueDepth+1)
	for index := range runIDs {
		runIDs[index] = fmt.Sprintf("run-%02d", index)
	}
	createQueueFixture(t, store, "session-1", runIDs...)
	var wg sync.WaitGroup
	errs := make(chan error, 20)
	for _, runID := range runIDs[:20] {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := store.EnqueueSessionRun(ctx, "session-1", runID, false)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	items, err := store.ListSessionQueue(ctx, "session-1")
	if err != nil || len(items) != 20 {
		t.Fatalf("expected 20 concurrent queue items, got %d, %v", len(items), err)
	}
	positions := make([]int, len(items))
	for index, item := range items {
		positions[index] = item.Position
	}
	sort.Ints(positions)
	for index := 1; index < len(positions); index++ {
		if positions[index] == positions[index-1] {
			t.Fatalf("duplicate queue position %d", positions[index])
		}
	}
	for _, runID := range runIDs[20:MaxSessionQueueDepth] {
		if _, err := store.EnqueueSessionRun(ctx, "session-1", runID, false); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.EnqueueSessionRun(ctx, "session-1", runIDs[MaxSessionQueueDepth], false); !errors.Is(err, ErrSessionQueueFull) {
		t.Fatalf("expected queue limit error, got %v", err)
	}
	if _, err := store.CreateAgentRun(ctx, domain.AgentRun{RunID: "run-missing", RoomID: "room-queue", SourceMessageID: "message-queue", MemberID: "member-queue", OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "queued"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueSessionRun(ctx, "missing", "run-missing", false); !errors.Is(err, ErrAgentRoomNotFound) {
		t.Fatalf("expected missing session error, got %v", err)
	}
}

func TestSessionQueueConcurrentPositionsAcrossStoreHandles(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	first, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	createQueueFixture(t, first, "session-1", "run-a", "run-b")
	second, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	start := make(chan struct{})
	errs := make(chan error, 2)
	for index, candidate := range []*Store{first, second} {
		runID := []string{"run-a", "run-b"}[index]
		go func() {
			<-start
			_, err := candidate.EnqueueSessionRun(ctx, "session-1", runID, false)
			errs <- err
		}()
	}
	close(start)
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	items, err := first.ListSessionQueue(ctx, "session-1")
	if err != nil || len(items) != 2 || items[0].Position == items[1].Position {
		t.Fatalf("cross-handle queue allocation was not atomic: %+v, %v", items, err)
	}
}

func TestSessionQueueRestartRecoveryRequiresRuntimeReconcile(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	createQueueFixture(t, store, "session-1", "run-a")
	if _, err := store.EnqueueSessionRun(ctx, "session-1", "run-a", false); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	claimed, _, err := store.ClaimNextSessionRun(ctx, "session-1", now, time.Second)
	if err != nil || claimed == nil {
		t.Fatalf("claim failed: %+v, %v", claimed, err)
	}
	claims, err := store.ListClaimedSessionQueue(ctx)
	if err != nil || len(claims) != 1 || claims[0].RunID != "run-a" {
		t.Fatalf("expected claimed run to await runtime reconcile, got %+v, %v", claims, err)
	}
	items, err := store.ListSessionQueue(ctx, "session-1")
	if err != nil || len(items) != 1 || items[0].Status != "claimed" {
		t.Fatalf("store must not requeue without runtime evidence, got %+v, %v", items, err)
	}
	if err := store.ReturnSessionQueueClaim(ctx, claimed.QueueID, claimed.RunID); err != nil {
		t.Fatal(err)
	}
	reclaimed, _, err := store.ClaimNextSessionRun(ctx, "session-1", now.Add(2*time.Second), time.Second)
	if err != nil || reclaimed == nil || reclaimed.RunID != "run-a" {
		t.Fatalf("expected reclaimed run after restart recovery, got %+v, %v", reclaimed, err)
	}
}

func createQueueFixture(t *testing.T, store *Store, sessionID string, runIDs ...string) {
	t.Helper()
	ctx := context.Background()
	if err := store.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: sessionID, WorkDir: "D:/repo"}); err != nil {
		t.Fatal(err)
	}
	profile, err := store.CreateAgentProfile(ctx, domain.AgentProfile{AgentID: "agent-queue", Name: "Queue", RolePrompt: "", DefaultWorkDir: "D:/repo", SessionPolicy: domain.SessionPolicyPerRoom, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	room, err := store.CreateAgentRoom(ctx, domain.AgentRoom{RoomID: "room-queue", Title: "Queue", OrchestrationMode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	member, err := store.CreateAgentRoomMember(ctx, domain.AgentRoomMember{MemberID: "member-queue", RoomID: room.RoomID, MemberKind: "agent", AgentID: profile.AgentID, DisplayName: "Queue", SessionPolicy: domain.SessionPolicyPerRoom, FollowMode: "pin_session", Status: "idle"})
	if err != nil {
		t.Fatal(err)
	}
	message, err := store.CreateAgentRoomMessage(ctx, domain.AgentRoomMessage{MessageID: "message-queue", RoomID: room.RoomID, SenderKind: "user", Content: "queue"})
	if err != nil {
		t.Fatal(err)
	}
	for _, runID := range runIDs {
		if _, err := store.CreateAgentRun(ctx, domain.AgentRun{RunID: runID, RoomID: room.RoomID, SourceMessageID: message.MessageID, MemberID: member.MemberID, SessionID: sessionID, OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "queued"}); err != nil {
			t.Fatal(err)
		}
	}
}
