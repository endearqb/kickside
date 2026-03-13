package telegram

import "testing"

func TestMapMessageToInbound(t *testing.T) {
	t.Parallel()

	t.Run("private chat text is accepted", func(t *testing.T) {
		t.Parallel()
		inbound, key, ok := mapMessageToInbound(&message{
			MessageID: 11,
			Date:      1_700_000_000,
			Text:      "hello",
			Chat:      chat{ID: 1001, Type: "private"},
			From:      &user{ID: 2001, Username: "alice"},
		}, "kimi_bot", 999)
		if !ok {
			t.Fatalf("expected private message to be accepted")
		}
		if inbound.Text != "hello" || key.ChatID != "1001" || key.ThreadID != "" {
			t.Fatalf("unexpected mapping result: inbound=%+v key=%+v", inbound, key)
		}
	})

	t.Run("group mention is accepted and stripped", func(t *testing.T) {
		t.Parallel()
		inbound, _, ok := mapMessageToInbound(&message{
			MessageID: 12,
			Date:      1_700_000_000,
			Text:      "@kimi_bot   帮我总结一下",
			Chat:      chat{ID: -1001, Type: "group"},
			From:      &user{ID: 2002, Username: "bob"},
		}, "kimi_bot", 999)
		if !ok {
			t.Fatalf("expected group mention to be accepted")
		}
		if inbound.Text != "帮我总结一下" {
			t.Fatalf("expected leading mention to be stripped, got %q", inbound.Text)
		}
	})

	t.Run("reply to bot is accepted in forum topic", func(t *testing.T) {
		t.Parallel()
		inbound, key, ok := mapMessageToInbound(&message{
			MessageID:       13,
			MessageThreadID: 77,
			Date:            1_700_000_000,
			Text:            "继续上一个回答",
			Chat:            chat{ID: -1002, Type: "supergroup"},
			From:            &user{ID: 2003, Username: "charlie"},
			ReplyToMessage:  &message{From: &user{ID: 999, Username: "kimi_bot"}},
		}, "kimi_bot", 999)
		if !ok {
			t.Fatalf("expected reply-to-bot message to be accepted")
		}
		if key.ThreadID != "77" || inbound.ThreadID != "77" {
			t.Fatalf("expected thread id to be preserved, inbound=%+v key=%+v", inbound, key)
		}
	})

	t.Run("unsupported group text is skipped", func(t *testing.T) {
		t.Parallel()
		if _, _, ok := mapMessageToInbound(&message{
			MessageID: 14,
			Date:      1_700_000_000,
			Text:      "大家好",
			Chat:      chat{ID: -1003, Type: "group"},
			From:      &user{ID: 2004},
		}, "kimi_bot", 999); ok {
			t.Fatalf("expected plain group text without summon to be skipped")
		}
	})
}

func TestApprovalCallbackCodecAndChunking(t *testing.T) {
	t.Parallel()

	approvalID, status, ok := decodeApprovalCallbackData(encodeApprovalCallbackData("approval-1", "a"))
	if !ok || approvalID != "approval-1" || status != "approved" {
		t.Fatalf("unexpected callback codec result: approvalID=%q status=%q ok=%v", approvalID, status, ok)
	}

	chunks := splitTextChunks("abcdef", 2)
	if len(chunks) != 3 || chunks[0] != "ab" || chunks[2] != "ef" {
		t.Fatalf("unexpected chunking result: %+v", chunks)
	}
}
