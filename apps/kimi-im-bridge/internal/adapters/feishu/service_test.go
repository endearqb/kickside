package feishu

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/binding"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type fakeGateway struct {
	mu sync.Mutex

	probeErr  error
	runFunc   func(context.Context, EventHandler) error
	replyFunc func(context.Context, SendMessageRequest) (*SendMessageResult, error)

	replyCalls []SendMessageRequest
}

func (f *fakeGateway) ProbeCredentials(context.Context) error {
	return f.probeErr
}

func (f *fakeGateway) Run(ctx context.Context, handler EventHandler) error {
	if f.runFunc != nil {
		return f.runFunc(ctx, handler)
	}
	<-ctx.Done()
	return nil
}

func (f *fakeGateway) ReplyMessage(ctx context.Context, request SendMessageRequest) (*SendMessageResult, error) {
	f.mu.Lock()
	f.replyCalls = append(f.replyCalls, request)
	fn := f.replyFunc
	callIndex := len(f.replyCalls)
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, request)
	}
	return &SendMessageResult{
		MessageID: fmt.Sprintf("reply-%d", callIndex),
	}, nil
}

type fakeRuntimeExecutor struct {
	mu sync.Mutex

	responses    []fakeRuntimeResponse
	execCalls    []runtimeExecCall
	resolveCalls []runtimeResolveCall
}

type fakeRuntimeResponse struct {
	events []runtime.PromptEvent
	result runtime.PromptResult
	err    error
}

type runtimeExecCall struct {
	binding domain.SessionBinding
	request runtime.PromptRequest
}

type runtimeResolveCall struct {
	approvalID string
	status     string
	payload    string
}

func (f *fakeRuntimeExecutor) ExecuteBindingPrompt(
	ctx context.Context,
	binding domain.SessionBinding,
	request runtime.PromptRequest,
	sink runtime.PromptEventSink,
) (runtime.PromptResponse, error) {
	f.mu.Lock()
	callIndex := len(f.execCalls)
	f.execCalls = append(f.execCalls, runtimeExecCall{binding: binding, request: request})
	var response fakeRuntimeResponse
	if callIndex < len(f.responses) {
		response = f.responses[callIndex]
	}
	f.mu.Unlock()

	for _, event := range response.events {
		if err := sink(event); err != nil {
			return runtime.PromptResponse{
				KimiSessionID: binding.KimiSessionID,
				TurnID:        fmt.Sprintf("turn-%d", callIndex+1),
				Result:        response.result,
			}, err
		}
	}

	result := response.result
	if result.Status == "" {
		result.Status = "completed"
	}
	return runtime.PromptResponse{
		KimiSessionID: binding.KimiSessionID,
		TurnID:        fmt.Sprintf("turn-%d", callIndex+1),
		Result:        result,
	}, response.err
}

func (f *fakeRuntimeExecutor) ResolveApproval(_ context.Context, approvalID string, status string, payload string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resolveCalls = append(f.resolveCalls, runtimeResolveCall{approvalID: approvalID, status: status, payload: payload})
	return nil
}

type noopLogger struct{}

func (noopLogger) Printf(string, ...any) {}

func TestServiceProcessMessageCreatesBindingAndReusesSession(t *testing.T) {
	t.Parallel()

	service, storeHandle, gateway, runtimeExec := newTestService(t, Config{
		AppID:          "cli_a",
		AppSecret:      "secret",
		DefaultWorkDir: "D:/workspace",
	})

	runtimeExec.responses = []fakeRuntimeResponse{
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: "first reply"}}},
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: "second reply"}}},
	}

	advance, err := service.processMessageEvent(context.Background(), &MessageEvent{
		EventID:     "evt-1",
		MessageID:   "msg-1",
		ChatID:      "chat-1",
		ChatType:    "p2p",
		MessageType: "text",
		Content:     `{"text":"hello"}`,
	})
	if err != nil || !advance {
		t.Fatalf("first processMessageEvent returned advance=%v err=%v", advance, err)
	}

	advance, err = service.processMessageEvent(context.Background(), &MessageEvent{
		EventID:     "evt-2",
		MessageID:   "msg-2",
		ChatID:      "chat-1",
		ChatType:    "p2p",
		MessageType: "text",
		Content:     `{"text":"继续"}`,
	})
	if err != nil || !advance {
		t.Fatalf("second processMessageEvent returned advance=%v err=%v", advance, err)
	}

	if len(runtimeExec.execCalls) != 2 {
		t.Fatalf("expected two runtime calls, got %d", len(runtimeExec.execCalls))
	}
	if runtimeExec.execCalls[0].binding.KimiSessionID != runtimeExec.execCalls[1].binding.KimiSessionID {
		t.Fatalf("expected session to be reused, got %q and %q", runtimeExec.execCalls[0].binding.KimiSessionID, runtimeExec.execCalls[1].binding.KimiSessionID)
	}
	if runtimeExec.execCalls[0].request.WorkDir != "D:/workspace" {
		t.Fatalf("expected default work dir to be applied, got %q", runtimeExec.execCalls[0].request.WorkDir)
	}

	bindingCount, err := storeHandle.CountBindings(context.Background())
	if err != nil {
		t.Fatalf("CountBindings returned error: %v", err)
	}
	if bindingCount != 1 {
		t.Fatalf("expected one binding, got %d", bindingCount)
	}
	if len(gateway.replyCalls) != 2 {
		t.Fatalf("expected two outbound replies, got %d", len(gateway.replyCalls))
	}
}

func TestServiceProcessMessageSendFailureDoesNotAdvanceAndDedupesChunks(t *testing.T) {
	t.Parallel()

	service, storeHandle, gateway, runtimeExec := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})

	longText := strings.Repeat("a", feishuTextMaxRunes) + "tail"
	runtimeExec.responses = []fakeRuntimeResponse{
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: longText}}},
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: longText}}},
	}

	failures := 0
	gateway.replyFunc = func(_ context.Context, request SendMessageRequest) (*SendMessageResult, error) {
		if strings.Contains(request.Content, "tail") && failures < 2 {
			failures++
			return nil, fmt.Errorf("temporary reply failure")
		}
		return &SendMessageResult{MessageID: fmt.Sprintf("reply-%d", failures)}, nil
	}

	event := &MessageEvent{
		EventID:     "evt-10",
		MessageID:   "msg-10",
		ChatID:      "chat-10",
		ChatType:    "p2p",
		MessageType: "text",
		Content:     `{"text":"hello"}`,
	}

	advance, err := service.processMessageEvent(context.Background(), event)
	if err == nil || advance {
		t.Fatalf("expected first processMessageEvent to fail without advancing, advance=%v err=%v", advance, err)
	}

	advance, err = service.processMessageEvent(context.Background(), event)
	if err != nil || !advance {
		t.Fatalf("expected retry to succeed, advance=%v err=%v", advance, err)
	}

	if len(gateway.replyCalls) != 4 {
		t.Fatalf("expected first chunk to be deduped on retry, got %d reply calls", len(gateway.replyCalls))
	}

	firstChunk, err := storeHandle.GetDeliveryEventByKey(context.Background(), "feishu:chat-10:msg-10:reply:0")
	if err != nil {
		t.Fatalf("GetDeliveryEventByKey(reply:0) returned error: %v", err)
	}
	secondChunk, err := storeHandle.GetDeliveryEventByKey(context.Background(), "feishu:chat-10:msg-10:reply:1")
	if err != nil {
		t.Fatalf("GetDeliveryEventByKey(reply:1) returned error: %v", err)
	}
	if firstChunk == nil || firstChunk.Status != "sent" || secondChunk == nil || secondChunk.Status != "sent" {
		t.Fatalf("expected both chunks to be sent after retry, got first=%+v second=%+v", firstChunk, secondChunk)
	}
}

func TestServiceProcessCardActionResolvesApproval(t *testing.T) {
	t.Parallel()

	service, storeHandle, _, runtimeExec := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	if err := storeHandle.CreateApprovalTicket(context.Background(), domain.ApprovalTicket{
		ApprovalID:         "approval-1",
		KimiSessionID:      "session-1",
		TurnID:             "turn-1",
		StepID:             "step-1",
		RequestKind:        "tool",
		Prompt:             "please approve",
		Platform:           platformID,
		ChatID:             "chat-1",
		ThreadID:           "thread-1",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "feishu:approval:approval-1",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket returned error: %v", err)
	}

	result, err := service.processCardAction(context.Background(), &CardActionEvent{
		EventID:   "evt-card-1",
		MessageID: "card-msg-1",
		ChatID:    "chat-1",
		ActionValue: map[string]string{
			"approval_id": "approval-1",
			"decision":    approvalDecisionApproved,
			"chat_id":     "chat-1",
			"thread_id":   "thread-1",
		},
		OperatorID: "ou_operator",
	})
	if err != nil {
		t.Fatalf("processCardAction returned error: %v", err)
	}
	if result == nil || result.Toast != "approved" || result.UpdatedCard == nil {
		t.Fatalf("expected updated approval result, got %+v", result)
	}
	if len(runtimeExec.resolveCalls) != 1 || runtimeExec.resolveCalls[0].status != approvalDecisionApproved {
		t.Fatalf("expected approval resolve call, got %+v", runtimeExec.resolveCalls)
	}
}

func TestServiceStartInvalidCredentialsMarksChannelError(t *testing.T) {
	t.Parallel()

	service, storeHandle, gateway, _ := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	gateway.probeErr = withCode("invalid_app_credentials", fmt.Errorf("bad creds"))

	if err := service.Start(context.Background()); err == nil {
		t.Fatalf("expected Start to fail for invalid credentials")
	}

	statuses, err := storeHandle.ListChannelStatuses(context.Background())
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) != 1 || statuses[0].State != domain.ChannelStateError || statuses[0].LastError != "invalid_app_credentials" {
		t.Fatalf("expected feishu channel to be error/invalid_app_credentials, got %+v", statuses)
	}
}

func TestServiceStartSkipsPersistedCheckpoint(t *testing.T) {
	t.Parallel()

	service, storeHandle, gateway, runtimeExec := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	runtimeExec.responses = []fakeRuntimeResponse{
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: "fresh reply"}}},
	}
	if err := storeHandle.UpdateChannelOffset(context.Background(), platformID, "evt-1"); err != nil {
		t.Fatalf("UpdateChannelOffset returned error: %v", err)
	}

	gateway.runFunc = func(ctx context.Context, handler EventHandler) error {
		handler.OnReady(ctx)
		if err := handler.OnMessage(ctx, &MessageEvent{
			EventID:     "evt-1",
			MessageID:   "msg-1",
			ChatID:      "chat-1",
			ChatType:    "p2p",
			MessageType: "text",
			Content:     `{"text":"duplicate"}`,
		}); err != nil {
			return err
		}
		if err := handler.OnMessage(ctx, &MessageEvent{
			EventID:     "evt-2",
			MessageID:   "msg-2",
			ChatID:      "chat-1",
			ChatType:    "p2p",
			MessageType: "text",
			Content:     `{"text":"fresh"}`,
		}); err != nil {
			return err
		}
		return nil
	}

	if err := service.Start(context.Background()); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}
	select {
	case <-service.Done():
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for feishu service shutdown")
	}

	if len(runtimeExec.execCalls) != 1 {
		t.Fatalf("expected only fresh event to execute runtime, got %d calls", len(runtimeExec.execCalls))
	}
	value, ok, err := storeHandle.GetOffset(context.Background(), platformID, feishuOffsetKind)
	if err != nil {
		t.Fatalf("GetOffset returned error: %v", err)
	}
	if !ok || value != "evt-2" {
		t.Fatalf("expected checkpoint evt-2, got ok=%v value=%q", ok, value)
	}
}

func newTestService(t *testing.T, cfg Config) (*Service, *store.Store, *fakeGateway, *fakeRuntimeExecutor) {
	t.Helper()

	dir := t.TempDir()
	storeHandle, err := store.Open(filepath.Join(dir, "bridge.db"))
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = storeHandle.Close()
	})
	if err := storeHandle.SyncConfiguredChannels(context.Background(), []config.ChannelConfig{{
		Platform: "feishu",
		Enabled:  true,
	}}); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}

	gateway := &fakeGateway{}
	runtimeExec := &fakeRuntimeExecutor{}
	service := NewService(Options{
		Config:        cfg,
		Gateway:       gateway,
		BindingRouter: binding.NewRouter(storeHandle),
		Runtime:       runtimeExec,
		Store:         storeHandle,
		Logger:        noopLogger{},
	})
	return service, storeHandle, gateway, runtimeExec
}
