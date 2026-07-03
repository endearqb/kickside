package bridgecore

import (
	"context"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapterkit"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

type EventKind string

const (
	EventTurnAccepted      EventKind = "turn.accepted"
	EventTurnStarted       EventKind = "turn.started"
	EventStepStarted       EventKind = "step.started"
	EventContentDelta      EventKind = "content.delta"
	EventStatusUpdated     EventKind = "status.updated"
	EventArtifactReady     EventKind = "artifact.ready"
	EventApprovalRequested EventKind = "approval.requested"
	EventApprovalResolved  EventKind = "approval.resolved"
	EventTurnCompleted     EventKind = "turn.completed"
	EventTurnFailed        EventKind = "turn.failed"
)

type TokenUsage struct {
	InputOther         int `json:"inputOther,omitempty"`
	Output             int `json:"output,omitempty"`
	InputCacheRead     int `json:"inputCacheRead,omitempty"`
	InputCacheCreation int `json:"inputCacheCreation,omitempty"`
}

type RuntimeTarget struct {
	Platform string
	ChatID   string
	ThreadID string
}

type TurnRequest struct {
	TurnID        string
	Prompt        string
	WorkDir       string
	KimiSessionID string
	AutoApprove   bool
	MetadataJSON  string
	Attachments   []domain.PromptAttachment
}

type TurnResult struct {
	KimiSessionID string
	Status        string
	Error         string
	ContextUsage  float64
	TokenUsage    TokenUsage
}

type TurnEvent struct {
	EventID            string
	Kind               EventKind
	TurnID             string
	KimiSessionID      string
	ConnectorID        string
	Platform           string
	ChatID             string
	ThreadID           string
	StepIndex          int
	MessageID          string
	TextDelta          string
	ThinkingDelta      string
	Status             string
	RequestKind        string
	Prompt             string
	ApprovalID         string
	RequestPayloadJSON string
	ResolutionJSON     string
	ContextUsage       float64
	TokenUsage         TokenUsage
	ErrorCode          string
	Error              string
	Artifact           *domain.RuntimeArtifact
	At                 string
}

type TurnEventSink func(TurnEvent) error

type HandleOptions struct {
	DefaultWorkDir string
	AutoApprove    bool
	MetadataJSON   string
	Attachments    []domain.PromptAttachment
}

type HandleResult struct {
	Binding   domain.SessionBinding
	TurnID    string
	SessionID string
	ReplyText string
	Artifacts []domain.RuntimeArtifact
	Renderer  string
	Duplicate bool
	Result    TurnResult
}

type BindingResolver interface {
	ResolveBinding(context.Context, domain.BindingKey) (*domain.SessionBinding, error)
	CreateBinding(context.Context, domain.BindingKey, string, string, string) (*domain.SessionBinding, error)
	Rebind(context.Context, string, string) error
}

type RuntimeProvider interface {
	RunTurn(context.Context, RuntimeTarget, TurnRequest, TurnEventSink) (TurnResult, error)
	ResolveApproval(context.Context, string, string, string) error
	ReconcilePendingApprovals(context.Context, string) (int, error)
	Close() error
}

type RuntimeSessionRequest struct {
	KimiSessionID string
	WorkDir       string
}

type RuntimeSession struct {
	KimiSessionID string
	WorkDir       string
	Source        string
}

type RuntimeSessionEnsurer interface {
	EnsureSession(context.Context, RuntimeTarget, RuntimeSessionRequest) (RuntimeSession, error)
}

type ApprovalStore interface {
	CreateApprovalTicket(context.Context, domain.ApprovalTicket) error
}

type TurnStore interface {
	UpsertSession(context.Context, domain.BridgeSession) error
	CreateTurn(context.Context, domain.BridgeTurn) error
	UpdateTurn(context.Context, domain.BridgeTurn) error
}

type TurnEventStore interface {
	AppendTurnEvent(context.Context, domain.TurnEventRecord) error
}

type Orchestrator struct {
	bindings  BindingResolver
	runtime   RuntimeProvider
	approvals ApprovalStore
	turns     TurnStore
	events    TurnEventStore
}

func NewOrchestrator(
	bindings BindingResolver,
	runtime RuntimeProvider,
	approvals ApprovalStore,
	turns TurnStore,
	events TurnEventStore,
) *Orchestrator {
	return &Orchestrator{
		bindings:  bindings,
		runtime:   runtime,
		approvals: approvals,
		turns:     turns,
		events:    events,
	}
}

type InboundExecutor interface {
	HandleInbound(context.Context, adapterkit.NormalizedInbound, HandleOptions, TurnEventSink) (HandleResult, error)
	ResolveApproval(context.Context, string, string, string) error
}
