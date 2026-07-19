package agentroom

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Message }

func ErrorCode(err error) string {
	var agentRoomErr *Error
	if errors.As(err, &agentRoomErr) {
		return agentRoomErr.Code
	}
	return ""
}

type Service struct {
	store *store.Store
}

const (
	maxAgentProfiles    = 100
	maxActiveRooms      = 50
	maxRoomMembers      = 12
	maxDispatchTargets  = 12
	maxRoomMessageBytes = 1 << 20
)

func NewService(store *store.Store) *Service {
	return &Service{store: store}
}

type AgentProfileInput struct {
	Name            string
	Avatar          string
	Description     string
	RolePrompt      string
	DefaultWorkDir  string
	SessionPolicy   domain.SessionPolicy
	PinnedSessionID string
	AutoApprove     bool
	RuntimeControls json.RawMessage
	Enabled         bool
}

func (s *Service) CreateAgentProfile(ctx context.Context, input AgentProfileInput) (domain.AgentProfile, error) {
	profiles, err := s.store.ListAgentProfiles(ctx)
	if err != nil {
		return domain.AgentProfile{}, err
	}
	if len(profiles) >= maxAgentProfiles {
		return domain.AgentProfile{}, validation("agent_limit_reached", "agent profile limit reached")
	}
	profile, err := s.normalizeAgentProfile(ctx, domain.AgentProfile{
		AgentID:         uuid.NewString(),
		Name:            input.Name,
		Avatar:          input.Avatar,
		Description:     input.Description,
		RolePrompt:      input.RolePrompt,
		DefaultWorkDir:  input.DefaultWorkDir,
		SessionPolicy:   input.SessionPolicy,
		PinnedSessionID: input.PinnedSessionID,
		AutoApprove:     input.AutoApprove,
		RuntimeControls: input.RuntimeControls,
		Enabled:         true,
	})
	if err != nil {
		return domain.AgentProfile{}, err
	}
	return s.store.CreateAgentProfile(ctx, profile)
}

func (s *Service) UpdateAgentProfile(ctx context.Context, agentID string, expectedRevision int64, input AgentProfileInput) (domain.AgentProfile, error) {
	current, err := s.store.GetAgentProfile(ctx, strings.TrimSpace(agentID))
	if err != nil {
		return domain.AgentProfile{}, err
	}
	if current == nil {
		return domain.AgentProfile{}, validation("agent_not_found", "agent profile not found")
	}
	current.Name = input.Name
	current.Avatar = input.Avatar
	current.Description = input.Description
	current.RolePrompt = input.RolePrompt
	current.DefaultWorkDir = input.DefaultWorkDir
	current.SessionPolicy = input.SessionPolicy
	current.PinnedSessionID = input.PinnedSessionID
	current.AutoApprove = input.AutoApprove
	current.RuntimeControls = input.RuntimeControls
	current.Enabled = input.Enabled
	profile, err := s.normalizeAgentProfile(ctx, *current)
	if err != nil {
		return domain.AgentProfile{}, err
	}
	profile, err = s.store.UpdateAgentProfile(ctx, profile, expectedRevision)
	if errors.Is(err, store.ErrAgentRoomRevisionConflict) {
		return domain.AgentProfile{}, validation("revision_conflict", "agent profile was modified by another request")
	}
	return profile, err
}

func (s *Service) DeleteAgentProfile(ctx context.Context, agentID string) error {
	deleted, err := s.store.DeleteAgentProfile(ctx, strings.TrimSpace(agentID))
	if err != nil {
		return err
	}
	if !deleted {
		return validation("agent_not_found", "agent profile not found")
	}
	return nil
}

func (s *Service) normalizeAgentProfile(ctx context.Context, profile domain.AgentProfile) (domain.AgentProfile, error) {
	profile.Name = strings.TrimSpace(profile.Name)
	profile.Avatar = strings.TrimSpace(profile.Avatar)
	profile.Description = strings.TrimSpace(profile.Description)
	profile.RolePrompt = strings.TrimSpace(profile.RolePrompt)
	profile.PinnedSessionID = strings.TrimSpace(profile.PinnedSessionID)
	if count := utf8.RuneCountInString(profile.Name); count < 1 || count > 64 {
		return domain.AgentProfile{}, validation("invalid_agent_name", "agent name must contain 1 to 64 Unicode characters")
	}
	if profile.RolePrompt == "" {
		return domain.AgentProfile{}, validation("role_prompt_required", "agent role prompt is required")
	}
	if len(profile.RolePrompt) > 32*1024 {
		return domain.AgentProfile{}, validation("role_prompt_too_large", "agent role prompt exceeds 32 KiB")
	}
	workDir, err := normalizeWorkspace(profile.DefaultWorkDir)
	if err != nil {
		return domain.AgentProfile{}, err
	}
	profile.DefaultWorkDir = workDir
	if err := validateSessionPolicy(profile.SessionPolicy, profile.PinnedSessionID); err != nil {
		return domain.AgentProfile{}, err
	}
	if profile.PinnedSessionID != "" {
		if err := s.validatePinnedSession(ctx, profile.PinnedSessionID, profile.DefaultWorkDir); err != nil {
			return domain.AgentProfile{}, err
		}
	}
	controls, err := normalizeRuntimeControls(profile.RuntimeControls)
	if err != nil {
		return domain.AgentProfile{}, err
	}
	profile.RuntimeControls = controls
	return profile, nil
}

type RoomInput struct {
	Title             string
	Description       string
	SharedBrief       string
	OrchestrationMode string
	Archived          bool
}

func (s *Service) CreateRoom(ctx context.Context, input RoomInput) (domain.AgentRoom, error) {
	active := false
	rooms, err := s.store.ListAgentRooms(ctx, &active, maxActiveRooms)
	if err != nil {
		return domain.AgentRoom{}, err
	}
	if len(rooms) >= maxActiveRooms && !input.Archived {
		return domain.AgentRoom{}, validation("room_limit_reached", "active room limit reached")
	}
	room, err := normalizeRoom(domain.AgentRoom{
		RoomID: uuid.NewString(), Title: input.Title, Description: input.Description,
		SharedBrief: input.SharedBrief, OrchestrationMode: input.OrchestrationMode, Archived: input.Archived,
	})
	if err != nil {
		return domain.AgentRoom{}, err
	}
	return s.store.CreateAgentRoom(ctx, room)
}

func (s *Service) UpdateRoom(ctx context.Context, roomID string, input RoomInput) (domain.AgentRoom, error) {
	current, err := s.store.GetAgentRoom(ctx, strings.TrimSpace(roomID))
	if err != nil {
		return domain.AgentRoom{}, err
	}
	if current == nil {
		return domain.AgentRoom{}, validation("room_not_found", "agent room not found")
	}
	room, err := normalizeRoom(domain.AgentRoom{
		RoomID: current.RoomID, Title: input.Title, Description: input.Description,
		SharedBrief: input.SharedBrief, OrchestrationMode: input.OrchestrationMode,
		Archived: input.Archived, CreatedAt: current.CreatedAt, UpdatedAt: current.UpdatedAt,
	})
	if err != nil {
		return domain.AgentRoom{}, err
	}
	if current.Archived && (room.Title != current.Title || room.Description != current.Description ||
		room.SharedBrief != current.SharedBrief || room.OrchestrationMode != current.OrchestrationMode) {
		return domain.AgentRoom{}, validation("room_archived", "archived room is read-only until restored")
	}
	return s.store.UpdateAgentRoom(ctx, room)
}

func (s *Service) DeleteRoom(ctx context.Context, roomID string) error {
	deleted, err := s.store.DeleteAgentRoom(ctx, strings.TrimSpace(roomID))
	if err != nil {
		return err
	}
	if !deleted {
		return validation("room_not_found", "agent room not found")
	}
	return nil
}

func normalizeRoom(room domain.AgentRoom) (domain.AgentRoom, error) {
	room.Title = strings.TrimSpace(room.Title)
	room.Description = strings.TrimSpace(room.Description)
	room.SharedBrief = strings.TrimSpace(room.SharedBrief)
	room.OrchestrationMode = strings.TrimSpace(room.OrchestrationMode)
	if count := utf8.RuneCountInString(room.Title); count < 1 || count > 128 {
		return domain.AgentRoom{}, validation("invalid_room_title", "room title must contain 1 to 128 Unicode characters")
	}
	if len(room.SharedBrief) > 64*1024 {
		return domain.AgentRoom{}, validation("shared_brief_too_large", "room shared brief exceeds 64 KiB")
	}
	if room.OrchestrationMode == "" {
		room.OrchestrationMode = "direct"
	}
	if !oneOf(room.OrchestrationMode, "direct", "parallel", "workflow") {
		return domain.AgentRoom{}, validation("invalid_orchestration_mode", "unsupported room orchestration mode")
	}
	return room, nil
}

func (s *Service) AddAgentMember(ctx context.Context, roomID, agentID string) (domain.AgentRoomMember, error) {
	if err := s.requireWritableRoom(ctx, roomID); err != nil {
		return domain.AgentRoomMember{}, err
	}
	if err := s.requireMemberCapacity(ctx, roomID); err != nil {
		return domain.AgentRoomMember{}, err
	}
	profile, err := s.store.GetAgentProfile(ctx, strings.TrimSpace(agentID))
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if profile == nil || !profile.Enabled {
		return domain.AgentRoomMember{}, validation("agent_not_found", "enabled agent profile not found")
	}
	effectiveSessionID := ""
	if profile.PinnedSessionID != "" {
		if err := s.validatePinnedSession(ctx, profile.PinnedSessionID, profile.DefaultWorkDir); err != nil {
			return domain.AgentRoomMember{}, err
		}
		effectiveSessionID = profile.PinnedSessionID
	}
	return s.store.CreateAgentRoomMember(ctx, domain.AgentRoomMember{
		MemberID:           uuid.NewString(),
		RoomID:             strings.TrimSpace(roomID),
		MemberKind:         "agent",
		AgentID:            profile.AgentID,
		DisplayName:        profile.Name,
		WorkspaceRoot:      profile.DefaultWorkDir,
		SessionPolicy:      profile.SessionPolicy,
		FollowMode:         "pin_session",
		PinnedSessionID:    profile.PinnedSessionID,
		EffectiveSessionID: effectiveSessionID,
		RolePromptSnapshot: profile.RolePrompt,
		RuntimeControls:    append(json.RawMessage(nil), profile.RuntimeControls...),
		AutoApprove:        profile.AutoApprove,
		Status:             "idle",
	})
}

type PinnedMemberInput struct {
	DisplayName     string
	PinnedSessionID string
	WorkspaceRoot   string
	AutoApprove     bool
	RuntimeControls json.RawMessage
}

func (s *Service) AddPinnedSessionMember(ctx context.Context, roomID string, input PinnedMemberInput) (domain.AgentRoomMember, error) {
	if err := s.requireWritableRoom(ctx, roomID); err != nil {
		return domain.AgentRoomMember{}, err
	}
	if err := s.requireMemberCapacity(ctx, roomID); err != nil {
		return domain.AgentRoomMember{}, err
	}
	name := strings.TrimSpace(input.DisplayName)
	if name == "" {
		return domain.AgentRoomMember{}, validation("invalid_member_name", "member display name is required")
	}
	workspace, err := normalizeWorkspace(input.WorkspaceRoot)
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	sessionID := strings.TrimSpace(input.PinnedSessionID)
	if sessionID == "" {
		return domain.AgentRoomMember{}, validation("session_required", "pinned session member requires a session id")
	}
	if err := s.validatePinnedSession(ctx, sessionID, workspace); err != nil {
		return domain.AgentRoomMember{}, err
	}
	controls, err := normalizeRuntimeControls(input.RuntimeControls)
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	return s.store.CreateAgentRoomMember(ctx, domain.AgentRoomMember{
		MemberID: uuid.NewString(), RoomID: strings.TrimSpace(roomID), MemberKind: "pinned_session",
		DisplayName: name, WorkspaceRoot: workspace, SessionPolicy: domain.SessionPolicyResumeSelected,
		FollowMode: "pin_session", PinnedSessionID: sessionID, EffectiveSessionID: sessionID,
		RuntimeControls: controls, AutoApprove: input.AutoApprove, Status: "idle",
	})
}

func (s *Service) AddFollowedPaneMember(ctx context.Context, roomID, paneID, displayName string) (domain.AgentRoomMember, error) {
	if err := s.requireWritableRoom(ctx, roomID); err != nil {
		return domain.AgentRoomMember{}, err
	}
	if err := s.requireMemberCapacity(ctx, roomID); err != nil {
		return domain.AgentRoomMember{}, err
	}
	pane, err := s.store.GetPaneSessionObservation(ctx, strings.TrimSpace(paneID))
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if pane == nil || pane.EffectiveSessionID == "" {
		return domain.AgentRoomMember{}, validation("pane_session_unresolved", "pane does not have an effective session")
	}
	session, err := s.store.GetSessionByID(ctx, pane.EffectiveSessionID)
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if session == nil {
		return domain.AgentRoomMember{}, validation("session_not_found", "pane session was not found")
	}
	workspace := pane.WorkDir
	if workspace == "" {
		workspace = session.WorkDir
	}
	workspace, err = normalizeWorkspace(workspace)
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if !sameWorkspace(workspace, session.WorkDir) {
		return domain.AgentRoomMember{}, validation("workspace_mismatch", "pane workspace does not match its effective session")
	}
	name := strings.TrimSpace(displayName)
	if name == "" {
		name = "Pane " + pane.PaneID
	}
	return s.store.CreateAgentRoomMember(ctx, domain.AgentRoomMember{
		MemberID: uuid.NewString(), RoomID: strings.TrimSpace(roomID), MemberKind: "followed_pane",
		DisplayName: name, WorkspaceRoot: workspace, SessionPolicy: domain.SessionPolicyResumeSelected,
		FollowMode: "follow_pane", FollowedPaneID: pane.PaneID, EffectiveSessionID: pane.EffectiveSessionID,
		RuntimeControls: json.RawMessage(`{}`), Status: "idle",
	})
}

type MemberUpdateInput struct {
	DisplayName     *string
	AutoApprove     *bool
	RuntimeControls *json.RawMessage
	Binding         *MemberBindingInput
}

type MemberBindingInput struct {
	FollowMode      string
	FollowedPaneID  string
	PinnedSessionID string
	WorkspaceRoot   string
}

func (s *Service) UpdateMember(ctx context.Context, roomID, memberID string, input MemberUpdateInput) (domain.AgentRoomMember, error) {
	if err := s.requireWritableRoom(ctx, roomID); err != nil {
		return domain.AgentRoomMember{}, err
	}
	member, err := s.store.GetAgentRoomMember(ctx, strings.TrimSpace(memberID))
	if err != nil {
		return domain.AgentRoomMember{}, err
	}
	if member == nil || member.RoomID != strings.TrimSpace(roomID) {
		return domain.AgentRoomMember{}, validation("member_not_found", "agent room member not found")
	}
	if input.DisplayName != nil {
		name := strings.TrimSpace(*input.DisplayName)
		if count := utf8.RuneCountInString(name); count < 1 || count > 128 {
			return domain.AgentRoomMember{}, validation("invalid_member_name", "member display name must contain 1 to 128 Unicode characters")
		}
		member.DisplayName = name
	}
	if input.AutoApprove != nil {
		member.AutoApprove = *input.AutoApprove
	}
	if input.RuntimeControls != nil {
		controls, err := normalizeRuntimeControls(*input.RuntimeControls)
		if err != nil {
			return domain.AgentRoomMember{}, err
		}
		member.RuntimeControls = controls
	}
	if input.Binding != nil {
		binding := store.AgentRoomMemberBinding{
			FollowMode: strings.TrimSpace(input.Binding.FollowMode), FollowedPaneID: strings.TrimSpace(input.Binding.FollowedPaneID),
			PinnedSessionID: strings.TrimSpace(input.Binding.PinnedSessionID), WorkspaceRoot: strings.TrimSpace(input.Binding.WorkspaceRoot),
		}
		if binding.FollowMode == "pin_session" {
			workspace, err := normalizeWorkspace(binding.WorkspaceRoot)
			if err != nil {
				return domain.AgentRoomMember{}, err
			}
			binding.WorkspaceRoot = workspace
		}
		updated, err := s.store.RebindAgentRoomMember(ctx, *member, binding)
		return updated, memberBindingError(err)
	}
	return s.store.UpdateAgentRoomMember(ctx, *member)
}

func memberBindingError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, store.ErrAgentRoomArchived):
		return validation("room_archived", "archived room is read-only until restored")
	case errors.Is(err, store.ErrAgentRoomBindingInvalid):
		return validation("invalid_member_binding", "member binding is incomplete or unsupported")
	case errors.Is(err, store.ErrAgentRoomPaneUnresolved):
		return validation("pane_session_unresolved", "pane does not have an effective session")
	case errors.Is(err, store.ErrAgentRoomSessionNotFound):
		return validation("session_not_found", "member session was not found")
	case errors.Is(err, store.ErrAgentRoomWorkspaceMismatch):
		return validation("workspace_mismatch", "member workspace does not match its session")
	case errors.Is(err, store.ErrAgentRoomNotFound):
		return validation("member_not_found", "agent room member not found")
	default:
		return err
	}
}

func (s *Service) DeleteMember(ctx context.Context, roomID, memberID string) error {
	if err := s.requireWritableRoom(ctx, roomID); err != nil {
		return err
	}
	deleted, err := s.store.DeleteAgentRoomMember(ctx, strings.TrimSpace(roomID), strings.TrimSpace(memberID))
	if err != nil {
		return err
	}
	if !deleted {
		return validation("member_not_found", "agent room member not found")
	}
	return nil
}

func (s *Service) PutConnectorBinding(ctx context.Context, connectorID, agentID, sessionMode string) (domain.AgentConnectorBinding, error) {
	connectorID, agentID, sessionMode = strings.TrimSpace(connectorID), strings.TrimSpace(agentID), strings.TrimSpace(sessionMode)
	if connectorID == "" || agentID == "" {
		return domain.AgentConnectorBinding{}, validation("connector_binding_required", "connector and agent are required")
	}
	if sessionMode == "" {
		sessionMode = "independent_session"
	}
	if !oneOf(sessionMode, "independent_session", "same_session") {
		return domain.AgentConnectorBinding{}, validation("invalid_connector_session_mode", "unsupported connector session mode")
	}
	profile, err := s.store.GetAgentProfile(ctx, agentID)
	if err != nil || profile == nil {
		return domain.AgentConnectorBinding{}, firstError(err, validation("agent_not_found", "agent profile not found"))
	}
	if !profile.Enabled {
		return domain.AgentConnectorBinding{}, validation("agent_disabled", "connector binding requires an enabled agent")
	}
	if sessionMode == "same_session" && (!oneOf(string(profile.SessionPolicy), string(domain.SessionPolicyPersistent), string(domain.SessionPolicyResumeSelected)) || strings.TrimSpace(profile.PinnedSessionID) == "") {
		return domain.AgentConnectorBinding{}, validation("agent_session_unresolved", "same-session binding requires an explicit pinned Session")
	}
	item, err := s.store.UpsertAgentConnectorBinding(ctx, domain.AgentConnectorBinding{ConnectorID: connectorID, AgentID: agentID, SessionMode: sessionMode})
	if errors.Is(err, store.ErrAgentConnectorNotFound) {
		return domain.AgentConnectorBinding{}, validation("connector_not_found", "connector was not found")
	}
	return item, err
}

func (s *Service) DeleteConnectorBinding(ctx context.Context, connectorID string) error {
	deleted, err := s.store.DeleteAgentConnectorBinding(ctx, strings.TrimSpace(connectorID))
	if err != nil {
		return err
	}
	if !deleted {
		return validation("connector_binding_not_found", "connector binding was not found")
	}
	return nil
}

func (s *Service) requireMemberCapacity(ctx context.Context, roomID string) error {
	members, err := s.store.ListAgentRoomMembers(ctx, strings.TrimSpace(roomID))
	if err != nil {
		return err
	}
	if len(members) >= maxRoomMembers {
		return validation("member_limit_reached", "room member limit reached")
	}
	return nil
}

type MessageInput struct {
	Content            string
	TargetMemberIDs    []string
	Mode               string
	QueuePolicy        string
	ReplyToMessageID   string
	Attachments        json.RawMessage
	Metadata           json.RawMessage
	SharedRunIDs       []string
	WorkflowDefinition *domain.WorkflowDefinition
}

type TargetFailure struct {
	MemberID string `json:"memberId"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

type MessageRunsResult struct {
	Message  domain.AgentRoomMessage `json:"message"`
	Runs     []domain.AgentRun       `json:"runs"`
	Failures []TargetFailure         `json:"failures,omitempty"`
}

func (s *Service) CreateMessageWithRuns(ctx context.Context, roomID string, input MessageInput) (MessageRunsResult, error) {
	roomID = strings.TrimSpace(roomID)
	if err := s.requireWritableRoom(ctx, roomID); err != nil {
		return MessageRunsResult{}, err
	}
	content := strings.TrimSpace(input.Content)
	if content == "" {
		return MessageRunsResult{}, validation("message_required", "room message content is required")
	}
	if len(content) > maxRoomMessageBytes {
		return MessageRunsResult{}, validation("message_too_large", "room message exceeds 1 MiB")
	}
	mode := strings.TrimSpace(input.Mode)
	if mode == "" {
		mode = "parallel"
	}
	if !oneOf(mode, "direct", "parallel", "workflow") {
		return MessageRunsResult{}, validation("invalid_dispatch_mode", "unsupported dispatch mode")
	}
	if mode != "workflow" && input.WorkflowDefinition != nil {
		return MessageRunsResult{}, validation("workflow_definition_not_allowed", "workflow definition requires workflow mode")
	}
	queuePolicy := strings.TrimSpace(input.QueuePolicy)
	if queuePolicy == "" {
		queuePolicy = "enqueue"
	}
	if !oneOf(queuePolicy, "enqueue", "follow_up", "abort_and_replace", "record_only") {
		return MessageRunsResult{}, validation("invalid_queue_policy", "unsupported queue policy")
	}
	members, err := s.store.ListAgentRoomMembers(ctx, roomID)
	if err != nil {
		return MessageRunsResult{}, err
	}
	memberByID := make(map[string]domain.AgentRoomMember, len(members))
	for _, member := range members {
		memberByID[member.MemberID] = member
	}
	if mode == "workflow" {
		if queuePolicy != "enqueue" {
			return MessageRunsResult{}, validation("invalid_workflow_queue_policy", "workflow mode requires enqueue policy")
		}
		definition, validateErr := normalizeWorkflowDefinition(input.WorkflowDefinition, memberByID)
		if validateErr != nil {
			return MessageRunsResult{}, validateErr
		}
		return s.createWorkflowMessageWithRuns(ctx, roomID, content, input, definition, memberByID)
	}
	targetIDs := dedupeStrings(input.TargetMemberIDs)
	if len(targetIDs) == 0 {
		for _, member := range members {
			targetIDs = append(targetIDs, member.MemberID)
		}
	}
	if len(targetIDs) > maxDispatchTargets {
		return MessageRunsResult{}, validation("target_limit_reached", "dispatch target limit reached")
	}
	metadata, err := mergeMessageMetadata(input.Metadata, mode, dedupeStrings(input.SharedRunIDs))
	if err != nil {
		return MessageRunsResult{}, err
	}
	messageID := uuid.NewString()
	runs := make([]domain.AgentRun, 0, len(targetIDs))
	failures := []TargetFailure{}
	for _, targetID := range targetIDs {
		member, ok := memberByID[targetID]
		if !ok {
			failures = append(failures, TargetFailure{MemberID: targetID, Code: "member_not_found", Message: "target member was not found"})
			continue
		}
		status := "queued"
		if member.EffectiveSessionID == "" {
			status = "resolving_session"
		}
		completedAt := ""
		if queuePolicy == "record_only" {
			status = "completed"
			completedAt = time.Now().UTC().Format(time.RFC3339)
		}
		runs = append(runs, domain.AgentRun{
			RunID:           uuid.NewString(),
			RoomID:          roomID,
			SourceMessageID: messageID,
			MemberID:        member.MemberID,
			AgentID:         member.AgentID,
			SessionID:       member.EffectiveSessionID,
			WorkDir:         member.WorkspaceRoot,
			OriginKind:      "agent_room",
			QueuePolicy:     queuePolicy,
			Status:          status,
			CompletedAt:     completedAt,
			Controls:        append(json.RawMessage(nil), member.RuntimeControls...),
			PromptAssembly:  json.RawMessage(`{}`),
		})
	}
	if len(runs) == 0 {
		return MessageRunsResult{}, validation("no_valid_targets", "room message has no valid target members")
	}
	message, runs, err := s.store.CreateAgentRoomMessageWithRuns(ctx, domain.AgentRoomMessage{
		MessageID: messageID, RoomID: roomID, SenderKind: "user", Content: content,
		ReplyToMessageID: strings.TrimSpace(input.ReplyToMessageID), TargetMemberIDs: targetIDs,
		Attachments: input.Attachments, Metadata: metadata,
	}, runs)
	if err != nil {
		return MessageRunsResult{}, err
	}
	return MessageRunsResult{Message: message, Runs: runs, Failures: failures}, nil
}

func (s *Service) createWorkflowMessageWithRuns(ctx context.Context, roomID, content string, input MessageInput, definition *domain.WorkflowDefinition, members map[string]domain.AgentRoomMember) (MessageRunsResult, error) {
	metadata, err := mergeMessageMetadata(input.Metadata, "workflow", nil)
	if err != nil {
		return MessageRunsResult{}, err
	}
	var payload map[string]any
	if err := json.Unmarshal(metadata, &payload); err != nil {
		return MessageRunsResult{}, err
	}
	payload["workflowDefinition"] = definition
	metadata, err = json.Marshal(payload)
	if err != nil {
		return MessageRunsResult{}, err
	}
	messageID := uuid.NewString()
	targetIDs := []string{}
	runs := []domain.AgentRun{}
	for _, stage := range definition.Stages {
		for _, memberID := range stage.TargetMemberIDs {
			member := members[memberID]
			status := "waiting_dependency"
			if len(stage.DependsOn) == 0 {
				status = "queued"
				if member.EffectiveSessionID == "" {
					status = "resolving_session"
				}
			}
			targetIDs = append(targetIDs, memberID)
			runs = append(runs, domain.AgentRun{
				RunID: uuid.NewString(), RoomID: roomID, SourceMessageID: messageID, MemberID: memberID,
				AgentID: member.AgentID, SessionID: member.EffectiveSessionID, WorkDir: member.WorkspaceRoot,
				OriginKind: "agent_room", QueuePolicy: "enqueue", Status: status,
				Controls: append(json.RawMessage(nil), member.RuntimeControls...), WorkflowStageID: stage.StageID,
				PromptAssembly: workflowPromptAssembly(stage, content, nil),
			})
		}
	}
	message, created, err := s.store.CreateAgentRoomMessageWithRuns(ctx, domain.AgentRoomMessage{
		MessageID: messageID, RoomID: roomID, SenderKind: "user", Content: content,
		ReplyToMessageID: strings.TrimSpace(input.ReplyToMessageID), TargetMemberIDs: dedupeStrings(targetIDs),
		Attachments: input.Attachments, Metadata: metadata,
	}, runs)
	if err != nil {
		return MessageRunsResult{}, err
	}
	return MessageRunsResult{Message: message, Runs: created}, nil
}

func mergeMessageMetadata(raw json.RawMessage, mode string, sharedRunIDs []string) (json.RawMessage, error) {
	payload := map[string]any{}
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, validation("invalid_message_metadata", "message metadata must be a JSON object")
		}
	}
	payload["mode"] = mode
	if len(sharedRunIDs) > 0 {
		payload["sharedRunIds"] = sharedRunIDs
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

type RunUpdate struct {
	Status        string
	SessionID     string
	WorkDir       string
	TurnID        string
	PromptID      string
	QueuePosition *int
	ErrorCode     string
	ErrorMessage  string
	StartedAt     string
	CompletedAt   string
}

func (s *Service) UpdateRun(ctx context.Context, runID string, update RunUpdate) (domain.AgentRun, error) {
	run, err := s.store.GetAgentRun(ctx, strings.TrimSpace(runID))
	if err != nil {
		return domain.AgentRun{}, err
	}
	if run == nil {
		return domain.AgentRun{}, validation("run_not_found", "agent run not found")
	}
	status := strings.TrimSpace(update.Status)
	if !validRunStatus(status) {
		return domain.AgentRun{}, validation("invalid_run_status", "unsupported agent run status")
	}
	run.Status = status
	if value := strings.TrimSpace(update.SessionID); value != "" {
		run.SessionID = value
	}
	if value := strings.TrimSpace(update.WorkDir); value != "" {
		run.WorkDir = value
	}
	if value := strings.TrimSpace(update.TurnID); value != "" {
		run.TurnID = value
	}
	if value := strings.TrimSpace(update.PromptID); value != "" {
		run.PromptID = value
	}
	if update.QueuePosition != nil {
		run.QueuePosition = update.QueuePosition
	}
	if value := strings.TrimSpace(update.ErrorCode); value != "" {
		run.ErrorCode = value
	}
	if value := strings.TrimSpace(update.ErrorMessage); value != "" {
		run.ErrorMessage = value
	}
	if value := strings.TrimSpace(update.StartedAt); value != "" {
		run.StartedAt = value
	}
	if value := strings.TrimSpace(update.CompletedAt); value != "" {
		run.CompletedAt = value
	}
	return s.store.UpdateAgentRun(ctx, *run)
}

func (s *Service) MarkAbortRequested(ctx context.Context, runID string) (domain.AgentRun, error) {
	run, err := s.store.GetAgentRun(ctx, strings.TrimSpace(runID))
	if err != nil {
		return domain.AgentRun{}, err
	}
	if run == nil {
		return domain.AgentRun{}, validation("run_not_found", "agent run not found")
	}
	switch run.Status {
	case "queued", "resolving_session", "waiting_for_lease":
		return s.store.TransitionAgentRunForAbort(ctx, run.RunID, run.Status, "aborted")
	case "submitting", "running", "waiting_approval", "completing":
		return s.store.TransitionAgentRunForAbort(ctx, run.RunID, run.Status, "abort_requested")
	case "abort_requested":
		return *run, nil
	default:
		return domain.AgentRun{}, validation("run_not_abortable", "agent run is not abortable")
	}
}

func (s *Service) RetryRun(ctx context.Context, runID string) (domain.AgentRun, error) {
	previous, err := s.store.GetAgentRun(ctx, strings.TrimSpace(runID))
	if err != nil {
		return domain.AgentRun{}, err
	}
	if previous == nil {
		return domain.AgentRun{}, validation("run_not_found", "agent run not found")
	}
	if err := s.requireWritableRoom(ctx, previous.RoomID); err != nil {
		return domain.AgentRun{}, err
	}
	if !oneOf(previous.Status, "failed", "aborted", "orphaned", "blocked") {
		return domain.AgentRun{}, validation("run_not_retryable", "agent run must be terminal before retry")
	}
	return s.store.CreateAgentRun(ctx, domain.AgentRun{
		RunID:           uuid.NewString(),
		RoomID:          previous.RoomID,
		SourceMessageID: previous.SourceMessageID,
		MemberID:        previous.MemberID,
		AgentID:         previous.AgentID,
		SessionID:       previous.SessionID,
		WorkDir:         previous.WorkDir,
		OriginKind:      "agent_room",
		QueuePolicy:     previous.QueuePolicy,
		Status:          "queued",
		Controls:        append(json.RawMessage(nil), previous.Controls...),
		PromptAssembly:  append(json.RawMessage(nil), previous.PromptAssembly...),
	})
}

func validRunStatus(status string) bool {
	return oneOf(status, "queued", "resolving_session", "waiting_for_lease", "submitting", "running",
		"waiting_approval", "completing", "completed", "failed", "aborted", "orphaned", "blocked",
		"abort_requested", "conflicted")
}

func dedupeStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func (s *Service) requireWritableRoom(ctx context.Context, roomID string) error {
	room, err := s.store.GetAgentRoom(ctx, strings.TrimSpace(roomID))
	if err != nil {
		return err
	}
	if room == nil {
		return validation("room_not_found", "agent room not found")
	}
	if room.Archived {
		return validation("room_archived", "archived room is read-only until restored")
	}
	return nil
}

func (s *Service) validatePinnedSession(ctx context.Context, sessionID, workspace string) error {
	session, err := s.store.GetSessionByID(ctx, strings.TrimSpace(sessionID))
	if err != nil {
		return err
	}
	if session == nil {
		return validation("session_not_found", "pinned session was not found")
	}
	if !sameWorkspace(workspace, session.WorkDir) {
		return validation("workspace_mismatch", "session workspace does not match the requested workspace")
	}
	return nil
}

func normalizeWorkspace(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", validation("workspace_required", "workspace directory is required")
	}
	abs, err := filepath.Abs(filepath.Clean(value))
	if err != nil {
		return "", validation("invalid_workspace", "workspace path is invalid")
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		return "", validation("workspace_not_found", "workspace directory does not exist")
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	return filepath.Clean(abs), nil
}

func sameWorkspace(left, right string) bool {
	left = canonicalWorkspaceForCompare(left)
	right = canonicalWorkspaceForCompare(right)
	if left == "." || right == "." || left == "" || right == "" {
		return false
	}
	if runtime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func canonicalWorkspaceForCompare(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if abs, err := filepath.Abs(filepath.Clean(value)); err == nil {
		value = abs
	}
	if resolved, err := filepath.EvalSymlinks(value); err == nil {
		value = resolved
	}
	return filepath.Clean(value)
}

func validateSessionPolicy(policy domain.SessionPolicy, pinnedSessionID string) error {
	if !oneOf(string(policy), string(domain.SessionPolicyPerRoom), string(domain.SessionPolicyPersistent),
		string(domain.SessionPolicyNewPerTask), string(domain.SessionPolicyResumeSelected)) {
		return validation("invalid_session_policy", "unsupported agent session policy")
	}
	if pinnedSessionID != "" && policy != domain.SessionPolicyPersistent && policy != domain.SessionPolicyResumeSelected {
		return validation("invalid_pinned_session", "pinned session is not allowed for this session policy")
	}
	if policy == domain.SessionPolicyResumeSelected && pinnedSessionID == "" {
		return validation("session_required", "resume_selected requires a pinned session")
	}
	return nil
}

func normalizeRuntimeControls(raw json.RawMessage) (json.RawMessage, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if raw[0] != '{' {
		return nil, validation("invalid_runtime_controls", "runtime controls must be a JSON object")
	}
	var controls bridgeruntime.RuntimeControls
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&controls); err != nil {
		return nil, validation("invalid_runtime_controls", "runtime controls contain an unknown field or invalid value")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, validation("invalid_runtime_controls", "runtime controls must contain one JSON object")
	}
	encoded, err := json.Marshal(controls)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

func validation(code, message string) error {
	return &Error{Code: code, Message: message}
}
