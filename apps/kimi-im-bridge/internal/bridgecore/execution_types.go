package bridgecore

import "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"

type ExecutionTarget struct {
	OriginKind  string
	ConnectorID string
	Platform    string
	ChatID      string
	ThreadID    string
	RoomID      string
	MemberID    string
	AgentID     string
	RunID       string
}

type ExecutionRequest struct {
	TurnID              string
	BindingID           string
	InboundMessageID    string
	Prompt              string
	WorkDir             string
	KimiSessionID       string
	RequireExactSession bool
	AutoApprove         bool
	MetadataJSON        string
	Attachments         []domain.PromptAttachment
}

type ExecutionResult struct {
	TurnID        string
	KimiSessionID string
	PromptID      string
	Status        string
	ReplyText     string
	Artifacts     []domain.RuntimeArtifact
	Error         string
	RuntimeResult TurnResult
}

type ExecutionEvent struct {
	Target ExecutionTarget
	Event  TurnEvent
}

type ExecutionEventSink func(ExecutionEvent) error
