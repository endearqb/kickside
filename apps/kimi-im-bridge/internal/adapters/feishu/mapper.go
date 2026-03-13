package feishu

import (
	"encoding/json"
	"regexp"
	"strings"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

var leadingAtTagPattern = regexp.MustCompile(`^(?:\s*<at\b[^>]*>.*?</at>\s*)+`)

type textContent struct {
	Text string `json:"text"`
}

func mapMessageToInbound(event *MessageEvent) (domain.InboundMessage, domain.BindingKey, bool) {
	if event == nil {
		return domain.InboundMessage{}, domain.BindingKey{}, false
	}
	if strings.TrimSpace(strings.ToLower(event.MessageType)) != "text" {
		return domain.InboundMessage{}, domain.BindingKey{}, false
	}

	text, ok := decodeTextContent(event.Content)
	if !ok {
		return domain.InboundMessage{}, domain.BindingKey{}, false
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return domain.InboundMessage{}, domain.BindingKey{}, false
	}

	switch strings.TrimSpace(strings.ToLower(event.ChatType)) {
	case "p2p":
	case "group", "topic_group":
		var summoned bool
		text, summoned = stripExplicitSummon(text)
		if !summoned || strings.TrimSpace(text) == "" {
			return domain.InboundMessage{}, domain.BindingKey{}, false
		}
	default:
		return domain.InboundMessage{}, domain.BindingKey{}, false
	}

	threadID := primaryID(event.ThreadID, event.RootID)
	key := domain.BindingKey{
		Platform: platformID,
		ChatID:   strings.TrimSpace(event.ChatID),
		ThreadID: threadID,
	}
	inbound := domain.InboundMessage{
		Platform:   platformID,
		MessageID:  strings.TrimSpace(event.MessageID),
		ChatID:     key.ChatID,
		ThreadID:   key.ThreadID,
		SenderID:   strings.TrimSpace(event.SenderID),
		SenderName: strings.TrimSpace(event.SenderName),
		Text:       strings.TrimSpace(text),
		ReceivedAt: strings.TrimSpace(event.ReceivedAt),
		RawRef:     strings.TrimSpace(event.RawRef),
	}
	for _, mention := range event.Mentions {
		if value := strings.TrimSpace(mention.ID); value != "" {
			inbound.Mentions = append(inbound.Mentions, value)
		}
	}
	return inbound, key, true
}

func decodeTextContent(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	var payload textContent
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return "", false
	}
	return payload.Text, true
}

func stripExplicitSummon(text string) (string, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", false
	}
	if match := leadingAtTagPattern.FindString(text); match != "" {
		return strings.TrimSpace(strings.TrimPrefix(text, match)), true
	}
	if strings.HasPrefix(text, "@") {
		parts := strings.Fields(text)
		if len(parts) <= 1 {
			return "", true
		}
		return strings.TrimSpace(strings.Join(parts[1:], " ")), true
	}
	return text, false
}

func primaryID(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
