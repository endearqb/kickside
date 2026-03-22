package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/migrations"
)

const userVersion = 11

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("failed to create db directory for %s: %w", path, err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database %s: %w", path, err)
	}
	store := &Store{db: db}
	if err := store.initialize(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) initialize() error {
	pragmas := []string{
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA journal_mode = WAL;",
	}
	for _, pragma := range pragmas {
		if _, err := s.db.Exec(pragma); err != nil {
			return fmt.Errorf("failed to apply pragma %q: %w", pragma, err)
		}
	}

	currentVersion, err := s.UserVersion(context.Background())
	if err != nil {
		return err
	}
	ordered, err := migrations.Ordered()
	if err != nil {
		return err
	}
	for _, migration := range ordered {
		if migration.Version <= currentVersion {
			continue
		}
		if _, err := s.db.Exec(migration.SQL); err != nil {
			return fmt.Errorf("failed to apply migration %s: %w", migration.Name, err)
		}
	}
	return nil
}

func (s *Store) UserVersion(ctx context.Context) (int, error) {
	var version int
	if err := s.db.QueryRowContext(ctx, "PRAGMA user_version;").Scan(&version); err != nil {
		return 0, fmt.Errorf("failed to query user_version: %w", err)
	}
	return version, nil
}

func (s *Store) JournalMode(ctx context.Context) (string, error) {
	var mode string
	if err := s.db.QueryRowContext(ctx, "PRAGMA journal_mode;").Scan(&mode); err != nil {
		return "", fmt.Errorf("failed to query journal_mode: %w", err)
	}
	return strings.ToLower(mode), nil
}

func (s *Store) SyncConfiguredChannels(ctx context.Context, connectors []config.ConnectorConfig) error {
	now := nowRFC3339()
	for _, connector := range connectors {
		connectorID := strings.TrimSpace(connector.ID)
		if connectorID == "" {
			connectorID = strings.TrimSpace(connector.Platform)
		}
		if connector.Platform == "" || connectorID == "" {
			continue
		}
		_, err := s.db.ExecContext(
			ctx,
			`INSERT INTO bridge_channels (
				channel_id, platform, enabled, account_id, state, last_offset, last_error, last_heartbeat_at,
				last_inbound_at, last_outbound_at, created_at, updated_at
			) VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
			ON CONFLICT(channel_id) DO UPDATE SET
				platform=excluded.platform,
				enabled=excluded.enabled,
				state=excluded.state,
				updated_at=excluded.updated_at`,
			connectorID,
			connector.Platform,
			boolToInt(connector.Enabled),
			domain.ChannelStateIdle,
			now,
			now,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert channel %s: %w", connectorID, err)
		}
	}
	return nil
}

func (s *Store) ListChannelStatuses(ctx context.Context) ([]domain.ChannelStatus, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT channel_id, platform, enabled, state, last_heartbeat_at, last_inbound_at, last_outbound_at, last_offset, last_error,
		        ifnull(last_ready_at, ''), ifnull(last_failure_at, ''), ifnull(last_failure_operation, ''),
		        ifnull(last_failure_retryable, 0), ifnull(consecutive_failures, 0), ifnull(next_retry_at, ''),
		        ifnull(last_recovery_at, ''), ifnull(recovery_hint, '')
		 FROM bridge_channels
		 ORDER BY platform, channel_id`,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list channel statuses: %w", err)
	}
	defer rows.Close()

	statuses := []domain.ChannelStatus{}
	for rows.Next() {
		var status domain.ChannelStatus
		var enabled int
		var heartbeatAt sql.NullString
		var lastInboundAt sql.NullString
		var lastOutboundAt sql.NullString
		var lastOffset sql.NullString
		var rawError sql.NullString
		var lastReadyAt sql.NullString
		var lastFailureAt sql.NullString
		var lastFailureOperation sql.NullString
		var lastFailureRetryable int
		var consecutiveFailures int
		var nextRetryAt sql.NullString
		var lastRecoveryAt sql.NullString
		var recoveryHint sql.NullString
		if err := rows.Scan(
			&status.ConnectorID,
			&status.Platform,
			&enabled,
			&status.State,
			&heartbeatAt,
			&lastInboundAt,
			&lastOutboundAt,
			&lastOffset,
			&rawError,
			&lastReadyAt,
			&lastFailureAt,
			&lastFailureOperation,
			&lastFailureRetryable,
			&consecutiveFailures,
			&nextRetryAt,
			&lastRecoveryAt,
			&recoveryHint,
		); err != nil {
			return nil, fmt.Errorf("failed to scan channel status: %w", err)
		}
		status.Enabled = enabled == 1
		status.LastHeartbeatAt = nullStringValue(heartbeatAt)
		status.LastInboundAt = nullStringValue(lastInboundAt)
		status.LastOutboundAt = nullStringValue(lastOutboundAt)
		status.LastOffset = nullStringValue(lastOffset)
		_ = nullStringValue(heartbeatAt)
		status.LastErrorCode, status.LastError = decodeChannelError(nullStringValue(rawError))
		status.LastReadyAt = nullStringValue(lastReadyAt)
		status.LastFailureAt = nullStringValue(lastFailureAt)
		status.LastFailureOperation = nullStringValue(lastFailureOperation)
		status.LastFailureRetryable = lastFailureRetryable == 1
		status.ConsecutiveFailures = consecutiveFailures
		status.NextRetryAt = nullStringValue(nextRetryAt)
		status.LastRecoveryAt = nullStringValue(lastRecoveryAt)
		status.RecoveryHint = nullStringValue(recoveryHint)
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate channel statuses: %w", err)
	}
	return statuses, nil
}

func (s *Store) UpdateChannelState(
	ctx context.Context,
	connectorID string,
	state domain.ChannelRuntimeState,
	lastErrorCode string,
	lastError string,
) error {
	return s.UpdateChannelDiagnostics(ctx, connectorID, domain.ChannelDiagnosticsUpdate{
		State:         state,
		LastErrorCode: lastErrorCode,
		LastError:     lastError,
	})
}

func (s *Store) UpdateChannelDiagnostics(
	ctx context.Context,
	connectorID string,
	update domain.ChannelDiagnosticsUpdate,
) error {
	connectorID = s.resolveChannelID(ctx, connectorID)
	now := nowRFC3339()
	setClauses := []string{
		"state = ?",
		"last_error = ?",
		"updated_at = ?",
	}
	args := []any{
		update.State,
		nullIfEmpty(encodeChannelError(update.LastErrorCode, update.LastError)),
		now,
	}

	if update.LastReadyAt != nil {
		setClauses = append(setClauses, "last_ready_at = ?")
		args = append(args, nullIfEmpty(strings.TrimSpace(*update.LastReadyAt)))
	}
	if update.LastFailureAt != nil {
		setClauses = append(setClauses, "last_failure_at = ?")
		args = append(args, nullIfEmpty(strings.TrimSpace(*update.LastFailureAt)))
	}
	if update.LastFailureOperation != nil {
		setClauses = append(setClauses, "last_failure_operation = ?")
		args = append(args, nullIfEmpty(strings.TrimSpace(*update.LastFailureOperation)))
	}
	if update.LastFailureRetryable != nil {
		setClauses = append(setClauses, "last_failure_retryable = ?")
		args = append(args, boolToInt(*update.LastFailureRetryable))
	}
	if update.ConsecutiveFailures != nil {
		setClauses = append(setClauses, "consecutive_failures = ?")
		args = append(args, *update.ConsecutiveFailures)
	}
	if update.NextRetryAt != nil {
		setClauses = append(setClauses, "next_retry_at = ?")
		args = append(args, nullIfEmpty(strings.TrimSpace(*update.NextRetryAt)))
	}
	if update.LastRecoveryAt != nil {
		setClauses = append(setClauses, "last_recovery_at = ?")
		args = append(args, nullIfEmpty(strings.TrimSpace(*update.LastRecoveryAt)))
	}
	if update.RecoveryHint != nil {
		setClauses = append(setClauses, "recovery_hint = ?")
		args = append(args, nullIfEmpty(strings.TrimSpace(*update.RecoveryHint)))
	}

	args = append(args, connectorID)
	query := fmt.Sprintf(
		`UPDATE bridge_channels
		 SET %s
		 WHERE channel_id = ?`,
		strings.Join(setClauses, ", "),
	)
	_, err := s.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update channel state for %s: %w", connectorID, err)
	}
	return nil
}

func (s *Store) UpdateChannelOffset(ctx context.Context, connectorID string, offsetKind string, offsetValue string) error {
	connectorID = s.resolveChannelID(ctx, connectorID)
	if err := s.UpsertOffset(ctx, connectorID, offsetKind, offsetValue); err != nil {
		return err
	}
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE bridge_channels
		 SET last_offset = ?, updated_at = ?
		 WHERE channel_id = ?`,
		nullIfEmpty(offsetValue),
		nowRFC3339(),
		connectorID,
	)
	if err != nil {
		return fmt.Errorf("failed to update channel status offset for %s: %w", connectorID, err)
	}
	return nil
}

func (s *Store) TouchChannelInbound(ctx context.Context, connectorID string, at string) error {
	connectorID = s.resolveChannelID(ctx, connectorID)
	if at == "" {
		at = nowRFC3339()
	}
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE bridge_channels
		 SET last_inbound_at = ?, updated_at = ?
		 WHERE channel_id = ?`,
		at,
		nowRFC3339(),
		connectorID,
	)
	if err != nil {
		return fmt.Errorf("failed to touch inbound channel activity for %s: %w", connectorID, err)
	}
	return nil
}

func (s *Store) TouchChannelOutbound(ctx context.Context, connectorID string, at string) error {
	connectorID = s.resolveChannelID(ctx, connectorID)
	if at == "" {
		at = nowRFC3339()
	}
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE bridge_channels
		 SET last_outbound_at = ?, updated_at = ?
		 WHERE channel_id = ?`,
		at,
		nowRFC3339(),
		connectorID,
	)
	if err != nil {
		return fmt.Errorf("failed to touch outbound channel activity for %s: %w", connectorID, err)
	}
	return nil
}

func (s *Store) UpsertOffset(ctx context.Context, channelID string, offsetKind string, offsetValue string) error {
	channelID = s.resolveChannelID(ctx, channelID)
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO channel_offsets (channel_id, offset_kind, offset_value, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(channel_id, offset_kind) DO UPDATE SET
		   offset_value=excluded.offset_value,
		   updated_at=excluded.updated_at`,
		channelID,
		offsetKind,
		offsetValue,
		nowRFC3339(),
	)
	if err != nil {
		return fmt.Errorf("failed to upsert offset for %s/%s: %w", channelID, offsetKind, err)
	}
	return nil
}

func (s *Store) GetOffset(ctx context.Context, channelID string, offsetKind string) (string, bool, error) {
	channelID = s.resolveChannelID(ctx, channelID)
	var value string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT offset_value FROM channel_offsets WHERE channel_id = ? AND offset_kind = ?`,
		channelID,
		offsetKind,
	).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("failed to get offset for %s/%s: %w", channelID, offsetKind, err)
	}
	return value, true, nil
}

func (s *Store) UpsertSession(ctx context.Context, session domain.BridgeSession) error {
	if session.KimiSessionID == "" {
		return fmt.Errorf("kimi session id is required")
	}
	now := nowRFC3339()
	if session.CreatedAt == "" {
		session.CreatedAt = now
	}
	session.UpdatedAt = now
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO bridge_sessions (
			kimi_session_id, work_dir, last_turn_id, last_message_at, summary, session_state, lease_owner,
			lease_expires_at, auto_approve, provider_name, runtime_metadata_json, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(kimi_session_id) DO UPDATE SET
			work_dir=excluded.work_dir,
			last_turn_id=excluded.last_turn_id,
			last_message_at=excluded.last_message_at,
			summary=excluded.summary,
			session_state=excluded.session_state,
			lease_owner=excluded.lease_owner,
			lease_expires_at=excluded.lease_expires_at,
			auto_approve=excluded.auto_approve,
			provider_name=excluded.provider_name,
			runtime_metadata_json=excluded.runtime_metadata_json,
			updated_at=excluded.updated_at`,
		session.KimiSessionID,
		nullIfEmpty(session.WorkDir),
		nullIfEmpty(session.LastTurnID),
		nullIfEmpty(session.LastMessageAt),
		nullIfEmpty(session.Summary),
		nullIfEmpty(session.SessionState),
		nullIfEmpty(session.LeaseOwner),
		nullIfEmpty(session.LeaseExpiresAt),
		boolToInt(session.AutoApprove),
		nullIfEmpty(session.ProviderName),
		nullIfEmpty(session.RuntimeMetadataJSON),
		session.CreatedAt,
		session.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert bridge session %s: %w", session.KimiSessionID, err)
	}
	return nil
}

func (s *Store) ListSessions(ctx context.Context) ([]domain.BridgeSession, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT kimi_session_id, ifnull(work_dir, ''), ifnull(last_turn_id, ''), ifnull(last_message_at, ''),
		        ifnull(summary, ''), ifnull(session_state, ''), ifnull(lease_owner, ''), ifnull(lease_expires_at, ''),
		        ifnull(auto_approve, 0), ifnull(provider_name, ''), ifnull(runtime_metadata_json, ''), created_at, updated_at
		 FROM bridge_sessions
		 ORDER BY ifnull(last_message_at, updated_at) DESC, updated_at DESC, kimi_session_id DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list bridge sessions: %w", err)
	}
	defer rows.Close()

	sessions := []domain.BridgeSession{}
	for rows.Next() {
		var session domain.BridgeSession
		var autoApprove int
		if err := rows.Scan(
			&session.KimiSessionID,
			&session.WorkDir,
			&session.LastTurnID,
			&session.LastMessageAt,
			&session.Summary,
			&session.SessionState,
			&session.LeaseOwner,
			&session.LeaseExpiresAt,
			&autoApprove,
			&session.ProviderName,
			&session.RuntimeMetadataJSON,
			&session.CreatedAt,
			&session.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan bridge session: %w", err)
		}
		session.AutoApprove = autoApprove == 1
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate bridge sessions: %w", err)
	}
	return sessions, nil
}

func (s *Store) GetSessionByID(ctx context.Context, kimiSessionID string) (*domain.BridgeSession, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT kimi_session_id, ifnull(work_dir, ''), ifnull(last_turn_id, ''), ifnull(last_message_at, ''),
		        ifnull(summary, ''), ifnull(session_state, ''), ifnull(lease_owner, ''), ifnull(lease_expires_at, ''),
		        ifnull(auto_approve, 0), ifnull(provider_name, ''), ifnull(runtime_metadata_json, ''), created_at, updated_at
		 FROM bridge_sessions
		 WHERE kimi_session_id = ?`,
		kimiSessionID,
	)

	var session domain.BridgeSession
	var autoApprove int
	if err := row.Scan(
		&session.KimiSessionID,
		&session.WorkDir,
		&session.LastTurnID,
		&session.LastMessageAt,
		&session.Summary,
		&session.SessionState,
		&session.LeaseOwner,
		&session.LeaseExpiresAt,
		&autoApprove,
		&session.ProviderName,
		&session.RuntimeMetadataJSON,
		&session.CreatedAt,
		&session.UpdatedAt,
	); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("failed to get bridge session %s: %w", kimiSessionID, err)
	}
	session.AutoApprove = autoApprove == 1
	return &session, nil
}

func (s *Store) ResolveBinding(ctx context.Context, key domain.BindingKey) (*domain.SessionBinding, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT binding_id, ifnull(connector_id, ''), platform, ifnull(account_id, ''), chat_id, ifnull(thread_id, ''), kimi_session_id,
		        ifnull(work_dir, ''), source, ifnull(onboarded_at, ''), ifnull(onboarding_version, ''),
		        ifnull(last_inbound_message_id, ''), ifnull(last_outbound_message_id, ''),
		        created_at, updated_at
		 FROM channel_bindings
		 WHERE ifnull(connector_id, '') = ? AND chat_id = ? AND ifnull(thread_id, '') = ?`,
		key.ConnectorID,
		key.ChatID,
		key.ThreadID,
	)
	binding, err := scanBinding(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to resolve binding %+v: %w", key, err)
	}
	return binding, nil
}

func (s *Store) CreateBinding(ctx context.Context, binding domain.SessionBinding) error {
	now := nowRFC3339()
	if binding.BindingID == "" {
		return fmt.Errorf("binding id is required")
	}
	if binding.CreatedAt == "" {
		binding.CreatedAt = now
	}
	if binding.UpdatedAt == "" {
		binding.UpdatedAt = binding.CreatedAt
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO channel_bindings (
			binding_id, connector_id, platform, account_id, chat_id, thread_id, kimi_session_id, work_dir, source,
			onboarded_at, onboarding_version, last_inbound_message_id, last_outbound_message_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		binding.BindingID,
		binding.Key.ConnectorID,
		binding.Key.Platform,
		nullIfEmpty(binding.Key.AccountID),
		binding.Key.ChatID,
		nullIfEmpty(binding.Key.ThreadID),
		binding.KimiSessionID,
		nullIfEmpty(binding.WorkDir),
		binding.Source,
		nullIfEmpty(binding.OnboardedAt),
		nullIfEmpty(binding.OnboardingVersion),
		nullIfEmpty(binding.LastInboundMessageID),
		nullIfEmpty(binding.LastOutboundMessageID),
		binding.CreatedAt,
		binding.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to create binding %s: %w", binding.BindingID, err)
	}
	return nil
}

func (s *Store) GetBindingByID(ctx context.Context, bindingID string) (*domain.SessionBinding, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT binding_id, ifnull(connector_id, ''), platform, ifnull(account_id, ''), chat_id, ifnull(thread_id, ''), kimi_session_id,
		        ifnull(work_dir, ''), source, ifnull(onboarded_at, ''), ifnull(onboarding_version, ''),
		        ifnull(last_inbound_message_id, ''), ifnull(last_outbound_message_id, ''),
		        created_at, updated_at
		 FROM channel_bindings
		 WHERE binding_id = ?`,
		bindingID,
	)
	binding, err := scanBinding(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get binding %s: %w", bindingID, err)
	}
	return binding, nil
}

func (s *Store) ListBindings(ctx context.Context) ([]domain.BindingRecord, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT binding_id, ifnull(connector_id, ''), platform, ifnull(account_id, ''), chat_id, ifnull(thread_id, ''), kimi_session_id,
		        ifnull(work_dir, ''), ifnull(onboarded_at, ''), ifnull(onboarding_version, ''), created_at, updated_at, ifnull(last_inbound_message_id, '')
		 FROM channel_bindings
		 ORDER BY updated_at DESC, binding_id DESC`,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list bindings: %w", err)
	}
	defer rows.Close()

	records := []domain.BindingRecord{}
	for rows.Next() {
		var record domain.BindingRecord
		if err := rows.Scan(
			&record.BindingID,
			&record.ConnectorID,
			&record.Platform,
			&record.AccountID,
			&record.ChatID,
			&record.ThreadID,
			&record.KimiSessionID,
			&record.WorkDir,
			&record.OnboardedAt,
			&record.OnboardingVersion,
			&record.CreatedAt,
			&record.UpdatedAt,
			&record.LastInboundMessageID,
		); err != nil {
			return nil, fmt.Errorf("failed to scan binding record: %w", err)
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate bindings: %w", err)
	}
	return records, nil
}

func (s *Store) ClearBinding(ctx context.Context, bindingID string) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM channel_bindings WHERE binding_id = ?`, bindingID); err != nil {
		return fmt.Errorf("failed to clear binding %s: %w", bindingID, err)
	}
	return nil
}

func (s *Store) Rebind(ctx context.Context, bindingID string, kimiSessionID string, workDir string, source string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE channel_bindings
		 SET kimi_session_id = ?, work_dir = ?, source = ?, updated_at = ?
		 WHERE binding_id = ?`,
		kimiSessionID,
		nullIfEmpty(strings.TrimSpace(workDir)),
		source,
		nowRFC3339(),
		bindingID,
	)
	if err != nil {
		return fmt.Errorf("failed to rebind %s: %w", bindingID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to inspect rebind rows affected for %s: %w", bindingID, err)
	}
	if affected == 0 {
		return fmt.Errorf("binding %s not found", bindingID)
	}
	return nil
}

func (s *Store) UpdateBindingWorkDir(ctx context.Context, bindingID string, workDir string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin binding workdir update for %s: %w", bindingID, err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	var kimiSessionID string
	if scanErr := tx.QueryRowContext(
		ctx,
		`SELECT kimi_session_id FROM channel_bindings WHERE binding_id = ?`,
		bindingID,
	).Scan(&kimiSessionID); errors.Is(scanErr, sql.ErrNoRows) {
		err = fmt.Errorf("binding %s not found", bindingID)
		return err
	} else if scanErr != nil {
		err = fmt.Errorf("failed to load binding %s before workdir update: %w", bindingID, scanErr)
		return err
	}

	now := nowRFC3339()
	result, execErr := tx.ExecContext(
		ctx,
		`UPDATE channel_bindings
		 SET work_dir = ?, updated_at = ?
		 WHERE binding_id = ?`,
		nullIfEmpty(strings.TrimSpace(workDir)),
		now,
		bindingID,
	)
	if execErr != nil {
		err = fmt.Errorf("failed to update binding workdir for %s: %w", bindingID, execErr)
		return err
	}
	affected, rowsErr := result.RowsAffected()
	if rowsErr != nil {
		err = fmt.Errorf("failed to inspect binding workdir rows affected for %s: %w", bindingID, rowsErr)
		return err
	}
	if affected == 0 {
		err = fmt.Errorf("binding %s not found", bindingID)
		return err
	}

	if strings.TrimSpace(kimiSessionID) != "" {
		if _, execErr := tx.ExecContext(
			ctx,
			`UPDATE bridge_sessions
			 SET work_dir = ?, updated_at = ?
			 WHERE kimi_session_id = ?`,
			nullIfEmpty(strings.TrimSpace(workDir)),
			now,
			kimiSessionID,
		); execErr != nil {
			err = fmt.Errorf("failed to update bridge session workdir for %s: %w", kimiSessionID, execErr)
			return err
		}
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return fmt.Errorf("failed to commit binding workdir update for %s: %w", bindingID, commitErr)
	}
	return nil
}

func (s *Store) UpdateBindingOnboarding(ctx context.Context, bindingID string, onboardingVersion string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE channel_bindings
		 SET onboarded_at = ?, onboarding_version = ?, updated_at = ?
		 WHERE binding_id = ?`,
		nowRFC3339(),
		nullIfEmpty(strings.TrimSpace(onboardingVersion)),
		nowRFC3339(),
		bindingID,
	)
	if err != nil {
		return fmt.Errorf("failed to update binding onboarding for %s: %w", bindingID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to inspect binding onboarding rows affected for %s: %w", bindingID, err)
	}
	if affected == 0 {
		return fmt.Errorf("binding %s not found", bindingID)
	}
	return nil
}

func (s *Store) GetLastInboundMessageID(ctx context.Context, bindingID string) (string, bool, error) {
	var messageID string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT ifnull(last_inbound_message_id, '') FROM channel_bindings WHERE binding_id = ?`,
		bindingID,
	).Scan(&messageID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("failed to get last inbound message for %s: %w", bindingID, err)
	}
	if messageID == "" {
		return "", false, nil
	}
	return messageID, true, nil
}

func (s *Store) UpdateLastInboundMessageID(ctx context.Context, bindingID string, messageID string) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE channel_bindings
		 SET last_inbound_message_id = ?, updated_at = ?
		 WHERE binding_id = ?`,
		messageID,
		nowRFC3339(),
		bindingID,
	)
	if err != nil {
		return fmt.Errorf("failed to update last inbound message for %s: %w", bindingID, err)
	}
	return nil
}

func (s *Store) CreateApprovalTicket(ctx context.Context, ticket domain.ApprovalTicket) error {
	now := nowRFC3339()
	if ticket.CreatedAt == "" {
		ticket.CreatedAt = now
	}
	if ticket.UpdatedAt == "" {
		ticket.UpdatedAt = ticket.CreatedAt
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO approval_requests (
			approval_id, connector_id, kimi_session_id, turn_id, step_id, platform, chat_id, thread_id, request_kind, prompt, status,
			request_payload_json, resolution_payload_json, dedupe_key, claimed_by_actor_id, claimed_at,
			platform_message_id, resolution_by, request_hash, created_at, updated_at, resolved_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ticket.ApprovalID,
		nullIfEmpty(ticket.ConnectorID),
		ticket.KimiSessionID,
		nullIfEmpty(ticket.TurnID),
		nullIfEmpty(ticket.StepID),
		ticket.Platform,
		ticket.ChatID,
		nullIfEmpty(ticket.ThreadID),
		ticket.RequestKind,
		ticket.Prompt,
		ticket.Status,
		ticket.RequestPayloadJSON,
		nullIfEmpty(ticket.ResolutionPayloadJSON),
		ticket.DedupeKey,
		nullIfEmpty(ticket.ClaimedByActorID),
		nullIfEmpty(ticket.ClaimedAt),
		nullIfEmpty(ticket.PlatformMessageID),
		nullIfEmpty(ticket.ResolutionBy),
		nullIfEmpty(ticket.RequestHash),
		ticket.CreatedAt,
		ticket.UpdatedAt,
		nullIfEmpty(ticket.ResolvedAt),
	)
	if err != nil {
		return fmt.Errorf("failed to create approval ticket %s: %w", ticket.ApprovalID, err)
	}
	return nil
}

func (s *Store) ListApprovals(ctx context.Context, status string) ([]domain.ApprovalTicket, error) {
	query := `SELECT approval_id, ifnull(connector_id, ''), kimi_session_id, ifnull(turn_id, ''), ifnull(step_id, ''), request_kind,
	          prompt, platform, chat_id, ifnull(thread_id, ''), status, request_payload_json,
	          ifnull(resolution_payload_json, ''), dedupe_key, ifnull(claimed_by_actor_id, ''),
	          ifnull(claimed_at, ''), ifnull(platform_message_id, ''), ifnull(resolution_by, ''),
	          ifnull(request_hash, ''), created_at, updated_at, ifnull(resolved_at, '')
	   FROM approval_requests`
	args := []any{}
	if status != "" {
		query += ` WHERE status = ?`
		args = append(args, status)
	}
	query += ` ORDER BY created_at DESC, approval_id DESC`

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list approvals: %w", err)
	}
	defer rows.Close()

	items := []domain.ApprovalTicket{}
	for rows.Next() {
		var ticket domain.ApprovalTicket
		if err := rows.Scan(
			&ticket.ApprovalID,
			&ticket.ConnectorID,
			&ticket.KimiSessionID,
			&ticket.TurnID,
			&ticket.StepID,
			&ticket.RequestKind,
			&ticket.Prompt,
			&ticket.Platform,
			&ticket.ChatID,
			&ticket.ThreadID,
			&ticket.Status,
			&ticket.RequestPayloadJSON,
			&ticket.ResolutionPayloadJSON,
			&ticket.DedupeKey,
			&ticket.ClaimedByActorID,
			&ticket.ClaimedAt,
			&ticket.PlatformMessageID,
			&ticket.ResolutionBy,
			&ticket.RequestHash,
			&ticket.CreatedAt,
			&ticket.UpdatedAt,
			&ticket.ResolvedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan approval ticket: %w", err)
		}
		items = append(items, ticket)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate approvals: %w", err)
	}
	return items, nil
}

func (s *Store) GetApprovalByID(ctx context.Context, approvalID string) (*domain.ApprovalTicket, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT approval_id, ifnull(connector_id, ''), kimi_session_id, ifnull(turn_id, ''), ifnull(step_id, ''), request_kind,
		        prompt, platform, chat_id, ifnull(thread_id, ''), status, request_payload_json,
		        ifnull(resolution_payload_json, ''), dedupe_key, ifnull(claimed_by_actor_id, ''),
		        ifnull(claimed_at, ''), ifnull(platform_message_id, ''), ifnull(resolution_by, ''),
		        ifnull(request_hash, ''), created_at, updated_at, ifnull(resolved_at, '')
		 FROM approval_requests
		 WHERE approval_id = ?`,
		approvalID,
	)

	var ticket domain.ApprovalTicket
	if err := row.Scan(
		&ticket.ApprovalID,
		&ticket.ConnectorID,
		&ticket.KimiSessionID,
		&ticket.TurnID,
		&ticket.StepID,
		&ticket.RequestKind,
		&ticket.Prompt,
		&ticket.Platform,
		&ticket.ChatID,
		&ticket.ThreadID,
		&ticket.Status,
		&ticket.RequestPayloadJSON,
		&ticket.ResolutionPayloadJSON,
		&ticket.DedupeKey,
		&ticket.ClaimedByActorID,
		&ticket.ClaimedAt,
		&ticket.PlatformMessageID,
		&ticket.ResolutionBy,
		&ticket.RequestHash,
		&ticket.CreatedAt,
		&ticket.UpdatedAt,
		&ticket.ResolvedAt,
	); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("failed to get approval %s: %w", approvalID, err)
	}
	return &ticket, nil
}

func (s *Store) ResolveApproval(ctx context.Context, approvalID string, status string, resolutionPayloadJSON string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE approval_requests
		 SET status = ?, resolution_payload_json = ?, updated_at = ?, resolved_at = ?
		 WHERE approval_id = ?`,
		status,
		nullIfEmpty(resolutionPayloadJSON),
		nowRFC3339(),
		nowRFC3339(),
		approvalID,
	)
	if err != nil {
		return fmt.Errorf("failed to resolve approval %s: %w", approvalID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to inspect resolve approval rows affected for %s: %w", approvalID, err)
	}
	if affected == 0 {
		return fmt.Errorf("approval %s not found", approvalID)
	}
	return nil
}

func (s *Store) HasApprovalDedupeKey(ctx context.Context, dedupeKey string) (bool, error) {
	var value string
	err := s.db.QueryRowContext(
		ctx,
		`SELECT approval_id FROM approval_requests WHERE dedupe_key = ?`,
		dedupeKey,
	).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to query approval dedupe key %s: %w", dedupeKey, err)
	}
	return true, nil
}

func (s *Store) RecordDeliveryEventIfAbsent(ctx context.Context, event domain.DeliveryEvent) (bool, error) {
	now := nowRFC3339()
	if event.CreatedAt == "" {
		event.CreatedAt = now
	}
	if event.UpdatedAt == "" {
		event.UpdatedAt = event.CreatedAt
	}
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO delivery_events (
			event_id, connector_id, platform, chat_id, thread_id, direction, delivery_key, source_message_id,
			turn_id, step_index, delivery_kind, renderer, attempt_count, target_message_id, retry_after_at,
			supersedes_event_id, payload_json, status, error_message, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.EventID,
		nullIfEmpty(event.ConnectorID),
		event.Platform,
		event.ChatID,
		nullIfEmpty(event.ThreadID),
		event.Direction,
		event.DeliveryKey,
		nullIfEmpty(event.SourceMessageID),
		nullIfEmpty(event.TurnID),
		event.StepIndex,
		nullIfEmpty(event.DeliveryKind),
		nullIfEmpty(event.Renderer),
		event.AttemptCount,
		nullIfEmpty(event.TargetMessageID),
		nullIfEmpty(event.RetryAfterAt),
		nullIfEmpty(event.SupersedesEventID),
		event.PayloadJSON,
		event.Status,
		nullIfEmpty(event.ErrorMessage),
		event.CreatedAt,
		event.UpdatedAt,
	)
	if err != nil {
		if isUniqueConstraint(err) {
			return false, nil
		}
		return false, fmt.Errorf("failed to insert delivery event %s: %w", event.EventID, err)
	}
	return true, nil
}

func (s *Store) GetDeliveryEventByKey(ctx context.Context, deliveryKey string) (*domain.DeliveryEvent, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT event_id, ifnull(connector_id, ''), platform, chat_id, ifnull(thread_id, ''), direction, delivery_key,
		        ifnull(source_message_id, ''), ifnull(turn_id, ''), ifnull(step_index, 0), ifnull(delivery_kind, ''),
		        ifnull(renderer, ''), ifnull(attempt_count, 0), ifnull(target_message_id, ''), ifnull(retry_after_at, ''),
		        ifnull(supersedes_event_id, ''), payload_json, status, ifnull(error_message, ''), created_at, updated_at
		 FROM delivery_events
		 WHERE delivery_key = ?`,
		deliveryKey,
	)

	var event domain.DeliveryEvent
	if err := row.Scan(
		&event.EventID,
		&event.ConnectorID,
		&event.Platform,
		&event.ChatID,
		&event.ThreadID,
		&event.Direction,
		&event.DeliveryKey,
		&event.SourceMessageID,
		&event.TurnID,
		&event.StepIndex,
		&event.DeliveryKind,
		&event.Renderer,
		&event.AttemptCount,
		&event.TargetMessageID,
		&event.RetryAfterAt,
		&event.SupersedesEventID,
		&event.PayloadJSON,
		&event.Status,
		&event.ErrorMessage,
		&event.CreatedAt,
		&event.UpdatedAt,
	); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("failed to get delivery event by key %s: %w", deliveryKey, err)
	}
	return &event, nil
}

func (s *Store) UpdateDeliveryEventStatus(ctx context.Context, deliveryKey string, status string, errorMessage string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE delivery_events
		 SET status = ?, error_message = ?, updated_at = ?
		 WHERE delivery_key = ?`,
		status,
		nullIfEmpty(errorMessage),
		nowRFC3339(),
		deliveryKey,
	)
	if err != nil {
		return fmt.Errorf("failed to update delivery event %s: %w", deliveryKey, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to inspect delivery event rows affected for %s: %w", deliveryKey, err)
	}
	if affected == 0 {
		return fmt.Errorf("delivery event %s not found", deliveryKey)
	}
	return nil
}

func (s *Store) UpdateDeliveryEventSent(ctx context.Context, deliveryKey string, targetMessageID string) error {
	result, err := s.db.ExecContext(
		ctx,
		`UPDATE delivery_events
		 SET status = 'sent', target_message_id = ?, error_message = NULL, updated_at = ?
		 WHERE delivery_key = ?`,
		nullIfEmpty(strings.TrimSpace(targetMessageID)),
		nowRFC3339(),
		deliveryKey,
	)
	if err != nil {
		return fmt.Errorf("failed to mark delivery event %s as sent: %w", deliveryKey, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to inspect delivery sent rows affected for %s: %w", deliveryKey, err)
	}
	if affected == 0 {
		return fmt.Errorf("delivery event %s not found", deliveryKey)
	}
	return nil
}

func (s *Store) StorePendingInboundAttachment(ctx context.Context, attachment domain.PendingInboundAttachment, maxPerContext int) error {
	if strings.TrimSpace(attachment.AttachmentID) == "" {
		return fmt.Errorf("attachment id is required")
	}
	if strings.TrimSpace(attachment.ConnectorID) == "" || strings.TrimSpace(attachment.Platform) == "" || strings.TrimSpace(attachment.ChatID) == "" {
		return fmt.Errorf("connector id, platform, and chat id are required")
	}
	now := nowRFC3339()
	if attachment.CreatedAt == "" {
		attachment.CreatedAt = now
	}
	if attachment.UpdatedAt == "" {
		attachment.UpdatedAt = attachment.CreatedAt
	}
	if maxPerContext <= 0 {
		maxPerContext = 10
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin pending attachment transaction: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, execErr := tx.ExecContext(
		ctx,
		`INSERT INTO pending_inbound_attachments (
			attachment_id, connector_id, platform, chat_id, thread_id, kind, file_name, mime_type, size_bytes,
			platform_key, local_path, source_message_id, download_state, expires_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		attachment.AttachmentID,
		attachment.ConnectorID,
		attachment.Platform,
		attachment.ChatID,
		nullIfEmpty(attachment.ThreadID),
		string(attachment.Kind),
		nullIfEmpty(strings.TrimSpace(attachment.FileName)),
		nullIfEmpty(strings.TrimSpace(attachment.MimeType)),
		attachment.SizeBytes,
		nullIfEmpty(strings.TrimSpace(attachment.PlatformKey)),
		nullIfEmpty(strings.TrimSpace(attachment.LocalPath)),
		nullIfEmpty(strings.TrimSpace(attachment.SourceMessageID)),
		nullIfEmpty(string(attachment.DownloadState)),
		nullIfEmpty(strings.TrimSpace(attachment.ExpiresAt)),
		attachment.CreatedAt,
		attachment.UpdatedAt,
	); execErr != nil {
		if !isUniqueConstraint(execErr) {
			err = fmt.Errorf("failed to store pending attachment %s: %w", attachment.AttachmentID, execErr)
			return err
		}
		if _, updateErr := tx.ExecContext(
			ctx,
			`UPDATE pending_inbound_attachments
			 SET file_name = ?, mime_type = ?, size_bytes = ?, local_path = ?, download_state = ?, expires_at = ?, updated_at = ?
			 WHERE ifnull(connector_id, '') = ? AND chat_id = ? AND ifnull(thread_id, '') = ? AND ifnull(platform_key, '') = ? AND ifnull(source_message_id, '') = ?`,
			nullIfEmpty(strings.TrimSpace(attachment.FileName)),
			nullIfEmpty(strings.TrimSpace(attachment.MimeType)),
			attachment.SizeBytes,
			nullIfEmpty(strings.TrimSpace(attachment.LocalPath)),
			nullIfEmpty(string(attachment.DownloadState)),
			nullIfEmpty(strings.TrimSpace(attachment.ExpiresAt)),
			attachment.UpdatedAt,
			attachment.ConnectorID,
			attachment.ChatID,
			attachment.ThreadID,
			attachment.PlatformKey,
			attachment.SourceMessageID,
		); updateErr != nil {
			err = fmt.Errorf("failed to update pending attachment %s after dedupe: %w", attachment.AttachmentID, updateErr)
			return err
		}
	}

	if _, execErr := tx.ExecContext(
		ctx,
		`DELETE FROM pending_inbound_attachments
		 WHERE attachment_id IN (
		    SELECT attachment_id
		    FROM pending_inbound_attachments
		    WHERE ifnull(connector_id, '') = ? AND chat_id = ? AND ifnull(thread_id, '') = ?
		    ORDER BY created_at DESC, attachment_id DESC
		    LIMIT -1 OFFSET ?
		 )`,
		attachment.ConnectorID,
		attachment.ChatID,
		attachment.ThreadID,
		maxPerContext,
	); execErr != nil {
		err = fmt.Errorf("failed to trim pending attachments: %w", execErr)
		return err
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return fmt.Errorf("failed to commit pending attachment %s: %w", attachment.AttachmentID, commitErr)
	}
	return nil
}

func (s *Store) ConsumePendingInboundAttachments(ctx context.Context, connectorID string, chatID string, threadID string, now string, limit int) ([]domain.PendingInboundAttachment, error) {
	if limit <= 0 {
		limit = 10
	}
	if strings.TrimSpace(now) == "" {
		now = nowRFC3339()
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin consume pending attachments transaction: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	if _, execErr := tx.ExecContext(
		ctx,
		`DELETE FROM pending_inbound_attachments
		 WHERE expires_at IS NOT NULL AND expires_at != '' AND expires_at <= ?`,
		now,
	); execErr != nil {
		err = fmt.Errorf("failed to delete expired pending attachments: %w", execErr)
		return nil, err
	}

	rows, queryErr := tx.QueryContext(
		ctx,
		`SELECT attachment_id, ifnull(connector_id, ''), platform, chat_id, ifnull(thread_id, ''), kind, ifnull(file_name, ''),
		        ifnull(mime_type, ''), ifnull(size_bytes, 0), ifnull(platform_key, ''), ifnull(local_path, ''),
		        ifnull(source_message_id, ''), ifnull(download_state, ''), ifnull(expires_at, ''),
		        created_at, updated_at
		 FROM pending_inbound_attachments
		 WHERE ifnull(connector_id, '') = ? AND chat_id = ? AND ifnull(thread_id, '') = ?
		 ORDER BY created_at ASC, attachment_id ASC
		 LIMIT ?`,
		connectorID,
		chatID,
		threadID,
		limit,
	)
	if queryErr != nil {
		err = fmt.Errorf("failed to query pending attachments: %w", queryErr)
		return nil, err
	}
	defer rows.Close()

	items := []domain.PendingInboundAttachment{}
	ids := []string{}
	for rows.Next() {
		var item domain.PendingInboundAttachment
		var kind string
		var downloadState string
		if scanErr := rows.Scan(
			&item.AttachmentID,
			&item.ConnectorID,
			&item.Platform,
			&item.ChatID,
			&item.ThreadID,
			&kind,
			&item.FileName,
			&item.MimeType,
			&item.SizeBytes,
			&item.PlatformKey,
			&item.LocalPath,
			&item.SourceMessageID,
			&downloadState,
			&item.ExpiresAt,
			&item.CreatedAt,
			&item.UpdatedAt,
		); scanErr != nil {
			err = fmt.Errorf("failed to scan pending attachment: %w", scanErr)
			return nil, err
		}
		item.Kind = domain.AttachmentKind(kind)
		item.DownloadState = domain.AttachmentDownloadState(downloadState)
		items = append(items, item)
		ids = append(ids, item.AttachmentID)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		err = fmt.Errorf("failed to iterate pending attachments: %w", rowsErr)
		return nil, err
	}
	if len(ids) == 0 {
		if commitErr := tx.Commit(); commitErr != nil {
			return nil, fmt.Errorf("failed to commit consume pending attachments: %w", commitErr)
		}
		return nil, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	if _, execErr := tx.ExecContext(ctx, `DELETE FROM pending_inbound_attachments WHERE attachment_id IN (`+placeholders+`)`, args...); execErr != nil {
		err = fmt.Errorf("failed to delete consumed pending attachments: %w", execErr)
		return nil, err
	}

	if commitErr := tx.Commit(); commitErr != nil {
		return nil, fmt.Errorf("failed to commit consumed pending attachments: %w", commitErr)
	}
	return items, nil
}

func (s *Store) ListPendingInboundAttachments(ctx context.Context, connectorID string, chatID string, threadID string, now string, limit int) ([]domain.PendingInboundAttachment, error) {
	if limit <= 0 {
		limit = 10
	}
	if strings.TrimSpace(now) == "" {
		now = nowRFC3339()
	}
	if _, err := s.db.ExecContext(
		ctx,
		`DELETE FROM pending_inbound_attachments
		 WHERE expires_at IS NOT NULL AND expires_at != '' AND expires_at <= ?`,
		now,
	); err != nil {
		return nil, fmt.Errorf("failed to delete expired pending attachments: %w", err)
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT attachment_id, ifnull(connector_id, ''), platform, chat_id, ifnull(thread_id, ''), kind, ifnull(file_name, ''),
		        ifnull(mime_type, ''), ifnull(size_bytes, 0), ifnull(platform_key, ''), ifnull(local_path, ''),
		        ifnull(source_message_id, ''), ifnull(download_state, ''), ifnull(expires_at, ''),
		        created_at, updated_at
		 FROM pending_inbound_attachments
		 WHERE ifnull(connector_id, '') = ? AND chat_id = ? AND ifnull(thread_id, '') = ?
		 ORDER BY created_at ASC, attachment_id ASC
		 LIMIT ?`,
		connectorID,
		chatID,
		threadID,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to query pending attachments: %w", err)
	}
	defer rows.Close()

	items := []domain.PendingInboundAttachment{}
	for rows.Next() {
		var item domain.PendingInboundAttachment
		var kind string
		var downloadState string
		if scanErr := rows.Scan(
			&item.AttachmentID,
			&item.ConnectorID,
			&item.Platform,
			&item.ChatID,
			&item.ThreadID,
			&kind,
			&item.FileName,
			&item.MimeType,
			&item.SizeBytes,
			&item.PlatformKey,
			&item.LocalPath,
			&item.SourceMessageID,
			&downloadState,
			&item.ExpiresAt,
			&item.CreatedAt,
			&item.UpdatedAt,
		); scanErr != nil {
			return nil, fmt.Errorf("failed to scan pending attachment: %w", scanErr)
		}
		item.Kind = domain.AttachmentKind(kind)
		item.DownloadState = domain.AttachmentDownloadState(downloadState)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate pending attachments: %w", err)
	}
	return items, nil
}

func (s *Store) DeletePendingInboundAttachments(ctx context.Context, attachmentIDs []string) error {
	if len(attachmentIDs) == 0 {
		return nil
	}
	placeholders := strings.TrimRight(strings.Repeat("?,", len(attachmentIDs)), ",")
	args := make([]any, 0, len(attachmentIDs))
	for _, id := range attachmentIDs {
		args = append(args, id)
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM pending_inbound_attachments WHERE attachment_id IN (`+placeholders+`)`, args...); err != nil {
		return fmt.Errorf("failed to delete pending inbound attachments: %w", err)
	}
	return nil
}

func (s *Store) CountPendingInboundAttachments(ctx context.Context, connectorID string, chatID string, threadID string) (int, error) {
	var count int
	if err := s.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM pending_inbound_attachments
		 WHERE ifnull(connector_id, '') = ? AND chat_id = ? AND ifnull(thread_id, '') = ?`,
		connectorID,
		chatID,
		threadID,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to count pending inbound attachments: %w", err)
	}
	return count, nil
}

func (s *Store) CountBindings(ctx context.Context) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM channel_bindings`).Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to count bindings: %w", err)
	}
	return count, nil
}

func (s *Store) CountPendingApprovals(ctx context.Context) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM approval_requests WHERE status = 'pending'`).Scan(&count); err != nil {
		return 0, fmt.Errorf("failed to count pending approvals: %w", err)
	}
	return count, nil
}

func (s *Store) CreateTurn(ctx context.Context, turn domain.BridgeTurn) error {
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO bridge_turns (
			turn_id, connector_id, kimi_session_id, binding_id, platform, chat_id, thread_id, inbound_message_id,
			prompt_text, status, provider_name, started_at, completed_at, error_code, error_message,
			created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		turn.TurnID,
		nullIfEmpty(turn.ConnectorID),
		turn.KimiSessionID,
		nullIfEmpty(turn.BindingID),
		turn.Platform,
		turn.ChatID,
		nullIfEmpty(turn.ThreadID),
		nullIfEmpty(turn.InboundMessageID),
		turn.PromptText,
		turn.Status,
		turn.ProviderName,
		turn.StartedAt,
		nullIfEmpty(turn.CompletedAt),
		nullIfEmpty(turn.ErrorCode),
		nullIfEmpty(turn.ErrorMessage),
		turn.CreatedAt,
		turn.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to create turn %s: %w", turn.TurnID, err)
	}
	return nil
}

func (s *Store) UpdateTurn(ctx context.Context, turn domain.BridgeTurn) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE bridge_turns
		 SET connector_id = ?, kimi_session_id = ?, binding_id = ?, platform = ?, chat_id = ?, thread_id = ?, inbound_message_id = ?,
		     prompt_text = ?, status = ?, provider_name = ?, started_at = ?, completed_at = ?, error_code = ?,
		     error_message = ?, updated_at = ?
		 WHERE turn_id = ?`,
		nullIfEmpty(turn.ConnectorID),
		turn.KimiSessionID,
		nullIfEmpty(turn.BindingID),
		turn.Platform,
		turn.ChatID,
		nullIfEmpty(turn.ThreadID),
		nullIfEmpty(turn.InboundMessageID),
		turn.PromptText,
		turn.Status,
		turn.ProviderName,
		turn.StartedAt,
		nullIfEmpty(turn.CompletedAt),
		nullIfEmpty(turn.ErrorCode),
		nullIfEmpty(turn.ErrorMessage),
		turn.UpdatedAt,
		turn.TurnID,
	)
	if err != nil {
		return fmt.Errorf("failed to update turn %s: %w", turn.TurnID, err)
	}
	return nil
}

func (s *Store) AppendTurnEvent(ctx context.Context, event domain.TurnEventRecord) error {
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO turn_events (
			event_id, connector_id, turn_id, kimi_session_id, platform, chat_id, thread_id, kind, step_index, message_id,
			approval_id, request_kind, text_delta, thinking_delta, status_text, payload_json, error_code,
			error_message, context_usage, token_usage_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.EventID,
		nullIfEmpty(event.ConnectorID),
		event.TurnID,
		event.KimiSessionID,
		event.Platform,
		event.ChatID,
		nullIfEmpty(event.ThreadID),
		event.Kind,
		event.StepIndex,
		nullIfEmpty(event.MessageID),
		nullIfEmpty(event.ApprovalID),
		nullIfEmpty(event.RequestKind),
		nullIfEmpty(event.TextDelta),
		nullIfEmpty(event.ThinkingDelta),
		nullIfEmpty(event.StatusText),
		nullIfEmpty(event.PayloadJSON),
		nullIfEmpty(event.ErrorCode),
		nullIfEmpty(event.ErrorMessage),
		event.ContextUsage,
		nullIfEmpty(event.TokenUsageJSON),
		event.CreatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to append turn event %s: %w", event.EventID, err)
	}
	return nil
}

func (s *Store) GetCheckpoint(ctx context.Context, connectorID string, checkpointKind string) (*domain.ChannelCheckpoint, error) {
	connectorID = s.resolveChannelID(ctx, connectorID)
	row := s.db.QueryRowContext(
		ctx,
		`SELECT channel_id, checkpoint_kind, ifnull(fetched_value, ''), ifnull(committed_value, ''),
		        ifnull(last_seen_at, ''), ifnull(committed_at, ''), updated_at
		 FROM channel_checkpoints
		 WHERE channel_id = ? AND checkpoint_kind = ?`,
		connectorID,
		checkpointKind,
	)
	var checkpoint domain.ChannelCheckpoint
	if err := row.Scan(
		&checkpoint.ConnectorID,
		&checkpoint.CheckpointKind,
		&checkpoint.FetchedValue,
		&checkpoint.CommittedValue,
		&checkpoint.LastSeenAt,
		&checkpoint.CommittedAt,
		&checkpoint.UpdatedAt,
	); errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, fmt.Errorf("failed to get checkpoint %s/%s: %w", connectorID, checkpointKind, err)
	}
	return &checkpoint, nil
}

func (s *Store) CommitCheckpoint(ctx context.Context, connectorID string, checkpointKind string, fetched string, committed string) error {
	connectorID = s.resolveChannelID(ctx, connectorID)
	now := nowRFC3339()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO channel_checkpoints (
			channel_id, checkpoint_kind, fetched_value, committed_value, last_seen_at, committed_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(channel_id, checkpoint_kind) DO UPDATE SET
			fetched_value=excluded.fetched_value,
			committed_value=excluded.committed_value,
			last_seen_at=excluded.last_seen_at,
			committed_at=excluded.committed_at,
			updated_at=excluded.updated_at`,
		connectorID,
		checkpointKind,
		nullIfEmpty(fetched),
		nullIfEmpty(committed),
		now,
		nullIfEmpty(committedAt(committed, now)),
		now,
	)
	if err != nil {
		return fmt.Errorf("failed to commit checkpoint %s/%s: %w", connectorID, checkpointKind, err)
	}
	return nil
}

func scanBinding(scanner interface {
	Scan(dest ...any) error
}) (*domain.SessionBinding, error) {
	var binding domain.SessionBinding
	if err := scanner.Scan(
		&binding.BindingID,
		&binding.Key.ConnectorID,
		&binding.Key.Platform,
		&binding.Key.AccountID,
		&binding.Key.ChatID,
		&binding.Key.ThreadID,
		&binding.KimiSessionID,
		&binding.WorkDir,
		&binding.Source,
		&binding.OnboardedAt,
		&binding.OnboardingVersion,
		&binding.LastInboundMessageID,
		&binding.LastOutboundMessageID,
		&binding.CreatedAt,
		&binding.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &binding, nil
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func committedAt(value string, now string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return now
}

func (s *Store) resolveChannelID(ctx context.Context, value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	var channelID string
	if err := s.db.QueryRowContext(ctx, `SELECT channel_id FROM bridge_channels WHERE channel_id = ?`, value).Scan(&channelID); err == nil {
		return channelID
	}

	rows, err := s.db.QueryContext(ctx, `SELECT channel_id FROM bridge_channels WHERE platform = ? ORDER BY channel_id`, value)
	if err != nil {
		return value
	}
	defer rows.Close()

	matches := []string{}
	for rows.Next() {
		var item string
		if scanErr := rows.Scan(&item); scanErr != nil {
			return value
		}
		matches = append(matches, item)
		if len(matches) > 1 {
			return value
		}
	}
	if len(matches) == 1 {
		return matches[0]
	}
	return value
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func isUniqueConstraint(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "unique constraint failed")
}

type channelErrorPayload struct {
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

func encodeChannelError(code string, message string) string {
	code = strings.TrimSpace(code)
	message = strings.TrimSpace(message)
	if code == "" && message == "" {
		return ""
	}
	payload := channelErrorPayload{
		Code:    code,
		Message: message,
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		if message != "" {
			return message
		}
		return code
	}
	return string(encoded)
}

func decodeChannelError(raw string) (string, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}

	var payload channelErrorPayload
	if strings.HasPrefix(raw, "{") && json.Unmarshal([]byte(raw), &payload) == nil {
		return strings.TrimSpace(payload.Code), strings.TrimSpace(payload.Message)
	}
	return raw, raw
}

func ExpectedUserVersion() int {
	return userVersion
}
