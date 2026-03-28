package kimi

import (
	"context"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type Driver interface {
	OpenSession(Request) (DriverSession, error)
}

type DriverSession interface {
	StartPrompt(context.Context, Request) (PromptStream, error)
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
	driverEventArtifactReady     DriverEventType = "artifact_ready"
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
	Artifact           *domain.RuntimeArtifact
	Responder          ApprovalResponder
}

type DriverResult struct {
	Status       string
	Error        error
	ContextUsage float64
	TokenUsage   TokenUsage
}

type Request struct {
	KimiSessionID string
	Prompt        string
	WorkDir       string
	AutoApprove   bool
	Attachments   []domain.PromptAttachment
}

type TokenUsage struct {
	InputOther         int
	Output             int
	InputCacheRead     int
	InputCacheCreation int
}
