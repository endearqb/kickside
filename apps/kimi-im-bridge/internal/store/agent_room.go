package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

var (
	ErrAgentRoomNotFound          = errors.New("agent room record not found")
	ErrAgentRoomConflict          = errors.New("agent room record conflict")
	ErrAgentRoomRevisionConflict  = errors.New("agent profile revision conflict")
	ErrAgentRoomArchived          = errors.New("agent room is archived")
	ErrAgentRoomBindingInvalid    = errors.New("agent room member binding is invalid")
	ErrAgentRoomPaneUnresolved    = errors.New("agent room pane session is unresolved")
	ErrAgentRoomSessionNotFound   = errors.New("agent room session was not found")
	ErrAgentRoomWorkspaceMismatch = errors.New("agent room workspace does not match session")
)

func (s *Store) CreateAgentProfile(ctx context.Context, profile domain.AgentProfile) (domain.AgentProfile, error) {
	controls, err := validJSON(profile.RuntimeControls, []byte("{}"))
	if err != nil {
		return domain.AgentProfile{}, fmt.Errorf("invalid agent runtime controls: %w", err)
	}
	now := nowRFC3339()
	if profile.CreatedAt == "" {
		profile.CreatedAt = now
	}
	profile.UpdatedAt = profile.CreatedAt
	if profile.Revision <= 0 {
		profile.Revision = 1
	}
	profile.RuntimeControls = controls
	_, err = s.db.ExecContext(ctx, `INSERT INTO agent_profiles (
		agent_id, name, avatar, description, role_prompt, default_work_dir, session_policy,
		pinned_session_id, auto_approve, runtime_controls_json, enabled, revision, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		profile.AgentID, profile.Name, nullIfEmpty(profile.Avatar), nullIfEmpty(profile.Description),
		profile.RolePrompt, profile.DefaultWorkDir, profile.SessionPolicy, nullIfEmpty(profile.PinnedSessionID),
		boolToInt(profile.AutoApprove), string(profile.RuntimeControls), boolToInt(profile.Enabled),
		profile.Revision, profile.CreatedAt, profile.UpdatedAt)
	if err != nil {
		return domain.AgentProfile{}, fmt.Errorf("failed to create agent profile %s: %w", profile.AgentID, err)
	}
	return profile, nil
}

func (s *Store) GetAgentProfile(ctx context.Context, agentID string) (*domain.AgentProfile, error) {
	row := s.db.QueryRowContext(ctx, agentProfileSelect+` WHERE agent_id = ?`, agentID)
	profile, err := scanAgentProfile(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get agent profile %s: %w", agentID, err)
	}
	return &profile, nil
}

func (s *Store) ListAgentProfiles(ctx context.Context) ([]domain.AgentProfile, error) {
	rows, err := s.db.QueryContext(ctx, agentProfileSelect+` ORDER BY name, agent_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list agent profiles: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentProfile{}
	for rows.Next() {
		item, err := scanAgentProfile(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan agent profile: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) UpdateAgentProfile(ctx context.Context, profile domain.AgentProfile, expectedRevision int64) (domain.AgentProfile, error) {
	controls, err := validJSON(profile.RuntimeControls, []byte("{}"))
	if err != nil {
		return domain.AgentProfile{}, fmt.Errorf("invalid agent runtime controls: %w", err)
	}
	profile.RuntimeControls = controls
	profile.UpdatedAt = nowRFC3339()
	result, err := s.db.ExecContext(ctx, `UPDATE agent_profiles SET
		name = ?, avatar = ?, description = ?, role_prompt = ?, default_work_dir = ?, session_policy = ?,
		pinned_session_id = ?, auto_approve = ?, runtime_controls_json = ?, enabled = ?,
		revision = revision + 1, updated_at = ?
		WHERE agent_id = ? AND revision = ?`, profile.Name, nullIfEmpty(profile.Avatar),
		nullIfEmpty(profile.Description), profile.RolePrompt, profile.DefaultWorkDir, profile.SessionPolicy,
		nullIfEmpty(profile.PinnedSessionID), boolToInt(profile.AutoApprove), string(profile.RuntimeControls),
		boolToInt(profile.Enabled), profile.UpdatedAt, profile.AgentID, expectedRevision)
	if err != nil {
		return domain.AgentProfile{}, fmt.Errorf("failed to update agent profile %s: %w", profile.AgentID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.AgentProfile{}, err
	}
	if affected == 0 {
		current, getErr := s.GetAgentProfile(ctx, profile.AgentID)
		if getErr != nil {
			return domain.AgentProfile{}, getErr
		}
		if current == nil {
			return domain.AgentProfile{}, ErrAgentRoomNotFound
		}
		return domain.AgentProfile{}, ErrAgentRoomRevisionConflict
	}
	profile.Revision = expectedRevision + 1
	return profile, nil
}

func (s *Store) DeleteAgentProfile(ctx context.Context, agentID string) (bool, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM agent_profiles WHERE agent_id = ?`, agentID)
	if err != nil {
		return false, fmt.Errorf("failed to delete agent profile %s: %w", agentID, err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

const agentProfileSelect = `SELECT agent_id, name, ifnull(avatar, ''), ifnull(description, ''), role_prompt,
	default_work_dir, session_policy, ifnull(pinned_session_id, ''), auto_approve,
	runtime_controls_json, enabled, revision, created_at, updated_at FROM agent_profiles`

type rowScanner interface {
	Scan(...any) error
}

func scanAgentProfile(row rowScanner) (domain.AgentProfile, error) {
	var item domain.AgentProfile
	var controls string
	var autoApprove, enabled int
	err := row.Scan(&item.AgentID, &item.Name, &item.Avatar, &item.Description, &item.RolePrompt,
		&item.DefaultWorkDir, &item.SessionPolicy, &item.PinnedSessionID, &autoApprove, &controls,
		&enabled, &item.Revision, &item.CreatedAt, &item.UpdatedAt)
	item.AutoApprove = autoApprove != 0
	item.Enabled = enabled != 0
	item.RuntimeControls = json.RawMessage(controls)
	return item, err
}

func (s *Store) CreateAgentRoom(ctx context.Context, room domain.AgentRoom) (domain.AgentRoom, error) {
	now := nowRFC3339()
	if room.CreatedAt == "" {
		room.CreatedAt = now
	}
	room.UpdatedAt = room.CreatedAt
	_, err := s.db.ExecContext(ctx, `INSERT INTO agent_rooms (
		room_id, title, description, shared_brief, orchestration_mode, archived, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, room.RoomID, room.Title, nullIfEmpty(room.Description),
		nullIfEmpty(room.SharedBrief), room.OrchestrationMode, boolToInt(room.Archived), room.CreatedAt, room.UpdatedAt)
	if err != nil {
		return domain.AgentRoom{}, fmt.Errorf("failed to create agent room %s: %w", room.RoomID, err)
	}
	return room, nil
}

func (s *Store) GetAgentRoom(ctx context.Context, roomID string) (*domain.AgentRoom, error) {
	room, err := scanAgentRoom(s.db.QueryRowContext(ctx, agentRoomSelect+` WHERE room_id = ?`, roomID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get agent room %s: %w", roomID, err)
	}
	return &room, nil
}

func (s *Store) ListAgentRooms(ctx context.Context, archived *bool, limit int) ([]domain.AgentRoom, error) {
	return s.ListAgentRoomsPage(ctx, archived, limit, "", "")
}

func (s *Store) ListAgentRoomsPage(ctx context.Context, archived *bool, limit int, beforeUpdatedAt, beforeRoomID string) ([]domain.AgentRoom, error) {
	if limit <= 0 || limit > 101 {
		limit = 50
	}
	query := agentRoomSelect
	args := []any{}
	clauses := []string{}
	if archived != nil {
		clauses = append(clauses, `archived = ?`)
		args = append(args, boolToInt(*archived))
	}
	if beforeUpdatedAt != "" {
		clauses = append(clauses, `(updated_at < ? OR (updated_at = ? AND room_id < ?))`)
		args = append(args, beforeUpdatedAt, beforeUpdatedAt, beforeRoomID)
	}
	if len(clauses) > 0 {
		query += ` WHERE ` + strings.Join(clauses, ` AND `)
	}
	query += ` ORDER BY updated_at DESC, room_id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list agent rooms: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentRoom{}
	for rows.Next() {
		item, err := scanAgentRoom(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan agent room: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) UpdateAgentRoom(ctx context.Context, room domain.AgentRoom) (domain.AgentRoom, error) {
	room.UpdatedAt = nowRFC3339()
	result, err := s.db.ExecContext(ctx, `UPDATE agent_rooms SET title = ?, description = ?, shared_brief = ?,
		orchestration_mode = ?, archived = ?, updated_at = ? WHERE room_id = ?`, room.Title,
		nullIfEmpty(room.Description), nullIfEmpty(room.SharedBrief), room.OrchestrationMode,
		boolToInt(room.Archived), room.UpdatedAt, room.RoomID)
	if err != nil {
		return domain.AgentRoom{}, fmt.Errorf("failed to update agent room %s: %w", room.RoomID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.AgentRoom{}, err
	}
	if affected == 0 {
		return domain.AgentRoom{}, ErrAgentRoomNotFound
	}
	return room, nil
}

func (s *Store) DeleteAgentRoom(ctx context.Context, roomID string) (bool, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM agent_rooms WHERE room_id = ?`, roomID)
	if err != nil {
		return false, fmt.Errorf("failed to delete agent room %s: %w", roomID, err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

const agentRoomSelect = `SELECT room_id, title, ifnull(description, ''), ifnull(shared_brief, ''),
	orchestration_mode, archived, created_at, updated_at FROM agent_rooms`

func scanAgentRoom(row rowScanner) (domain.AgentRoom, error) {
	var room domain.AgentRoom
	var archived int
	err := row.Scan(&room.RoomID, &room.Title, &room.Description, &room.SharedBrief,
		&room.OrchestrationMode, &archived, &room.CreatedAt, &room.UpdatedAt)
	room.Archived = archived != 0
	return room, err
}

func (s *Store) CreateAgentRoomMember(ctx context.Context, member domain.AgentRoomMember) (domain.AgentRoomMember, error) {
	controls, err := validJSON(member.RuntimeControls, []byte("{}"))
	if err != nil {
		return domain.AgentRoomMember{}, fmt.Errorf("invalid member runtime controls: %w", err)
	}
	now := nowRFC3339()
	if member.CreatedAt == "" {
		member.CreatedAt = now
	}
	member.UpdatedAt = member.CreatedAt
	member.RuntimeControls = controls
	_, err = s.db.ExecContext(ctx, `INSERT INTO agent_room_members (
		member_id, room_id, member_kind, agent_id, display_name, workspace_root, session_policy, follow_mode,
		followed_pane_id, pinned_session_id, effective_session_id, role_prompt_snapshot,
		runtime_controls_json, auto_approve, status, created_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, member.MemberID, member.RoomID,
		member.MemberKind, nullIfEmpty(member.AgentID), member.DisplayName, nullIfEmpty(member.WorkspaceRoot),
		member.SessionPolicy, member.FollowMode, nullIfEmpty(member.FollowedPaneID), nullIfEmpty(member.PinnedSessionID),
		nullIfEmpty(member.EffectiveSessionID), nullIfEmpty(member.RolePromptSnapshot), string(member.RuntimeControls),
		boolToInt(member.AutoApprove), member.Status, member.CreatedAt, member.UpdatedAt)
	if err != nil {
		return domain.AgentRoomMember{}, fmt.Errorf("failed to create agent room member %s: %w", member.MemberID, err)
	}
	return member, nil
}

func (s *Store) GetAgentRoomMember(ctx context.Context, memberID string) (*domain.AgentRoomMember, error) {
	member, err := scanAgentRoomMember(s.db.QueryRowContext(ctx, agentRoomMemberSelect+` WHERE member_id = ?`, memberID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get agent room member %s: %w", memberID, err)
	}
	return &member, nil
}

func (s *Store) ListAgentRoomMembers(ctx context.Context, roomID string) ([]domain.AgentRoomMember, error) {
	rows, err := s.db.QueryContext(ctx, agentRoomMemberSelect+` WHERE room_id = ? ORDER BY created_at, member_id`, roomID)
	if err != nil {
		return nil, fmt.Errorf("failed to list agent room members: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentRoomMember{}
	for rows.Next() {
		item, err := scanAgentRoomMember(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan agent room member: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) UpdateAgentRoomMember(ctx context.Context, member domain.AgentRoomMember) (domain.AgentRoomMember, error) {
	controls, err := validJSON(member.RuntimeControls, []byte("{}"))
	if err != nil {
		return domain.AgentRoomMember{}, fmt.Errorf("invalid member runtime controls: %w", err)
	}
	member.RuntimeControls = controls
	member.UpdatedAt = nowRFC3339()
	result, err := s.db.ExecContext(ctx, `UPDATE agent_room_members SET member_kind = ?, agent_id = ?, display_name = ?,
		workspace_root = ?, session_policy = ?, follow_mode = ?, followed_pane_id = ?, pinned_session_id = ?,
		effective_session_id = ?, role_prompt_snapshot = ?, runtime_controls_json = ?, auto_approve = ?, status = ?,
		updated_at = ? WHERE member_id = ? AND room_id = ?`, member.MemberKind, nullIfEmpty(member.AgentID),
		member.DisplayName, nullIfEmpty(member.WorkspaceRoot), member.SessionPolicy, member.FollowMode,
		nullIfEmpty(member.FollowedPaneID), nullIfEmpty(member.PinnedSessionID), nullIfEmpty(member.EffectiveSessionID),
		nullIfEmpty(member.RolePromptSnapshot), string(member.RuntimeControls), boolToInt(member.AutoApprove),
		member.Status, member.UpdatedAt, member.MemberID, member.RoomID)
	if err != nil {
		return domain.AgentRoomMember{}, fmt.Errorf("failed to update agent room member %s: %w", member.MemberID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if affected == 0 {
		return domain.AgentRoomMember{}, ErrAgentRoomNotFound
	}
	return member, nil
}

type AgentRoomMemberBinding struct {
	FollowMode      string
	FollowedPaneID  string
	PinnedSessionID string
	WorkspaceRoot   string
}

func (s *Store) RebindAgentRoomMember(ctx context.Context, member domain.AgentRoomMember, binding AgentRoomMemberBinding) (domain.AgentRoomMember, error) {
	controls, err := validJSON(member.RuntimeControls, []byte("{}"))
	if err != nil {
		return domain.AgentRoomMember{}, fmt.Errorf("invalid member runtime controls: %w", err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	defer tx.Rollback()
	var archived int
	if err := tx.QueryRowContext(ctx, `SELECT archived FROM agent_rooms WHERE room_id = ?`, member.RoomID).Scan(&archived); errors.Is(err, sql.ErrNoRows) {
		return domain.AgentRoomMember{}, ErrAgentRoomNotFound
	} else if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if archived != 0 {
		return domain.AgentRoomMember{}, ErrAgentRoomArchived
	}
	requestedDisplayName, requestedAutoApprove, requestedControls := member.DisplayName, member.AutoApprove, controls
	current, err := scanAgentRoomMember(tx.QueryRowContext(ctx, agentRoomMemberSelect+` WHERE member_id = ? AND room_id = ?`, member.MemberID, member.RoomID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.AgentRoomMember{}, ErrAgentRoomNotFound
	}
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	member = current
	member.DisplayName, member.AutoApprove, member.RuntimeControls = requestedDisplayName, requestedAutoApprove, requestedControls

	switch binding.FollowMode {
	case "pin_session":
		binding.PinnedSessionID = strings.TrimSpace(binding.PinnedSessionID)
		binding.WorkspaceRoot = strings.TrimSpace(binding.WorkspaceRoot)
		if binding.PinnedSessionID == "" || binding.WorkspaceRoot == "" {
			return domain.AgentRoomMember{}, ErrAgentRoomBindingInvalid
		}
		var sessionWorkspace string
		if err := tx.QueryRowContext(ctx, `SELECT work_dir FROM bridge_sessions WHERE kimi_session_id = ?`, binding.PinnedSessionID).Scan(&sessionWorkspace); errors.Is(err, sql.ErrNoRows) {
			return domain.AgentRoomMember{}, ErrAgentRoomSessionNotFound
		} else if err != nil {
			return domain.AgentRoomMember{}, err
		}
		if !sameStoredWorkspace(binding.WorkspaceRoot, sessionWorkspace) {
			return domain.AgentRoomMember{}, ErrAgentRoomWorkspaceMismatch
		}
		member.FollowMode = "pin_session"
		member.FollowedPaneID = ""
		member.PinnedSessionID = binding.PinnedSessionID
		member.EffectiveSessionID = binding.PinnedSessionID
		member.WorkspaceRoot = sessionWorkspace
	case "follow_pane":
		binding.FollowedPaneID = strings.TrimSpace(binding.FollowedPaneID)
		if binding.FollowedPaneID == "" {
			return domain.AgentRoomMember{}, ErrAgentRoomBindingInvalid
		}
		var sessionID, paneWorkspace string
		if err := tx.QueryRowContext(ctx, `SELECT ifnull(effective_session_id, ''), ifnull(work_dir, '') FROM pane_session_observations WHERE pane_id = ?`, binding.FollowedPaneID).Scan(&sessionID, &paneWorkspace); errors.Is(err, sql.ErrNoRows) {
			return domain.AgentRoomMember{}, ErrAgentRoomPaneUnresolved
		} else if err != nil {
			return domain.AgentRoomMember{}, err
		}
		if sessionID == "" {
			return domain.AgentRoomMember{}, ErrAgentRoomPaneUnresolved
		}
		var sessionWorkspace string
		if err := tx.QueryRowContext(ctx, `SELECT work_dir FROM bridge_sessions WHERE kimi_session_id = ?`, sessionID).Scan(&sessionWorkspace); errors.Is(err, sql.ErrNoRows) {
			return domain.AgentRoomMember{}, ErrAgentRoomSessionNotFound
		} else if err != nil {
			return domain.AgentRoomMember{}, err
		}
		if paneWorkspace != "" && !sameStoredWorkspace(paneWorkspace, sessionWorkspace) {
			return domain.AgentRoomMember{}, ErrAgentRoomWorkspaceMismatch
		}
		member.FollowMode = "follow_pane"
		member.FollowedPaneID = binding.FollowedPaneID
		member.PinnedSessionID = ""
		member.EffectiveSessionID = sessionID
		member.WorkspaceRoot = sessionWorkspace
	default:
		return domain.AgentRoomMember{}, ErrAgentRoomBindingInvalid
	}
	member.SessionPolicy = domain.SessionPolicyResumeSelected
	member.Status = "idle"
	member.RuntimeControls = controls
	member.UpdatedAt = nowRFC3339()
	result, err := tx.ExecContext(ctx, `UPDATE agent_room_members SET display_name = ?, workspace_root = ?,
		session_policy = ?, follow_mode = ?, followed_pane_id = ?, pinned_session_id = ?, effective_session_id = ?,
		runtime_controls_json = ?, auto_approve = ?, status = ?, updated_at = ? WHERE member_id = ? AND room_id = ?`,
		member.DisplayName, nullIfEmpty(member.WorkspaceRoot), member.SessionPolicy, member.FollowMode,
		nullIfEmpty(member.FollowedPaneID), nullIfEmpty(member.PinnedSessionID), nullIfEmpty(member.EffectiveSessionID),
		string(member.RuntimeControls), boolToInt(member.AutoApprove), member.Status, member.UpdatedAt, member.MemberID, member.RoomID)
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if affected, err := result.RowsAffected(); err != nil {
		return domain.AgentRoomMember{}, err
	} else if affected == 0 {
		return domain.AgentRoomMember{}, ErrAgentRoomNotFound
	}
	if err := tx.Commit(); err != nil {
		return domain.AgentRoomMember{}, err
	}
	return member, nil
}

func (s *Store) DeleteAgentRoomMember(ctx context.Context, roomID, memberID string) (bool, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM agent_room_members WHERE room_id = ? AND member_id = ?`, roomID, memberID)
	if err != nil {
		return false, fmt.Errorf("failed to delete agent room member %s: %w", memberID, err)
	}
	affected, err := result.RowsAffected()
	return affected > 0, err
}

const agentRoomMemberSelect = `SELECT member_id, room_id, member_kind, ifnull(agent_id, ''), display_name,
	ifnull(workspace_root, ''), session_policy, follow_mode, ifnull(followed_pane_id, ''),
	ifnull(pinned_session_id, ''), ifnull(effective_session_id, ''), ifnull(role_prompt_snapshot, ''),
	runtime_controls_json, auto_approve, status, created_at, updated_at FROM agent_room_members`

func scanAgentRoomMember(row rowScanner) (domain.AgentRoomMember, error) {
	var item domain.AgentRoomMember
	var controls string
	var autoApprove int
	err := row.Scan(&item.MemberID, &item.RoomID, &item.MemberKind, &item.AgentID, &item.DisplayName,
		&item.WorkspaceRoot, &item.SessionPolicy, &item.FollowMode, &item.FollowedPaneID, &item.PinnedSessionID,
		&item.EffectiveSessionID, &item.RolePromptSnapshot, &controls, &autoApprove, &item.Status,
		&item.CreatedAt, &item.UpdatedAt)
	item.RuntimeControls = json.RawMessage(controls)
	item.AutoApprove = autoApprove != 0
	return item, err
}

func sameStoredWorkspace(left, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func (s *Store) CreateAgentRoomMessage(ctx context.Context, message domain.AgentRoomMessage) (domain.AgentRoomMessage, error) {
	targets, err := json.Marshal(message.TargetMemberIDs)
	if err != nil {
		return domain.AgentRoomMessage{}, fmt.Errorf("invalid target member ids: %w", err)
	}
	attachments, err := validJSON(message.Attachments, []byte("[]"))
	if err != nil {
		return domain.AgentRoomMessage{}, fmt.Errorf("invalid message attachments: %w", err)
	}
	metadata, err := validJSON(message.Metadata, []byte("{}"))
	if err != nil {
		return domain.AgentRoomMessage{}, fmt.Errorf("invalid message metadata: %w", err)
	}
	if message.CreatedAt == "" {
		message.CreatedAt = nowRFC3339()
	}
	message.Attachments, message.Metadata = attachments, metadata
	_, err = s.db.ExecContext(ctx, `INSERT INTO agent_room_messages (
		message_id, room_id, sender_kind, sender_id, content, reply_to_message_id,
		target_member_ids_json, attachments_json, metadata_json, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, message.MessageID, message.RoomID, message.SenderKind,
		nullIfEmpty(message.SenderID), message.Content, nullIfEmpty(message.ReplyToMessageID), string(targets),
		string(attachments), string(metadata), message.CreatedAt)
	if err != nil {
		return domain.AgentRoomMessage{}, fmt.Errorf("failed to create agent room message %s: %w", message.MessageID, err)
	}
	return message, nil
}

func (s *Store) CreateAgentRoomMessageWithRuns(ctx context.Context, message domain.AgentRoomMessage, runs []domain.AgentRun) (createdMessage domain.AgentRoomMessage, createdRuns []domain.AgentRun, err error) {
	targets, err := json.Marshal(message.TargetMemberIDs)
	if err != nil {
		return domain.AgentRoomMessage{}, nil, fmt.Errorf("invalid target member ids: %w", err)
	}
	attachments, err := validJSON(message.Attachments, []byte("[]"))
	if err != nil {
		return domain.AgentRoomMessage{}, nil, fmt.Errorf("invalid message attachments: %w", err)
	}
	metadata, err := validJSON(message.Metadata, []byte("{}"))
	if err != nil {
		return domain.AgentRoomMessage{}, nil, fmt.Errorf("invalid message metadata: %w", err)
	}
	if message.CreatedAt == "" {
		message.CreatedAt = nowRFC3339()
	}
	message.Attachments, message.Metadata = attachments, metadata

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AgentRoomMessage{}, nil, fmt.Errorf("failed to begin message transaction: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	_, err = tx.ExecContext(ctx, `INSERT INTO agent_room_messages (
		message_id, room_id, sender_kind, sender_id, content, reply_to_message_id,
		target_member_ids_json, attachments_json, metadata_json, created_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, message.MessageID, message.RoomID, message.SenderKind,
		nullIfEmpty(message.SenderID), message.Content, nullIfEmpty(message.ReplyToMessageID), string(targets),
		string(attachments), string(metadata), message.CreatedAt)
	if err != nil {
		return domain.AgentRoomMessage{}, nil, fmt.Errorf("failed to create agent room message %s: %w", message.MessageID, err)
	}
	createdRuns = make([]domain.AgentRun, 0, len(runs))
	for _, run := range runs {
		controls, normalizeErr := validJSON(run.Controls, []byte("{}"))
		if normalizeErr != nil {
			return domain.AgentRoomMessage{}, nil, fmt.Errorf("invalid run controls: %w", normalizeErr)
		}
		assembly, normalizeErr := validJSON(run.PromptAssembly, []byte("{}"))
		if normalizeErr != nil {
			return domain.AgentRoomMessage{}, nil, fmt.Errorf("invalid prompt assembly: %w", normalizeErr)
		}
		if run.CreatedAt == "" {
			run.CreatedAt = message.CreatedAt
		}
		run.UpdatedAt = run.CreatedAt
		run.Controls, run.PromptAssembly = controls, assembly
		_, err = tx.ExecContext(ctx, `INSERT INTO agent_runs (
			run_id, room_id, source_message_id, member_id, agent_id, session_id, work_dir, turn_id, prompt_id,
			origin_kind, queue_policy, status, queue_position, error_code, error_message, controls_json,
			prompt_assembly_json, created_at, started_at, completed_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, run.RunID, run.RoomID,
			run.SourceMessageID, run.MemberID, nullIfEmpty(run.AgentID), nullIfEmpty(run.SessionID), nullIfEmpty(run.WorkDir),
			nullIfEmpty(run.TurnID), nullIfEmpty(run.PromptID), run.OriginKind, run.QueuePolicy, run.Status,
			nullInt(run.QueuePosition), nullIfEmpty(run.ErrorCode), nullIfEmpty(run.ErrorMessage), string(controls),
			string(assembly), run.CreatedAt, nullIfEmpty(run.StartedAt), nullIfEmpty(run.CompletedAt), run.UpdatedAt)
		if err != nil {
			return domain.AgentRoomMessage{}, nil, fmt.Errorf("failed to create agent run %s: %w", run.RunID, err)
		}
		if run.WorkflowStageID != "" {
			if _, err = tx.ExecContext(ctx, `INSERT INTO agent_workflow_runs (run_id, source_message_id, stage_id) VALUES (?, ?, ?)`, run.RunID, run.SourceMessageID, run.WorkflowStageID); err != nil {
				return domain.AgentRoomMessage{}, nil, fmt.Errorf("failed to map workflow run %s: %w", run.RunID, err)
			}
		}
		createdRuns = append(createdRuns, run)
	}
	if err = tx.Commit(); err != nil {
		return domain.AgentRoomMessage{}, nil, fmt.Errorf("failed to commit message transaction: %w", err)
	}
	return message, createdRuns, nil
}

func (s *Store) GetAgentRoomTimeline(ctx context.Context, roomID string, afterSeq int64, limit int) (domain.AgentRoomTimeline, error) {
	return s.GetAgentRoomTimelinePage(ctx, roomID, afterSeq, 0, limit)
}

func (s *Store) GetAgentRoomTimelinePage(ctx context.Context, roomID string, afterSeq, beforeSeq int64, limit int) (domain.AgentRoomTimeline, error) {
	messages, err := s.ListAgentRoomMessages(ctx, roomID, limit)
	if err != nil {
		return domain.AgentRoomTimeline{}, err
	}
	runs, err := s.ListAgentRunsByRoom(ctx, roomID, limit)
	if err != nil {
		return domain.AgentRoomTimeline{}, err
	}
	events, err := s.ListAgentRoomEvents(ctx, AgentRoomEventQuery{RoomID: roomID, AfterSeq: afterSeq, BeforeSeq: beforeSeq, Limit: limit})
	if err != nil {
		return domain.AgentRoomTimeline{}, err
	}
	return domain.AgentRoomTimeline{Messages: messages, Runs: runs, Events: events}, nil
}

func (s *Store) ListAgentRoomMessages(ctx context.Context, roomID string, limit int) ([]domain.AgentRoomMessage, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, agentRoomMessageSelect+` WHERE room_id = ? ORDER BY created_at DESC, message_id DESC LIMIT ?`, roomID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list room messages: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentRoomMessage{}
	for rows.Next() {
		item, err := scanAgentRoomMessage(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan room message: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetAgentRoomMessage(ctx context.Context, messageID string) (*domain.AgentRoomMessage, error) {
	row := s.db.QueryRowContext(ctx, agentRoomMessageSelect+` WHERE message_id = ?`, messageID)
	item, err := scanAgentRoomMessage(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get room message: %w", err)
	}
	return &item, nil
}

const agentRoomMessageSelect = `SELECT message_id, room_id, sender_kind, ifnull(sender_id, ''), content,
	ifnull(reply_to_message_id, ''), target_member_ids_json, attachments_json, metadata_json, created_at
	FROM agent_room_messages`

func scanAgentRoomMessage(row rowScanner) (domain.AgentRoomMessage, error) {
	var item domain.AgentRoomMessage
	var targets, attachments, metadata string
	err := row.Scan(&item.MessageID, &item.RoomID, &item.SenderKind, &item.SenderID, &item.Content,
		&item.ReplyToMessageID, &targets, &attachments, &metadata, &item.CreatedAt)
	if err == nil {
		err = json.Unmarshal([]byte(targets), &item.TargetMemberIDs)
	}
	item.Attachments = json.RawMessage(attachments)
	item.Metadata = json.RawMessage(metadata)
	return item, err
}

func (s *Store) CreateAgentRun(ctx context.Context, run domain.AgentRun) (domain.AgentRun, error) {
	controls, err := validJSON(run.Controls, []byte("{}"))
	if err != nil {
		return domain.AgentRun{}, fmt.Errorf("invalid run controls: %w", err)
	}
	assembly, err := validJSON(run.PromptAssembly, []byte("{}"))
	if err != nil {
		return domain.AgentRun{}, fmt.Errorf("invalid prompt assembly: %w", err)
	}
	now := nowRFC3339()
	if run.CreatedAt == "" {
		run.CreatedAt = now
	}
	run.UpdatedAt = run.CreatedAt
	run.Controls, run.PromptAssembly = controls, assembly
	_, err = s.db.ExecContext(ctx, `INSERT INTO agent_runs (
		run_id, room_id, source_message_id, member_id, agent_id, session_id, work_dir, turn_id, prompt_id,
		origin_kind, queue_policy, status, queue_position, error_code, error_message, controls_json,
		prompt_assembly_json, created_at, started_at, completed_at, updated_at
	) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, run.RunID, run.RoomID,
		run.SourceMessageID, run.MemberID, nullIfEmpty(run.AgentID), nullIfEmpty(run.SessionID), nullIfEmpty(run.WorkDir),
		nullIfEmpty(run.TurnID), nullIfEmpty(run.PromptID), run.OriginKind, run.QueuePolicy, run.Status,
		nullInt(run.QueuePosition), nullIfEmpty(run.ErrorCode), nullIfEmpty(run.ErrorMessage), string(controls),
		string(assembly), run.CreatedAt, nullIfEmpty(run.StartedAt), nullIfEmpty(run.CompletedAt), run.UpdatedAt)
	if err != nil {
		return domain.AgentRun{}, fmt.Errorf("failed to create agent run %s: %w", run.RunID, err)
	}
	if run.WorkflowStageID != "" {
		if _, err = s.db.ExecContext(ctx, `INSERT INTO agent_workflow_runs (run_id, source_message_id, stage_id) VALUES (?, ?, ?)`, run.RunID, run.SourceMessageID, run.WorkflowStageID); err != nil {
			return domain.AgentRun{}, fmt.Errorf("failed to map workflow run %s: %w", run.RunID, err)
		}
	}
	return run, nil
}

func (s *Store) GetAgentRun(ctx context.Context, runID string) (*domain.AgentRun, error) {
	run, err := scanAgentRun(s.db.QueryRowContext(ctx, agentRunSelect+` WHERE run_id = ?`, runID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get agent run %s: %w", runID, err)
	}
	return &run, nil
}

func (s *Store) UpdateAgentRun(ctx context.Context, run domain.AgentRun) (domain.AgentRun, error) {
	controls, err := validJSON(run.Controls, []byte("{}"))
	if err != nil {
		return domain.AgentRun{}, err
	}
	assembly, err := validJSON(run.PromptAssembly, []byte("{}"))
	if err != nil {
		return domain.AgentRun{}, err
	}
	run.UpdatedAt = nowRFC3339()
	result, err := s.db.ExecContext(ctx, `UPDATE agent_runs SET agent_id = ?, session_id = ?, work_dir = ?, turn_id = ?,
		prompt_id = ?, origin_kind = ?, queue_policy = ?, status = ?, queue_position = ?, error_code = ?,
		error_message = ?, controls_json = ?, prompt_assembly_json = ?, started_at = ?, completed_at = ?, updated_at = ?
		WHERE run_id = ?`, nullIfEmpty(run.AgentID), nullIfEmpty(run.SessionID), nullIfEmpty(run.WorkDir),
		nullIfEmpty(run.TurnID), nullIfEmpty(run.PromptID), run.OriginKind, run.QueuePolicy, run.Status,
		nullInt(run.QueuePosition), nullIfEmpty(run.ErrorCode), nullIfEmpty(run.ErrorMessage), string(controls),
		string(assembly), nullIfEmpty(run.StartedAt), nullIfEmpty(run.CompletedAt), run.UpdatedAt, run.RunID)
	if err != nil {
		return domain.AgentRun{}, fmt.Errorf("failed to update agent run %s: %w", run.RunID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.AgentRun{}, err
	}
	if affected == 0 {
		return domain.AgentRun{}, ErrAgentRoomNotFound
	}
	run.Controls, run.PromptAssembly = controls, assembly
	return run, nil
}

func (s *Store) TransitionAgentRunForAbort(ctx context.Context, runID, expectedStatus, targetStatus string) (domain.AgentRun, error) {
	runID, expectedStatus, targetStatus = strings.TrimSpace(runID), strings.TrimSpace(expectedStatus), strings.TrimSpace(targetStatus)
	if runID == "" || (targetStatus != "aborted" && targetStatus != "abort_requested") {
		return domain.AgentRun{}, ErrAgentRoomConflict
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AgentRun{}, err
	}
	defer tx.Rollback()
	now := nowRFC3339()
	completedAt := any(nil)
	if targetStatus == "aborted" {
		completedAt = now
		if _, err = tx.ExecContext(ctx, `DELETE FROM session_prompt_queue WHERE run_id = ? AND status = 'queued'`, runID); err != nil {
			return domain.AgentRun{}, err
		}
	}
	result, err := tx.ExecContext(ctx, `UPDATE agent_runs SET status = ?, queue_position = NULL,
		completed_at = coalesce(?, completed_at), updated_at = ? WHERE run_id = ? AND status = ?`,
		targetStatus, completedAt, now, runID, expectedStatus)
	if err != nil {
		return domain.AgentRun{}, fmt.Errorf("failed to transition agent run abort state %s: %w", runID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return domain.AgentRun{}, err
	}
	if affected == 0 {
		return domain.AgentRun{}, ErrAgentRoomConflict
	}
	kind := "run.abort_requested"
	if targetStatus == "aborted" {
		kind = "run.aborted"
	}
	eventID := "control:abort:" + runID + ":" + targetStatus
	if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO agent_room_events (
		event_id, room_id, member_id, agent_id, run_id, session_id, turn_id, prompt_id, kind, status,
		text_delta, display_text, approval_id, artifact_json, payload_json, created_at
	) SELECT ?, room_id, member_id, agent_id, run_id, session_id, turn_id, prompt_id, ?, ?,
		NULL, 'Manual Agent Room control', NULL, NULL, '{"source":"agent_room"}', ?
		FROM agent_runs WHERE run_id = ?`, eventID, kind, targetStatus, now, runID); err != nil {
		return domain.AgentRun{}, fmt.Errorf("failed to append abort audit event %s: %w", runID, err)
	}
	if err = tx.Commit(); err != nil {
		return domain.AgentRun{}, err
	}
	s.notifyAgentRoomEvents()
	run, err := s.GetAgentRun(ctx, runID)
	if err != nil {
		return domain.AgentRun{}, err
	}
	if run == nil {
		return domain.AgentRun{}, ErrAgentRoomNotFound
	}
	return *run, nil
}

func (s *Store) BlockAgentRun(ctx context.Context, runID, code, message string) error {
	result, err := s.db.ExecContext(ctx, `UPDATE agent_runs SET status = 'blocked', error_code = ?, error_message = ?, updated_at = ? WHERE run_id = ?`,
		strings.TrimSpace(code), strings.TrimSpace(message), nowRFC3339(), strings.TrimSpace(runID))
	if err != nil {
		return fmt.Errorf("failed to block agent run %s: %w", runID, err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrAgentRoomNotFound
	}
	return nil
}

func (s *Store) TransitionAgentRunStatus(ctx context.Context, runID, expectedStatus, targetStatus, code, message string) (bool, error) {
	now := nowRFC3339()
	completedAt := any(nil)
	if targetStatus == "blocked" || targetStatus == "completed" || targetStatus == "failed" || targetStatus == "aborted" {
		completedAt = now
	}
	result, err := s.db.ExecContext(ctx, `UPDATE agent_runs SET status = ?, error_code = ?, error_message = ?, completed_at = coalesce(?, completed_at), updated_at = ? WHERE run_id = ? AND status = ?`,
		targetStatus, nullIfEmpty(code), nullIfEmpty(message), completedAt, now, strings.TrimSpace(runID), strings.TrimSpace(expectedStatus))
	if err != nil {
		return false, fmt.Errorf("failed to transition agent run %s: %w", runID, err)
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func (s *Store) TransitionWorkflowRun(ctx context.Context, runID, expectedStatus, targetStatus string, assembly json.RawMessage, code, message string) (bool, error) {
	normalized, err := validJSON(assembly, []byte("{}"))
	if err != nil {
		return false, err
	}
	now := nowRFC3339()
	completedAt := any(nil)
	if runTerminalStatus(targetStatus) {
		completedAt = now
	}
	result, err := s.db.ExecContext(ctx, `UPDATE agent_runs SET status = ?, prompt_assembly_json = ?, error_code = ?, error_message = ?, completed_at = coalesce(?, completed_at), updated_at = ? WHERE run_id = ? AND status = ?`,
		targetStatus, string(normalized), nullIfEmpty(code), nullIfEmpty(message), completedAt, now, strings.TrimSpace(runID), strings.TrimSpace(expectedStatus))
	if err != nil {
		return false, fmt.Errorf("failed to transition workflow run %s: %w", runID, err)
	}
	affected, err := result.RowsAffected()
	return affected == 1, err
}

func runTerminalStatus(status string) bool {
	switch strings.TrimSpace(status) {
	case "completed", "failed", "aborted", "orphaned", "blocked", "conflicted":
		return true
	default:
		return false
	}
}

func (s *Store) ListAgentRunsByMessage(ctx context.Context, messageID string) ([]domain.AgentRun, error) {
	rows, err := s.db.QueryContext(ctx, agentRunSelect+` WHERE source_message_id = ? ORDER BY created_at, run_id`, strings.TrimSpace(messageID))
	if err != nil {
		return nil, fmt.Errorf("failed to list workflow runs: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentRun{}
	for rows.Next() {
		item, scanErr := scanAgentRun(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListRecoverableWorkflowMessageIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT workflow.source_message_id
		FROM agent_workflow_runs workflow JOIN agent_runs runs ON runs.run_id = workflow.run_id
		WHERE runs.status NOT IN ('completed','failed','aborted','orphaned','blocked','conflicted')
		ORDER BY workflow.source_message_id`)
	if err != nil {
		return nil, fmt.Errorf("failed to list recoverable workflows: %w", err)
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var messageID string
		if err := rows.Scan(&messageID); err != nil {
			return nil, err
		}
		items = append(items, messageID)
	}
	return items, rows.Err()
}

func (s *Store) ListAgentRunsByRoom(ctx context.Context, roomID string, limit int) ([]domain.AgentRun, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, agentRunSelect+` WHERE room_id = ? ORDER BY created_at DESC, run_id DESC LIMIT ?`, roomID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list agent runs: %w", err)
	}
	defer rows.Close()
	items := []domain.AgentRun{}
	for rows.Next() {
		item, err := scanAgentRun(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan agent run: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

const agentRunSelect = `SELECT run_id, room_id, source_message_id, member_id, ifnull(agent_id, ''),
	ifnull(session_id, ''), ifnull(work_dir, ''), ifnull(turn_id, ''), ifnull(prompt_id, ''), origin_kind,
	queue_policy, status, queue_position, ifnull(error_code, ''), ifnull(error_message, ''), controls_json,
	prompt_assembly_json, ifnull((SELECT stage_id FROM agent_workflow_runs WHERE agent_workflow_runs.run_id = agent_runs.run_id), ''),
	created_at, ifnull(started_at, ''), ifnull(completed_at, ''), updated_at FROM agent_runs`

func scanAgentRun(row rowScanner) (domain.AgentRun, error) {
	var item domain.AgentRun
	var position sql.NullInt64
	var controls, assembly string
	err := row.Scan(&item.RunID, &item.RoomID, &item.SourceMessageID, &item.MemberID, &item.AgentID,
		&item.SessionID, &item.WorkDir, &item.TurnID, &item.PromptID, &item.OriginKind, &item.QueuePolicy,
		&item.Status, &position, &item.ErrorCode, &item.ErrorMessage, &controls, &assembly, &item.WorkflowStageID, &item.CreatedAt,
		&item.StartedAt, &item.CompletedAt, &item.UpdatedAt)
	if position.Valid {
		value := int(position.Int64)
		item.QueuePosition = &value
	}
	item.Controls = json.RawMessage(controls)
	item.PromptAssembly = json.RawMessage(assembly)
	return item, err
}

func validJSON(value json.RawMessage, fallback []byte) (json.RawMessage, error) {
	value = json.RawMessage(strings.TrimSpace(string(value)))
	if len(value) == 0 {
		return append(json.RawMessage(nil), fallback...), nil
	}
	if !json.Valid(value) {
		return nil, errors.New("malformed JSON")
	}
	return value, nil
}

func nullInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}
