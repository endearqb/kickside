package bridgecore

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type ExecutionService struct {
	runtime   RuntimeProvider
	approvals ApprovalStore
	turns     TurnStore
	events    TurnEventStore
	guard     *SessionExecutionGuard
}

func NewExecutionService(runtime RuntimeProvider, approvals ApprovalStore, turns TurnStore, events TurnEventStore) *ExecutionService {
	service := &ExecutionService{runtime: runtime, approvals: approvals, turns: turns, events: events}
	leases, hasLeases := turns.(SessionLeaseStore)
	inspector, _ := runtime.(RuntimeSessionInspector)
	if hasLeases {
		service.guard = NewSessionExecutionGuard(leases, inspector, 0, 0)
	}
	return service
}

func (s *ExecutionService) Run(ctx context.Context, target ExecutionTarget, request ExecutionRequest, sink ExecutionEventSink) (executionResult ExecutionResult, executionErr error) {
	if s == nil || s.runtime == nil || s.turns == nil || s.events == nil {
		return ExecutionResult{}, fmt.Errorf("execution service dependencies are incomplete")
	}

	turnID := strings.TrimSpace(request.TurnID)
	if turnID == "" {
		turnID = uuid.NewString()
	}
	if request.RequireExactSession && strings.TrimSpace(request.KimiSessionID) == "" {
		return ExecutionResult{}, fmt.Errorf("session id is required for exact execution")
	}
	owner := firstNonEmpty(strings.TrimSpace(target.RunID), turnID)
	lease, err := s.guard.Begin(ctx, request.KimiSessionID, owner, request.RequireExactSession)
	if err != nil {
		return ExecutionResult{TurnID: turnID, KimiSessionID: strings.TrimSpace(request.KimiSessionID)}, err
	}
	if lease != nil {
		defer func() {
			finishCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := lease.Finish(finishCtx); err != nil {
				const publicMessage = "session lease heartbeat lost; further prompts are blocked"
				if health, ok := s.turns.(interface {
					BlockAgentRun(context.Context, string, string, string) error
				}); ok && strings.TrimSpace(target.RunID) != "" {
					_ = health.BlockAgentRun(finishCtx, target.RunID, "lease_heartbeat_lost", publicMessage)
				}
				if roomEvents, ok := s.events.(interface {
					AppendAgentRoomEvent(context.Context, domain.AgentRoomEvent) (domain.AgentRoomEvent, error)
				}); ok && strings.TrimSpace(target.RunID) != "" {
					_, _ = roomEvents.AppendAgentRoomEvent(finishCtx, domain.AgentRoomEvent{
						EventID: uuid.NewString(), RoomID: target.RoomID, MemberID: target.MemberID,
						AgentID: target.AgentID, RunID: target.RunID, SessionID: request.KimiSessionID,
						Kind: "system.warning", Status: "blocked", DisplayText: publicMessage,
					})
				}
				if executionErr == nil {
					executionErr = fmt.Errorf("lease_heartbeat_lost: %s", publicMessage)
					executionResult.Error = publicMessage
				}
			}
		}()
	}
	now := nowRFC3339()
	platform := firstNonEmpty(target.Platform, target.OriginKind)
	chatID := firstNonEmpty(target.ChatID, target.RoomID, target.RunID)
	turn := domain.BridgeTurn{
		TurnID:           turnID,
		ConnectorID:      target.ConnectorID,
		KimiSessionID:    strings.TrimSpace(request.KimiSessionID),
		BindingID:        strings.TrimSpace(request.BindingID),
		Platform:         platform,
		ChatID:           chatID,
		ThreadID:         target.ThreadID,
		InboundMessageID: strings.TrimSpace(request.InboundMessageID),
		PromptText:       strings.TrimSpace(request.Prompt),
		Status:           "accepted",
		ProviderName:     "kimi",
		StartedAt:        now,
		CreatedAt:        now,
		UpdatedAt:        now,
		OriginKind:       target.OriginKind,
		AgentID:          target.AgentID,
	}
	if err := s.turns.CreateTurn(ctx, turn); err != nil {
		return ExecutionResult{TurnID: turnID, KimiSessionID: turn.KimiSessionID}, err
	}

	accepted := TurnEvent{
		EventID:       uuid.NewString(),
		Kind:          EventTurnAccepted,
		TurnID:        turnID,
		KimiSessionID: turn.KimiSessionID,
		ConnectorID:   target.ConnectorID,
		Platform:      platform,
		ChatID:        chatID,
		ThreadID:      target.ThreadID,
		At:            now,
	}
	if err := s.persistAndEmit(ctx, target, accepted, sink); err != nil {
		return ExecutionResult{TurnID: turnID, KimiSessionID: turn.KimiSessionID}, err
	}

	var reply strings.Builder
	artifacts := []domain.RuntimeArtifact{}
	result, runErr := s.runtime.RunTurn(ctx, RuntimeTarget{
		Platform: platform,
		ChatID:   chatID,
		ThreadID: target.ThreadID,
	}, TurnRequest{
		TurnID:              turnID,
		Prompt:              turn.PromptText,
		WorkDir:             strings.TrimSpace(request.WorkDir),
		KimiSessionID:       turn.KimiSessionID,
		RequireExactSession: request.RequireExactSession,
		AutoApprove:         request.AutoApprove,
		MetadataJSON:        request.MetadataJSON,
		Attachments:         append([]domain.PromptAttachment(nil), request.Attachments...),
	}, func(event TurnEvent) error {
		event.TurnID = turnID
		if event.KimiSessionID == "" {
			event.KimiSessionID = turn.KimiSessionID
		}
		eventSessionID := firstNonEmpty(event.KimiSessionID, turn.KimiSessionID)
		if event.ConnectorID == "" {
			event.ConnectorID = target.ConnectorID
		}
		if event.Platform == "" {
			event.Platform = platform
		}
		if event.ChatID == "" {
			event.ChatID = chatID
		}
		if event.ThreadID == "" {
			event.ThreadID = target.ThreadID
		}
		if strings.TrimSpace(event.At) == "" {
			event.At = nowRFC3339()
		}
		if event.EventID == "" {
			event.EventID = uuid.NewString()
		}

		if event.Kind == EventContentDelta && event.TextDelta != "" {
			reply.WriteString(event.TextDelta)
		}
		if event.Kind == EventArtifactReady && event.Artifact != nil {
			artifacts = append(artifacts, *event.Artifact)
		}
		if event.Kind == EventApprovalRequested && s.approvals != nil {
			if err := s.approvals.CreateApprovalTicket(ctx, domain.ApprovalTicket{
				ApprovalID:         event.ApprovalID,
				ConnectorID:        target.ConnectorID,
				KimiSessionID:      eventSessionID,
				TurnID:             turnID,
				StepID:             approvalStepID(turnID, event.StepIndex),
				RequestKind:        defaultString(event.RequestKind, "approval"),
				Prompt:             strings.TrimSpace(event.Prompt),
				Platform:           platform,
				ChatID:             chatID,
				ThreadID:           target.ThreadID,
				Status:             "pending",
				RequestPayloadJSON: defaultString(event.RequestPayloadJSON, "{}"),
				DedupeKey:          approvalDedupeKey(platform, chatID, target.ThreadID, event.ApprovalID),
				OriginKind:         target.OriginKind,
				RoomID:             target.RoomID,
				MemberID:           target.MemberID,
				AgentID:            target.AgentID,
				RunID:              target.RunID,
			}); err != nil {
				return err
			}
		}
		return s.persistAndEmit(ctx, target, event, sink)
	})

	effectiveSessionID := firstNonEmpty(result.KimiSessionID, turn.KimiSessionID)
	turn.KimiSessionID = effectiveSessionID
	turn.Status = result.Status
	turn.UpdatedAt = nowRFC3339()
	if turn.Status == "" {
		turn.Status = "completed"
	}
	if runErr != nil {
		turn.Status = "failed"
		turn.ErrorMessage = runErr.Error()
	}
	if result.Error != "" {
		turn.Status = "failed"
		turn.ErrorMessage = result.Error
	}
	if turn.Status == "completed" || turn.Status == "failed" {
		turn.CompletedAt = turn.UpdatedAt
	}
	if err := s.turns.UpdateTurn(ctx, turn); err != nil {
		return ExecutionResult{}, err
	}
	if err := s.turns.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: effectiveSessionID,
		WorkDir:       strings.TrimSpace(request.WorkDir),
		LastTurnID:    turnID,
		LastMessageAt: turn.UpdatedAt,
		AutoApprove:   request.AutoApprove,
		ProviderName:  "kimi",
		CreatedAt:     turn.CreatedAt,
		UpdatedAt:     turn.UpdatedAt,
	}); err != nil {
		return ExecutionResult{}, err
	}

	executionResult = ExecutionResult{
		TurnID:        turnID,
		KimiSessionID: effectiveSessionID,
		PromptID:      result.PromptID,
		Status:        turn.Status,
		ReplyText:     strings.TrimSpace(reply.String()),
		Artifacts:     artifacts,
		Error:         turn.ErrorMessage,
		RuntimeResult: result,
	}
	if runErr != nil {
		return executionResult, runErr
	}
	return executionResult, nil
}

func (s *ExecutionService) persistAndEmit(ctx context.Context, target ExecutionTarget, event TurnEvent, sink ExecutionEventSink) error {
	if err := s.events.AppendTurnEvent(ctx, domain.TurnEventRecord{
		EventID:        event.EventID,
		ConnectorID:    event.ConnectorID,
		TurnID:         event.TurnID,
		KimiSessionID:  event.KimiSessionID,
		Platform:       event.Platform,
		ChatID:         event.ChatID,
		ThreadID:       event.ThreadID,
		Kind:           string(event.Kind),
		StepIndex:      event.StepIndex,
		MessageID:      event.MessageID,
		ApprovalID:     event.ApprovalID,
		RequestKind:    event.RequestKind,
		TextDelta:      event.TextDelta,
		ThinkingDelta:  event.ThinkingDelta,
		StatusText:     event.Status,
		PayloadJSON:    firstNonEmpty(event.RequestPayloadJSON, event.ResolutionJSON),
		ErrorCode:      event.ErrorCode,
		ErrorMessage:   event.Error,
		ContextUsage:   event.ContextUsage,
		TokenUsageJSON: tokenUsageJSON(event.TokenUsage),
		CreatedAt:      firstNonEmpty(event.At, nowRFC3339()),
	}); err != nil {
		return err
	}
	if sink != nil {
		return sink(ExecutionEvent{Target: target, Event: event})
	}
	return nil
}

func approvalStepID(turnID string, stepIndex int) string {
	return fmt.Sprintf("%s:step:%d", turnID, stepIndex)
}

func approvalDedupeKey(platform string, chatID string, threadID string, approvalID string) string {
	return fmt.Sprintf("%s:%s:%s:%s", strings.TrimSpace(platform), strings.TrimSpace(chatID), strings.TrimSpace(threadID), strings.TrimSpace(approvalID))
}

func tokenUsageJSON(usage TokenUsage) string {
	raw, err := json.Marshal(usage)
	if err != nil {
		return ""
	}
	return string(raw)
}
