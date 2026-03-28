package telegram

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func mapMessageToInbound(message *message, botUsername string, botUserID int64) (*domain.InboundMessage, *domain.BindingKey, bool) {
	if message == nil {
		return nil, nil, false
	}
	text, ok := normalizePromptText(message, botUsername, botUserID)
	if !ok {
		return nil, nil, false
	}

	threadID := threadIDFromMessage(message)
	inbound := &domain.InboundMessage{
		Platform:    "telegram",
		MessageID:   strconv.FormatInt(message.MessageID, 10),
		ChatID:      strconv.FormatInt(message.Chat.ID, 10),
		ThreadID:    threadID,
		SenderID:    senderIDFromMessage(message),
		SenderName:  senderNameFromMessage(message),
		Text:        text,
		Mentions:    nil,
		Attachments: nil,
		ReceivedAt:  time.Unix(message.Date, 0).UTC().Format(time.RFC3339),
		RawRef:      fmt.Sprintf("telegram:message:%d", message.MessageID),
	}

	key := &domain.BindingKey{
		Platform: "telegram",
		ChatID:   inbound.ChatID,
		ThreadID: threadID,
	}
	return inbound, key, true
}

func normalizePromptText(message *message, botUsername string, botUserID int64) (string, bool) {
	text := strings.TrimSpace(message.Text)
	if text == "" {
		return "", false
	}

	switch strings.ToLower(strings.TrimSpace(message.Chat.Type)) {
	case "private":
		return text, true
	case "group", "supergroup":
		if isReplyToBot(message, botUserID) {
			return stripLeadingMention(text, botUsername), true
		}
		if mentionsBot(text, botUsername) {
			return stripLeadingMention(text, botUsername), true
		}
		return "", false
	default:
		return "", false
	}
}

func mentionsBot(text string, botUsername string) bool {
	botUsername = strings.TrimSpace(strings.TrimPrefix(botUsername, "@"))
	if botUsername == "" {
		return false
	}
	return strings.Contains(strings.ToLower(text), "@"+strings.ToLower(botUsername))
}

func stripLeadingMention(text string, botUsername string) string {
	botUsername = strings.TrimSpace(strings.TrimPrefix(botUsername, "@"))
	if botUsername == "" {
		return strings.TrimSpace(text)
	}
	candidate := strings.TrimSpace(text)
	prefix := "@" + strings.ToLower(botUsername)
	lower := strings.ToLower(candidate)
	if !strings.HasPrefix(lower, prefix) {
		return candidate
	}
	candidate = strings.TrimSpace(candidate[len(prefix):])
	candidate = strings.TrimLeft(candidate, ":,，；;!！ ")
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return "继续"
	}
	return candidate
}

func isReplyToBot(message *message, botUserID int64) bool {
	if message == nil || message.ReplyToMessage == nil || message.ReplyToMessage.From == nil {
		return false
	}
	return message.ReplyToMessage.From.ID == botUserID
}

func threadIDFromMessage(message *message) string {
	if message == nil || message.MessageThreadID == 0 {
		return ""
	}
	return strconv.FormatInt(message.MessageThreadID, 10)
}

func senderIDFromMessage(message *message) string {
	if message == nil || message.From == nil {
		return ""
	}
	return strconv.FormatInt(message.From.ID, 10)
}

func senderNameFromMessage(message *message) string {
	if message == nil || message.From == nil {
		return ""
	}
	if value := strings.TrimSpace(message.From.Username); value != "" {
		return value
	}
	return strings.TrimSpace(message.From.FirstName)
}
