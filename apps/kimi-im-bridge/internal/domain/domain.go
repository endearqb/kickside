package domain

type BridgeRuntimeState string

const (
	BridgeStateStopped  BridgeRuntimeState = "stopped"
	BridgeStateStarting BridgeRuntimeState = "starting"
	BridgeStateRunning  BridgeRuntimeState = "running"
	BridgeStateDegraded BridgeRuntimeState = "degraded"
	BridgeStateStopping BridgeRuntimeState = "stopping"
	BridgeStateCrashed  BridgeRuntimeState = "crashed"
)

type ChannelRuntimeState string

const (
	ChannelStateIdle       ChannelRuntimeState = "idle"
	ChannelStateConnecting ChannelRuntimeState = "connecting"
	ChannelStateReady      ChannelRuntimeState = "ready"
	ChannelStateDegraded   ChannelRuntimeState = "degraded"
	ChannelStateError      ChannelRuntimeState = "error"
)

type AttachmentKind string

const (
	AttachmentKindImage AttachmentKind = "image"
	AttachmentKindFile  AttachmentKind = "file"
)

type AttachmentDownloadState string

const (
	AttachmentDownloadPending AttachmentDownloadState = "pending"
	AttachmentDownloadReady   AttachmentDownloadState = "ready"
	AttachmentDownloadFailed  AttachmentDownloadState = "failed"
)

type InboundAttachment struct {
	Kind            AttachmentKind          `json:"kind,omitempty"`
	FileName        string                  `json:"fileName,omitempty"`
	MimeType        string                  `json:"mimeType,omitempty"`
	SizeBytes       int64                   `json:"sizeBytes,omitempty"`
	PlatformKey     string                  `json:"platformKey,omitempty"`
	LocalPath       string                  `json:"localPath,omitempty"`
	SourceMessageID string                  `json:"sourceMessageId,omitempty"`
	DownloadState   AttachmentDownloadState `json:"downloadState,omitempty"`
}

type OutboundAttachment struct {
	Kind      AttachmentKind `json:"kind,omitempty"`
	Title     string         `json:"title,omitempty"`
	MimeType  string         `json:"mimeType,omitempty"`
	SizeBytes int64          `json:"sizeBytes,omitempty"`
	LocalPath string         `json:"localPath,omitempty"`
}

type PromptAttachment struct {
	Kind            AttachmentKind `json:"kind,omitempty"`
	FileName        string         `json:"fileName,omitempty"`
	MimeType        string         `json:"mimeType,omitempty"`
	SizeBytes       int64          `json:"sizeBytes,omitempty"`
	PlatformKey     string         `json:"platformKey,omitempty"`
	LocalPath       string         `json:"localPath,omitempty"`
	SourceMessageID string         `json:"sourceMessageId,omitempty"`
}

type RuntimeArtifact struct {
	Kind         AttachmentKind `json:"kind,omitempty"`
	Title        string         `json:"title,omitempty"`
	LocalPath    string         `json:"localPath,omitempty"`
	MimeType     string         `json:"mimeType,omitempty"`
	SizeBytes    int64          `json:"sizeBytes,omitempty"`
	CardMarkdown string         `json:"cardMarkdown,omitempty"`
}

type PendingInboundAttachment struct {
	AttachmentID    string                  `json:"attachmentId"`
	ConnectorID     string                  `json:"connectorId,omitempty"`
	Platform        string                  `json:"platform"`
	ChatID          string                  `json:"chatId"`
	ThreadID        string                  `json:"threadId,omitempty"`
	Kind            AttachmentKind          `json:"kind"`
	FileName        string                  `json:"fileName,omitempty"`
	MimeType        string                  `json:"mimeType,omitempty"`
	SizeBytes       int64                   `json:"sizeBytes,omitempty"`
	PlatformKey     string                  `json:"platformKey,omitempty"`
	LocalPath       string                  `json:"localPath,omitempty"`
	SourceMessageID string                  `json:"sourceMessageId,omitempty"`
	DownloadState   AttachmentDownloadState `json:"downloadState,omitempty"`
	ExpiresAt       string                  `json:"expiresAt,omitempty"`
	CreatedAt       string                  `json:"createdAt"`
	UpdatedAt       string                  `json:"updatedAt"`
}

type InboundMessage struct {
	ConnectorID string              `json:"connectorId"`
	Platform    string              `json:"platform"`
	AccountID   string              `json:"accountId,omitempty"`
	MessageID   string              `json:"messageId"`
	ChatID      string              `json:"chatId"`
	ThreadID    string              `json:"threadId,omitempty"`
	SenderID    string              `json:"senderId"`
	SenderName  string              `json:"senderName,omitempty"`
	Text        string              `json:"text"`
	Mentions    []string            `json:"mentions"`
	Attachments []InboundAttachment `json:"attachments"`
	ReceivedAt  string              `json:"receivedAt"`
	RawRef      string              `json:"rawRef"`
}

type BindingKey struct {
	ConnectorID string `json:"connectorId"`
	Platform    string `json:"platform"`
	AccountID   string `json:"accountId,omitempty"`
	ChatID      string `json:"chatId"`
	ThreadID    string `json:"threadId,omitempty"`
}

type SessionBinding struct {
	BindingID             string     `json:"bindingId"`
	Key                   BindingKey `json:"key"`
	KimiSessionID         string     `json:"kimiSessionId"`
	WorkDir               string     `json:"workDir,omitempty"`
	Source                string     `json:"source"`
	OnboardedAt           string     `json:"onboardedAt,omitempty"`
	OnboardingVersion     string     `json:"onboardingVersion,omitempty"`
	CreatedAt             string     `json:"createdAt"`
	UpdatedAt             string     `json:"updatedAt"`
	LastInboundMessageID  string     `json:"lastInboundMessageId,omitempty"`
	LastOutboundMessageID string     `json:"lastOutboundMessageId,omitempty"`
}

type BindingRecord struct {
	BindingID            string `json:"bindingId"`
	ConnectorID          string `json:"connectorId"`
	ConnectorLabel       string `json:"connectorLabel,omitempty"`
	Platform             string `json:"platform"`
	AccountID            string `json:"accountId,omitempty"`
	ChatID               string `json:"chatId"`
	ThreadID             string `json:"threadId,omitempty"`
	KimiSessionID        string `json:"kimiSessionId"`
	WorkDir              string `json:"workDir,omitempty"`
	OnboardedAt          string `json:"onboardedAt,omitempty"`
	OnboardingVersion    string `json:"onboardingVersion,omitempty"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
	LastInboundMessageID string `json:"lastInboundMessageId,omitempty"`
}

type BindingUpdate struct {
	KimiSessionID string  `json:"kimiSessionId,omitempty"`
	WorkDir       *string `json:"workDir,omitempty"`
	Source        string  `json:"source,omitempty"`
}

type ApprovalTicket struct {
	ApprovalID            string `json:"approvalId"`
	ConnectorID           string `json:"connectorId"`
	ConnectorLabel        string `json:"connectorLabel,omitempty"`
	KimiSessionID         string `json:"kimiSessionId"`
	TurnID                string `json:"turnId,omitempty"`
	StepID                string `json:"stepId,omitempty"`
	RequestKind           string `json:"requestKind"`
	Prompt                string `json:"prompt"`
	Platform              string `json:"platform"`
	ChatID                string `json:"chatId"`
	ThreadID              string `json:"threadId,omitempty"`
	Status                string `json:"status"`
	RequestPayloadJSON    string `json:"requestPayloadJson"`
	ResolutionPayloadJSON string `json:"resolutionPayloadJson,omitempty"`
	DedupeKey             string `json:"dedupeKey"`
	ClaimedByActorID      string `json:"claimedByActorId,omitempty"`
	ClaimedAt             string `json:"claimedAt,omitempty"`
	PlatformMessageID     string `json:"platformMessageId,omitempty"`
	ResolutionBy          string `json:"resolutionBy,omitempty"`
	RequestHash           string `json:"requestHash,omitempty"`
	CreatedAt             string `json:"createdAt"`
	UpdatedAt             string `json:"updatedAt"`
	ResolvedAt            string `json:"resolvedAt,omitempty"`
}

type OutboundMessage struct {
	ConnectorID      string               `json:"connectorId,omitempty"`
	Platform         string               `json:"platform"`
	ChatID           string               `json:"chatId"`
	ThreadID         string               `json:"threadId,omitempty"`
	ReplyToMessageID string               `json:"replyToMessageId,omitempty"`
	TextChunks       []string             `json:"textChunks"`
	MarkdownMode     string               `json:"markdownMode"`
	Attachments      []OutboundAttachment `json:"attachments"`
	DedupeKey        string               `json:"dedupeKey"`
}

type ChannelStatus struct {
	ConnectorID          string              `json:"connectorId"`
	ConnectorLabel       string              `json:"connectorLabel,omitempty"`
	Platform             string              `json:"platform"`
	Enabled              bool                `json:"enabled"`
	State                ChannelRuntimeState `json:"state"`
	LastHeartbeatAt      string              `json:"lastHeartbeatAt,omitempty"`
	LastInboundAt        string              `json:"lastInboundAt,omitempty"`
	LastOutboundAt       string              `json:"lastOutboundAt,omitempty"`
	LastOffset           string              `json:"lastOffset,omitempty"`
	LastErrorCode        string              `json:"lastErrorCode,omitempty"`
	LastError            string              `json:"lastError,omitempty"`
	LastReadyAt          string              `json:"lastReadyAt,omitempty"`
	LastFailureAt        string              `json:"lastFailureAt,omitempty"`
	LastFailureOperation string              `json:"lastFailureOperation,omitempty"`
	LastFailureRetryable bool                `json:"lastFailureRetryable,omitempty"`
	ConsecutiveFailures  int                 `json:"consecutiveFailures,omitempty"`
	NextRetryAt          string              `json:"nextRetryAt,omitempty"`
	LastRecoveryAt       string              `json:"lastRecoveryAt,omitempty"`
	RecoveryHint         string              `json:"recoveryHint,omitempty"`
}

type ChannelDiagnosticsUpdate struct {
	State                ChannelRuntimeState
	LastErrorCode        string
	LastError            string
	LastReadyAt          *string
	LastFailureAt        *string
	LastFailureOperation *string
	LastFailureRetryable *bool
	ConsecutiveFailures  *int
	NextRetryAt          *string
	LastRecoveryAt       *string
	RecoveryHint         *string
}

type BridgeStatus struct {
	State            BridgeRuntimeState `json:"state"`
	StartedAt        string             `json:"startedAt,omitempty"`
	PID              int                `json:"pid,omitempty"`
	AdminPort        int                `json:"adminPort,omitempty"`
	Version          string             `json:"version,omitempty"`
	Channels         []ChannelStatus    `json:"channels"`
	PendingApprovals int                `json:"pendingApprovals"`
	Bindings         int                `json:"bindings"`
	LastErrorCode    string             `json:"lastErrorCode,omitempty"`
	LastError        string             `json:"lastError,omitempty"`
}

type BridgeSession struct {
	KimiSessionID       string `json:"kimiSessionId"`
	WorkDir             string `json:"workDir,omitempty"`
	LastTurnID          string `json:"lastTurnId,omitempty"`
	LastMessageAt       string `json:"lastMessageAt,omitempty"`
	Summary             string `json:"summary,omitempty"`
	SessionState        string `json:"sessionState,omitempty"`
	LeaseOwner          string `json:"leaseOwner,omitempty"`
	LeaseExpiresAt      string `json:"leaseExpiresAt,omitempty"`
	AutoApprove         bool   `json:"autoApprove,omitempty"`
	ProviderName        string `json:"providerName,omitempty"`
	RuntimeMetadataJSON string `json:"runtimeMetadataJson,omitempty"`
	CreatedAt           string `json:"createdAt"`
	UpdatedAt           string `json:"updatedAt"`
}

type SessionImportRequest struct {
	Source          string `json:"source,omitempty"`
	SourceSessionID string `json:"sourceSessionId,omitempty"`
	WorkDir         string `json:"workDir,omitempty"`
	Summary         string `json:"summary,omitempty"`
}

type DeliveryEvent struct {
	EventID           string `json:"eventId"`
	ConnectorID       string `json:"connectorId,omitempty"`
	Platform          string `json:"platform"`
	ChatID            string `json:"chatId"`
	ThreadID          string `json:"threadId,omitempty"`
	Direction         string `json:"direction"`
	DeliveryKey       string `json:"deliveryKey"`
	SourceMessageID   string `json:"sourceMessageId,omitempty"`
	TurnID            string `json:"turnId,omitempty"`
	StepIndex         int    `json:"stepIndex,omitempty"`
	DeliveryKind      string `json:"deliveryKind,omitempty"`
	Renderer          string `json:"renderer,omitempty"`
	AttemptCount      int    `json:"attemptCount,omitempty"`
	TargetMessageID   string `json:"targetMessageId,omitempty"`
	RetryAfterAt      string `json:"retryAfterAt,omitempty"`
	SupersedesEventID string `json:"supersedesEventId,omitempty"`
	PayloadJSON       string `json:"payloadJson"`
	Status            string `json:"status"`
	ErrorMessage      string `json:"errorMessage,omitempty"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

type BridgeTurn struct {
	TurnID           string `json:"turnId"`
	ConnectorID      string `json:"connectorId,omitempty"`
	KimiSessionID    string `json:"kimiSessionId"`
	BindingID        string `json:"bindingId,omitempty"`
	Platform         string `json:"platform"`
	ChatID           string `json:"chatId"`
	ThreadID         string `json:"threadId,omitempty"`
	InboundMessageID string `json:"inboundMessageId,omitempty"`
	PromptText       string `json:"promptText"`
	Status           string `json:"status"`
	ProviderName     string `json:"providerName"`
	StartedAt        string `json:"startedAt"`
	CompletedAt      string `json:"completedAt,omitempty"`
	ErrorCode        string `json:"errorCode,omitempty"`
	ErrorMessage     string `json:"errorMessage,omitempty"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type TurnEventRecord struct {
	EventID        string  `json:"eventId"`
	ConnectorID    string  `json:"connectorId,omitempty"`
	TurnID         string  `json:"turnId"`
	KimiSessionID  string  `json:"kimiSessionId"`
	Platform       string  `json:"platform"`
	ChatID         string  `json:"chatId"`
	ThreadID       string  `json:"threadId,omitempty"`
	Kind           string  `json:"kind"`
	StepIndex      int     `json:"stepIndex,omitempty"`
	MessageID      string  `json:"messageId,omitempty"`
	ApprovalID     string  `json:"approvalId,omitempty"`
	RequestKind    string  `json:"requestKind,omitempty"`
	TextDelta      string  `json:"textDelta,omitempty"`
	ThinkingDelta  string  `json:"thinkingDelta,omitempty"`
	StatusText     string  `json:"statusText,omitempty"`
	PayloadJSON    string  `json:"payloadJson,omitempty"`
	ErrorCode      string  `json:"errorCode,omitempty"`
	ErrorMessage   string  `json:"errorMessage,omitempty"`
	ContextUsage   float64 `json:"contextUsage,omitempty"`
	TokenUsageJSON string  `json:"tokenUsageJson,omitempty"`
	CreatedAt      string  `json:"createdAt"`
}

type ChannelCheckpoint struct {
	ConnectorID    string `json:"connectorId"`
	CheckpointKind string `json:"checkpointKind"`
	FetchedValue   string `json:"fetchedValue,omitempty"`
	CommittedValue string `json:"committedValue,omitempty"`
	LastSeenAt     string `json:"lastSeenAt,omitempty"`
	CommittedAt    string `json:"committedAt,omitempty"`
	UpdatedAt      string `json:"updatedAt"`
}
