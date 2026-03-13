package feishu

import (
	"context"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

const (
	platformID         = "feishu"
	feishuOffsetKind   = "feishu_checkpoint"
	feishuTextMaxRunes = 3000
)

type BindingRouter interface {
	ResolveBinding(context.Context, domain.BindingKey) (*domain.SessionBinding, error)
	CreateBinding(context.Context, domain.BindingKey, string, string, string) (*domain.SessionBinding, error)
}

type RuntimeExecutor interface {
	ExecuteBindingPrompt(context.Context, domain.SessionBinding, runtime.PromptRequest, runtime.PromptEventSink) (runtime.PromptResponse, error)
	ResolveApproval(context.Context, string, string, string) error
}

type ChannelStore interface {
	GetOffset(context.Context, string, string) (string, bool, error)
	UpdateChannelState(context.Context, string, domain.ChannelRuntimeState, string, string) error
	UpdateChannelOffset(context.Context, string, string) error
	TouchChannelInbound(context.Context, string, string) error
	TouchChannelOutbound(context.Context, string, string) error
	GetApprovalByID(context.Context, string) (*domain.ApprovalTicket, error)
	GetDeliveryEventByKey(context.Context, string) (*domain.DeliveryEvent, error)
	RecordDeliveryEventIfAbsent(context.Context, domain.DeliveryEvent) (bool, error)
	UpdateDeliveryEventStatus(context.Context, string, string, string) error
}

type Logger interface {
	Printf(string, ...any)
}

type Config struct {
	AppID          string
	AppSecret      string
	DefaultWorkDir string
}

type Options struct {
	Config        Config
	Gateway       Gateway
	BindingRouter BindingRouter
	Runtime       RuntimeExecutor
	Store         ChannelStore
	Logger        Logger
}

type Mention struct {
	ID   string
	Name string
}

type MessageEvent struct {
	EventID     string
	MessageID   string
	RootID      string
	ParentID    string
	ChatID      string
	ThreadID    string
	ChatType    string
	MessageType string
	Content     string
	Mentions    []Mention
	SenderID    string
	SenderName  string
	ReceivedAt  string
	RawRef      string
}

type CardActionEvent struct {
	EventID      string
	MessageID    string
	ChatID       string
	ThreadID     string
	OperatorID   string
	OperatorName string
	ActionValue  map[string]string
	RawRef       string
}

type CardActionResult struct {
	Toast       string
	UpdatedCard map[string]any
}

type SendMessageRequest struct {
	ReplyToMessageID string
	ChatID           string
	MessageType      string
	Content          string
	UUID             string
}

type SendMessageResult struct {
	MessageID string
	RootID    string
	ThreadID  string
}

type EventHandler interface {
	OnReady(context.Context)
	OnMessage(context.Context, *MessageEvent) error
	OnCardAction(context.Context, *CardActionEvent) (*CardActionResult, error)
}

type Gateway interface {
	ProbeCredentials(context.Context) error
	Run(context.Context, EventHandler) error
	ReplyMessage(context.Context, SendMessageRequest) (*SendMessageResult, error)
}
