package binding

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type Router struct {
	store *store.Store
}

func NewRouter(store *store.Store) *Router {
	return &Router{store: store}
}

func (r *Router) ResolveBinding(ctx context.Context, key domain.BindingKey) (*domain.SessionBinding, error) {
	return r.store.ResolveBinding(ctx, key)
}

func (r *Router) CreateBinding(ctx context.Context, key domain.BindingKey, kimiSessionID string, workDir string, source string) (*domain.SessionBinding, error) {
	now := nowRFC3339()
	binding := domain.SessionBinding{
		BindingID:     makeBindingID(key),
		Key:           key,
		KimiSessionID: kimiSessionID,
		WorkDir:       workDir,
		Source:        source,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	if err := r.store.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: kimiSessionID,
		WorkDir:       workDir,
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		return nil, err
	}
	if err := r.store.CreateBinding(ctx, binding); err != nil {
		existing, resolveErr := r.store.ResolveBinding(ctx, key)
		if resolveErr == nil && existing != nil {
			return existing, nil
		}
		return nil, err
	}
	return &binding, nil
}

func (r *Router) ResolveOrCreate(
	ctx context.Context,
	key domain.BindingKey,
	createSession func(context.Context, domain.BindingKey) (string, error),
) (*domain.SessionBinding, bool, error) {
	existing, err := r.ResolveBinding(ctx, key)
	if err != nil {
		return nil, false, err
	}
	if existing != nil {
		return existing, false, nil
	}

	kimiSessionID, err := createSession(ctx, key)
	if err != nil {
		return nil, false, fmt.Errorf("failed to create kimi session for %+v: %w", key, err)
	}
	binding, err := r.CreateBinding(ctx, key, kimiSessionID, "", "auto")
	if err != nil {
		return nil, false, err
	}
	return binding, true, nil
}

func (r *Router) ClearBinding(ctx context.Context, bindingID string) error {
	return r.store.ClearBinding(ctx, bindingID)
}

func (r *Router) Rebind(ctx context.Context, bindingID string, kimiSessionID string) error {
	kimiSessionID = strings.TrimSpace(kimiSessionID)
	if kimiSessionID == "" {
		return fmt.Errorf("kimi session id is required")
	}

	current, err := r.store.GetBindingByID(ctx, bindingID)
	if err != nil {
		return err
	}
	if current == nil {
		return fmt.Errorf("binding %s not found", bindingID)
	}

	bindings, err := r.store.ListBindings(ctx)
	if err != nil {
		return err
	}
	for _, existing := range bindings {
		if strings.TrimSpace(existing.BindingID) == strings.TrimSpace(bindingID) {
			continue
		}
		if strings.TrimSpace(existing.KimiSessionID) != kimiSessionID {
			continue
		}
		return fmt.Errorf(
			"kimi session %s is already bound to %s; each robot binding must keep an isolated session",
			kimiSessionID,
			existing.BindingID,
		)
	}

	now := nowRFC3339()
	if err := r.store.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: kimiSessionID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}); err != nil {
		return err
	}
	session, err := r.store.GetSessionByID(ctx, kimiSessionID)
	if err != nil {
		return err
	}
	workDir := ""
	if session != nil {
		workDir = session.WorkDir
	}
	return r.store.Rebind(ctx, bindingID, kimiSessionID, workDir, "manual_rebind")
}

func (r *Router) UpdateBindingWorkDir(ctx context.Context, bindingID string, workDir string) error {
	return r.store.UpdateBindingWorkDir(ctx, bindingID, workDir)
}

func (r *Router) UpdateBindingOnboarding(ctx context.Context, bindingID string, onboardingVersion string) error {
	return r.store.UpdateBindingOnboarding(ctx, bindingID, onboardingVersion)
}

func (r *Router) UpdateBindingContextToken(ctx context.Context, bindingID string, contextToken string) error {
	return r.store.UpdateBindingContextToken(ctx, bindingID, contextToken)
}

func (r *Router) MarkInboundConsumed(ctx context.Context, bindingID string, messageID string) (bool, error) {
	if messageID == "" {
		return false, nil
	}
	lastMessageID, ok, err := r.store.GetLastInboundMessageID(ctx, bindingID)
	if err != nil {
		return false, err
	}
	if ok && lastMessageID == messageID {
		return true, nil
	}
	if err := r.store.UpdateLastInboundMessageID(ctx, bindingID, messageID); err != nil {
		return false, err
	}
	return false, nil
}

func (r *Router) RecordDeliveryIfAbsent(ctx context.Context, event domain.DeliveryEvent) (bool, error) {
	return r.store.RecordDeliveryEventIfAbsent(ctx, event)
}

func (r *Router) IsDuplicateApproval(ctx context.Context, dedupeKey string) (bool, error) {
	return r.store.HasApprovalDedupeKey(ctx, dedupeKey)
}

func makeBindingID(key domain.BindingKey) string {
	sum := sha1.Sum([]byte(key.ConnectorID + "|" + key.Platform + "|" + key.AccountID + "|" + key.ChatID + "|" + key.ThreadID))
	return "binding-" + hex.EncodeToString(sum[:8])
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
