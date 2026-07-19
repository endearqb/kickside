package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"

	_ "modernc.org/sqlite"
)

func TestSessionLeaseOwnerRenewReleaseAndExpiry(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	if err := store.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1"}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	lease, acquired, err := store.AcquireSessionLease(ctx, "session-1", "run-a", now, 30*time.Second)
	if err != nil || !acquired || lease.Owner != "run-a" {
		t.Fatalf("expected first lease acquisition, got %+v acquired=%v err=%v", lease, acquired, err)
	}
	if _, acquired, err := store.AcquireSessionLease(ctx, "session-1", "run-b", now.Add(time.Second), 30*time.Second); err != nil || acquired {
		t.Fatalf("different owner acquired live lease: acquired=%v err=%v", acquired, err)
	}
	renewed, ok, err := store.RenewSessionLease(ctx, "session-1", "run-a", now.Add(10*time.Second), 30*time.Second)
	if err != nil || !ok || renewed.ExpiresAt != now.Add(40*time.Second).Format(time.RFC3339) {
		t.Fatalf("expected owner renewal, got %+v ok=%v err=%v", renewed, ok, err)
	}
	if released, err := store.ReleaseSessionLease(ctx, "session-1", "run-b"); err != nil || released {
		t.Fatalf("non-owner released lease: released=%v err=%v", released, err)
	}
	if released, err := store.ReleaseSessionLease(ctx, "session-1", "run-a"); err != nil || !released {
		t.Fatalf("owner release failed: released=%v err=%v", released, err)
	}
	if _, acquired, err := store.AcquireSessionLease(ctx, "session-1", "run-b", now.Add(11*time.Second), time.Second); err != nil || !acquired {
		t.Fatalf("expected acquisition after release: acquired=%v err=%v", acquired, err)
	}
	cleaned, err := store.CleanupExpiredSessionLeases(ctx, now.Add(13*time.Second))
	if err != nil || cleaned != 1 {
		t.Fatalf("expected one expired lease cleanup, cleaned=%d err=%v", cleaned, err)
	}
	if lease, err := store.GetSessionLease(ctx, "session-1", now.Add(13*time.Second)); err != nil || lease != nil {
		t.Fatalf("expected no current lease, got %+v err=%v", lease, err)
	}
}

func TestSessionLeaseAcquireIsAtomicAcrossGoroutines(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	if err := store.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1"}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	var acquired atomic.Int64
	var wg sync.WaitGroup
	for index := range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, ok, err := store.AcquireSessionLease(ctx, "session-1", "run-"+string(rune('a'+index)), now, 30*time.Second)
			if err != nil {
				t.Errorf("AcquireSessionLease returned error: %v", err)
				return
			}
			if ok {
				acquired.Add(1)
			}
		}()
	}
	wg.Wait()
	if got := acquired.Load(); got != 1 {
		t.Fatalf("expected exactly one lease owner, got %d", got)
	}
}

func TestSessionLeaseAcquireIsAtomicAcrossStoreHandles(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	first, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err := first.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1"}); err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan bool, 2)
	errs := make(chan error, 2)
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	for index, candidate := range []*Store{first, second} {
		go func() {
			<-start
			_, ok, err := candidate.AcquireSessionLease(ctx, "session-1", "run-"+string(rune('a'+index)), now, 30*time.Second)
			results <- ok
			errs <- err
		}()
	}
	close(start)
	wins := 0
	for range 2 {
		if <-results {
			wins++
		}
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	if wins != 1 {
		t.Fatalf("expected one cross-handle lease owner, got %d", wins)
	}
}

func TestSessionLeaseInvalidExpiryCanBeTakenOverAndCleaned(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	if err := store.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE bridge_sessions SET lease_owner = 'broken', lease_expires_at = 'not-a-time' WHERE kimi_session_id = 'session-1'`); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 18, 12, 0, 0, 0, time.UTC)
	if _, ok, err := store.AcquireSessionLease(ctx, "session-1", "run-a", now, 30*time.Second); err != nil || !ok {
		t.Fatalf("invalid expiry must not lock a session forever: ok=%v err=%v", ok, err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE bridge_sessions SET lease_owner = 'broken', lease_expires_at = 'not-a-time' WHERE kimi_session_id = 'session-1'`); err != nil {
		t.Fatal(err)
	}
	if cleaned, err := store.CleanupExpiredSessionLeases(ctx, now); err != nil || cleaned != 1 {
		t.Fatalf("invalid expiry cleanup failed: cleaned=%d err=%v", cleaned, err)
	}
}

func TestSessionLeaseWaitsForSQLiteBusyWriter(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "bridge.db")
	store, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1"}); err != nil {
		t.Fatal(err)
	}
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	raw.SetMaxOpenConns(1)
	if _, err := raw.Exec(`PRAGMA busy_timeout = 1000; BEGIN IMMEDIATE; UPDATE bridge_sessions SET summary = 'locked' WHERE kimi_session_id = 'session-1';`); err != nil {
		t.Fatal(err)
	}
	released := make(chan struct{})
	go func() {
		time.Sleep(40 * time.Millisecond)
		_, _ = raw.Exec(`COMMIT`)
		close(released)
	}()
	_, acquired, err := store.AcquireSessionLease(ctx, "session-1", "run-a", time.Now(), 30*time.Second)
	<-released
	if err != nil || !acquired {
		t.Fatalf("expected busy_timeout retry to recover, acquired=%v err=%v", acquired, err)
	}
}
