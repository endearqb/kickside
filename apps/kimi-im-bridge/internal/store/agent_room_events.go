package store

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

// 501 permits Admin long-poll to fetch one look-ahead item for the public
// maximum page size of 500 without issuing a second query.
const maxAgentRoomEventPage = 501

var (
	ErrAgentRoomCursorInvalid = errors.New("agent room event cursor invalid")
	ErrAgentRoomCursorTooOld  = errors.New("agent room event cursor too old")
	ErrAgentRoomPageTooLarge  = errors.New("agent room event page limit exceeded")
)

type AgentRoomEventQuery struct {
	RoomID    string
	SessionID string
	AfterSeq  int64
	BeforeSeq int64
	Limit     int
}

func (s *Store) AppendAgentRoomEvent(ctx context.Context, event domain.AgentRoomEvent) (domain.AgentRoomEvent, error) {
	items, err := s.AppendAgentRoomEvents(ctx, []domain.AgentRoomEvent{event})
	if err != nil {
		return domain.AgentRoomEvent{}, err
	}
	return items[0], nil
}

func (s *Store) AppendAgentRoomEvents(ctx context.Context, events []domain.AgentRoomEvent) (items []domain.AgentRoomEvent, err error) {
	if len(events) == 0 {
		return []domain.AgentRoomEvent{}, nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to begin room event batch: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	items = make([]domain.AgentRoomEvent, 0, len(events))
	for _, event := range events {
		event, artifactJSON, err := normalizeAgentRoomEvent(event)
		if err != nil {
			return nil, err
		}
		result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO agent_room_events (
			event_id, room_id, member_id, agent_id, run_id, session_id, turn_id, prompt_id, kind, status,
			text_delta, display_text, approval_id, artifact_json, payload_json, created_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, event.EventID, nullIfEmpty(event.RoomID),
			nullIfEmpty(event.MemberID), nullIfEmpty(event.AgentID), nullIfEmpty(event.RunID),
			nullIfEmpty(event.SessionID), nullIfEmpty(event.TurnID), nullIfEmpty(event.PromptID), event.Kind,
			nullIfEmpty(event.Status), nullIfEmpty(event.TextDelta), nullIfEmpty(event.DisplayText),
			nullIfEmpty(event.ApprovalID), nullIfEmpty(artifactJSON), string(event.Payload), event.CreatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to append room event %s: %w", event.EventID, err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return nil, err
		}
		stored, err := getAgentRoomEventTx(ctx, tx, event.EventID)
		if err != nil {
			return nil, err
		}
		if affected == 0 && !equivalentAgentRoomEvent(stored, event) {
			return nil, fmt.Errorf("%w: event id %s has different content", ErrAgentRoomConflict, event.EventID)
		}
		items = append(items, stored)
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit room event batch: %w", err)
	}
	s.notifyAgentRoomEvents()
	return items, nil
}

func (s *Store) ListAgentRoomEvents(ctx context.Context, query AgentRoomEventQuery) ([]domain.AgentRoomEvent, error) {
	if query.AfterSeq < 0 || query.BeforeSeq < 0 || (query.AfterSeq > 0 && query.BeforeSeq > 0 && query.AfterSeq >= query.BeforeSeq) {
		return nil, ErrAgentRoomCursorInvalid
	}
	if query.Limit <= 0 {
		query.Limit = 100
	}
	if query.Limit > maxAgentRoomEventPage {
		return nil, ErrAgentRoomPageTooLarge
	}
	var maxSeq, compactedThrough int64
	if err := s.db.QueryRowContext(ctx, `SELECT ifnull(max(seq), 0) FROM agent_room_events`).Scan(&maxSeq); err != nil {
		return nil, fmt.Errorf("failed to inspect room event cursor: %w", err)
	}
	if err := s.db.QueryRowContext(ctx, `SELECT compacted_through_seq FROM agent_room_event_state WHERE singleton = 1`).Scan(&compactedThrough); err != nil {
		return nil, fmt.Errorf("failed to inspect room event compaction cursor: %w", err)
	}
	if compactedThrough > maxSeq {
		maxSeq = compactedThrough
	}
	if query.AfterSeq < compactedThrough {
		return nil, ErrAgentRoomCursorTooOld
	}
	if query.AfterSeq > maxSeq {
		return nil, ErrAgentRoomCursorInvalid
	}

	clauses := []string{"seq > ?"}
	args := []any{query.AfterSeq}
	order := "ASC"
	if query.BeforeSeq > 0 {
		clauses = append(clauses, "seq < ?")
		args = append(args, query.BeforeSeq)
		order = "DESC"
	}
	if query.RoomID != "" {
		clauses = append(clauses, "room_id = ?")
		args = append(args, query.RoomID)
	}
	if query.SessionID != "" {
		clauses = append(clauses, "session_id = ?")
		args = append(args, query.SessionID)
	}
	args = append(args, query.Limit)
	rows, err := s.db.QueryContext(ctx, agentRoomEventSelect+` WHERE `+strings.Join(clauses, " AND ")+` ORDER BY seq `+order+` LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list room events: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentRoomEvent{}
	for rows.Next() {
		item, err := scanAgentRoomEvent(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan room event: %w", err)
		}
		items = append(items, item)
	}
	if query.BeforeSeq > 0 {
		for left, right := 0, len(items)-1; left < right; left, right = left+1, right-1 {
			items[left], items[right] = items[right], items[left]
		}
	}
	return items, rows.Err()
}

func (s *Store) ListAgentRoomEventsByRun(ctx context.Context, roomID, runID string, limit int) ([]domain.AgentRoomEvent, error) {
	if limit <= 0 || limit > maxAgentRoomEventPage {
		limit = 500
	}
	rows, err := s.db.QueryContext(ctx, agentRoomEventSelect+` WHERE room_id = ? AND run_id = ? ORDER BY seq ASC LIMIT ?`, strings.TrimSpace(roomID), strings.TrimSpace(runID), limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list room events by run: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentRoomEvent{}
	for rows.Next() {
		item, scanErr := scanAgentRoomEvent(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("failed to scan room event by run: %w", scanErr)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) WaitAgentRoomEvents(ctx context.Context, query AgentRoomEventQuery, wait time.Duration) ([]domain.AgentRoomEvent, error) {
	for {
		items, err := s.ListAgentRoomEvents(ctx, query)
		if err != nil || len(items) > 0 || wait <= 0 {
			return items, err
		}

		s.eventMu.Lock()
		if s.eventWait == nil {
			s.eventWait = make(chan struct{})
		}
		wake := s.eventWait
		s.eventMu.Unlock()

		items, err = s.ListAgentRoomEvents(ctx, query)
		if err != nil || len(items) > 0 {
			return items, err
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, ctx.Err()
		case <-timer.C:
			return []domain.AgentRoomEvent{}, nil
		case <-wake:
			if !timer.Stop() {
				<-timer.C
			}
		}
	}
}

func (s *Store) notifyAgentRoomEvents() {
	s.eventMu.Lock()
	defer s.eventMu.Unlock()
	if s.eventWait == nil {
		s.eventWait = make(chan struct{})
		return
	}
	close(s.eventWait)
	s.eventWait = make(chan struct{})
}

const agentRoomEventSelect = `SELECT seq, event_id, ifnull(room_id, ''), ifnull(member_id, ''),
	ifnull(agent_id, ''), ifnull(run_id, ''), ifnull(session_id, ''), ifnull(turn_id, ''),
	ifnull(prompt_id, ''), kind, ifnull(status, ''), ifnull(text_delta, ''), ifnull(display_text, ''),
	ifnull(artifact_json, ''), ifnull(approval_id, ''), payload_json, created_at FROM agent_room_events`

func getAgentRoomEventTx(ctx context.Context, tx *sql.Tx, eventID string) (domain.AgentRoomEvent, error) {
	item, err := scanAgentRoomEvent(tx.QueryRowContext(ctx, agentRoomEventSelect+` WHERE event_id = ?`, eventID))
	if err != nil {
		return domain.AgentRoomEvent{}, fmt.Errorf("failed to read room event %s: %w", eventID, err)
	}
	return item, nil
}

func scanAgentRoomEvent(row rowScanner) (domain.AgentRoomEvent, error) {
	var item domain.AgentRoomEvent
	var artifact, payload string
	err := row.Scan(&item.Seq, &item.EventID, &item.RoomID, &item.MemberID, &item.AgentID, &item.RunID,
		&item.SessionID, &item.TurnID, &item.PromptID, &item.Kind, &item.Status, &item.TextDelta,
		&item.DisplayText, &artifact, &item.ApprovalID, &payload, &item.CreatedAt)
	if err != nil {
		return item, err
	}
	item.Payload = json.RawMessage(payload)
	if artifact != "" {
		item.Artifact = &domain.RuntimeArtifact{}
		if err := json.Unmarshal([]byte(artifact), item.Artifact); err != nil {
			return item, err
		}
	}
	return item, nil
}

func normalizeAgentRoomEvent(event domain.AgentRoomEvent) (domain.AgentRoomEvent, string, error) {
	if strings.TrimSpace(event.EventID) == "" || strings.TrimSpace(event.Kind) == "" {
		return event, "", errors.New("event id and kind are required")
	}
	payload, err := canonicalJSON(event.Payload, []byte("{}"))
	if err != nil {
		return event, "", fmt.Errorf("invalid room event payload: %w", err)
	}
	event.Payload = payload
	if event.CreatedAt == "" {
		event.CreatedAt = nowRFC3339()
	}
	artifact := ""
	if event.Artifact != nil {
		raw, err := json.Marshal(event.Artifact)
		if err != nil {
			return event, "", fmt.Errorf("invalid room event artifact: %w", err)
		}
		artifact = string(raw)
	}
	return event, artifact, nil
}

func canonicalJSON(value json.RawMessage, fallback []byte) (json.RawMessage, error) {
	value, err := validJSON(value, fallback)
	if err != nil {
		return nil, err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, value); err != nil {
		return nil, err
	}
	return compact.Bytes(), nil
}

func equivalentAgentRoomEvent(left, right domain.AgentRoomEvent) bool {
	left.Seq, right.Seq = 0, 0
	left.CreatedAt, right.CreatedAt = "", ""
	return reflect.DeepEqual(left, right)
}
