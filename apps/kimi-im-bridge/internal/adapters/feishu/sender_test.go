package feishu

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestSendReplyUsesInteractiveCardsWhenEnabled(t *testing.T) {
	t.Parallel()

	service, storeHandle, gateway, _ := newTestService(t, Config{
		AppID:         "cli_a",
		AppSecret:     "secret",
		ReplyRenderer: "interactive",
	})

	err := service.sendReply(context.Background(), &MessageEvent{
		MessageID: "msg-1",
		ChatID:    "chat-1",
	}, domain.SessionBinding{
		Key: domain.BindingKey{
			ChatID: "chat-1",
		},
	}, "## Title\n\n- item")
	if err != nil {
		t.Fatalf("sendReply returned error: %v", err)
	}

	if len(gateway.replyCalls) != 1 {
		t.Fatalf("expected one outbound card reply, got %d", len(gateway.replyCalls))
	}
	if gateway.replyCalls[0].MessageType != "interactive" {
		t.Fatalf("expected interactive reply, got %q", gateway.replyCalls[0].MessageType)
	}
	event, err := storeHandle.GetDeliveryEventByKey(context.Background(), "feishu:chat-1:msg-1:reply:0")
	if err != nil {
		t.Fatalf("GetDeliveryEventByKey returned error: %v", err)
	}
	if event == nil || event.Renderer != "interactive" {
		t.Fatalf("expected interactive renderer to be recorded, got %+v", event)
	}

	card := decodeCardPayload(t, gateway.replyCalls[0].Content)
	if _, ok := card["header"]; ok {
		t.Fatalf("expected reply card to omit header, got %#v", card["header"])
	}

	elements, ok := card["elements"].([]any)
	if !ok || len(elements) != 1 {
		t.Fatalf("expected one card element, got %#v", card["elements"])
	}
	body := readMapField(t, elements[0], "text")
	if body["tag"] != "lark_md" {
		t.Fatalf("expected lark_md body, got %#v", body["tag"])
	}
	content, _ := body["content"].(string)
	if !strings.Contains(content, "## Title") || !strings.Contains(content, "- item") {
		t.Fatalf("expected markdown content to be preserved, got %q", content)
	}
}

func TestBuildReplyRequestsKeepsRichTextFallbackWhenPostRendererSelected(t *testing.T) {
	t.Parallel()

	requests, err := buildReplyRequests(MessageEvent{
		MessageID: "msg-2",
		ChatID:    "chat-2",
	}, "plain reply", "post")
	if err != nil {
		t.Fatalf("buildReplyRequests returned error: %v", err)
	}
	if len(requests) != 1 {
		t.Fatalf("expected one rich-text request, got %d", len(requests))
	}
	if requests[0].MessageType != "post" {
		t.Fatalf("expected post reply when card mode is disabled, got %q", requests[0].MessageType)
	}
	if requests[0].Content != "plain reply" {
		t.Fatalf("expected raw text content for post fallback, got %q", requests[0].Content)
	}
}

func TestBuildReplyCardRequestsSplitLongReplies(t *testing.T) {
	t.Parallel()

	requests, err := buildReplyCardRequests(MessageEvent{
		MessageID: "msg-3",
		ChatID:    "chat-3",
	}, strings.Repeat("a", feishuCardMaxRunes)+"tail")
	if err != nil {
		t.Fatalf("buildReplyCardRequests returned error: %v", err)
	}
	if len(requests) != 2 {
		t.Fatalf("expected two card chunks, got %d", len(requests))
	}

	firstCard := decodeCardPayload(t, requests[0].Content)
	secondCard := decodeCardPayload(t, requests[1].Content)
	if _, ok := firstCard["header"]; ok {
		t.Fatalf("expected first chunk reply card to omit header, got %#v", firstCard["header"])
	}
	if _, ok := secondCard["header"]; ok {
		t.Fatalf("expected second chunk reply card to omit header, got %#v", secondCard["header"])
	}
}

func decodeCardPayload(t *testing.T, raw string) map[string]any {
	t.Helper()

	payload := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatalf("failed to decode card payload: %v", err)
	}
	return payload
}

func readMapField(t *testing.T, value any, key string) map[string]any {
	t.Helper()

	typed, ok := value.(map[string]any)
	if !ok {
		t.Fatalf("expected map payload, got %#v", value)
	}
	field, ok := typed[key].(map[string]any)
	if !ok {
		t.Fatalf("expected map field %q, got %#v", key, typed[key])
	}
	return field
}
