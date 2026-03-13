package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
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
		return reliability.Wrap("unknown", err)
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
		return reliability.Wrap("unknown", err)
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
			return reliability.Wrap("unknown", err)
		}
	}

	if _, err := s.replyRichTextWithFallback(ctx, request); err != nil {
		statusErr := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "failed", err.Error())
		if statusErr != nil {
			return reliability.Wrap("delivery_failed", errors.Join(err, statusErr))
		}
		return err
	}

	if err := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "sent", ""); err != nil {
		return reliability.Wrap("unknown", err)
	}
	if err := s.store.TouchChannelOutbound(ctx, platformID, ""); err != nil {
		return reliability.Wrap("unknown", err)
	}
	return nil
}

func (s *Service) replyRichTextWithFallback(ctx context.Context, request SendMessageRequest) (*SendMessageResult, error) {
	var result *SendMessageResult
	err := s.executeOutbound(ctx, "reply_message", func(ctx context.Context) error {
		postContent, postErr := buildPostMessageContent(request.Content)
		if postErr == nil {
			reply := request
			reply.MessageType = "post"
			reply.Content = postContent
			replyResult, err := s.gateway.ReplyMessage(ctx, reply)
			if err == nil {
				result = replyResult
				return nil
			}
		}

		textContent, err := buildTextMessageContent(request.Content)
		if err != nil {
			if postErr != nil {
				return errors.Join(postErr, err)
			}
			return err
		}
		reply := request
		reply.MessageType = "text"
		reply.Content = textContent
		replyResult, err := s.gateway.ReplyMessage(ctx, reply)
		if err == nil {
			result = replyResult
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return result, nil
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

func (s *Service) executeOutbound(
	ctx context.Context,
	operation string,
	run func(context.Context) error,
) error {
	if s.delivery == nil {
		s.delivery = reliability.NewExecutor(reliability.ExecutorOptions{
			Platform: platformID,
			Logger:   s.logger,
		})
	}
	return s.delivery.Execute(ctx, operation, run, classifyFeishuError)
}
