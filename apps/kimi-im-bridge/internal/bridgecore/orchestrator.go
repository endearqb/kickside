package bridgecore

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapterkit"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func (o *Orchestrator) HandleInbound(
	ctx context.Context,
	inbound adapterkit.NormalizedInbound,
	options HandleOptions,
	sink TurnEventSink,
) (HandleResult, error) {
	if o == nil || o.bindings == nil || o.runtime == nil || o.turns == nil || o.events == nil {
		return HandleResult{}, fmt.Errorf("bridge orchestrator dependencies are incomplete")
	}

	binding, err := o.resolveOrCreateBinding(ctx, inbound.BindingKey, options.DefaultWorkDir)
	if err != nil {
		return HandleResult{}, err
	}

	turnID := uuid.NewString()
	now := nowRFC3339()
	turn := domain.BridgeTurn{
		TurnID:           turnID,
		KimiSessionID:    binding.KimiSessionID,
		BindingID:        binding.BindingID,
		Platform:         inbound.Platform,
		ChatID:           inbound.ChatID,
		ThreadID:         inbound.ThreadID,
		InboundMessageID: inbound.MessageID,
		PromptText:       strings.TrimSpace(inbound.Text),
		Status:           "accepted",
		ProviderName:     "kimi",
		StartedAt:        now,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := o.turns.CreateTurn(ctx, turn); err != nil {
		return HandleResult{}, err
	}

	accepted := TurnEvent{
		EventID:       uuid.NewString(),
		Kind:          EventTurnAccepted,
		TurnID:        turnID,
		KimiSessionID: binding.KimiSessionID,
		Platform:      inbound.Platform,
		ChatID:        inbound.ChatID,
		ThreadID:      inbound.ThreadID,
		At:            now,
	}
	if err := o.persistAndEmit(ctx, accepted, sink); err != nil {
		return HandleResult{}, err
	}

	var reply strings.Builder
	result, runErr := o.runtime.RunTurn(ctx, RuntimeTarget{
		Platform: inbound.Platform,
		ChatID:   inbound.ChatID,
		ThreadID: inbound.ThreadID,
	}, TurnRequest{
		TurnID:        turnID,
		Prompt:        strings.TrimSpace(inbound.Text),
		WorkDir:       binding.WorkDir,
		KimiSessionID: binding.KimiSessionID,
		AutoApprove:   options.AutoApprove,
		MetadataJSON:  options.MetadataJSON,
	}, func(event TurnEvent) error {
		event.TurnID = turnID
		if event.KimiSessionID == "" {
			event.KimiSessionID = binding.KimiSessionID
		}
		if event.Platform == "" {
			event.Platform = inbound.Platform
		}
		if event.ChatID == "" {
			event.ChatID = inbound.ChatID
		}
		if event.ThreadID == "" {
			event.ThreadID = inbound.ThreadID
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
		if event.Kind == EventApprovalRequested && o.approvals != nil {
			if err := o.approvals.CreateApprovalTicket(ctx, domain.ApprovalTicket{
				ApprovalID:         event.ApprovalID,
				KimiSessionID:      binding.KimiSessionID,
				TurnID:             turnID,
				StepID:             approvalStepID(turnID, event.StepIndex),
				RequestKind:        defaultString(event.RequestKind, "approval"),
				Prompt:             strings.TrimSpace(event.Prompt),
				Platform:           inbound.Platform,
				ChatID:             inbound.ChatID,
				ThreadID:           inbound.ThreadID,
				Status:             "pending",
				RequestPayloadJSON: defaultString(event.RequestPayloadJSON, "{}"),
				DedupeKey:          approvalDedupeKey(inbound.Platform, inbound.ChatID, inbound.ThreadID, event.ApprovalID),
			}); err != nil {
				return err
			}
		}
		return o.persistAndEmit(ctx, event, sink)
	})

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
	if err := o.turns.UpdateTurn(ctx, turn); err != nil {
		return HandleResult{}, err
	}
	if err := o.turns.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: binding.KimiSessionID,
		WorkDir:       binding.WorkDir,
		LastTurnID:    turnID,
		LastMessageAt: turn.UpdatedAt,
		ProviderName:  "kimi",
		CreatedAt:     turn.CreatedAt,
		UpdatedAt:     turn.UpdatedAt,
	}); err != nil {
		return HandleResult{}, err
	}
	if runErr != nil {
		return HandleResult{}, runErr
	}

	return HandleResult{
		Binding:   *binding,
		TurnID:    turnID,
		SessionID: binding.KimiSessionID,
		ReplyText: strings.TrimSpace(reply.String()),
		Result:    result,
	}, nil
}

func (o *Orchestrator) ResolveApproval(ctx context.Context, approvalID string, status string, payload string) error {
	if o == nil || o.runtime == nil {
		return fmt.Errorf("bridge orchestrator runtime is not configured")
	}
	return o.runtime.ResolveApproval(ctx, approvalID, status, payload)
}

func (o *Orchestrator) resolveOrCreateBinding(ctx context.Context, key domain.BindingKey, defaultWorkDir string) (*domain.SessionBinding, error) {
	binding, err := o.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, err
	}
	if binding != nil {
		if binding.WorkDir == "" {
			binding.WorkDir = strings.TrimSpace(defaultWorkDir)
		}
		return binding, nil
	}
	return o.bindings.CreateBinding(ctx, key, uuid.NewString(), strings.TrimSpace(defaultWorkDir), "auto")
}

func (o *Orchestrator) persistAndEmit(ctx context.Context, event TurnEvent, sink TurnEventSink) error {
	if err := o.events.AppendTurnEvent(ctx, domain.TurnEventRecord{
		EventID:        event.EventID,
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
		return sink(event)
	}
	return nil
}

func approvalStepID(turnID string, stepIndex int) string {
	return fmt.Sprintf("%s:step:%d", turnID, stepIndex)
}

func approvalDedupeKey(platform string, chatID string, threadID string, approvalID string) string {
	return fmt.Sprintf("%s:%s:%s:%s", strings.TrimSpace(platform), strings.TrimSpace(chatID), strings.TrimSpace(threadID), strings.TrimSpace(approvalID))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func defaultString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func tokenUsageJSON(usage TokenUsage) string {
	raw, err := json.Marshal(usage)
	if err != nil {
		return ""
	}
	return string(raw)
}
