package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type SDKAdapterOptions struct {
	Driver        Driver
	ApprovalStore ApprovalStore
	SessionStore  SessionStore
}

type SDKAdapter struct {
	driver    Driver
	registry  *SessionRegistry
	approvals *ApprovalCoordinator
	runner    *TurnRunner
	store     ApprovalStore
}

func NewSDKAdapter(options SDKAdapterOptions) (*SDKAdapter, error) {
	if options.Driver == nil {
		return nil, fmt.Errorf("sdk driver is required")
	}
	registry := NewSessionRegistry()
	approvals := NewApprovalCoordinator(options.ApprovalStore)
	return &SDKAdapter{
		driver:    options.Driver,
		registry:  registry,
		approvals: approvals,
		runner:    NewTurnRunner(options.Driver, registry, approvals, options.SessionStore),
		store:     options.ApprovalStore,
	}, nil
}

func (a *SDKAdapter) EnsureWorkspace(_ context.Context, root string) (WorkspaceRef, error) {
	return WorkspaceRef{Root: strings.TrimSpace(root)}, nil
}

func (a *SDKAdapter) EnsureSession(_ context.Context, request EnsureSessionRequest) (SessionRef, error) {
	sessionID := strings.TrimSpace(request.KimiCodeSessionID)
	source := strings.TrimSpace(request.SessionSource)
	if sessionID == "" {
		sessionID = uuid.NewString()
		source = firstNonEmptyString(source, "sdk_generated")
	} else {
		source = firstNonEmptyString(source, "sdk_existing")
	}
	return SessionRef{
		KimiCodeSessionID: sessionID,
		WorkspaceRoot:     strings.TrimSpace(request.WorkspaceRoot),
		WorkspaceID:       strings.TrimSpace(request.WorkspaceID),
		SessionSource:     source,
		RuntimeAdapter:    RuntimeAdapterSDK,
	}, nil
}

func (a *SDKAdapter) SubmitPrompt(ctx context.Context, request AdapterPromptRequest, sink AdapterEventSink) (AdapterPromptResult, error) {
	sessionID := strings.TrimSpace(request.SessionID)
	if sessionID == "" {
		return AdapterPromptResult{}, fmt.Errorf("session id is required")
	}
	response, err := a.runner.executePrompt(ctx, promptTarget{platform: RuntimeAdapterSDK, chatID: sessionID}, PromptRequest{
		KimiSessionID: sessionID,
		Prompt:        request.Text,
		WorkDir:       request.WorkspaceRoot,
		AutoApprove:   request.Controls.PermissionMode == "auto" || request.Controls.PermissionMode == "yolo",
		Attachments:   append([]domain.PromptAttachment(nil), request.Attachments...),
	}, func(event PromptEvent) error {
		return emitSDKAdapterEvent(sink, sessionID, event)
	})
	result := AdapterPromptResult{
		PromptID: response.TurnID,
		Status:   response.Result.Status,
	}
	if result.Status == "" {
		result.Status = "completed"
	}
	if err != nil {
		result.Status = "failed"
		return result, err
	}
	if response.Result.Error != "" {
		result.Status = "failed"
		return result, errors.New(response.Result.Error)
	}
	return result, nil
}

func (a *SDKAdapter) ListApprovals(ctx context.Context, sessionID string) ([]RuntimeApproval, error) {
	if a.store == nil {
		return nil, nil
	}
	tickets, err := a.store.ListApprovals(ctx, "pending")
	if err != nil {
		return nil, err
	}
	items := []RuntimeApproval{}
	for _, ticket := range tickets {
		if strings.TrimSpace(ticket.KimiSessionID) != strings.TrimSpace(sessionID) {
			continue
		}
		items = append(items, RuntimeApproval{
			ApprovalID: ticket.ApprovalID,
			SessionID:  ticket.KimiSessionID,
			ToolName:   ticket.RequestKind,
			Action:     ticket.Prompt,
			CreatedAt:  ticket.CreatedAt,
		})
	}
	return items, nil
}

func (a *SDKAdapter) ResolveApproval(ctx context.Context, _ string, approvalID string, decision ApprovalDecision) error {
	payload, _ := json.Marshal(decision)
	return a.approvals.Resolve(ctx, approvalID, approvalStatusFromDecision(decision), string(payload))
}

func (a *SDKAdapter) AbortPrompt(context.Context, string, string) error {
	return fmt.Errorf("sdk adapter does not support prompt abort")
}

func (a *SDKAdapter) Close() error {
	if a == nil || a.registry == nil {
		return nil
	}
	return a.registry.Close()
}

func emitSDKAdapterEvent(sink AdapterEventSink, sessionID string, event PromptEvent) error {
	if sink == nil || event.Type == "" {
		return nil
	}
	if event.Type == EventTypeContentDelta && strings.TrimSpace(event.Thinking) != "" {
		if err := sink(AdapterEvent{Type: "thinking_delta", Text: event.Thinking}); err != nil {
			return err
		}
		if strings.TrimSpace(event.Text) == "" {
			return nil
		}
	}
	mapped := AdapterEvent{}
	switch event.Type {
	case EventTypeTurnStarted:
		mapped.Type = "turn_started"
	case EventTypeStepStarted:
		mapped.Type = "step_started"
	case EventTypeContentDelta:
		mapped.Type = "content_delta"
		mapped.Text = event.Text
	case EventTypeStatusUpdate:
		mapped.Type = "status_update"
		mapped.Status = event.Status
	case EventTypeApprovalRequested:
		mapped.Type = "approval_requested"
		mapped.Approval = &RuntimeApproval{
			ApprovalID: strings.TrimSpace(event.ApprovalID),
			SessionID:  sessionID,
			ToolName:   strings.TrimSpace(event.RequestKind),
			Action:     strings.TrimSpace(event.Prompt),
		}
	case EventTypeApprovalResolved:
		mapped.Type = "approval_resolved"
		mapped.Status = event.Status
		mapped.Approval = &RuntimeApproval{
			ApprovalID: strings.TrimSpace(event.ApprovalID),
			SessionID:  sessionID,
		}
	case EventTypeTurnCompleted:
		mapped.Type = "turn_completed"
		mapped.Status = event.Status
	case EventTypeTurnFailed:
		mapped.Type = "turn_failed"
		mapped.Status = "failed"
		mapped.Error = event.Error
	default:
		return nil
	}
	return sink(mapped)
}

func approvalStatusFromDecision(decision ApprovalDecision) string {
	switch strings.TrimSpace(strings.ToLower(decision.Decision)) {
	case "approved", "approve":
		if strings.TrimSpace(decision.Scope) == "session" {
			return "approved_for_session"
		}
		return "approved"
	case "rejected", "reject", "denied", "deny":
		return "rejected"
	default:
		return "cancelled"
	}
}
