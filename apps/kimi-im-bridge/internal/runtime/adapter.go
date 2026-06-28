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

type EnsureSessionRequest struct {
	KimiCodeSessionID string `json:"kimiCodeSessionId,omitempty"`
	WorkspaceRoot     string `json:"workspaceRoot,omitempty"`
	WorkspaceID       string `json:"workspaceId,omitempty"`
	SessionSource     string `json:"sessionSource,omitempty"`
}

type SessionRef struct {
	KimiCodeSessionID string `json:"kimiCodeSessionId"`
	WorkspaceRoot     string `json:"workspaceRoot,omitempty"`
	WorkspaceID       string `json:"workspaceId,omitempty"`
	SessionSource     string `json:"sessionSource,omitempty"`
	RuntimeAdapter    string `json:"runtimeAdapter"`
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

type AdapterEventSink func(AdapterEvent) error

type AdapterEvent struct {
	Type     string           `json:"type"`
	PromptID string           `json:"promptId,omitempty"`
	Status   string           `json:"status,omitempty"`
	Text     string           `json:"text,omitempty"`
	Error    string           `json:"error,omitempty"`
	Approval *RuntimeApproval `json:"approval,omitempty"`
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
