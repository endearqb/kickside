package runtime

import (
	"context"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestSDKAdapterSubmitPromptMapsEvents(t *testing.T) {
	stream := newFakePromptStream()
	approvalStore := newTurnRunnerApprovalStore()
	sessionStore := &fakeSessionStore{}
	adapter, err := NewSDKAdapter(SDKAdapterOptions{
		Driver:        &fakeDriver{stream: stream},
		ApprovalStore: approvalStore,
		SessionStore:  sessionStore,
	})
	if err != nil {
		t.Fatalf("NewSDKAdapter returned error: %v", err)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		stream.events <- DriverEvent{Type: driverEventContentDelta, Text: "hello", Thinking: "thinking"}
		stream.events <- DriverEvent{Type: driverEventApprovalRequested, ApprovalID: "approval-1", RequestKind: "tool", Prompt: "Approve?", RequestPayloadJSON: "{}"}
		close(stream.events)
		stream.result <- DriverResult{Status: "completed"}
		close(stream.result)
	}()

	events := []AdapterEvent{}
	result, err := adapter.SubmitPrompt(context.Background(), AdapterPromptRequest{
		SessionID:     "sdk-session-1",
		WorkspaceRoot: "D:/repo",
		Text:          "hi",
		Controls:      RuntimeControls{PermissionMode: "auto"},
	}, func(event AdapterEvent) error {
		events = append(events, event)
		return nil
	})
	<-done
	if err != nil {
		t.Fatalf("SubmitPrompt returned error: %v", err)
	}
	if result.Status != "completed" || result.PromptID == "" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(events) < 4 || events[1].Type != "thinking_delta" || events[2].Type != "content_delta" || events[3].Type != "approval_requested" {
		t.Fatalf("unexpected events: %+v", events)
	}
	if events[3].Approval == nil || events[3].Approval.ApprovalID != "approval-1" {
		t.Fatalf("expected approval event, got %+v", events[3])
	}
	if ticket, ok := approvalStore.ticket("approval-1"); !ok || ticket.KimiSessionID != "sdk-session-1" {
		t.Fatalf("expected approval ticket, got %+v ok=%v", ticket, ok)
	}
	if sessionStore.lastSession().KimiSessionID != "sdk-session-1" {
		t.Fatalf("expected session upsert, got %+v", sessionStore.lastSession())
	}
}

func TestSDKAdapterEnsureSessionAndApprovalResolution(t *testing.T) {
	approvalStore := newTurnRunnerApprovalStore()
	approvalStore.tickets["approval-1"] = domain.ApprovalTicket{
		ApprovalID:         "approval-1",
		KimiSessionID:      "sdk-session-1",
		Status:             "pending",
		RequestPayloadJSON: "{}",
	}
	adapter, err := NewSDKAdapter(SDKAdapterOptions{
		Driver:        &fakeDriver{stream: newFakePromptStream()},
		ApprovalStore: approvalStore,
		SessionStore:  &fakeSessionStore{},
	})
	if err != nil {
		t.Fatalf("NewSDKAdapter returned error: %v", err)
	}

	session, err := adapter.EnsureSession(context.Background(), EnsureSessionRequest{WorkspaceRoot: "D:/repo"})
	if err != nil {
		t.Fatalf("EnsureSession returned error: %v", err)
	}
	if session.KimiCodeSessionID == "" || session.RuntimeAdapter != RuntimeAdapterSDK || session.SessionSource != "sdk_generated" {
		t.Fatalf("unexpected session: %+v", session)
	}

	approvals, err := adapter.ListApprovals(context.Background(), "sdk-session-1")
	if err != nil {
		t.Fatalf("ListApprovals returned error: %v", err)
	}
	if len(approvals) != 1 || approvals[0].ApprovalID != "approval-1" {
		t.Fatalf("unexpected approvals: %+v", approvals)
	}

	if err := adapter.ResolveApproval(context.Background(), "sdk-session-1", "approval-1", ApprovalDecision{Decision: "approved", Scope: "session"}); err != nil {
		t.Fatalf("ResolveApproval returned error: %v", err)
	}
	if status := approvalStore.resolvedStatus("approval-1"); status != "approved_for_session" {
		t.Fatalf("expected approved_for_session, got %q", status)
	}
}
