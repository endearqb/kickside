package kimi

import (
	"context"
	"testing"
	"time"
)

type fakeDriverSession struct {
	closed bool
}

func (f *fakeDriverSession) StartPrompt(context.Context, Request) (PromptStream, error) {
	return nil, nil
}

func (f *fakeDriverSession) Close() error {
	f.closed = true
	return nil
}

func TestSessionPoolRejectsRunAfterClose(t *testing.T) {
	t.Parallel()

	pool := NewSessionPool()
	if err := pool.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}
	err := pool.RunTurn(context.Background(), Request{KimiSessionID: "session-1"}, func(Request) (DriverSession, error) {
		return &fakeDriverSession{}, nil
	}, func(context.Context, DriverSession) error {
		return nil
	})
	if err == nil {
		t.Fatalf("expected closed pool error")
	}
}

func TestSessionPoolClosesIdleSessions(t *testing.T) {
	t.Parallel()

	pool := NewSessionPool()
	defer pool.Close()
	session := &fakeDriverSession{}
	if err := pool.RunTurn(context.Background(), Request{KimiSessionID: "session-1"}, func(Request) (DriverSession, error) {
		return session, nil
	}, func(context.Context, DriverSession) error {
		return nil
	}); err != nil {
		t.Fatalf("RunTurn returned error: %v", err)
	}

	pool.closeIdle(time.Now().Add(sessionIdleTTL + time.Second))
	if !session.closed {
		t.Fatalf("expected idle session to be closed")
	}
	if len(pool.sessions) != 0 {
		t.Fatalf("expected idle session to be removed")
	}
}
