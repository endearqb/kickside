package runtimeadapter

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

type ApprovalStore interface {
	CreateApprovalTicket(context.Context, domain.ApprovalTicket) error
	ListApprovals(context.Context, string) ([]domain.ApprovalTicket, error)
	GetApprovalByID(context.Context, string) (*domain.ApprovalTicket, error)
	ResolveApproval(context.Context, string, string, string) error
}

type SessionStore interface {
	UpsertSession(context.Context, domain.BridgeSession) error
	ListSessions(context.Context) ([]domain.BridgeSession, error)
	ListBindings(context.Context) ([]domain.BindingRecord, error)
}

type Provider struct {
	adapter   bridgeruntime.RuntimeAdapter
	approvals ApprovalStore
	sessions  SessionStore
}

func NewProvider(adapter bridgeruntime.RuntimeAdapter, approvals ApprovalStore, sessions SessionStore) *Provider {
	return &Provider{
		adapter:   adapter,
		approvals: approvals,
		sessions:  sessions,
	}
}

func (p *Provider) EnsureSession(ctx context.Context, target bridgecore.RuntimeTarget, request bridgecore.RuntimeSessionRequest) (bridgecore.RuntimeSession, error) {
	session, err := p.ensureSession(ctx, bridgeruntime.EnsureSessionRequest{
		KimiCodeSessionID: strings.TrimSpace(request.KimiSessionID),
		WorkspaceRoot:     strings.TrimSpace(request.WorkDir),
		SessionSource:     "server",
	})
	if err != nil {
		return bridgecore.RuntimeSession{}, err
	}
	_ = target
	return bridgecore.RuntimeSession{
		KimiSessionID: session.KimiCodeSessionID,
		WorkDir:       session.WorkspaceRoot,
		Source:        firstNonEmpty(session.SessionSource, "server"),
	}, nil
}

func (p *Provider) RunTurn(
	ctx context.Context,
	target bridgecore.RuntimeTarget,
	request bridgecore.TurnRequest,
	sink bridgecore.TurnEventSink,
) (bridgecore.TurnResult, error) {
	prompt := strings.TrimSpace(request.Prompt)
	if prompt == "" {
		return bridgecore.TurnResult{}, fmt.Errorf("prompt is required")
	}

	session, err := p.ensureSession(ctx, bridgeruntime.EnsureSessionRequest{
		KimiCodeSessionID: strings.TrimSpace(request.KimiSessionID),
		WorkspaceRoot:     strings.TrimSpace(request.WorkDir),
		SessionSource:     "server",
	})
	if err != nil {
		return bridgecore.TurnResult{}, err
	}
	sessionID := session.KimiCodeSessionID
	if sessionID == "" {
		return bridgecore.TurnResult{}, fmt.Errorf("runtime adapter returned an empty session id")
	}

	if err := sinkTurnEvent(sink, bridgecore.TurnEvent{
		Kind:          bridgecore.EventTurnStarted,
		KimiSessionID: sessionID,
		Platform:      target.Platform,
		ChatID:        target.ChatID,
		ThreadID:      target.ThreadID,
		Status:        "running",
		At:            nowRFC3339(),
	}); err != nil {
		return bridgecore.TurnResult{KimiSessionID: sessionID, Status: "failed", Error: err.Error()}, err
	}

	result, err := p.adapter.SubmitPrompt(ctx, bridgeruntime.AdapterPromptRequest{
		SessionID:     sessionID,
		WorkspaceRoot: firstNonEmpty(session.WorkspaceRoot, request.WorkDir),
		Text:          prompt,
		Attachments:   append([]domain.PromptAttachment(nil), request.Attachments...),
		Controls:      controlsFromTurnRequest(request),
		Metadata:      metadataFromTurnRequest(request),
	}, func(event bridgeruntime.AdapterEvent) error {
		return p.emitAdapterEvent(sink, target, sessionID, event)
	})
	status := normalizePromptStatus(result.Status)
	turnResult := bridgecore.TurnResult{
		KimiSessionID: sessionID,
		Status:        status,
	}
	if err != nil {
		turnResult.Status = "failed"
		turnResult.Error = err.Error()
		return turnResult, err
	}

	if p.sessions != nil {
		now := nowRFC3339()
		metadata, _ := json.Marshal(map[string]any{
			"runtime_adapter": session.RuntimeAdapter,
			"workspace_id":    session.WorkspaceID,
			"session_source":  session.SessionSource,
			"prompt_id":       result.PromptID,
			"user_message_id": result.UserMessageID,
		})
		if err := p.sessions.UpsertSession(ctx, domain.BridgeSession{
			KimiSessionID:       sessionID,
			WorkDir:             firstNonEmpty(session.WorkspaceRoot, request.WorkDir),
			LastTurnID:          request.TurnID,
			LastMessageAt:       now,
			SessionState:        status,
			AutoApprove:         request.AutoApprove,
			ProviderName:        bridgeruntime.RuntimeAdapterServer,
			RuntimeMetadataJSON: string(metadata),
			CreatedAt:           now,
			UpdatedAt:           now,
		}); err != nil {
			return turnResult, err
		}
	}
	return turnResult, nil
}

func (p *Provider) ResolveApproval(ctx context.Context, approvalID string, status string, resolutionPayloadJSON string) error {
	if p.approvals == nil {
		return fmt.Errorf("approval store is not configured")
	}
	ticket, err := p.approvals.GetApprovalByID(ctx, approvalID)
	if err != nil {
		return err
	}
	if ticket == nil {
		return fmt.Errorf("approval %s not found", approvalID)
	}
	decision := approvalDecisionFromStatus(status, resolutionPayloadJSON)
	if err := p.adapter.ResolveApproval(ctx, ticket.KimiSessionID, approvalID, decision); err != nil {
		return err
	}
	return p.approvals.ResolveApproval(ctx, approvalID, status, resolutionPayloadJSON)
}

func (p *Provider) ReconcilePendingApprovals(ctx context.Context, reason string) (int, error) {
	if p.approvals == nil {
		return 0, nil
	}
	pending, err := p.approvals.ListApprovals(ctx, "pending")
	if err != nil {
		return 0, err
	}

	sessionIDs := map[string]struct{}{}
	localPendingByID := map[string]domain.ApprovalTicket{}
	for _, ticket := range pending {
		sessionID := strings.TrimSpace(ticket.KimiSessionID)
		if sessionID != "" {
			sessionIDs[sessionID] = struct{}{}
		}
		if approvalID := strings.TrimSpace(ticket.ApprovalID); approvalID != "" {
			localPendingByID[approvalID] = ticket
		}
	}
	bindingsBySession := map[string]domain.BindingRecord{}
	if p.sessions != nil {
		sessions, err := p.sessions.ListSessions(ctx)
		if err != nil {
			return 0, err
		}
		for _, session := range sessions {
			sessionID := strings.TrimSpace(session.KimiSessionID)
			if sessionID == "" {
				continue
			}
			if provider := strings.TrimSpace(session.ProviderName); provider != "" && provider != bridgeruntime.RuntimeAdapterServer {
				continue
			}
			sessionIDs[sessionID] = struct{}{}
		}
		bindings, err := p.sessions.ListBindings(ctx)
		if err != nil {
			return 0, err
		}
		for _, binding := range bindings {
			sessionID := strings.TrimSpace(binding.KimiSessionID)
			if sessionID == "" {
				continue
			}
			if _, ok := bindingsBySession[sessionID]; !ok {
				bindingsBySession[sessionID] = binding
			}
			sessionIDs[sessionID] = struct{}{}
		}
	}
	if len(sessionIDs) == 0 {
		return 0, nil
	}

	serverPendingByID := map[string]struct{}{}
	queriedSessions := map[string]struct{}{}
	reconciled := 0
	for sessionID := range sessionIDs {
		serverApprovals, err := p.adapter.ListApprovals(ctx, sessionID)
		if err != nil {
			// Kimi-code may be temporarily unavailable during Bridge startup. Leave
			// local pending approvals untouched rather than marking them stale.
			continue
		}
		queriedSessions[sessionID] = struct{}{}
		for _, approval := range serverApprovals {
			approvalID := strings.TrimSpace(approval.ApprovalID)
			if approvalID == "" {
				continue
			}
			serverPendingByID[approvalID] = struct{}{}
			if _, ok := localPendingByID[approvalID]; ok {
				continue
			}
			existing, err := p.approvals.GetApprovalByID(ctx, approvalID)
			if err != nil {
				return reconciled, err
			}
			if existing != nil {
				continue
			}
			if err := p.approvals.CreateApprovalTicket(ctx, approvalTicketFromRuntimeApproval(sessionID, approval, bindingsBySession[sessionID])); err != nil {
				return reconciled, err
			}
			reconciled++
		}
	}

	payloadJSON, err := json.Marshal(map[string]string{
		"reason":  reason,
		"adapter": bridgeruntime.RuntimeAdapterServer,
	})
	if err != nil {
		return reconciled, fmt.Errorf("marshal server approval reconciliation payload: %w", err)
	}
	for _, ticket := range pending {
		if _, ok := queriedSessions[strings.TrimSpace(ticket.KimiSessionID)]; !ok {
			continue
		}
		if _, ok := serverPendingByID[strings.TrimSpace(ticket.ApprovalID)]; ok {
			continue
		}
		if err := p.approvals.ResolveApproval(ctx, ticket.ApprovalID, "stale_failed", string(payloadJSON)); err != nil {
			return reconciled, err
		}
		reconciled++
	}
	return reconciled, nil
}

func (p *Provider) Close() error {
	if p == nil || p.adapter == nil {
		return nil
	}
	return p.adapter.Close()
}

func (p *Provider) ensureSession(ctx context.Context, request bridgeruntime.EnsureSessionRequest) (bridgeruntime.SessionRef, error) {
	session, err := p.adapter.EnsureSession(ctx, request)
	if err == nil {
		return session, nil
	}
	if strings.TrimSpace(request.KimiCodeSessionID) == "" || strings.TrimSpace(request.WorkspaceRoot) == "" {
		return bridgeruntime.SessionRef{}, err
	}
	request.KimiCodeSessionID = ""
	request.SessionSource = firstNonEmpty(request.SessionSource, "server_rebound")
	return p.adapter.EnsureSession(ctx, request)
}

func (p *Provider) emitAdapterEvent(
	sink bridgecore.TurnEventSink,
	target bridgecore.RuntimeTarget,
	sessionID string,
	event bridgeruntime.AdapterEvent,
) error {
	mapped := bridgecore.TurnEvent{
		KimiSessionID: sessionID,
		Platform:      target.Platform,
		ChatID:        target.ChatID,
		ThreadID:      target.ThreadID,
		At:            nowRFC3339(),
	}
	switch strings.TrimSpace(event.Type) {
	case "prompt_submitted", "status_update":
		mapped.Kind = bridgecore.EventStatusUpdated
		mapped.Status = firstNonEmpty(event.Status, "running")
	case "turn_started":
		return nil
	case "step_started":
		mapped.Kind = bridgecore.EventStepStarted
	case "content_delta":
		mapped.Kind = bridgecore.EventContentDelta
		mapped.TextDelta = event.Text
	case "thinking_delta":
		mapped.Kind = bridgecore.EventContentDelta
		mapped.ThinkingDelta = event.Text
	case "approval_requested":
		mapped.Kind = bridgecore.EventApprovalRequested
		if event.Approval != nil {
			mapped.ApprovalID = event.Approval.ApprovalID
			mapped.RequestKind = firstNonEmpty(event.Approval.ToolName, event.Approval.Action, "approval")
			mapped.Prompt = firstNonEmpty(event.Approval.Action, event.Approval.ToolName, "Runtime approval requested")
			payload, _ := json.Marshal(event.Approval)
			mapped.RequestPayloadJSON = string(payload)
		}
	case "approval_resolved":
		mapped.Kind = bridgecore.EventApprovalResolved
		if event.Approval != nil {
			mapped.ApprovalID = event.Approval.ApprovalID
		}
	case "turn_completed", "prompt_completed":
		mapped.Kind = bridgecore.EventTurnCompleted
		mapped.Status = firstNonEmpty(event.Status, "completed")
	case "turn_failed":
		mapped.Kind = bridgecore.EventTurnFailed
		mapped.Status = firstNonEmpty(event.Status, "failed")
		mapped.Error = event.Error
	default:
		return nil
	}
	return sinkTurnEvent(sink, mapped)
}

func controlsFromTurnRequest(request bridgecore.TurnRequest) bridgeruntime.RuntimeControls {
	controls := bridgeruntime.RuntimeControls{}
	var metadata map[string]any
	if strings.TrimSpace(request.MetadataJSON) != "" && json.Unmarshal([]byte(request.MetadataJSON), &metadata) == nil {
		source := metadata
		if nested, ok := metadata["runtime_controls"].(map[string]any); ok {
			source = nested
		} else if nested, ok := metadata["controls"].(map[string]any); ok {
			source = nested
		}
		controls.Model = metadataString(source, "model")
		controls.Thinking = metadataString(source, "thinking")
		controls.PermissionMode = firstNonEmpty(metadataString(source, "permissionMode"), metadataString(source, "permission_mode"))
		controls.PlanMode = metadataBool(source, "planMode") || metadataBool(source, "plan_mode")
		controls.SwarmMode = metadataBool(source, "swarmMode") || metadataBool(source, "swarm_mode")
		controls.GoalObjective = firstNonEmpty(metadataString(source, "goalObjective"), metadataString(source, "goal_objective"))
		controls.GoalControl = firstNonEmpty(metadataString(source, "goalControl"), metadataString(source, "goal_control"))
	}
	if request.AutoApprove {
		controls.PermissionMode = firstNonEmpty(controls.PermissionMode, "auto")
	}
	return controls
}

func metadataFromTurnRequest(request bridgecore.TurnRequest) map[string]any {
	metadata := map[string]any{}
	if strings.TrimSpace(request.MetadataJSON) != "" {
		_ = json.Unmarshal([]byte(request.MetadataJSON), &metadata)
	}
	if request.TurnID != "" {
		metadata["bridge_turn_id"] = request.TurnID
	}
	return metadata
}

func approvalDecisionFromStatus(status string, payloadJSON string) bridgeruntime.ApprovalDecision {
	decision := bridgeruntime.ApprovalDecision{Decision: "cancelled"}
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "approved", "approve", "yes":
		decision.Decision = "approved"
	case "rejected", "reject", "denied", "deny", "no":
		decision.Decision = "rejected"
	}
	var payload map[string]any
	if strings.TrimSpace(payloadJSON) != "" && json.Unmarshal([]byte(payloadJSON), &payload) == nil {
		if scope, ok := payload["scope"].(string); ok {
			decision.Scope = scope
		}
		if feedback, ok := payload["feedback"].(string); ok {
			decision.Feedback = feedback
		}
		if label, ok := payload["selected_label"].(string); ok {
			decision.SelectedLabel = label
		} else if label, ok := payload["selectedLabel"].(string); ok {
			decision.SelectedLabel = label
		}
	}
	return decision
}

func approvalTicketFromRuntimeApproval(sessionID string, approval bridgeruntime.RuntimeApproval, binding domain.BindingRecord) domain.ApprovalTicket {
	sessionID = firstNonEmpty(approval.SessionID, sessionID)
	createdAt := firstNonEmpty(approval.CreatedAt, nowRFC3339())
	payload, _ := json.Marshal(approval)
	platform := firstNonEmpty(binding.Platform, bridgeruntime.RuntimeAdapterServer)
	chatID := firstNonEmpty(binding.ChatID, sessionID)
	return domain.ApprovalTicket{
		ApprovalID:         strings.TrimSpace(approval.ApprovalID),
		ConnectorID:        firstNonEmpty(binding.ConnectorID, bridgeruntime.RuntimeAdapterServer),
		KimiSessionID:      sessionID,
		RequestKind:        firstNonEmpty(approval.ToolName, approval.Action, "approval"),
		Prompt:             firstNonEmpty(approval.Action, approval.ToolName, "Runtime approval requested"),
		Platform:           platform,
		ChatID:             chatID,
		ThreadID:           strings.TrimSpace(binding.ThreadID),
		Status:             "pending",
		RequestPayloadJSON: defaultJSON(string(payload)),
		DedupeKey:          fmt.Sprintf("%s:%s:%s:%s", platform, chatID, strings.TrimSpace(binding.ThreadID), strings.TrimSpace(approval.ApprovalID)),
		CreatedAt:          createdAt,
		UpdatedAt:          createdAt,
	}
}

func normalizePromptStatus(status string) string {
	switch strings.TrimSpace(strings.ToLower(status)) {
	case "completed", "complete", "finished", "success":
		return "completed"
	case "failed", "error":
		return "failed"
	case "aborted", "cancelled", "canceled":
		return "aborted"
	default:
		return "completed"
	}
}

func sinkTurnEvent(sink bridgecore.TurnEventSink, event bridgecore.TurnEvent) error {
	if sink == nil || event.Kind == "" {
		return nil
	}
	return sink(event)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func defaultJSON(value string) string {
	if strings.TrimSpace(value) == "" {
		return "{}"
	}
	return value
}

func metadataString(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}

func metadataBool(values map[string]any, key string) bool {
	value, _ := values[key].(bool)
	return value
}
