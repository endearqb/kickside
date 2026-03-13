package reliability

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

type fakeLogger struct {
	lines []string
}

func (f *fakeLogger) Printf(format string, args ...any) {
	f.lines = append(f.lines, strings.TrimSpace(formatMessage(format, args...)))
}

func formatMessage(format string, args ...any) string {
	value := fmt.Sprintf(format, args...)
	value = strings.ReplaceAll(value, "\n", " ")
	value = strings.ReplaceAll(value, "\r", " ")
	return strings.TrimSpace(value)
}

func TestExecutorRetriesAndLogsStructuredMetadata(t *testing.T) {
	t.Parallel()

	now := time.Unix(0, 0)
	sleeps := []time.Duration{}
	logger := &fakeLogger{}
	executor := NewExecutor(ExecutorOptions{
		Platform: "telegram",
		Logger:   logger,
		Now: func() time.Time {
			return now
		},
		Sleep: func(_ context.Context, delay time.Duration) bool {
			sleeps = append(sleeps, delay)
			now = now.Add(delay)
			return true
		},
	})

	attempts := 0
	err := executor.Execute(context.Background(), "send_message", func(context.Context) error {
		attempts++
		if attempts < 3 {
			return errors.New("temporary failure")
		}
		return nil
	}, func(error) Classification {
		return Classification{
			Code:      "transient_network",
			Retryable: true,
		}
	})
	if err != nil {
		t.Fatalf("Execute returned error: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
	if len(sleeps) != 2 {
		t.Fatalf("expected retry sleeps to be recorded twice, got %d", len(sleeps))
	}
	if !containsLine(logger.lines, "event=retry") || !containsLine(logger.lines, "event=recovered") {
		t.Fatalf("expected retry and recovered logs, got %+v", logger.lines)
	}
}

func TestExecutorStopsOnPermanentFailure(t *testing.T) {
	t.Parallel()

	executor := NewExecutor(ExecutorOptions{
		Platform: "feishu",
		Sleep: func(context.Context, time.Duration) bool {
			t.Fatal("sleep should not be called for permanent failures")
			return false
		},
	})

	err := executor.Execute(context.Background(), "reply_message", func(context.Context) error {
		return errors.New("permission denied")
	}, func(error) Classification {
		return Classification{
			Code:      "permission_denied",
			Retryable: false,
		}
	})
	if err == nil {
		t.Fatal("expected Execute to return error")
	}
	if CodeOf(err, "") != "permission_denied" {
		t.Fatalf("expected permission_denied code, got %q", CodeOf(err, ""))
	}
}

func containsLine(lines []string, fragment string) bool {
	for _, line := range lines {
		if strings.Contains(line, fragment) {
			return true
		}
	}
	return false
}
