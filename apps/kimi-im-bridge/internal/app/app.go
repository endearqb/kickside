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
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/agentroom"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/binding"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/logging"
	feishuplatform "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/platforms/feishu"
	telegramplatform "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/platforms/telegram"
	weixinplatform "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/platforms/weixin"
	kimiprovider "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/providers/kimi"
	runtimeadapterprovider "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/providers/runtimeadapter"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type Options struct {
	Version                string
	ConfigPath             string
	SecretsPath            string
	DBPath                 string
	LogFilePath            string
	AdminPort              int
	AdminToken             string
	HostControlURL         string
	HostControlToken       string
	KimiRuntimeLocatorPath string
	SkillsDir              string
	AgentRoomEnabled       bool
}

type Service struct {
	options             Options
	settings            config.BridgeSettings
	secrets             config.BridgeSecrets
	store               *store.Store
	logger              *logging.Logger
	bindings            *binding.Router
	orchestrator        *bridgecore.Orchestrator
	provider            bridgecore.RuntimeProvider
	serverAdapter       *runtime.KimiCodeServerAdapter
	runtimeSvc          *runtime.Service
	agentRoomCore       *agentroom.Service
	agentRoomObserver   *agentroom.ObserverCoordinator
	agentRoomDispatcher *agentroom.Dispatcher
	providerName        string
	skillsAuthFilePath  string

	lifecycleMu    sync.Mutex
	mu             sync.RWMutex
	state          domain.BridgeRuntimeState
	startedAt      string
	lastErrorCode  string
	lastError      string
	server         *http.Server
	listener       net.Listener
	stopCh         chan struct{}
	stopOnce       sync.Once
	adapterCancel  context.CancelFunc
	adapters       []managedAdapter
	observerCancel context.CancelFunc
	observerDone   chan struct{}
}

type managedAdapter interface {
	Name() string
	Start(context.Context) error
	Done() <-chan struct{}
}

type recoveredApprovalRedeliverer interface {
	RedeliverPendingApprovals(context.Context) (int, error)
}

func New(options Options) (*Service, error) {
	options.AgentRoomEnabled = false
	settings, err := config.LoadOrCreateSettings(options.ConfigPath)
	if err != nil {
		return nil, err
	}
	secrets, err := config.LoadOrCreateSecrets(options.SecretsPath)
	if err != nil {
		return nil, err
	}
	settings = config.ReconcileSettingsWithSecrets(settings, secrets)
	logger, err := logging.New(options.LogFilePath)
	if err != nil {
		return nil, err
	}
	registerLoggerSecrets(logger, options, secrets)
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
	service.provider, service.providerName, service.serverAdapter = newRuntimeProvider(options, service.skillsAuthFilePath, storeHandle, logger)
	service.agentRoomCore = agentroom.NewService(storeHandle)
	service.orchestrator = bridgecore.NewOrchestrator(
		service.bindings,
		service.provider,
		storeHandle,
		storeHandle,
		storeHandle,
		bridgecore.OrchestratorOptions{AgentBindings: storeHandle, DefaultWorkDir: settings.DefaultWorkDir},
	)
	service.agentRoomDispatcher = agentroom.NewDispatcher(service.agentRoomCore, storeHandle, service.serverAdapter, service.provider)
	if options.AgentRoomEnabled {
		if err := service.agentRoomDispatcher.Recover(context.Background()); err != nil {
			_ = service.Close()
			return nil, fmt.Errorf("recover agent room queue: %w", err)
		}
	}
	service.runtimeSvc = runtime.NewService(
		runtime.NewSDKDriver(runtime.SDKDriverOptions{
			SkillsDir:    strings.TrimSpace(options.SkillsDir),
			AuthFilePath: service.skillsAuthFilePath,
		}),
		storeHandle,
		storeHandle,
	)
	if err := service.store.SyncConfiguredChannels(context.Background(), configuredConnectors(settings)); err != nil {
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

func newRuntimeProvider(
	options Options,
	authFilePath string,
	storeHandle *store.Store,
	logger *logging.Logger,
) (bridgecore.RuntimeProvider, string, *runtime.KimiCodeServerAdapter) {
	sdkProvider := kimiprovider.NewProvider(
		kimiprovider.NewSDKDriver(kimiprovider.SDKDriverOptions{
			SkillsDir:    strings.TrimSpace(options.SkillsDir),
			AuthFilePath: authFilePath,
		}),
		storeHandle,
		storeHandle,
	)
	locatorPath := strings.TrimSpace(options.KimiRuntimeLocatorPath)
	if locatorPath == "" {
		logger.Printf("bridge runtime provider selected: sdk")
		return sdkProvider, "sdk", nil
	}
	adapter, err := runtime.NewKimiCodeServerAdapter(runtime.KimiCodeServerAdapterOptions{
		RuntimeLocatorPath: locatorPath,
	})
	if err != nil {
		logger.Printf("bridge runtime provider server unavailable; falling back to sdk: %v", err)
		return sdkProvider, "sdk", nil
	}
	logger.Printf("bridge runtime provider selected: server")
	return runtimeadapterprovider.NewProvider(adapter, storeHandle, storeHandle), "server", adapter
}

func (s *Service) Start() error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()

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

	var roomRoutes *admin.AgentRoomRoutes
	if s.options.AgentRoomEnabled {
		roomRoutes = admin.NewAgentRoomRoutes(s.agentRoomCore, s.store, s.agentRoomCapabilities, s.agentRoomDispatcher)
	}
	server := &http.Server{
		Addr:              address,
		Handler:           admin.NewHandlerWithAgentRoom(s, s.options.AdminToken, roomRoutes),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	s.mu.Lock()
	s.listener = listener
	s.server = server
	s.startedAt = time.Now().Format(time.RFC3339)
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
	if s.options.AgentRoomEnabled && s.serverAdapter != nil {
		observerCtx, observerCancel := context.WithCancel(context.Background())
		observer := agentroom.NewObserverCoordinator(s.store, s.serverAdapter, 300*time.Millisecond)
		observer.SetRunTerminalHandler(s.agentRoomDispatcher.HandleTerminalRun)
		done := make(chan struct{})
		s.mu.Lock()
		s.agentRoomObserver, s.observerCancel, s.observerDone = observer, observerCancel, done
		s.mu.Unlock()
		go func() {
			defer close(done)
			if err := observer.Run(observerCtx); err != nil && observerCtx.Err() == nil {
				s.logger.Printf("agent room observer stopped: %v", err)
			}
		}()
	}
	return nil
}

func (s *Service) Shutdown(ctx context.Context) error {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()

	s.mu.Lock()
	if s.state == domain.BridgeStateStopped {
		s.mu.Unlock()
		return nil
	}
	s.state = domain.BridgeStateStopping
	server := s.server
	adapterCancel := s.adapterCancel
	observerCancel := s.observerCancel
	observerDone := s.observerDone
	adapters := append([]managedAdapter(nil), s.adapters...)
	s.mu.Unlock()
	if observerCancel != nil {
		observerCancel()
	}
	if observerDone != nil {
		select {
		case <-observerDone:
		case <-ctx.Done():
			s.setState(domain.BridgeStateDegraded, "transient_network", ctx.Err().Error())
			return ctx.Err()
		}
	}

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
	s.observerCancel = nil
	s.observerDone = nil
	s.agentRoomObserver = nil
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
	channels = s.decorateStatuses(channels)
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
	agentRoomStatus := domain.AgentRoomStatus{Enabled: s.options.AgentRoomEnabled, Core: "disabled", Observer: "disabled"}
	if s.options.AgentRoomEnabled {
		agentRoomStatus.Core = "running"
		agentRoomStatus.Observer = "not_running"
		s.mu.RLock()
		observer := s.agentRoomObserver
		s.mu.RUnlock()
		if observer != nil && observer.Available() {
			agentRoomStatus.Observer = "running"
		}
		agentRoomStatus.ActiveRuns, agentRoomStatus.QueueDepth, agentRoomStatus.ObservedSessions, err = s.store.AgentRoomSummaryCounts(ctx)
		if err != nil {
			agentRoomStatus.Core = "degraded"
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "status_snapshot_failed")
		}
		if agentRoomStatus.DatabaseVersion, err = s.store.UserVersion(ctx); err != nil {
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "database_status_unavailable")
		}
		if leases, leaseErr := s.store.ListActiveSessionLeases(ctx, time.Now()); leaseErr != nil {
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "lease_status_unavailable")
		} else {
			agentRoomStatus.ActiveLeases = len(leases)
		}
		if approvals, approvalErr := s.store.ListApprovals(ctx, "pending"); approvalErr != nil {
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "approval_status_unavailable")
		} else {
			for _, approval := range approvals {
				if approval.OriginKind == "agent_room" || approval.Platform == "agent_room" {
					agentRoomStatus.PendingApprovals++
				}
			}
		}
		if agentRoomStatus.PaneGeneration, err = s.store.GetPaneObservationGeneration(ctx); err != nil {
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "pane_status_unavailable")
		}
		locator := inspectRuntimeLocator(s.options.KimiRuntimeLocatorPath)
		if s.providerName != "server" {
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "server_provider_required")
		} else if !locator.Readable || locator.Health != "ready" {
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "runtime_unavailable")
		}
		if agentRoomStatus.Observer != "running" {
			agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "observer_not_running")
		}
		agentRoomStatus.Degradations = append(agentRoomStatus.Degradations, "abort_unconfirmed")
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

	locatorStatus := inspectRuntimeLocator(s.options.KimiRuntimeLocatorPath)
	return domain.BridgeStatus{
		State:              state,
		StartedAt:          startedAt,
		PID:                os.Getpid(),
		AdminPort:          s.options.AdminPort,
		Version:            s.options.Version,
		KimiRuntimeLocator: locatorStatus,
		RuntimeAdapter:     runtimeAdapterStatus(locatorStatus),
		AgentRoom:          agentRoomStatus,
		Channels:           channels,
		PendingApprovals:   pendingApprovals,
		Bindings:           bindings,
		LastErrorCode:      lastErrorCode,
		LastError:          lastError,
	}, nil
}

func (s *Service) agentRoomCapabilities(context.Context) admin.AgentRoomCapabilitySnapshot {
	locator := inspectRuntimeLocator(s.options.KimiRuntimeLocatorPath)
	serverReady := s.options.AgentRoomEnabled && s.providerName == "server" && locator.Readable && locator.Health == "ready"
	s.mu.RLock()
	observerRunning := s.agentRoomObserver != nil && s.agentRoomObserver.Available()
	s.mu.RUnlock()
	result := admin.AgentRoomCapabilitySnapshot{
		RuntimeProvider:         s.providerName,
		Core:                    s.options.AgentRoomEnabled,
		Observer:                observerRunning,
		MultiSessionObservation: observerRunning,
		UserPromptEvents:        observerRunning,
		SessionTranscript:       serverReady,
		Abort:                   false,
		Approval:                serverReady,
		NativeFollowUp:          false,
	}
	if s.providerName != "server" {
		result.Degradations = append(result.Degradations, "server_provider_required")
	} else if !serverReady {
		result.Degradations = append(result.Degradations, "runtime_unavailable")
	}
	if !observerRunning {
		result.Degradations = append(result.Degradations, "observer_not_running")
	}
	result.Degradations = append(result.Degradations, "abort_unconfirmed")
	return result
}

func inspectRuntimeLocator(path string) domain.RuntimeLocatorStatus {
	path = strings.TrimSpace(path)
	if path == "" {
		return domain.RuntimeLocatorStatus{}
	}
	status := domain.RuntimeLocatorStatus{
		Configured: true,
		Path:       path,
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		status.LastError = fmt.Sprintf("read locator: %v", err)
		return status
	}
	var payload struct {
		Health string `json:"health"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		status.LastError = fmt.Sprintf("decode locator: %v", err)
		return status
	}
	status.Readable = true
	status.Health = strings.TrimSpace(payload.Health)
	return status
}

func runtimeAdapterStatus(locator domain.RuntimeLocatorStatus) domain.RuntimeAdapterStatus {
	status := domain.RuntimeAdapterStatus{
		Name:  "server",
		State: "unavailable",
	}
	if !locator.Configured {
		return status
	}
	if locator.LastError != "" {
		status.State = "degraded"
		status.LastError = locator.LastError
		return status
	}
	if locator.Readable && locator.Health == "ready" {
		status.State = "ready"
		return status
	}
	status.State = "degraded"
	if locator.Health != "" {
		status.LastError = fmt.Sprintf("runtime health is %s", locator.Health)
	}
	return status
}

func (s *Service) fallbackChannelStatuses(state domain.BridgeRuntimeState) []domain.ChannelStatus {
	connectors := configuredConnectors(s.settings)
	statuses := make([]domain.ChannelStatus, 0, len(connectors))
	for _, channel := range connectors {
		statuses = append(statuses, domain.ChannelStatus{
			ConnectorID:    channel.ID,
			ConnectorLabel: channel.Label,
			Platform:       channel.Platform,
			Enabled:        channel.Enabled,
			State:          fallbackChannelState(channel.Enabled, state),
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
	items, err := s.store.ListBindings(ctx)
	if err != nil {
		return nil, err
	}
	return s.decorateBindingRecords(items), nil
}

func (s *Service) ListSessions(ctx context.Context) ([]domain.BridgeSession, error) {
	return s.store.ListSessions(ctx)
}

func (s *Service) ListApprovals(ctx context.Context, status string) ([]domain.ApprovalTicket, error) {
	items, err := s.store.ListApprovals(ctx, status)
	if err != nil {
		return nil, err
	}
	return s.decorateApprovals(items), nil
}

func (s *Service) ClearBinding(ctx context.Context, bindingID string) error {
	if err := s.store.ClearBinding(ctx, bindingID); err != nil {
		return err
	}
	s.logger.Printf("binding cleared: %s", bindingID)
	return nil
}

func (s *Service) UpdateBinding(ctx context.Context, bindingID string, input domain.BindingUpdate) (domain.BindingRecord, error) {
	if strings.TrimSpace(bindingID) == "" {
		return domain.BindingRecord{}, fmt.Errorf("binding id is required")
	}

	workDirWasSet := input.WorkDir != nil
	workDirValue := ""
	if input.WorkDir != nil {
		workDirValue = strings.TrimSpace(*input.WorkDir)
	}

	if strings.TrimSpace(input.KimiSessionID) == "" && !workDirWasSet {
		return domain.BindingRecord{}, fmt.Errorf("binding update requires kimiSessionId or workDir")
	}

	if sessionID := strings.TrimSpace(input.KimiSessionID); sessionID != "" {
		if err := s.bindings.Rebind(ctx, bindingID, sessionID); err != nil {
			return domain.BindingRecord{}, err
		}
		s.logger.Printf("binding rebound: %s -> %s", bindingID, sessionID)
	}
	if workDirWasSet {
		if err := s.bindings.UpdateBindingWorkDir(ctx, bindingID, workDirValue); err != nil {
			return domain.BindingRecord{}, err
		}
		s.logger.Printf("binding workdir updated: %s -> %q", bindingID, workDirValue)
	}

	record, err := s.bindingRecordByID(ctx, bindingID)
	if err != nil {
		return domain.BindingRecord{}, err
	}
	if record == nil {
		return domain.BindingRecord{}, fmt.Errorf("binding %s not found after update", bindingID)
	}
	return *record, nil
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

	for _, channel := range configuredConnectors(s.settings) {
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
		if redeliverer, ok := adapter.(recoveredApprovalRedeliverer); ok {
			count, err := redeliverer.RedeliverPendingApprovals(adapterCtx)
			if err != nil {
				s.logger.Printf("bridge recovered approval redelivery failed: adapter=%s err=%v", adapter.Name(), err)
			} else if count > 0 {
				s.logger.Printf("bridge recovered approval redelivery queued: adapter=%s count=%d", adapter.Name(), count)
			}
		}
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

func (s *Service) buildAdapter(channel config.ConnectorConfig) (managedAdapter, error) {
	defaultWorkDir := connectorWorkDir(channel, "")
	switch strings.TrimSpace(strings.ToLower(channel.Platform)) {
	case "telegram":
		return telegramplatform.NewService(telegramplatform.Options{
			Config: telegramplatform.Config{
				ConnectorID:    channel.ID,
				ConnectorLabel: channel.Label,
				BotToken:       secretTelegramBotToken(s.secrets, channel.ID),
				DefaultWorkDir: defaultWorkDir,
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
				ConnectorID:           channel.ID,
				ConnectorLabel:        channel.Label,
				AppID:                 secretFeishuAppID(s.secrets, channel.ID),
				AppSecret:             secretFeishuAppSecret(s.secrets, channel.ID),
				VerificationToken:     secretFeishuVerificationToken(s.secrets, channel.ID),
				EncryptKey:            secretFeishuEncryptKey(s.secrets, channel.ID),
				AutoApprove:           channel.FeishuAutoApprove,
				DefaultWorkDir:        defaultWorkDir,
				WorkDirPresets:        mapFeishuWorkDirPresets(s.settings.WorkDirPresets),
				ReplyRenderer:         channel.FeishuReplyRenderer,
				AttachmentsDir:        filepath.Join(filepath.Dir(s.options.DBPath), "attachments", channel.ID),
				BridgeOpsSkillEnabled: strings.TrimSpace(s.options.SkillsDir) != "",
				BridgeOpsAuthFile:     s.skillsAuthFilePath,
			},
			BindingRouter: s.bindings,
			Orchestrator:  s.orchestrator,
			HostControl:   hostControl,
			Store:         s.store,
			Logger:        s.logger,
		}), nil
	case "weixin":
		return weixinplatform.NewService(weixinplatform.Options{
			Config: weixinplatform.Config{
				ConnectorID:    channel.ID,
				ConnectorLabel: channel.Label,
				BotToken:       secretWeixinBotToken(s.secrets, channel.ID),
				BaseURL:        secretWeixinBaseURL(s.secrets, channel.ID),
				AccountID:      secretWeixinAccountID(s.secrets, channel.ID),
				OwnerUserID:    secretWeixinOwnerUserID(s.secrets, channel.ID),
				DefaultWorkDir: defaultWorkDir,
				ReplyMode:      channel.WeixinReplyMode,
			},
			BindingRouter: s.bindings,
			Orchestrator:  s.orchestrator,
			Store:         s.store,
			Logger:        s.logger,
		}), nil
	default:
		if err := s.store.UpdateChannelState(
			context.Background(),
			channel.ID,
			domain.ChannelStateError,
			"unknown",
			fmt.Sprintf("unsupported adapter platform %q", channel.Platform),
		); err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("unsupported adapter platform %q", channel.Platform)
	}
}

func secretTelegramBotToken(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Telegram == nil {
		return ""
	}
	return strings.TrimSpace(connector.Telegram.BotToken)
}

func secretFeishuAppID(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Feishu == nil {
		return ""
	}
	return strings.TrimSpace(connector.Feishu.AppID)
}

func secretFeishuAppSecret(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Feishu == nil {
		return ""
	}
	return strings.TrimSpace(connector.Feishu.AppSecret)
}

func secretFeishuVerificationToken(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Feishu == nil {
		return ""
	}
	return strings.TrimSpace(connector.Feishu.VerificationToken)
}

func secretFeishuEncryptKey(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Feishu == nil {
		return ""
	}
	return strings.TrimSpace(connector.Feishu.EncryptKey)
}

func secretWeixinBotToken(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Weixin == nil {
		return ""
	}
	return strings.TrimSpace(connector.Weixin.BotToken)
}

func secretWeixinBaseURL(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Weixin == nil {
		return ""
	}
	return strings.TrimSpace(connector.Weixin.BaseURL)
}

func secretWeixinAccountID(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Weixin == nil {
		return ""
	}
	return strings.TrimSpace(connector.Weixin.AccountID)
}

func secretWeixinOwnerUserID(secrets config.BridgeSecrets, connectorID string) string {
	connector, ok := secrets.Connectors[connectorID]
	if !ok || connector.Weixin == nil {
		return ""
	}
	return strings.TrimSpace(connector.Weixin.OwnerUserID)
}

func registerLoggerSecrets(logger *logging.Logger, options Options, secrets config.BridgeSecrets) {
	if logger == nil {
		return
	}
	logger.RegisterSecrets(options.AdminToken, options.HostControlToken)
	if secrets.Telegram != nil {
		logger.RegisterSecret(secrets.Telegram.BotToken)
	}
	if secrets.Feishu != nil {
		logger.RegisterSecrets(
			secrets.Feishu.AppSecret,
			secrets.Feishu.VerificationToken,
			secrets.Feishu.EncryptKey,
		)
	}
	if secrets.Weixin != nil {
		logger.RegisterSecret(secrets.Weixin.BotToken)
	}
	for _, connector := range secrets.Connectors {
		if connector.Telegram != nil {
			logger.RegisterSecret(connector.Telegram.BotToken)
		}
		if connector.Feishu != nil {
			logger.RegisterSecrets(
				connector.Feishu.AppSecret,
				connector.Feishu.VerificationToken,
				connector.Feishu.EncryptKey,
			)
		}
		if connector.Weixin != nil {
			logger.RegisterSecret(connector.Weixin.BotToken)
		}
	}
}

func (s *Service) decorateBindingRecords(items []domain.BindingRecord) []domain.BindingRecord {
	if len(items) == 0 {
		return items
	}
	labels := s.connectorLabels()
	for index := range items {
		items[index].ConnectorLabel = labels[items[index].ConnectorID]
	}
	return items
}

func (s *Service) bindingRecordByID(ctx context.Context, bindingID string) (*domain.BindingRecord, error) {
	binding, err := s.store.GetBindingByID(ctx, bindingID)
	if err != nil {
		return nil, err
	}
	if binding == nil {
		return nil, nil
	}
	record := domain.BindingRecord{
		BindingID:            binding.BindingID,
		ConnectorID:          binding.Key.ConnectorID,
		Platform:             binding.Key.Platform,
		AccountID:            binding.Key.AccountID,
		ChatID:               binding.Key.ChatID,
		ThreadID:             binding.Key.ThreadID,
		KimiSessionID:        binding.KimiSessionID,
		WorkDir:              binding.WorkDir,
		OnboardedAt:          binding.OnboardedAt,
		OnboardingVersion:    binding.OnboardingVersion,
		CreatedAt:            binding.CreatedAt,
		UpdatedAt:            binding.UpdatedAt,
		LastInboundMessageID: binding.LastInboundMessageID,
	}
	decorated := s.decorateBindingRecords([]domain.BindingRecord{record})
	return &decorated[0], nil
}

func (s *Service) decorateApprovals(items []domain.ApprovalTicket) []domain.ApprovalTicket {
	if len(items) == 0 {
		return items
	}
	labels := s.connectorLabels()
	for index := range items {
		items[index].ConnectorLabel = labels[items[index].ConnectorID]
	}
	return items
}

func (s *Service) decorateStatuses(items []domain.ChannelStatus) []domain.ChannelStatus {
	if len(items) == 0 {
		return items
	}
	labels := s.connectorLabels()
	for index := range items {
		items[index].ConnectorLabel = labels[items[index].ConnectorID]
	}
	return items
}

func (s *Service) connectorLabels() map[string]string {
	connectors := configuredConnectors(s.settings)
	labels := make(map[string]string, len(connectors))
	for _, connector := range connectors {
		labels[connector.ID] = connector.Label
	}
	return labels
}

func configuredConnectors(settings config.BridgeSettings) []config.ConnectorConfig {
	if len(settings.Connectors) > 0 {
		return settings.Connectors
	}
	if len(settings.Channels) > 0 {
		return settings.Channels
	}
	return nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func connectorWorkDir(connector config.ConnectorConfig, fallback string) string {
	return strings.TrimSpace(firstNonEmpty(connector.DefaultWorkDir, fallback))
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
