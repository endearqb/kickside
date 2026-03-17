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

	service, _, gateway, _ := newTestService(t, Config{
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

	card := decodeCardPayload(t, gateway.replyCalls[0].Content)
	header := readMapField(t, card, "header")
	title := readMapField(t, header, "title")
	if title["content"] != "Kimi reply" {
		t.Fatalf("expected card title %q, got %#v", "Kimi reply", title["content"])
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

	firstTitle := readMapField(t, readMapField(t, decodeCardPayload(t, requests[0].Content), "header"), "title")
	secondTitle := readMapField(t, readMapField(t, decodeCardPayload(t, requests[1].Content), "header"), "title")
	if firstTitle["content"] != "Kimi reply (1/2)" {
		t.Fatalf("unexpected first title: %#v", firstTitle["content"])
	}
	if secondTitle["content"] != "Kimi reply (2/2)" {
		t.Fatalf("unexpected second title: %#v", secondTitle["content"])
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
