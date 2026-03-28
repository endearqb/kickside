package feishu

import (
	"context"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
)

const (
	platformID                   = "feishu"
	feishuOffsetKind             = "feishu_checkpoint"
	feishuTextMaxRunes           = 3000
	feishuCardMaxRunes           = 2400
	defaultPendingAttachmentTTL  = 30 * time.Minute
	maxPendingAttachmentsPerChat = 10
)

type BindingRouter interface {
	ResolveBinding(context.Context, domain.BindingKey) (*domain.SessionBinding, error)
	CreateBinding(context.Context, domain.BindingKey, string, string, string) (*domain.SessionBinding, error)
	Rebind(context.Context, string, string) error
	UpdateBindingWorkDir(context.Context, string, string) error
	UpdateBindingOnboarding(context.Context, string, string) error
}

type RuntimeExecutor interface {
	ExecuteBindingPrompt(context.Context, domain.SessionBinding, runtime.PromptRequest, runtime.PromptEventSink) (runtime.PromptResponse, error)
	ResolveApproval(context.Context, string, string, string) error
}

type HostController interface {
	RequestRestart(context.Context) error
}

type ChannelStore interface {
	GetOffset(context.Context, string, string) (string, bool, error)
	ListChannelStatuses(context.Context) ([]domain.ChannelStatus, error)
	UpdateChannelState(context.Context, string, domain.ChannelRuntimeState, string, string) error
	UpdateChannelDiagnostics(context.Context, string, domain.ChannelDiagnosticsUpdate) error
	UpdateChannelOffset(context.Context, string, string, string) error
	TouchChannelInbound(context.Context, string, string) error
	TouchChannelOutbound(context.Context, string, string) error
	ListSessions(context.Context) ([]domain.BridgeSession, error)
	GetSessionByID(context.Context, string) (*domain.BridgeSession, error)
	ListApprovals(context.Context, string) ([]domain.ApprovalTicket, error)
	GetApprovalByID(context.Context, string) (*domain.ApprovalTicket, error)
	GetDeliveryEventByKey(context.Context, string) (*domain.DeliveryEvent, error)
	RecordDeliveryEventIfAbsent(context.Context, domain.DeliveryEvent) (bool, error)
	UpdateDeliveryEventStatus(context.Context, string, string, string) error
	UpdateDeliveryEventSent(context.Context, string, string) error
	StorePendingInboundAttachment(context.Context, domain.PendingInboundAttachment, int) error
	ListPendingInboundAttachments(context.Context, string, string, string, string, int) ([]domain.PendingInboundAttachment, error)
	DeletePendingInboundAttachments(context.Context, []string) error
	ConsumePendingInboundAttachments(context.Context, string, string, string, string, int) ([]domain.PendingInboundAttachment, error)
	CountPendingInboundAttachments(context.Context, string, string, string) (int, error)
}

type Logger interface {
	Printf(string, ...any)
}

type WorkDirPreset struct {
	Name string
	Path string
}

type Config struct {
	ConnectorID           string
	ConnectorLabel        string
	AppID                 string
	AppSecret             string
	VerificationToken     string
	EncryptKey            string
	AutoApprove           bool
	DefaultWorkDir        string
	WorkDirPresets        []WorkDirPreset
	ReplyRenderer         string
	AttachmentsDir        string
	BridgeOpsSkillEnabled bool
	BridgeOpsAuthFile     string
}

type Options struct {
	Config        Config
	Gateway       Gateway
	BindingRouter BindingRouter
	Runtime       RuntimeExecutor
	Orchestrator  bridgecore.InboundExecutor
	HostControl   HostController
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

type DownloadedResource struct {
	FileName  string
	MimeType  string
	SizeBytes int64
	Content   []byte
}

type UploadedResource struct {
	Key string
}

type EventHandler interface {
	OnReady(context.Context)
	OnMessage(context.Context, *MessageEvent) error
	OnCardAction(context.Context, *CardActionEvent) (*CardActionResult, error)
}

type Gateway interface {
	ProbeCredentials(context.Context) error
	Run(context.Context, EventHandler) error
	DownloadImage(context.Context, string) (*DownloadedResource, error)
	DownloadFile(context.Context, string) (*DownloadedResource, error)
	UploadImage(context.Context, string) (*UploadedResource, error)
	UploadFile(context.Context, string, string) (*UploadedResource, error)
	CreateMessage(context.Context, SendMessageRequest) (*SendMessageResult, error)
	ReplyMessage(context.Context, SendMessageRequest) (*SendMessageResult, error)
}
