package kimi

import (
	"context"
	"errors"
	"sync"
	"time"
)

const (
	sessionIdleTTL       = 30 * time.Minute
	sessionSweepInterval = time.Minute
)

type SessionPool struct {
	mu       sync.Mutex
	sessions map[string]*managedSession
	closed   bool
	stop     chan struct{}
}

type managedSession struct {
	mu          sync.Mutex
	refCount    int
	session     DriverSession
	workDir     string
	autoApprove bool
	lastUsedAt  time.Time
}

func NewSessionPool() *SessionPool {
	p := &SessionPool{sessions: make(map[string]*managedSession), stop: make(chan struct{})}
	go p.sweepLoop()
	return p
}

func (p *SessionPool) RunTurn(
	ctx context.Context,
	request Request,
	open func(Request) (DriverSession, error),
	fn func(context.Context, DriverSession) error,
) error {
	session, err := p.acquire(request.KimiSessionID)
	if err != nil {
		return err
	}
	session.mu.Lock()
	defer func() {
		session.mu.Unlock()
		p.release(request.KimiSessionID)
	}()

	if session.session == nil || session.workDir != request.WorkDir || session.autoApprove != request.AutoApprove {
		if session.session != nil {
			_ = session.session.Close()
		}
		live, err := open(request)
		if err != nil {
			session.session = nil
			session.workDir = ""
			session.autoApprove = false
			return err
		}
		session.session = live
		session.workDir = request.WorkDir
		session.autoApprove = request.AutoApprove
	}

	return fn(ctx, session.session)
}

func (p *SessionPool) Close() error {
	p.mu.Lock()
	if p.closed {
		p.mu.Unlock()
		return nil
	}
	p.closed = true
	close(p.stop)
	entries := make([]*managedSession, 0, len(p.sessions))
	for _, session := range p.sessions {
		entries = append(entries, session)
	}
	p.sessions = make(map[string]*managedSession)
	p.mu.Unlock()

	var closeErr error
	for _, entry := range entries {
		entry.mu.Lock()
		session := entry.session
		entry.session = nil
		entry.mu.Unlock()
		if session != nil {
			closeErr = errors.Join(closeErr, session.Close())
		}
	}
	return closeErr
}

func (p *SessionPool) acquire(kimiSessionID string) (*managedSession, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return nil, errors.New("session pool is closed")
	}

	session, ok := p.sessions[kimiSessionID]
	if !ok {
		session = &managedSession{lastUsedAt: time.Now()}
		p.sessions[kimiSessionID] = session
	}
	session.refCount++
	return session, nil
}

func (p *SessionPool) release(kimiSessionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	session, ok := p.sessions[kimiSessionID]
	if !ok {
		return
	}
	session.refCount--
	session.lastUsedAt = time.Now()
	if session.refCount <= 0 && session.session == nil {
		delete(p.sessions, kimiSessionID)
	}
}

func (p *SessionPool) sweepLoop() {
	ticker := time.NewTicker(sessionSweepInterval)
	defer ticker.Stop()
	for {
		select {
		case now := <-ticker.C:
			p.closeIdle(now)
		case <-p.stop:
			return
		}
	}
}

func (p *SessionPool) closeIdle(now time.Time) {
	p.mu.Lock()
	sessions := make([]DriverSession, 0)
	for id, entry := range p.sessions {
		if entry.refCount > 0 || now.Sub(entry.lastUsedAt) < sessionIdleTTL {
			continue
		}
		entry.mu.Lock()
		session := entry.session
		entry.session = nil
		entry.mu.Unlock()
		if session != nil {
			sessions = append(sessions, session)
		}
		delete(p.sessions, id)
	}
	p.mu.Unlock()

	for _, session := range sessions {
		_ = session.Close()
	}
}
