package telegram

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

const telegramMessageMaxRunes = 4096

type outboundTextRequest struct {
	ChatID           int64
	ThreadID         *int64
	ReplyToMessageID *int64
	Text             string
	ReplyMarkup      *inlineKeyboardMarkup
}

func (s *Service) sendReply(ctx context.Context, source *message, binding domain.SessionBinding, text string) error {
	chunks := splitTextChunks(text, telegramMessageMaxRunes)
	if len(chunks) == 0 {
		return nil
	}

	threadID := optionalThreadID(source.MessageThreadID)
	replyTo := optionalMessageID(source.MessageID)
	sourceMessageID := strconv.FormatInt(source.MessageID, 10)
	for index, chunk := range chunks {
		if err := s.sendRecordedText(ctx, outboundTextRequest{
			ChatID:           source.Chat.ID,
			ThreadID:         threadID,
			ReplyToMessageID: replyTo,
			Text:             chunk,
		}, fmt.Sprintf("telegram:%s:%s:reply:%d", binding.Key.ChatID, sourceMessageID, index), sourceMessageID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) sendRecordedText(ctx context.Context, request outboundTextRequest, deliveryKey string, sourceMessageID string) error {
	existing, err := s.store.GetDeliveryEventByKey(ctx, deliveryKey)
	if err != nil {
		return withCode("delivery_lookup_failed", err)
	}
	if existing != nil && existing.Status == "sent" {
		return nil
	}

	payloadJSON, err := marshalJSON(map[string]any{
		"chatId":           request.ChatID,
		"threadId":         int64Value(request.ThreadID),
		"replyToMessageId": int64Value(request.ReplyToMessageID),
		"text":             request.Text,
	})
	if err != nil {
		return withCode("delivery_record_failed", err)
	}

	if existing == nil {
		_, err := s.store.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
			EventID:         uuid.NewString(),
			Platform:        platformID,
			ChatID:          strconv.FormatInt(request.ChatID, 10),
			ThreadID:        int64String(request.ThreadID),
			Direction:       "outbound",
			DeliveryKey:     deliveryKey,
			SourceMessageID: sourceMessageID,
			PayloadJSON:     payloadJSON,
			Status:          "pending",
		})
		if err != nil {
			return withCode("delivery_record_failed", err)
		}
	}

	_, err = s.sendTextWithFallback(ctx, request)
	if err != nil {
		statusErr := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "failed", err.Error())
		if statusErr != nil {
			return withCode("send_message_failed", errors.Join(err, statusErr))
		}
		return withCode("send_message_failed", err)
	}

	if err := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "sent", ""); err != nil {
		return withCode("delivery_record_failed", err)
	}
	if err := s.store.TouchChannelOutbound(ctx, platformID, ""); err != nil {
		return withCode("channel_activity_failed", err)
	}
	return nil
}

func (s *Service) sendTextWithFallback(ctx context.Context, request outboundTextRequest) (*message, error) {
	htmlRequest := sendMessageRequest{
		ChatID:           request.ChatID,
		MessageThreadID:  request.ThreadID,
		ReplyToMessageID: request.ReplyToMessageID,
		Text:             html.EscapeString(request.Text),
		ParseMode:        "HTML",
		ReplyMarkup:      request.ReplyMarkup,
	}
	sent, err := s.botAPI.SendMessage(ctx, htmlRequest)
	if err == nil {
		return sent, nil
	}

	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.IsParseModeError() {
		fallbackRequest := htmlRequest
		fallbackRequest.Text = request.Text
		fallbackRequest.ParseMode = ""
		return s.botAPI.SendMessage(ctx, fallbackRequest)
	}
	return nil, err
}

func (s *Service) editTextWithFallback(ctx context.Context, chatID int64, messageID int64, text string) error {
	htmlRequest := editMessageTextRequest{
		ChatID:    chatID,
		MessageID: messageID,
		Text:      html.EscapeString(text),
		ParseMode: "HTML",
	}
	err := s.botAPI.EditMessageText(ctx, htmlRequest)
	if err == nil {
		if touchErr := s.store.TouchChannelOutbound(ctx, platformID, ""); touchErr != nil {
			return withCode("channel_activity_failed", touchErr)
		}
		return nil
	}

	var apiErr *APIError
	if errors.As(err, &apiErr) && apiErr.IsParseModeError() {
		fallbackRequest := htmlRequest
		fallbackRequest.Text = text
		fallbackRequest.ParseMode = ""
		err = s.botAPI.EditMessageText(ctx, fallbackRequest)
	}
	if err != nil {
		return withCode("edit_message_failed", err)
	}
	if touchErr := s.store.TouchChannelOutbound(ctx, platformID, ""); touchErr != nil {
		return withCode("channel_activity_failed", touchErr)
	}
	return nil
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

func optionalThreadID(threadID int64) *int64 {
	if threadID == 0 {
		return nil
	}
	value := threadID
	return &value
}

func optionalMessageID(messageID int64) *int64 {
	if messageID == 0 {
		return nil
	}
	value := messageID
	return &value
}

func int64Value(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func int64String(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}
