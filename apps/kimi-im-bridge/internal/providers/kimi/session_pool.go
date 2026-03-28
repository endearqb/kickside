package kimi

import (
	"context"
	"errors"
	"sync"
)

type SessionPool struct {
	mu       sync.Mutex
	sessions map[string]*managedSession
}

type managedSession struct {
	mu          sync.Mutex
	refCount    int
	session     DriverSession
	workDir     string
	autoApprove bool
}

func NewSessionPool() *SessionPool {
	return &SessionPool{sessions: make(map[string]*managedSession)}
}

func (p *SessionPool) RunTurn(
	ctx context.Context,
	request Request,
	open func(Request) (DriverSession, error),
	fn func(context.Context, DriverSession) error,
) error {
	session := p.acquire(request.KimiSessionID)
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
	sessions := make([]DriverSession, 0, len(p.sessions))
	for _, session := range p.sessions {
		if session.session != nil {
			sessions = append(sessions, session.session)
			session.session = nil
		}
	}
	p.sessions = make(map[string]*managedSession)
	p.mu.Unlock()

	var closeErr error
	for _, session := range sessions {
		closeErr = errors.Join(closeErr, session.Close())
	}
	return closeErr
}

func (p *SessionPool) acquire(kimiSessionID string) *managedSession {
	p.mu.Lock()
	defer p.mu.Unlock()

	session, ok := p.sessions[kimiSessionID]
	if !ok {
		session = &managedSession{}
		p.sessions[kimiSessionID] = session
	}
	session.refCount++
	return session
}

func (p *SessionPool) release(kimiSessionID string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	session, ok := p.sessions[kimiSessionID]
	if !ok {
		return
	}
	session.refCount--
	if session.refCount <= 0 && session.session == nil {
		delete(p.sessions, kimiSessionID)
	}
}
