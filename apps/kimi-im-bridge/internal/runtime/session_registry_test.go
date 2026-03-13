package runtime

import (
	"context"
	"sync"
	"testing"
	"time"
)

type registryTestSession struct {
	closed int
}

func (s *registryTestSession) StartPrompt(context.Context, PromptRequest) (PromptStream, error) {
	return nil, nil
}

func (s *registryTestSession) Close() error {
	s.closed++
	return nil
}

func TestSessionRegistrySerializesSameSession(t *testing.T) {
	t.Parallel()

	registry := NewSessionRegistry()
	started := make(chan string, 2)
	release := make(chan struct{})
	var mu sync.Mutex
	order := []string{}

	var wg sync.WaitGroup
	run := func(label string) {
		defer wg.Done()
		err := registry.Run(context.Background(), "session-1", func(context.Context) error {
			started <- label
			if label == "first" {
				<-release
			}
			mu.Lock()
			order = append(order, label)
			mu.Unlock()
			return nil
		})
		if err != nil {
			t.Errorf("Run(%s) returned error: %v", label, err)
		}
	}

	wg.Add(2)
	go run("first")
	<-started
	go run("second")

	select {
	case next := <-started:
		t.Fatalf("expected second run to block behind first, but %s started early", next)
	case <-time.After(120 * time.Millisecond):
	}

	close(release)
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if len(order) != 2 || order[0] != "first" || order[1] != "second" {
		t.Fatalf("expected serialized execution order, got %+v", order)
	}
}

func TestSessionRegistryAllowsDifferentSessions(t *testing.T) {
	t.Parallel()

	registry := NewSessionRegistry()
	started := make(chan string, 2)

	var wg sync.WaitGroup
	run := func(sessionID string) {
		defer wg.Done()
		err := registry.Run(context.Background(), sessionID, func(context.Context) error {
			started <- sessionID
			time.Sleep(50 * time.Millisecond)
			return nil
		})
		if err != nil {
			t.Errorf("Run(%s) returned error: %v", sessionID, err)
		}
	}

	wg.Add(2)
	go run("session-1")
	go run("session-2")

	first := <-started
	second := <-started
	wg.Wait()

	if first == second {
		t.Fatalf("expected different sessions to run independently, got %s and %s", first, second)
	}
}

func TestSessionRegistryReusesLiveSessionForSameConfig(t *testing.T) {
	t.Parallel()

	registry := NewSessionRegistry()
	openCount := 0
	var firstSession DriverSession

	open := func(PromptRequest) (DriverSession, error) {
		openCount++
		session := &registryTestSession{}
		if firstSession == nil {
			firstSession = session
		}
		return session, nil
	}

	request := PromptRequest{
		KimiSessionID: "session-1",
		Prompt:        "hello",
		WorkDir:       "D:/work",
	}
	for range 2 {
		if err := registry.RunPrompt(context.Background(), request, open, func(_ context.Context, session DriverSession) error {
			if session == nil {
				t.Fatal("expected live session")
			}
			return nil
		}); err != nil {
			t.Fatalf("RunPrompt returned error: %v", err)
		}
	}

	if openCount != 1 {
		t.Fatalf("expected session to be opened once, got %d", openCount)
	}

	if err := registry.Close(); err != nil {
		t.Fatalf("Close returned error: %v", err)
	}
	testSession := firstSession.(*registryTestSession)
	if testSession.closed != 1 {
		t.Fatalf("expected live session to be closed once, got %d", testSession.closed)
	}
}

func TestSessionRegistryRecreatesSessionWhenConfigChanges(t *testing.T) {
	t.Parallel()

	registry := NewSessionRegistry()
	openCount := 0
	sessions := []*registryTestSession{}
	open := func(PromptRequest) (DriverSession, error) {
		openCount++
		session := &registryTestSession{}
		sessions = append(sessions, session)
		return session, nil
	}

	first := PromptRequest{KimiSessionID: "session-1", Prompt: "hello", WorkDir: "D:/work"}
	second := PromptRequest{KimiSessionID: "session-1", Prompt: "hello", WorkDir: "D:/other"}

	if err := registry.RunPrompt(context.Background(), first, open, func(context.Context, DriverSession) error { return nil }); err != nil {
		t.Fatalf("RunPrompt(first) returned error: %v", err)
	}
	if err := registry.RunPrompt(context.Background(), second, open, func(context.Context, DriverSession) error { return nil }); err != nil {
		t.Fatalf("RunPrompt(second) returned error: %v", err)
	}

	if openCount != 2 {
		t.Fatalf("expected session to be reopened on config change, got %d", openCount)
	}
	if sessions[0].closed != 1 {
		t.Fatalf("expected first session to be closed during reopen, got %d", sessions[0].closed)
	}
}
