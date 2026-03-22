package feishu

import (
	"context"
	"fmt"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

const (
	approvalDecisionApproved           = "approved"
	approvalDecisionApprovedForSession = "approved_for_session"
	approvalDecisionDenied             = "denied"
)

func (s *Service) sendApprovalMessage(ctx context.Context, source *MessageEvent, binding domain.SessionBinding, event runtime.PromptEvent) error {
	content, err := buildApprovalCardContent(approvalDataFromRuntimeEvent(source, binding, event))
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}
	return s.sendRecordedMessage(ctx, SendMessageRequest{
		ReplyToMessageID: source.MessageID,
		ChatID:           source.ChatID,
		MessageType:      "interactive",
		Content:          content,
		UUID:             event.ApprovalID,
	}, fmt.Sprintf("feishu:approval:%s", event.ApprovalID), source.MessageID)
}

func (s *Service) sendApprovalMessageBridge(ctx context.Context, source *MessageEvent, event bridgecore.TurnEvent) error {
	content, err := buildApprovalCardContent(approvalDataFromTurnEvent(source, event))
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}
	return s.sendRecordedMessage(ctx, SendMessageRequest{
		ReplyToMessageID: source.MessageID,
		ChatID:           source.ChatID,
		MessageType:      "interactive",
		Content:          content,
		UUID:             event.ApprovalID,
	}, fmt.Sprintf("feishu:approval:%s", event.ApprovalID), source.MessageID)
}

func (s *Service) processCardAction(ctx context.Context, event *CardActionEvent) (*CardActionResult, error) {
	if err := s.store.TouchChannelInbound(ctx, s.connectorID(), ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}

	action := strings.TrimSpace(event.ActionValue["action"])
	switch action {
	case "", cardActionApprovalDecision:
		return s.processApprovalCardAction(ctx, event)
	case cardActionUseSession:
		return s.processSessionCardAction(ctx, event)
	case cardActionShowPanel:
		return s.processShowPanelCardAction(ctx, event)
	case cardActionSetPresetWorkDir:
		return s.processSetPresetWorkDirCardAction(ctx, event)
	case cardActionClearWorkDir:
		return s.processClearWorkDirCardAction(ctx, event)
	default:
		return &CardActionResult{Toast: "unsupported action"}, nil
	}
}

func (s *Service) processShowPanelCardAction(ctx context.Context, event *CardActionEvent) (*CardActionResult, error) {
	value, ok := decodePanelActionValue(event.ActionValue)
	if !ok {
		return &CardActionResult{Toast: "unsupported action"}, nil
	}
	if value.ChatID != "" && strings.TrimSpace(value.ChatID) != strings.TrimSpace(event.ChatID) {
		return &CardActionResult{Toast: "invalid card context"}, nil
	}

	key := domain.BindingKey{
		ConnectorID: s.connectorID(),
		Platform:    platformID,
		ChatID:      strings.TrimSpace(event.ChatID),
		ThreadID:    strings.TrimSpace(value.ThreadID),
	}
	card, shouldMarkOnboarding, err := s.buildPanelCard(ctx, key, value.Panel, value.ShowDetails)
	if err != nil {
		return nil, err
	}
	if shouldMarkOnboarding {
		binding, resolveErr := s.bindings.ResolveBinding(ctx, key)
		if resolveErr != nil {
			return nil, reliability.Wrap("unknown", resolveErr)
		}
		if binding != nil {
			if err := s.bindings.UpdateBindingOnboarding(ctx, binding.BindingID, currentOnboardingVersion); err != nil {
				return nil, reliability.Wrap("unknown", err)
			}
		}
	}
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	return &CardActionResult{
		UpdatedCard: card,
	}, nil
}

func (s *Service) processApprovalCardAction(ctx context.Context, event *CardActionEvent) (*CardActionResult, error) {
	value, ok := decodeApprovalActionValue(event.ActionValue)
	if !ok {
		return &CardActionResult{Toast: "unsupported action"}, nil
	}

	ticket, err := s.store.GetApprovalByID(ctx, value.ApprovalID)
	if err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	if ticket == nil {
		return &CardActionResult{Toast: "approval not found"}, nil
	}
	if ticket.Status != "pending" {
		return &CardActionResult{Toast: "already resolved"}, nil
	}
	if !approvalContextMatches(ticket, event, value.ChatID, value.ThreadID, s.connectorID()) {
		return &CardActionResult{Toast: "invalid approval context"}, nil
	}

	payloadJSON, err := marshalJSON(map[string]string{
		"status":       value.Decision,
		"actorId":      strings.TrimSpace(event.OperatorID),
		"actorName":    strings.TrimSpace(event.OperatorName),
		"messageId":    strings.TrimSpace(event.MessageID),
		"eventId":      strings.TrimSpace(event.EventID),
		"approvalId":   value.ApprovalID,
		"decision":     value.Decision,
		"resolutionBy": s.connectorID(),
	})
	if err != nil {
		return nil, reliability.Wrap("payload_invalid", err)
	}

	if s.orchestrator != nil {
		if err := s.orchestrator.ResolveApproval(ctx, value.ApprovalID, value.Decision, payloadJSON); err != nil {
			return nil, reliability.Wrap("unknown", err)
		}
	} else if err := s.runtime.ResolveApproval(ctx, value.ApprovalID, value.Decision, payloadJSON); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}

	card, err := buildResolvedApprovalCard(value.Decision, approvalCardData{
		ApprovalID:         ticket.ApprovalID,
		ChatID:             ticket.ChatID,
		ThreadID:           ticket.ThreadID,
		KimiSessionID:      ticket.KimiSessionID,
		RequestKind:        ticket.RequestKind,
		Prompt:             ticket.Prompt,
		RequestPayloadJSON: ticket.RequestPayloadJSON,
	})
	if err != nil {
		fallbackErr := s.sendResolutionFallback(ctx, event, ticket, value.Decision)
		if fallbackErr != nil {
			return nil, fallbackErr
		}
		return &CardActionResult{Toast: callbackAckText(value.Decision)}, nil
	}
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	return &CardActionResult{
		Toast:       callbackAckText(value.Decision),
		UpdatedCard: card,
	}, nil
}

func (s *Service) processSessionCardAction(ctx context.Context, event *CardActionEvent) (*CardActionResult, error) {
	if !bridgeEntryPointsExposed {
		return hiddenBridgeEntryCardResult(), nil
	}
	value, ok := decodeSessionActionValue(event.ActionValue)
	if !ok {
		return &CardActionResult{Toast: "unsupported action"}, nil
	}
	if value.ChatID != "" && strings.TrimSpace(value.ChatID) != strings.TrimSpace(event.ChatID) {
		return &CardActionResult{Toast: "invalid session context"}, nil
	}

	key := domain.BindingKey{
		ConnectorID: s.connectorID(),
		Platform:    platformID,
		ChatID:      strings.TrimSpace(event.ChatID),
		ThreadID:    strings.TrimSpace(value.ThreadID),
	}
	card, err := s.useSessionForBinding(ctx, key, value.SessionID)
	if err != nil {
		return nil, err
	}
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	return &CardActionResult{
		Toast:       "session updated",
		UpdatedCard: card,
	}, nil
}

func (s *Service) processSetPresetWorkDirCardAction(ctx context.Context, event *CardActionEvent) (*CardActionResult, error) {
	if !bridgeEntryPointsExposed {
		return hiddenBridgeEntryCardResult(), nil
	}
	value, ok := decodeWorkDirPresetActionValue(event.ActionValue)
	if !ok {
		return &CardActionResult{Toast: "unsupported action"}, nil
	}
	if value.ChatID != "" && strings.TrimSpace(value.ChatID) != strings.TrimSpace(event.ChatID) {
		return &CardActionResult{Toast: "invalid workdir context"}, nil
	}

	key := domain.BindingKey{
		ConnectorID: s.connectorID(),
		Platform:    platformID,
		ChatID:      strings.TrimSpace(event.ChatID),
		ThreadID:    strings.TrimSpace(value.ThreadID),
	}
	binding, err := s.resolveOrCreateBinding(ctx, key)
	if err != nil {
		return nil, err
	}
	if err := s.bindings.UpdateBindingWorkDir(ctx, binding.BindingID, value.PresetPath); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	binding.WorkDir = strings.TrimSpace(value.PresetPath)
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	toast := "workdir updated"
	if strings.TrimSpace(value.PresetName) != "" {
		toast = fmt.Sprintf("workdir set to %s", strings.TrimSpace(value.PresetName))
	} else if strings.TrimSpace(value.PresetPath) != "" {
		toast = fmt.Sprintf("workdir set to %s", strings.TrimSpace(value.PresetPath))
	}
	return &CardActionResult{
		Toast:       toast,
		UpdatedCard: buildWorkDirCard(binding, strings.TrimSpace(s.config.DefaultWorkDir), s.config.WorkDirPresets, key),
	}, nil
}

func (s *Service) processClearWorkDirCardAction(ctx context.Context, event *CardActionEvent) (*CardActionResult, error) {
	if !bridgeEntryPointsExposed {
		return hiddenBridgeEntryCardResult(), nil
	}
	value, ok := decodeClearWorkDirActionValue(event.ActionValue)
	if !ok {
		return &CardActionResult{Toast: "unsupported action"}, nil
	}
	if value.ChatID != "" && strings.TrimSpace(value.ChatID) != strings.TrimSpace(event.ChatID) {
		return &CardActionResult{Toast: "invalid workdir context"}, nil
	}

	key := domain.BindingKey{
		ConnectorID: s.connectorID(),
		Platform:    platformID,
		ChatID:      strings.TrimSpace(event.ChatID),
		ThreadID:    strings.TrimSpace(value.ThreadID),
	}
	binding, err := s.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	if binding != nil {
		if err := s.bindings.UpdateBindingWorkDir(ctx, binding.BindingID, ""); err != nil {
			return nil, reliability.Wrap("unknown", err)
		}
		binding.WorkDir = ""
	}
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	return &CardActionResult{
		Toast:       "workdir cleared",
		UpdatedCard: buildWorkDirCard(binding, strings.TrimSpace(s.config.DefaultWorkDir), s.config.WorkDirPresets, key),
	}, nil
}

func (s *Service) sendResolutionFallback(ctx context.Context, event *CardActionEvent, ticket *domain.ApprovalTicket, status string) error {
	return s.sendRecordedMessage(ctx, SendMessageRequest{
		ReplyToMessageID: event.MessageID,
		ChatID:           event.ChatID,
		MessageType:      "text",
		Content: resolvedApprovalText(status, summarizeApproval(approvalCardData{
			ApprovalID:         ticket.ApprovalID,
			ChatID:             ticket.ChatID,
			ThreadID:           ticket.ThreadID,
			KimiSessionID:      ticket.KimiSessionID,
			RequestKind:        ticket.RequestKind,
			Prompt:             ticket.Prompt,
			RequestPayloadJSON: ticket.RequestPayloadJSON,
		}).Description),
		UUID: fmt.Sprintf("%s:%s", ticket.ApprovalID, status),
	}, fmt.Sprintf("feishu:approval:%s:resolved", ticket.ApprovalID), event.MessageID)
}

func decodeApprovalActionValue(values map[string]string) (approvalActionValue, bool) {
	if len(values) == 0 {
		return approvalActionValue{}, false
	}
	approvalID := strings.TrimSpace(values["approval_id"])
	decision := strings.TrimSpace(values["decision"])
	switch decision {
	case approvalDecisionApproved, approvalDecisionApprovedForSession, approvalDecisionDenied:
	default:
		return approvalActionValue{}, false
	}
	if approvalID == "" {
		return approvalActionValue{}, false
	}
	return approvalActionValue{
		ApprovalID: approvalID,
		Decision:   decision,
		ChatID:     strings.TrimSpace(values["chat_id"]),
		ThreadID:   strings.TrimSpace(values["thread_id"]),
	}, true
}

func decodeSessionActionValue(values map[string]string) (sessionActionValue, bool) {
	if len(values) == 0 {
		return sessionActionValue{}, false
	}
	sessionID := strings.TrimSpace(values["session_id"])
	if sessionID == "" {
		return sessionActionValue{}, false
	}
	return sessionActionValue{
		SessionID: sessionID,
		ChatID:    strings.TrimSpace(values["chat_id"]),
		ThreadID:  strings.TrimSpace(values["thread_id"]),
	}, true
}

func decodeWorkDirPresetActionValue(values map[string]string) (workDirPresetActionValue, bool) {
	if len(values) == 0 {
		return workDirPresetActionValue{}, false
	}
	presetPath := strings.TrimSpace(values["preset_path"])
	if presetPath == "" {
		return workDirPresetActionValue{}, false
	}
	return workDirPresetActionValue{
		ChatID:     strings.TrimSpace(values["chat_id"]),
		ThreadID:   strings.TrimSpace(values["thread_id"]),
		PresetName: strings.TrimSpace(values["preset_name"]),
		PresetPath: presetPath,
	}, true
}

func decodeClearWorkDirActionValue(values map[string]string) (clearWorkDirActionValue, bool) {
	if len(values) == 0 {
		return clearWorkDirActionValue{}, false
	}
	return clearWorkDirActionValue{
		ChatID:   strings.TrimSpace(values["chat_id"]),
		ThreadID: strings.TrimSpace(values["thread_id"]),
	}, true
}

func decodePanelActionValue(values map[string]string) (panelActionValue, bool) {
	if len(values) == 0 {
		return panelActionValue{}, false
	}
	panel := strings.TrimSpace(values["panel"])
	if panel == "" {
		return panelActionValue{}, false
	}
	return panelActionValue{
		Panel:       panel,
		ChatID:      strings.TrimSpace(values["chat_id"]),
		ThreadID:    strings.TrimSpace(values["thread_id"]),
		ShowDetails: strings.EqualFold(strings.TrimSpace(values["show_details"]), "true"),
	}, true
}

func hiddenBridgeEntryCardResult() *CardActionResult {
	return &CardActionResult{
		Toast:       "bridge entry hidden",
		UpdatedCard: buildBridgeEntryHiddenCard(),
	}
}

func buildApprovalCardContent(data approvalCardData) (string, error) {
	card, err := buildApprovalCard(data)
	if err != nil {
		return "", err
	}
	return marshalJSON(card)
}

func buildApprovalCard(data approvalCardData) (map[string]any, error) {
	summary := summarizeApproval(data)
	valueBase := map[string]string{
		"action":      cardActionApprovalDecision,
		"approval_id": data.ApprovalID,
		"chat_id":     strings.TrimSpace(data.ChatID),
		"thread_id":   strings.TrimSpace(data.ThreadID),
	}
	return buildCard("orange", "Approval requested", []any{
		buildMarkdownElement(renderApprovalSummary(summary)),
		buildActionElement(
			buildApprovalButton("Approve once", "primary", mergeActionValue(valueBase, approvalDecisionApproved)),
			buildApprovalButton("Approve for session", "default", mergeActionValue(valueBase, approvalDecisionApprovedForSession)),
			buildApprovalButton("Reject", "danger", mergeActionValue(valueBase, approvalDecisionDenied)),
		),
	}), nil
}

func buildResolvedApprovalCard(status string, data approvalCardData) (map[string]any, error) {
	summary := summarizeApproval(data)
	return buildCard(resolvedApprovalTemplate(status), resolvedApprovalHeader(status), []any{
		buildMarkdownElement(strings.Join([]string{
			resolvedApprovalText(status, summary.Description),
			renderApprovalSummary(summary),
		}, "\n\n")),
	}), nil
}

func buildApprovalButton(label string, buttonType string, value map[string]string) map[string]any {
	return buildCardButton(label, buttonType, value)
}

func mergeActionValue(base map[string]string, decision string) map[string]string {
	merged := map[string]string{}
	for key, value := range base {
		merged[key] = value
	}
	merged["decision"] = decision
	return merged
}

func approvalContextMatches(ticket *domain.ApprovalTicket, event *CardActionEvent, chatID string, threadID string, connectorID string) bool {
	if ticket == nil || event == nil {
		return false
	}
	if ticket.Platform != platformID {
		return false
	}
	if ticket.ConnectorID != "" && strings.TrimSpace(ticket.ConnectorID) != strings.TrimSpace(connectorID) {
		return false
	}
	if strings.TrimSpace(ticket.ChatID) != strings.TrimSpace(event.ChatID) {
		return false
	}
	if chatID != "" && strings.TrimSpace(ticket.ChatID) != strings.TrimSpace(chatID) {
		return false
	}
	return strings.TrimSpace(ticket.ThreadID) == strings.TrimSpace(threadID)
}

func callbackAckText(status string) string {
	switch status {
	case approvalDecisionApproved:
		return "approved"
	case approvalDecisionApprovedForSession:
		return "approved for session"
	case approvalDecisionDenied:
		return "rejected"
	default:
		return strings.TrimSpace(status)
	}
}

func resolvedApprovalHeader(status string) string {
	switch status {
	case approvalDecisionApproved:
		return "Approval approved"
	case approvalDecisionApprovedForSession:
		return "Approval approved for session"
	case approvalDecisionDenied:
		return "Approval rejected"
	default:
		return "Approval resolved"
	}
}

func resolvedApprovalTemplate(status string) string {
	switch status {
	case approvalDecisionApproved, approvalDecisionApprovedForSession:
		return "green"
	case approvalDecisionDenied:
		return "red"
	default:
		return "grey"
	}
}

func resolvedApprovalText(status string, prompt string) string {
	base := resolvedApprovalHeader(status) + "."
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return base
	}
	return base + "\n\n" + prompt
}
