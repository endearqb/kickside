package agentroom

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type SessionEnsurer interface {
	EnsureSession(context.Context, bridgeruntime.EnsureSessionRequest) (bridgeruntime.SessionRef, error)
}

type Dispatcher struct {
	core         *Service
	store        *store.Store
	sessions     SessionEnsurer
	execution    *bridgecore.ExecutionService
	queue        *QueueCoordinator
	schedulersMu sync.Mutex
	schedulers   map[string]struct{}
	activeMu     sync.Mutex
	activeRuns   map[string]struct{}
}

type sharedRunResult struct {
	RunID   string
	AgentID string
	Text    string
}

func NewDispatcher(core *Service, dataStore *store.Store, sessions SessionEnsurer, runtime bridgecore.RuntimeProvider) *Dispatcher {
	inspector, _ := runtime.(RuntimeControl)
	return &Dispatcher{
		core: core, store: dataStore, sessions: sessions,
		execution:  bridgecore.NewExecutionService(runtime, dataStore, dataStore, dataStore),
		queue:      NewQueueCoordinator(dataStore, inspector, 0),
		schedulers: map[string]struct{}{},
		activeRuns: map[string]struct{}{},
	}
}

func (d *Dispatcher) Recover(ctx context.Context) error {
	if err := d.queue.Recover(ctx); err != nil {
		return err
	}
	sessionIDs, err := d.store.ListQueuedSessionIDs(ctx)
	if err != nil {
		return err
	}
	for _, sessionID := range sessionIDs {
		d.scheduleSession(sessionID)
	}
	workflowMessageIDs, err := d.store.ListRecoverableWorkflowMessageIDs(ctx)
	if err != nil {
		return err
	}
	for _, messageID := range workflowMessageIDs {
		if err := d.advanceWorkflow(ctx, messageID); err != nil {
			return err
		}
	}
	return nil
}

func (d *Dispatcher) HandleTerminalRun(runID string) {
	runID = strings.TrimSpace(runID)
	d.activeMu.Lock()
	_, executingHere := d.activeRuns[runID]
	d.activeMu.Unlock()
	run, err := d.store.GetAgentRun(context.Background(), runID)
	if err != nil || run == nil || !runTerminal(run.Status) {
		return
	}
	if executingHere {
		_ = d.advanceWorkflow(context.Background(), run.SourceMessageID)
		return
	}
	if run.SessionID != "" {
		_, _ = d.store.ReleaseSessionLease(context.Background(), run.SessionID, run.RunID)
		d.scheduleSession(run.SessionID)
	}
	_ = d.advanceWorkflow(context.Background(), run.SourceMessageID)
}

func (d *Dispatcher) scheduleSession(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	d.schedulersMu.Lock()
	if _, active := d.schedulers[sessionID]; active {
		d.schedulersMu.Unlock()
		return
	}
	d.schedulers[sessionID] = struct{}{}
	d.schedulersMu.Unlock()
	go func() {
		defer func() {
			d.schedulersMu.Lock()
			delete(d.schedulers, sessionID)
			d.schedulersMu.Unlock()
		}()
		deadline := time.Now().Add(30 * time.Second)
		for {
			prepared, _, err := d.queue.PrepareNext(context.Background(), sessionID)
			if err == nil && prepared == nil {
				return
			}
			if err == nil && prepared != nil {
				d.executePrepared(*prepared)
				return
			}
			if time.Now().After(deadline) {
				return
			}
			time.Sleep(250 * time.Millisecond)
		}
	}()
}

func (d *Dispatcher) executePrepared(run domain.AgentRun) {
	room, _ := d.store.GetAgentRoom(context.Background(), run.RoomID)
	member, _ := d.store.GetAgentRoomMember(context.Background(), run.MemberID)
	message, _ := d.store.GetAgentRoomMessage(context.Background(), run.SourceMessageID)
	if room == nil || member == nil || message == nil {
		d.failRun(context.Background(), &run, "recovery_context_missing", "Recovered Run context is unavailable")
		return
	}
	attachments, err := decodePromptAttachments(message.Attachments)
	if err != nil {
		d.failRun(context.Background(), &run, ErrorCode(err), publicError(err))
		return
	}
	sharedIDs := sharedRunIDs(message.Metadata)
	if run.WorkflowStageID != "" {
		sharedIDs = promptAssemblySharedRunIDs(run.PromptAssembly)
	}
	sharedResults, err := d.resolveSharedRunResults(context.Background(), room.RoomID, sharedIDs)
	if err != nil {
		d.failRun(context.Background(), &run, ErrorCode(err), publicError(err))
		return
	}
	d.execute(context.Background(), *room, *member, message.Content, attachments, sharedResults, run)
}

func (d *Dispatcher) Dispatch(ctx context.Context, roomID string, input MessageInput) (MessageRunsResult, error) {
	attachments, err := decodePromptAttachments(input.Attachments)
	if err != nil {
		return MessageRunsResult{}, err
	}
	if strings.TrimSpace(input.Mode) == "workflow" && len(input.SharedRunIDs) > 0 {
		return MessageRunsResult{}, validation("workflow_shared_runs_not_allowed", "workflow dependencies define shared Run results")
	}
	result, err := d.core.CreateMessageWithRuns(ctx, roomID, input)
	if err != nil {
		return result, err
	}
	room, err := d.store.GetAgentRoom(ctx, roomID)
	if err != nil || room == nil {
		return result, firstError(err, validation("room_not_found", "agent room not found"))
	}
	for index := range result.Runs {
		run := result.Runs[index]
		if run.Status == "waiting_dependency" || run.Status == "waiting_user" {
			continue
		}
		updated, dispatchErr := d.prepareAndDispatch(ctx, *room, result.Message, run, attachments)
		result.Runs[index] = updated
		if dispatchErr != nil {
			result.Failures = append(result.Failures, TargetFailure{MemberID: run.MemberID, Code: ErrorCode(dispatchErr), Message: publicError(dispatchErr)})
		}
	}
	return result, nil
}

func (d *Dispatcher) prepareAndDispatch(ctx context.Context, room domain.AgentRoom, message domain.AgentRoomMessage, run domain.AgentRun, attachments []domain.PromptAttachment) (domain.AgentRun, error) {
	member, err := d.store.GetAgentRoomMember(ctx, run.MemberID)
	if err != nil || member == nil {
		d.failRun(ctx, &run, "member_not_found", "target member was not found")
		return run, firstError(err, validation("member_not_found", "target member was not found"))
	}
	if run.QueuePolicy != "record_only" {
		if err := d.resolveSession(ctx, member, &run); err != nil {
			d.failRun(ctx, &run, ErrorCode(err), publicError(err))
			_ = d.advanceWorkflow(ctx, run.SourceMessageID)
			return run, err
		}
	}
	sharedIDs := sharedRunIDs(message.Metadata)
	if run.WorkflowStageID != "" {
		sharedIDs = promptAssemblySharedRunIDs(run.PromptAssembly)
	}
	sharedResults, err := d.resolveSharedRunResults(ctx, room.RoomID, sharedIDs)
	if err != nil {
		d.failRun(ctx, &run, ErrorCode(err), publicError(err))
		_ = d.advanceWorkflow(ctx, run.SourceMessageID)
		return run, err
	}
	if run.WorkflowStageID == "" {
		run.PromptAssembly = promptAssembly(room, *member, message.Content, sharedResults)
	}
	updated, err := d.store.UpdateAgentRun(ctx, run)
	if err != nil {
		return run, err
	}
	prepared, _, prepareErr := d.queue.PrepareRun(ctx, updated.RunID)
	if prepareErr != nil {
		if stored, _ := d.store.GetAgentRun(ctx, updated.RunID); stored != nil {
			updated = *stored
		}
		if ErrorCode(prepareErr) == "session_busy" {
			return updated, nil
		}
		return updated, prepareErr
	}
	if stored, _ := d.store.GetAgentRun(ctx, updated.RunID); stored != nil {
		updated = *stored
	}
	if prepared != nil && prepared.Status == "submitting" {
		go d.execute(context.Background(), room, *member, message.Content, attachments, sharedResults, *prepared)
	}
	return updated, nil
}

func (d *Dispatcher) resolveSession(ctx context.Context, member *domain.AgentRoomMember, run *domain.AgentRun) error {
	if d.sessions == nil {
		return validation("server_provider_required", "Server Runtime is required for Agent Room dispatch")
	}
	request := bridgeruntime.EnsureSessionRequest{WorkspaceRoot: member.WorkspaceRoot, SessionSource: "agent_room"}
	switch member.SessionPolicy {
	case domain.SessionPolicyPerRoom:
		if member.EffectiveSessionID != "" {
			request.KimiCodeSessionID, request.CreateMode = member.EffectiveSessionID, bridgeruntime.SessionResumeExact
		} else {
			request.CreateMode = bridgeruntime.SessionCreateAlways
		}
	case domain.SessionPolicyNewPerTask:
		request.CreateMode = bridgeruntime.SessionCreateAlways
	case domain.SessionPolicyPersistent:
		profile, err := d.store.GetAgentProfile(ctx, member.AgentID)
		if err != nil || profile == nil || profile.PinnedSessionID == "" {
			return validation("session_not_found", "persistent Agent has no pinned Session")
		}
		request.KimiCodeSessionID, request.CreateMode = profile.PinnedSessionID, bridgeruntime.SessionResumeExact
	case domain.SessionPolicyResumeSelected:
		request.KimiCodeSessionID = firstNonEmptyString(member.PinnedSessionID, member.EffectiveSessionID)
		if request.KimiCodeSessionID == "" {
			return validation("session_not_found", "selected Session is missing")
		}
		request.CreateMode = bridgeruntime.SessionResumeExact
	default:
		return validation("invalid_session_policy", "unsupported Session policy")
	}
	ref, err := d.sessions.EnsureSession(ctx, request)
	if err != nil {
		return fmt.Errorf("session_resolution_failed: %w", err)
	}
	if strings.TrimSpace(ref.KimiCodeSessionID) == "" {
		return validation("session_not_found", "Runtime returned an empty Session")
	}
	run.SessionID, run.WorkDir, run.Status = ref.KimiCodeSessionID, firstNonEmptyString(ref.WorkspaceRoot, member.WorkspaceRoot), "queued"
	if err := d.store.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: run.SessionID, WorkDir: run.WorkDir, ProviderName: "server"}); err != nil {
		return err
	}
	if member.SessionPolicy == domain.SessionPolicyPerRoom && member.EffectiveSessionID == "" {
		member.EffectiveSessionID, member.PinnedSessionID, member.Status = run.SessionID, run.SessionID, "idle"
		if _, err := d.store.UpdateAgentRoomMember(ctx, *member); err != nil {
			return err
		}
	}
	return nil
}

func (d *Dispatcher) execute(ctx context.Context, room domain.AgentRoom, member domain.AgentRoomMember, content string, attachments []domain.PromptAttachment, sharedResults []sharedRunResult, run domain.AgentRun) {
	d.activeMu.Lock()
	d.activeRuns[run.RunID] = struct{}{}
	d.activeMu.Unlock()
	defer func() {
		d.activeMu.Lock()
		delete(d.activeRuns, run.RunID)
		d.activeMu.Unlock()
	}()
	run.Status, run.StartedAt = "running", time.Now().UTC().Format(time.RFC3339)
	_, _ = d.store.UpdateAgentRun(ctx, run)
	metadata, _ := json.Marshal(map[string]any{"runtime_controls": json.RawMessage(member.RuntimeControls), "agent_room": map[string]string{"run_id": run.RunID, "room_id": run.RoomID}})
	result, err := d.execution.Run(ctx, bridgecore.ExecutionTarget{OriginKind: "agent_room", Platform: "agent_room", RoomID: run.RoomID, MemberID: run.MemberID, AgentID: run.AgentID, RunID: run.RunID}, bridgecore.ExecutionRequest{
		Prompt: assemblePrompt(room, member, content, promptAssemblyStagePrompt(run.PromptAssembly), sharedResults), WorkDir: run.WorkDir, KimiSessionID: run.SessionID,
		RequireExactSession: true, AutoApprove: member.AutoApprove, MetadataJSON: string(metadata), Attachments: attachments,
	}, nil)
	run.TurnID, run.PromptID = result.TurnID, result.PromptID
	status := result.Status
	if err != nil || status == "" {
		status = "failed"
	}
	run.Status = status
	if err != nil {
		run.ErrorCode, run.ErrorMessage = runtimePublicError(err)
	} else if status == "failed" {
		run.ErrorCode, run.ErrorMessage = "runtime_failed", "Runtime reported a failed turn"
	} else if status == "aborted" {
		run.ErrorCode, run.ErrorMessage = "runtime_aborted", "Runtime aborted the turn"
	}
	_, _ = d.store.UpdateAgentRun(ctx, run)
	next, _, _ := d.queue.CompleteRun(ctx, run.RunID, status)
	_ = d.advanceWorkflow(ctx, run.SourceMessageID)
	if next != nil {
		d.executePrepared(*next)
	}
}

func decodePromptAttachments(raw json.RawMessage) ([]domain.PromptAttachment, error) {
	if value := strings.TrimSpace(string(raw)); value == "" || value == "null" || value == "[]" {
		return nil, nil
	}
	var attachments []domain.PromptAttachment
	if err := json.Unmarshal(raw, &attachments); err != nil {
		return nil, validation("invalid_attachments", "attachments must be a valid array")
	}
	if len(attachments) > 16 {
		return nil, validation("attachment_limit_reached", "at most 16 attachments are allowed")
	}
	for index := range attachments {
		attachment := &attachments[index]
		attachment.LocalPath = strings.TrimSpace(attachment.LocalPath)
		if attachment.LocalPath == "" || !filepath.IsAbs(attachment.LocalPath) {
			return nil, validation("invalid_attachment_path", "attachment path must be absolute")
		}
		if attachment.Kind == "" {
			attachment.Kind = domain.AttachmentKindFile
		}
		if attachment.Kind != domain.AttachmentKindFile && attachment.Kind != domain.AttachmentKindImage {
			return nil, validation("invalid_attachment_kind", "attachment kind is unsupported")
		}
		if strings.TrimSpace(attachment.FileName) == "" {
			attachment.FileName = filepath.Base(attachment.LocalPath)
		}
	}
	return attachments, nil
}

func (d *Dispatcher) failRun(ctx context.Context, run *domain.AgentRun, code, message string) {
	run.Status, run.ErrorCode, run.ErrorMessage = "failed", firstNonEmptyString(code, "dispatch_failed"), message
	run.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	updated, _ := d.store.UpdateAgentRun(ctx, *run)
	*run = updated
}

func assemblePrompt(room domain.AgentRoom, member domain.AgentRoomMember, content, stagePrompt string, sharedResults []sharedRunResult) string {
	parts := []string{}
	if value := strings.TrimSpace(member.RolePromptSnapshot); value != "" {
		parts = append(parts, "Role:\n"+value)
	}
	if value := strings.TrimSpace(room.SharedBrief); value != "" {
		parts = append(parts, "Shared brief:\n"+value)
	}
	if value := strings.TrimSpace(stagePrompt); value != "" {
		parts = append(parts, "Workflow stage instruction:\n"+value)
	}
	for _, result := range sharedResults {
		parts = append(parts, fmt.Sprintf("Shared result %s (agent %s):\n%s", result.RunID, firstNonEmptyString(result.AgentID, "unknown"), result.Text))
	}
	parts = append(parts, "Task:\n"+strings.TrimSpace(content))
	return strings.Join(parts, "\n\n")
}

func promptAssembly(room domain.AgentRoom, member domain.AgentRoomMember, content string, sharedResults []sharedRunResult) json.RawMessage {
	sharedRunIDs := make([]string, 0, len(sharedResults))
	for _, result := range sharedResults {
		sharedRunIDs = append(sharedRunIDs, result.RunID)
	}
	value, _ := json.Marshal(map[string]any{"version": 1, "rolePrompt": member.RolePromptSnapshot != "", "sharedBrief": room.SharedBrief != "", "sharedRunIds": sharedRunIDs, "task": strings.TrimSpace(content)})
	return value
}

func (d *Dispatcher) resolveSharedRunResults(ctx context.Context, roomID string, runIDs []string) ([]sharedRunResult, error) {
	results := []sharedRunResult{}
	totalBytes := 0
	for _, runID := range dedupeStrings(runIDs) {
		run, err := d.store.GetAgentRun(ctx, runID)
		if err != nil {
			return nil, err
		}
		if run == nil || run.RoomID != strings.TrimSpace(roomID) || run.Status != "completed" {
			return nil, validation("shared_run_unavailable", "shared Run must be completed and belong to this Room")
		}
		events, err := d.store.ListAgentRoomEventsByRun(ctx, roomID, runID, 500)
		if err != nil {
			return nil, err
		}
		var text strings.Builder
		for _, event := range events {
			if event.Kind == "run.reply_delta" && event.TextDelta != "" {
				text.WriteString(event.TextDelta)
			}
		}
		value := strings.TrimSpace(text.String())
		if value == "" {
			return nil, validation("shared_run_result_unavailable", "shared Run has no projected reply")
		}
		totalBytes += len(value)
		if totalBytes > 64*1024 {
			return nil, validation("shared_results_too_large", "shared Run results exceed 64 KiB")
		}
		results = append(results, sharedRunResult{RunID: run.RunID, AgentID: run.AgentID, Text: value})
	}
	return results, nil
}

func sharedRunIDs(metadata json.RawMessage) []string {
	var value struct {
		SharedRunIDs []string `json:"sharedRunIds"`
	}
	_ = json.Unmarshal(metadata, &value)
	return value.SharedRunIDs
}

func publicError(err error) string {
	switch ErrorCode(err) {
	case "server_provider_required":
		return "Server Runtime is required for Agent Room dispatch"
	case "invalid_attachments", "attachment_limit_reached", "invalid_attachment_path", "invalid_attachment_kind":
		return "Agent Room attachment metadata is invalid"
	case "shared_run_unavailable", "shared_run_result_unavailable", "shared_results_too_large":
		return "Shared Run result is unavailable"
	}
	return "Agent Room Session could not be resolved"
}

func runtimePublicError(err error) (string, string) {
	var promptFailure *bridgeruntime.PromptFailureError
	if errors.As(err, &promptFailure) {
		switch strings.TrimSpace(promptFailure.Code) {
		case "model.not_configured":
			return "model_not_configured", "Runtime model is not configured"
		case "attachments_unsupported":
			return "attachments_unsupported", "Runtime does not support prompt attachments"
		default:
			return "runtime_error", "Runtime execution failed"
		}
	}
	if err != nil && strings.Contains(err.Error(), "attachments_unsupported") {
		return "attachments_unsupported", "Runtime does not support prompt attachments"
	}
	return "runtime_error", "Runtime execution failed"
}

func firstError(err, fallback error) error {
	if err != nil {
		return err
	}
	return fallback
}
func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
