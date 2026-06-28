package runtime

import (
	"context"
	"encoding/json"
	"testing"
)

type fakeACPTransport struct {
	calls                []string
	lastPermissionResult ACPResponse
	notifications        []string
}

func (f *fakeACPTransport) Call(ctx context.Context, method string, params any, handler ACPMessageHandler) (json.RawMessage, error) {
	f.calls = append(f.calls, method)
	switch method {
	case "initialize":
		return json.RawMessage(`{"protocolVersion":1}`), nil
	case "session/new":
		return json.RawMessage(`{"sessionId":"acp-session-1"}`), nil
	case "session/resume":
		return json.RawMessage(`{}`), nil
	case "session/prompt":
		if handler != nil {
			updateParams := json.RawMessage(`{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hello"}}`)
			if _, err := handler(ctx, ACPMessage{Method: "session/update", Params: updateParams}); err != nil {
				return nil, err
			}
			permissionParams := json.RawMessage(`{"toolCall":{"toolCallId":"tool-1","title":"Run command","kind":"shell"},"options":[{"optionId":"allow-1","kind":"allow_once"},{"optionId":"allow-always","kind":"allow_always"},{"optionId":"reject-1","kind":"reject_once"}]}`)
			response, err := handler(ctx, ACPMessage{ID: "99", Method: "session/request_permission", Params: permissionParams})
			if err != nil {
				return nil, err
			}
			f.lastPermissionResult = response
		}
		return json.RawMessage(`{"stopReason":"end_turn","promptId":"prompt-1"}`), nil
	default:
		return json.RawMessage(`{}`), nil
	}
}

func (f *fakeACPTransport) Notify(_ context.Context, method string, _ any) error {
	f.notifications = append(f.notifications, method)
	return nil
}

func (f *fakeACPTransport) Close() error {
	return nil
}

func TestACPAdapterEnsureSessionAndSubmitPrompt(t *testing.T) {
	transport := &fakeACPTransport{}
	adapter, err := NewACPAdapter(ACPAdapterOptions{Transport: transport})
	if err != nil {
		t.Fatalf("NewACPAdapter returned error: %v", err)
	}

	session, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{WorkspaceRoot: "D:/repo"})
	if err != nil {
		t.Fatalf("EnsureSession returned error: %v", err)
	}
	if session.KimiCodeSessionID != "acp-session-1" || session.RuntimeAdapter != RuntimeAdapterACP {
		t.Fatalf("unexpected session: %+v", session)
	}

	events := []AdapterEvent{}
	result, err := adapter.SubmitPrompt(context.Background(), AdapterPromptRequest{
		SessionID: "acp-session-1",
		Text:      "hi",
		Controls:  RuntimeControls{PermissionMode: "auto"},
	}, func(event AdapterEvent) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatalf("SubmitPrompt returned error: %v", err)
	}
	if result.Status != "completed" || result.PromptID != "prompt-1" {
		t.Fatalf("unexpected prompt result: %+v", result)
	}
	if len(events) != 2 || events[0].Type != "content_delta" || events[0].Text != "hello" || events[1].Type != "approval_requested" {
		t.Fatalf("unexpected events: %+v", events)
	}
	if events[1].Approval == nil || events[1].Approval.ApprovalID != "tool-1" {
		t.Fatalf("expected approval event, got %+v", events[1])
	}
	outcome, ok := transport.lastPermissionResult.Result.(map[string]any)["outcome"].(map[string]any)
	if !ok || outcome["optionId"] != "allow-1" {
		t.Fatalf("expected auto approval result, got %+v", transport.lastPermissionResult)
	}
}

func TestACPAdapterManualApprovalWaitsForResolve(t *testing.T) {
	transport := &fakeACPTransport{}
	adapter, err := NewACPAdapter(ACPAdapterOptions{Transport: transport})
	if err != nil {
		t.Fatalf("NewACPAdapter returned error: %v", err)
	}

	events := make(chan AdapterEvent, 1)
	resultCh := make(chan error, 1)
	go func() {
		_, err := adapter.SubmitPrompt(context.Background(), AdapterPromptRequest{
			SessionID: "acp-session-1",
			Text:      "hi",
			Controls:  RuntimeControls{PermissionMode: "manual"},
		}, func(event AdapterEvent) error {
			if event.Type == "approval_requested" {
				events <- event
			}
			return nil
		})
		resultCh <- err
	}()

	event := <-events
	if event.Approval == nil || event.Approval.ApprovalID != "tool-1" {
		t.Fatalf("expected approval event, got %+v", event)
	}
	approvals, err := adapter.ListApprovals(context.Background(), "acp-session-1")
	if err != nil {
		t.Fatalf("ListApprovals returned error: %v", err)
	}
	if len(approvals) != 1 || approvals[0].ApprovalID != "tool-1" {
		t.Fatalf("expected pending ACP approval, got %+v", approvals)
	}
	if err := adapter.ResolveApproval(context.Background(), "acp-session-1", "tool-1", ApprovalDecision{
		Decision: "approved",
		Scope:    "session",
	}); err != nil {
		t.Fatalf("ResolveApproval returned error: %v", err)
	}
	if err := <-resultCh; err != nil {
		t.Fatalf("SubmitPrompt returned error: %v", err)
	}
	outcome, ok := transport.lastPermissionResult.Result.(map[string]any)["outcome"].(map[string]any)
	if !ok || outcome["optionId"] != "allow-always" {
		t.Fatalf("expected manual approval to select session allow option, got %+v", transport.lastPermissionResult)
	}
	approvals, err = adapter.ListApprovals(context.Background(), "acp-session-1")
	if err != nil {
		t.Fatalf("second ListApprovals returned error: %v", err)
	}
	if len(approvals) != 0 {
		t.Fatalf("expected pending ACP approval to be cleared, got %+v", approvals)
	}
}

func TestACPAdapterAbortPromptSendsCancelNotification(t *testing.T) {
	transport := &fakeACPTransport{}
	adapter, err := NewACPAdapter(ACPAdapterOptions{Transport: transport})
	if err != nil {
		t.Fatalf("NewACPAdapter returned error: %v", err)
	}

	if err := adapter.AbortPrompt(context.Background(), "acp-session-1", "prompt-1"); err != nil {
		t.Fatalf("AbortPrompt returned error: %v", err)
	}
	if len(transport.notifications) != 1 || transport.notifications[0] != "session/cancel" {
		t.Fatalf("expected cancel notification, got %+v", transport.notifications)
	}
}
