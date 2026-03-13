package runtime

import (
	"context"
	"errors"
	"sync"
)

type SessionRegistry struct {
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

func NewSessionRegistry() *SessionRegistry {
	return &SessionRegistry{
		sessions: make(map[string]*managedSession),
	}
}

func (r *SessionRegistry) Run(ctx context.Context, kimiSessionID string, fn func(context.Context) error) error {
	session := r.acquire(kimiSessionID)
	session.mu.Lock()
	defer func() {
		session.mu.Unlock()
		r.release(kimiSessionID)
	}()

	return fn(ctx)
}

func (r *SessionRegistry) RunPrompt(
	ctx context.Context,
	request PromptRequest,
	open func(PromptRequest) (DriverSession, error),
	fn func(context.Context, DriverSession) error,
) error {
	session := r.acquire(request.KimiSessionID)
	session.mu.Lock()
	defer func() {
		session.mu.Unlock()
		r.release(request.KimiSessionID)
	}()

	if session.session == nil || session.workDir != request.WorkDir || session.autoApprove != request.AutoApprove {
		if session.session != nil {
			_ = session.session.Close()
		}
		liveSession, err := open(request)
		if err != nil {
			session.session = nil
			session.workDir = ""
			session.autoApprove = false
			return err
		}
		session.session = liveSession
		session.workDir = request.WorkDir
		session.autoApprove = request.AutoApprove
	}

	return fn(ctx, session.session)
}

func (r *SessionRegistry) Close() error {
	r.mu.Lock()
	sessions := make([]DriverSession, 0, len(r.sessions))
	for _, session := range r.sessions {
		if session.session != nil {
			sessions = append(sessions, session.session)
			session.session = nil
		}
	}
	r.sessions = make(map[string]*managedSession)
	r.mu.Unlock()

	var closeErr error
	for _, session := range sessions {
		closeErr = errors.Join(closeErr, session.Close())
	}
	return closeErr
}

func (r *SessionRegistry) acquire(kimiSessionID string) *managedSession {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[kimiSessionID]
	if !ok {
		session = &managedSession{}
		r.sessions[kimiSessionID] = session
	}
	session.refCount++
	return session
}

func (r *SessionRegistry) release(kimiSessionID string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	session, ok := r.sessions[kimiSessionID]
	if !ok {
		return
	}
	session.refCount--
	if session.refCount <= 0 && session.session == nil {
		delete(r.sessions, kimiSessionID)
	}
}
