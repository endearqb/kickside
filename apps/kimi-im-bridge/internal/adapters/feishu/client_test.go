package feishu

import (
	"context"
	"testing"
	"time"
)

type captureLogger struct {
	lines []string
}

func (l *captureLogger) Printf(format string, args ...any) {
	l.lines = append(l.lines, format)
}

func TestCombinePayloadRejectsInvalidSeq(t *testing.T) {
	t.Parallel()

	logger := &captureLogger{}
	combined := map[string]*combinedPayload{}
	if payload := combinePayload(combined, "message-1", 2, 3, []byte("x"), logger); payload != nil {
		t.Fatalf("expected invalid seq to be dropped, got %q", payload)
	}
	if len(combined) != 0 {
		t.Fatalf("expected invalid fragment to avoid cache growth, got %+v", combined)
	}
	if len(logger.lines) == 0 {
		t.Fatalf("expected invalid seq to be logged")
	}
}

func TestCombinePayloadMergesFragments(t *testing.T) {
	t.Parallel()

	combined := map[string]*combinedPayload{}
	if payload := combinePayload(combined, "message-1", 2, 1, []byte("lo"), nil); payload != nil {
		t.Fatalf("expected first fragment to wait, got %q", payload)
	}
	payload := combinePayload(combined, "message-1", 2, 0, []byte("hel"), nil)
	if string(payload) != "hello" {
		t.Fatalf("expected merged payload, got %q", payload)
	}
	if len(combined) != 0 {
		t.Fatalf("expected completed fragments to be cleared, got %+v", combined)
	}
}

func TestDispatchKeyPrefersChatID(t *testing.T) {
	t.Parallel()

	payload := []byte(`{"header":{"event_id":"event-1"},"event":{"message":{"chat_id":"chat-1"}}}`)
	if key := dispatchKey(payload, "fallback"); key != "chat-1" {
		t.Fatalf("expected chat dispatch key, got %q", key)
	}
}

func TestDispatchShardsSerializesSameKey(t *testing.T) {
	t.Parallel()

	shards := newDispatchShards(1)
	firstStarted := make(chan struct{})
	releaseFirst := make(chan struct{})
	secondDone := make(chan struct{})

	shards.Go(context.Background(), "chat-1", func() {
		close(firstStarted)
		<-releaseFirst
	})
	<-firstStarted
	shards.Go(context.Background(), "chat-1", func() {
		close(secondDone)
	})

	select {
	case <-secondDone:
		t.Fatalf("expected same-key dispatch to wait for the first handler")
	case <-time.After(20 * time.Millisecond):
	}

	close(releaseFirst)
	select {
	case <-secondDone:
	case <-time.After(time.Second):
		t.Fatalf("expected same-key dispatch to continue after first handler returns")
	}
}
