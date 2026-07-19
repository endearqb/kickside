package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

const (
	DefaultSessionLeaseTTL       = 30 * time.Second
	DefaultSessionLeaseHeartbeat = 10 * time.Second
)

func (s *Store) AcquireSessionLease(ctx context.Context, sessionID, owner string, now time.Time, ttl time.Duration) (domain.SessionLease, bool, error) {
	sessionID, owner = strings.TrimSpace(sessionID), strings.TrimSpace(owner)
	if sessionID == "" || owner == "" {
		return domain.SessionLease{}, false, errors.New("session id and lease owner are required")
	}
	if ttl <= 0 {
		return domain.SessionLease{}, false, errors.New("session lease ttl must be positive")
	}
	now = normalizedLeaseTime(now)
	expiresAt := now.Add(ttl).UTC().Format(time.RFC3339)
	result, err := s.db.ExecContext(ctx, `UPDATE bridge_sessions
		SET lease_owner = ?, lease_expires_at = ?, updated_at = ?
		WHERE kimi_session_id = ?
		  AND (
			ifnull(trim(lease_owner), '') = ''
			OR lease_expires_at IS NULL
			OR julianday(lease_expires_at) IS NULL
			OR julianday(lease_expires_at) <= julianday(?)
			OR lease_owner = ?
		  )`, owner, expiresAt, now.Format(time.RFC3339), sessionID, now.Format(time.RFC3339), owner)
	if err != nil {
		return domain.SessionLease{}, false, fmt.Errorf("failed to acquire session lease %s: %w", sessionID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.SessionLease{}, false, err
	}
	if affected == 0 {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM bridge_sessions WHERE kimi_session_id = ?`, sessionID).Scan(&exists); err != nil {
			return domain.SessionLease{}, false, err
		}
		if exists == 0 {
			return domain.SessionLease{}, false, ErrAgentRoomNotFound
		}
		return domain.SessionLease{}, false, nil
	}
	return domain.SessionLease{SessionID: sessionID, Owner: owner, ExpiresAt: expiresAt, AcquiredAt: now.Format(time.RFC3339)}, true, nil
}

func (s *Store) RenewSessionLease(ctx context.Context, sessionID, owner string, now time.Time, ttl time.Duration) (domain.SessionLease, bool, error) {
	sessionID, owner = strings.TrimSpace(sessionID), strings.TrimSpace(owner)
	if sessionID == "" || owner == "" || ttl <= 0 {
		return domain.SessionLease{}, false, errors.New("session id, owner, and positive ttl are required")
	}
	now = normalizedLeaseTime(now)
	expiresAt := now.Add(ttl).Format(time.RFC3339)
	result, err := s.db.ExecContext(ctx, `UPDATE bridge_sessions
		SET lease_expires_at = ?, updated_at = ?
		WHERE kimi_session_id = ? AND lease_owner = ?
		  AND julianday(lease_expires_at) > julianday(?)`, expiresAt, now.Format(time.RFC3339),
		sessionID, owner, now.Format(time.RFC3339))
	if err != nil {
		return domain.SessionLease{}, false, fmt.Errorf("failed to renew session lease %s: %w", sessionID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.SessionLease{}, false, err
	}
	if affected == 0 {
		return domain.SessionLease{}, false, nil
	}
	return domain.SessionLease{SessionID: sessionID, Owner: owner, ExpiresAt: expiresAt}, true, nil
}

func (s *Store) ReleaseSessionLease(ctx context.Context, sessionID, owner string) (bool, error) {
	result, err := s.db.ExecContext(ctx, `UPDATE bridge_sessions
		SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
		WHERE kimi_session_id = ? AND lease_owner = ?`, nowRFC3339(), strings.TrimSpace(sessionID), strings.TrimSpace(owner))
	if err != nil {
		return false, fmt.Errorf("failed to release session lease %s: %w", sessionID, err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

func (s *Store) CleanupExpiredSessionLeases(ctx context.Context, now time.Time) (int64, error) {
	now = normalizedLeaseTime(now)
	result, err := s.db.ExecContext(ctx, `UPDATE bridge_sessions
		SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
		WHERE ifnull(trim(lease_owner), '') <> ''
		  AND (lease_expires_at IS NULL OR julianday(lease_expires_at) IS NULL OR julianday(lease_expires_at) <= julianday(?))`,
		now.Format(time.RFC3339), now.Format(time.RFC3339))
	if err != nil {
		return 0, fmt.Errorf("failed to clean expired session leases: %w", err)
	}
	return result.RowsAffected()
}

func (s *Store) GetSessionLease(ctx context.Context, sessionID string, now time.Time) (*domain.SessionLease, error) {
	var owner, expiresAt string
	err := s.db.QueryRowContext(ctx, `SELECT ifnull(lease_owner, ''), ifnull(lease_expires_at, '')
		FROM bridge_sessions WHERE kimi_session_id = ?`, strings.TrimSpace(sessionID)).Scan(&owner, &expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrAgentRoomNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get session lease %s: %w", sessionID, err)
	}
	if strings.TrimSpace(owner) == "" || leaseExpired(expiresAt, now) {
		return nil, nil
	}
	return &domain.SessionLease{SessionID: strings.TrimSpace(sessionID), Owner: owner, ExpiresAt: expiresAt}, nil
}

func (s *Store) ListActiveSessionLeases(ctx context.Context, now time.Time) ([]domain.SessionLease, error) {
	now = normalizedLeaseTime(now)
	rows, err := s.db.QueryContext(ctx, `SELECT kimi_session_id, lease_owner, lease_expires_at
		FROM bridge_sessions
		WHERE ifnull(trim(lease_owner), '') <> ''
		  AND lease_expires_at IS NOT NULL
		  AND julianday(lease_expires_at) IS NOT NULL
		  AND julianday(lease_expires_at) > julianday(?)
		ORDER BY kimi_session_id`, now.Format(time.RFC3339))
	if err != nil {
		return nil, fmt.Errorf("failed to list active session leases: %w", err)
	}
	defer rows.Close()
	items := []domain.SessionLease{}
	for rows.Next() {
		var item domain.SessionLease
		if err := rows.Scan(&item.SessionID, &item.Owner, &item.ExpiresAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func leaseExpired(expiresAt string, now time.Time) bool {
	expires, err := time.Parse(time.RFC3339, strings.TrimSpace(expiresAt))
	return err != nil || !expires.After(now)
}

func normalizedLeaseTime(value time.Time) time.Time {
	if value.IsZero() {
		value = time.Now()
	}
	return value.UTC().Truncate(time.Second)
}
