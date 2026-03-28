package runtime

import "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"

type PromptRequest struct {
	KimiSessionID string `json:"kimiSessionId,omitempty"`
	Prompt        string `json:"prompt"`
	WorkDir       string `json:"workDir,omitempty"`
	AutoApprove   bool   `json:"autoApprove,omitempty"`
	Attachments   []domain.PromptAttachment `json:"attachments,omitempty"`
}

type PromptResponse struct {
	KimiSessionID string        `json:"kimiSessionId"`
	TurnID        string        `json:"turnId"`
	Events        []PromptEvent `json:"events"`
	Result        PromptResult  `json:"result"`
}

type PromptEventSink func(PromptEvent) error

type PromptEventType string

const (
	EventTypeTurnStarted       PromptEventType = "turn_started"
	EventTypeStepStarted       PromptEventType = "step_started"
	EventTypeContentDelta      PromptEventType = "content_delta"
	EventTypeStatusUpdate      PromptEventType = "status_update"
	EventTypeArtifactReady     PromptEventType = "artifact_ready"
	EventTypeApprovalRequested PromptEventType = "approval_requested"
	EventTypeApprovalResolved  PromptEventType = "approval_resolved"
	EventTypeTurnCompleted     PromptEventType = "turn_completed"
	EventTypeTurnFailed        PromptEventType = "turn_failed"
)

type PromptEvent struct {
	Type               PromptEventType `json:"type"`
	StepIndex          int             `json:"stepIndex,omitempty"`
	Text               string          `json:"text,omitempty"`
	Thinking           string          `json:"thinking,omitempty"`
	Status             string          `json:"status,omitempty"`
	MessageID          string          `json:"messageId,omitempty"`
	ApprovalID         string          `json:"approvalId,omitempty"`
	RequestKind        string          `json:"requestKind,omitempty"`
	Prompt             string          `json:"prompt,omitempty"`
	RequestPayloadJSON string          `json:"requestPayloadJson,omitempty"`
	ContextUsage       float64         `json:"contextUsage,omitempty"`
	TokenUsage         TokenUsage      `json:"tokenUsage,omitempty"`
	Artifact           *domain.RuntimeArtifact `json:"artifact,omitempty"`
	Error              string          `json:"error,omitempty"`
}

type PromptResult struct {
	Status       string     `json:"status"`
	Error        string     `json:"error,omitempty"`
	ContextUsage float64    `json:"contextUsage,omitempty"`
	TokenUsage   TokenUsage `json:"tokenUsage,omitempty"`
}

type TokenUsage struct {
	InputOther         int `json:"inputOther,omitempty"`
	Output             int `json:"output,omitempty"`
	InputCacheRead     int `json:"inputCacheRead,omitempty"`
	InputCacheCreation int `json:"inputCacheCreation,omitempty"`
}
