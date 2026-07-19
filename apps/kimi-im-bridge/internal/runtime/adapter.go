package runtime

import (
	"context"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

const (
	RuntimeAdapterServer = "server"
	RuntimeAdapterACP    = "acp"
	RuntimeAdapterSDK    = "sdk"
)

type RuntimeAdapter interface {
	EnsureWorkspace(context.Context, string) (WorkspaceRef, error)
	EnsureSession(context.Context, EnsureSessionRequest) (SessionRef, error)
	SubmitPrompt(context.Context, AdapterPromptRequest, AdapterEventSink) (AdapterPromptResult, error)
	ListApprovals(context.Context, string) ([]RuntimeApproval, error)
	ResolveApproval(context.Context, string, string, ApprovalDecision) error
	AbortPrompt(context.Context, string, string) error
	Close() error
}

type WorkspaceRef struct {
	WorkspaceID string `json:"workspaceId"`
	Root        string `json:"root"`
}

type SessionCreateMode string

const (
	SessionCreateIfMissing SessionCreateMode = "if_missing"
	SessionCreateAlways    SessionCreateMode = "always"
	SessionResumeExact     SessionCreateMode = "resume_exact"
	SessionReuseLatest     SessionCreateMode = "reuse_latest"
)

type EnsureSessionRequest struct {
	KimiCodeSessionID string            `json:"kimiCodeSessionId,omitempty"`
	WorkspaceRoot     string            `json:"workspaceRoot,omitempty"`
	WorkspaceID       string            `json:"workspaceId,omitempty"`
	SessionSource     string            `json:"sessionSource,omitempty"`
	CreateMode        SessionCreateMode `json:"createMode,omitempty"`
}

type SessionRef struct {
	KimiCodeSessionID string `json:"kimiCodeSessionId"`
	WorkspaceRoot     string `json:"workspaceRoot,omitempty"`
	WorkspaceID       string `json:"workspaceId,omitempty"`
	SessionSource     string `json:"sessionSource,omitempty"`
	RuntimeAdapter    string `json:"runtimeAdapter"`
}

type RuntimeSessionState struct {
	SessionID     string `json:"sessionId"`
	WorkspaceID   string `json:"workspaceId,omitempty"`
	WorkspaceRoot string `json:"workspaceRoot,omitempty"`
	Status        string `json:"status"`
	LastSeq       int64  `json:"lastSeq"`
	ObservedAt    string `json:"observedAt"`
	Generation    int64  `json:"generation,omitempty"`
}

type AdapterPromptRequest struct {
	SessionID     string                    `json:"sessionId"`
	WorkspaceRoot string                    `json:"workspaceRoot,omitempty"`
	Text          string                    `json:"text"`
	Attachments   []domain.PromptAttachment `json:"attachments,omitempty"`
	Controls      RuntimeControls           `json:"controls,omitempty"`
	Metadata      map[string]any            `json:"metadata,omitempty"`
}

type RuntimeControls struct {
	Model          string `json:"model,omitempty"`
	Thinking       string `json:"thinking,omitempty"`
	PermissionMode string `json:"permissionMode,omitempty"`
	PlanMode       bool   `json:"planMode,omitempty"`
	SwarmMode      bool   `json:"swarmMode,omitempty"`
	GoalObjective  string `json:"goalObjective,omitempty"`
	GoalControl    string `json:"goalControl,omitempty"`
}

type AdapterPromptResult struct {
	PromptID      string `json:"promptId"`
	UserMessageID string `json:"userMessageId,omitempty"`
	Status        string `json:"status"`
}

type PromptFailureError struct {
	Code    string
	Message string
}

func (e *PromptFailureError) Error() string {
	if e == nil {
		return "runtime prompt failed"
	}
	return firstNonEmptyString(e.Code, "runtime_failed") + ": " + firstNonEmptyString(e.Message, "Runtime prompt failed")
}

type AdapterEventSink func(AdapterEvent) error

type AdapterEvent struct {
	Type      string           `json:"type"`
	PromptID  string           `json:"promptId,omitempty"`
	Status    string           `json:"status,omitempty"`
	Text      string           `json:"text,omitempty"`
	Error     string           `json:"error,omitempty"`
	ErrorCode string           `json:"errorCode,omitempty"`
	Approval  *RuntimeApproval `json:"approval,omitempty"`
}

type RuntimeApproval struct {
	ApprovalID       string `json:"approvalId"`
	SessionID        string `json:"sessionId"`
	ToolCallID       string `json:"toolCallId,omitempty"`
	ToolName         string `json:"toolName,omitempty"`
	Action           string `json:"action,omitempty"`
	ToolInputDisplay any    `json:"toolInputDisplay,omitempty"`
	CreatedAt        string `json:"createdAt,omitempty"`
	ExpiresAt        string `json:"expiresAt,omitempty"`
}

type ApprovalDecision struct {
	Decision      string `json:"decision"`
	Scope         string `json:"scope,omitempty"`
	Feedback      string `json:"feedback,omitempty"`
	SelectedLabel string `json:"selectedLabel,omitempty"`
}
