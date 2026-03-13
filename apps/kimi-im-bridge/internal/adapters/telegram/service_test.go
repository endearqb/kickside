package telegram

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

type fakeBotAPI struct {
	mu sync.Mutex

	me              *getMeResponse
	meErr           error
	webhook         *webhookInfo
	webhookErr      error
	getUpdatesFunc  func(context.Context, getUpdatesRequest) ([]update, error)
	sendMessageFunc func(context.Context, sendMessageRequest) (*message, error)
	editMessageFunc func(context.Context, editMessageTextRequest) error
	answerFunc      func(context.Context, answerCallbackQueryRequest) error

	getUpdatesCalls []getUpdatesRequest
	sendCalls       []sendMessageRequest
	editCalls       []editMessageTextRequest
	answerCalls     []answerCallbackQueryRequest
}

func (f *fakeBotAPI) GetMe(context.Context) (*getMeResponse, error) {
	if f.meErr != nil {
		return nil, f.meErr
	}
	if f.me != nil {
		return f.me, nil
	}
	return &getMeResponse{ID: 9001, IsBot: true, Username: "kimi_bot"}, nil
}

func (f *fakeBotAPI) GetWebhookInfo(context.Context) (*webhookInfo, error) {
	if f.webhookErr != nil {
		return nil, f.webhookErr
	}
	if f.webhook != nil {
		return f.webhook, nil
	}
	return &webhookInfo{}, nil
}

func (f *fakeBotAPI) GetUpdates(ctx context.Context, request getUpdatesRequest) ([]update, error) {
	f.mu.Lock()
	f.getUpdatesCalls = append(f.getUpdatesCalls, request)
	fn := f.getUpdatesFunc
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, request)
	}
	<-ctx.Done()
	return nil, ctx.Err()
}

func (f *fakeBotAPI) SendMessage(ctx context.Context, request sendMessageRequest) (*message, error) {
	f.mu.Lock()
	f.sendCalls = append(f.sendCalls, request)
	fn := f.sendMessageFunc
	callIndex := len(f.sendCalls)
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, request)
	}
	return &message{MessageID: int64(10_000 + callIndex)}, nil
}

func (f *fakeBotAPI) EditMessageText(ctx context.Context, request editMessageTextRequest) error {
	f.mu.Lock()
	f.editCalls = append(f.editCalls, request)
	fn := f.editMessageFunc
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, request)
	}
	return nil
}

func (f *fakeBotAPI) AnswerCallbackQuery(ctx context.Context, request answerCallbackQueryRequest) error {
	f.mu.Lock()
	f.answerCalls = append(f.answerCalls, request)
	fn := f.answerFunc
	f.mu.Unlock()
	if fn != nil {
		return fn(ctx, request)
	}
	return nil
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

func TestServiceHandleUpdatesCreatesBindingAndReusesSession(t *testing.T) {
	t.Parallel()

	service, storeHandle, botAPI, runtimeExec := newTestService(t, Config{
		BotToken:       "token",
		DefaultWorkDir: "D:/workspace",
	})
	service.botUsername = "kimi_bot"
	service.botUserID = 9001

	runtimeExec.responses = []fakeRuntimeResponse{
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: "first reply"}}},
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: "second reply"}}},
	}

	offset, err := service.handleUpdates(context.Background(), []update{{
		UpdateID: 10,
		Message: &message{
			MessageID: 1,
			Date:      1_700_000_000,
			Text:      "hello",
			Chat:      chat{ID: 321, Type: "private"},
			From:      &user{ID: 123, Username: "alice"},
		},
	}}, 0)
	if err != nil {
		t.Fatalf("first handleUpdates returned error: %v", err)
	}
	if offset != 11 {
		t.Fatalf("expected offset 11 after first update, got %d", offset)
	}

	offset, err = service.handleUpdates(context.Background(), []update{{
		UpdateID: 11,
		Message: &message{
			MessageID: 2,
			Date:      1_700_000_001,
			Text:      "继续",
			Chat:      chat{ID: 321, Type: "private"},
			From:      &user{ID: 123, Username: "alice"},
		},
	}}, offset)
	if err != nil {
		t.Fatalf("second handleUpdates returned error: %v", err)
	}
	if offset != 12 {
		t.Fatalf("expected offset 12 after second update, got %d", offset)
	}

	if len(runtimeExec.execCalls) != 2 {
		t.Fatalf("expected two runtime calls, got %d", len(runtimeExec.execCalls))
	}
	if runtimeExec.execCalls[0].binding.KimiSessionID != runtimeExec.execCalls[1].binding.KimiSessionID {
		t.Fatalf("expected binding session to be reused, got %q and %q", runtimeExec.execCalls[0].binding.KimiSessionID, runtimeExec.execCalls[1].binding.KimiSessionID)
	}
	if runtimeExec.execCalls[0].request.WorkDir != "D:/workspace" {
		t.Fatalf("expected default work dir to be applied, got %q", runtimeExec.execCalls[0].request.WorkDir)
	}

	bindingCount, err := storeHandle.CountBindings(context.Background())
	if err != nil {
		t.Fatalf("CountBindings returned error: %v", err)
	}
	if bindingCount != 1 {
		t.Fatalf("expected exactly one binding, got %d", bindingCount)
	}
	if len(botAPI.sendCalls) != 2 {
		t.Fatalf("expected two outbound replies, got %d", len(botAPI.sendCalls))
	}
}

func TestServiceHandleUpdatesSendFailureDoesNotAdvanceOffsetAndDedupesChunks(t *testing.T) {
	t.Parallel()

	service, storeHandle, botAPI, runtimeExec := newTestService(t, Config{BotToken: "token"})
	runtimeExec.responses = []fakeRuntimeResponse{
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: strings.Repeat("a", 4096) + "tail"}}},
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: strings.Repeat("a", 4096) + "tail"}}},
	}

	sendIndex := 0
	botAPI.sendMessageFunc = func(_ context.Context, _ sendMessageRequest) (*message, error) {
		sendIndex++
		if sendIndex == 2 {
			return nil, fmt.Errorf("temporary send failure")
		}
		return &message{MessageID: int64(9_000 + sendIndex)}, nil
	}

	item := update{
		UpdateID: 100,
		Message: &message{
			MessageID: 9,
			Date:      1_700_000_000,
			Text:      "hello",
			Chat:      chat{ID: 888, Type: "private"},
			From:      &user{ID: 42, Username: "alice"},
		},
	}

	offset, err := service.handleUpdates(context.Background(), []update{item}, 0)
	if err == nil {
		t.Fatalf("expected first handleUpdates call to fail on second chunk send")
	}
	if offset != 0 {
		t.Fatalf("expected offset to stay at 0 after failure, got %d", offset)
	}

	offset, err = service.handleUpdates(context.Background(), []update{item}, 0)
	if err != nil {
		t.Fatalf("second handleUpdates returned error: %v", err)
	}
	if offset != 101 {
		t.Fatalf("expected offset 101 after retry, got %d", offset)
	}
	if len(botAPI.sendCalls) != 3 {
		t.Fatalf("expected first chunk to be deduped on retry, got %d send calls", len(botAPI.sendCalls))
	}

	firstChunk, err := storeHandle.GetDeliveryEventByKey(context.Background(), "telegram:888:9:reply:0")
	if err != nil {
		t.Fatalf("GetDeliveryEventByKey(reply:0) returned error: %v", err)
	}
	secondChunk, err := storeHandle.GetDeliveryEventByKey(context.Background(), "telegram:888:9:reply:1")
	if err != nil {
		t.Fatalf("GetDeliveryEventByKey(reply:1) returned error: %v", err)
	}
	if firstChunk == nil || firstChunk.Status != "sent" || secondChunk == nil || secondChunk.Status != "sent" {
		t.Fatalf("expected both chunks to be sent after retry, got first=%+v second=%+v", firstChunk, secondChunk)
	}
}

func TestServiceProcessCallbackResolvesApproval(t *testing.T) {
	t.Parallel()

	service, storeHandle, botAPI, runtimeExec := newTestService(t, Config{BotToken: "token"})
	if err := storeHandle.CreateApprovalTicket(context.Background(), domain.ApprovalTicket{
		ApprovalID:         "approval-1",
		KimiSessionID:      "session-1",
		TurnID:             "turn-1",
		StepID:             "step-1",
		RequestKind:        "tool",
		Prompt:             "please approve",
		Platform:           "telegram",
		ChatID:             "555",
		ThreadID:           "7",
		Status:             "pending",
		RequestPayloadJSON: "{}",
		DedupeKey:          "telegram:approval:approval-1",
	}); err != nil {
		t.Fatalf("CreateApprovalTicket returned error: %v", err)
	}

	advance, err := service.processCallback(context.Background(), &callbackQuery{
		ID:   "callback-1",
		From: user{ID: 77, Username: "operator"},
		Data: encodeApprovalCallbackData("approval-1", "a"),
		Message: &message{
			MessageID:       10,
			MessageThreadID: 7,
			Chat:            chat{ID: 555, Type: "supergroup"},
		},
	})
	if err != nil {
		t.Fatalf("processCallback returned error: %v", err)
	}
	if !advance {
		t.Fatalf("expected callback update to advance offset")
	}
	if len(runtimeExec.resolveCalls) != 1 || runtimeExec.resolveCalls[0].status != "approved" {
		t.Fatalf("expected approval to be resolved as approved, got %+v", runtimeExec.resolveCalls)
	}
	if len(botAPI.answerCalls) != 1 || len(botAPI.editCalls) != 1 {
		t.Fatalf("expected callback answer and message edit, got answers=%d edits=%d", len(botAPI.answerCalls), len(botAPI.editCalls))
	}
}

func TestServiceStartUsesPersistedOffset(t *testing.T) {
	t.Parallel()

	service, storeHandle, botAPI, _ := newTestService(t, Config{BotToken: "token"})
	if err := storeHandle.UpdateChannelOffset(context.Background(), "telegram", "21"); err != nil {
		t.Fatalf("UpdateChannelOffset returned error: %v", err)
	}

	requests := make(chan getUpdatesRequest, 1)
	botAPI.getUpdatesFunc = func(ctx context.Context, request getUpdatesRequest) ([]update, error) {
		select {
		case requests <- request:
		default:
		}
		<-ctx.Done()
		return nil, ctx.Err()
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := service.Start(ctx); err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	select {
	case request := <-requests:
		if request.Offset != 21 {
			t.Fatalf("expected restored offset 21, got %d", request.Offset)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for telegram polling request")
	}

	cancel()
	select {
	case <-service.Done():
	case <-time.After(2 * time.Second):
		t.Fatalf("timed out waiting for telegram service shutdown")
	}
}

func TestServiceStartInvalidTokenMarksChannelError(t *testing.T) {
	t.Parallel()

	service, storeHandle, botAPI, _ := newTestService(t, Config{BotToken: "token"})
	botAPI.meErr = &APIError{Method: "getMe", ErrorCode: 401, Description: "Unauthorized"}

	if err := service.Start(context.Background()); err == nil {
		t.Fatalf("expected Start to fail for invalid bot token")
	}

	statuses, err := storeHandle.ListChannelStatuses(context.Background())
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) != 1 || statuses[0].State != domain.ChannelStateError || statuses[0].LastError != "invalid_bot_token" {
		t.Fatalf("expected telegram channel to be error/invalid_bot_token, got %+v", statuses)
	}
}

func TestServiceStartWebhookConfiguredMarksChannelError(t *testing.T) {
	t.Parallel()

	service, storeHandle, botAPI, _ := newTestService(t, Config{BotToken: "token"})
	botAPI.webhook = &webhookInfo{URL: "https://example.com/hook"}

	if err := service.Start(context.Background()); err == nil {
		t.Fatalf("expected Start to fail when webhook is configured")
	}

	statuses, err := storeHandle.ListChannelStatuses(context.Background())
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) != 1 || statuses[0].State != domain.ChannelStateError || statuses[0].LastError != "webhook_configured" {
		t.Fatalf("expected telegram channel to be error/webhook_configured, got %+v", statuses)
	}
}

func newTestService(t *testing.T, cfg Config) (*Service, *store.Store, *fakeBotAPI, *fakeRuntimeExecutor) {
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
		Platform: "telegram",
		Enabled:  true,
	}}); err != nil {
		t.Fatalf("SyncConfiguredChannels returned error: %v", err)
	}

	botAPI := &fakeBotAPI{}
	runtimeExec := &fakeRuntimeExecutor{}
	service := NewService(Options{
		Config:        cfg,
		BotAPI:        botAPI,
		BindingRouter: binding.NewRouter(storeHandle),
		Runtime:       runtimeExec,
		Store:         storeHandle,
		Logger:        noopLogger{},
	})
	return service, storeHandle, botAPI, runtimeExec
}
