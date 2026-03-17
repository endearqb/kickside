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

type imageContent struct {
	ImageKey string `json:"image_key"`
}

type fileContent struct {
	FileKey  string `json:"file_key"`
	FileName string `json:"file_name"`
}

func mapMessageToInbound(event *MessageEvent) (domain.InboundMessage, domain.BindingKey, bool) {
	if event == nil {
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
		ReceivedAt: strings.TrimSpace(event.ReceivedAt),
		RawRef:     strings.TrimSpace(event.RawRef),
	}
	for _, mention := range event.Mentions {
		if value := strings.TrimSpace(mention.ID); value != "" {
			inbound.Mentions = append(inbound.Mentions, value)
		}
	}

	switch strings.TrimSpace(strings.ToLower(event.MessageType)) {
	case "text":
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
		inbound.Text = strings.TrimSpace(text)
		return inbound, key, true
	case "image":
		imageKey, ok := decodeImageContent(event.Content)
		if !ok {
			return domain.InboundMessage{}, domain.BindingKey{}, false
		}
		inbound.Attachments = append(inbound.Attachments, domain.InboundAttachment{
			Kind:            domain.AttachmentKindImage,
			PlatformKey:     imageKey,
			SourceMessageID: inbound.MessageID,
			DownloadState:   domain.AttachmentDownloadPending,
		})
		return inbound, key, true
	case "file":
		fileKey, fileName, ok := decodeFileContent(event.Content)
		if !ok {
			return domain.InboundMessage{}, domain.BindingKey{}, false
		}
		inbound.Attachments = append(inbound.Attachments, domain.InboundAttachment{
			Kind:            domain.AttachmentKindFile,
			FileName:        fileName,
			PlatformKey:     fileKey,
			SourceMessageID: inbound.MessageID,
			DownloadState:   domain.AttachmentDownloadPending,
		})
		return inbound, key, true
	default:
		return domain.InboundMessage{}, domain.BindingKey{}, false
	}
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

func decodeImageContent(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", false
	}
	var payload imageContent
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return "", false
	}
	return strings.TrimSpace(payload.ImageKey), strings.TrimSpace(payload.ImageKey) != ""
}

func decodeFileContent(raw string) (string, string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", false
	}
	var payload fileContent
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return "", "", false
	}
	fileKey := strings.TrimSpace(payload.FileKey)
	if fileKey == "" {
		return "", "", false
	}
	return fileKey, strings.TrimSpace(payload.FileName), true
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
