package feishu

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

type Service struct {
	config   Config
	gateway  Gateway
	bindings BindingRouter
	runtime  RuntimeExecutor
	store    ChannelStore
	logger   Logger

	mu                sync.RWMutex
	started           bool
	done              chan struct{}
	currentCheckpoint string
}

func NewService(options Options) *Service {
	gateway := options.Gateway
	if gateway == nil && strings.TrimSpace(options.Config.AppID) != "" && strings.TrimSpace(options.Config.AppSecret) != "" {
		gateway = NewClient(options.Config.AppID, options.Config.AppSecret, ClientOptions{
			Logger: options.Logger,
		})
	}

	return &Service{
		config:   options.Config,
		gateway:  gateway,
		bindings: options.BindingRouter,
		runtime:  options.Runtime,
		store:    options.Store,
		logger:   options.Logger,
		done:     closedDone(),
	}
}

func (s *Service) Name() string {
	return platformID
}

func (s *Service) Done() <-chan struct{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.done
}

func (s *Service) Start(ctx context.Context) error {
	if strings.TrimSpace(s.config.AppID) == "" || strings.TrimSpace(s.config.AppSecret) == "" {
		return s.failStart(ctx, "missing_app_credentials", fmt.Errorf("feishu appId/appSecret are required"))
	}
	if s.gateway == nil {
		return s.failStart(ctx, "missing_app_credentials", fmt.Errorf("feishu gateway is not configured"))
	}
	if s.bindings == nil || s.runtime == nil || s.store == nil {
		return s.failStart(ctx, "adapter_dependencies_missing", fmt.Errorf("feishu adapter dependencies are incomplete"))
	}

	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return nil
	}
	s.started = true
	s.done = make(chan struct{})
	s.mu.Unlock()

	if err := s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateConnecting, ""); err != nil {
		return s.abortStart(err)
	}
	if err := s.gateway.ProbeCredentials(ctx); err != nil {
		return s.failAfterStart(ctx, classifiedCode(err, "long_connection_failed"), err)
	}

	checkpoint, err := s.loadCheckpoint(ctx)
	if err != nil {
		return s.failAfterStart(ctx, "checkpoint_restore_failed", err)
	}
	s.setCheckpoint(checkpoint)

	s.mu.RLock()
	done := s.done
	s.mu.RUnlock()
	go s.runLoop(ctx, done)
	return nil
}

func (s *Service) runLoop(ctx context.Context, done chan struct{}) {
	defer func() {
		close(done)
		s.mu.Lock()
		s.started = false
		s.mu.Unlock()
	}()

	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := s.gateway.Run(ctx, s)
		if ctx.Err() != nil {
			return
		}
		if err == nil {
			return
		}

		code := classifiedCode(err, "long_connection_failed")
		state := domain.ChannelStateDegraded
		if code == "invalid_app_credentials" {
			state = domain.ChannelStateError
		}
		s.logf("feishu event loop failed: %v", err)
		_ = s.store.UpdateChannelState(context.Background(), platformID, state, code)
		if state == domain.ChannelStateError || !sleepContext(ctx, backoff) {
			return
		}
		backoff = nextBackoff(backoff)
	}
}

func (s *Service) OnReady(ctx context.Context) {
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateReady, "")
}

func (s *Service) OnMessage(ctx context.Context, event *MessageEvent) error {
	if shouldSkipCheckpoint(s.checkpoint(), event.EventID) {
		return nil
	}
	advance, err := s.processMessageEvent(ctx, event)
	if err != nil {
		return err
	}
	if advance {
		return s.advanceCheckpoint(ctx, event.EventID)
	}
	return nil
}

func (s *Service) OnCardAction(ctx context.Context, event *CardActionEvent) (*CardActionResult, error) {
	if shouldSkipCheckpoint(s.checkpoint(), event.EventID) {
		return &CardActionResult{Toast: "already handled"}, nil
	}

	result, err := s.processCardAction(ctx, event)
	if err != nil {
		return nil, err
	}
	if err := s.advanceCheckpoint(ctx, event.EventID); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) processMessageEvent(ctx context.Context, event *MessageEvent) (bool, error) {
	inbound, key, ok := mapMessageToInbound(event)
	if !ok {
		return true, nil
	}
	if err := s.store.TouchChannelInbound(ctx, platformID, inbound.ReceivedAt); err != nil {
		return false, withCode("channel_activity_failed", err)
	}

	binding, err := s.resolveOrCreateBinding(ctx, key)
	if err != nil {
		return false, err
	}

	prompt := runtime.PromptRequest{
		Prompt:  inbound.Text,
		WorkDir: binding.WorkDir,
	}
	if prompt.WorkDir == "" {
		prompt.WorkDir = strings.TrimSpace(s.config.DefaultWorkDir)
	}

	var content strings.Builder
	response, err := s.runtime.ExecuteBindingPrompt(ctx, *binding, prompt, func(promptEvent runtime.PromptEvent) error {
		switch promptEvent.Type {
		case runtime.EventTypeContentDelta:
			if promptEvent.Text != "" {
				content.WriteString(promptEvent.Text)
			}
		case runtime.EventTypeApprovalRequested:
			return s.sendApprovalMessage(ctx, event, *binding, promptEvent)
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	if response.Result.Error != "" {
		return false, withCode("runtime_turn_failed", fmt.Errorf("feishu runtime turn failed: %s", response.Result.Error))
	}

	finalText := strings.TrimSpace(content.String())
	if finalText == "" {
		return true, nil
	}
	if err := s.sendReply(ctx, event, *binding, finalText); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) resolveOrCreateBinding(ctx context.Context, key domain.BindingKey) (*domain.SessionBinding, error) {
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, withCode("binding_resolve_failed", err)
	}
	if binding != nil {
		if binding.WorkDir == "" {
			binding.WorkDir = strings.TrimSpace(s.config.DefaultWorkDir)
		}
		return binding, nil
	}

	created, err := s.bindings.CreateBinding(ctx, key, uuid.NewString(), strings.TrimSpace(s.config.DefaultWorkDir), "auto")
	if err != nil {
		return nil, withCode("binding_create_failed", err)
	}
	return created, nil
}

func (s *Service) loadCheckpoint(ctx context.Context) (string, error) {
	value, ok, err := s.store.GetOffset(ctx, platformID, feishuOffsetKind)
	if err != nil {
		return "", fmt.Errorf("read feishu checkpoint: %w", err)
	}
	if !ok {
		return "", nil
	}
	return strings.TrimSpace(value), nil
}

func (s *Service) advanceCheckpoint(ctx context.Context, eventID string) error {
	eventID = strings.TrimSpace(eventID)
	if eventID == "" {
		return nil
	}
	if err := s.store.UpdateChannelOffset(ctx, platformID, eventID); err != nil {
		return withCode("checkpoint_update_failed", err)
	}
	s.setCheckpoint(eventID)
	return nil
}

func (s *Service) checkpoint() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentCheckpoint
}

func (s *Service) setCheckpoint(value string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.currentCheckpoint = strings.TrimSpace(value)
}

func shouldSkipCheckpoint(checkpoint string, eventID string) bool {
	checkpoint = strings.TrimSpace(checkpoint)
	eventID = strings.TrimSpace(eventID)
	return checkpoint != "" && checkpoint == eventID
}

func (s *Service) failStart(ctx context.Context, code string, err error) error {
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateError, code)
	s.logf("feishu adapter start failed: %v", err)
	return err
}

func (s *Service) failAfterStart(ctx context.Context, code string, err error) error {
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateError, code)
	s.logf("feishu adapter start failed: %v", err)
	return s.abortStart(err)
}

func (s *Service) abortStart(err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.done != nil {
		close(s.done)
	}
	s.done = closedDone()
	s.started = false
	return err
}

func (s *Service) logf(format string, args ...any) {
	if s.logger != nil {
		s.logger.Printf(format, args...)
	}
}

func closedDone() chan struct{} {
	ch := make(chan struct{})
	close(ch)
	return ch
}

func nextBackoff(current time.Duration) time.Duration {
	switch {
	case current < time.Second:
		return time.Second
	case current < 2*time.Second:
		return 2 * time.Second
	default:
		return 5 * time.Second
	}
}

func sleepContext(ctx context.Context, delay time.Duration) bool {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

type codedError struct {
	code string
	err  error
}

func (e *codedError) Error() string {
	if e == nil || e.err == nil {
		return ""
	}
	return e.err.Error()
}

func (e *codedError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func withCode(code string, err error) error {
	if err == nil {
		return nil
	}
	return &codedError{code: code, err: err}
}

func classifiedCode(err error, fallback string) string {
	var coded *codedError
	if errors.As(err, &coded) && strings.TrimSpace(coded.code) != "" {
		return coded.code
	}
	return fallback
}
