package weixin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestClientGetUpdatesUsesIlinkEndpointAndBaseInfo(t *testing.T) {
	t.Parallel()

	var (
		gotPath   string
		gotHeader http.Header
		gotBody   GetUpdatesRequest
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotHeader = r.Header.Clone()
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(data, &gotBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		_ = json.NewEncoder(w).Encode(GetUpdatesResponse{
			Ret:           0,
			GetUpdatesBuf: "next-buf",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token-123")
	resp, err := client.GetUpdates(context.Background(), GetUpdatesRequest{
		GetUpdatesBuf: "prev-buf",
		BaseInfo:      defaultBaseInfo(),
		TimeoutMS:     9999,
	})
	if err != nil {
		t.Fatalf("get updates: %v", err)
	}

	if gotPath != "/ilink/bot/getupdates" {
		t.Fatalf("unexpected path: %s", gotPath)
	}
	if gotBody.GetUpdatesBuf != "prev-buf" {
		t.Fatalf("unexpected get_updates_buf: %#v", gotBody)
	}
	if gotBody.BaseInfo.ChannelVersion != defaultChannelVersion {
		t.Fatalf("missing base_info: %#v", gotBody.BaseInfo)
	}
	if gotHeader.Get("AuthorizationType") != "ilink_bot_token" {
		t.Fatalf("unexpected AuthorizationType: %q", gotHeader.Get("AuthorizationType"))
	}
	if gotHeader.Get("Authorization") != "Bearer token-123" {
		t.Fatalf("unexpected Authorization: %q", gotHeader.Get("Authorization"))
	}
	if gotHeader.Get("X-WECHAT-UIN") == "" {
		t.Fatalf("expected X-WECHAT-UIN header")
	}
	if resp.GetUpdatesBuf != "next-buf" {
		t.Fatalf("unexpected response: %#v", resp)
	}
}

func TestClientSendMessageUsesIlinkEndpointAndWrappedMessage(t *testing.T) {
	t.Parallel()

	var (
		gotPath string
		gotBody SendMessageRequest
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("read body: %v", err)
		}
		if err := json.Unmarshal(data, &gotBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	client := NewClient(server.URL, "token-xyz")
	err := client.SendMessage(context.Background(), SendMessageRequest{
		Message: OutboundWeixinMessage{
			FromUserID:   "",
			ToUserID:     "user-1",
			ClientID:     "client-1",
			MessageType:  2,
			MessageState: 2,
			ContextToken: "ctx-1",
			ItemList: []MessageItem{
				{Type: 1, TextItem: &TextItem{Text: "hello"}},
			},
		},
		BaseInfo: defaultBaseInfo(),
	})
	if err != nil {
		t.Fatalf("send message: %v", err)
	}

	if gotPath != "/ilink/bot/sendmessage" {
		t.Fatalf("unexpected path: %s", gotPath)
	}
	if gotBody.Message.ToUserID != "user-1" || gotBody.Message.ClientID != "client-1" {
		t.Fatalf("unexpected message body: %#v", gotBody.Message)
	}
	if gotBody.Message.MessageType != 2 || gotBody.Message.MessageState != 2 {
		t.Fatalf("unexpected message state: %#v", gotBody.Message)
	}
	if gotBody.BaseInfo.ChannelVersion != defaultChannelVersion {
		t.Fatalf("missing base_info: %#v", gotBody.BaseInfo)
	}
	if len(gotBody.Message.ItemList) != 1 || gotBody.Message.ItemList[0].TextItem == nil || gotBody.Message.ItemList[0].TextItem.Text != "hello" {
		t.Fatalf("unexpected item list: %#v", gotBody.Message.ItemList)
	}
}

func TestClientGetUpdatesRetriesUnexpectedEOF(t *testing.T) {
	t.Parallel()

	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if attempts.Add(1) == 1 {
			hijacker, ok := w.(http.Hijacker)
			if !ok {
				t.Fatalf("response writer does not support hijack")
			}
			conn, _, err := hijacker.Hijack()
			if err != nil {
				t.Fatalf("hijack: %v", err)
			}
			_ = conn.Close()
			return
		}
		_ = json.NewEncoder(w).Encode(GetUpdatesResponse{
			Ret:           0,
			GetUpdatesBuf: "retried-buf",
		})
	}))
	defer server.Close()

	client := NewClient(server.URL, "token-retry")
	resp, err := client.GetUpdates(context.Background(), GetUpdatesRequest{
		GetUpdatesBuf: "prev",
		BaseInfo:      defaultBaseInfo(),
		TimeoutMS:     9999,
	})
	if err != nil {
		t.Fatalf("expected retry to recover, got %v", err)
	}
	if attempts.Load() != 2 {
		t.Fatalf("expected 2 attempts, got %d", attempts.Load())
	}
	if resp.GetUpdatesBuf != "retried-buf" {
		t.Fatalf("unexpected response after retry: %#v", resp)
	}
}
