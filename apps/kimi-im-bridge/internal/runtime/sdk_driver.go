package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	kimi "github.com/MoonshotAI/kimi-agent-sdk/go"
	"github.com/MoonshotAI/kimi-agent-sdk/go/wire"
)

type SDKDriverOptions struct {
	Executable string
}

type SDKDriver struct {
	options SDKDriverOptions
}

func NewSDKDriver(options SDKDriverOptions) *SDKDriver {
	return &SDKDriver{options: options}
}

func (d *SDKDriver) OpenSession(request PromptRequest) (DriverSession, error) {
	options := make([]kimi.Option, 0, 4)
	if d.options.Executable != "" {
		options = append(options, kimi.WithExecutable(d.options.Executable))
	}
	if request.KimiSessionID != "" {
		options = append(options, kimi.WithSession(request.KimiSessionID))
	}
	if request.WorkDir != "" {
		options = append(options, kimi.WithWorkDir(request.WorkDir))
	}
	if request.AutoApprove {
		options = append(options, kimi.WithAutoApprove())
	}

	session, err := kimi.NewSession(options...)
	if err != nil {
		return nil, err
	}
	return &sdkDriverSession{session: session}, nil
}

type sdkDriverSession struct {
	session *kimi.Session
}

func (s *sdkDriverSession) StartPrompt(ctx context.Context, request PromptRequest) (PromptStream, error) {
	turn, err := s.session.Prompt(ctx, wire.NewStringContent(request.Prompt))
	if err != nil {
		return nil, err
	}

	stream := &sdkPromptStream{
		turn:    turn,
		events:  make(chan DriverEvent),
		result:  make(chan DriverResult, 1),
	}
	go stream.consume()
	return stream, nil
}

func (s *sdkDriverSession) Close() error {
	if s == nil || s.session == nil {
		return nil
	}
	return s.session.Close()
}

type sdkPromptStream struct {
	turn      *kimi.Turn
	events    chan DriverEvent
	result    chan DriverResult
	closeOnce sync.Once
}

func (s *sdkPromptStream) Events() <-chan DriverEvent {
	return s.events
}

func (s *sdkPromptStream) Result() <-chan DriverResult {
	return s.result
}

func (s *sdkPromptStream) Close() error {
	s.closeOnce.Do(func() {})
	return nil
}

func (s *sdkPromptStream) consume() {
	defer close(s.events)
	defer close(s.result)

	stepIndex := 0
	for step := range s.turn.Steps {
		stepIndex++
		s.events <- DriverEvent{
			Type:      driverEventStepStarted,
			StepIndex: stepIndex,
		}
		for message := range step.Messages {
			event, ok, err := mapWireMessage(stepIndex, message)
			if err != nil {
				s.result <- DriverResult{
					Status: "failed",
					Error:  err,
				}
				return
			}
			if ok {
				s.events <- event
			}
		}
	}

	usage := s.turn.Usage()
	driverResult := DriverResult{
		Status: string(s.turn.Result().Status),
		Error:  s.turn.Err(),
	}
	if usage != nil {
		driverResult.ContextUsage = usage.Context
		driverResult.TokenUsage = TokenUsage{
			InputOther:         usage.Tokens.InputOther,
			Output:             usage.Tokens.Output,
			InputCacheRead:     usage.Tokens.InputCacheRead,
			InputCacheCreation: usage.Tokens.InputCacheCreation,
		}
	}
	s.result <- driverResult
}

func mapWireMessage(stepIndex int, message wire.Message) (DriverEvent, bool, error) {
	switch value := message.(type) {
	case wire.ContentPart:
		event := DriverEvent{
			Type:      driverEventContentDelta,
			StepIndex: stepIndex,
		}
		switch value.Type {
		case wire.ContentPartTypeText:
			event.Text = value.Text.Value
		case wire.ContentPartTypeThink:
			event.Thinking = value.Think.Value
		default:
			return DriverEvent{}, false, nil
		}
		return event, true, nil
	case wire.StatusUpdate:
		event := DriverEvent{
			Type:      driverEventStatusUpdate,
			StepIndex: stepIndex,
			TokenUsage: TokenUsage{
				InputOther:         value.TokenUsage.Value.InputOther,
				Output:             value.TokenUsage.Value.Output,
				InputCacheRead:     value.TokenUsage.Value.InputCacheRead,
				InputCacheCreation: value.TokenUsage.Value.InputCacheCreation,
			},
		}
		if value.ContextUsage.Valid {
			event.ContextUsage = value.ContextUsage.Value
		}
		if value.MessageID.Valid {
			event.MessageID = value.MessageID.Value
		}
		return event, true, nil
	case wire.ApprovalRequest:
		payload, err := json.Marshal(struct {
			ID          string              `json:"id"`
			ToolCallID  string              `json:"toolCallId,omitempty"`
			Sender      string              `json:"sender,omitempty"`
			Action      string              `json:"action,omitempty"`
			Description string              `json:"description,omitempty"`
			Display     []wire.DisplayBlock `json:"display,omitempty"`
		}{
			ID:          value.ID,
			ToolCallID:  value.ToolCallID,
			Sender:      value.Sender,
			Action:      value.Action,
			Description: value.Description,
			Display:     value.Display,
		})
		if err != nil {
			return DriverEvent{}, false, fmt.Errorf("marshal approval request %s: %w", value.ID, err)
		}
		requestKind := strings.TrimSpace(value.Action)
		if requestKind == "" {
			requestKind = "approval"
		}
		return DriverEvent{
			Type:               driverEventApprovalRequested,
			StepIndex:          stepIndex,
			ApprovalID:         value.ID,
			RequestKind:        requestKind,
			Prompt:             value.Description,
			RequestPayloadJSON: string(payload),
			Responder:          sdkApprovalResponder{request: value},
		}, true, nil
	case wire.ApprovalResponse:
		return DriverEvent{
			Type:       driverEventApprovalResolved,
			StepIndex:  stepIndex,
			ApprovalID: value.RequestID,
			Status:     approvalResponseStatus(value.Response),
		}, true, nil
	default:
		return DriverEvent{}, false, nil
	}
}

type sdkApprovalResponder struct {
	request wire.ApprovalRequest
}

func (r sdkApprovalResponder) Respond(_ context.Context, status string, _ string) error {
	response, err := approvalResponseFromStatus(status)
	if err != nil {
		return err
	}
	return r.request.Respond(response)
}

func approvalResponseFromStatus(status string) (wire.ApprovalRequestResponse, error) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "approved", "approve":
		return wire.ApprovalRequestResponseApprove, nil
	case "approved_for_session", "approve_for_session":
		return wire.ApprovalRequestResponseApproveForSession, nil
	case "rejected", "reject", "denied":
		return wire.ApprovalRequestResponseReject, nil
	default:
		return "", fmt.Errorf("unsupported approval status %q", status)
	}
}

func approvalResponseStatus(status wire.ApprovalRequestResponse) string {
	switch status {
	case wire.ApprovalRequestResponseApprove:
		return "approved"
	case wire.ApprovalRequestResponseApproveForSession:
		return "approved_for_session"
	case wire.ApprovalRequestResponseReject:
		return "rejected"
	default:
		return strings.ToLower(string(status))
	}
}
