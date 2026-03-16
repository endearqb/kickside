package feishu

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapterkit"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

type Service struct {
	config       Config
	gateway      Gateway
	bindings     BindingRouter
	runtime      RuntimeExecutor
	orchestrator bridgecore.InboundExecutor
	store        ChannelStore
	logger       Logger
	delivery     *reliability.Executor

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
		config:       options.Config,
		gateway:      gateway,
		bindings:     options.BindingRouter,
		runtime:      options.Runtime,
		orchestrator: options.Orchestrator,
		store:        options.Store,
		logger:       options.Logger,
		delivery: reliability.NewExecutor(reliability.ExecutorOptions{
			Platform: platformID,
			Logger:   options.Logger,
		}),
		done: closedDone(),
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
		return s.failStart(ctx, "invalid_credentials", fmt.Errorf("feishu appId/appSecret are required"))
	}
	if s.gateway == nil {
		return s.failStart(ctx, "invalid_credentials", fmt.Errorf("feishu gateway is not configured"))
	}
	if s.bindings == nil || (s.runtime == nil && s.orchestrator == nil) || s.store == nil {
		return s.failStart(ctx, "unknown", fmt.Errorf("feishu adapter dependencies are incomplete"))
	}

	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return nil
	}
	s.started = true
	s.done = make(chan struct{})
	s.mu.Unlock()

	if err := s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateConnecting, "", ""); err != nil {
		return s.abortStart(err)
	}
	if err := s.gateway.ProbeCredentials(ctx); err != nil {
		code := classifyFeishuError(err).Code
		if code == "" {
			code = "unknown"
		}
		return s.failAfterStart(ctx, code, err)
	}

	checkpoint, err := s.loadCheckpoint(ctx)
	if err != nil {
		return s.failAfterStart(ctx, "unknown", err)
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

		classification := classifyFeishuError(err)
		code := classification.Code
		if code == "" {
			code = "unknown"
		}
		state := domain.ChannelStateDegraded
		if code == "invalid_credentials" {
			state = domain.ChannelStateError
		}
		backoffNext := backoff
		if !classification.Retryable {
			backoffNext = 0
		}
		s.logf(
			"channel event=failure platform=%s operation=long_connection errorCode=%s attempt=1 retryable=%t nextBackoffMs=%d err=%q",
			platformID,
			code,
			classification.Retryable,
			backoffNext.Milliseconds(),
			err.Error(),
		)
		_ = s.store.UpdateChannelState(context.Background(), platformID, state, code, err.Error())
		if state == domain.ChannelStateError || !reliability.SleepContext(ctx, backoff) {
			return
		}
		backoff = nextBackoff(backoff)
	}
}

func (s *Service) OnReady(ctx context.Context) {
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateReady, "", "")
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
		return false, reliability.Wrap("unknown", err)
	}

	binding, err := s.resolveOrCreateBinding(ctx, key)
	if err != nil {
		return false, err
	}

	if s.orchestrator != nil {
		result, err := s.orchestrator.HandleInbound(ctx, adapterkit.FromDomainInbound(inbound, key), bridgecore.HandleOptions{
			DefaultWorkDir: strings.TrimSpace(s.config.DefaultWorkDir),
		}, func(turnEvent bridgecore.TurnEvent) error {
			if turnEvent.Kind == bridgecore.EventApprovalRequested {
				return s.sendApprovalMessageBridge(ctx, event, turnEvent)
			}
			return nil
		})
		if err != nil {
			return false, err
		}
		if strings.TrimSpace(result.ReplyText) == "" {
			return true, nil
		}
		if err := s.sendReply(ctx, event, result.Binding, result.ReplyText); err != nil {
			return false, err
		}
		return true, nil
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
		return false, reliability.Wrap(
			"delivery_failed",
			fmt.Errorf("feishu runtime turn failed: %s", response.Result.Error),
		)
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
		return nil, reliability.Wrap("unknown", err)
	}
	if binding != nil {
		if binding.WorkDir == "" {
			binding.WorkDir = strings.TrimSpace(s.config.DefaultWorkDir)
		}
		return binding, nil
	}

	created, err := s.bindings.CreateBinding(ctx, key, uuid.NewString(), strings.TrimSpace(s.config.DefaultWorkDir), "auto")
	if err != nil {
		return nil, reliability.Wrap("unknown", err)
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
		return reliability.Wrap("unknown", err)
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
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateError, code, err.Error())
	s.logf(
		"channel event=failure platform=%s operation=start errorCode=%s attempt=1 retryable=false nextBackoffMs=0 err=%q",
		platformID,
		code,
		err.Error(),
	)
	return err
}

func (s *Service) failAfterStart(ctx context.Context, code string, err error) error {
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateError, code, err.Error())
	s.logf(
		"channel event=failure platform=%s operation=start errorCode=%s attempt=1 retryable=false nextBackoffMs=0 err=%q",
		platformID,
		code,
		err.Error(),
	)
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
