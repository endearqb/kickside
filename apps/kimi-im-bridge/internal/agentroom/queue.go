package agentroom

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type RuntimeControl interface {
	InspectSession(context.Context, string) (bridgeruntime.RuntimeSessionState, error)
}

type ObservedRuntimeStateSource interface {
	ObservedSessionState(context.Context, string) (bridgeruntime.RuntimeSessionState, bool, error)
}

type RuntimeStateResolver struct {
	observer          ObservedRuntimeStateSource
	runtime           RuntimeControl
	currentGeneration func() int64
	maxObserverAge    time.Duration
	now               func() time.Time
}

func NewRuntimeStateResolver(observer ObservedRuntimeStateSource, runtime RuntimeControl, currentGeneration func() int64, maxObserverAge time.Duration) *RuntimeStateResolver {
	if maxObserverAge <= 0 {
		maxObserverAge = 15 * time.Second
	}
	return &RuntimeStateResolver{observer: observer, runtime: runtime, currentGeneration: currentGeneration, maxObserverAge: maxObserverAge, now: time.Now}
}

func (r *RuntimeStateResolver) InspectSession(ctx context.Context, sessionID string) (bridgeruntime.RuntimeSessionState, error) {
	if r.observer != nil {
		state, ok, err := r.observer.ObservedSessionState(ctx, sessionID)
		if err == nil && ok && r.observerStateFresh(state) {
			return state, nil
		}
	}
	if r.runtime == nil {
		return bridgeruntime.RuntimeSessionState{}, errors.New("server_provider_required")
	}
	return r.runtime.InspectSession(ctx, sessionID)
}

func (r *RuntimeStateResolver) observerStateFresh(state bridgeruntime.RuntimeSessionState) bool {
	if r.currentGeneration != nil {
		current := r.currentGeneration()
		if current != 0 && state.Generation != current {
			return false
		}
	}
	observedAt, err := time.Parse(time.RFC3339, state.ObservedAt)
	if err != nil {
		return false
	}
	age := r.now().Sub(observedAt)
	return age >= 0 && age <= r.maxObserverAge
}

type QueueCoordinator struct {
	store    *store.Store
	runtime  RuntimeControl
	leaseTTL time.Duration
	now      func() time.Time
}

type QueueDecision struct {
	RequestedPolicy string                         `json:"requestedPolicy"`
	EffectivePolicy string                         `json:"effectivePolicy"`
	Degradation     string                         `json:"degradation,omitempty"`
	Busy            *bridgecore.SessionBusyDetails `json:"busy,omitempty"`
}

func NewQueueCoordinator(dataStore *store.Store, runtime RuntimeControl, leaseTTL time.Duration) *QueueCoordinator {
	if leaseTTL <= 0 {
		leaseTTL = store.DefaultSessionLeaseTTL
	}
	return &QueueCoordinator{store: dataStore, runtime: runtime, leaseTTL: leaseTTL, now: time.Now}
}

func (c *QueueCoordinator) PrepareRun(ctx context.Context, runID string) (*domain.AgentRun, QueueDecision, error) {
	run, err := c.store.GetAgentRun(ctx, strings.TrimSpace(runID))
	if err != nil {
		return nil, QueueDecision{}, err
	}
	if run == nil {
		return nil, QueueDecision{}, validation("run_not_found", "agent run not found")
	}
	decision := queueDecision(run.QueuePolicy)
	if run.QueuePolicy == "record_only" {
		if run.Status != "completed" {
			run.Status = "completed"
			run.CompletedAt = c.now().UTC().Format(time.RFC3339)
			updated, err := c.store.UpdateAgentRun(ctx, *run)
			return &updated, decision, err
		}
		return run, decision, nil
	}
	if run.SessionID == "" {
		return nil, decision, validation("session_not_found", "run does not have a resolved session")
	}
	if run.Status != "queued" && run.Status != "resolving_session" {
		return nil, decision, validation("run_not_queueable", "run is not ready for queue coordination")
	}
	state, err := c.inspect(ctx, run.SessionID)
	if err != nil {
		return nil, decision, c.blockUnknownRun(ctx, run, err)
	}
	if !queueRuntimeIdle(state.Status) {
		if queueRuntimeBusy(state.Status) {
			if run.QueuePolicy == "abort_and_replace" {
				run.Status = "blocked"
				run.ErrorCode = "abort_unconfirmed"
				run.ErrorMessage = "abort-and-replace is disabled until Runtime confirms termination"
				if _, updateErr := c.store.UpdateAgentRun(ctx, *run); updateErr != nil {
					return nil, decision, updateErr
				}
				decision.Degradation = "abort-and-replace disabled; replacement was not queued"
				return nil, decision, validation("abort_unconfirmed", run.ErrorMessage)
			}
			item, enqueueErr := c.store.EnqueueSessionRun(ctx, run.SessionID, run.RunID, false)
			if enqueueErr != nil {
				return nil, decision, enqueueErr
			}
			busy := c.busyDetails(ctx, state, decision, &item.Position)
			decision.Busy = &busy
			c.persistObservation(ctx, state, "runtime_external")
			return nil, decision, &bridgecore.SessionBusyError{Code: "session_busy", Details: busy}
		}
		return nil, decision, c.blockUnknownRun(ctx, run, errors.New("Runtime returned an unknown session state"))
	}
	if _, err := c.store.EnqueueSessionRun(ctx, run.SessionID, run.RunID, false); err != nil {
		return nil, decision, err
	}
	return c.prepareNext(ctx, run.SessionID, decision)
}

func (c *QueueCoordinator) PrepareNext(ctx context.Context, sessionID string) (*domain.AgentRun, QueueDecision, error) {
	return c.prepareNext(ctx, strings.TrimSpace(sessionID), QueueDecision{RequestedPolicy: "enqueue", EffectivePolicy: "enqueue"})
}

func (c *QueueCoordinator) prepareNext(ctx context.Context, sessionID string, decision QueueDecision) (*domain.AgentRun, QueueDecision, error) {
	state, err := c.inspect(ctx, sessionID)
	if err != nil {
		return nil, decision, validation("session_state_unavailable", "Runtime session state is unavailable")
	}
	if !queueRuntimeIdle(state.Status) {
		busy := c.busyDetails(ctx, state, decision, nil)
		decision.Busy = &busy
		if queueRuntimeBusy(state.Status) {
			c.persistObservation(ctx, state, "runtime_external")
			return nil, decision, &bridgecore.SessionBusyError{Code: "session_busy", Details: busy}
		}
		return nil, decision, validation("session_state_unavailable", "Runtime session state is not safe for submission")
	}
	claimed, _, err := c.store.ClaimNextSessionRun(ctx, sessionID, c.now(), c.leaseTTL)
	if err != nil {
		return nil, decision, err
	}
	if claimed == nil {
		if lease, _ := c.store.GetSessionLease(ctx, sessionID, c.now()); lease != nil {
			busy := c.busyDetails(ctx, state, decision, nil)
			busy.ControlOrigin = "agent_room"
			busy.LeaseOwnerRunID, busy.LeaseExpiresAt = lease.Owner, lease.ExpiresAt
			decision.Busy = &busy
			return nil, decision, &bridgecore.SessionBusyError{Code: "session_busy", Details: busy}
		}
		return nil, decision, nil
	}
	second, err := c.inspect(ctx, sessionID)
	if err != nil || !queueRuntimeIdle(second.Status) {
		if returnErr := c.store.ReturnSessionQueueClaim(ctx, claimed.QueueID, claimed.RunID); returnErr != nil {
			return nil, decision, returnErr
		}
		if err != nil || !queueRuntimeBusy(second.Status) {
			return nil, decision, validation("session_state_unavailable", "Runtime state changed or became unavailable before submission")
		}
		busy := c.busyDetails(ctx, second, decision, &claimed.Position)
		decision.Busy = &busy
		c.persistObservation(ctx, second, "runtime_external")
		return nil, decision, &bridgecore.SessionBusyError{Code: "session_busy", Details: busy}
	}
	run, err := c.store.FinalizeSessionQueueClaim(ctx, claimed.QueueID, claimed.RunID)
	if err != nil {
		return nil, decision, err
	}
	c.persistObservation(ctx, second, "agent_room")
	return &run, decision, nil
}

func (c *QueueCoordinator) CompleteRun(ctx context.Context, runID, status string) (*domain.AgentRun, QueueDecision, error) {
	run, err := c.store.GetAgentRun(ctx, strings.TrimSpace(runID))
	if err != nil || run == nil {
		if err == nil {
			err = validation("run_not_found", "agent run not found")
		}
		return nil, QueueDecision{}, err
	}
	if !oneOf(status, "completed", "failed", "aborted", "orphaned") {
		return nil, QueueDecision{}, validation("invalid_run_status", "run completion status is invalid")
	}
	run.Status = status
	run.CompletedAt = c.now().UTC().Format(time.RFC3339)
	if _, err := c.store.UpdateAgentRun(ctx, *run); err != nil {
		return nil, QueueDecision{}, err
	}
	if run.SessionID != "" {
		if _, err := c.store.ReleaseSessionLease(ctx, run.SessionID, run.RunID); err != nil {
			return nil, QueueDecision{}, err
		}
		return c.PrepareNext(ctx, run.SessionID)
	}
	return nil, QueueDecision{}, nil
}

func (c *QueueCoordinator) Recover(ctx context.Context) error {
	claims, err := c.store.ListClaimedSessionQueue(ctx)
	if err != nil {
		return err
	}
	for _, claim := range claims {
		state, inspectErr := c.inspect(ctx, claim.SessionID)
		if inspectErr != nil || (!queueRuntimeIdle(state.Status) && !queueRuntimeBusy(state.Status)) {
			continue
		}
		if err := c.store.ReturnSessionQueueClaim(ctx, claim.QueueID, claim.RunID); err != nil {
			return err
		}
		origin := "agent_room"
		if queueRuntimeBusy(state.Status) {
			origin = "runtime_external"
		}
		c.persistObservation(ctx, state, origin)
	}
	leasing, err := c.store.ListActiveSessionLeases(ctx, c.now())
	if err != nil {
		return err
	}
	for _, lease := range leasing {
		state, inspectErr := c.inspect(ctx, lease.SessionID)
		if inspectErr != nil {
			continue
		}
		if queueRuntimeBusy(state.Status) {
			_, _, _ = c.store.RenewSessionLease(ctx, lease.SessionID, lease.Owner, c.now(), c.leaseTTL)
			c.persistObservation(ctx, state, "agent_room")
			continue
		}
		if !queueRuntimeIdle(state.Status) {
			continue
		}
		run, getErr := c.store.GetAgentRun(ctx, lease.Owner)
		if getErr != nil {
			return getErr
		}
		if run != nil && !oneOf(run.Status, "completed", "failed", "aborted", "orphaned") {
			run.Status = "orphaned"
			run.ErrorCode = "runtime_idle_after_restart"
			run.CompletedAt = c.now().UTC().Format(time.RFC3339)
			if _, err := c.store.UpdateAgentRun(ctx, *run); err != nil {
				return err
			}
		}
		if _, err := c.store.ReleaseSessionLease(ctx, lease.SessionID, lease.Owner); err != nil {
			return err
		}
	}
	return nil
}

func (c *QueueCoordinator) inspect(ctx context.Context, sessionID string) (bridgeruntime.RuntimeSessionState, error) {
	if c.runtime == nil {
		return bridgeruntime.RuntimeSessionState{}, errors.New("server_provider_required")
	}
	state, err := c.runtime.InspectSession(ctx, sessionID)
	if state.SessionID == "" {
		state.SessionID = sessionID
	}
	return state, err
}

func (c *QueueCoordinator) blockUnknownRun(ctx context.Context, run *domain.AgentRun, cause error) error {
	run.Status = "blocked"
	run.ErrorCode = "session_state_unavailable"
	run.ErrorMessage = "Runtime session state is unavailable; prompt was not submitted"
	_, _ = c.store.UpdateAgentRun(ctx, *run)
	return fmt.Errorf("%w: %v", validation("session_state_unavailable", run.ErrorMessage), cause)
}

func (c *QueueCoordinator) busyDetails(ctx context.Context, state bridgeruntime.RuntimeSessionState, decision QueueDecision, position *int) bridgecore.SessionBusyDetails {
	depth, _ := c.store.SessionQueueDepth(ctx, state.SessionID)
	details := bridgecore.SessionBusyDetails{
		SessionID: state.SessionID, RuntimeState: strings.ToLower(strings.TrimSpace(state.Status)),
		ControlOrigin: "runtime_external", QueueDepth: depth, QueuePosition: position,
		ObservedAt: state.ObservedAt, Generation: state.Generation,
		RequestedPolicy: decision.RequestedPolicy, EffectivePolicy: decision.EffectivePolicy,
		Degradation: decision.Degradation,
	}
	if lease, _ := c.store.GetSessionLease(ctx, state.SessionID, c.now()); lease != nil {
		details.ControlOrigin = "agent_room"
		details.LeaseOwnerRunID, details.LeaseExpiresAt = lease.Owner, lease.ExpiresAt
	}
	return details
}

func (c *QueueCoordinator) persistObservation(ctx context.Context, state bridgeruntime.RuntimeSessionState, origin string) {
	_, _ = c.store.UpsertSessionObservation(ctx, domain.SessionObservation{
		SessionID: state.SessionID, WorkDir: state.WorkspaceRoot, LastSeq: state.LastSeq,
		SessionState: strings.ToLower(strings.TrimSpace(state.Status)), ControlOrigin: origin,
	})
}

func queueDecision(policy string) QueueDecision {
	policy = strings.TrimSpace(policy)
	decision := QueueDecision{RequestedPolicy: policy, EffectivePolicy: policy}
	if policy == "follow_up" {
		decision.EffectivePolicy = "enqueue"
		decision.Degradation = "Runtime follow-up is disabled for Agent Room ownership; using local FIFO"
	}
	return decision
}

func queueRuntimeIdle(status string) bool {
	return oneOf(strings.ToLower(strings.TrimSpace(status)), "idle", "completed", "failed", "aborted", "cancelled", "canceled")
}

func queueRuntimeBusy(status string) bool {
	return oneOf(strings.ToLower(strings.TrimSpace(status)), "running", "waiting_approval", "submitting", "busy")
}
