package agentroom

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type ObserverCoordinator struct {
	store     *store.Store
	adapter   *bridgeruntime.KimiCodeServerAdapter
	projector *ObserverProjector
	interval  time.Duration
	running   atomic.Bool
	connected atomic.Bool
	desired   atomic.Int64
	mu        sync.RWMutex
	lastError string
}

func NewObserverCoordinator(dataStore *store.Store, adapter *bridgeruntime.KimiCodeServerAdapter, interval time.Duration) *ObserverCoordinator {
	if interval <= 0 {
		interval = 300 * time.Millisecond
	}
	return &ObserverCoordinator{store: dataStore, adapter: adapter, projector: NewObserverProjector(dataStore), interval: interval}
}

func (c *ObserverCoordinator) SetRunTerminalHandler(handler func(string)) {
	if c != nil && c.projector != nil {
		c.projector.SetRunTerminalHandler(handler)
	}
}

func (c *ObserverCoordinator) Running() bool   { return c != nil && c.running.Load() }
func (c *ObserverCoordinator) Connected() bool { return c != nil && c.connected.Load() }
func (c *ObserverCoordinator) Available() bool {
	return c != nil && c.Running() && c.LastError() == "" && (c.desired.Load() == 0 || c.Connected())
}

func (c *ObserverCoordinator) LastError() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.lastError
}

func (c *ObserverCoordinator) setError(err error) {
	c.mu.Lock()
	if err == nil {
		c.lastError = ""
	} else {
		c.lastError = err.Error()
	}
	c.mu.Unlock()
}

func (c *ObserverCoordinator) Run(ctx context.Context) error {
	if c == nil || c.store == nil || c.adapter == nil {
		return nil
	}
	c.running.Store(true)
	defer c.running.Store(false)
	defer c.connected.Store(false)
	updates := make(chan bridgeruntime.ObserverSubscription, 1)
	observer, err := bridgeruntime.NewSessionObserver(bridgeruntime.SessionObserverOptions{
		Adapter: c.adapter, LoadCursor: c.projector.LoadCursor, Sink: c.applyBatch,
		OnConnected:    func(int, int64) { c.connected.Store(true) },
		OnDisconnected: func() { c.connected.Store(false) },
	})
	if err != nil {
		return err
	}
	observerDone := make(chan error, 1)
	go func() { observerDone <- observer.Run(ctx, updates) }()
	ticker := time.NewTicker(c.interval)
	defer ticker.Stop()
	lastKey := ""
	for {
		subscription, loadErr := c.subscription(ctx)
		if loadErr != nil {
			c.setError(loadErr)
		} else {
			c.setError(nil)
			key, _ := json.Marshal(subscription)
			if string(key) != lastKey {
				select {
				case updates <- subscription:
					lastKey = string(key)
				case <-ctx.Done():
					close(updates)
					<-observerDone
					return ctx.Err()
				}
			}
		}
		select {
		case <-ctx.Done():
			close(updates)
			<-observerDone
			return ctx.Err()
		case err := <-observerDone:
			return err
		case <-ticker.C:
		}
	}
}

func (c *ObserverCoordinator) subscription(ctx context.Context) (bridgeruntime.ObserverSubscription, error) {
	generation, err := c.adapter.CurrentGeneration()
	if err != nil {
		return bridgeruntime.ObserverSubscription{}, err
	}
	ids, err := c.store.ListAgentRoomWatchSessionIDs(ctx)
	if err != nil {
		return bridgeruntime.ObserverSubscription{}, err
	}
	available := make([]string, 0, len(ids))
	for _, sessionID := range ids {
		session, err := c.store.GetSessionByID(ctx, sessionID)
		if err != nil {
			return bridgeruntime.ObserverSubscription{}, err
		}
		if session == nil {
			state, err := c.adapter.InspectSession(ctx, sessionID)
			if err != nil {
				continue
			}
			if err := c.store.UpsertSession(ctx, domain.BridgeSession{
				KimiSessionID: sessionID, WorkDir: state.WorkspaceRoot, SessionState: state.Status,
				ProviderName: "server", RuntimeMetadataJSON: `{"observerDiscovered":true}`,
			}); err != nil {
				return bridgeruntime.ObserverSubscription{}, err
			}
		}
		available = append(available, strings.TrimSpace(sessionID))
	}
	sort.Strings(available)
	c.desired.Store(int64(len(available)))
	return bridgeruntime.ObserverSubscription{Generation: generation, SessionIDs: available}, nil
}

func (c *ObserverCoordinator) applyBatch(ctx context.Context, batch bridgeruntime.ObserverBatch) error {
	if !batch.ResyncRequired {
		return c.projector.ApplyBatch(ctx, batch)
	}
	ids := make([]string, 0, len(batch.Cursors))
	for sessionID := range batch.Cursors {
		ids = append(ids, sessionID)
	}
	sort.Strings(ids)
	for _, sessionID := range ids {
		state, err := c.adapter.InspectSession(ctx, sessionID)
		if err != nil {
			return err
		}
		if err := c.projector.ReconcileSession(ctx, state, batch.Epoch); err != nil {
			return err
		}
	}
	return nil
}
