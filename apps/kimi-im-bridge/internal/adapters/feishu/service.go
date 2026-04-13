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
	hostControl  HostController
	store        ChannelStore
	logger       Logger
	delivery     *reliability.Executor

	mu                sync.RWMutex
	started           bool
	done              chan struct{}
	currentCheckpoint string
	lastReadyAt       string
	consecutiveFails  int
	recoveryPending   bool
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
		hostControl:  options.HostControl,
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
	if value := strings.TrimSpace(s.config.ConnectorLabel); value != "" {
		return value
	}
	if value := strings.TrimSpace(s.config.ConnectorID); value != "" {
		return value
	}
	return platformID
}

func (s *Service) Done() <-chan struct{} {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.done
}

func (s *Service) Start(ctx context.Context) error {
	if strings.TrimSpace(s.config.AppID) == "" || strings.TrimSpace(s.config.AppSecret) == "" {
		return s.failStart(ctx, "start", "invalid_credentials", fmt.Errorf("feishu appId/appSecret are required"))
	}
	if s.gateway == nil {
		return s.failStart(ctx, "start", "invalid_credentials", fmt.Errorf("feishu gateway is not configured"))
	}
	if s.bindings == nil || (s.runtime == nil && s.orchestrator == nil) || s.store == nil {
		return s.failStart(ctx, "start", "unknown", fmt.Errorf("feishu adapter dependencies are incomplete"))
	}

	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return nil
	}
	s.started = true
	s.done = make(chan struct{})
	s.mu.Unlock()

	if err := s.store.UpdateChannelState(ctx, s.connectorID(), domain.ChannelStateConnecting, "", ""); err != nil {
		return s.abortStart(err)
	}
	s.logConnectionOpening("credential_probe", 1)
	if err := s.gateway.ProbeCredentials(ctx); err != nil {
		code := classifyFeishuError(err).Code
		if code == "" {
			code = "unknown"
		}
		return s.failAfterStart(ctx, "credential_probe", code, err)
	}

	checkpoint, err := s.loadCheckpoint(ctx)
	if err != nil {
		return s.failAfterStart(ctx, "load_checkpoint", "unknown", err)
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
	attempt := 1
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		s.logConnectionOpening("long_connection", attempt)
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
		s.recordConnectionFailure(context.Background(), "long_connection", classification, err, state, attempt, backoffNext)
		if state == domain.ChannelStateError || !reliability.SleepContext(ctx, backoff) {
			return
		}
		backoff = nextBackoff(backoff)
		attempt++
	}
}

func (s *Service) OnReady(ctx context.Context) {
	now := time.Now().UTC().Format(time.RFC3339)
	zero := 0
	clearRetryAt := ""
	hadRecovery, previousFailures, lastReadyAt := s.markReady(now)
	update := domain.ChannelDiagnosticsUpdate{
		State:               domain.ChannelStateReady,
		LastErrorCode:       "",
		LastError:           "",
		LastReadyAt:         &now,
		ConsecutiveFailures: &zero,
		NextRetryAt:         &clearRetryAt,
	}
	if hadRecovery {
		update.LastRecoveryAt = &now
		s.logf(
			"feishu connection recovered platform=%s operation=long_connection attempt=%d lastReadyAt=%s",
			platformID,
			previousFailures,
			logValue(lastReadyAt),
		)
	}
	_ = s.store.UpdateChannelDiagnostics(ctx, s.connectorID(), update)
	s.logf(
		"feishu connection ready platform=%s operation=long_connection attempt=1 lastReadyAt=%s",
		platformID,
		now,
	)
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
		key.ConnectorID = s.connectorID()
		if err := s.handleBridgeCommand(ctx, event, key, command); err != nil {
			return false, err
		}
		return true, nil
	}

	inbound, key, ok := mapMessageToInbound(event)
	if !ok {
		return true, nil
	}
	inbound.ConnectorID = s.connectorID()
	key.ConnectorID = s.connectorID()
	if err := s.store.TouchChannelInbound(ctx, s.connectorID(), inbound.ReceivedAt); err != nil {
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
		contextualizedPrompt := s.applyBridgeSkillPromptContext(inbound.Text, *binding)
		inbound.Text = contextualizedPrompt
		var streamer *feishuReplyStreamer
		if s.streamingRepliesEnabled() {
			streamer = s.newReplyStreamer(event, *binding, nil)
		}
		result, err := s.orchestrator.HandleInbound(ctx, adapterkit.FromDomainInbound(inbound, key), bridgecore.HandleOptions{
			DefaultWorkDir: strings.TrimSpace(s.config.DefaultWorkDir),
			AutoApprove:    s.config.AutoApprove,
			Attachments:    pendingAttachments,
		}, func(turnEvent bridgecore.TurnEvent) error {
			if turnEvent.Kind == bridgecore.EventApprovalRequested {
				return s.sendApprovalMessageBridge(ctx, event, turnEvent)
			}
			if streamer != nil {
				streamer.handleBridgeEvent(ctx, turnEvent)
			}
			return nil
		})
		if err != nil {
			if streamer != nil {
				if handledErr := streamer.handleFailure(ctx, err); handledErr == nil {
					if len(pendingAttachmentIDs) > 0 {
						_ = s.store.DeletePendingInboundAttachments(ctx, pendingAttachmentIDs)
					}
					return true, nil
				}
			}
			return false, err
		}
		if len(pendingAttachmentIDs) > 0 {
			if err := s.store.DeletePendingInboundAttachments(ctx, pendingAttachmentIDs); err != nil {
				return false, reliability.Wrap("unknown", err)
			}
		}
		if streamer != nil {
			streamer.artifacts = append(streamer.artifacts, result.Artifacts...)
			if err := streamer.finish(ctx, result.ReplyText); err != nil {
				return false, err
			}
			return true, nil
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
		Prompt:      s.applyBridgeSkillPromptContext(inbound.Text, *binding),
		WorkDir:     binding.WorkDir,
		AutoApprove: s.config.AutoApprove,
		Attachments: pendingAttachments,
	}
	if prompt.WorkDir == "" {
		prompt.WorkDir = strings.TrimSpace(s.config.DefaultWorkDir)
	}

	var (
		content  strings.Builder
		streamer *feishuReplyStreamer
	)
	if s.streamingRepliesEnabled() {
		streamer = s.newReplyStreamer(event, *binding, nil)
	}
	response, err := s.runtime.ExecuteBindingPrompt(ctx, *binding, prompt, func(promptEvent runtime.PromptEvent) error {
		switch promptEvent.Type {
		case runtime.EventTypeContentDelta:
			if promptEvent.Text != "" {
				content.WriteString(promptEvent.Text)
			}
			if streamer != nil {
				streamer.handleRuntimeEvent(ctx, promptEvent)
			}
		case runtime.EventTypeStatusUpdate:
			if streamer != nil {
				streamer.handleRuntimeEvent(ctx, promptEvent)
			}
		case runtime.EventTypeApprovalRequested:
			return s.sendApprovalMessage(ctx, event, *binding, promptEvent)
		}
		return nil
	})
	if err != nil {
		if streamer != nil {
			if handledErr := streamer.handleFailure(ctx, err); handledErr == nil {
				if len(pendingAttachmentIDs) > 0 {
					_ = s.store.DeletePendingInboundAttachments(ctx, pendingAttachmentIDs)
				}
				return true, nil
			}
		}
		return false, err
	}
	if len(pendingAttachmentIDs) > 0 {
		if err := s.store.DeletePendingInboundAttachments(ctx, pendingAttachmentIDs); err != nil {
			return false, reliability.Wrap("unknown", err)
		}
	}
	if response.Result.Error != "" {
		err := reliability.Wrap(
			"delivery_failed",
			fmt.Errorf("feishu runtime turn failed: %s", response.Result.Error),
		)
		if streamer != nil {
			if handledErr := streamer.handleFailure(ctx, err); handledErr == nil {
				return true, nil
			}
		}
		return false, reliability.Wrap(
			"delivery_failed",
			fmt.Errorf("feishu runtime turn failed: %s", response.Result.Error),
		)
	}

	finalText := strings.TrimSpace(content.String())
	if streamer != nil {
		if err := streamer.finish(ctx, finalText); err != nil {
			return false, err
		}
		return true, nil
	}
	if finalText == "" {
		return true, nil
	}
	if err := s.sendReply(ctx, event, *binding, finalText); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) applyBridgeSkillPromptContext(prompt string, binding domain.SessionBinding) string {
	if !s.config.BridgeOpsSkillEnabled {
		return prompt
	}

	lines := []string{
		"[bridge_context]",
		fmt.Sprintf("platform=%s", strings.TrimSpace(binding.Key.Platform)),
		fmt.Sprintf("chat_id=%s", strings.TrimSpace(binding.Key.ChatID)),
		fmt.Sprintf("thread_id=%s", strings.TrimSpace(binding.Key.ThreadID)),
		fmt.Sprintf("binding_id=%s", strings.TrimSpace(binding.BindingID)),
		fmt.Sprintf("current_session_id=%s", strings.TrimSpace(binding.KimiSessionID)),
		fmt.Sprintf("current_workdir=%s", strings.TrimSpace(binding.WorkDir)),
	}
	if authFile := strings.TrimSpace(s.config.BridgeOpsAuthFile); authFile != "" {
		lines = append(lines, fmt.Sprintf("bridge_auth_file=%s", authFile))
	}
	lines = append(lines,
		"[/bridge_context]",
		"",
		strings.TrimSpace(prompt),
	)
	return strings.TrimSpace(strings.Join(lines, "\n"))
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
		if channelStatuses[index].ConnectorID == s.connectorID() {
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
		BridgeState:           deriveBridgeState(feishuStatus),
		Channel:               feishuStatus,
		Binding:               binding,
		Session:               session,
		ActivePresetName:      activePresetName,
		ActivePresetPath:      activePresetPath,
		EffectiveWorkDir:      effectiveWorkDir,
		PendingApprovals:      pendingApprovals,
		ProbeStatus:           probeStatus,
		ProbeError:            probeError,
		ChannelAutoRecovering: channelIsAutoRecovering(feishuStatus),
		BindingHealthy:        binding != nil,
		SessionHealthy:        session != nil || binding == nil,
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
		steps = append(steps, "先发送一条普通消息，或在 Sessions 面板里手动为当前聊天创建 binding。")
	}
	if report.ProbeStatus == "failed" || hasRecoveryHint(report.Channel, "invalid_credentials") {
		steps = append(steps, "检查控制中心中的 Feishu appId/appSecret 是否有效，并确认长连接配置仍然可用。")
	}
	if hasRecoveryHint(report.Channel, "permission_denied") {
		steps = append(steps, "检查飞书应用权限、事件订阅和长连接配置，确认机器人仍有接收消息的权限。")
	}
	if hasRecoveryHint(report.Channel, "host_connection_aborted") {
		steps = append(steps, "这更像是本机连接被中断。优先检查本机网络、代理、VPN、防火墙或杀软，再观察 bridge 是否自动恢复。")
	}
	if report.ChannelAutoRecovering {
		steps = append(steps, "当前 Feishu 通道正在自动恢复中，先等待下一次自动重试，不要把手动重启当成首选。")
	} else if report.Channel != nil && report.Channel.State != domain.ChannelStateReady {
		steps = append(steps, "Feishu 通道还没恢复到 ready，请先查看控制中心里的恢复诊断和最近错误。")
	}
	if report.PendingApprovals > 0 {
		steps = append(steps, "先处理当前聊天里的 pending approvals，再重试被阻塞的会话。")
	}
	if report.Channel != nil && report.Channel.State == domain.ChannelStateReady && report.Binding != nil {
		steps = append(steps, "如果飞书已经 ready 但仍感觉“没回复”，先检查 binding、session、workdir 和 approvals，再决定是否重启。")
	}
	if len(steps) == 0 {
		steps = append(steps, "当前聊天的 bridge 状态看起来正常；如果需要换上下文，请使用 Sessions 或 Workdir。")
	}
	return steps
}

func channelIsAutoRecovering(channel *domain.ChannelStatus) bool {
	if channel == nil {
		return false
	}
	return channel.State != domain.ChannelStateReady &&
		channel.LastFailureRetryable &&
		strings.TrimSpace(channel.NextRetryAt) != ""
}

func hasRecoveryHint(channel *domain.ChannelStatus, hint string) bool {
	if channel == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(channel.RecoveryHint), strings.TrimSpace(hint))
}

func (s *Service) loadCheckpoint(ctx context.Context) (string, error) {
	value, ok, err := s.store.GetOffset(ctx, s.connectorID(), feishuOffsetKind)
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
	if err := s.store.UpdateChannelOffset(ctx, s.connectorID(), feishuOffsetKind, eventID); err != nil {
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

func (s *Service) failStart(ctx context.Context, operation string, code string, err error) error {
	s.recordConnectionFailure(
		ctx,
		operation,
		reliability.Classification{Code: code, Retryable: false},
		err,
		domain.ChannelStateError,
		1,
		0,
	)
	return err
}

func (s *Service) failAfterStart(ctx context.Context, operation string, code string, err error) error {
	s.recordConnectionFailure(
		ctx,
		operation,
		reliability.Classification{Code: code, Retryable: false},
		err,
		domain.ChannelStateError,
		1,
		0,
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

func (s *Service) connectorID() string {
	if value := strings.TrimSpace(s.config.ConnectorID); value != "" {
		return value
	}
	return platformID
}

func (s *Service) logConnectionOpening(operation string, attempt int) {
	s.logf(
		"feishu connection opening platform=%s operation=%s attempt=%d lastReadyAt=%s",
		platformID,
		strings.TrimSpace(operation),
		attempt,
		logValue(s.currentLastReadyAt()),
	)
}

func (s *Service) recordConnectionFailure(
	ctx context.Context,
	operation string,
	classification reliability.Classification,
	err error,
	state domain.ChannelRuntimeState,
	attempt int,
	nextBackoff time.Duration,
) {
	code := strings.TrimSpace(classification.Code)
	if code == "" {
		code = "unknown"
	}
	now := time.Now().UTC()
	nowText := now.Format(time.RFC3339)
	nextRetryAt := ""
	if classification.Retryable && nextBackoff > 0 {
		nextRetryAt = now.Add(nextBackoff).Format(time.RFC3339)
	}
	retryable := classification.Retryable
	consecutiveFailures := s.markFailure(nowText)
	recoveryHint := feishuRecoveryHint(code, err)
	fingerprint := feishuFailureFingerprint(code, err)
	update := domain.ChannelDiagnosticsUpdate{
		State:                state,
		LastErrorCode:        code,
		LastError:            err.Error(),
		LastFailureAt:        &nowText,
		LastFailureOperation: &operation,
		LastFailureRetryable: &retryable,
		ConsecutiveFailures:  &consecutiveFailures,
		NextRetryAt:          &nextRetryAt,
		RecoveryHint:         &recoveryHint,
	}
	_ = s.store.UpdateChannelDiagnostics(ctx, s.connectorID(), update)
	s.logf(
		"feishu connection failure platform=%s operation=%s errorCode=%s retryable=%t attempt=%d backoffMs=%d nextRetryAt=%s lastReadyAt=%s failureFingerprint=%s err=%q",
		platformID,
		strings.TrimSpace(operation),
		code,
		retryable,
		attempt,
		nextBackoff.Milliseconds(),
		logValue(nextRetryAt),
		logValue(s.currentLastReadyAt()),
		fingerprint,
		err.Error(),
	)
	s.logf(
		"channel event=failure platform=%s operation=%s errorCode=%s attempt=%d retryable=%t nextBackoffMs=%d err=%q",
		platformID,
		strings.TrimSpace(operation),
		code,
		attempt,
		retryable,
		nextBackoff.Milliseconds(),
		err.Error(),
	)
	if retryable && nextRetryAt != "" {
		s.logf(
			"feishu connection retry scheduled platform=%s operation=%s errorCode=%s retryable=%t attempt=%d backoffMs=%d nextRetryAt=%s lastReadyAt=%s failureFingerprint=%s",
			platformID,
			strings.TrimSpace(operation),
			code,
			retryable,
			attempt,
			nextBackoff.Milliseconds(),
			nextRetryAt,
			logValue(s.currentLastReadyAt()),
			fingerprint,
		)
	}
}

func (s *Service) markFailure(now string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recoveryPending = true
	s.consecutiveFails++
	return s.consecutiveFails
}

func (s *Service) markReady(now string) (bool, int, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	hadRecovery := s.recoveryPending || s.consecutiveFails > 0
	previousFailures := s.consecutiveFails
	lastReadyAt := s.lastReadyAt
	s.lastReadyAt = strings.TrimSpace(now)
	s.consecutiveFails = 0
	s.recoveryPending = false
	return hadRecovery, previousFailures, lastReadyAt
}

func (s *Service) currentLastReadyAt() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return strings.TrimSpace(s.lastReadyAt)
}

func logValue(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "(none)"
	}
	return value
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