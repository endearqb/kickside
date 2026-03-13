package reliability

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

type Logger interface {
	Printf(string, ...any)
}

type Classification struct {
	Code       string
	Retryable  bool
	RetryAfter time.Duration
}

type CodedError struct {
	Code string
	Err  error
}

func (e *CodedError) Error() string {
	if e == nil || e.Err == nil {
		return ""
	}
	return e.Err.Error()
}

func (e *CodedError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func Wrap(code string, err error) error {
	if err == nil {
		return nil
	}
	return &CodedError{
		Code: strings.TrimSpace(code),
		Err:  err,
	}
}

func CodeOf(err error, fallback string) string {
	var coded *CodedError
	if errors.As(err, &coded) && strings.TrimSpace(coded.Code) != "" {
		return strings.TrimSpace(coded.Code)
	}
	return strings.TrimSpace(fallback)
}

type ExecutorOptions struct {
	Platform    string
	Logger      Logger
	MinInterval time.Duration
	MaxAttempts int
	Backoffs    []time.Duration
	Now         func() time.Time
	Sleep       func(context.Context, time.Duration) bool
}

type Executor struct {
	platform    string
	logger      Logger
	minInterval time.Duration
	maxAttempts int
	backoffs    []time.Duration
	now         func() time.Time
	sleep       func(context.Context, time.Duration) bool

	mu         sync.Mutex
	lastSendAt time.Time
}

func NewExecutor(options ExecutorOptions) *Executor {
	minInterval := options.MinInterval
	if minInterval <= 0 {
		minInterval = 100 * time.Millisecond
	}

	maxAttempts := options.MaxAttempts
	if maxAttempts <= 0 {
		maxAttempts = 5
	}

	backoffs := options.Backoffs
	if len(backoffs) == 0 {
		backoffs = []time.Duration{
			time.Second,
			2 * time.Second,
			4 * time.Second,
			8 * time.Second,
			16 * time.Second,
		}
	}

	now := options.Now
	if now == nil {
		now = time.Now
	}

	sleep := options.Sleep
	if sleep == nil {
		sleep = SleepContext
	}

	return &Executor{
		platform:    strings.TrimSpace(options.Platform),
		logger:      options.Logger,
		minInterval: minInterval,
		maxAttempts: maxAttempts,
		backoffs:    append([]time.Duration(nil), backoffs...),
		now:         now,
		sleep:       sleep,
	}
}

func (e *Executor) Execute(
	ctx context.Context,
	operation string,
	run func(context.Context) error,
	classify func(error) Classification,
) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	operation = strings.TrimSpace(operation)
	if operation == "" {
		operation = "unknown"
	}

	for attempt := 1; attempt <= e.maxAttempts; attempt++ {
		if !e.waitForTurn(ctx) {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return Wrap("unknown", context.Canceled)
		}

		err := run(ctx)
		if err == nil {
			if attempt > 1 {
				e.logf(
					"outbound event=recovered platform=%s operation=%s errorCode=none attempt=%d retryable=false nextBackoffMs=0",
					e.platform,
					operation,
					attempt,
				)
			}
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}

		classification := classify(err)
		code := strings.TrimSpace(classification.Code)
		if code == "" {
			code = CodeOf(err, "unknown")
		}

		if !classification.Retryable || attempt >= e.maxAttempts {
			e.logf(
				"outbound event=give_up platform=%s operation=%s errorCode=%s attempt=%d retryable=%t nextBackoffMs=0 err=%q",
				e.platform,
				operation,
				code,
				attempt,
				classification.Retryable,
				err.Error(),
			)
			return Wrap(code, err)
		}

		backoff := clampDelay(classification.RetryAfter)
		if backoff <= 0 {
			backoff = clampDelay(e.backoffForAttempt(attempt))
		}
		e.logf(
			"outbound event=retry platform=%s operation=%s errorCode=%s attempt=%d retryable=true nextBackoffMs=%d err=%q",
			e.platform,
			operation,
			code,
			attempt,
			backoff.Milliseconds(),
			err.Error(),
		)
		if !e.sleep(ctx, backoff) {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return Wrap(code, err)
		}
	}

	return nil
}

func (e *Executor) waitForTurn(ctx context.Context) bool {
	if e.minInterval > 0 && !e.lastSendAt.IsZero() {
		elapsed := e.now().Sub(e.lastSendAt)
		if elapsed < e.minInterval {
			if !e.sleep(ctx, e.minInterval-elapsed) {
				return false
			}
		}
	}
	e.lastSendAt = e.now()
	return true
}

func (e *Executor) backoffForAttempt(attempt int) time.Duration {
	if len(e.backoffs) == 0 {
		return time.Second
	}
	index := attempt - 1
	if index < 0 {
		index = 0
	}
	if index >= len(e.backoffs) {
		index = len(e.backoffs) - 1
	}
	return e.backoffs[index]
}

func (e *Executor) logf(format string, args ...any) {
	if e.logger != nil {
		e.logger.Printf(format, args...)
	}
}

func SleepContext(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		return true
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func clampDelay(delay time.Duration) time.Duration {
	if delay <= 0 {
		return 0
	}
	if delay > 30*time.Second {
		return 30 * time.Second
	}
	return delay
}
