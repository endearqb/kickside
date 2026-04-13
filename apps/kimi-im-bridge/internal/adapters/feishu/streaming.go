package feishu

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

const (
	feishuStreamingPreviewMaxRunes = 1800
	feishuStreamingFlushInterval   = 800 * time.Millisecond
)

type feishuStreamingState string

const (
	feishuStreamingStateGenerating feishuStreamingState = "generating"
	feishuStreamingStateCompleted  feishuStreamingState = "completed"
	feishuStreamingStateFailed     feishuStreamingState = "failed"
)

type feishuReplyStreamer struct {
	service         *Service
	source          *MessageEvent
	binding         domain.SessionBinding
	artifacts       []domain.RuntimeArtifact
	deliveryKey     string
	sourceMessageID string

	mu              sync.Mutex
	content         strings.Builder
	visible         bool
	degraded        bool
	targetMessageID string
	lastRendered    string
	lastState       feishuStreamingState
	lastFlushAt     time.Time
	statusDetail    string
}

func (s *Service) streamingRepliesEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(s.config.ReplyRenderer), "streaming")
}

func (s *Service) newReplyStreamer(
	source *MessageEvent,
	binding domain.SessionBinding,
	artifacts []domain.RuntimeArtifact,
) *feishuReplyStreamer {
	return &feishuReplyStreamer{
		service:         s,
		source:          source,
		binding:         binding,
		artifacts:       append([]domain.RuntimeArtifact(nil), artifacts...),
		deliveryKey:     fmt.Sprintf("feishu:%s:%s:reply:stream", binding.Key.ChatID, source.MessageID),
		sourceMessageID: strings.TrimSpace(source.MessageID),
		lastState:       feishuStreamingStateGenerating,
	}
}

func (stream *feishuReplyStreamer) handleBridgeEvent(ctx context.Context, event bridgecore.TurnEvent) {
	switch event.Kind {
	case bridgecore.EventContentDelta:
		if strings.TrimSpace(event.TextDelta) != "" {
			stream.appendDelta(event.TextDelta)
			stream.tryFlush(ctx, feishuStreamingStateGenerating, false)
		}
	case bridgecore.EventStatusUpdated:
		stream.setStatusDetail(event.Status)
		if stream.hasVisibleContent() {
			stream.tryFlush(ctx, feishuStreamingStateGenerating, false)
		}
	}
}

func (stream *feishuReplyStreamer) handleRuntimeEvent(ctx context.Context, event runtime.PromptEvent) {
	switch event.Type {
	case runtime.EventTypeContentDelta:
		if strings.TrimSpace(event.Text) != "" {
			stream.appendDelta(event.Text)
			stream.tryFlush(ctx, feishuStreamingStateGenerating, false)
		}
	case runtime.EventTypeStatusUpdate:
		stream.setStatusDetail(event.Status)
		if stream.hasVisibleContent() {
			stream.tryFlush(ctx, feishuStreamingStateGenerating, false)
		}
	}
}

func (stream *feishuReplyStreamer) finish(ctx context.Context, finalText string) error {
	finalText = strings.TrimSpace(finalText)
	if finalText != "" {
		stream.replaceContent(finalText)
	}

	text := stream.currentText()
	if text == "" {
		return stream.service.sendArtifacts(ctx, stream.source, stream.artifacts)
	}

	if stream.degraded || exceedsRuneLimit(text, feishuStreamingPreviewMaxRunes) {
		if stream.visible {
			_ = stream.patchCard(
				ctx,
				feishuStreamingStateCompleted,
				"完整回复较长，已改为后续分段消息。",
				truncateRunes(text, feishuStreamingPreviewMaxRunes),
			)
		}
		return stream.service.sendReplyBundleWithRenderer(
			ctx,
			stream.source,
			stream.binding,
			text,
			stream.artifacts,
			"interactive",
		)
	}

	if err := stream.flush(ctx, feishuStreamingStateCompleted, true); err != nil {
		return stream.service.sendReplyBundleWithRenderer(
			ctx,
			stream.source,
			stream.binding,
			text,
			stream.artifacts,
			"interactive",
		)
	}
	return stream.service.sendArtifacts(ctx, stream.source, stream.artifacts)
}

func (stream *feishuReplyStreamer) handleFailure(ctx context.Context, runErr error) error {
	text := stream.currentText()
	if text == "" {
		if stream.visible {
			_ = stream.patchCard(ctx, feishuStreamingStateFailed, summarizeFeishuStreamError(runErr), "")
			return nil
		}
		return runErr
	}
	if stream.visible {
		if err := stream.patchCard(ctx, feishuStreamingStateFailed, summarizeFeishuStreamError(runErr), text); err == nil {
			return nil
		}
	}
	if err := stream.service.sendReplyBundleWithRenderer(
		ctx,
		stream.source,
		stream.binding,
		text,
		nil,
		"interactive",
	); err == nil {
		return nil
	}
	return runErr
}

func (stream *feishuReplyStreamer) tryFlush(
	ctx context.Context,
	state feishuStreamingState,
	force bool,
) {
	if err := stream.flush(ctx, state, force); err != nil {
		stream.mu.Lock()
		stream.degraded = true
		stream.mu.Unlock()
	}
}

func (stream *feishuReplyStreamer) flush(
	ctx context.Context,
	state feishuStreamingState,
	force bool,
) error {
	text := stream.currentText()
	if text == "" {
		return nil
	}
	if exceedsRuneLimit(text, feishuStreamingPreviewMaxRunes) {
		return fmt.Errorf("stream content exceeded feishu streaming preview limit")
	}

	stream.mu.Lock()
	if stream.degraded {
		stream.mu.Unlock()
		return nil
	}
	if !force && stream.visible && time.Since(stream.lastFlushAt) < feishuStreamingFlushInterval {
		stream.mu.Unlock()
		return nil
	}
	if stream.visible && stream.lastRendered == text && stream.lastState == state {
		stream.mu.Unlock()
		return nil
	}
	detail := stream.statusDetail
	stream.mu.Unlock()

	if err := stream.ensureAnchor(ctx, state, detail, text); err != nil {
		return err
	}
	stream.mu.Lock()
	alreadyRendered := stream.lastRendered == text && stream.lastState == state
	stream.mu.Unlock()
	if alreadyRendered {
		return nil
	}
	return stream.patchCard(ctx, state, detail, text)
}

func (stream *feishuReplyStreamer) ensureAnchor(
	ctx context.Context,
	state feishuStreamingState,
	detail string,
	text string,
) error {
	stream.mu.Lock()
	if stream.visible && strings.TrimSpace(stream.targetMessageID) != "" {
		stream.mu.Unlock()
		return nil
	}
	stream.mu.Unlock()

	existing, err := stream.service.store.GetDeliveryEventByKey(ctx, stream.deliveryKey)
	if err != nil {
		return reliability.Wrap("unknown", err)
	}
	if existing != nil && existing.Status == "sent" && strings.TrimSpace(existing.TargetMessageID) != "" {
		stream.mu.Lock()
		stream.visible = true
		stream.targetMessageID = strings.TrimSpace(existing.TargetMessageID)
		stream.mu.Unlock()
		return nil
	}

	payloadJSON, err := marshalJSON(map[string]any{
		"replyToMessageId": stream.source.MessageID,
		"chatId":           stream.source.ChatID,
		"messageType":      "interactive",
		"streaming":        true,
	})
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}
	if existing == nil {
		_, err = stream.service.store.RecordDeliveryEventIfAbsent(ctx, domain.DeliveryEvent{
			EventID:         uuid.NewString(),
			ConnectorID:     stream.service.connectorID(),
			Platform:        platformID,
			ChatID:          strings.TrimSpace(stream.binding.Key.ChatID),
			ThreadID:        strings.TrimSpace(stream.binding.Key.ThreadID),
			Direction:       "outbound",
			DeliveryKey:     stream.deliveryKey,
			SourceMessageID: stream.sourceMessageID,
			DeliveryKind:    "reply_stream",
			Renderer:        "streaming",
			PayloadJSON:     payloadJSON,
			Status:          "pending",
		})
		if err != nil {
			return reliability.Wrap("unknown", err)
		}
	}

	content, err := buildStreamingReplyCardContent(state, detail, text)
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}

	request := SendMessageRequest{
		ReplyToMessageID: stream.source.MessageID,
		ChatID:           stream.source.ChatID,
		MessageType:      "interactive",
		Content:          content,
		UUID:             uuid.NewString(),
	}

	var result *SendMessageResult
	err = stream.service.executeOutbound(ctx, "reply_message", func(ctx context.Context) error {
		replyResult, replyErr := stream.service.gateway.ReplyMessage(ctx, request)
		if replyErr == nil {
			result = replyResult
		}
		return replyErr
	})
	if err != nil {
		_ = stream.service.store.UpdateDeliveryEventStatus(ctx, stream.deliveryKey, "failed", err.Error())
		return err
	}

	targetMessageID := ""
	if result != nil {
		targetMessageID = strings.TrimSpace(result.MessageID)
	}
	if err := stream.service.store.UpdateDeliveryEventSent(ctx, stream.deliveryKey, targetMessageID); err != nil {
		return reliability.Wrap("unknown", err)
	}
	if err := stream.service.store.TouchChannelOutbound(ctx, stream.service.connectorID(), ""); err != nil {
		return reliability.Wrap("unknown", err)
	}

	stream.mu.Lock()
	stream.visible = true
	stream.targetMessageID = targetMessageID
	stream.lastRendered = text
	stream.lastState = state
	stream.lastFlushAt = time.Now()
	stream.mu.Unlock()
	return nil
}

func (stream *feishuReplyStreamer) patchCard(
	ctx context.Context,
	state feishuStreamingState,
	detail string,
	text string,
) error {
	stream.mu.Lock()
	targetMessageID := strings.TrimSpace(stream.targetMessageID)
	stream.mu.Unlock()
	if targetMessageID == "" {
		return fmt.Errorf("streaming card target message id is missing")
	}

	content, err := buildStreamingReplyCardContent(state, detail, text)
	if err != nil {
		return reliability.Wrap("payload_invalid", err)
	}
	err = stream.service.executeOutbound(ctx, "patch_message", func(ctx context.Context) error {
		return stream.service.gateway.PatchMessage(ctx, targetMessageID, content)
	})
	if err != nil {
		return err
	}
	if err := stream.service.store.TouchChannelOutbound(ctx, stream.service.connectorID(), ""); err != nil {
		return reliability.Wrap("unknown", err)
	}

	stream.mu.Lock()
	stream.lastRendered = text
	stream.lastState = state
	stream.lastFlushAt = time.Now()
	stream.mu.Unlock()
	return nil
}

func (stream *feishuReplyStreamer) appendDelta(text string) {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	stream.content.WriteString(text)
}

func (stream *feishuReplyStreamer) replaceContent(text string) {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	stream.content.Reset()
	stream.content.WriteString(text)
}

func (stream *feishuReplyStreamer) currentText() string {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return strings.TrimSpace(stream.content.String())
}

func (stream *feishuReplyStreamer) setStatusDetail(detail string) {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	stream.statusDetail = strings.TrimSpace(detail)
}

func (stream *feishuReplyStreamer) hasVisibleContent() bool {
	stream.mu.Lock()
	defer stream.mu.Unlock()
	return stream.visible
}

func buildStreamingReplyCardContent(
	state feishuStreamingState,
	detail string,
	text string,
) (string, error) {
	statusText, template := feishuStreamingHeader(state)
	body := strings.TrimSpace(text)
	if body == "" {
		switch state {
		case feishuStreamingStateFailed:
			body = "_本轮没有可发送的文本内容。_"
		case feishuStreamingStateCompleted:
			body = "_本轮已完成，但没有文本输出。_"
		default:
			body = "_正在生成中…_"
		}
	}
	elements := []any{
		buildMarkdownElement(fmt.Sprintf("**%s**", statusText)),
		buildMarkdownElement(body),
	}
	if trimmed := strings.TrimSpace(detail); trimmed != "" {
		elements = append(elements, buildMarkdownElement(trimmed))
	}
	return marshalJSON(map[string]any{
		"config": map[string]any{
			"wide_screen_mode": true,
			"update_multi":     true,
		},
		"header": map[string]any{
			"template": template,
			"title": map[string]string{
				"tag":     "plain_text",
				"content": "Kimi 回复",
			},
		},
		"elements": elements,
	})
}

func feishuStreamingHeader(state feishuStreamingState) (string, string) {
	switch state {
	case feishuStreamingStateCompleted:
		return "已完成", "green"
	case feishuStreamingStateFailed:
		return "生成失败", "red"
	default:
		return "生成中", "blue"
	}
}

func summarizeFeishuStreamError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.Join(strings.Fields(strings.TrimSpace(err.Error())), " ")
	if len([]rune(message)) > 120 {
		return truncateRunes(message, 120)
	}
	return message
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	if limit <= 1 {
		return string(runes[:limit])
	}
	return string(runes[:limit-1]) + "…"
}

func exceedsRuneLimit(value string, limit int) bool {
	if limit <= 0 {
		return false
	}
	return len([]rune(strings.TrimSpace(value))) > limit
}
