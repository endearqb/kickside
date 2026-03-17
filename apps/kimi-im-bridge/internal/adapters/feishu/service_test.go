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
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/reliability"
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
	if len(gateway.replyCalls) != 3 {
		t.Fatalf("expected onboarding + two outbound replies, got %d", len(gateway.replyCalls))
	}
	if gateway.replyCalls[0].MessageType != "interactive" {
		t.Fatalf("expected first outbound message to be onboarding card, got %+v", gateway.replyCalls[0])
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
		ChatType:    "group",
		MessageType: "text",
		Content:     `{"text":"@kimi hello"}`,
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

func TestServiceProcessMessageDoesNotAutoOnboardGroupChats(t *testing.T) {
	t.Parallel()

	service, _, gateway, runtimeExec := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	runtimeExec.responses = []fakeRuntimeResponse{
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: "group reply"}}},
	}

	advance, err := service.processMessageEvent(context.Background(), &MessageEvent{
		EventID:     "evt-group-1",
		MessageID:   "msg-group-1",
		ChatID:      "chat-group-1",
		ChatType:    "group",
		MessageType: "text",
		Content:     `{"text":"@kimi hello group"}`,
	})
	if err != nil || !advance {
		t.Fatalf("group processMessageEvent returned advance=%v err=%v", advance, err)
	}
	if len(gateway.replyCalls) != 1 {
		t.Fatalf("expected only one normal reply for group chat, got %d", len(gateway.replyCalls))
	}
	if gateway.replyCalls[0].MessageType == "interactive" {
		t.Fatalf("expected no auto-onboarding card in group, got %+v", gateway.replyCalls[0])
	}
}

func TestServiceProcessMessageAutoOnboardsOnlyOncePerBindingVersion(t *testing.T) {
	t.Parallel()

	service, storeHandle, gateway, runtimeExec := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	router := binding.NewRouter(storeHandle)
	created, err := router.CreateBinding(context.Background(), domain.BindingKey{
		Platform: platformID,
		ChatID:   "chat-onboard-1",
	}, "session-1", "", "auto")
	if err != nil {
		t.Fatalf("CreateBinding returned error: %v", err)
	}
	if err := router.UpdateBindingOnboarding(context.Background(), created.BindingID, currentOnboardingVersion); err != nil {
		t.Fatalf("UpdateBindingOnboarding returned error: %v", err)
	}

	runtimeExec.responses = []fakeRuntimeResponse{
		{events: []runtime.PromptEvent{{Type: runtime.EventTypeContentDelta, Text: "reply"}}},
	}
	advance, err := service.processMessageEvent(context.Background(), &MessageEvent{
		EventID:     "evt-onboard-1",
		MessageID:   "msg-onboard-1",
		ChatID:      "chat-onboard-1",
		ChatType:    "p2p",
		MessageType: "text",
		Content:     `{"text":"hello"}`,
	})
	if err != nil || !advance {
		t.Fatalf("processMessageEvent returned advance=%v err=%v", advance, err)
	}
	if len(gateway.replyCalls) != 1 {
		t.Fatalf("expected only normal reply once onboarding already current, got %d", len(gateway.replyCalls))
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

func TestServiceProcessCardActionAppliesPresetWorkDir(t *testing.T) {
	t.Parallel()

	service, storeHandle, _, _ := newTestService(t, Config{
		AppID:          "cli_a",
		AppSecret:      "secret",
		DefaultWorkDir: "D:/default",
		WorkDirPresets: []WorkDirPreset{
			{Name: "Repo", Path: "D:/repo"},
		},
	})

	result, err := service.processCardAction(context.Background(), &CardActionEvent{
		EventID:   "evt-card-preset-1",
		MessageID: "card-msg-1",
		ChatID:    "chat-1",
		ActionValue: map[string]string{
			"action":      cardActionSetPresetWorkDir,
			"chat_id":     "chat-1",
			"thread_id":   "thread-1",
			"preset_name": "Repo",
			"preset_path": "D:/repo",
		},
	})
	if err != nil {
		t.Fatalf("processCardAction returned error: %v", err)
	}
	if result == nil || result.UpdatedCard == nil {
		t.Fatalf("expected updated cwd card, got %+v", result)
	}

	binding, err := binding.NewRouter(storeHandle).ResolveBinding(context.Background(), domain.BindingKey{
		Platform: platformID,
		ChatID:   "chat-1",
		ThreadID: "thread-1",
	})
	if err != nil {
		t.Fatalf("ResolveBinding returned error: %v", err)
	}
	if binding == nil || binding.WorkDir != "D:/repo" {
		t.Fatalf("expected binding workdir to be preset path, got %+v", binding)
	}
}

func TestServiceProcessCardActionClearsWorkDirOverride(t *testing.T) {
	t.Parallel()

	service, storeHandle, _, _ := newTestService(t, Config{
		AppID:          "cli_a",
		AppSecret:      "secret",
		DefaultWorkDir: "D:/default",
		WorkDirPresets: []WorkDirPreset{
			{Name: "Repo", Path: "D:/repo"},
		},
	})
	router := binding.NewRouter(storeHandle)
	created, err := router.CreateBinding(context.Background(), domain.BindingKey{
		Platform: platformID,
		ChatID:   "chat-2",
		ThreadID: "thread-2",
	}, "session-1", "D:/repo", "manual")
	if err != nil {
		t.Fatalf("CreateBinding returned error: %v", err)
	}

	result, err := service.processCardAction(context.Background(), &CardActionEvent{
		EventID:   "evt-card-clear-1",
		MessageID: "card-msg-2",
		ChatID:    "chat-2",
		ActionValue: map[string]string{
			"action":    cardActionClearWorkDir,
			"chat_id":   "chat-2",
			"thread_id": "thread-2",
		},
	})
	if err != nil {
		t.Fatalf("processCardAction returned error: %v", err)
	}
	if result == nil || result.UpdatedCard == nil {
		t.Fatalf("expected updated cwd card, got %+v", result)
	}

	updated, err := router.ResolveBinding(context.Background(), created.Key)
	if err != nil {
		t.Fatalf("ResolveBinding returned error: %v", err)
	}
	if updated == nil || updated.WorkDir != "" {
		t.Fatalf("expected binding workdir to be cleared, got %+v", updated)
	}
}

func TestServiceProcessCardActionShowsOnboardingPanelAndMarksBinding(t *testing.T) {
	t.Parallel()

	service, storeHandle, _, _ := newTestService(t, Config{
		AppID:          "cli_a",
		AppSecret:      "secret",
		DefaultWorkDir: "D:/default",
	})
	router := binding.NewRouter(storeHandle)
	created, err := router.CreateBinding(context.Background(), domain.BindingKey{
		Platform: platformID,
		ChatID:   "chat-start-1",
		ThreadID: "thread-start-1",
	}, "session-1", "D:/default", "auto")
	if err != nil {
		t.Fatalf("CreateBinding returned error: %v", err)
	}

	result, err := service.processCardAction(context.Background(), &CardActionEvent{
		EventID:   "evt-card-start-1",
		MessageID: "card-msg-start-1",
		ChatID:    "chat-start-1",
		ActionValue: map[string]string{
			"action":    cardActionShowPanel,
			"panel":     bridgePanelStart,
			"chat_id":   "chat-start-1",
			"thread_id": "thread-start-1",
		},
	})
	if err != nil {
		t.Fatalf("processCardAction returned error: %v", err)
	}
	if result == nil || result.UpdatedCard == nil {
		t.Fatalf("expected updated onboarding card, got %+v", result)
	}

	updated, err := router.ResolveBinding(context.Background(), created.Key)
	if err != nil {
		t.Fatalf("ResolveBinding returned error: %v", err)
	}
	if updated == nil || updated.OnboardingVersion != currentOnboardingVersion || updated.OnboardedAt == "" {
		t.Fatalf("expected onboarding metadata to be stored, got %+v", updated)
	}
}

func TestServiceProcessCardActionShowsDoctorPanelWhenProbeFails(t *testing.T) {
	t.Parallel()

	service, _, _, _ := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	service.gateway.(*fakeGateway).probeErr = &APIError{Operation: "probe_credentials", Message: "bad credentials"}

	result, err := service.processCardAction(context.Background(), &CardActionEvent{
		EventID:   "evt-card-doctor-1",
		MessageID: "card-msg-doctor-1",
		ChatID:    "chat-doctor-1",
		ActionValue: map[string]string{
			"action":    cardActionShowPanel,
			"panel":     bridgePanelDoctor,
			"chat_id":   "chat-doctor-1",
			"thread_id": "thread-doctor-1",
		},
	})
	if err != nil {
		t.Fatalf("processCardAction returned error: %v", err)
	}
	if result == nil || result.UpdatedCard == nil {
		t.Fatalf("expected updated doctor card, got %+v", result)
	}
	rendered := fmt.Sprintf("%+v", result.UpdatedCard)
	if !strings.Contains(rendered, "Bridge doctor") || !strings.Contains(rendered, "Live probe: `failed`") {
		t.Fatalf("expected doctor card to mention failed probe, got %s", rendered)
	}
}

func TestServiceProcessMessageBridgeDoctorCommandSendsDoctorCard(t *testing.T) {
	t.Parallel()

	service, _, gateway, _ := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})

	advance, err := service.processMessageEvent(context.Background(), &MessageEvent{
		EventID:     "evt-doctor-cmd-1",
		MessageID:   "msg-doctor-cmd-1",
		ChatID:      "chat-doctor-cmd-1",
		ChatType:    "p2p",
		MessageType: "text",
		Content:     `{"text":"/bridge doctor"}`,
	})
	if err != nil || !advance {
		t.Fatalf("processMessageEvent returned advance=%v err=%v", advance, err)
	}
	if len(gateway.replyCalls) != 1 || gateway.replyCalls[0].MessageType != "interactive" {
		t.Fatalf("expected one interactive doctor card reply, got %+v", gateway.replyCalls)
	}
	if !strings.Contains(gateway.replyCalls[0].Content, "Bridge doctor") {
		t.Fatalf("expected doctor card payload, got %s", gateway.replyCalls[0].Content)
	}
}

func TestConvertCardActionResultUsesCardJSONForUpdatedCards(t *testing.T) {
	t.Parallel()

	response := convertCardActionResult(&CardActionResult{
		Toast: "approved",
		UpdatedCard: map[string]any{
			"config": map[string]any{
				"wide_screen_mode": true,
			},
			"header": map[string]any{
				"template": "green",
				"title": map[string]string{
					"tag":     "plain_text",
					"content": "Approval approved",
				},
			},
		},
	})

	if response == nil {
		t.Fatal("expected non-nil card action response")
	}
	if response.Card == nil {
		t.Fatalf("expected updated card payload, got %+v", response)
	}
	if response.Card.Type != "card_json" {
		t.Fatalf("expected card update type card_json, got %q", response.Card.Type)
	}
	if response.Toast == nil || response.Toast.Content != "approved" {
		t.Fatalf("expected approval toast to be preserved, got %+v", response.Toast)
	}
}

func TestServiceStartInvalidCredentialsMarksChannelError(t *testing.T) {
	t.Parallel()

	service, storeHandle, gateway, _ := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	gateway.probeErr = &APIError{Operation: "probe_credentials", Message: "bad credentials"}

	if err := service.Start(context.Background()); err == nil {
		t.Fatalf("expected Start to fail for invalid credentials")
	}

	statuses, err := storeHandle.ListChannelStatuses(context.Background())
	if err != nil {
		t.Fatalf("ListChannelStatuses returned error: %v", err)
	}
	if len(statuses) != 1 || statuses[0].State != domain.ChannelStateError || statuses[0].LastErrorCode != "invalid_credentials" {
		t.Fatalf("expected feishu channel to be error/invalid_app_credentials, got %+v", statuses)
	}
}

func TestServiceReplyRetriesRateLimitedFailure(t *testing.T) {
	t.Parallel()

	service, _, gateway, _ := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	now := time.Unix(0, 0)
	sleeps := []time.Duration{}
	service.delivery = reliability.NewExecutor(reliability.ExecutorOptions{
		Platform: "feishu",
		Now: func() time.Time {
			return now
		},
		Sleep: func(_ context.Context, delay time.Duration) bool {
			sleeps = append(sleeps, delay)
			now = now.Add(delay)
			return true
		},
	})

	attempts := 0
	gateway.replyFunc = func(_ context.Context, request SendMessageRequest) (*SendMessageResult, error) {
		attempts++
		if attempts <= 2 {
			return nil, &APIError{Operation: "reply_message", Message: "frequency limit exceeded"}
		}
		return &SendMessageResult{MessageID: "reply-ok"}, nil
	}

	_, err := service.replyRichTextWithFallback(context.Background(), SendMessageRequest{
		ReplyToMessageID: "msg-1",
		ChatID:           "chat-1",
		MessageType:      "post",
		Content:          "hello",
		UUID:             "uuid-1",
	})
	if err != nil {
		t.Fatalf("replyRichTextWithFallback returned error: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("expected 3 gateway reply calls across retry, got %d", attempts)
	}
	if len(sleeps) == 0 || sleeps[0] != time.Second {
		t.Fatalf("expected default retry sleep of 1s, got %+v", sleeps)
	}
}

func TestServiceReplyClassifiesPermissionFailureWithoutRetry(t *testing.T) {
	t.Parallel()

	service, _, gateway, _ := newTestService(t, Config{
		AppID:     "cli_a",
		AppSecret: "secret",
	})
	gateway.replyFunc = func(_ context.Context, request SendMessageRequest) (*SendMessageResult, error) {
		return nil, &APIError{Operation: "reply_message", Message: "permission denied"}
	}

	_, err := service.replyRichTextWithFallback(context.Background(), SendMessageRequest{
		ReplyToMessageID: "msg-2",
		ChatID:           "chat-1",
		MessageType:      "post",
		Content:          "hello",
		UUID:             "uuid-2",
	})
	if err == nil {
		t.Fatal("expected replyRichTextWithFallback to fail")
	}
	if reliability.CodeOf(err, "") != "permission_denied" {
		t.Fatalf("expected permission_denied code, got %q", reliability.CodeOf(err, ""))
	}
	if len(gateway.replyCalls) != 2 {
		t.Fatalf("expected only a single post->text fallback attempt, got %d calls", len(gateway.replyCalls))
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
