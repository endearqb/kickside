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
	if command, key, ok := parseBridgeCommand(event); ok {
		if err := s.handleBridgeCommand(ctx, event, key, command); err != nil {
			return false, err
		}
		return true, nil
	}

	inbound, key, ok := mapMessageToInbound(event)
	if !ok {
		return true, nil
	}
	if err := s.store.TouchChannelInbound(ctx, platformID, inbound.ReceivedAt); err != nil {
		return false, reliability.Wrap("unknown", err)
	}
	if strings.TrimSpace(inbound.Text) == "" && len(inbound.Attachments) > 0 {
		if err := s.cacheInboundAttachments(ctx, inbound); err != nil {
			return false, err
		}
		return true, nil
	}

	pendingAttachments, pendingAttachmentIDs, err := s.loadPendingPromptAttachments(ctx, key.ChatID, key.ThreadID)
	if err != nil {
		return false, err
	}

	binding, _, err := s.resolveOrCreateBindingWithState(ctx, key)
	if err != nil {
		return false, err
	}
	s.maybeSendAutoOnboarding(ctx, event, key, binding)

	if s.orchestrator != nil {
		result, err := s.orchestrator.HandleInbound(ctx, adapterkit.FromDomainInbound(inbound, key), bridgecore.HandleOptions{
			DefaultWorkDir: strings.TrimSpace(s.config.DefaultWorkDir),
			AutoApprove:    s.config.AutoApprove,
			Attachments:    pendingAttachments,
		}, func(turnEvent bridgecore.TurnEvent) error {
			if turnEvent.Kind == bridgecore.EventApprovalRequested {
				return s.sendApprovalMessageBridge(ctx, event, turnEvent)
			}
			return nil
		})
		if err != nil {
			return false, err
		}
		if len(pendingAttachmentIDs) > 0 {
			if err := s.store.DeletePendingInboundAttachments(ctx, pendingAttachmentIDs); err != nil {
				return false, reliability.Wrap("unknown", err)
			}
		}
		if strings.TrimSpace(result.ReplyText) == "" {
			if err := s.sendArtifacts(ctx, event, result.Artifacts); err != nil {
				return false, err
			}
			return true, nil
		}
		if err := s.sendReplyBundle(ctx, event, result.Binding, result.ReplyText, result.Artifacts); err != nil {
			return false, err
		}
		return true, nil
	}

	prompt := runtime.PromptRequest{
		Prompt:      inbound.Text,
		WorkDir:     binding.WorkDir,
		AutoApprove: s.config.AutoApprove,
		Attachments: pendingAttachments,
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
	if len(pendingAttachmentIDs) > 0 {
		if err := s.store.DeletePendingInboundAttachments(ctx, pendingAttachmentIDs); err != nil {
			return false, reliability.Wrap("unknown", err)
		}
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
	binding, _, err := s.resolveOrCreateBindingWithState(ctx, key)
	return binding, err
}

func (s *Service) resolveOrCreateBindingWithState(ctx context.Context, key domain.BindingKey) (*domain.SessionBinding, bool, error) {
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, false, reliability.Wrap("unknown", err)
	}
	if binding != nil {
		if binding.WorkDir == "" {
			binding.WorkDir = strings.TrimSpace(s.config.DefaultWorkDir)
		}
		return binding, false, nil
	}

	created, err := s.bindings.CreateBinding(ctx, key, uuid.NewString(), strings.TrimSpace(s.config.DefaultWorkDir), "auto")
	if err != nil {
		return nil, false, reliability.Wrap("unknown", err)
	}
	return created, true, nil
}

func (s *Service) maybeSendAutoOnboarding(ctx context.Context, event *MessageEvent, key domain.BindingKey, binding *domain.SessionBinding) {
	if event == nil || binding == nil {
		return
	}
	if !strings.EqualFold(strings.TrimSpace(event.ChatType), "p2p") {
		return
	}
	if !bindingNeedsOnboarding(binding) {
		return
	}
	if !bridgeEntryPointsExposed {
		if err := s.bindings.UpdateBindingOnboarding(ctx, binding.BindingID, currentOnboardingVersion); err != nil {
			s.logf("feishu onboarding hide-mark failed binding=%s err=%q", binding.BindingID, err.Error())
			return
		}
		binding.OnboardedAt = time.Now().UTC().Format(time.RFC3339)
		binding.OnboardingVersion = currentOnboardingVersion
		return
	}

	card, shouldMark, err := s.loadOnboardingCard(ctx, key, binding)
	if err != nil {
		s.logf("feishu onboarding build failed chat=%s thread=%s err=%q", key.ChatID, key.ThreadID, err.Error())
		return
	}
	content, err := marshalJSON(card)
	if err != nil {
		s.logf("feishu onboarding payload failed chat=%s thread=%s err=%q", key.ChatID, key.ThreadID, err.Error())
		return
	}
	if err := s.sendRecordedMessage(ctx, SendMessageRequest{
		ReplyToMessageID: event.MessageID,
		ChatID:           event.ChatID,
		MessageType:      "interactive",
		Content:          content,
		UUID:             uuid.NewString(),
	}, fmt.Sprintf("feishu:%s:%s:onboarding:%s", event.ChatID, event.MessageID, currentOnboardingVersion), event.MessageID); err != nil {
		s.logf("feishu onboarding send failed chat=%s thread=%s err=%q", key.ChatID, key.ThreadID, err.Error())
		return
	}
	if shouldMark {
		if err := s.bindings.UpdateBindingOnboarding(ctx, binding.BindingID, currentOnboardingVersion); err != nil {
			s.logf("feishu onboarding mark failed binding=%s err=%q", binding.BindingID, err.Error())
			return
		}
		binding.OnboardedAt = time.Now().UTC().Format(time.RFC3339)
		binding.OnboardingVersion = currentOnboardingVersion
	}
}

func (s *Service) loadOnboardingCard(ctx context.Context, key domain.BindingKey, binding *domain.SessionBinding) (map[string]any, bool, error) {
	var session *domain.BridgeSession
	var err error
	if binding != nil && strings.TrimSpace(binding.KimiSessionID) != "" {
		session, err = s.store.GetSessionByID(ctx, binding.KimiSessionID)
		if err != nil {
			return nil, false, reliability.Wrap("unknown", err)
		}
	}
	return buildOnboardingCard(binding, session, strings.TrimSpace(s.config.DefaultWorkDir), s.config.WorkDirPresets, key), binding != nil && bindingNeedsOnboarding(binding), nil
}

func (s *Service) collectDoctorReport(ctx context.Context, key domain.BindingKey) (doctorReport, error) {
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return doctorReport{}, reliability.Wrap("unknown", err)
	}
	var session *domain.BridgeSession
	if binding != nil && strings.TrimSpace(binding.KimiSessionID) != "" {
		session, err = s.store.GetSessionByID(ctx, binding.KimiSessionID)
		if err != nil {
			return doctorReport{}, reliability.Wrap("unknown", err)
		}
	}

	channelStatuses, err := s.store.ListChannelStatuses(ctx)
	if err != nil {
		return doctorReport{}, reliability.Wrap("unknown", err)
	}
	var feishuStatus *domain.ChannelStatus
	for index := range channelStatuses {
		if strings.EqualFold(strings.TrimSpace(channelStatuses[index].Platform), platformID) {
			status := channelStatuses[index]
			feishuStatus = &status
			break
		}
	}

	pendingApprovals := 0
	items, err := s.store.ListApprovals(ctx, "pending")
	if err != nil {
		return doctorReport{}, reliability.Wrap("unknown", err)
	}
	pendingApprovals = len(filterApprovalsForContext(items, key.ChatID, key.ThreadID))

	probeStatus := "ok"
	probeError := ""
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := s.gateway.ProbeCredentials(probeCtx); err != nil {
		probeStatus = "failed"
		probeError = strings.TrimSpace(err.Error())
	}

	effectiveWorkDir := strings.TrimSpace(s.config.DefaultWorkDir)
	if binding != nil && strings.TrimSpace(binding.WorkDir) != "" {
		effectiveWorkDir = strings.TrimSpace(binding.WorkDir)
	} else if session != nil && strings.TrimSpace(session.WorkDir) != "" {
		effectiveWorkDir = strings.TrimSpace(session.WorkDir)
	}
	activePresetName, activePresetPath := findPresetForPath(s.config.WorkDirPresets, effectiveWorkDir)

	report := doctorReport{
		BridgeState:      deriveBridgeState(feishuStatus),
		Channel:          feishuStatus,
		Binding:          binding,
		Session:          session,
		ActivePresetName: activePresetName,
		ActivePresetPath: activePresetPath,
		EffectiveWorkDir: effectiveWorkDir,
		PendingApprovals: pendingApprovals,
		ProbeStatus:      probeStatus,
		ProbeError:       probeError,
	}
	report.NextSteps = doctorNextSteps(report)
	return report, nil
}

func (s *Service) buildPanelCard(ctx context.Context, key domain.BindingKey, panel string, showDetails bool) (map[string]any, bool, error) {
	if !bridgeEntryPointsExposed {
		return buildBridgeEntryHiddenCard(), false, nil
	}
	switch strings.TrimSpace(panel) {
	case "", bridgePanelHelp:
		return buildBridgeHelpCard(key), false, nil
	case bridgePanelStart:
		binding, err := s.bindings.ResolveBinding(ctx, key)
		if err != nil {
			return nil, false, reliability.Wrap("unknown", err)
		}
		card, shouldMark, err := s.loadOnboardingCard(ctx, key, binding)
		return card, shouldMark, err
	case bridgePanelSessions:
		sessions, err := s.store.ListSessions(ctx)
		if err != nil {
			return nil, false, reliability.Wrap("unknown", err)
		}
		binding, err := s.bindings.ResolveBinding(ctx, key)
		if err != nil {
			return nil, false, reliability.Wrap("unknown", err)
		}
		return buildSessionsCard(binding, sessions, key), false, nil
	case bridgePanelCwd:
		binding, err := s.bindings.ResolveBinding(ctx, key)
		if err != nil {
			return nil, false, reliability.Wrap("unknown", err)
		}
		return buildWorkDirCard(binding, strings.TrimSpace(s.config.DefaultWorkDir), s.config.WorkDirPresets, key), false, nil
	case bridgePanelApprovals:
		items, err := s.store.ListApprovals(ctx, "pending")
		if err != nil {
			return nil, false, reliability.Wrap("unknown", err)
		}
		return buildApprovalsOverviewCard(filterApprovalsForContext(items, key.ChatID, key.ThreadID), key), false, nil
	case bridgePanelDoctor:
		report, err := s.collectDoctorReport(ctx, key)
		if err != nil {
			return nil, false, err
		}
		return buildDoctorCard(report, key, showDetails), false, nil
	default:
		return buildErrorCard("Unsupported panel", "Try `/bridge help` to reopen the available bridge panels."), false, nil
	}
}

func bindingNeedsOnboarding(binding *domain.SessionBinding) bool {
	if binding == nil {
		return false
	}
	return strings.TrimSpace(binding.OnboardedAt) == "" || strings.TrimSpace(binding.OnboardingVersion) != currentOnboardingVersion
}

func deriveBridgeState(channel *domain.ChannelStatus) string {
	if channel == nil {
		return string(domain.BridgeStateRunning)
	}
	switch channel.State {
	case domain.ChannelStateError, domain.ChannelStateDegraded:
		return string(domain.BridgeStateDegraded)
	case domain.ChannelStateConnecting:
		return string(domain.BridgeStateStarting)
	default:
		return string(domain.BridgeStateRunning)
	}
}

func doctorNextSteps(report doctorReport) []string {
	steps := []string{}
	if report.Binding == nil {
		steps = append(steps, "Send a normal prompt or choose a session to create a binding for this chat.")
	}
	if report.ProbeStatus == "failed" {
		steps = append(steps, "Re-check Feishu app credentials and long-connection settings in Control Center.")
	}
	if report.Channel != nil && report.Channel.State != domain.ChannelStateReady {
		steps = append(steps, "Wait for the Feishu channel to become ready, or review the latest bridge diagnostics in Control Center.")
	}
	if report.PendingApprovals > 0 {
		steps = append(steps, "Open approvals and resolve the pending requests before retrying blocked turns.")
	}
	if len(steps) == 0 {
		steps = append(steps, "Bridge looks healthy for this chat. Use Sessions or Workdir if you want to change context.")
	}
	return steps
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
