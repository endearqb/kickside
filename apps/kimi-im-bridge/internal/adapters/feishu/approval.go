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
	approvalDecisionApproved = "approved"
	approvalDecisionDenied   = "denied"
)

func (s *Service) sendApprovalMessage(ctx context.Context, source *MessageEvent, binding domain.SessionBinding, event runtime.PromptEvent) error {
	content, err := buildApprovalCardContent(event.ApprovalID, source.ChatID, primaryID(source.ThreadID, source.RootID), event.RequestKind, event.Prompt)
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
	content, err := buildApprovalCardContent(event.ApprovalID, source.ChatID, primaryID(source.ThreadID, source.RootID), event.RequestKind, event.Prompt)
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
	if err := s.store.TouchChannelInbound(ctx, platformID, ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}

	value, ok := decodeActionValue(event.ActionValue)
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
	if !approvalContextMatches(ticket, event, value) {
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
		"resolutionBy": platformID,
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

	card, err := buildResolvedApprovalCard(value.Decision, ticket.Prompt)
	if err != nil {
		fallbackErr := s.sendResolutionFallback(ctx, event, ticket, value.Decision)
		if fallbackErr != nil {
			return nil, fallbackErr
		}
		return &CardActionResult{Toast: callbackAckText(value.Decision)}, nil
	}
	if err := s.store.TouchChannelOutbound(ctx, platformID, ""); err != nil {
		return nil, reliability.Wrap("unknown", err)
	}
	return &CardActionResult{
		Toast:       callbackAckText(value.Decision),
		UpdatedCard: card,
	}, nil
}

func (s *Service) sendResolutionFallback(ctx context.Context, event *CardActionEvent, ticket *domain.ApprovalTicket, status string) error {
	return s.sendRecordedMessage(ctx, SendMessageRequest{
		ReplyToMessageID: event.MessageID,
		ChatID:           event.ChatID,
		MessageType:      "text",
		Content:          resolvedApprovalText(status, ticket.Prompt),
		UUID:             fmt.Sprintf("%s:%s", ticket.ApprovalID, status),
	}, fmt.Sprintf("feishu:approval:%s:resolved", ticket.ApprovalID), event.MessageID)
}

type actionValue struct {
	ApprovalID string
	Decision   string
	ChatID     string
	ThreadID   string
}

func decodeActionValue(values map[string]string) (actionValue, bool) {
	if len(values) == 0 {
		return actionValue{}, false
	}
	approvalID := strings.TrimSpace(values["approval_id"])
	decision := strings.TrimSpace(values["decision"])
	switch decision {
	case approvalDecisionApproved, approvalDecisionDenied:
	default:
		return actionValue{}, false
	}
	if approvalID == "" {
		return actionValue{}, false
	}
	return actionValue{
		ApprovalID: approvalID,
		Decision:   decision,
		ChatID:     strings.TrimSpace(values["chat_id"]),
		ThreadID:   strings.TrimSpace(values["thread_id"]),
	}, true
}

func buildApprovalCardContent(approvalID string, chatID string, threadID string, requestKind string, prompt string) (string, error) {
	card, err := buildApprovalCard(approvalID, chatID, threadID, requestKind, prompt)
	if err != nil {
		return "", err
	}
	return marshalJSON(card)
}

func buildApprovalCard(approvalID string, chatID string, threadID string, requestKind string, prompt string) (map[string]any, error) {
	text := formatApprovalPrompt(requestKind, prompt)
	valueBase := map[string]string{
		"approval_id": approvalID,
		"chat_id":     strings.TrimSpace(chatID),
		"thread_id":   strings.TrimSpace(threadID),
	}
	return map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
		},
		"header": map[string]any{
			"template": "orange",
			"title": map[string]string{
				"tag":     "plain_text",
				"content": "Approval requested",
			},
		},
		"elements": []any{
			map[string]any{
				"tag": "div",
				"text": map[string]string{
					"tag":     "plain_text",
					"content": text,
				},
			},
			map[string]any{
				"tag": "action",
				"actions": []any{
					buildApprovalButton("Approve", "primary", mergeActionValue(valueBase, approvalDecisionApproved)),
					buildApprovalButton("Deny", "default", mergeActionValue(valueBase, approvalDecisionDenied)),
				},
			},
		},
	}, nil
}

func buildResolvedApprovalCard(status string, prompt string) (map[string]any, error) {
	return map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
		},
		"header": map[string]any{
			"template": resolvedApprovalTemplate(status),
			"title": map[string]string{
				"tag":     "plain_text",
				"content": resolvedApprovalHeader(status),
			},
		},
		"elements": []any{
			map[string]any{
				"tag": "div",
				"text": map[string]string{
					"tag":     "plain_text",
					"content": resolvedApprovalText(status, prompt),
				},
			},
		},
	}, nil
}

func buildApprovalButton(label string, buttonType string, value map[string]string) map[string]any {
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

func mergeActionValue(base map[string]string, decision string) map[string]string {
	merged := map[string]string{}
	for key, value := range base {
		merged[key] = value
	}
	merged["decision"] = decision
	return merged
}

func approvalContextMatches(ticket *domain.ApprovalTicket, event *CardActionEvent, value actionValue) bool {
	if ticket == nil || event == nil {
		return false
	}
	if ticket.Platform != platformID {
		return false
	}
	if strings.TrimSpace(ticket.ChatID) != strings.TrimSpace(event.ChatID) {
		return false
	}
	if value.ChatID != "" && strings.TrimSpace(ticket.ChatID) != strings.TrimSpace(value.ChatID) {
		return false
	}
	if ticket.ThreadID == "" {
		return true
	}
	return strings.TrimSpace(ticket.ThreadID) == strings.TrimSpace(value.ThreadID)
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
	case approvalDecisionApproved:
		return "approved"
	case approvalDecisionDenied:
		return "denied"
	default:
		return strings.TrimSpace(status)
	}
}

func resolvedApprovalHeader(status string) string {
	switch status {
	case approvalDecisionApproved:
		return "Approval approved"
	case approvalDecisionDenied:
		return "Approval denied"
	default:
		return "Approval resolved"
	}
}

func resolvedApprovalTemplate(status string) string {
	switch status {
	case approvalDecisionApproved:
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
