package feishu

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

const (
	cardActionApprovalDecision = "approval_decision"
	cardActionUseSession       = "bridge_use_session"
	cardActionSetPresetWorkDir = "bridge_set_preset_workdir"
	cardActionClearWorkDir     = "bridge_clear_workdir"
	cardActionShowPanel        = "bridge_show_panel"
	maxVisibleWorkDirPresets   = 6
	workDirPresetButtonsPerRow = 3
	commandButtonsPerRow       = 3
	currentOnboardingVersion   = "feishu_bridge_v1"
	bridgeEntryPointsExposed   = false
)

type bridgeCommandKind string

const (
	bridgeCommandHelp      bridgeCommandKind = "help"
	bridgeCommandStart     bridgeCommandKind = "start"
	bridgeCommandSessions  bridgeCommandKind = "sessions"
	bridgeCommandUse       bridgeCommandKind = "use"
	bridgeCommandCwdShow   bridgeCommandKind = "cwd_show"
	bridgeCommandCwdSet    bridgeCommandKind = "cwd_set"
	bridgeCommandCwdClear  bridgeCommandKind = "cwd_clear"
	bridgeCommandApprovals bridgeCommandKind = "approvals"
	bridgeCommandDoctor    bridgeCommandKind = "doctor"
)

const (
	bridgePanelHelp      = "help"
	bridgePanelStart     = "start"
	bridgePanelSessions  = "sessions"
	bridgePanelCwd       = "cwd"
	bridgePanelApprovals = "approvals"
	bridgePanelDoctor    = "doctor"
)

type bridgeCommand struct {
	Kind bridgeCommandKind
	Arg  string
}

type approvalCardData struct {
	ApprovalID         string
	ChatID             string
	ThreadID           string
	KimiSessionID      string
	RequestKind        string
	Prompt             string
	RequestPayloadJSON string
}

type approvalSummary struct {
	Title       string
	Description string
	DetailLines []string
}

type approvalPayload struct {
	ID          string `json:"id"`
	ToolCallID  string `json:"toolCallId,omitempty"`
	Sender      string `json:"sender,omitempty"`
	Action      string `json:"action,omitempty"`
	Description string `json:"description,omitempty"`
	Display     []any  `json:"display,omitempty"`
}

type approvalActionValue struct {
	ApprovalID string
	Decision   string
	ChatID     string
	ThreadID   string
}

type sessionActionValue struct {
	SessionID string
	ChatID    string
	ThreadID  string
}

type workDirPresetActionValue struct {
	ChatID     string
	ThreadID   string
	PresetName string
	PresetPath string
}

type clearWorkDirActionValue struct {
	ChatID   string
	ThreadID string
}

type panelActionValue struct {
	Panel       string
	ChatID      string
	ThreadID    string
	ShowDetails bool
}

type panelButtonSpec struct {
	Label       string
	Panel       string
	ButtonType  string
	ShowDetails bool
}

type doctorReport struct {
	BridgeState      string
	Channel          *domain.ChannelStatus
	Binding          *domain.SessionBinding
	Session          *domain.BridgeSession
	ActivePresetName string
	ActivePresetPath string
	EffectiveWorkDir string
	PendingApprovals int
	ProbeStatus      string
	ProbeError       string
	NextSteps        []string
}

func parseBridgeCommand(event *MessageEvent) (bridgeCommand, domain.BindingKey, bool) {
	if !bridgeEntryPointsExposed {
		return bridgeCommand{}, domain.BindingKey{}, false
	}
	if event == nil {
		return bridgeCommand{}, domain.BindingKey{}, false
	}
	if strings.TrimSpace(strings.ToLower(event.MessageType)) != "text" {
		return bridgeCommand{}, domain.BindingKey{}, false
	}

	text, ok := decodeTextContent(event.Content)
	if !ok {
		return bridgeCommand{}, domain.BindingKey{}, false
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return bridgeCommand{}, domain.BindingKey{}, false
	}

	switch strings.TrimSpace(strings.ToLower(event.ChatType)) {
	case "p2p":
	case "group", "topic_group":
		if stripped, summoned := stripExplicitSummon(text); summoned {
			text = stripped
		}
	default:
		return bridgeCommand{}, domain.BindingKey{}, false
	}

	text = strings.TrimSpace(text)
	if !strings.HasPrefix(strings.ToLower(text), "/bridge") {
		return bridgeCommand{}, domain.BindingKey{}, false
	}

	command, ok := parseBridgeCommandText(text)
	if !ok {
		return bridgeCommand{}, domain.BindingKey{}, false
	}

	return command, domain.BindingKey{
		Platform: platformID,
		ChatID:   strings.TrimSpace(event.ChatID),
		ThreadID: primaryID(event.ThreadID, event.RootID),
	}, true
}

func parseBridgeCommandText(text string) (bridgeCommand, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return bridgeCommand{}, false
	}

	parts := strings.Fields(text)
	if len(parts) == 0 || !strings.EqualFold(parts[0], "/bridge") {
		return bridgeCommand{}, false
	}
	if len(parts) == 1 {
		return bridgeCommand{Kind: bridgeCommandHelp}, true
	}

	switch strings.ToLower(strings.TrimSpace(parts[1])) {
	case "help":
		return bridgeCommand{Kind: bridgeCommandHelp}, true
	case "start":
		return bridgeCommand{Kind: bridgeCommandStart}, true
	case "sessions":
		return bridgeCommand{Kind: bridgeCommandSessions}, true
	case "use":
		if len(parts) < 3 {
			return bridgeCommand{}, false
		}
		return bridgeCommand{Kind: bridgeCommandUse, Arg: strings.TrimSpace(parts[2])}, true
	case "cwd":
		if len(parts) == 2 {
			return bridgeCommand{Kind: bridgeCommandCwdShow}, true
		}
		switch strings.ToLower(strings.TrimSpace(parts[2])) {
		case "clear", "remove", "delete":
			return bridgeCommand{Kind: bridgeCommandCwdClear}, true
		case "set", "add":
			arg := strings.TrimSpace(strings.TrimPrefix(text, strings.Join(parts[:3], " ")))
			if arg == "" {
				return bridgeCommand{}, false
			}
			return bridgeCommand{Kind: bridgeCommandCwdSet, Arg: arg}, true
		default:
			return bridgeCommand{}, false
		}
	case "approvals":
		return bridgeCommand{Kind: bridgeCommandApprovals}, true
	case "doctor":
		return bridgeCommand{Kind: bridgeCommandDoctor}, true
	default:
		return bridgeCommand{}, false
	}
}

func (s *Service) handleBridgeCommand(
	ctx context.Context,
	event *MessageEvent,
	key domain.BindingKey,
	command bridgeCommand,
) error {
	if err := s.store.TouchChannelInbound(ctx, platformID, event.ReceivedAt); err != nil {
		return reliability.Wrap("unknown", err)
	}

	switch command.Kind {
	case bridgeCommandHelp:
		return s.sendCommandCard(ctx, event, "help", buildBridgeHelpCard(key))
	case bridgeCommandStart:
		return s.handleStartCommand(ctx, event, key)
	case bridgeCommandSessions:
		return s.handleSessionsCommand(ctx, event, key)
	case bridgeCommandUse:
		return s.handleUseSessionCommand(ctx, event, key, command.Arg)
	case bridgeCommandCwdShow:
		return s.handleShowWorkDirCommand(ctx, event, key)
	case bridgeCommandCwdSet:
		return s.handleSetWorkDirCommand(ctx, event, key, command.Arg)
	case bridgeCommandCwdClear:
		return s.handleClearWorkDirCommand(ctx, event, key)
	case bridgeCommandApprovals:
		return s.handleApprovalsCommand(ctx, event, key)
	case bridgeCommandDoctor:
		return s.handleDoctorCommand(ctx, event, key)
	default:
		return s.sendCommandCard(ctx, event, "help", buildErrorCard("Unsupported bridge command", "Try `/bridge help` to see the available commands."))
	}
}

func (s *Service) handleStartCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey) error {
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return reliability.Wrap("unknown", err)
	}
	card, shouldMark, err := s.loadOnboardingCard(ctx, key, binding)
	if err != nil {
		return err
	}
	if err := s.sendCommandCard(ctx, event, "start", card); err != nil {
		return err
	}
	if shouldMark {
		if err := s.bindings.UpdateBindingOnboarding(ctx, binding.BindingID, currentOnboardingVersion); err != nil {
			return reliability.Wrap("unknown", err)
		}
		binding.OnboardedAt = time.Now().UTC().Format(time.RFC3339)
		binding.OnboardingVersion = currentOnboardingVersion
	}
	return nil
}

func (s *Service) handleSessionsCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey) error {
	sessions, err := s.store.ListSessions(ctx)
	if err != nil {
		return reliability.Wrap("unknown", err)
	}
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return reliability.Wrap("unknown", err)
	}
	return s.sendCommandCard(ctx, event, "sessions", buildSessionsCard(binding, sessions, key))
}

func (s *Service) handleUseSessionCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey, sessionID string) error {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return s.sendCommandCard(ctx, event, "use-error", buildErrorCard("Session id required", "Usage: `/bridge use <session-id>`"))
	}
	result, err := s.useSessionForBinding(ctx, key, sessionID)
	if err != nil {
		return err
	}
	return s.sendCommandCard(ctx, event, "use", result)
}

func (s *Service) handleShowWorkDirCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey) error {
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return reliability.Wrap("unknown", err)
	}
	return s.sendCommandCard(ctx, event, "cwd", buildWorkDirCard(binding, strings.TrimSpace(s.config.DefaultWorkDir), s.config.WorkDirPresets, key))
}

func (s *Service) handleSetWorkDirCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey, workDir string) error {
	workDir = strings.TrimSpace(workDir)
	if workDir == "" {
		return s.sendCommandCard(ctx, event, "cwd-set-error", buildErrorCard("Work directory required", "Usage: `/bridge cwd set <path>` or `/bridge cwd add <path>`"))
	}
	binding, err := s.resolveOrCreateBinding(ctx, key)
	if err != nil {
		return err
	}
	if err := s.bindings.UpdateBindingWorkDir(ctx, binding.BindingID, workDir); err != nil {
		return reliability.Wrap("unknown", err)
	}
	binding.WorkDir = workDir
	return s.sendCommandCard(ctx, event, "cwd-set", buildWorkDirCard(binding, strings.TrimSpace(s.config.DefaultWorkDir), s.config.WorkDirPresets, key))
}

func (s *Service) handleClearWorkDirCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey) error {
	binding, err := s.resolveOrCreateBinding(ctx, key)
	if err != nil {
		return err
	}
	if err := s.bindings.UpdateBindingWorkDir(ctx, binding.BindingID, ""); err != nil {
		return reliability.Wrap("unknown", err)
	}
	binding.WorkDir = ""
	return s.sendCommandCard(ctx, event, "cwd-clear", buildWorkDirCard(binding, strings.TrimSpace(s.config.DefaultWorkDir), s.config.WorkDirPresets, key))
}

func (s *Service) handleApprovalsCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey) error {
	items, err := s.store.ListApprovals(ctx, "pending")
	if err != nil {
		return reliability.Wrap("unknown", err)
	}
	filtered := filterApprovalsForContext(items, key.ChatID, key.ThreadID)
	return s.sendCommandCard(ctx, event, "approvals", buildApprovalsOverviewCard(filtered, key))
}

func (s *Service) handleDoctorCommand(ctx context.Context, event *MessageEvent, key domain.BindingKey) error {
	report, err := s.collectDoctorReport(ctx, key)
	if err != nil {
		return err
	}
	return s.sendCommandCard(ctx, event, "doctor", buildDoctorCard(report, key, false))
}

func (s *Service) sendCommandCard(ctx context.Context, source *MessageEvent, suffix string, card map[string]any) error {
	content, err := marshalJSON(card)
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}
	return s.sendRecordedMessage(ctx, SendMessageRequest{
		ReplyToMessageID: source.MessageID,
		ChatID:           source.ChatID,
		MessageType:      "interactive",
		Content:          content,
		UUID:             uuid.NewString(),
	}, fmt.Sprintf("feishu:%s:%s:command:%s", source.ChatID, source.MessageID, suffix), source.MessageID)
}

func (s *Service) useSessionForBinding(ctx context.Context, key domain.BindingKey, sessionID string) (map[string]any, error) {
	session, err := s.store.GetSessionByID(ctx, sessionID)
	if err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	if session == nil {
		return buildErrorCard("Session not found", fmt.Sprintf("Bridge session `%s` was not found.", sessionID)), nil
	}

	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	if binding == nil {
		binding, err = s.bindings.CreateBinding(ctx, key, session.KimiSessionID, session.WorkDir, "manual_rebind")
		if err != nil {
			return nil, reliability.Wrap("unknown", err)
		}
	} else {
		if err := s.bindings.Rebind(ctx, binding.BindingID, session.KimiSessionID); err != nil {
			return nil, reliability.Wrap("unknown", err)
		}
		binding.KimiSessionID = session.KimiSessionID
		binding.WorkDir = session.WorkDir
	}

	return buildSessionUpdatedCard(binding, *session), nil
}

func buildBridgeHelpCard(key domain.BindingKey) map[string]any {
	if !bridgeEntryPointsExposed {
		return buildBridgeEntryHiddenCard()
	}
	elements := []any{
		buildMarkdownElement(strings.Join([]string{
			"Use these commands in Feishu:",
			"`/bridge help`",
			"`/bridge start`",
			"`/bridge sessions`",
			"`/bridge use <session-id>`",
			"`/bridge cwd`",
			"`/bridge cwd set <path>` or `/bridge cwd add <path>`",
			"`/bridge cwd clear` or `/bridge cwd remove`",
			"`/bridge approvals`",
			"`/bridge doctor`",
		}, "\n")),
		buildMarkdownElement("`cwd add/set` stores a binding-specific work directory for this chat. `cwd clear/remove` deletes that override and falls back to the bridge default work directory."),
		buildMarkdownElement("`/bridge cwd` also shows clickable work directory presets when they are configured in the Control Center."),
		buildMarkdownElement("`/bridge start` reopens the welcome/onboarding card. `/bridge doctor` runs a safe bridge + Feishu diagnostics snapshot for the current chat."),
		buildMarkdownElement("Bridge-native sessions can be switched directly here. Shell/Web sessions can be reviewed and imported from the Control Center."),
	}
	elements = append(elements, buildPanelActionRows(key,
		panelButtonSpec{Label: "Start onboarding", Panel: bridgePanelStart, ButtonType: "primary"},
		panelButtonSpec{Label: "Sessions", Panel: bridgePanelSessions, ButtonType: "default"},
		panelButtonSpec{Label: "Workdir", Panel: bridgePanelCwd, ButtonType: "default"},
		panelButtonSpec{Label: "Approvals", Panel: bridgePanelApprovals, ButtonType: "default"},
		panelButtonSpec{Label: "Doctor", Panel: bridgePanelDoctor, ButtonType: "default"},
	)...)
	return buildCard("blue", "Bridge commands", elements)
}

func buildBridgeEntryHiddenCard() map[string]any {
	return buildCard("grey", "IM Bridge management hidden", []any{
		buildMarkdownElement(strings.Join([]string{
			"Bridge management commands and panels are no longer exposed in Feishu chat.",
			"IM Bridge runtime, session binding, and approval processing continue to work in the background.",
			"Pending approvals will still appear automatically when a turn requires confirmation.",
		}, "\n\n")),
	})
}

func buildOnboardingCard(
	binding *domain.SessionBinding,
	session *domain.BridgeSession,
	defaultWorkDir string,
	presets []WorkDirPreset,
	key domain.BindingKey,
) map[string]any {
	effectiveWorkDir := strings.TrimSpace(defaultWorkDir)
	if binding != nil && strings.TrimSpace(binding.WorkDir) != "" {
		effectiveWorkDir = strings.TrimSpace(binding.WorkDir)
	}
	activePresetName, activePresetPath := findPresetForPath(presets, effectiveWorkDir)
	lines := []string{
		"Bridge is ready for this Feishu chat.",
	}
	if binding == nil {
		lines = append(lines,
			"Binding: not created yet.",
			"Session: `(will be created automatically on the first prompt)`",
		)
	} else {
		lines = append(lines,
			fmt.Sprintf("Binding: `%s`", strings.TrimSpace(binding.BindingID)),
			fmt.Sprintf("Session: `%s`", strings.TrimSpace(binding.KimiSessionID)),
			fmt.Sprintf("Source: `%s`", firstNonEmpty(strings.TrimSpace(binding.Source), "auto")),
		)
	}
	if session != nil && strings.TrimSpace(session.Summary) != "" {
		lines = append(lines, fmt.Sprintf("Session summary: %s", strings.TrimSpace(session.Summary)))
	}
	lines = append(lines,
		fmt.Sprintf("Default workdir: %s", inlineCodeOrEmpty(defaultWorkDir)),
		fmt.Sprintf("Effective workdir: %s", inlineCodeOrFallback(effectiveWorkDir, "(not set)")),
		"Use `/bridge approvals` to review pending tool approvals.",
		"Use `/bridge sessions` to switch the current bridge session.",
	)
	if activePresetName != "" {
		lines = append(lines, fmt.Sprintf("Active preset: `%s`", activePresetName))
	}

	elements := []any{
		buildMarkdownElement(strings.Join(lines, "\n\n")),
	}
	if len(presets) > 0 {
		elements = append(elements, buildMarkdownElement("Quick workdir presets:"))
		elements = append(elements, buildWorkDirPresetButtons(presets, key, activePresetPath)...)
	}
	elements = append(elements, buildPanelActionRows(key,
		panelButtonSpec{Label: "Run doctor", Panel: bridgePanelDoctor, ButtonType: "primary"},
		panelButtonSpec{Label: "Open sessions", Panel: bridgePanelSessions, ButtonType: "default"},
		panelButtonSpec{Label: "Open workdir", Panel: bridgePanelCwd, ButtonType: "default"},
		panelButtonSpec{Label: "Open approvals", Panel: bridgePanelApprovals, ButtonType: "default"},
	)...)
	return buildCard("green", "Bridge onboarding", elements)
}

func buildWorkDirCard(binding *domain.SessionBinding, defaultWorkDir string, presets []WorkDirPreset, key domain.BindingKey) map[string]any {
	lines := []string{
		fmt.Sprintf("Default work directory: %s", inlineCodeOrEmpty(defaultWorkDir)),
	}
	activePresetName := ""
	activePresetPath := ""
	if binding != nil {
		activePresetName, activePresetPath = findPresetForPath(presets, binding.WorkDir)
	}
	if binding == nil {
		lines = append(lines,
			"Current binding: not created yet.",
			"Current work directory: (using default)",
			"No binding exists yet for this chat. A binding will be created automatically on the first prompt or when you tap a preset or run `/bridge cwd add <path>`.",
		)
	} else {
		lines = append(lines,
			fmt.Sprintf("Current session: `%s`", strings.TrimSpace(binding.KimiSessionID)),
			fmt.Sprintf("Current work directory: %s", inlineCodeOrFallback(binding.WorkDir, "(using default)")),
		)
		if activePresetName != "" {
			lines = append(lines, fmt.Sprintf("Selected preset: `%s`", activePresetName))
		}
		lines = append(lines, "Commands: `/bridge cwd add <path>` to override this chat, `/bridge cwd remove` to go back to the default.")
	}

	elements := []any{buildMarkdownElement(strings.Join(lines, "\n\n"))}
	if len(presets) > 0 {
		elements = append(elements, buildMarkdownElement("Tap a preset below to switch this chat to a saved work directory:"))
		elements = append(elements, buildWorkDirPresetButtons(presets, key, activePresetPath)...)
		if len(presets) > maxVisibleWorkDirPresets {
			elements = append(elements, buildMarkdownElement(fmt.Sprintf("Showing the first %d of %d configured work directory presets.", maxVisibleWorkDirPresets, len(presets))))
		}
	} else {
		elements = append(elements, buildMarkdownElement("No work directory presets are configured yet. Add them from the Control Center to get clickable shortcuts here."))
	}
	if binding != nil {
		elements = append(elements, buildActionElement(
			buildCardButton("Clear current workdir", "default", map[string]string{
				"action":    cardActionClearWorkDir,
				"chat_id":   key.ChatID,
				"thread_id": key.ThreadID,
			}),
		))
	}
	return buildCard("blue", "Binding work directory", elements)
}

func buildSessionsCard(binding *domain.SessionBinding, sessions []domain.BridgeSession, key domain.BindingKey) map[string]any {
	elements := []any{}
	if binding != nil {
		elements = append(elements, buildMarkdownElement(strings.Join([]string{
			"Current binding:",
			fmt.Sprintf("Session `%s`", strings.TrimSpace(binding.KimiSessionID)),
			fmt.Sprintf("Work directory %s", inlineCodeOrFallback(binding.WorkDir, "(using default)")),
		}, "\n")))
	} else {
		elements = append(elements, buildMarkdownElement("No binding exists yet for this chat. Pick a bridge session below to create one."))
	}

	if len(sessions) == 0 {
		elements = append(elements, buildMarkdownElement("No persisted bridge sessions were found yet."))
		return buildCard("blue", "Bridge sessions", elements)
	}

	maxItems := len(sessions)
	if maxItems > 5 {
		maxItems = 5
	}
	for _, session := range sessions[:maxItems] {
		lines := []string{
			fmt.Sprintf("**%s**", shortenSessionID(session.KimiSessionID)),
			fmt.Sprintf("Session id: `%s`", session.KimiSessionID),
			fmt.Sprintf("Work directory: %s", inlineCodeOrFallback(session.WorkDir, "(not set)")),
		}
		if strings.TrimSpace(session.SessionState) != "" {
			lines = append(lines, fmt.Sprintf("State: `%s`", session.SessionState))
		}
		if strings.TrimSpace(session.LastMessageAt) != "" {
			lines = append(lines, fmt.Sprintf("Last activity: %s", formatCardTime(session.LastMessageAt)))
		}
		if strings.TrimSpace(session.Summary) != "" {
			lines = append(lines, fmt.Sprintf("Summary: %s", session.Summary))
		}
		elements = append(elements, buildMarkdownElement(strings.Join(lines, "\n")))
		elements = append(elements, buildActionElement(
			buildCardButton("Use session", "primary", map[string]string{
				"action":     cardActionUseSession,
				"session_id": session.KimiSessionID,
				"chat_id":    key.ChatID,
				"thread_id":  key.ThreadID,
			}),
		))
	}
	if len(sessions) > maxItems {
		elements = append(elements, buildMarkdownElement(fmt.Sprintf("Showing the latest %d of %d persisted bridge sessions.", maxItems, len(sessions))))
	}
	return buildCard("blue", "Bridge sessions", elements)
}

func buildDoctorCard(report doctorReport, key domain.BindingKey, showDetails bool) map[string]any {
	channelState := "unknown"
	channelErrorCode := "(none)"
	channelError := "(none)"
	lastHeartbeat := "(not seen)"
	lastInbound := "(not seen)"
	lastOffset := "(none)"
	if report.Channel != nil {
		channelState = string(report.Channel.State)
		channelErrorCode = firstNonEmpty(strings.TrimSpace(report.Channel.LastErrorCode), "(none)")
		channelError = firstNonEmpty(strings.TrimSpace(report.Channel.LastError), "(none)")
		lastHeartbeat = inlineCodeOrFallback(report.Channel.LastHeartbeatAt, "(not seen)")
		lastInbound = inlineCodeOrFallback(report.Channel.LastInboundAt, "(not seen)")
		lastOffset = inlineCodeOrFallback(report.Channel.LastOffset, "(none)")
	}
	bindingSummary := "No binding exists for this chat yet."
	if report.Binding != nil {
		bindingSummary = fmt.Sprintf(
			"Binding `%s` -> session `%s`",
			strings.TrimSpace(report.Binding.BindingID),
			strings.TrimSpace(report.Binding.KimiSessionID),
		)
	}
	summaryLines := []string{
		fmt.Sprintf("Bridge overall state: `%s`", firstNonEmpty(report.BridgeState, "running")),
		fmt.Sprintf("Feishu channel state: `%s`", channelState),
		fmt.Sprintf("Current chat binding: %s", bindingSummary),
		fmt.Sprintf("Pending approvals here: `%d`", report.PendingApprovals),
		fmt.Sprintf("Live probe: `%s`", firstNonEmpty(report.ProbeStatus, "unknown")),
		fmt.Sprintf("Recent error code: `%s`", channelErrorCode),
	}
	if len(report.NextSteps) > 0 {
		summaryLines = append(summaryLines, "Next steps:")
		for _, step := range report.NextSteps {
			summaryLines = append(summaryLines, "- "+step)
		}
	}

	elements := []any{
		buildMarkdownElement(strings.Join(summaryLines, "\n")),
	}
	elements = append(elements, buildPanelActionRows(key,
		panelButtonSpec{Label: "Refresh doctor", Panel: bridgePanelDoctor, ButtonType: "primary"},
		panelButtonSpec{Label: "Open approvals", Panel: bridgePanelApprovals, ButtonType: "default"},
		panelButtonSpec{Label: "Open cwd", Panel: bridgePanelCwd, ButtonType: "default"},
		panelButtonSpec{
			Label:       map[bool]string{true: "Hide details", false: "Show details"}[showDetails],
			Panel:       bridgePanelDoctor,
			ButtonType:  "default",
			ShowDetails: !showDetails,
		},
	)...)
	if showDetails {
		detailLines := []string{
			fmt.Sprintf("Binding key: `%s|%s|%s|%s`", key.Platform, key.AccountID, key.ChatID, key.ThreadID),
			fmt.Sprintf("Effective workdir: %s", inlineCodeOrFallback(report.EffectiveWorkDir, "(not set)")),
			fmt.Sprintf("Last heartbeat: %s", lastHeartbeat),
			fmt.Sprintf("Last inbound: %s", lastInbound),
			fmt.Sprintf("Checkpoint: %s", lastOffset),
			fmt.Sprintf("Last error: %s", channelError),
		}
		if report.Binding != nil {
			detailLines = append(detailLines,
				fmt.Sprintf("Onboarded at: %s", inlineCodeOrFallback(report.Binding.OnboardedAt, "(not yet)")),
				fmt.Sprintf("Onboarding version: %s", inlineCodeOrFallback(report.Binding.OnboardingVersion, "(not set)")),
			)
		}
		if report.Session != nil {
			detailLines = append(detailLines,
				fmt.Sprintf("Session id: `%s`", report.Session.KimiSessionID),
				fmt.Sprintf("Session summary: %s", firstNonEmpty(strings.TrimSpace(report.Session.Summary), "(none)")),
			)
		}
		if report.ActivePresetName != "" {
			detailLines = append(detailLines, fmt.Sprintf("Preset match: `%s` -> `%s`", report.ActivePresetName, report.ActivePresetPath))
		}
		if strings.TrimSpace(report.ProbeError) != "" {
			detailLines = append(detailLines, fmt.Sprintf("Probe detail: %s", strings.TrimSpace(report.ProbeError)))
		}
		elements = append(elements, buildMarkdownElement(strings.Join(detailLines, "\n\n")))
	}
	return buildCard("grey", "Bridge doctor", elements)
}

func buildWorkDirPresetButtons(presets []WorkDirPreset, key domain.BindingKey, activePresetPath string) []any {
	visible := presets
	if len(visible) > maxVisibleWorkDirPresets {
		visible = visible[:maxVisibleWorkDirPresets]
	}
	if len(visible) == 0 {
		return nil
	}

	elements := make([]any, 0, (len(visible)/workDirPresetButtonsPerRow)+1)
	for start := 0; start < len(visible); start += workDirPresetButtonsPerRow {
		end := start + workDirPresetButtonsPerRow
		if end > len(visible) {
			end = len(visible)
		}
		buttons := make([]map[string]any, 0, end-start)
		for _, preset := range visible[start:end] {
			buttonType := "default"
			if strings.TrimSpace(preset.Path) != "" && strings.TrimSpace(preset.Path) == strings.TrimSpace(activePresetPath) {
				buttonType = "primary"
			}
			buttons = append(buttons, buildCardButton(preset.Name, buttonType, map[string]string{
				"action":      cardActionSetPresetWorkDir,
				"chat_id":     key.ChatID,
				"thread_id":   key.ThreadID,
				"preset_name": preset.Name,
				"preset_path": preset.Path,
			}))
		}
		elements = append(elements, buildActionElement(buttons...))
	}
	return elements
}

func buildPanelActionRows(key domain.BindingKey, specs ...panelButtonSpec) []any {
	if len(specs) == 0 {
		return nil
	}
	elements := []any{}
	for start := 0; start < len(specs); start += commandButtonsPerRow {
		end := start + commandButtonsPerRow
		if end > len(specs) {
			end = len(specs)
		}
		buttons := make([]map[string]any, 0, end-start)
		for _, spec := range specs[start:end] {
			buttons = append(buttons, buildPanelButton(spec, key))
		}
		elements = append(elements, buildActionElement(buttons...))
	}
	return elements
}

func buildPanelButton(spec panelButtonSpec, key domain.BindingKey) map[string]any {
	value := map[string]string{
		"action":       cardActionShowPanel,
		"panel":        strings.TrimSpace(spec.Panel),
		"chat_id":      strings.TrimSpace(key.ChatID),
		"thread_id":    strings.TrimSpace(key.ThreadID),
		"show_details": fmt.Sprintf("%t", spec.ShowDetails),
	}
	return buildCardButton(spec.Label, firstNonEmpty(spec.ButtonType, "default"), value)
}

func buildApprovalsOverviewCard(approvals []domain.ApprovalTicket, key domain.BindingKey) map[string]any {
	elements := []any{
		buildMarkdownElement(fmt.Sprintf("Current chat: `%s`", key.ChatID)),
	}
	if len(approvals) == 0 {
		elements = append(elements, buildMarkdownElement("There are no pending approvals for this Feishu chat/thread."))
		return buildCard("orange", "Pending approvals", elements)
	}

	maxItems := len(approvals)
	if maxItems > 4 {
		maxItems = 4
	}
	for _, ticket := range approvals[:maxItems] {
		summary := summarizeApproval(approvalCardData{
			ApprovalID:         ticket.ApprovalID,
			ChatID:             ticket.ChatID,
			ThreadID:           ticket.ThreadID,
			KimiSessionID:      ticket.KimiSessionID,
			RequestKind:        ticket.RequestKind,
			Prompt:             ticket.Prompt,
			RequestPayloadJSON: ticket.RequestPayloadJSON,
		})
		elements = append(elements, buildMarkdownElement(renderApprovalSummary(summary)))
		elements = append(elements, buildActionElement(
			buildApprovalButton("Approve once", "primary", mergeActionValue(map[string]string{
				"action":      cardActionApprovalDecision,
				"approval_id": ticket.ApprovalID,
				"chat_id":     ticket.ChatID,
				"thread_id":   ticket.ThreadID,
			}, approvalDecisionApproved)),
			buildApprovalButton("Approve for session", "default", mergeActionValue(map[string]string{
				"action":      cardActionApprovalDecision,
				"approval_id": ticket.ApprovalID,
				"chat_id":     ticket.ChatID,
				"thread_id":   ticket.ThreadID,
			}, approvalDecisionApprovedForSession)),
			buildApprovalButton("Reject", "danger", mergeActionValue(map[string]string{
				"action":      cardActionApprovalDecision,
				"approval_id": ticket.ApprovalID,
				"chat_id":     ticket.ChatID,
				"thread_id":   ticket.ThreadID,
			}, approvalDecisionDenied)),
		))
	}
	if len(approvals) > maxItems {
		elements = append(elements, buildMarkdownElement(fmt.Sprintf("Showing the first %d pending approvals for this chat/thread.", maxItems)))
	}
	return buildCard("orange", "Pending approvals", elements)
}

func buildSessionUpdatedCard(binding *domain.SessionBinding, session domain.BridgeSession) map[string]any {
	return buildCard("green", "Bridge session updated", []any{
		buildMarkdownElement(strings.Join([]string{
			fmt.Sprintf("Binding `%s` now points to session `%s`.", binding.BindingID, session.KimiSessionID),
			fmt.Sprintf("Work directory: %s", inlineCodeOrFallback(session.WorkDir, "(not set)")),
			fmt.Sprintf("Summary: %s", firstNonEmpty(strings.TrimSpace(session.Summary), "(none)")),
		}, "\n\n")),
	})
}

func buildErrorCard(title string, message string) map[string]any {
	return buildCard("red", title, []any{buildMarkdownElement(strings.TrimSpace(message))})
}

func buildCard(template string, title string, elements []any) map[string]any {
	return map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
		},
		"header": map[string]any{
			"template": template,
			"title": map[string]string{
				"tag":     "plain_text",
				"content": strings.TrimSpace(title),
			},
		},
		"elements": elements,
	}
}

func buildMarkdownElement(content string) map[string]any {
	return map[string]any{
		"tag": "div",
		"text": map[string]string{
			"tag":     "lark_md",
			"content": strings.TrimSpace(content),
		},
	}
}

func buildActionElement(buttons ...map[string]any) map[string]any {
	return map[string]any{
		"tag":     "action",
		"actions": buttons,
	}
}

func buildCardButton(label string, buttonType string, value map[string]string) map[string]any {
	return map[string]any{
		"tag":  "button",
		"type": buttonType,
		"text": map[string]string{
			"tag":     "plain_text",
			"content": label,
		},
		"value": value,
	}
}

func summarizeApproval(data approvalCardData) approvalSummary {
	payload := approvalPayload{}
	if strings.TrimSpace(data.RequestPayloadJSON) != "" {
		_ = json.Unmarshal([]byte(data.RequestPayloadJSON), &payload)
	}

	title := firstNonEmpty(strings.TrimSpace(payload.Action), strings.TrimSpace(data.RequestKind), "approval")
	title = strings.ReplaceAll(title, "_", " ")
	description := firstNonEmpty(strings.TrimSpace(payload.Description), strings.TrimSpace(data.Prompt), "Approval requested.")

	details := []string{}
	if strings.TrimSpace(data.KimiSessionID) != "" {
		details = append(details, fmt.Sprintf("Session: `%s`", data.KimiSessionID))
	}
	if strings.TrimSpace(payload.ToolCallID) != "" {
		details = append(details, fmt.Sprintf("Tool call: `%s`", payload.ToolCallID))
	}
	if strings.TrimSpace(payload.Sender) != "" {
		details = append(details, fmt.Sprintf("Sender: `%s`", payload.Sender))
	}
	details = append(details, extractDisplayLines(payload.Display, description)...)

	return approvalSummary{
		Title:       title,
		Description: description,
		DetailLines: uniqueNonEmptyStrings(details, 6),
	}
}

func renderApprovalSummary(summary approvalSummary) string {
	parts := []string{
		fmt.Sprintf("**%s**", strings.TrimSpace(summary.Title)),
		summary.Description,
	}
	if len(summary.DetailLines) > 0 {
		parts = append(parts, strings.Join(summary.DetailLines, "\n"))
	}
	return strings.Join(parts, "\n\n")
}

func extractDisplayLines(display []any, description string) []string {
	if len(display) == 0 {
		return nil
	}
	lines := []string{}
	seen := map[string]struct{}{}
	collectDisplayStrings(display, &lines, seen)

	filtered := []string{}
	description = strings.TrimSpace(description)
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || trimmed == description {
			continue
		}
		filtered = append(filtered, trimmed)
		if len(filtered) >= 4 {
			break
		}
	}
	return filtered
}

func collectDisplayStrings(value any, lines *[]string, seen map[string]struct{}) {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			collectDisplayStrings(item, lines, seen)
		}
	case map[string]any:
		keys := []string{"text", "content", "title", "label", "value", "description", "name"}
		for _, key := range keys {
			if raw, ok := typed[key]; ok {
				collectDisplayStrings(raw, lines, seen)
			}
		}
		for _, raw := range typed {
			switch raw.(type) {
			case map[string]any, []any:
				collectDisplayStrings(raw, lines, seen)
			}
		}
	case string:
		text := strings.TrimSpace(typed)
		if text == "" || looksLikeRawJSON(text) {
			return
		}
		if _, ok := seen[text]; ok {
			return
		}
		seen[text] = struct{}{}
		*lines = append(*lines, text)
	}
}

func looksLikeRawJSON(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, "{") || strings.HasPrefix(value, "[")
}

func filterApprovalsForContext(items []domain.ApprovalTicket, chatID string, threadID string) []domain.ApprovalTicket {
	filtered := make([]domain.ApprovalTicket, 0, len(items))
	chatID = strings.TrimSpace(chatID)
	threadID = strings.TrimSpace(threadID)
	for _, item := range items {
		if item.Platform != platformID {
			continue
		}
		if strings.TrimSpace(item.ChatID) != chatID {
			continue
		}
		if strings.TrimSpace(item.ThreadID) != threadID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func inlineCodeOrEmpty(value string) string {
	if strings.TrimSpace(value) == "" {
		return "(not set)"
	}
	return fmt.Sprintf("`%s`", strings.TrimSpace(value))
}

func inlineCodeOrFallback(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return fmt.Sprintf("`%s`", strings.TrimSpace(value))
}

func shortenSessionID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) <= 12 {
		return value
	}
	return value[:12] + "..."
}

func formatCardTime(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "-"
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return value
	}
	return parsed.UTC().Format("2006-01-02 15:04:05 UTC")
}

func findPresetForPath(presets []WorkDirPreset, workDir string) (string, string) {
	workDir = strings.TrimSpace(workDir)
	if workDir == "" {
		return "", ""
	}
	for _, preset := range presets {
		if strings.TrimSpace(preset.Path) == workDir {
			return strings.TrimSpace(preset.Name), strings.TrimSpace(preset.Path)
		}
	}
	return "", ""
}

func uniqueNonEmptyStrings(values []string, max int) []string {
	unique := []string{}
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		unique = append(unique, trimmed)
		if max > 0 && len(unique) >= max {
			break
		}
	}
	return unique
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func approvalDataFromRuntimeEvent(source *MessageEvent, binding domain.SessionBinding, event runtime.PromptEvent) approvalCardData {
	return approvalCardData{
		ApprovalID:         event.ApprovalID,
		ChatID:             source.ChatID,
		ThreadID:           primaryID(source.ThreadID, source.RootID),
		KimiSessionID:      binding.KimiSessionID,
		RequestKind:        event.RequestKind,
		Prompt:             event.Prompt,
		RequestPayloadJSON: event.RequestPayloadJSON,
	}
}

func approvalDataFromTurnEvent(source *MessageEvent, event bridgecore.TurnEvent) approvalCardData {
	return approvalCardData{
		ApprovalID:         event.ApprovalID,
		ChatID:             source.ChatID,
		ThreadID:           primaryID(source.ThreadID, source.RootID),
		KimiSessionID:      event.KimiSessionID,
		RequestKind:        event.RequestKind,
		Prompt:             event.Prompt,
		RequestPayloadJSON: event.RequestPayloadJSON,
	}
}
