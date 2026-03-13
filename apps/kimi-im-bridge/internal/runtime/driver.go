package runtime

import "context"

type Driver interface {
	OpenSession(PromptRequest) (DriverSession, error)
}

type DriverSession interface {
	StartPrompt(context.Context, PromptRequest) (PromptStream, error)
	Close() error
}

type PromptStream interface {
	Events() <-chan DriverEvent
	Result() <-chan DriverResult
	Close() error
}

type DriverEventType string

const (
	driverEventStepStarted       DriverEventType = "step_started"
	driverEventContentDelta      DriverEventType = "content_delta"
	driverEventStatusUpdate      DriverEventType = "status_update"
	driverEventApprovalRequested DriverEventType = "approval_requested"
	driverEventApprovalResolved  DriverEventType = "approval_resolved"
)

type DriverEvent struct {
	Type               DriverEventType
	StepIndex          int
	Text               string
	Thinking           string
	Status             string
	MessageID          string
	ApprovalID         string
	RequestKind        string
	Prompt             string
	RequestPayloadJSON string
	ContextUsage       float64
	TokenUsage         TokenUsage
	Responder          ApprovalResponder
}

type DriverResult struct {
	Status       string
	Error        error
	ContextUsage float64
	TokenUsage   TokenUsage
}
