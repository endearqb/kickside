package app

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/admin"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/logging"
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
	options  Options
	settings config.BridgeSettings
	secrets  config.BridgeSecrets
	store    *store.Store
	logger   *logging.Logger

	mu        sync.RWMutex
	state     domain.BridgeRuntimeState
	startedAt string
	lastError string
	server    *http.Server
	listener  net.Listener
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
		state:    domain.BridgeStateStopped,
	}
	if err := service.store.SyncConfiguredChannels(context.Background(), settings.Channels); err != nil {
		_ = service.Close()
		return nil, err
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
		s.setState(domain.BridgeStateCrashed, fmt.Sprintf("failed to listen on %s: %v", address, err))
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
	s.lastError = ""
	s.state = domain.BridgeStateRunning
	s.mu.Unlock()

	s.logger.Printf("bridge start: admin listening on %s", address)
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && serveErr != http.ErrServerClosed {
			s.logger.Printf("bridge admin server failed: %v", serveErr)
			s.setState(domain.BridgeStateCrashed, serveErr.Error())
		}
	}()
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
	s.mu.Unlock()

	if server != nil {
		if err := server.Shutdown(ctx); err != nil {
			s.setState(domain.BridgeStateDegraded, err.Error())
			return err
		}
	}

	s.mu.Lock()
	s.server = nil
	s.listener = nil
	s.state = domain.BridgeStateStopped
	s.mu.Unlock()
	s.logger.Printf("bridge stopped")
	return nil
}

func (s *Service) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.Shutdown(ctx)
	errStore := s.store.Close()
	errLogger := s.logger.Close()
	if errStore != nil {
		return errStore
	}
	return errLogger
}

func (s *Service) Status(ctx context.Context) (domain.BridgeStatus, error) {
	s.mu.RLock()
	state := s.state
	startedAt := s.startedAt
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

	return domain.BridgeStatus{
		State:            state,
		StartedAt:        startedAt,
		PID:              os.Getpid(),
		AdminPort:        s.options.AdminPort,
		Version:          s.options.Version,
		Channels:         channels,
		PendingApprovals: pendingApprovals,
		Bindings:         bindings,
		LastError:        lastError,
	}, nil
}

func (s *Service) ListBindings(ctx context.Context) ([]domain.BindingRecord, error) {
	return s.store.ListBindings(ctx)
}

func (s *Service) ClearBinding(ctx context.Context, bindingID string) error {
	if err := s.store.ClearBinding(ctx, bindingID); err != nil {
		return err
	}
	s.logger.Printf("binding cleared: %s", bindingID)
	return nil
}

func (s *Service) setState(state domain.BridgeRuntimeState, lastError string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = state
	s.lastError = lastError
}
