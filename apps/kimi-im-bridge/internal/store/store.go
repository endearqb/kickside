package store

import (
	"context"
	"database/sql"
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

const userVersion = 3

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

func (s *Store) SyncConfiguredChannels(ctx context.Context, channels []config.ChannelConfig) error {
	now := nowRFC3339()
	for _, channel := range channels {
		if channel.Platform == "" {
			continue
		}
		_, err := s.db.ExecContext(
			ctx,
			`INSERT INTO bridge_channels (
				channel_id, platform, enabled, account_id, state, last_offset, last_error, last_heartbeat_at,
				last_inbound_at, last_outbound_at, created_at, updated_at
			) VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
			ON CONFLICT(channel_id) DO UPDATE SET
				enabled=excluded.enabled,
				state=excluded.state,
				updated_at=excluded.updated_at`,
			channel.Platform,
			channel.Platform,
			boolToInt(channel.Enabled),
			domain.ChannelStateIdle,
			now,
			now,
		)
		if err != nil {
			return fmt.Errorf("failed to upsert channel %s: %w", channel.Platform, err)
		}
	}
	return nil
}

func (s *Store) ListChannelStatuses(ctx context.Context) ([]domain.ChannelStatus, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT platform, enabled, state, ifnull(last_inbound_at, ''), ifnull(last_outbound_at, ''), ifnull(last_offset, ''), ifnull(last_error, '')
		 FROM bridge_channels
		 ORDER BY platform`,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list channel statuses: %w", err)
	}
	defer rows.Close()

	statuses := []domain.ChannelStatus{}
	for rows.Next() {
		var status domain.ChannelStatus
		var enabled int
		if err := rows.Scan(
			&status.Platform,
			&enabled,
			&status.State,
			&status.LastInboundAt,
			&status.LastOutboundAt,
			&status.LastOffset,
			&status.LastError,
		); err != nil {
			return nil, fmt.Errorf("failed to scan channel status: %w", err)
		}
		status.Enabled = enabled == 1
		statuses = append(statuses, status)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate channel statuses: %w", err)
	}
	return statuses, nil
}

func (s *Store) UpdateChannelState(ctx context.Context, platform string, state domain.ChannelRuntimeState, lastError string) error {
	now := nowRFC3339()
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE bridge_channels
		 SET state = ?, last_error = ?, updated_at = ?
		 WHERE channel_id = ?`,
		state,
		nullIfEmpty(lastError),
		now,
		platform,
	)
	if err != nil {
		return fmt.Errorf("failed to update channel state for %s: %w", platform, err)
	}
	return nil
}

func (s *Store) UpdateChannelOffset(ctx context.Context, platform string, offsetValue string) error {
	if err := s.UpsertOffset(ctx, platform, offsetKindForPlatform(platform), offsetValue); err != nil {
		return err
	}
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE bridge_channels
		 SET last_offset = ?, updated_at = ?
		 WHERE channel_id = ?`,
		nullIfEmpty(offsetValue),
		nowRFC3339(),
		platform,
	)
	if err != nil {
		return fmt.Errorf("failed to update channel status offset for %s: %w", platform, err)
	}
	return nil
}

func (s *Store) TouchChannelInbound(ctx context.Context, platform string, at string) error {
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
		platform,
	)
	if err != nil {
		return fmt.Errorf("failed to touch inbound channel activity for %s: %w", platform, err)
	}
	return nil
}

func (s *Store) TouchChannelOutbound(ctx context.Context, platform string, at string) error {
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
		platform,
	)
	if err != nil {
		return fmt.Errorf("failed to touch outbound channel activity for %s: %w", platform, err)
	}
	return nil
}

func (s *Store) UpsertOffset(ctx context.Context, channelID string, offsetKind string, offsetValue string) error {
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
			kimi_session_id, work_dir, last_turn_id, last_message_at, summary, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(kimi_session_id) DO UPDATE SET
			work_dir=excluded.work_dir,
			last_turn_id=excluded.last_turn_id,
			last_message_at=excluded.last_message_at,
			summary=excluded.summary,
			updated_at=excluded.updated_at`,
		session.KimiSessionID,
		nullIfEmpty(session.WorkDir),
		nullIfEmpty(session.LastTurnID),
		nullIfEmpty(session.LastMessageAt),
		nullIfEmpty(session.Summary),
		session.CreatedAt,
		session.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("failed to upsert bridge session %s: %w", session.KimiSessionID, err)
	}
	return nil
}

func (s *Store) ResolveBinding(ctx context.Context, key domain.BindingKey) (*domain.SessionBinding, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT binding_id, platform, ifnull(account_id, ''), chat_id, ifnull(thread_id, ''), kimi_session_id,
		        ifnull(work_dir, ''), source, ifnull(last_inbound_message_id, ''), ifnull(last_outbound_message_id, ''),
		        created_at, updated_at
		 FROM channel_bindings
		 WHERE platform = ? AND ifnull(account_id, '') = ? AND chat_id = ? AND ifnull(thread_id, '') = ?`,
		key.Platform,
		key.AccountID,
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
			binding_id, platform, account_id, chat_id, thread_id, kimi_session_id, work_dir, source,
			last_inbound_message_id, last_outbound_message_id, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		binding.BindingID,
		binding.Key.Platform,
		nullIfEmpty(binding.Key.AccountID),
		binding.Key.ChatID,
		nullIfEmpty(binding.Key.ThreadID),
		binding.KimiSessionID,
		nullIfEmpty(binding.WorkDir),
		binding.Source,
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
		`SELECT binding_id, platform, ifnull(account_id, ''), chat_id, ifnull(thread_id, ''), kimi_session_id,
		        ifnull(work_dir, ''), source, ifnull(last_inbound_message_id, ''), ifnull(last_outbound_message_id, ''),
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
		`SELECT binding_id, platform, ifnull(account_id, ''), chat_id, ifnull(thread_id, ''), kimi_session_id,
		        ifnull(work_dir, ''), created_at, updated_at, ifnull(last_inbound_message_id, '')
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
			&record.Platform,
			&record.AccountID,
			&record.ChatID,
			&record.ThreadID,
			&record.KimiSessionID,
			&record.WorkDir,
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

func (s *Store) Rebind(ctx context.Context, bindingID string, kimiSessionID string, source string) error {
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE channel_bindings
		 SET kimi_session_id = ?, source = ?, updated_at = ?
		 WHERE binding_id = ?`,
		kimiSessionID,
		source,
		nowRFC3339(),
		bindingID,
	)
	if err != nil {
		return fmt.Errorf("failed to rebind %s: %w", bindingID, err)
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
			approval_id, kimi_session_id, turn_id, step_id, platform, chat_id, thread_id, request_kind, prompt, status,
			request_payload_json, resolution_payload_json, dedupe_key, created_at, updated_at, resolved_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		ticket.ApprovalID,
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
	query := `SELECT approval_id, kimi_session_id, ifnull(turn_id, ''), ifnull(step_id, ''), request_kind,
	          prompt, platform, chat_id, ifnull(thread_id, ''), status, request_payload_json,
	          ifnull(resolution_payload_json, ''), dedupe_key, created_at, updated_at, ifnull(resolved_at, '')
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
		`SELECT approval_id, kimi_session_id, ifnull(turn_id, ''), ifnull(step_id, ''), request_kind,
		        prompt, platform, chat_id, ifnull(thread_id, ''), status, request_payload_json,
		        ifnull(resolution_payload_json, ''), dedupe_key, created_at, updated_at, ifnull(resolved_at, '')
		 FROM approval_requests
		 WHERE approval_id = ?`,
		approvalID,
	)

	var ticket domain.ApprovalTicket
	if err := row.Scan(
		&ticket.ApprovalID,
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
			event_id, platform, chat_id, thread_id, direction, delivery_key, source_message_id,
			payload_json, status, error_message, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		event.EventID,
		event.Platform,
		event.ChatID,
		nullIfEmpty(event.ThreadID),
		event.Direction,
		event.DeliveryKey,
		nullIfEmpty(event.SourceMessageID),
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
		`SELECT event_id, platform, chat_id, ifnull(thread_id, ''), direction, delivery_key,
		        ifnull(source_message_id, ''), payload_json, status, ifnull(error_message, ''), created_at, updated_at
		 FROM delivery_events
		 WHERE delivery_key = ?`,
		deliveryKey,
	)

	var event domain.DeliveryEvent
	if err := row.Scan(
		&event.EventID,
		&event.Platform,
		&event.ChatID,
		&event.ThreadID,
		&event.Direction,
		&event.DeliveryKey,
		&event.SourceMessageID,
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

func scanBinding(scanner interface {
	Scan(dest ...any) error
}) (*domain.SessionBinding, error) {
	var binding domain.SessionBinding
	if err := scanner.Scan(
		&binding.BindingID,
		&binding.Key.Platform,
		&binding.Key.AccountID,
		&binding.Key.ChatID,
		&binding.Key.ThreadID,
		&binding.KimiSessionID,
		&binding.WorkDir,
		&binding.Source,
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

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
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

func offsetKindForPlatform(platform string) string {
	switch strings.TrimSpace(strings.ToLower(platform)) {
	case "feishu":
		return "feishu_checkpoint"
	case "telegram":
		fallthrough
	default:
		return "telegram_update"
	}
}

func ExpectedUserVersion() int {
	return userVersion
}
