package agentroom

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

var ErrObserverResyncRequired = errors.New("runtime observer requires REST reconciliation")

const maxObservedReplyBytes = 32 * 1024

type ObserverProjector struct {
	store         *store.Store
	onRunTerminal func(string)
}

func (p *ObserverProjector) SetRunTerminalHandler(handler func(string)) {
	p.onRunTerminal = handler
}

func NewObserverProjector(dataStore *store.Store) *ObserverProjector {
	return &ObserverProjector{store: dataStore}
}

func (p *ObserverProjector) LoadCursor(ctx context.Context, sessionID string) (bridgeruntime.ObserverCursor, bool, error) {
	seq, epoch, _, ok, err := p.store.GetSessionWatchCursor(ctx, sessionID)
	return bridgeruntime.ObserverCursor{Seq: seq, Epoch: epoch}, ok, err
}

func (p *ObserverProjector) ApplyBatch(ctx context.Context, batch bridgeruntime.ObserverBatch) error {
	if batch.ResyncRequired {
		return ErrObserverResyncRequired
	}
	for _, event := range batch.Events {
		if err := p.applyEvent(ctx, event); err != nil {
			return err
		}
	}
	return nil
}

func (p *ObserverProjector) applyEvent(ctx context.Context, event bridgeruntime.ObservedRuntimeEvent) error {
	observation, err := p.store.GetSessionObservation(ctx, event.SessionID)
	if err != nil {
		return err
	}
	if observation == nil {
		session, err := p.store.GetSessionByID(ctx, event.SessionID)
		if err != nil {
			return err
		}
		if session == nil {
			return store.ErrAgentRoomNotFound
		}
		origin := "runtime_external"
		if pane, err := p.store.IsPaneSessionObserved(ctx, event.SessionID); err != nil {
			return err
		} else if pane {
			origin = "pane_manual"
		}
		observation = &domain.SessionObservation{SessionID: event.SessionID, WorkDir: session.WorkDir, SessionState: "unknown", ControlOrigin: origin}
	}
	run, err := p.store.ResolveObservedAgentRun(ctx, event.SessionID, event.RunID, event.PromptID, event.TurnID)
	if err != nil {
		return err
	}
	if run != nil && observedEventPredatesRun(event.Timestamp, run.CreatedAt) {
		run = nil
	}
	if run != nil {
		observation.ControlOrigin = run.OriginKind
	}
	roomEvent := projectObservedEvent(event, observation, run)
	projectObservedState(event, observation, run)
	approval := projectObservedApproval(event, observation, run)
	lastEventAt := strings.TrimSpace(event.Timestamp)
	if lastEventAt == "" {
		lastEventAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	duplicate, err := p.store.ApplySessionObservationBatch(ctx, store.SessionObservationBatch{
		Generation: event.Generation, Epoch: event.Epoch, FirstSeq: event.Seq, LastSeq: event.Seq,
		LastEventAt: lastEventAt, Observation: *observation, Events: []domain.AgentRoomEvent{roomEvent}, Run: run, Approval: approval,
	})
	if err == nil && !duplicate && run != nil && runTerminal(run.Status) && p.onRunTerminal != nil {
		p.onRunTerminal(run.RunID)
	}
	return err
}

func observedEventPredatesRun(eventTimestamp, runCreatedAt string) bool {
	eventTime, eventErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(eventTimestamp))
	runTime, runErr := time.Parse(time.RFC3339Nano, strings.TrimSpace(runCreatedAt))
	return eventErr == nil && runErr == nil && eventTime.Before(runTime)
}

func projectObservedApproval(event bridgeruntime.ObservedRuntimeEvent, observation *domain.SessionObservation, run *domain.AgentRun) *domain.ApprovalTicket {
	if event.ApprovalID == "" || (event.Type != "approval.requested" && event.Type != "approval.resolved") {
		return nil
	}
	status := "pending"
	resolvedAt, resolutionBy, resolutionPayload := "", "", ""
	if event.Type == "approval.resolved" {
		status = strings.ToLower(strings.TrimSpace(event.Decision))
		if status == "" || status == "resolved" {
			status = "approved"
		}
		resolvedAt, resolutionBy = event.Timestamp, "runtime"
		encoded, _ := json.Marshal(map[string]string{"decision": status})
		resolutionPayload = string(encoded)
	}
	request := map[string]any{}
	createdAt := event.Timestamp
	if event.Approval != nil {
		request = map[string]any{
			"toolCallId": event.Approval.ToolCallID, "toolName": event.Approval.ToolName,
			"action": event.Approval.Action, "toolInputDisplay": event.Approval.ToolInputDisplay,
			"expiresAt": event.Approval.ExpiresAt,
		}
		if event.Approval.CreatedAt != "" {
			createdAt = event.Approval.CreatedAt
		}
	}
	requestJSON, _ := json.Marshal(request)
	ticket := &domain.ApprovalTicket{
		ApprovalID: event.ApprovalID, KimiSessionID: event.SessionID, TurnID: event.TurnID,
		RequestKind: "tool", Prompt: "Runtime approval required", Platform: "agent_room", ChatID: "runtime",
		Status: status, RequestPayloadJSON: string(requestJSON), ResolutionPayloadJSON: resolutionPayload,
		DedupeKey: "runtime:" + event.ApprovalID, CreatedAt: createdAt, UpdatedAt: event.Timestamp,
		ResolvedAt: resolvedAt, ResolutionBy: resolutionBy, OriginKind: observation.ControlOrigin,
	}
	if run != nil {
		ticket.ChatID, ticket.RoomID, ticket.MemberID, ticket.AgentID, ticket.RunID = run.RoomID, run.RoomID, run.MemberID, run.AgentID, run.RunID
	}
	return ticket
}

func projectObservedEvent(event bridgeruntime.ObservedRuntimeEvent, observation *domain.SessionObservation, run *domain.AgentRun) domain.AgentRoomEvent {
	kind := mapObservedEventKind(event.Type, event.Status)
	_, errorMessage := publicObservedFailure(event.ErrorCode)
	payload, _ := json.Marshal(map[string]string{"runtimeEventType": event.Type})
	item := domain.AgentRoomEvent{
		EventID: event.EventID, SessionID: event.SessionID, TurnID: event.TurnID, PromptID: event.PromptID,
		Kind: kind, Status: normalizeObservedStatus(event), ApprovalID: event.ApprovalID,
		Payload: payload, CreatedAt: event.Timestamp,
	}
	if kind == "run.error" || kind == "run.failed" {
		item.DisplayText = errorMessage
		item.Status = "failed"
	}
	if event.Type == "assistant.delta" {
		item.TextDelta = event.TextDelta
	}
	if run != nil {
		item.RoomID, item.MemberID, item.AgentID, item.RunID = run.RoomID, run.MemberID, run.AgentID, run.RunID
	}
	if !event.Known {
		item.Kind, item.Status, item.TextDelta = "observer.unknown", "", ""
	}
	_ = observation
	return item
}

func projectObservedState(event bridgeruntime.ObservedRuntimeEvent, observation *domain.SessionObservation, run *domain.AgentRun) {
	if event.PromptID != "" {
		observation.CurrentPromptID = event.PromptID
		if run != nil && run.PromptID == "" {
			run.PromptID = event.PromptID
		}
	}
	if event.TurnID != "" {
		observation.CurrentTurnID = event.TurnID
		if run != nil && run.TurnID == "" {
			run.TurnID = event.TurnID
		}
	}
	switch event.Type {
	case "prompt.submitted", "turn.started", "turn.step.started":
		observation.SessionState = "running"
		if run != nil && !runTerminal(run.Status) {
			run.Status = "running"
			if run.StartedAt == "" {
				run.StartedAt = event.Timestamp
			}
		}
	case "assistant.delta":
		observation.SessionState = "running"
		observation.LastReply = appendObservedReply(observation.LastReply, event.TextDelta)
	case "thinking.delta":
		observation.SessionState = "running"
	case "agent.status.updated":
		if status := normalizeObservedStatus(event); status != "" {
			observation.SessionState = status
			if run != nil && !runTerminal(run.Status) && validObservedRunStatus(status) {
				run.Status = status
			}
		}
	case "approval.requested":
		observation.SessionState = "waiting_approval"
		if run != nil && !runTerminal(run.Status) {
			run.Status = "waiting_approval"
		}
	case "approval.resolved":
		observation.SessionState = "running"
		if run != nil && run.Status == "waiting_approval" {
			run.Status = "running"
		}
	case "error", "turn.step.interrupted":
		if run != nil && !runTerminal(run.Status) {
			run.ErrorCode, run.ErrorMessage = publicObservedFailure(event.ErrorCode)
		}
	case "turn.ended", "prompt.completed":
		status := normalizeObservedTerminalStatus(event.Status)
		observation.SessionState = status
		observation.CurrentTurnID, observation.CurrentPromptID = "", ""
		if run != nil && !runTerminal(run.Status) {
			run.Status, run.CompletedAt = status, event.Timestamp
			if status == "failed" {
				run.ErrorCode, run.ErrorMessage = publicObservedFailure(event.ErrorCode)
			}
		}
	}
}

func mapObservedEventKind(eventType, status string) string {
	switch eventType {
	case "prompt.submitted":
		return "run.prompt_submitted"
	case "turn.started":
		return "run.started"
	case "turn.step.started":
		return "run.step_started"
	case "assistant.delta":
		return "run.reply_delta"
	case "thinking.delta", "agent.status.updated":
		return "run.status"
	case "approval.requested":
		return "run.approval_requested"
	case "approval.resolved":
		return "run.approval_resolved"
	case "error", "turn.step.interrupted":
		return "run.error"
	case "turn.ended", "prompt.completed":
		switch normalizeObservedTerminalStatus(status) {
		case "failed":
			return "run.failed"
		case "aborted":
			return "run.aborted"
		default:
			return "run.completed"
		}
	default:
		return "observer.unknown"
	}
}

func publicObservedFailure(code string) (string, string) {
	switch strings.TrimSpace(code) {
	case "model.not_configured":
		return "model_not_configured", "Runtime model is not configured"
	default:
		return "runtime_error", "Runtime execution failed"
	}
}

func normalizeObservedStatus(event bridgeruntime.ObservedRuntimeEvent) string {
	value := strings.ToLower(strings.TrimSpace(event.Status))
	switch value {
	case "busy", "submitting":
		return "running"
	case "idle", "running", "waiting_approval", "completed", "failed", "aborted":
		return value
	default:
		return ""
	}
}

func normalizeObservedTerminalStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "aborted", "cancelled", "canceled":
		return "aborted"
	case "failed", "error":
		return "failed"
	default:
		return "completed"
	}
}

func validObservedRunStatus(value string) bool {
	switch value {
	case "running", "waiting_approval", "completed", "failed", "aborted":
		return true
	default:
		return false
	}
}

func runTerminal(value string) bool {
	switch value {
	case "completed", "failed", "aborted", "orphaned", "blocked", "conflicted":
		return true
	default:
		return false
	}
}

func appendObservedReply(current, delta string) string {
	current += delta
	if len(current) > maxObservedReplyBytes {
		start := len(current) - maxObservedReplyBytes
		for start < len(current) && !utf8.RuneStart(current[start]) {
			start++
		}
		current = current[start:]
	}
	return current
}

func (p *ObserverProjector) ObservedSessionState(ctx context.Context, sessionID string) (bridgeruntime.RuntimeSessionState, bool, error) {
	observation, err := p.store.GetSessionObservation(ctx, sessionID)
	if err != nil || observation == nil {
		return bridgeruntime.RuntimeSessionState{}, false, err
	}
	return bridgeruntime.RuntimeSessionState{
		SessionID: observation.SessionID, WorkspaceRoot: observation.WorkDir, Status: observation.SessionState,
		LastSeq: observation.LastSeq, ObservedAt: observation.UpdatedAt, Generation: observation.Generation,
	}, true, nil
}

func (p *ObserverProjector) ReconcileSession(ctx context.Context, state bridgeruntime.RuntimeSessionState, epoch string) error {
	origin := "runtime_external"
	if pane, err := p.store.IsPaneSessionObserved(ctx, state.SessionID); err != nil {
		return err
	} else if pane {
		origin = "pane_manual"
	}
	_, err := p.store.ApplySessionObservationBatch(ctx, store.SessionObservationBatch{
		Generation: state.Generation, Epoch: epoch, LastSeq: state.LastSeq, LastEventAt: state.ObservedAt, Reconciled: true,
		Observation: domain.SessionObservation{SessionID: state.SessionID, WorkDir: state.WorkspaceRoot,
			SessionState: strings.ToLower(strings.TrimSpace(state.Status)), ControlOrigin: origin},
	})
	return err
}
