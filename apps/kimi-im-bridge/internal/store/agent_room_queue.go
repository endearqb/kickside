package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

const MaxSessionQueueDepth = 50

var ErrSessionQueueFull = errors.New("session prompt queue is full")

func (s *Store) EnqueueSessionRun(ctx context.Context, sessionID, runID string, front bool) (item domain.SessionPromptQueueItem, err error) {
	sessionID, runID = strings.TrimSpace(sessionID), strings.TrimSpace(runID)
	if sessionID == "" || runID == "" {
		return item, errors.New("session id and run id are required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return item, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	// Take the SQLite writer reservation before any reads so two Store handles
	// wait through busy_timeout instead of racing a deferred read->write upgrade.
	if _, err = tx.ExecContext(ctx, `UPDATE bridge_sessions SET updated_at = updated_at WHERE kimi_session_id = ?`, sessionID); err != nil {
		return item, err
	}
	if existing, getErr := getSessionQueueItemByRun(ctx, tx, runID); getErr != nil {
		return item, getErr
	} else if existing != nil {
		if existing.SessionID != sessionID {
			return item, fmt.Errorf("%w: run is already queued for another session", ErrAgentRoomConflict)
		}
		if err = tx.Commit(); err != nil {
			return item, err
		}
		return *existing, nil
	}
	var runSessionID, runStatus string
	if err = tx.QueryRowContext(ctx, `SELECT ifnull(session_id, ''), status FROM agent_runs WHERE run_id = ?`, runID).Scan(&runSessionID, &runStatus); errors.Is(err, sql.ErrNoRows) {
		return item, ErrAgentRoomNotFound
	} else if err != nil {
		return item, err
	}
	if runSessionID != "" && runSessionID != sessionID {
		return item, fmt.Errorf("%w: run session does not match queue session", ErrAgentRoomConflict)
	}
	if runStatus != "queued" && runStatus != "resolving_session" {
		return item, fmt.Errorf("%w: run status %s cannot be queued", ErrAgentRoomConflict, runStatus)
	}
	var sessionExists int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM bridge_sessions WHERE kimi_session_id = ?`, sessionID).Scan(&sessionExists); err != nil {
		return item, err
	}
	if sessionExists == 0 {
		return item, ErrAgentRoomNotFound
	}
	positionExpr := `coalesce((SELECT max(position) + 1 FROM session_prompt_queue WHERE session_id = ?), 1)`
	if front {
		positionExpr = `coalesce((SELECT min(position) - 1 FROM session_prompt_queue WHERE session_id = ?), 0)`
	}
	now := nowRFC3339()
	item = domain.SessionPromptQueueItem{QueueID: uuid.NewString(), SessionID: sessionID, RunID: runID, Status: "queued", CreatedAt: now, UpdatedAt: now}
	result, err := tx.ExecContext(ctx, `INSERT INTO session_prompt_queue (
		queue_id, session_id, run_id, position, status, created_at, updated_at
	) SELECT ?, ?, ?, `+positionExpr+`, 'queued', ?, ?
	  WHERE (SELECT count(*) FROM session_prompt_queue WHERE session_id = ?) < ?`,
		item.QueueID, sessionID, runID, sessionID, now, now, sessionID, MaxSessionQueueDepth)
	if err != nil {
		return item, fmt.Errorf("failed to enqueue run %s: %w", runID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return item, err
	}
	if affected == 0 {
		return item, ErrSessionQueueFull
	}
	if err = tx.QueryRowContext(ctx, `SELECT position FROM session_prompt_queue WHERE queue_id = ?`, item.QueueID).Scan(&item.Position); err != nil {
		return item, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE agent_runs SET session_id = ?, status = 'queued', queue_position = ?, updated_at = ? WHERE run_id = ?`,
		sessionID, item.Position, now, runID); err != nil {
		return item, err
	}
	if err = tx.Commit(); err != nil {
		return item, err
	}
	return item, nil
}

func (s *Store) ListSessionQueue(ctx context.Context, sessionID string) ([]domain.SessionPromptQueueItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT queue_id, session_id, run_id, position, status, created_at, updated_at
		FROM session_prompt_queue WHERE session_id = ? ORDER BY position, created_at, queue_id`, strings.TrimSpace(sessionID))
	if err != nil {
		return nil, fmt.Errorf("failed to list session queue: %w", err)
	}
	defer rows.Close()
	items := []domain.SessionPromptQueueItem{}
	for rows.Next() {
		var item domain.SessionPromptQueueItem
		if err := rows.Scan(&item.QueueID, &item.SessionID, &item.RunID, &item.Position, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) SessionQueueDepth(ctx context.Context, sessionID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM session_prompt_queue WHERE session_id = ?`, strings.TrimSpace(sessionID)).Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to count session queue: %w", err)
	}
	return count, nil
}

func (s *Store) ListQueuedSessionIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT q.session_id
		FROM session_prompt_queue q JOIN agent_runs r ON r.run_id = q.run_id
		WHERE q.status = 'queued' AND r.status = 'queued' ORDER BY q.session_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list queued sessions: %w", err)
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var sessionID string
		if err := rows.Scan(&sessionID); err != nil {
			return nil, err
		}
		items = append(items, sessionID)
	}
	return items, rows.Err()
}

func (s *Store) ClaimNextSessionRun(ctx context.Context, sessionID string, now time.Time, ttl time.Duration) (item *domain.SessionPromptQueueItem, lease *domain.SessionLease, err error) {
	now = normalizedLeaseTime(now)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if _, err = tx.ExecContext(ctx, `UPDATE bridge_sessions SET updated_at = updated_at WHERE kimi_session_id = ?`, strings.TrimSpace(sessionID)); err != nil {
		return nil, nil, err
	}
	var queued domain.SessionPromptQueueItem
	err = tx.QueryRowContext(ctx, `SELECT q.queue_id, q.session_id, q.run_id, q.position, q.status, q.created_at, q.updated_at
		FROM session_prompt_queue q JOIN agent_runs r ON r.run_id = q.run_id
		WHERE q.session_id = ? AND q.status = 'queued' AND r.status = 'queued'
		ORDER BY q.position, q.created_at, q.queue_id LIMIT 1`, strings.TrimSpace(sessionID)).Scan(&queued.QueueID,
		&queued.SessionID, &queued.RunID, &queued.Position, &queued.Status, &queued.CreatedAt, &queued.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		_ = tx.Rollback()
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if ttl <= 0 {
		return nil, nil, errors.New("session lease ttl must be positive")
	}
	expiresAt := now.Add(ttl).Format(time.RFC3339)
	result, err := tx.ExecContext(ctx, `UPDATE bridge_sessions
		SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
		WHERE kimi_session_id = ? AND (
			ifnull(trim(lease_owner), '') = '' OR lease_expires_at IS NULL OR julianday(lease_expires_at) IS NULL
			OR julianday(lease_expires_at) <= julianday(?) OR lease_owner = ?
		)`, queued.RunID, expiresAt, now.Format(time.RFC3339), queued.SessionID, now.Format(time.RFC3339), queued.RunID)
	if err != nil {
		return nil, nil, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return nil, nil, err
	}
	if affected == 0 {
		if err = tx.Commit(); err != nil {
			return nil, nil, err
		}
		return nil, nil, nil
	}
	queued.Status = "claimed"
	queued.UpdatedAt = now.Format(time.RFC3339)
	if _, err = tx.ExecContext(ctx, `UPDATE session_prompt_queue SET status = 'claimed', updated_at = ? WHERE queue_id = ? AND status = 'queued'`, queued.UpdatedAt, queued.QueueID); err != nil {
		return nil, nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE agent_runs SET status = 'waiting_for_lease', updated_at = ? WHERE run_id = ?`, queued.UpdatedAt, queued.RunID); err != nil {
		return nil, nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, nil, err
	}
	return &queued, &domain.SessionLease{SessionID: queued.SessionID, Owner: queued.RunID, ExpiresAt: expiresAt, AcquiredAt: now.Format(time.RFC3339)}, nil
}

func (s *Store) FinalizeSessionQueueClaim(ctx context.Context, queueID, owner string) (run domain.AgentRun, err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return run, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var runID, sessionID string
	err = tx.QueryRowContext(ctx, `SELECT run_id, session_id FROM session_prompt_queue WHERE queue_id = ? AND status = 'claimed'`, queueID).Scan(&runID, &sessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return run, ErrAgentRoomNotFound
	}
	if err != nil {
		return run, err
	}
	if runID != strings.TrimSpace(owner) {
		return run, ErrAgentRoomConflict
	}
	var leaseOwner string
	if err = tx.QueryRowContext(ctx, `SELECT ifnull(lease_owner, '') FROM bridge_sessions WHERE kimi_session_id = ?`, sessionID).Scan(&leaseOwner); err != nil {
		return run, err
	}
	if leaseOwner != runID {
		return run, ErrAgentRoomConflict
	}
	now := nowRFC3339()
	if _, err = tx.ExecContext(ctx, `DELETE FROM session_prompt_queue WHERE queue_id = ? AND status = 'claimed'`, queueID); err != nil {
		return run, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE agent_runs SET status = 'submitting', queue_position = NULL,
		started_at = coalesce(started_at, ?), updated_at = ? WHERE run_id = ?`, now, now, runID); err != nil {
		return run, err
	}
	run, err = scanAgentRun(tx.QueryRowContext(ctx, agentRunSelect+` WHERE run_id = ?`, runID))
	if err != nil {
		return run, err
	}
	if err = tx.Commit(); err != nil {
		return run, err
	}
	return run, nil
}

func (s *Store) ReturnSessionQueueClaim(ctx context.Context, queueID, owner string) error {
	return s.returnSessionQueueClaim(ctx, queueID, owner)
}

func (s *Store) CancelQueuedRun(ctx context.Context, runID string) (bool, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `DELETE FROM session_prompt_queue WHERE run_id = ? AND status = 'queued'`, strings.TrimSpace(runID))
	if err != nil {
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil || affected == 0 {
		return false, err
	}
	now := nowRFC3339()
	if _, err := tx.ExecContext(ctx, `UPDATE agent_runs SET status = 'aborted', queue_position = NULL,
		completed_at = ?, updated_at = ? WHERE run_id = ?`, now, now, strings.TrimSpace(runID)); err != nil {
		return false, err
	}
	return true, tx.Commit()
}

func (s *Store) ListClaimedSessionQueue(ctx context.Context) ([]domain.SessionPromptQueueItem, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT queue_id, session_id, run_id, position, status, created_at, updated_at
		FROM session_prompt_queue WHERE status = 'claimed' ORDER BY session_id, position, created_at, queue_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.SessionPromptQueueItem{}
	for rows.Next() {
		var item domain.SessionPromptQueueItem
		if err := rows.Scan(&item.QueueID, &item.SessionID, &item.RunID, &item.Position, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) returnSessionQueueClaim(ctx context.Context, queueID, owner string) (err error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	var runID, sessionID string
	err = tx.QueryRowContext(ctx, `SELECT run_id, session_id FROM session_prompt_queue WHERE queue_id = ? AND status = 'claimed'`, queueID).Scan(&runID, &sessionID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrAgentRoomNotFound
	}
	if err != nil {
		return err
	}
	if runID != strings.TrimSpace(owner) {
		return ErrAgentRoomConflict
	}
	now := nowRFC3339()
	_, err = tx.ExecContext(ctx, `UPDATE session_prompt_queue SET status = 'queued', updated_at = ? WHERE queue_id = ?`, now, queueID)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE bridge_sessions SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
		WHERE kimi_session_id = ? AND lease_owner = ?`, now, sessionID, owner); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE agent_runs SET status = 'queued', updated_at = ? WHERE run_id = ?`, now, runID); err != nil {
		return err
	}
	return tx.Commit()
}

func getSessionQueueItemByRun(ctx context.Context, tx *sql.Tx, runID string) (*domain.SessionPromptQueueItem, error) {
	var item domain.SessionPromptQueueItem
	err := tx.QueryRowContext(ctx, `SELECT queue_id, session_id, run_id, position, status, created_at, updated_at
		FROM session_prompt_queue WHERE run_id = ?`, runID).Scan(&item.QueueID, &item.SessionID, &item.RunID,
		&item.Position, &item.Status, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}
