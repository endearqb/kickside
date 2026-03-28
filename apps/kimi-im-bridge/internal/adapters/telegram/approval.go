package telegram

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

func encodeApprovalCallbackData(approvalID string, action string) string {
	return fmt.Sprintf("ka1|%s|%s", approvalID, action)
}

func decodeApprovalCallbackData(value string) (string, string, bool) {
	parts := strings.Split(strings.TrimSpace(value), "|")
	if len(parts) != 3 || parts[0] != "ka1" || parts[1] == "" {
		return "", "", false
	}
	switch parts[2] {
	case "a":
		return parts[1], "approved", true
	case "d":
		return parts[1], "denied", true
	default:
		return "", "", false
	}
}

func buildApprovalKeyboard(approvalID string) *inlineKeyboardMarkup {
	return &inlineKeyboardMarkup{
		InlineKeyboard: [][]inlineKeyboardButton{
			{
				{Text: "Approve", CallbackData: encodeApprovalCallbackData(approvalID, "a")},
				{Text: "Deny", CallbackData: encodeApprovalCallbackData(approvalID, "d")},
			},
		},
	}
}

func (s *Service) sendApprovalMessage(ctx context.Context, source *message, _ domain.SessionBinding, event runtime.PromptEvent) error {
	text := formatApprovalPrompt(event.RequestKind, event.Prompt)
	return s.sendRecordedText(ctx, outboundTextRequest{
		ChatID:           source.Chat.ID,
		ThreadID:         optionalThreadID(source.MessageThreadID),
		ReplyToMessageID: optionalMessageID(source.MessageID),
		Text:             text,
		ReplyMarkup:      buildApprovalKeyboard(event.ApprovalID),
	}, fmt.Sprintf("telegram:approval:%s", event.ApprovalID), strconv.FormatInt(source.MessageID, 10))
}

func (s *Service) sendApprovalMessageBridge(ctx context.Context, source *message, event bridgecore.TurnEvent) error {
	text := formatApprovalPrompt(event.RequestKind, event.Prompt)
	return s.sendRecordedText(ctx, outboundTextRequest{
		ChatID:           source.Chat.ID,
		ThreadID:         optionalThreadID(source.MessageThreadID),
		ReplyToMessageID: optionalMessageID(source.MessageID),
		Text:             text,
		ReplyMarkup:      buildApprovalKeyboard(event.ApprovalID),
	}, fmt.Sprintf("telegram:approval:%s", event.ApprovalID), strconv.FormatInt(source.MessageID, 10))
}

func (s *Service) processCallback(ctx context.Context, query *callbackQuery) (bool, error) {
	if query == nil {
		return true, nil
	}
	if err := s.store.TouchChannelInbound(ctx, s.connectorID(), ""); err != nil {
		return false, reliability.Wrap("unknown", err)
	}

	approvalID, status, ok := decodeApprovalCallbackData(query.Data)
	if !ok {
		return true, s.answerCallback(ctx, query.ID, "unsupported action")
	}

	ticket, err := s.store.GetApprovalByID(ctx, approvalID)
	if err != nil {
		return false, reliability.Wrap("unknown", err)
	}
	if ticket == nil {
		return true, s.answerCallback(ctx, query.ID, "approval not found")
	}
	if ticket.Status != "pending" {
		return true, s.answerCallback(ctx, query.ID, "already resolved")
	}
	if !approvalContextMatches(ticket, query, s.connectorID()) {
		return true, s.answerCallback(ctx, query.ID, "invalid approval context")
	}

	payloadJSON, err := marshalJSON(map[string]string{
		"status":          status,
		"callbackQueryId": query.ID,
		"actorId":         strconv.FormatInt(query.From.ID, 10),
		"actorUsername":   strings.TrimSpace(query.From.Username),
		"actorName":       strings.TrimSpace(actorDisplayName(query.From)),
	})
	if err != nil {
		return false, reliability.Wrap("payload_invalid", err)
	}

	if s.orchestrator != nil {
		if err := s.orchestrator.ResolveApproval(ctx, approvalID, status, payloadJSON); err != nil {
			return false, reliability.Wrap("unknown", err)
		}
	} else if err := s.runtime.ResolveApproval(ctx, approvalID, status, payloadJSON); err != nil {
		return false, reliability.Wrap("unknown", err)
	}
	if err := s.answerCallback(ctx, query.ID, callbackAckText(status)); err != nil {
		return false, err
	}
	if query.Message != nil {
		if err := s.editTextWithFallback(ctx, query.Message.Chat.ID, query.Message.MessageID, resolvedApprovalText(status, ticket.Prompt)); err != nil {
			return false, err
		}
	}
	return true, nil
}

func (s *Service) answerCallback(ctx context.Context, callbackID string, text string) error {
	if err := s.executeOutbound(ctx, "answer_callback", func(ctx context.Context) error {
		return s.botAPI.AnswerCallbackQuery(ctx, answerCallbackQueryRequest{
			CallbackQueryID: callbackID,
			Text:            text,
		})
	}); err != nil {
		return err
	}
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return reliability.Wrap("unknown", err)
	}
	return nil
}

func approvalContextMatches(ticket *domain.ApprovalTicket, query *callbackQuery, connectorID string) bool {
	if ticket == nil || query == nil || query.Message == nil {
		return false
	}
	if ticket.Platform != platformID {
		return false
	}
	if ticket.ConnectorID != "" && ticket.ConnectorID != connectorID {
		return false
	}
	if ticket.ChatID != strconv.FormatInt(query.Message.Chat.ID, 10) {
		return false
	}
	if ticket.ThreadID == "" {
		return true
	}
	return ticket.ThreadID == strconv.FormatInt(query.Message.MessageThreadID, 10)
}

func formatApprovalPrompt(requestKind string, prompt string) string {
	requestKind = strings.TrimSpace(requestKind)
	if requestKind == "" {
		requestKind = "approval"
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return fmt.Sprintf("Approval requested for %s.", requestKind)
	}
	return fmt.Sprintf("Approval requested for %s.\n\n%s", requestKind, prompt)
}

func callbackAckText(status string) string {
	switch status {
	case "approved":
		return "approved"
	case "denied":
		return "denied"
	default:
		return status
	}
}

func resolvedApprovalText(status string, prompt string) string {
	base := "Approval resolved."
	switch status {
	case "approved":
		base = "Approval approved."
	case "denied":
		base = "Approval denied."
	}
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return base
	}
	return base + "\n\n" + prompt
}

func actorDisplayName(actor user) string {
	if value := strings.TrimSpace(actor.Username); value != "" {
		return value
	}
	return strings.TrimSpace(actor.FirstName)
}
