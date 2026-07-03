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
	return s.sendReplyBundle(ctx, source, binding, text, nil)
}

func (s *Service) sendReplyBundle(ctx context.Context, source *MessageEvent, binding domain.SessionBinding, text string, artifacts []domain.RuntimeArtifact) error {
	return s.sendReplyBundleWithRenderer(ctx, source, binding, text, artifacts, strings.TrimSpace(s.config.ReplyRenderer))
}

func (s *Service) sendReplyBundleWithRenderer(
	ctx context.Context,
	source *MessageEvent,
	binding domain.SessionBinding,
	text string,
	artifacts []domain.RuntimeArtifact,
	replyRenderer string,
) error {
	if source == nil {
		return nil
	}

	requests, err := buildReplyRequests(*source, text, replyRenderer)
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}
	for index, request := range requests {
		if err := s.sendRecordedMessage(ctx, request, fmt.Sprintf("feishu:%s:%s:reply:%d", binding.Key.ChatID, source.MessageID, index), source.MessageID); err != nil {
			return err
		}
	}
	return s.sendArtifacts(ctx, source, artifacts)
}

func buildReplyRequests(source MessageEvent, text string, replyRenderer string) ([]SendMessageRequest, error) {
	if strings.EqualFold(strings.TrimSpace(replyRenderer), "post") {
		return buildRichTextReplyRequests(source, text), nil
	}
	if strings.TrimSpace(replyRenderer) == "" ||
		strings.EqualFold(strings.TrimSpace(replyRenderer), "interactive") ||
		strings.EqualFold(strings.TrimSpace(replyRenderer), "streaming") {
		return buildReplyCardRequests(source, text)
	}
	return nil, fmt.Errorf("unsupported feishu reply renderer %q", replyRenderer)
}

func buildRichTextReplyRequests(source MessageEvent, text string) []SendMessageRequest {
	chunks := splitTextChunks(text, feishuTextMaxRunes)
	if len(chunks) == 0 {
		return nil
	}

	requests := make([]SendMessageRequest, 0, len(chunks))
	for _, chunk := range chunks {
		requests = append(requests, SendMessageRequest{
			ReplyToMessageID: source.MessageID,
			ChatID:           source.ChatID,
			MessageType:      "post",
			Content:          chunk,
			UUID:             uuid.NewString(),
		})
	}
	return requests
}

func buildReplyCardRequests(source MessageEvent, text string) ([]SendMessageRequest, error) {
	chunks := splitTextChunks(text, feishuCardMaxRunes)
	if len(chunks) == 0 {
		return nil, nil
	}

	requests := make([]SendMessageRequest, 0, len(chunks))
	for _, chunk := range chunks {
		content, err := buildReplyCardContent(chunk)
		if err != nil {
			return nil, err
		}
		requests = append(requests, SendMessageRequest{
			ReplyToMessageID: source.MessageID,
			ChatID:           source.ChatID,
			MessageType:      "interactive",
			Content:          content,
			UUID:             uuid.NewString(),
		})
	}
	return requests, nil
}

func (s *Service) sendArtifacts(ctx context.Context, source *MessageEvent, artifacts []domain.RuntimeArtifact) error {
	if source == nil || len(artifacts) == 0 {
		return nil
	}
	for index, artifact := range artifacts {
		if err := s.sendArtifact(ctx, source, artifact, index); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) sendArtifact(ctx context.Context, source *MessageEvent, artifact domain.RuntimeArtifact, index int) error {
	localPath := strings.TrimSpace(artifact.LocalPath)
	if localPath == "" {
		return reliability.Wrap("payload_invalid", fmt.Errorf("artifact localPath is required"))
	}
	var (
		request     SendMessageRequest
		uploadedKey string
		err         error
	)
	switch artifact.Kind {
	case domain.AttachmentKindImage:
		uploaded, uploadErr := s.gateway.UploadImage(ctx, localPath)
		if uploadErr != nil {
			return reliability.Wrap(classifyFeishuError(uploadErr).Code, uploadErr)
		}
		uploadedKey = uploaded.Key
		request = SendMessageRequest{
			ReplyToMessageID: source.MessageID,
			ChatID:           source.ChatID,
			MessageType:      "image",
			UUID:             uuid.NewString(),
		}
		request.Content, err = marshalJSON(map[string]string{"image_key": uploadedKey})
	case domain.AttachmentKindFile:
		uploaded, uploadErr := s.gateway.UploadFile(ctx, localPath, strings.TrimSpace(artifact.Title))
		if uploadErr != nil {
			return reliability.Wrap(classifyFeishuError(uploadErr).Code, uploadErr)
		}
		uploadedKey = uploaded.Key
		request = SendMessageRequest{
			ReplyToMessageID: source.MessageID,
			ChatID:           source.ChatID,
			MessageType:      "file",
			UUID:             uuid.NewString(),
		}
		request.Content, err = marshalJSON(map[string]string{"file_key": uploadedKey})
	default:
		return reliability.Wrap("payload_invalid", fmt.Errorf("unsupported artifact kind %q", artifact.Kind))
	}
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}
	return s.sendRecordedRequest(ctx, request, fmt.Sprintf("feishu:%s:%s:artifact:%d", source.ChatID, source.MessageID, index), source.MessageID, string(artifact.Kind), string(artifact.Kind), map[string]any{
		"uploadedKey": uploadedKey,
		"title":       strings.TrimSpace(artifact.Title),
		"localPath":   localPath,
	})
}

func buildReplyCardContent(text string) (string, error) {
	return marshalJSON(map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
		},
		"elements": []any{buildMarkdownElement(text)},
	})
}

func (s *Service) sendRecordedMessage(ctx context.Context, request SendMessageRequest, deliveryKey string, sourceMessageID string) error {
	renderer := strings.TrimSpace(request.MessageType)
	return s.sendRecordedRequest(ctx, request, deliveryKey, sourceMessageID, strings.TrimSpace(request.MessageType), renderer, nil)
}

func (s *Service) sendRecordedRequest(
	ctx context.Context,
	request SendMessageRequest,
	deliveryKey string,
	sourceMessageID string,
	deliveryKind string,
	renderer string,
	extra map[string]any,
) error {
	existing, err := s.store.GetDeliveryEventByKey(ctx, deliveryKey)
	if err != nil {
		return reliability.Wrap("unknown", err)
	}
	if existing != nil && existing.Status == "sent" {
		return nil
	}

	payload := map[string]any{
		"replyToMessageId": request.ReplyToMessageID,
		"chatId":           request.ChatID,
		"messageType":      request.MessageType,
		"content":          request.Content,
	}
	for key, value := range extra {
		payload[key] = value
	}
	payloadJSON, err := marshalJSON(payload)
	if err != nil {
		return reliability.Wrap("unknown", err)
	}

	if existing == nil {
		_, err = s.store.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
			EventID:         uuid.NewString(),
			ConnectorID:     s.connectorID(),
			Platform:        platformID,
			ChatID:          strings.TrimSpace(request.ChatID),
			ThreadID:        "",
			Direction:       "outbound",
			DeliveryKey:     deliveryKey,
			SourceMessageID: strings.TrimSpace(sourceMessageID),
			DeliveryKind:    strings.TrimSpace(deliveryKind),
			Renderer:        strings.TrimSpace(renderer),
			PayloadJSON:     payloadJSON,
			Status:          "pending",
		})
		if err != nil {
			return reliability.Wrap("unknown", err)
		}
	}

	result, err := s.replyMessageWithFallback(ctx, request)
	if err != nil {
		statusErr := s.store.UpdateDeliveryEventStatus(ctx, deliveryKey, "failed", err.Error())
		if statusErr != nil {
			return reliability.Wrap("delivery_failed", errors.Join(err, statusErr))
		}
		return err
	}

	targetMessageID := ""
	if result != nil {
		targetMessageID = result.MessageID
	}
	if err := s.store.UpdateDeliveryEventSent(ctx, deliveryKey, targetMessageID); err != nil {
		return reliability.Wrap("unknown", err)
	}
	if err := s.store.TouchChannelOutbound(ctx, s.connectorID(), ""); err != nil {
		return reliability.Wrap("unknown", err)
	}
	return nil
}

func (s *Service) replyMessageWithFallback(ctx context.Context, request SendMessageRequest) (*SendMessageResult, error) {
	var result *SendMessageResult
	err := s.executeOutbound(ctx, "reply_message", func(ctx context.Context) error {
		switch strings.TrimSpace(request.MessageType) {
		case "interactive":
			replyResult, replyErr := s.gateway.ReplyMessage(ctx, request)
			if replyErr == nil {
				result = replyResult
				return nil
			}
			fallback := request
			fallback.MessageType = "post"
			fallback.Content = extractCardMarkdown(request.Content)
			if fallback.Content == "" {
				return replyErr
			}
			return sendPostTextFallback(ctx, s.gateway, &result, fallback)
		case "image", "file":
			replyResult, replyErr := s.gateway.ReplyMessage(ctx, request)
			if replyErr == nil {
				result = replyResult
				return nil
			}
			createResult, createErr := s.gateway.CreateMessage(ctx, request)
			if createErr == nil {
				result = createResult
				return nil
			}
			return errors.Join(replyErr, createErr)
		default:
			return sendPostTextFallback(ctx, s.gateway, &result, request)
		}
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) replyRichTextWithFallback(ctx context.Context, request SendMessageRequest) (*SendMessageResult, error) {
	return s.replyMessageWithFallback(ctx, request)
}

func sendPostTextFallback(ctx context.Context, gateway Gateway, result **SendMessageResult, request SendMessageRequest) error {
	postContent, postErr := buildPostMessageContent(request.Content)
	if postErr == nil {
		reply := request
		reply.MessageType = "post"
		reply.Content = postContent
		replyResult, err := gateway.ReplyMessage(ctx, reply)
		if err == nil {
			*result = replyResult
			return nil
		}
		postErr = err
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
	replyResult, err := gateway.ReplyMessage(ctx, reply)
	if err == nil {
		*result = replyResult
		return nil
	}
	if postErr != nil {
		return errors.Join(postErr, err)
	}
	return err
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

func extractCardMarkdown(raw string) string {
	payload := map[string]any{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(raw)), &payload); err != nil {
		return ""
	}
	elements, ok := payload["elements"].([]any)
	if !ok {
		return ""
	}
	lines := []string{}
	for _, element := range elements {
		typed, ok := element.(map[string]any)
		if !ok {
			continue
		}
		textValue, ok := typed["text"].(map[string]any)
		if !ok {
			continue
		}
		content, _ := textValue["content"].(string)
		content = strings.TrimSpace(content)
		if content != "" {
			lines = append(lines, content)
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n\n"))
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
