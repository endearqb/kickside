package weixin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapterkit"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/binding"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type fakeInboundExecutor struct {
	result        bridgecore.HandleResult
	err           error
	handleOptions []bridgecore.HandleOptions
}

func (f *fakeInboundExecutor) HandleInbound(
	_ context.Context,
	_ adapterkit.NormalizedInbound,
	options bridgecore.HandleOptions,
	_ bridgecore.TurnEventSink,
) (bridgecore.HandleResult, error) {
	f.handleOptions = append(f.handleOptions, options)
	if f.err != nil {
		return bridgecore.HandleResult{}, f.err
	}
	return f.result, nil
}

func (f *fakeInboundExecutor) ResolveApproval(context.Context, string, string, string) error {
	return nil
}

type noopLogger struct{}

func (noopLogger) Printf(string, ...any) {}

func TestServiceProcessMessageStatusOnlyStartsAndStopsTyping(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	storeHandle, err := store.Open(filepath.Join(dir, "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = storeHandle.Close()
	})
	if err := storeHandle.SyncConfiguredChannels(context.Background(), []config.ChannelConfig{{
		ID:       "weixin-default",
		Platform: "weixin",
		Enabled:  true,
		Mode:     "polling",
		Label:    "Weixin",
	}}); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}

	var (
		mu                sync.Mutex
		gotConfigRequests []GetConfigRequest
		gotTypingRequests []SendTypingRequest
		gotMessages       []SendMessageRequest
	)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		body, _ := io.ReadAll(r.Body)

		switch r.URL.Path {
		case "/ilink/bot/getconfig":
			var request GetConfigRequest
			if err := json.Unmarshal(body, &request); err != nil {
				t.Fatalf("decode getconfig request: %v", err)
			}
			mu.Lock()
			gotConfigRequests = append(gotConfigRequests, request)
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(GetConfigResponse{
				Ret:          0,
				TypingTicket: "ticket-1",
			})
		case "/ilink/bot/sendtyping":
			var request SendTypingRequest
			if err := json.Unmarshal(body, &request); err != nil {
				t.Fatalf("decode sendtyping request: %v", err)
			}
			mu.Lock()
			gotTypingRequests = append(gotTypingRequests, request)
			mu.Unlock()
			_, _ = w.Write([]byte(`{}`))
		case "/ilink/bot/sendmessage":
			var request SendMessageRequest
			if err := json.Unmarshal(body, &request); err != nil {
				t.Fatalf("decode sendmessage request: %v", err)
			}
			mu.Lock()
			gotMessages = append(gotMessages, request)
			mu.Unlock()
			_, _ = w.Write([]byte(`{}`))
		default:
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	orchestrator := &fakeInboundExecutor{
		result: bridgecore.HandleResult{
			ReplyText: "final reply",
			Binding: domain.SessionBinding{
				BindingID: "binding-1",
				Key: domain.BindingKey{
					ConnectorID: "weixin-default",
					Platform:    platformID,
					AccountID:   "acc-1",
					ChatID:      "owner@im.wechat",
				},
				ContextToken:  "ctx-1",
				KimiSessionID: "session-1",
			},
		},
	}
	service := NewService(Options{
		Config: Config{
			ConnectorID:    "weixin-default",
			ConnectorLabel: "Weixin",
			BotToken:       "token-1",
			BaseURL:        server.URL,
			AccountID:      "acc-1",
			OwnerUserID:    "owner@im.wechat",
			DefaultWorkDir: "D:/workspace",
			ReplyMode:      "status_only",
		},
		BindingRouter: binding.NewRouter(storeHandle),
		Orchestrator:  orchestrator,
		Store:         storeHandle,
		Logger:        noopLogger{},
		Client:        NewClient(server.URL, "token-1"),
	})

	err = service.processMessage(context.Background(), WeixinMessage{
		MessageID:    101,
		FromUserID:   "owner@im.wechat",
		ContextToken: "ctx-1",
		ItemList: []MessageItem{
			{Type: 1, TextItem: &TextItem{Text: "hello"}},
		},
	})
	if err != nil {
		t.Fatalf("processMessage returned error: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if len(gotConfigRequests) != 1 {
		t.Fatalf("expected one getconfig request, got %d", len(gotConfigRequests))
	}
	if gotConfigRequests[0].IlinkUserID != "owner@im.wechat" || gotConfigRequests[0].ContextToken != "ctx-1" {
		t.Fatalf("unexpected getconfig request: %+v", gotConfigRequests[0])
	}
	if len(gotTypingRequests) < 2 {
		t.Fatalf("expected typing start and cancel, got %d requests", len(gotTypingRequests))
	}
	if gotTypingRequests[0].Status != 1 {
		t.Fatalf("expected first typing request to start typing, got %+v", gotTypingRequests[0])
	}
	if gotTypingRequests[len(gotTypingRequests)-1].Status != 2 {
		t.Fatalf("expected last typing request to cancel typing, got %+v", gotTypingRequests[len(gotTypingRequests)-1])
	}
	if len(gotMessages) != 1 {
		t.Fatalf("expected one final message, got %d", len(gotMessages))
	}
	if len(orchestrator.handleOptions) != 1 || !orchestrator.handleOptions[0].AutoApprove {
		t.Fatalf("expected weixin bridge to force AutoApprove=true, got %+v", orchestrator.handleOptions)
	}
	if gotMessages[0].Message.MessageState != 2 {
		t.Fatalf("expected final message state FINISH, got %+v", gotMessages[0].Message)
	}
	if gotMessages[0].Message.ContextToken != "ctx-1" {
		t.Fatalf("expected final message to preserve context token, got %+v", gotMessages[0].Message)
	}
	if len(gotMessages[0].Message.ItemList) != 1 ||
		gotMessages[0].Message.ItemList[0].TextItem == nil ||
		strings.TrimSpace(gotMessages[0].Message.ItemList[0].TextItem.Text) != "final reply" {
		t.Fatalf("unexpected outbound message payload: %+v", gotMessages[0].Message)
	}
}

func TestServiceProcessMessagePassesAutoApproveToOrchestrator(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	storeHandle, err := store.Open(filepath.Join(dir, "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = storeHandle.Close()
	})
	if err := storeHandle.SyncConfiguredChannels(context.Background(), []config.ChannelConfig{{
		ID:       "weixin-default",
		Platform: "weixin",
		Enabled:  true,
		Mode:     "polling",
		Label:    "Weixin",
	}}); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/sendmessage" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		defer r.Body.Close()
		_, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer server.Close()

	orchestrator := &fakeInboundExecutor{
		result: bridgecore.HandleResult{
			ReplyText: "approved",
			Binding: domain.SessionBinding{
				BindingID: "binding-1",
				Key: domain.BindingKey{
					ConnectorID: "weixin-default",
					Platform:    platformID,
					AccountID:   "acc-1",
					ChatID:      "owner@im.wechat",
				},
				ContextToken:  "ctx-1",
				KimiSessionID: "session-1",
			},
		},
	}
	service := NewService(Options{
		Config: Config{
			ConnectorID:    "weixin-default",
			ConnectorLabel: "Weixin",
			BotToken:       "token-1",
			BaseURL:        server.URL,
			AccountID:      "acc-1",
			OwnerUserID:    "owner@im.wechat",
			DefaultWorkDir: "D:/workspace",
			ReplyMode:      "final_only",
		},
		BindingRouter: binding.NewRouter(storeHandle),
		Orchestrator:  orchestrator,
		Store:         storeHandle,
		Logger:        noopLogger{},
		Client:        NewClient(server.URL, "token-1"),
	})

	err = service.processMessage(context.Background(), WeixinMessage{
		MessageID:    101,
		FromUserID:   "owner@im.wechat",
		ContextToken: "ctx-1",
		ItemList: []MessageItem{
			{Type: 1, TextItem: &TextItem{Text: "hello"}},
		},
	})
	if err != nil {
		t.Fatalf("processMessage returned error: %v", err)
	}
	if len(orchestrator.handleOptions) != 1 {
		t.Fatalf("expected one HandleInbound call, got %d", len(orchestrator.handleOptions))
	}
	if !orchestrator.handleOptions[0].AutoApprove {
		t.Fatalf("expected AutoApprove=true, got %+v", orchestrator.handleOptions[0])
	}
	if orchestrator.handleOptions[0].DefaultWorkDir != "D:/workspace" {
		t.Fatalf("expected DefaultWorkDir to be preserved, got %+v", orchestrator.handleOptions[0])
	}
}
