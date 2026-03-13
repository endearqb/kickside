package telegram

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

const (
	platformID         = "telegram"
	telegramOffsetKind = "telegram_update"
	pollTimeoutSeconds = 30
)

type BindingRouter interface {
	ResolveBinding(context.Context, domain.BindingKey) (*domain.SessionBinding, error)
	CreateBinding(context.Context, domain.BindingKey, string, string, string) (*domain.SessionBinding, error)
}

type RuntimeExecutor interface {
	ExecuteBindingPrompt(context.Context, domain.SessionBinding, runtime.PromptRequest, runtime.PromptEventSink) (runtime.PromptResponse, error)
	ResolveApproval(context.Context, string, string, string) error
}

type ChannelStore interface {
	GetOffset(context.Context, string, string) (string, bool, error)
	UpdateChannelState(context.Context, string, domain.ChannelRuntimeState, string) error
	UpdateChannelOffset(context.Context, string, string) error
	TouchChannelInbound(context.Context, string, string) error
	TouchChannelOutbound(context.Context, string, string) error
	GetApprovalByID(context.Context, string) (*domain.ApprovalTicket, error)
	GetDeliveryEventByKey(context.Context, string) (*domain.DeliveryEvent, error)
	RecordDeliveryEventIfAbsent(context.Context, domain.DeliveryEvent) (bool, error)
	UpdateDeliveryEventStatus(context.Context, string, string, string) error
}

type Logger interface {
	Printf(string, ...any)
}

type BotAPI interface {
	GetMe(context.Context) (*getMeResponse, error)
	GetWebhookInfo(context.Context) (*webhookInfo, error)
	GetUpdates(context.Context, getUpdatesRequest) ([]update, error)
	SendMessage(context.Context, sendMessageRequest) (*message, error)
	EditMessageText(context.Context, editMessageTextRequest) error
	AnswerCallbackQuery(context.Context, answerCallbackQueryRequest) error
}

type Config struct {
	BotToken       string
	DefaultWorkDir string
}

type Options struct {
	Config        Config
	BotAPI        BotAPI
	BindingRouter BindingRouter
	Runtime       RuntimeExecutor
	Store         ChannelStore
	Logger        Logger
}

type Service struct {
	config   Config
	botAPI   BotAPI
	bindings BindingRouter
	runtime  RuntimeExecutor
	store    ChannelStore
	logger   Logger

	mu          sync.RWMutex
	started     bool
	done        chan struct{}
	botUserID   int64
	botUsername string
}

func NewService(options Options) *Service {
	botAPI := options.BotAPI
	if botAPI == nil && strings.TrimSpace(options.Config.BotToken) != "" {
		botAPI = NewClient(options.Config.BotToken, ClientOptions{})
	}

	return &Service{
		config:   options.Config,
		botAPI:   botAPI,
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
	if strings.TrimSpace(s.config.BotToken) == "" {
		return s.failStart(ctx, "missing_bot_token", fmt.Errorf("telegram bot token is required"))
	}
	if s.botAPI == nil {
		return s.failStart(ctx, "missing_bot_token", fmt.Errorf("telegram bot api client is not configured"))
	}
	if s.bindings == nil || s.runtime == nil || s.store == nil {
		return s.failStart(ctx, "adapter_dependencies_missing", fmt.Errorf("telegram adapter dependencies are incomplete"))
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

	me, err := s.botAPI.GetMe(ctx)
	if err != nil {
		code := "telegram_connect_failed"
		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.IsInvalidToken() {
			code = "invalid_bot_token"
		}
		return s.failAfterStart(ctx, code, err)
	}

	webhook, err := s.botAPI.GetWebhookInfo(ctx)
	if err != nil {
		return s.failAfterStart(ctx, "webhook_check_failed", err)
	}
	if webhook != nil && strings.TrimSpace(webhook.URL) != "" {
		return s.failAfterStart(ctx, "webhook_configured", fmt.Errorf("telegram webhook is configured: %s", webhook.URL))
	}

	offset, err := s.loadOffset(ctx)
	if err != nil {
		return s.failAfterStart(ctx, "offset_restore_failed", err)
	}

	s.mu.Lock()
	s.botUserID = me.ID
	s.botUsername = strings.TrimSpace(me.Username)
	done := s.done
	s.mu.Unlock()

	if err := s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateReady, ""); err != nil {
		return s.abortStart(err)
	}

	go s.pollLoop(ctx, offset, done)
	return nil
}

func (s *Service) loadOffset(ctx context.Context) (int64, error) {
	value, ok, err := s.store.GetOffset(ctx, platformID, telegramOffsetKind)
	if err != nil {
		return 0, fmt.Errorf("read telegram offset: %w", err)
	}
	if !ok || strings.TrimSpace(value) == "" {
		return 0, nil
	}
	offset, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse telegram offset %q: %w", value, err)
	}
	return offset, nil
}

func (s *Service) pollLoop(ctx context.Context, offset int64, done chan struct{}) {
	defer func() {
		close(done)
		s.mu.Lock()
		s.started = false
		s.mu.Unlock()
	}()

	currentOffset := offset
	backoff := time.Second

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		updates, err := s.botAPI.GetUpdates(ctx, getUpdatesRequest{
			Offset:         currentOffset,
			Timeout:        pollTimeoutSeconds,
			AllowedUpdates: []string{"message", "callback_query"},
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			code := "polling_failed"
			state := domain.ChannelStateDegraded
			var apiErr *APIError
			if errors.As(err, &apiErr) && apiErr.IsInvalidToken() {
				code = "invalid_bot_token"
				state = domain.ChannelStateError
			}
			s.logf("telegram polling failed: %v", err)
			_ = s.store.UpdateChannelState(context.Background(), platformID, state, code)
			if state == domain.ChannelStateError || !sleepContext(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		backoff = time.Second
		_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateReady, "")

		nextOffset, err := s.handleUpdates(ctx, updates, currentOffset)
		if err != nil {
			code := classifiedCode(err, "update_processing_failed")
			s.logf("telegram update processing failed: %v", err)
			_ = s.store.UpdateChannelState(context.Background(), platformID, domain.ChannelStateDegraded, code)
			if !sleepContext(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}
		currentOffset = nextOffset
	}
}

func (s *Service) handleUpdates(ctx context.Context, updates []update, currentOffset int64) (int64, error) {
	nextOffset := currentOffset
	for _, item := range updates {
		advance, err := s.processUpdate(ctx, item)
		if err != nil {
			return nextOffset, err
		}
		if !advance {
			continue
		}
		candidate := item.UpdateID + 1
		if err := s.store.UpdateChannelOffset(ctx, platformID, strconv.FormatInt(candidate, 10)); err != nil {
			return nextOffset, withCode("offset_update_failed", fmt.Errorf("persist telegram offset %d: %w", candidate, err))
		}
		nextOffset = candidate
	}
	return nextOffset, nil
}

func (s *Service) processUpdate(ctx context.Context, item update) (bool, error) {
	switch {
	case item.Message != nil:
		return s.processMessage(ctx, item.Message)
	case item.CallbackQuery != nil:
		return s.processCallback(ctx, item.CallbackQuery)
	default:
		return true, nil
	}
}

func (s *Service) processMessage(ctx context.Context, incoming *message) (bool, error) {
	s.mu.RLock()
	botUsername := s.botUsername
	botUserID := s.botUserID
	s.mu.RUnlock()

	inbound, key, ok := mapMessageToInbound(incoming, botUsername, botUserID)
	if !ok {
		return true, nil
	}
	if err := s.store.TouchChannelInbound(ctx, platformID, inbound.ReceivedAt); err != nil {
		return false, withCode("channel_activity_failed", err)
	}

	binding, err := s.resolveOrCreateBinding(ctx, *key)
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
	response, err := s.runtime.ExecuteBindingPrompt(ctx, *binding, prompt, func(event runtime.PromptEvent) error {
		switch event.Type {
		case runtime.EventTypeContentDelta:
			if event.Text != "" {
				content.WriteString(event.Text)
			}
		case runtime.EventTypeApprovalRequested:
			return s.sendApprovalMessage(ctx, incoming, *binding, event)
		}
		return nil
	})
	if err != nil {
		return false, err
	}
	if response.Result.Error != "" {
		return false, withCode("runtime_turn_failed", fmt.Errorf("telegram runtime turn failed: %s", response.Result.Error))
	}

	finalText := strings.TrimSpace(content.String())
	if finalText == "" {
		return true, nil
	}
	if err := s.sendReply(ctx, incoming, *binding, finalText); err != nil {
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

func (s *Service) failStart(ctx context.Context, code string, err error) error {
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateError, code)
	s.logf("telegram adapter start failed: %v", err)
	return err
}

func (s *Service) failAfterStart(ctx context.Context, code string, err error) error {
	_ = s.store.UpdateChannelState(ctx, platformID, domain.ChannelStateError, code)
	s.logf("telegram adapter start failed: %v", err)
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
