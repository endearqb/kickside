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
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
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
		return reliability.Wrap("unknown", err)
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
		return reliability.Wrap("unknown", err)
	}

	if existing == nil {
		_, err := s.store.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
			EventID:         uuid.NewString(),
			ConnectorID:     s.connectorID(),
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
			return reliability.Wrap("unknown", err)
		}
	}

	_, err = s.sendTextWithFallback(ctx, request)
	if err != nil {
		statusErr := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "failed", err.Error())
		if statusErr != nil {
			return reliability.Wrap("delivery_failed", errors.Join(err, statusErr))
		}
		return err
	}

	if err := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "sent", ""); err != nil {
		return reliability.Wrap("unknown", err)
	}
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return reliability.Wrap("unknown", err)
	}
	return nil
}

func (s *Service) sendTextWithFallback(ctx context.Context, request outboundTextRequest) (*message, error) {
	var sent *message
	err := s.executeOutbound(ctx, "send_message", func(ctx context.Context) error {
		htmlRequest := sendMessageRequest{
			ChatID:           request.ChatID,
			MessageThreadID:  request.ThreadID,
			ReplyToMessageID: request.ReplyToMessageID,
			Text:             html.EscapeString(request.Text),
			ParseMode:        "HTML",
			ReplyMarkup:      request.ReplyMarkup,
		}
		result, err := s.botAPI.SendMessage(ctx, htmlRequest)
		if err == nil {
			sent = result
			return nil
		}

		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.IsParseModeError() {
			fallbackRequest := htmlRequest
			fallbackRequest.Text = request.Text
			fallbackRequest.ParseMode = ""
			result, err = s.botAPI.SendMessage(ctx, fallbackRequest)
			if err == nil {
				sent = result
			}
			return err
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	return sent, nil
}

func (s *Service) editTextWithFallback(ctx context.Context, chatID int64, messageID int64, text string) error {
	err := s.executeOutbound(ctx, "edit_message", func(ctx context.Context) error {
		htmlRequest := editMessageTextRequest{
			ChatID:    chatID,
			MessageID: messageID,
			Text:      html.EscapeString(text),
			ParseMode: "HTML",
		}
		err := s.botAPI.EditMessageText(ctx, htmlRequest)
		if err == nil {
			return nil
		}

		var apiErr *APIError
		if errors.As(err, &apiErr) && apiErr.IsParseModeError() {
			fallbackRequest := htmlRequest
			fallbackRequest.Text = text
			fallbackRequest.ParseMode = ""
			return s.botAPI.EditMessageText(ctx, fallbackRequest)
		}
		return err
	})
	if err != nil {
		return err
	}
	if touchErr := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); touchErr != nil {
		return reliability.Wrap("unknown", touchErr)
	}
	return nil
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
	return s.delivery.Execute(ctx, operation, run, classifyTelegramError)
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
