package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func (s *Service) sendReply(ctx context.Context, source *MessageEvent, binding domain.SessionBinding, text string) error {
	chunks := splitTextChunks(text, feishuTextMaxRunes)
	if len(chunks) == 0 {
		return nil
	}

	for index, chunk := range chunks {
		if err := s.sendRecordedMessage(ctx, SendMessageRequest{
			ReplyToMessageID: source.MessageID,
			ChatID:           source.ChatID,
			MessageType:      "post",
			Content:          chunk,
			UUID:             uuid.NewString(),
		}, fmt.Sprintf("feishu:%s:%s:reply:%d", binding.Key.ChatID, source.MessageID, index), source.MessageID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) sendRecordedMessage(ctx context.Context, request SendMessageRequest, deliveryKey string, sourceMessageID string) error {
	existing, err := s.store.GetDeliveryEventByKey(ctx, deliveryKey)
	if err != nil {
		return withCode("delivery_lookup_failed", err)
	}
	if existing != nil && existing.Status == "sent" {
		return nil
	}

	payloadJSON, err := marshalJSON(map[string]any{
		"replyToMessageId": request.ReplyToMessageID,
		"chatId":           request.ChatID,
		"messageType":      request.MessageType,
		"content":          request.Content,
	})
	if err != nil {
		return withCode("delivery_record_failed", err)
	}

	if existing == nil {
		_, err = s.store.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
			EventID:         uuid.NewString(),
			Platform:        platformID,
			ChatID:          strings.TrimSpace(request.ChatID),
			ThreadID:        "",
			Direction:       "outbound",
			DeliveryKey:     deliveryKey,
			SourceMessageID: strings.TrimSpace(sourceMessageID),
			PayloadJSON:     payloadJSON,
			Status:          "pending",
		})
		if err != nil {
			return withCode("delivery_record_failed", err)
		}
	}

	if _, err := s.replyRichTextWithFallback(ctx, request); err != nil {
		statusErr := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "failed", err.Error())
		if statusErr != nil {
			return withCode("message_send_failed", errors.Join(err, statusErr))
		}
		return withCode("message_send_failed", err)
	}

	if err := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "sent", ""); err != nil {
		return withCode("delivery_record_failed", err)
	}
	if err := s.store.TouchChannelOutbound(ctx, platformID, ""); err != nil {
		return withCode("channel_activity_failed", err)
	}
	return nil
}

func (s *Service) replyRichTextWithFallback(ctx context.Context, request SendMessageRequest) (*SendMessageResult, error) {
	postContent, postErr := buildPostMessageContent(request.Content)
	if postErr == nil {
		reply := request
		reply.MessageType = "post"
		reply.Content = postContent
		if result, err := s.gateway.ReplyMessage(ctx, reply); err == nil {
			return result, nil
		}
	}

	textContent, err := buildTextMessageContent(request.Content)
	if err != nil {
		if postErr != nil {
			return nil, errors.Join(postErr, err)
		}
		return nil, err
	}
	reply := request
	reply.MessageType = "text"
	reply.Content = textContent
	return s.gateway.ReplyMessage(ctx, reply)
}

func buildTextMessageContent(text string) (string, error) {
	return marshalJSON(map[string]string{
		"text": strings.TrimSpace(text),
	})
}

func buildPostMessageContent(text string) (string, error) {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	rows := make([][]map[string]string, 0, len(lines))
	for _, line := range lines {
		rows = append(rows, []map[string]string{{
			"tag":  "text",
			"text": strings.TrimSpace(line),
		}})
	}
	return marshalJSON(map[string]any{
		"zh_cn": map[string]any{
			"title":   "",
			"content": rows,
		},
	})
}

func splitTextChunks(text string, maxRunes int) []string {
	text = strings.TrimSpace(text)
	if text == "" || maxRunes <= 0 {
		return nil
	}

	runes := []rune(text)
	if len(runes) <= maxRunes {
		return []string{text}
	}

	chunks := make([]string, 0, (len(runes)/maxRunes)+1)
	for start := 0; start < len(runes); start += maxRunes {
		end := start + maxRunes
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
	}
	return chunks
}

func marshalJSON(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("marshal json payload: %w", err)
	}
	return string(raw), nil
}
