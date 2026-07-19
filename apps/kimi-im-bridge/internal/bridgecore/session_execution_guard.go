package bridgecore

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

type SessionLeaseStore interface {
	AcquireSessionLease(context.Context, string, string, time.Time, time.Duration) (domain.SessionLease, bool, error)
	RenewSessionLease(context.Context, string, string, time.Time, time.Duration) (domain.SessionLease, bool, error)
	ReleaseSessionLease(context.Context, string, string) (bool, error)
	GetSessionLease(context.Context, string, time.Time) (*domain.SessionLease, error)
}

type RuntimeSessionInspector interface {
	InspectSession(context.Context, string) (bridgeruntime.RuntimeSessionState, error)
}

type SessionBusyDetails struct {
	SessionID       string `json:"sessionId"`
	RuntimeState    string `json:"runtimeState"`
	ControlOrigin   string `json:"controlOrigin"`
	LeaseOwnerRunID string `json:"leaseOwnerRunId,omitempty"`
	LeaseExpiresAt  string `json:"leaseExpiresAt,omitempty"`
	QueueDepth      int    `json:"queueDepth"`
	QueuePosition   *int   `json:"queuePosition,omitempty"`
	ObservedAt      string `json:"observedAt,omitempty"`
	Generation      int64  `json:"generation,omitempty"`
	RequestedPolicy string `json:"requestedPolicy,omitempty"`
	EffectivePolicy string `json:"effectivePolicy,omitempty"`
	Degradation     string `json:"degradation,omitempty"`
}

type SessionBusyError struct {
	Code    string             `json:"code"`
	Details SessionBusyDetails `json:"details"`
}

func (e *SessionBusyError) Error() string {
	return e.Code + ": session " + e.Details.SessionID + " is not available for a new prompt"
}

type SessionExecutionGuard struct {
	leases    SessionLeaseStore
	inspector RuntimeSessionInspector
	ttl       time.Duration
	heartbeat time.Duration
}

func NewSessionExecutionGuard(leases SessionLeaseStore, inspector RuntimeSessionInspector, ttl, heartbeat time.Duration) *SessionExecutionGuard {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	if heartbeat <= 0 {
		heartbeat = 10 * time.Second
	}
	return &SessionExecutionGuard{leases: leases, inspector: inspector, ttl: ttl, heartbeat: heartbeat}
}

func (g *SessionExecutionGuard) Begin(ctx context.Context, sessionID, owner string, requireRuntimeState bool) (*SessionExecutionLease, error) {
	if g == nil || g.leases == nil {
		return nil, nil
	}
	sessionID, owner = strings.TrimSpace(sessionID), strings.TrimSpace(owner)
	if sessionID == "" || owner == "" {
		return nil, errors.New("session id and execution owner are required")
	}
	state, stateErr := g.inspect(ctx, sessionID)
	if state.SessionID == "" {
		state.SessionID = sessionID
	}
	if stateErr != nil && requireRuntimeState {
		return nil, fmt.Errorf("server_provider_required: %w", stateErr)
	}
	if stateErr == nil {
		if err := g.rejectUnsafeRuntimeState(ctx, state); err != nil {
			return nil, err
		}
	}
	now := time.Now().UTC()
	lease, acquired, err := g.leases.AcquireSessionLease(ctx, sessionID, owner, now, g.ttl)
	if err != nil {
		return nil, err
	}
	if !acquired {
		current, _ := g.leases.GetSessionLease(ctx, sessionID, now)
		details := SessionBusyDetails{SessionID: sessionID, RuntimeState: state.Status, ControlOrigin: "agent_room"}
		if current != nil {
			details.LeaseOwnerRunID = current.Owner
			details.LeaseExpiresAt = current.ExpiresAt
		}
		return nil, &SessionBusyError{Code: "session_busy", Details: details}
	}
	if second, err := g.inspect(ctx, sessionID); err == nil {
		if second.SessionID == "" {
			second.SessionID = sessionID
		}
		if unsafe := g.rejectUnsafeRuntimeState(ctx, second); unsafe != nil {
			_, _ = g.leases.ReleaseSessionLease(context.Background(), sessionID, owner)
			return nil, unsafe
		}
	} else if requireRuntimeState {
		_, _ = g.leases.ReleaseSessionLease(context.Background(), sessionID, owner)
		return nil, fmt.Errorf("server_provider_required: %w", err)
	}
	leaseCtx, cancel := context.WithCancel(ctx)
	handle := &SessionExecutionLease{
		guard: g, lease: lease, cancel: cancel, done: make(chan struct{}),
	}
	go handle.heartbeatLoop(leaseCtx)
	return handle, nil
}

func (g *SessionExecutionGuard) inspect(ctx context.Context, sessionID string) (bridgeruntime.RuntimeSessionState, error) {
	if g.inspector == nil {
		return bridgeruntime.RuntimeSessionState{}, errors.New("runtime session inspection is unavailable")
	}
	return g.inspector.InspectSession(ctx, sessionID)
}

func (g *SessionExecutionGuard) rejectUnsafeRuntimeState(ctx context.Context, state bridgeruntime.RuntimeSessionState) error {
	status := strings.ToLower(strings.TrimSpace(state.Status))
	if runtimeSessionIdle(status) {
		return nil
	}
	details := SessionBusyDetails{
		SessionID: state.SessionID, RuntimeState: status, ControlOrigin: "runtime_external",
		ObservedAt: state.ObservedAt, Generation: state.Generation,
	}
	if runtimeSessionBusy(status) {
		if current, _ := g.leases.GetSessionLease(ctx, state.SessionID, time.Now()); current != nil {
			details.ControlOrigin = "agent_room"
			details.LeaseOwnerRunID = current.Owner
			details.LeaseExpiresAt = current.ExpiresAt
		}
		return &SessionBusyError{Code: "session_busy", Details: details}
	}
	return &SessionBusyError{Code: "session_state_unavailable", Details: details}
}

func runtimeSessionIdle(status string) bool {
	switch status {
	case "idle", "completed", "failed", "aborted", "cancelled", "canceled":
		return true
	default:
		return false
	}
}

func runtimeSessionBusy(status string) bool {
	switch status {
	case "running", "waiting_approval", "submitting", "busy":
		return true
	default:
		return false
	}
}

type SessionExecutionLease struct {
	guard  *SessionExecutionGuard
	lease  domain.SessionLease
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
	err    error
}

func (h *SessionExecutionLease) heartbeatLoop(ctx context.Context) {
	defer close(h.done)
	ticker := time.NewTicker(h.guard.heartbeat)
	defer ticker.Stop()
	failures := 0
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			_, renewed, err := h.guard.leases.RenewSessionLease(ctx, h.lease.SessionID, h.lease.Owner, now, h.guard.ttl)
			if err == nil && renewed {
				failures = 0
				continue
			}
			failures++
			if failures >= 3 {
				h.mu.Lock()
				if err != nil {
					h.err = fmt.Errorf("session lease heartbeat failed: %w", err)
				} else {
					h.err = errors.New("session lease heartbeat lost ownership")
				}
				h.mu.Unlock()
				return
			}
		}
	}
}

func (h *SessionExecutionLease) Finish(ctx context.Context) error {
	if h == nil {
		return nil
	}
	h.cancel()
	<-h.done
	released, releaseErr := h.guard.leases.ReleaseSessionLease(ctx, h.lease.SessionID, h.lease.Owner)
	if releaseErr == nil && !released {
		releaseErr = errors.New("session lease release lost ownership")
	}
	h.mu.Lock()
	heartbeatErr := h.err
	h.mu.Unlock()
	return errors.Join(heartbeatErr, releaseErr)
}
