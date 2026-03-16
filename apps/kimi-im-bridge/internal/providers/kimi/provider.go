package kimi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type ApprovalResponder interface {
	Respond(context.Context, string, string) error
}

type ApprovalStore interface {
	ListApprovals(context.Context, string) ([]domain.ApprovalTicket, error)
	ResolveApproval(context.Context, string, string, string) error
}

type SessionStore interface {
	UpsertSession(context.Context, domain.BridgeSession) error
}

type Provider struct {
	driver    Driver
	pool      *SessionPool
	approvals ApprovalStore
	sessions  SessionStore

	mu      sync.Mutex
	pending map[string]ApprovalResponder
}

func NewProvider(driver Driver, approvals ApprovalStore, sessions SessionStore) *Provider {
	return &Provider{
		driver:    driver,
		pool:      NewSessionPool(),
		approvals: approvals,
		sessions:  sessions,
		pending:   make(map[string]ApprovalResponder),
	}
}

func (p *Provider) RunTurn(
	ctx context.Context,
	target bridgecore.RuntimeTarget,
	request bridgecore.TurnRequest,
	sink bridgecore.TurnEventSink,
) (bridgecore.TurnResult, error) {
	normalized, err := normalizeRequest(request)
	if err != nil {
		return bridgecore.TurnResult{}, err
	}

	turnID := normalized.TurnID
	if turnID == "" {
		turnID = uuid.NewString()
	}
	if err := emitTurnEvent(sink, bridgecore.TurnEvent{
		EventID:       uuid.NewString(),
		Kind:          bridgecore.EventTurnStarted,
		TurnID:        turnID,
		KimiSessionID: normalized.KimiSessionID,
		Platform:      target.Platform,
		ChatID:        target.ChatID,
		ThreadID:      target.ThreadID,
		At:            nowRFC3339(),
	}); err != nil {
		return bridgecore.TurnResult{}, err
	}

	response := bridgecore.TurnResult{}
	err = p.pool.RunTurn(ctx, Request{
		KimiSessionID: normalized.KimiSessionID,
		Prompt:        normalized.Prompt,
		WorkDir:       normalized.WorkDir,
		AutoApprove:   normalized.AutoApprove,
	}, p.driver.OpenSession, func(ctx context.Context, session DriverSession) error {
		promptCtx, cancel := context.WithCancel(ctx)
		defer cancel()

		stream, err := session.StartPrompt(promptCtx, Request{
			KimiSessionID: normalized.KimiSessionID,
			Prompt:        normalized.Prompt,
			WorkDir:       normalized.WorkDir,
			AutoApprove:   normalized.AutoApprove,
		})
		if err != nil {
			return err
		}
		defer stream.Close()

		var loopErr error
		for event := range stream.Events() {
			if loopErr != nil {
				continue
			}
			if event.Type == driverEventApprovalRequested && event.Responder != nil {
				p.registerApproval(event.ApprovalID, event.Responder)
			}
			if err := emitTurnEvent(sink, p.mapDriverEvent(target, turnID, normalized.KimiSessionID, event)); err != nil {
				loopErr = err
				cancel()
			}
		}

		result, ok := <-stream.Result()
		if !ok {
			result = DriverResult{Status: "failed", Error: fmt.Errorf("provider prompt exited without a result")}
		}
		response = bridgecore.TurnResult{
			Status:       result.Status,
			ContextUsage: result.ContextUsage,
			TokenUsage: bridgecore.TokenUsage{
				InputOther:         result.TokenUsage.InputOther,
				Output:             result.TokenUsage.Output,
				InputCacheRead:     result.TokenUsage.InputCacheRead,
				InputCacheCreation: result.TokenUsage.InputCacheCreation,
			},
		}
		if result.Error != nil {
			response.Error = result.Error.Error()
			if loopErr == nil {
				loopErr = emitTurnEvent(sink, bridgecore.TurnEvent{
					EventID:       uuid.NewString(),
					Kind:          bridgecore.EventTurnFailed,
					TurnID:        turnID,
					KimiSessionID: normalized.KimiSessionID,
					Platform:      target.Platform,
					ChatID:        target.ChatID,
					ThreadID:      target.ThreadID,
					Error:         result.Error.Error(),
					Status:        "failed",
					At:            nowRFC3339(),
				})
			}
		} else if loopErr == nil {
			loopErr = emitTurnEvent(sink, bridgecore.TurnEvent{
				EventID:       uuid.NewString(),
				Kind:          bridgecore.EventTurnCompleted,
				TurnID:        turnID,
				KimiSessionID: normalized.KimiSessionID,
				Platform:      target.Platform,
				ChatID:        target.ChatID,
				ThreadID:      target.ThreadID,
				Status:        result.Status,
				ContextUsage:  result.ContextUsage,
				TokenUsage: bridgecore.TokenUsage{
					InputOther:         result.TokenUsage.InputOther,
					Output:             result.TokenUsage.Output,
					InputCacheRead:     result.TokenUsage.InputCacheRead,
					InputCacheCreation: result.TokenUsage.InputCacheCreation,
				},
				At: nowRFC3339(),
			})
		}

		now := nowRFC3339()
		if p.sessions != nil {
			if err := p.sessions.UpsertSession(ctx, domain.BridgeSession{
				KimiSessionID: normalized.KimiSessionID,
				WorkDir:       normalized.WorkDir,
				LastTurnID:    turnID,
				LastMessageAt: now,
				SessionState:  "active",
				AutoApprove:   normalized.AutoApprove,
				ProviderName:  "kimi",
				CreatedAt:     now,
				UpdatedAt:     now,
			}); err != nil {
				return err
			}
		}
		return loopErr
	})
	if err != nil {
		return response, err
	}
	return response, nil
}

func (p *Provider) ResolveApproval(ctx context.Context, approvalID string, status string, resolutionPayloadJSON string) error {
	p.mu.Lock()
	responder, ok := p.pending[approvalID]
	if ok {
		delete(p.pending, approvalID)
	}
	p.mu.Unlock()

	if ok {
		if err := responder.Respond(ctx, status, resolutionPayloadJSON); err != nil {
			return fmt.Errorf("failed to respond approval %s: %w", approvalID, err)
		}
	}
	if p.approvals != nil {
		if err := p.approvals.ResolveApproval(ctx, approvalID, status, resolutionPayloadJSON); err != nil {
			return err
		}
	}
	return nil
}

func (p *Provider) ReconcilePendingApprovals(ctx context.Context, reason string) (int, error) {
	if p.approvals == nil {
		return 0, nil
	}
	tickets, err := p.approvals.ListApprovals(ctx, "pending")
	if err != nil {
		return 0, err
	}
	if len(tickets) == 0 {
		return 0, nil
	}

	p.mu.Lock()
	live := make(map[string]struct{}, len(p.pending))
	for approvalID := range p.pending {
		live[approvalID] = struct{}{}
	}
	p.mu.Unlock()

	payloadJSON, err := json.Marshal(map[string]string{"reason": reason})
	if err != nil {
		return 0, fmt.Errorf("marshal approval reconciliation payload: %w", err)
	}

	reconciled := 0
	for _, ticket := range tickets {
		if _, ok := live[ticket.ApprovalID]; ok {
			continue
		}
		if err := p.approvals.ResolveApproval(ctx, ticket.ApprovalID, "failed", string(payloadJSON)); err != nil {
			return reconciled, err
		}
		reconciled++
	}
	return reconciled, nil
}

func (p *Provider) Close() error {
	if p.pool == nil {
		return nil
	}
	return p.pool.Close()
}

func (p *Provider) registerApproval(approvalID string, responder ApprovalResponder) {
	if strings.TrimSpace(approvalID) == "" || responder == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pending[approvalID] = responder
}

func (p *Provider) mapDriverEvent(target bridgecore.RuntimeTarget, turnID string, sessionID string, event DriverEvent) bridgecore.TurnEvent {
	mapped := bridgecore.TurnEvent{
		EventID:       uuid.NewString(),
		TurnID:        turnID,
		KimiSessionID: sessionID,
		Platform:      target.Platform,
		ChatID:        target.ChatID,
		ThreadID:      target.ThreadID,
		StepIndex:     event.StepIndex,
		At:            nowRFC3339(),
	}
	switch event.Type {
	case driverEventStepStarted:
		mapped.Kind = bridgecore.EventStepStarted
	case driverEventContentDelta:
		mapped.Kind = bridgecore.EventContentDelta
		mapped.TextDelta = event.Text
		mapped.ThinkingDelta = event.Thinking
	case driverEventStatusUpdate:
		mapped.Kind = bridgecore.EventStatusUpdated
		mapped.MessageID = event.MessageID
		mapped.ContextUsage = event.ContextUsage
		mapped.TokenUsage = bridgecore.TokenUsage{
			InputOther:         event.TokenUsage.InputOther,
			Output:             event.TokenUsage.Output,
			InputCacheRead:     event.TokenUsage.InputCacheRead,
			InputCacheCreation: event.TokenUsage.InputCacheCreation,
		}
	case driverEventApprovalRequested:
		mapped.Kind = bridgecore.EventApprovalRequested
		mapped.ApprovalID = event.ApprovalID
		mapped.RequestKind = event.RequestKind
		mapped.Prompt = event.Prompt
		mapped.RequestPayloadJSON = event.RequestPayloadJSON
	case driverEventApprovalResolved:
		mapped.Kind = bridgecore.EventApprovalResolved
		mapped.ApprovalID = event.ApprovalID
		mapped.Status = event.Status
	}
	return mapped
}

func normalizeRequest(request bridgecore.TurnRequest) (bridgecore.TurnRequest, error) {
	request.Prompt = strings.TrimSpace(request.Prompt)
	request.WorkDir = strings.TrimSpace(request.WorkDir)
	request.KimiSessionID = strings.TrimSpace(request.KimiSessionID)
	request.TurnID = strings.TrimSpace(request.TurnID)
	if request.Prompt == "" {
		return bridgecore.TurnRequest{}, fmt.Errorf("prompt is required")
	}
	if request.KimiSessionID == "" {
		request.KimiSessionID = uuid.NewString()
	}
	return request, nil
}

func emitTurnEvent(sink bridgecore.TurnEventSink, event bridgecore.TurnEvent) error {
	if sink == nil || event.Kind == "" {
		return nil
	}
	return sink(event)
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
