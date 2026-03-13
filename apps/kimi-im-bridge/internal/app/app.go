package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapters/feishu"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapters/telegram"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/admin"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/binding"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/logging"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type Options struct {
	Version     string
	ConfigPath  string
	SecretsPath string
	DBPath      string
	LogFilePath string
	AdminPort   int
	AdminToken  string
}

type Service struct {
	options    Options
	settings   config.BridgeSettings
	secrets    config.BridgeSecrets
	store      *store.Store
	logger     *logging.Logger
	bindings   *binding.Router
	runtimeSvc *runtime.Service

	mu            sync.RWMutex
	state         domain.BridgeRuntimeState
	startedAt     string
	lastErrorCode string
	lastError     string
	server        *http.Server
	listener      net.Listener
	stopCh        chan struct{}
	stopOnce      sync.Once
	adapterCancel context.CancelFunc
	adapters      []managedAdapter
}

type managedAdapter interface {
	Name() string
	Start(context.Context) error
	Done() <-chan struct{}
}

func New(options Options) (*Service, error) {
	settings, err := config.LoadOrCreateSettings(options.ConfigPath)
	if err != nil {
		return nil, err
	}
	secrets, err := config.LoadOrCreateSecrets(options.SecretsPath)
	if err != nil {
		return nil, err
	}
	logger, err := logging.New(options.LogFilePath)
	if err != nil {
		return nil, err
	}
	storeHandle, err := store.Open(options.DBPath)
	if err != nil {
		_ = logger.Close()
		return nil, err
	}

	service := &Service{
		options:  options,
		settings: settings,
		secrets:  secrets,
		store:    storeHandle,
		logger:   logger,
		bindings: binding.NewRouter(storeHandle),
		state:    domain.BridgeStateStopped,
		stopCh:   make(chan struct{}),
	}
	service.runtimeSvc = runtime.NewService(
		runtime.NewSDKDriver(runtime.SDKDriverOptions{}),
		storeHandle,
		storeHandle,
	)
	if err := service.store.SyncConfiguredChannels(context.Background(), settings.Channels); err != nil {
		_ = service.Close()
		return nil, err
	}
	reconciled, err := service.runtimeSvc.ReconcilePendingApprovals(context.Background(), "runtime_restarted_before_resume")
	if err != nil {
		_ = service.Close()
		return nil, err
	}
	if reconciled > 0 {
		service.logger.Printf("runtime reconciled orphan approvals after restart: count=%d", reconciled)
	}
	return service, nil
}

func (s *Service) Start() error {
	s.mu.Lock()
	if s.state == domain.BridgeStateRunning {
		s.mu.Unlock()
		return nil
	}
	s.state = domain.BridgeStateStarting
	s.mu.Unlock()

	address := fmt.Sprintf("127.0.0.1:%d", s.options.AdminPort)
	listener, err := net.Listen("tcp", address)
	if err != nil {
		s.setState(
			domain.BridgeStateCrashed,
			"platform_unavailable",
			fmt.Sprintf("failed to listen on %s: %v", address, err),
		)
		return err
	}

	server := &http.Server{
		Addr:              address,
		Handler:           admin.NewHandler(s, s.options.AdminToken),
		ReadHeaderTimeout: 5 * time.Second,
	}

	s.mu.Lock()
	s.listener = listener
	s.server = server
	s.startedAt = time.Now().UTC().Format(time.RFC3339)
	s.lastErrorCode = ""
	s.lastError = ""
	s.state = domain.BridgeStateRunning
	s.mu.Unlock()

	s.logger.Printf("bridge start: admin listening on %s", address)
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			s.logger.Printf("bridge admin server failed: %v", serveErr)
			s.setState(domain.BridgeStateCrashed, "platform_unavailable", serveErr.Error())
		}
	}()

	if err := s.startAdapters(); err != nil {
		s.logger.Printf("bridge adapter startup degraded: %v", err)
	}
	return nil
}

func (s *Service) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	if s.state == domain.BridgeStateStopped {
		s.mu.Unlock()
		return nil
	}
	s.state = domain.BridgeStateStopping
	server := s.server
	adapterCancel := s.adapterCancel
	adapters := append([]managedAdapter(nil), s.adapters...)
	s.mu.Unlock()

	if adapterCancel != nil {
		adapterCancel()
	}
	for _, adapter := range adapters {
		select {
		case <-adapter.Done():
		case <-ctx.Done():
			s.setState(domain.BridgeStateDegraded, "transient_network", ctx.Err().Error())
			return ctx.Err()
		}
	}

	if server != nil {
		if err := server.Shutdown(ctx); err != nil {
			s.setState(domain.BridgeStateDegraded, "transient_network", err.Error())
			return err
		}
	}

	s.mu.Lock()
	s.server = nil
	s.listener = nil
	s.adapterCancel = nil
	s.adapters = nil
	s.state = domain.BridgeStateStopped
	s.mu.Unlock()
	s.logger.Printf("bridge stopped")
	return nil
}

func (s *Service) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.Shutdown(ctx)
	errRuntime := s.runtimeSvc.Close()
	errStore := s.store.Close()
	errLogger := s.logger.Close()
	if errRuntime != nil {
		return errRuntime
	}
	if errStore != nil {
		return errStore
	}
	return errLogger
}

func (s *Service) Status(ctx context.Context) (domain.BridgeStatus, error) {
	s.mu.RLock()
	state := s.state
	startedAt := s.startedAt
	lastErrorCode := s.lastErrorCode
	lastError := s.lastError
	s.mu.RUnlock()

	channels, err := s.store.ListChannelStatuses(ctx)
	if err != nil {
		return domain.BridgeStatus{}, err
	}
	bindings, err := s.store.CountBindings(ctx)
	if err != nil {
		return domain.BridgeStatus{}, err
	}
	pendingApprovals, err := s.store.CountPendingApprovals(ctx)
	if err != nil {
		return domain.BridgeStatus{}, err
	}

	for _, channel := range channels {
		if state == domain.BridgeStateRunning && (channel.State == domain.ChannelStateError || channel.State == domain.ChannelStateDegraded) {
			state = domain.BridgeStateDegraded
			if lastError == "" && channel.LastError != "" {
				lastErrorCode = channel.LastErrorCode
				lastError = fmt.Sprintf("%s: %s", channel.Platform, channel.LastError)
			}
		}
	}

	return domain.BridgeStatus{
		State:            state,
		StartedAt:        startedAt,
		PID:              os.Getpid(),
		AdminPort:        s.options.AdminPort,
		Version:          s.options.Version,
		Channels:         channels,
		PendingApprovals: pendingApprovals,
		Bindings:         bindings,
		LastErrorCode:    lastErrorCode,
		LastError:        lastError,
	}, nil
}

func (s *Service) ListBindings(ctx context.Context) ([]domain.BindingRecord, error) {
	return s.store.ListBindings(ctx)
}

func (s *Service) ListApprovals(ctx context.Context, status string) ([]domain.ApprovalTicket, error) {
	return s.store.ListApprovals(ctx, status)
}

func (s *Service) ClearBinding(ctx context.Context, bindingID string) error {
	if err := s.store.ClearBinding(ctx, bindingID); err != nil {
		return err
	}
	s.logger.Printf("binding cleared: %s", bindingID)
	return nil
}

func (s *Service) ResolveApproval(ctx context.Context, approvalID string, status string, resolutionPayloadJSON string) error {
	if err := s.runtimeSvc.ResolveApproval(ctx, approvalID, status, resolutionPayloadJSON); err != nil {
		return err
	}
	s.logger.Printf("approval resolved: %s (%s)", approvalID, status)
	return nil
}

func (s *Service) DebugPrompt(ctx context.Context, request runtime.PromptRequest) (runtime.PromptResponse, error) {
	if request.WorkDir == "" {
		request.WorkDir = s.settings.DefaultWorkDir
	}
	response, err := s.runtimeSvc.RunPrompt(ctx, request)
	if err != nil {
		return runtime.PromptResponse{}, err
	}
	s.logger.Printf("debug prompt completed: session=%s turn=%s status=%s", response.KimiSessionID, response.TurnID, response.Result.Status)
	return response, nil
}

func (s *Service) RequestStop() error {
	s.stopOnce.Do(func() {
		close(s.stopCh)
	})
	return nil
}

func (s *Service) StopRequested() <-chan struct{} {
	return s.stopCh
}

func (s *Service) setState(state domain.BridgeRuntimeState, lastErrorCode string, lastError string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = state
	s.lastErrorCode = lastErrorCode
	s.lastError = lastError
}

func (s *Service) startAdapters() error {
	if !s.settings.Enabled {
		return nil
	}

	adapterCtx, cancel := context.WithCancel(context.Background())
	adapters := []managedAdapter{}
	errs := []string{}

	for _, channel := range s.settings.Channels {
		if !channel.Enabled {
			continue
		}

		adapter, err := s.buildAdapter(channel)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		if adapter == nil {
			continue
		}
		if err := adapter.Start(adapterCtx); err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", adapter.Name(), err))
			continue
		}
		adapters = append(adapters, adapter)
		s.logger.Printf("bridge adapter started: %s", adapter.Name())
	}

	s.mu.Lock()
	s.adapterCancel = cancel
	s.adapters = adapters
	s.mu.Unlock()

	if len(errs) > 0 {
		return fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return nil
}

func (s *Service) buildAdapter(channel config.ChannelConfig) (managedAdapter, error) {
	switch strings.TrimSpace(strings.ToLower(channel.Platform)) {
	case "telegram":
		return telegram.NewService(telegram.Options{
			Config: telegram.Config{
				BotToken:       secretTelegramBotToken(s.secrets),
				DefaultWorkDir: s.settings.DefaultWorkDir,
			},
			BindingRouter: s.bindings,
			Runtime:       s.runtimeSvc,
			Store:         s.store,
			Logger:        s.logger,
		}), nil
	case "feishu":
		return feishu.NewService(feishu.Options{
			Config: feishu.Config{
				AppID:          secretFeishuAppID(s.secrets),
				AppSecret:      secretFeishuAppSecret(s.secrets),
				DefaultWorkDir: s.settings.DefaultWorkDir,
			},
			BindingRouter: s.bindings,
			Runtime:       s.runtimeSvc,
			Store:         s.store,
			Logger:        s.logger,
		}), nil
	default:
		if err := s.store.UpdateChannelState(
			context.Background(),
			channel.Platform,
			domain.ChannelStateError,
			"unknown",
			fmt.Sprintf("unsupported adapter platform %q", channel.Platform),
		); err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("unsupported adapter platform %q", channel.Platform)
	}
}

func secretTelegramBotToken(secrets config.BridgeSecrets) string {
	if secrets.Telegram == nil {
		return ""
	}
	return strings.TrimSpace(secrets.Telegram.BotToken)
}

func secretFeishuAppID(secrets config.BridgeSecrets) string {
	if secrets.Feishu == nil {
		return ""
	}
	return strings.TrimSpace(secrets.Feishu.AppID)
}

func secretFeishuAppSecret(secrets config.BridgeSecrets) string {
	if secrets.Feishu == nil {
		return ""
	}
	return strings.TrimSpace(secrets.Feishu.AppSecret)
}
