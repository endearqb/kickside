package runtime

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type SessionStore interface {
	UpsertSession(context.Context, domain.BridgeSession) error
}

type TurnRunner struct {
	driver    Driver
	registry  *SessionRegistry
	approvals *ApprovalCoordinator
	sessions  SessionStore
}

type promptTarget struct {
	platform string
	chatID   string
	threadID string
}

func NewTurnRunner(driver Driver, registry *SessionRegistry, approvals *ApprovalCoordinator, sessions SessionStore) *TurnRunner {
	return &TurnRunner{
		driver:    driver,
		registry:  registry,
		approvals: approvals,
		sessions:  sessions,
	}
}

func (r *TurnRunner) RunPrompt(ctx context.Context, request PromptRequest) (PromptResponse, error) {
	events := []PromptEvent{}
	response, err := r.executePrompt(ctx, promptTarget{platform: "debug"}, request, func(event PromptEvent) error {
		events = append(events, event)
		return nil
	})
	response.Events = events
	return response, err
}

func (r *TurnRunner) ExecuteBindingPrompt(
	ctx context.Context,
	binding domain.SessionBinding,
	request PromptRequest,
	sink PromptEventSink,
) (PromptResponse, error) {
	if request.KimiSessionID == "" {
		request.KimiSessionID = binding.KimiSessionID
	}
	if request.WorkDir == "" {
		request.WorkDir = binding.WorkDir
	}
	return r.executePrompt(ctx, promptTarget{
		platform: binding.Key.Platform,
		chatID:   binding.Key.ChatID,
		threadID: binding.Key.ThreadID,
	}, request, sink)
}

func (r *TurnRunner) executePrompt(
	ctx context.Context,
	target promptTarget,
	request PromptRequest,
	sink PromptEventSink,
) (PromptResponse, error) {
	normalized, err := normalizePromptRequest(request)
	if err != nil {
		return PromptResponse{}, err
	}

	response := PromptResponse{
		KimiSessionID: normalized.KimiSessionID,
		TurnID:        uuid.NewString(),
	}
	if err := emitPromptEvent(sink, PromptEvent{Type: EventTypeTurnStarted}); err != nil {
		return response, err
	}

	err = r.registry.RunPrompt(ctx, normalized, r.driver.OpenSession, func(ctx context.Context, session DriverSession) error {
		promptCtx, cancel := context.WithCancel(ctx)
		defer cancel()

		stream, err := session.StartPrompt(promptCtx, normalized)
		if err != nil {
			return err
		}
		defer stream.Close()

		var loopErr error
		for event := range stream.Events() {
			if loopErr != nil {
				continue
			}
			if event.Type == driverEventApprovalRequested {
				ticket := domain.ApprovalTicket{
					ApprovalID:         event.ApprovalID,
					KimiSessionID:      normalized.KimiSessionID,
					TurnID:             response.TurnID,
					StepID:             approvalStepID(response.TurnID, event.StepIndex),
					RequestKind:        event.RequestKind,
					Prompt:             event.Prompt,
					Platform:           approvalPlatform(target.platform),
					ChatID:             approvalChatID(target.chatID, normalized.KimiSessionID),
					ThreadID:           target.threadID,
					Status:             "pending",
					RequestPayloadJSON: event.RequestPayloadJSON,
					DedupeKey:          approvalDedupeKey(target.platform, approvalChatID(target.chatID, normalized.KimiSessionID), target.threadID, event.ApprovalID),
				}
				if err := r.approvals.Register(ctx, ticket, event.Responder); err != nil {
					loopErr = err
					cancel()
					continue
				}
			}
			if err := emitPromptEvent(sink, driverEventToPromptEvent(event)); err != nil {
				loopErr = err
				cancel()
			}
		}

		result, ok := <-stream.Result()
		if !ok {
			result = DriverResult{
				Status: "failed",
				Error:  fmt.Errorf("runtime prompt exited without a result"),
			}
		}
		response.Result = PromptResult{
			Status:       result.Status,
			ContextUsage: result.ContextUsage,
			TokenUsage:   result.TokenUsage,
		}
		if result.Error != nil {
			response.Result.Error = result.Error.Error()
			if loopErr == nil {
				if err := emitPromptEvent(sink, PromptEvent{
					Type:  EventTypeTurnFailed,
					Error: result.Error.Error(),
				}); err != nil {
					loopErr = err
				}
			}
		} else {
			if loopErr == nil {
				if err := emitPromptEvent(sink, PromptEvent{
					Type:   EventTypeTurnCompleted,
					Status: result.Status,
				}); err != nil {
					loopErr = err
				}
			}
		}

		now := time.Now().UTC().Format(time.RFC3339)
		if err := r.sessions.UpsertSession(ctx, domain.BridgeSession{
			KimiSessionID: normalized.KimiSessionID,
			WorkDir:       normalized.WorkDir,
			LastTurnID:    response.TurnID,
			LastMessageAt: now,
			CreatedAt:     now,
		}); err != nil {
			return err
		}
		if loopErr != nil {
			return loopErr
		}
		return nil
	})
	if err != nil {
		return response, err
	}
	return response, nil
}

func normalizePromptRequest(request PromptRequest) (PromptRequest, error) {
	request.Prompt = strings.TrimSpace(request.Prompt)
	request.WorkDir = strings.TrimSpace(request.WorkDir)
	request.KimiSessionID = strings.TrimSpace(request.KimiSessionID)
	if request.Prompt == "" {
		return PromptRequest{}, fmt.Errorf("prompt is required")
	}
	if request.KimiSessionID == "" {
		request.KimiSessionID = uuid.NewString()
	}
	return request, nil
}

func approvalStepID(turnID string, stepIndex int) string {
	return fmt.Sprintf("%s:step:%d", turnID, stepIndex)
}

func approvalDedupeKey(platform string, chatID string, threadID string, approvalID string) string {
	return fmt.Sprintf("%s:%s:%s:%s", approvalPlatform(platform), chatID, threadID, approvalID)
}

func approvalPlatform(platform string) string {
	platform = strings.TrimSpace(platform)
	if platform == "" {
		return "debug"
	}
	return platform
}

func approvalChatID(chatID string, fallback string) string {
	chatID = strings.TrimSpace(chatID)
	if chatID != "" {
		return chatID
	}
	return fallback
}

func emitPromptEvent(sink PromptEventSink, event PromptEvent) error {
	if sink == nil || event.Type == "" {
		return nil
	}
	return sink(event)
}

func driverEventToPromptEvent(event DriverEvent) PromptEvent {
	switch event.Type {
	case driverEventStepStarted:
		return PromptEvent{
			Type:      EventTypeStepStarted,
			StepIndex: event.StepIndex,
		}
	case driverEventContentDelta:
		return PromptEvent{
			Type:      EventTypeContentDelta,
			StepIndex: event.StepIndex,
			Text:      event.Text,
			Thinking:  event.Thinking,
		}
	case driverEventStatusUpdate:
		return PromptEvent{
			Type:         EventTypeStatusUpdate,
			StepIndex:    event.StepIndex,
			MessageID:    event.MessageID,
			ContextUsage: event.ContextUsage,
			TokenUsage:   event.TokenUsage,
		}
	case driverEventApprovalRequested:
		return PromptEvent{
			Type:               EventTypeApprovalRequested,
			StepIndex:          event.StepIndex,
			ApprovalID:         event.ApprovalID,
			RequestKind:        event.RequestKind,
			Prompt:             event.Prompt,
			RequestPayloadJSON: event.RequestPayloadJSON,
		}
	case driverEventApprovalResolved:
		return PromptEvent{
			Type:       EventTypeApprovalResolved,
			StepIndex:  event.StepIndex,
			ApprovalID: event.ApprovalID,
			Status:     event.Status,
		}
	default:
		return PromptEvent{}
	}
}
