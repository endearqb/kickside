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

type InboundAttachment struct {
	Name string `json:"name,omitempty"`
	URL  string `json:"url,omitempty"`
}

type OutboundAttachment struct {
	Name string `json:"name,omitempty"`
	URL  string `json:"url,omitempty"`
}

type InboundMessage struct {
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
	Platform  string `json:"platform"`
	AccountID string `json:"accountId,omitempty"`
	ChatID    string `json:"chatId"`
	ThreadID  string `json:"threadId,omitempty"`
}

type SessionBinding struct {
	BindingID             string     `json:"bindingId"`
	Key                   BindingKey `json:"key"`
	KimiSessionID         string     `json:"kimiSessionId"`
	WorkDir               string     `json:"workDir,omitempty"`
	Source                string     `json:"source"`
	CreatedAt             string     `json:"createdAt"`
	UpdatedAt             string     `json:"updatedAt"`
	LastInboundMessageID  string     `json:"lastInboundMessageId,omitempty"`
	LastOutboundMessageID string     `json:"lastOutboundMessageId,omitempty"`
}

type BindingRecord struct {
	BindingID            string `json:"bindingId"`
	Platform             string `json:"platform"`
	AccountID            string `json:"accountId,omitempty"`
	ChatID               string `json:"chatId"`
	ThreadID             string `json:"threadId,omitempty"`
	KimiSessionID        string `json:"kimiSessionId"`
	WorkDir              string `json:"workDir,omitempty"`
	CreatedAt            string `json:"createdAt"`
	UpdatedAt            string `json:"updatedAt"`
	LastInboundMessageID string `json:"lastInboundMessageId,omitempty"`
}

type ApprovalTicket struct {
	ApprovalID            string `json:"approvalId"`
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
	CreatedAt             string `json:"createdAt"`
	UpdatedAt             string `json:"updatedAt"`
	ResolvedAt            string `json:"resolvedAt,omitempty"`
}

type OutboundMessage struct {
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
	Platform       string              `json:"platform"`
	Enabled        bool                `json:"enabled"`
	State          ChannelRuntimeState `json:"state"`
	LastInboundAt  string              `json:"lastInboundAt,omitempty"`
	LastOutboundAt string              `json:"lastOutboundAt,omitempty"`
	LastOffset     string              `json:"lastOffset,omitempty"`
	LastErrorCode  string              `json:"lastErrorCode,omitempty"`
	LastError      string              `json:"lastError,omitempty"`
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
	KimiSessionID string `json:"kimiSessionId"`
	WorkDir       string `json:"workDir,omitempty"`
	LastTurnID    string `json:"lastTurnId,omitempty"`
	LastMessageAt string `json:"lastMessageAt,omitempty"`
	Summary       string `json:"summary,omitempty"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
}

type DeliveryEvent struct {
	EventID         string `json:"eventId"`
	Platform        string `json:"platform"`
	ChatID          string `json:"chatId"`
	ThreadID        string `json:"threadId,omitempty"`
	Direction       string `json:"direction"`
	DeliveryKey     string `json:"deliveryKey"`
	SourceMessageID string `json:"sourceMessageId,omitempty"`
	PayloadJSON     string `json:"payloadJson"`
	Status          string `json:"status"`
	ErrorMessage    string `json:"errorMessage,omitempty"`
	CreatedAt       string `json:"createdAt"`
	UpdatedAt       string `json:"updatedAt"`
}
