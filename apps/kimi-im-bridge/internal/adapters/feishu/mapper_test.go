package feishu

import "testing"

func TestMapMessageToInbound(t *testing.T) {
	t.Parallel()

	t.Run("private chat text is accepted", func(t *testing.T) {
		t.Parallel()
		inbound, key, ok := mapMessageToInbound(&MessageEvent{
			MessageID:   "msg-1",
			ChatID:      "chat-1",
			ChatType:    "p2p",
			MessageType: "text",
			Content:     `{"text":"hello"}`,
			SenderID:    "ou_user_1",
		})
		if !ok {
			t.Fatalf("expected private chat message to be accepted")
		}
		if inbound.Text != "hello" || key.ChatID != "chat-1" || key.ThreadID != "" {
			t.Fatalf("unexpected mapping result: inbound=%+v key=%+v", inbound, key)
		}
	})

	t.Run("group explicit summon is accepted and stripped", func(t *testing.T) {
		t.Parallel()
		inbound, _, ok := mapMessageToInbound(&MessageEvent{
			MessageID:   "msg-2",
			ChatID:      "chat-2",
			ChatType:    "group",
			MessageType: "text",
			Content:     `{"text":"<at user_id=\"ou_bot\">Kimi</at>   帮我总结一下"}`,
		})
		if !ok {
			t.Fatalf("expected explicit summon to be accepted")
		}
		if inbound.Text != "帮我总结一下" {
			t.Fatalf("expected summon prefix to be stripped, got %q", inbound.Text)
		}
	})

	t.Run("topic group uses root id as thread fallback", func(t *testing.T) {
		t.Parallel()
		inbound, key, ok := mapMessageToInbound(&MessageEvent{
			MessageID:   "msg-3",
			ChatID:      "chat-3",
			RootID:      "root-3",
			ChatType:    "topic_group",
			MessageType: "text",
			Content:     `{"text":"@Kimi 继续上一个回答"}`,
		})
		if !ok {
			t.Fatalf("expected topic group explicit summon to be accepted")
		}
		if inbound.ThreadID != "root-3" || key.ThreadID != "root-3" {
			t.Fatalf("expected root id to be used as thread fallback, inbound=%+v key=%+v", inbound, key)
		}
	})

	t.Run("unsupported messages are skipped", func(t *testing.T) {
		t.Parallel()
		if _, _, ok := mapMessageToInbound(&MessageEvent{
			MessageID:   "msg-4",
			ChatID:      "chat-4",
			ChatType:    "group",
			MessageType: "image",
			Content:     `{"image_key":"img"}`,
		}); ok {
			t.Fatalf("expected non-text event to be skipped")
		}
	})
}

func TestApprovalCodecAndChunking(t *testing.T) {
	t.Parallel()

	value, ok := decodeActionValue(map[string]string{
		"approval_id": "approval-1",
		"decision":    approvalDecisionApproved,
		"chat_id":     "chat-1",
		"thread_id":   "thread-1",
	})
	if !ok || value.ApprovalID != "approval-1" || value.Decision != approvalDecisionApproved {
		t.Fatalf("unexpected action value result: value=%+v ok=%v", value, ok)
	}

	chunks := splitTextChunks("abcdef", 2)
	if len(chunks) != 3 || chunks[0] != "ab" || chunks[2] != "ef" {
		t.Fatalf("unexpected chunking result: %+v", chunks)
	}
}
