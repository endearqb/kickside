package runtime

import (
	"context"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type Service struct {
	runner    *TurnRunner
	approvals *ApprovalCoordinator
	registry  *SessionRegistry
}

func NewService(driver Driver, approvalStore ApprovalStore, sessionStore SessionStore) *Service {
	registry := NewSessionRegistry()
	approvals := NewApprovalCoordinator(approvalStore)
	return &Service{
		runner:    NewTurnRunner(driver, registry, approvals, sessionStore),
		approvals: approvals,
		registry:  registry,
	}
}

func (s *Service) RunPrompt(ctx context.Context, request PromptRequest) (PromptResponse, error) {
	return s.runner.RunPrompt(ctx, request)
}

func (s *Service) RunBindingPrompt(ctx context.Context, binding domain.SessionBinding, request PromptRequest) (PromptResponse, error) {
	events := []PromptEvent{}
	response, err := s.ExecuteBindingPrompt(ctx, binding, request, func(event PromptEvent) error {
		events = append(events, event)
		return nil
	})
	response.Events = events
	return response, err
}

func (s *Service) ExecuteBindingPrompt(
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
	return s.runner.ExecuteBindingPrompt(ctx, binding, request, sink)
}

func (s *Service) ResolveApproval(ctx context.Context, approvalID string, status string, resolutionPayloadJSON string) error {
	return s.approvals.Resolve(ctx, approvalID, status, resolutionPayloadJSON)
}

func (s *Service) ReconcilePendingApprovals(ctx context.Context, reason string) (int, error) {
	return s.approvals.ReconcilePending(ctx, reason)
}

func (s *Service) Close() error {
	return s.registry.Close()
}
