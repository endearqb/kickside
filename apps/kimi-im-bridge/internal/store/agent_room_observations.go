package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

var (
	ErrPaneGenerationStale     = errors.New("pane observation generation is stale")
	ErrPaneGenerationConflict  = errors.New("pane observation generation conflicts with accepted snapshot")
	ErrPaneObservationInvalid  = errors.New("pane session observation is invalid")
	ErrObserverCheckpointStale = errors.New("observer checkpoint is stale")
	ErrObserverSequenceGap     = errors.New("observer sequence is not contiguous")
	ErrObserverEpochConflict   = errors.New("observer epoch requires reconciliation")
)

type SessionObservationBatch struct {
	Generation  int64
	Epoch       string
	FirstSeq    int64
	LastSeq     int64
	LastEventAt string
	Observation domain.SessionObservation
	Events      []domain.AgentRoomEvent
	Run         *domain.AgentRun
	Approval    *domain.ApprovalTicket
	Reconciled  bool
}

// ApplySessionObservationBatch atomically adopts one contiguous Runtime batch.
// Network reconciliation must happen before this call; the transaction only
// validates and persists the resulting projection.
func (s *Store) ApplySessionObservationBatch(ctx context.Context, batch SessionObservationBatch) (duplicate bool, err error) {
	sessionID := strings.TrimSpace(batch.Observation.SessionID)
	epoch := strings.TrimSpace(batch.Epoch)
	if sessionID == "" || batch.Generation < 0 || batch.LastSeq < 0 || (!batch.Reconciled && (batch.FirstSeq <= 0 || batch.LastSeq < batch.FirstSeq)) {
		return false, ErrAgentRoomCursorInvalid
	}
	batch.Observation.SessionID = sessionID
	batch.Observation.Generation = batch.Generation
	batch.Observation.LastSeq = batch.LastSeq
	batch.Observation.Epoch = epoch
	if value := strings.TrimSpace(batch.LastEventAt); value != "" {
		batch.Observation.LastEventAt = value
	}
	now := nowRFC3339()
	batch.Observation.UpdatedAt = now

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	var currentGeneration, currentSeq int64
	var currentEpoch string
	err = tx.QueryRowContext(ctx, `SELECT ifnull(r.runtime_generation, 0), ifnull(c.last_seq, 0), ifnull(c.epoch, '')
		FROM bridge_sessions b
		LEFT JOIN session_observer_runtime_state r ON r.session_id = b.kimi_session_id
		LEFT JOIN session_watch_cursors c ON c.session_id = b.kimi_session_id
		WHERE b.kimi_session_id = ?`, sessionID).Scan(&currentGeneration, &currentSeq, &currentEpoch)
	if errors.Is(err, sql.ErrNoRows) {
		return false, ErrAgentRoomNotFound
	}
	if err != nil {
		return false, err
	}
	if batch.Generation < currentGeneration {
		return false, ErrObserverCheckpointStale
	}
	if batch.Generation == currentGeneration && epoch == currentEpoch && batch.LastSeq == currentSeq {
		for _, event := range batch.Events {
			normalized, _, normalizeErr := normalizeAgentRoomEvent(event)
			if normalizeErr != nil {
				return false, normalizeErr
			}
			stored, readErr := getAgentRoomEventTx(ctx, tx, normalized.EventID)
			if readErr != nil || !equivalentAgentRoomEvent(stored, normalized) {
				return false, fmt.Errorf("%w: event id %s has different content", ErrAgentRoomConflict, normalized.EventID)
			}
		}
		return true, nil
	}
	if currentEpoch != "" && epoch != currentEpoch && !batch.Reconciled {
		return false, ErrObserverEpochConflict
	}
	if !batch.Reconciled && (batch.FirstSeq != currentSeq+1 || batch.LastSeq < currentSeq) {
		return false, ErrObserverSequenceGap
	}

	for _, event := range batch.Events {
		event, artifactJSON, normalizeErr := normalizeAgentRoomEvent(event)
		if normalizeErr != nil {
			return false, normalizeErr
		}
		result, execErr := tx.ExecContext(ctx, `INSERT OR IGNORE INTO agent_room_events (
			event_id, room_id, member_id, agent_id, run_id, session_id, turn_id, prompt_id, kind, status,
			text_delta, display_text, approval_id, artifact_json, payload_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, event.EventID, nullIfEmpty(event.RoomID),
			nullIfEmpty(event.MemberID), nullIfEmpty(event.AgentID), nullIfEmpty(event.RunID), nullIfEmpty(event.SessionID),
			nullIfEmpty(event.TurnID), nullIfEmpty(event.PromptID), event.Kind, nullIfEmpty(event.Status),
			nullIfEmpty(event.TextDelta), nullIfEmpty(event.DisplayText), nullIfEmpty(event.ApprovalID),
			nullIfEmpty(artifactJSON), string(event.Payload), event.CreatedAt)
		if execErr != nil {
			return false, execErr
		}
		affected, execErr := result.RowsAffected()
		if execErr != nil {
			return false, execErr
		}
		if affected == 0 {
			stored, readErr := getAgentRoomEventTx(ctx, tx, event.EventID)
			if readErr != nil || !equivalentAgentRoomEvent(stored, event) {
				return false, fmt.Errorf("%w: event id %s has different content", ErrAgentRoomConflict, event.EventID)
			}
		}
	}
	if batch.Run != nil {
		run := *batch.Run
		controls, jsonErr := validJSON(run.Controls, []byte("{}"))
		if jsonErr != nil {
			return false, jsonErr
		}
		assembly, jsonErr := validJSON(run.PromptAssembly, []byte("{}"))
		if jsonErr != nil {
			return false, jsonErr
		}
		result, execErr := tx.ExecContext(ctx, `UPDATE agent_runs SET agent_id = ?, session_id = ?, work_dir = ?,
			turn_id = coalesce(nullif(?, ''), turn_id), prompt_id = coalesce(nullif(?, ''), prompt_id),
			origin_kind = ?, queue_policy = ?, status = ?, queue_position = ?, error_code = ?, error_message = ?,
			controls_json = ?, prompt_assembly_json = ?, started_at = ?, completed_at = ?, updated_at = ? WHERE run_id = ?`,
			nullIfEmpty(run.AgentID), nullIfEmpty(run.SessionID), nullIfEmpty(run.WorkDir), nullIfEmpty(run.TurnID),
			nullIfEmpty(run.PromptID), run.OriginKind, run.QueuePolicy, run.Status, nullInt(run.QueuePosition),
			nullIfEmpty(run.ErrorCode), nullIfEmpty(run.ErrorMessage), string(controls), string(assembly),
			nullIfEmpty(run.StartedAt), nullIfEmpty(run.CompletedAt), now, run.RunID)
		if execErr != nil {
			return false, execErr
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return false, ErrAgentRoomNotFound
		}
	}
	if batch.Approval != nil {
		ticket := *batch.Approval
		if ticket.ApprovalID == "" || ticket.KimiSessionID != sessionID {
			return false, ErrAgentRoomCursorInvalid
		}
		if ticket.CreatedAt == "" {
			ticket.CreatedAt = now
		}
		if ticket.UpdatedAt == "" {
			ticket.UpdatedAt = now
		}
		if ticket.RequestPayloadJSON == "" {
			ticket.RequestPayloadJSON = "{}"
		}
		if ticket.DedupeKey == "" {
			ticket.DedupeKey = "runtime:" + ticket.ApprovalID
		}
		_, execErr := tx.ExecContext(ctx, `INSERT INTO approval_requests (
			approval_id, connector_id, kimi_session_id, turn_id, step_id, platform, chat_id, thread_id, request_kind,
			prompt, status, request_payload_json, resolution_payload_json, dedupe_key, claimed_by_actor_id, claimed_at,
			platform_message_id, resolution_by, request_hash, created_at, updated_at, resolved_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(approval_id) DO UPDATE SET
			status = CASE WHEN excluded.status = 'pending' AND approval_requests.status <> 'pending' THEN approval_requests.status ELSE excluded.status END,
			resolution_payload_json = CASE WHEN excluded.status = 'pending' THEN approval_requests.resolution_payload_json ELSE excluded.resolution_payload_json END,
			resolution_by = CASE WHEN excluded.status = 'pending' THEN approval_requests.resolution_by ELSE excluded.resolution_by END,
			updated_at = excluded.updated_at,
			resolved_at = CASE WHEN excluded.status = 'pending' THEN approval_requests.resolved_at ELSE excluded.resolved_at END`,
			ticket.ApprovalID, nullIfEmpty(ticket.ConnectorID), ticket.KimiSessionID, nullIfEmpty(ticket.TurnID),
			nullIfEmpty(ticket.StepID), ticket.Platform, ticket.ChatID, nullIfEmpty(ticket.ThreadID), ticket.RequestKind,
			ticket.Prompt, ticket.Status, ticket.RequestPayloadJSON, nullIfEmpty(ticket.ResolutionPayloadJSON), ticket.DedupeKey,
			nullIfEmpty(ticket.ClaimedByActorID), nullIfEmpty(ticket.ClaimedAt), nullIfEmpty(ticket.PlatformMessageID),
			nullIfEmpty(ticket.ResolutionBy), nullIfEmpty(ticket.RequestHash), ticket.CreatedAt, ticket.UpdatedAt,
			nullIfEmpty(ticket.ResolvedAt))
		if execErr != nil {
			return false, execErr
		}
		if hasAgentRoomApprovalLink(ticket) {
			if execErr := upsertAgentRoomApprovalLink(ctx, tx, ticket); execErr != nil {
				return false, execErr
			}
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO session_observations (
		session_id, work_dir, last_seq, epoch, last_event_at, session_state, control_origin,
		current_turn_id, current_prompt_id, last_reply, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(session_id) DO UPDATE SET work_dir=excluded.work_dir, last_seq=excluded.last_seq,
		epoch=excluded.epoch, last_event_at=excluded.last_event_at, session_state=excluded.session_state,
		control_origin=excluded.control_origin, current_turn_id=excluded.current_turn_id,
		current_prompt_id=excluded.current_prompt_id, last_reply=excluded.last_reply, updated_at=excluded.updated_at`,
		sessionID, nullIfEmpty(batch.Observation.WorkDir), batch.LastSeq, nullIfEmpty(epoch),
		nullIfEmpty(batch.Observation.LastEventAt), batch.Observation.SessionState, batch.Observation.ControlOrigin,
		nullIfEmpty(batch.Observation.CurrentTurnID), nullIfEmpty(batch.Observation.CurrentPromptID),
		nullIfEmpty(batch.Observation.LastReply), now)
	if err != nil {
		return false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO session_watch_cursors (session_id, last_seq, epoch, last_event_at, updated_at)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET last_seq=excluded.last_seq,
		epoch=excluded.epoch, last_event_at=excluded.last_event_at, updated_at=excluded.updated_at`, sessionID,
		batch.LastSeq, nullIfEmpty(epoch), nullIfEmpty(batch.Observation.LastEventAt), now)
	if err != nil {
		return false, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO session_observer_runtime_state (session_id, runtime_generation, updated_at)
		VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET runtime_generation=excluded.runtime_generation,
		updated_at=excluded.updated_at`, sessionID, batch.Generation, now)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}
	if len(batch.Events) > 0 {
		s.notifyAgentRoomEvents()
	}
	return false, nil
}

func (s *Store) PutSessionWatchCursor(ctx context.Context, sessionID string, seq int64, epoch, lastEventAt string) error {
	if sessionID == "" || seq < 0 {
		return ErrAgentRoomCursorInvalid
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO session_watch_cursors (
		session_id, last_seq, epoch, last_event_at, updated_at
	) VALUES (?, ?, ?, ?, ?)
	ON CONFLICT(session_id) DO UPDATE SET
		last_seq = excluded.last_seq,
		epoch = excluded.epoch,
		last_event_at = excluded.last_event_at,
		updated_at = excluded.updated_at`, sessionID, seq, nullIfEmpty(epoch), nullIfEmpty(lastEventAt), nowRFC3339())
	if err != nil {
		return fmt.Errorf("failed to put session cursor %s: %w", sessionID, err)
	}
	return nil
}

func (s *Store) GetSessionWatchCursor(ctx context.Context, sessionID string) (seq int64, epoch, lastEventAt string, ok bool, err error) {
	err = s.db.QueryRowContext(ctx, `SELECT last_seq, ifnull(epoch, ''), ifnull(last_event_at, '')
		FROM session_watch_cursors WHERE session_id = ?`, sessionID).Scan(&seq, &epoch, &lastEventAt)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, "", "", false, nil
	}
	if err != nil {
		return 0, "", "", false, fmt.Errorf("failed to get session cursor %s: %w", sessionID, err)
	}
	return seq, epoch, lastEventAt, true, nil
}

func (s *Store) UpsertSessionObservation(ctx context.Context, item domain.SessionObservation) (domain.SessionObservation, error) {
	if item.SessionID == "" || item.LastSeq < 0 {
		return domain.SessionObservation{}, ErrAgentRoomCursorInvalid
	}
	item.UpdatedAt = nowRFC3339()
	_, err := s.db.ExecContext(ctx, `INSERT INTO session_observations (
		session_id, work_dir, last_seq, epoch, last_event_at, session_state, control_origin,
		current_turn_id, current_prompt_id, last_reply, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(session_id) DO UPDATE SET
		work_dir = excluded.work_dir,
		last_seq = excluded.last_seq,
		epoch = excluded.epoch,
		last_event_at = excluded.last_event_at,
		session_state = excluded.session_state,
		control_origin = excluded.control_origin,
		current_turn_id = excluded.current_turn_id,
		current_prompt_id = excluded.current_prompt_id,
		last_reply = excluded.last_reply,
		updated_at = excluded.updated_at`, item.SessionID, nullIfEmpty(item.WorkDir), item.LastSeq,
		nullIfEmpty(item.Epoch), nullIfEmpty(item.LastEventAt), item.SessionState, item.ControlOrigin,
		nullIfEmpty(item.CurrentTurnID), nullIfEmpty(item.CurrentPromptID), nullIfEmpty(item.LastReply), item.UpdatedAt)
	if err != nil {
		return domain.SessionObservation{}, fmt.Errorf("failed to upsert session observation %s: %w", item.SessionID, err)
	}
	return item, nil
}

func (s *Store) GetSessionObservation(ctx context.Context, sessionID string) (*domain.SessionObservation, error) {
	var item domain.SessionObservation
	err := s.db.QueryRowContext(ctx, `SELECT o.session_id, ifnull(r.runtime_generation, 0), ifnull(o.work_dir, ''), o.last_seq, ifnull(o.epoch, ''),
		ifnull(o.last_event_at, ''), o.session_state, o.control_origin, ifnull(o.current_turn_id, ''),
		ifnull(o.current_prompt_id, ''), ifnull(o.last_reply, ''),
		(SELECT count(*) FROM approval_requests a WHERE a.kimi_session_id = o.session_id AND a.status = 'pending'), o.updated_at
		FROM session_observations o LEFT JOIN session_observer_runtime_state r ON r.session_id = o.session_id
		WHERE o.session_id = ?`, sessionID).Scan(&item.SessionID, &item.Generation, &item.WorkDir,
		&item.LastSeq, &item.Epoch, &item.LastEventAt, &item.SessionState, &item.ControlOrigin,
		&item.CurrentTurnID, &item.CurrentPromptID, &item.LastReply, &item.PendingApprovals, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get session observation %s: %w", sessionID, err)
	}
	return &item, nil
}

func (s *Store) UpsertPaneSessionObservation(ctx context.Context, item domain.PaneSessionObservation) (domain.PaneSessionObservation, error) {
	if item.PaneID == "" {
		return domain.PaneSessionObservation{}, errors.New("pane id is required")
	}
	item.UpdatedAt = nowRFC3339()
	_, err := s.db.ExecContext(ctx, `INSERT INTO pane_session_observations (
		pane_id, persisted_session_id, active_session_id, effective_session_id, work_dir, visible, active,
		maximized, mount_policy, load_state, generation, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	ON CONFLICT(pane_id) DO UPDATE SET
		persisted_session_id = excluded.persisted_session_id,
		active_session_id = excluded.active_session_id,
		effective_session_id = excluded.effective_session_id,
		work_dir = excluded.work_dir,
		visible = excluded.visible,
		active = excluded.active,
		maximized = excluded.maximized,
		mount_policy = excluded.mount_policy,
		load_state = excluded.load_state,
		generation = excluded.generation,
		updated_at = excluded.updated_at`, item.PaneID, nullIfEmpty(item.PersistedSessionID),
		nullIfEmpty(item.ActiveSessionID), nullIfEmpty(item.EffectiveSessionID), nullIfEmpty(item.WorkDir),
		boolToInt(item.Visible), boolToInt(item.Active), boolToInt(item.Maximized), item.MountPolicy,
		item.LoadState, item.Generation, item.UpdatedAt)
	if err != nil {
		return domain.PaneSessionObservation{}, fmt.Errorf("failed to upsert pane observation %s: %w", item.PaneID, err)
	}
	return item, nil
}

func (s *Store) GetPaneSessionObservation(ctx context.Context, paneID string) (*domain.PaneSessionObservation, error) {
	var item domain.PaneSessionObservation
	var visible, active, maximized int
	err := s.db.QueryRowContext(ctx, `SELECT pane_id, ifnull(persisted_session_id, ''), ifnull(active_session_id, ''),
		ifnull(effective_session_id, ''), ifnull(work_dir, ''), visible, active, maximized, mount_policy,
		load_state, generation, updated_at FROM pane_session_observations WHERE pane_id = ?`, paneID).Scan(
		&item.PaneID, &item.PersistedSessionID, &item.ActiveSessionID, &item.EffectiveSessionID, &item.WorkDir,
		&visible, &active, &maximized, &item.MountPolicy, &item.LoadState, &item.Generation, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get pane observation %s: %w", paneID, err)
	}
	item.Visible, item.Active, item.Maximized = visible != 0, active != 0, maximized != 0
	return &item, nil
}

func (s *Store) ListPaneSessionObservations(ctx context.Context) ([]domain.PaneSessionObservation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT pane_id, ifnull(persisted_session_id, ''), ifnull(active_session_id, ''),
		ifnull(effective_session_id, ''), ifnull(work_dir, ''), visible, active, maximized, mount_policy,
		load_state, generation, updated_at FROM pane_session_observations ORDER BY pane_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list pane observations: %w", err)
	}
	defer rows.Close()
	items := []domain.PaneSessionObservation{}
	for rows.Next() {
		var item domain.PaneSessionObservation
		var visible, active, maximized int
		if err := rows.Scan(&item.PaneID, &item.PersistedSessionID, &item.ActiveSessionID,
			&item.EffectiveSessionID, &item.WorkDir, &visible, &active, &maximized, &item.MountPolicy,
			&item.LoadState, &item.Generation, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan pane observation: %w", err)
		}
		item.Visible, item.Active, item.Maximized = visible != 0, active != 0, maximized != 0
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListSessionObservations(ctx context.Context) ([]domain.SessionObservation, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT o.session_id, ifnull(r.runtime_generation, 0), ifnull(o.work_dir, ''), o.last_seq, ifnull(o.epoch, ''),
		ifnull(o.last_event_at, ''), o.session_state, o.control_origin, ifnull(o.current_turn_id, ''),
		ifnull(o.current_prompt_id, ''), ifnull(o.last_reply, ''),
		(SELECT count(*) FROM approval_requests a WHERE a.kimi_session_id = o.session_id AND a.status = 'pending'), o.updated_at
		FROM session_observations o LEFT JOIN session_observer_runtime_state r ON r.session_id = o.session_id
		ORDER BY o.session_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list session observations: %w", err)
	}
	defer rows.Close()
	items := []domain.SessionObservation{}
	for rows.Next() {
		var item domain.SessionObservation
		if err := rows.Scan(&item.SessionID, &item.Generation, &item.WorkDir, &item.LastSeq, &item.Epoch, &item.LastEventAt,
			&item.SessionState, &item.ControlOrigin, &item.CurrentTurnID, &item.CurrentPromptID,
			&item.LastReply, &item.PendingApprovals, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("failed to scan session observation: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// SyncPaneSessionObservations accepts one complete Shell snapshot. Generation is
// global and monotonic; stale snapshots cannot overwrite newer pane state.
func (s *Store) SyncPaneSessionObservations(ctx context.Context, generation int64, panes []domain.PaneSessionObservation) ([]string, error) {
	if generation < 0 {
		return nil, ErrPaneGenerationStale
	}
	normalized, sessions, snapshotHash, err := normalizePaneSnapshot(generation, panes)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var currentGeneration int64
	var currentHash string
	if err := tx.QueryRowContext(ctx, `SELECT pane_generation, pane_snapshot_hash FROM agent_room_runtime_state WHERE singleton = 1`).Scan(&currentGeneration, &currentHash); err != nil {
		return nil, err
	}
	if generation < currentGeneration {
		return nil, ErrPaneGenerationStale
	}
	if generation == currentGeneration {
		if snapshotHash != currentHash {
			return nil, ErrPaneGenerationConflict
		}
		return sessions, nil
	}
	seenPanes := make(map[string]struct{}, len(normalized))
	now := nowRFC3339()
	for _, pane := range normalized {
		seenPanes[pane.PaneID] = struct{}{}
		pane.UpdatedAt = now
		_, err := tx.ExecContext(ctx, `INSERT INTO pane_session_observations (
			pane_id, persisted_session_id, active_session_id, effective_session_id, work_dir, visible, active,
			maximized, mount_policy, load_state, generation, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(pane_id) DO UPDATE SET
			persisted_session_id = excluded.persisted_session_id, active_session_id = excluded.active_session_id,
			effective_session_id = excluded.effective_session_id, work_dir = excluded.work_dir,
			visible = excluded.visible, active = excluded.active, maximized = excluded.maximized,
			mount_policy = excluded.mount_policy, load_state = excluded.load_state,
			generation = excluded.generation, updated_at = excluded.updated_at`, pane.PaneID,
			nullIfEmpty(pane.PersistedSessionID), nullIfEmpty(pane.ActiveSessionID), nullIfEmpty(pane.EffectiveSessionID),
			nullIfEmpty(strings.TrimSpace(pane.WorkDir)), boolToInt(pane.Visible), boolToInt(pane.Active),
			boolToInt(pane.Maximized), strings.TrimSpace(pane.MountPolicy), strings.TrimSpace(pane.LoadState), generation, now)
		if err != nil {
			return nil, fmt.Errorf("failed to sync pane observation %s: %w", pane.PaneID, err)
		}
	}
	if len(seenPanes) == 0 {
		if _, err := tx.ExecContext(ctx, `DELETE FROM pane_session_observations WHERE generation <= ?`, generation); err != nil {
			return nil, err
		}
	} else {
		args := make([]any, 0, len(seenPanes)+1)
		args = append(args, generation)
		placeholders := make([]string, 0, len(seenPanes))
		for paneID := range seenPanes {
			placeholders = append(placeholders, "?")
			args = append(args, paneID)
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM pane_session_observations WHERE generation <= ? AND pane_id NOT IN (`+strings.Join(placeholders, ",")+`)`, args...); err != nil {
			return nil, err
		}
	}
	if err := syncFollowedPaneMembers(ctx, tx, normalized, now); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE agent_room_runtime_state SET pane_generation = ?, pane_snapshot_hash = ?, updated_at = ? WHERE singleton = 1`, generation, snapshotHash, now); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return sessions, nil
}

func syncFollowedPaneMembers(ctx context.Context, tx *sql.Tx, panes []domain.PaneSessionObservation, now string) error {
	paneByID := make(map[string]domain.PaneSessionObservation, len(panes))
	for _, pane := range panes {
		paneByID[pane.PaneID] = pane
	}
	rows, err := tx.QueryContext(ctx, `SELECT member_id, ifnull(followed_pane_id, '') FROM agent_room_members WHERE follow_mode = 'follow_pane'`)
	if err != nil {
		return err
	}
	type followedMember struct{ memberID, paneID string }
	members := []followedMember{}
	for rows.Next() {
		var member followedMember
		if err := rows.Scan(&member.memberID, &member.paneID); err != nil {
			rows.Close()
			return err
		}
		members = append(members, member)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, member := range members {
		pane, ok := paneByID[member.paneID]
		if !ok {
			if _, err := tx.ExecContext(ctx, `UPDATE agent_room_members SET effective_session_id = NULL, status = 'pane_unavailable', updated_at = ? WHERE member_id = ?`, now, member.memberID); err != nil {
				return err
			}
			continue
		}
		if pane.EffectiveSessionID == "" {
			if _, err := tx.ExecContext(ctx, `UPDATE agent_room_members SET effective_session_id = NULL, status = 'session_unresolved', updated_at = ? WHERE member_id = ?`, now, member.memberID); err != nil {
				return err
			}
			continue
		}
		var sessionWorkspace string
		err := tx.QueryRowContext(ctx, `SELECT work_dir FROM bridge_sessions WHERE kimi_session_id = ?`, pane.EffectiveSessionID).Scan(&sessionWorkspace)
		if errors.Is(err, sql.ErrNoRows) {
			if _, err := tx.ExecContext(ctx, `UPDATE agent_room_members SET effective_session_id = NULL, status = 'session_unresolved', updated_at = ? WHERE member_id = ?`, now, member.memberID); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if pane.WorkDir != "" && !sameStoredWorkspace(pane.WorkDir, sessionWorkspace) {
			if _, err := tx.ExecContext(ctx, `UPDATE agent_room_members SET effective_session_id = NULL, status = 'workspace_mismatch', updated_at = ? WHERE member_id = ?`, now, member.memberID); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE agent_room_members SET workspace_root = ?, effective_session_id = ?, status = 'idle', updated_at = ? WHERE member_id = ?`, sessionWorkspace, pane.EffectiveSessionID, now, member.memberID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) GetPaneObservationGeneration(ctx context.Context) (int64, error) {
	var generation int64
	err := s.db.QueryRowContext(ctx, `SELECT pane_generation FROM agent_room_runtime_state WHERE singleton = 1`).Scan(&generation)
	return generation, err
}

func normalizePaneSnapshot(generation int64, panes []domain.PaneSessionObservation) ([]domain.PaneSessionObservation, []string, string, error) {
	if len(panes) > 12 {
		return nil, nil, "", ErrPaneObservationInvalid
	}
	normalized := make([]domain.PaneSessionObservation, 0, len(panes))
	seenPanes := map[string]struct{}{}
	seenSessions := map[string]struct{}{}
	for _, pane := range panes {
		pane.PaneID = strings.TrimSpace(pane.PaneID)
		pane.PersistedSessionID = strings.TrimSpace(pane.PersistedSessionID)
		pane.ActiveSessionID = strings.TrimSpace(pane.ActiveSessionID)
		pane.WorkDir = strings.TrimSpace(pane.WorkDir)
		pane.MountPolicy = strings.TrimSpace(pane.MountPolicy)
		pane.LoadState = strings.TrimSpace(pane.LoadState)
		if pane.MountPolicy == "" {
			pane.MountPolicy = "eager"
		}
		if pane.LoadState == "" {
			pane.LoadState = "idle"
		}
		if !validPaneMountPolicy(pane.MountPolicy) || !validPaneLoadState(pane.LoadState) {
			return nil, nil, "", ErrPaneObservationInvalid
		}
		effective := pane.ActiveSessionID
		if effective == "" {
			effective = pane.PersistedSessionID
		}
		if pane.PaneID == "" || (strings.TrimSpace(pane.EffectiveSessionID) != "" && strings.TrimSpace(pane.EffectiveSessionID) != effective) {
			return nil, nil, "", ErrPaneObservationInvalid
		}
		if _, exists := seenPanes[pane.PaneID]; exists {
			return nil, nil, "", ErrPaneObservationInvalid
		}
		seenPanes[pane.PaneID] = struct{}{}
		pane.EffectiveSessionID, pane.Generation, pane.UpdatedAt = effective, generation, ""
		if effective != "" {
			seenSessions[effective] = struct{}{}
		}
		normalized = append(normalized, pane)
	}
	sort.Slice(normalized, func(i, j int) bool { return normalized[i].PaneID < normalized[j].PaneID })
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return nil, nil, "", err
	}
	digest := sha256.Sum256(encoded)
	sessions := make([]string, 0, len(seenSessions))
	for sessionID := range seenSessions {
		sessions = append(sessions, sessionID)
	}
	sort.Strings(sessions)
	return normalized, sessions, fmt.Sprintf("%x", digest[:]), nil
}

func validPaneMountPolicy(value string) bool {
	switch value {
	case "eager", "on-focus", "manual", "suspended":
		return true
	default:
		return false
	}
}

func validPaneLoadState(value string) bool {
	switch value {
	case "idle", "loading", "ready", "blocked", "empty", "suspended":
		return true
	default:
		return false
	}
}

func (s *Store) PinSessionObservation(ctx context.Context, sessionID string) (bool, error) {
	sessionID = strings.TrimSpace(sessionID)
	now := nowRFC3339()
	result, err := s.db.ExecContext(ctx, `INSERT OR IGNORE INTO agent_room_observation_pins (session_id, created_at, updated_at)
		SELECT kimi_session_id, ?, ? FROM bridge_sessions WHERE kimi_session_id = ?`, now, now, sessionID)
	if err != nil {
		return false, fmt.Errorf("failed to pin session observation: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if affected == 0 {
		var exists int
		if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM bridge_sessions WHERE kimi_session_id = ?`, sessionID).Scan(&exists); err != nil {
			return false, err
		}
		if exists == 0 {
			return false, ErrAgentRoomNotFound
		}
	}
	return affected > 0, nil
}

func (s *Store) UnpinSessionObservation(ctx context.Context, sessionID string) (bool, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM agent_room_observation_pins WHERE session_id = ?`, strings.TrimSpace(sessionID))
	if err != nil {
		return false, fmt.Errorf("failed to unpin session observation: %w", err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

func (s *Store) ListPinnedSessionObservations(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT session_id FROM agent_room_observation_pins ORDER BY session_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list observation pins: %w", err)
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

// ListAgentRoomWatchSessionIDs returns the exact deduplicated set that keeps
// the shared Runtime observer alive. Empty references are never subscribed.
func (s *Store) ListAgentRoomWatchSessionIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT session_id FROM (
		SELECT effective_session_id AS session_id FROM pane_session_observations WHERE trim(ifnull(effective_session_id, '')) <> ''
		UNION SELECT m.effective_session_id FROM agent_room_members m JOIN agent_rooms r ON r.room_id = m.room_id
			WHERE r.archived = 0 AND trim(ifnull(m.effective_session_id, '')) <> ''
		UNION SELECT session_id FROM agent_runs WHERE trim(ifnull(session_id, '')) <> '' AND status IN (
			'resolving_session','waiting_for_lease','queued','submitting','running','waiting_approval','completing','abort_requested'
		)
		UNION SELECT l.session_id FROM agent_room_approval_links l JOIN approval_requests a ON a.approval_id = l.approval_id
			WHERE a.status = 'pending' AND trim(l.session_id) <> ''
		UNION SELECT session_id FROM agent_room_observation_pins
	) ORDER BY session_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list observer watch set: %w", err)
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

// ResolveObservedAgentRun uses only exact identifiers or a unique active Run.
// Ambiguity deliberately returns nil so an external Runtime event is not
// attributed to the wrong Room.
func (s *Store) ResolveObservedAgentRun(ctx context.Context, sessionID, runID, promptID, turnID string) (*domain.AgentRun, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, nil
	}
	queries := []struct {
		clause string
		value  string
	}{
		{"run_id = ?", strings.TrimSpace(runID)},
		{"prompt_id = ?", strings.TrimSpace(promptID)},
		{"turn_id = ?", strings.TrimSpace(turnID)},
	}
	for _, candidate := range queries {
		if candidate.value == "" {
			continue
		}
		runs, err := listObservedRuns(ctx, s.db, candidate.clause+` AND session_id = ?`, candidate.value, sessionID)
		if err != nil {
			return nil, err
		}
		if len(runs) == 1 {
			return &runs[0], nil
		}
	}
	runs, err := listObservedRuns(ctx, s.db, `session_id = ? AND status IN (
		'resolving_session','waiting_for_lease','queued','submitting','running','waiting_approval','completing','abort_requested'
	)`, sessionID)
	if err != nil || len(runs) != 1 {
		return nil, err
	}
	return &runs[0], nil
}

func listObservedRuns(ctx context.Context, db *sql.DB, clause string, args ...any) ([]domain.AgentRun, error) {
	rows, err := db.QueryContext(ctx, agentRunSelect+` WHERE `+clause+` ORDER BY created_at DESC, run_id DESC LIMIT 2`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runs := []domain.AgentRun{}
	for rows.Next() {
		run, err := scanAgentRun(rows)
		if err != nil {
			return nil, err
		}
		runs = append(runs, run)
	}
	return runs, rows.Err()
}

func (s *Store) IsPaneSessionObserved(ctx context.Context, sessionID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM pane_session_observations WHERE effective_session_id = ?`, strings.TrimSpace(sessionID)).Scan(&count)
	return count > 0, err
}

func (s *Store) AgentRoomSummaryCounts(ctx context.Context) (activeRuns, queueDepth, observedSessions int, err error) {
	if err = s.db.QueryRowContext(ctx, `SELECT count(*) FROM agent_runs WHERE status IN (
		'resolving_session','waiting_for_lease','submitting','running','waiting_approval','completing','abort_requested'
	)`).Scan(&activeRuns); err != nil {
		return 0, 0, 0, err
	}
	if err = s.db.QueryRowContext(ctx, `SELECT count(*) FROM session_prompt_queue`).Scan(&queueDepth); err != nil {
		return 0, 0, 0, err
	}
	if err = s.db.QueryRowContext(ctx, `SELECT count(*) FROM session_observations`).Scan(&observedSessions); err != nil {
		return 0, 0, 0, err
	}
	return activeRuns, queueDepth, observedSessions, nil
}
