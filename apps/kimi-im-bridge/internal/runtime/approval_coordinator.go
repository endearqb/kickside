package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type ApprovalResponder interface {
	Respond(ctx context.Context, status string, resolutionPayloadJSON string) error
}

type ApprovalStore interface {
	CreateApprovalTicket(context.Context, domain.ApprovalTicket) error
	ListApprovals(context.Context, string) ([]domain.ApprovalTicket, error)
	ResolveApproval(context.Context, string, string, string) error
}

type ApprovalCoordinator struct {
	store ApprovalStore

	mu      sync.Mutex
	pending map[string]ApprovalResponder
}

func NewApprovalCoordinator(store ApprovalStore) *ApprovalCoordinator {
	return &ApprovalCoordinator{
		store:   store,
		pending: make(map[string]ApprovalResponder),
	}
}

func (c *ApprovalCoordinator) Register(ctx context.Context, ticket domain.ApprovalTicket, responder ApprovalResponder) error {
	if err := c.store.CreateApprovalTicket(ctx, ticket); err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if responder != nil {
		c.pending[ticket.ApprovalID] = responder
	}
	return nil
}

func (c *ApprovalCoordinator) Resolve(ctx context.Context, approvalID string, status string, resolutionPayloadJSON string) error {
	c.mu.Lock()
	responder, ok := c.pending[approvalID]
	if ok {
		delete(c.pending, approvalID)
	}
	c.mu.Unlock()

	if ok {
		if err := responder.Respond(ctx, status, resolutionPayloadJSON); err != nil {
			return fmt.Errorf("failed to respond approval %s: %w", approvalID, err)
		}
	}

	if err := c.store.ResolveApproval(ctx, approvalID, status, resolutionPayloadJSON); err != nil {
		return err
	}
	return nil
}

func (c *ApprovalCoordinator) ReconcilePending(ctx context.Context, reason string) (int, error) {
	tickets, err := c.store.ListApprovals(ctx, "pending")
	if err != nil {
		return 0, err
	}
	if len(tickets) == 0 {
		return 0, nil
	}

	c.mu.Lock()
	live := make(map[string]struct{}, len(c.pending))
	for approvalID := range c.pending {
		live[approvalID] = struct{}{}
	}
	c.mu.Unlock()

	resolutionPayloadJSON, err := json.Marshal(map[string]string{
		"reason": reason,
	})
	if err != nil {
		return 0, fmt.Errorf("marshal approval reconciliation payload: %w", err)
	}

	reconciled := 0
	for _, ticket := range tickets {
		if _, ok := live[ticket.ApprovalID]; ok {
			continue
		}
		if err := c.store.ResolveApproval(ctx, ticket.ApprovalID, "failed", string(resolutionPayloadJSON)); err != nil {
			return reconciled, err
		}
		reconciled++
	}
	return reconciled, nil
}
