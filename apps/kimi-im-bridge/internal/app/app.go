package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/admin"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/binding"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/logging"
	feishuplatform "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/platforms/feishu"
	telegramplatform "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/platforms/telegram"
	kimiprovider "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/providers/kimi"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type Options struct {
	Version          string
	ConfigPath       string
	SecretsPath      string
	DBPath           string
	LogFilePath      string
	AdminPort        int
	AdminToken       string
	HostControlURL   string
	HostControlToken string
	SkillsDir        string
}

type Service struct {
	options            Options
	settings           config.BridgeSettings
	secrets            config.BridgeSecrets
	store              *store.Store
	logger             *logging.Logger
	bindings           *binding.Router
	orchestrator       *bridgecore.Orchestrator
	provider           bridgecore.RuntimeProvider
	runtimeSvc         *runtime.Service
	skillsAuthFilePath string

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
	if strings.TrimSpace(options.SkillsDir) != "" {
		authFilePath, err := writeBridgeSkillsAuthFile(options)
		if err != nil {
			_ = service.Close()
			return nil, err
		}
		service.skillsAuthFilePath = authFilePath
	}
	service.provider = kimiprovider.NewProvider(
		kimiprovider.NewSDKDriver(kimiprovider.SDKDriverOptions{
			SkillsDir:    strings.TrimSpace(options.SkillsDir),
			AuthFilePath: service.skillsAuthFilePath,
		}),
		storeHandle,
		storeHandle,
	)
	service.orchestrator = bridgecore.NewOrchestrator(
		service.bindings,
		service.provider,
		storeHandle,
		storeHandle,
		storeHandle,
	)
	service.runtimeSvc = runtime.NewService(
		runtime.NewSDKDriver(runtime.SDKDriverOptions{
			SkillsDir:    strings.TrimSpace(options.SkillsDir),
			AuthFilePath: service.skillsAuthFilePath,
		}),
		storeHandle,
		storeHandle,
	)
	if err := service.store.SyncConfiguredChannels(context.Background(), settings.Channels); err != nil {
		_ = service.Close()
		return nil, err
	}
	reconciled, err := service.provider.ReconcilePendingApprovals(context.Background(), "runtime_restarted_before_resume")
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
	var errProvider error
	if s.provider != nil {
		errProvider = s.provider.Close()
	}
	errRuntime := s.runtimeSvc.Close()
	errStore := s.store.Close()
	errLogger := s.logger.Close()
	cleanupBridgeSkillsAuthFile(s.skillsAuthFilePath)
	if errProvider != nil {
		return errProvider
	}
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
		channels = s.fallbackChannelStatuses(state)
		lastErrorCode, lastError = appendStatusSnapshotIssue(
			lastErrorCode,
			lastError,
			"list channel statuses",
			err,
		)
	}
	bindings, err := s.store.CountBindings(ctx)
	if err != nil {
		bindings = 0
		lastErrorCode, lastError = appendStatusSnapshotIssue(
			lastErrorCode,
			lastError,
			"count bindings",
			err,
		)
	}
	pendingApprovals, err := s.store.CountPendingApprovals(ctx)
	if err != nil {
		pendingApprovals = 0
		lastErrorCode, lastError = appendStatusSnapshotIssue(
			lastErrorCode,
			lastError,
			"count pending approvals",
			err,
		)
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

func (s *Service) fallbackChannelStatuses(state domain.BridgeRuntimeState) []domain.ChannelStatus {
	statuses := make([]domain.ChannelStatus, 0, len(s.settings.Channels))
	for _, channel := range s.settings.Channels {
		statuses = append(statuses, domain.ChannelStatus{
			Platform: channel.Platform,
			Enabled:  channel.Enabled,
			State:    fallbackChannelState(channel.Enabled, state),
		})
	}
	return statuses
}

func fallbackChannelState(enabled bool, state domain.BridgeRuntimeState) domain.ChannelRuntimeState {
	if !enabled {
		return domain.ChannelStateIdle
	}

	switch state {
	case domain.BridgeStateStarting:
		return domain.ChannelStateConnecting
	case domain.BridgeStateRunning:
		return domain.ChannelStateReady
	case domain.BridgeStateDegraded, domain.BridgeStateStopping, domain.BridgeStateCrashed:
		return domain.ChannelStateDegraded
	default:
		return domain.ChannelStateIdle
	}
}

func appendStatusSnapshotIssue(currentCode string, currentMessage string, stage string, err error) (string, string) {
	if strings.TrimSpace(currentCode) == "" {
		currentCode = "platform_unavailable"
	}

	detail := fmt.Sprintf("status snapshot failed: %s: %v", stage, err)
	currentMessage = strings.TrimSpace(currentMessage)
	if currentMessage == "" {
		return currentCode, detail
	}
	if strings.Contains(currentMessage, detail) {
		return currentCode, currentMessage
	}
	return currentCode, fmt.Sprintf("%s; %s", currentMessage, detail)
}

func (s *Service) ListBindings(ctx context.Context) ([]domain.BindingRecord, error) {
	return s.store.ListBindings(ctx)
}

func (s *Service) ListSessions(ctx context.Context) ([]domain.BridgeSession, error) {
	return s.store.ListSessions(ctx)
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

func (s *Service) UpdateBinding(ctx context.Context, bindingID string, input domain.BindingUpdate) error {
	if strings.TrimSpace(bindingID) == "" {
		return fmt.Errorf("binding id is required")
	}

	workDirWasSet := input.WorkDir != nil
	workDirValue := ""
	if input.WorkDir != nil {
		workDirValue = strings.TrimSpace(*input.WorkDir)
	}

	if strings.TrimSpace(input.KimiSessionID) == "" && !workDirWasSet {
		return fmt.Errorf("binding update requires kimiSessionId or workDir")
	}

	if sessionID := strings.TrimSpace(input.KimiSessionID); sessionID != "" {
		if err := s.bindings.Rebind(ctx, bindingID, sessionID); err != nil {
			return err
		}
		s.logger.Printf("binding rebound: %s -> %s", bindingID, sessionID)
	}
	if workDirWasSet {
		if err := s.bindings.UpdateBindingWorkDir(ctx, bindingID, workDirValue); err != nil {
			return err
		}
		s.logger.Printf("binding workdir updated: %s -> %q", bindingID, workDirValue)
	}
	return nil
}

func (s *Service) ImportSession(ctx context.Context, input domain.SessionImportRequest) (domain.BridgeSession, error) {
	workDir := strings.TrimSpace(input.WorkDir)
	if workDir == "" {
		return domain.BridgeSession{}, fmt.Errorf("workDir is required")
	}

	metadataJSON, err := json.Marshal(map[string]string{
		"importedFromSource":    strings.TrimSpace(input.Source),
		"importedFromSessionId": strings.TrimSpace(input.SourceSessionID),
	})
	if err != nil {
		return domain.BridgeSession{}, fmt.Errorf("marshal import metadata: %w", err)
	}

	now := time.Now().UTC().Format(time.RFC3339)
	session := domain.BridgeSession{
		KimiSessionID:       uuid.NewString(),
		WorkDir:             workDir,
		Summary:             strings.TrimSpace(input.Summary),
		SessionState:        "imported",
		ProviderName:        "kimi",
		RuntimeMetadataJSON: string(metadataJSON),
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if session.Summary == "" {
		session.Summary = fmt.Sprintf("Imported from %s session %s", firstNonEmpty(strings.TrimSpace(input.Source), "shell-web"), firstNonEmpty(strings.TrimSpace(input.SourceSessionID), "unknown"))
	}
	if err := s.store.UpsertSession(ctx, session); err != nil {
		return domain.BridgeSession{}, err
	}
	s.logger.Printf(
		"session imported: %s source=%s sourceSessionId=%s workdir=%q",
		session.KimiSessionID,
		firstNonEmpty(strings.TrimSpace(input.Source), "shell-web"),
		strings.TrimSpace(input.SourceSessionID),
		workDir,
	)
	return session, nil
}

func (s *Service) ResolveApproval(ctx context.Context, approvalID string, status string, resolutionPayloadJSON string) error {
	if err := s.provider.ResolveApproval(ctx, approvalID, status, resolutionPayloadJSON); err != nil {
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
		return telegramplatform.NewService(telegramplatform.Options{
			Config: telegramplatform.Config{
				BotToken:       secretTelegramBotToken(s.secrets),
				DefaultWorkDir: s.settings.DefaultWorkDir,
			},
			BindingRouter: s.bindings,
			Orchestrator:  s.orchestrator,
			Store:         s.store,
			Logger:        s.logger,
		}), nil
	case "feishu":
		var hostControl feishuplatform.HostController
		if strings.TrimSpace(s.options.HostControlURL) != "" && strings.TrimSpace(s.options.HostControlToken) != "" {
			hostControl = feishuplatform.NewHostControlClient(s.options.HostControlURL, s.options.HostControlToken)
		}
		return feishuplatform.NewService(feishuplatform.Options{
			Config: feishuplatform.Config{
				AppID:                 secretFeishuAppID(s.secrets),
				AppSecret:             secretFeishuAppSecret(s.secrets),
				AutoApprove:           s.settings.FeishuAutoApprove,
				DefaultWorkDir:        s.settings.DefaultWorkDir,
				WorkDirPresets:        mapFeishuWorkDirPresets(s.settings.WorkDirPresets),
				ReplyRenderer:         s.settings.FeishuReplyRenderer,
				AttachmentsDir:        filepath.Join(filepath.Dir(s.options.DBPath), "attachments", "feishu"),
				BridgeOpsSkillEnabled: strings.TrimSpace(s.options.SkillsDir) != "",
			},
			BindingRouter: s.bindings,
			Orchestrator:  s.orchestrator,
			HostControl:   hostControl,
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func mapFeishuWorkDirPresets(presets []config.WorkDirPreset) []feishuplatform.WorkDirPreset {
	if len(presets) == 0 {
		return nil
	}

	mapped := make([]feishuplatform.WorkDirPreset, 0, len(presets))
	for _, preset := range presets {
		mapped = append(mapped, feishuplatform.WorkDirPreset{
			Name: strings.TrimSpace(preset.Name),
			Path: strings.TrimSpace(preset.Path),
		})
	}
	return mapped
}
