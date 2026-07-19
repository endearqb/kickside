package domain

import "encoding/json"

type SessionPolicy string

const (
	SessionPolicyPerRoom        SessionPolicy = "per_room"
	SessionPolicyPersistent     SessionPolicy = "persistent"
	SessionPolicyNewPerTask     SessionPolicy = "new_per_task"
	SessionPolicyResumeSelected SessionPolicy = "resume_selected"
)

type AgentProfile struct {
	AgentID         string          `json:"agentId"`
	Name            string          `json:"name"`
	Avatar          string          `json:"avatar,omitempty"`
	Description     string          `json:"description,omitempty"`
	RolePrompt      string          `json:"rolePrompt"`
	DefaultWorkDir  string          `json:"defaultWorkDir"`
	SessionPolicy   SessionPolicy   `json:"sessionPolicy"`
	PinnedSessionID string          `json:"pinnedSessionId,omitempty"`
	AutoApprove     bool            `json:"autoApprove"`
	RuntimeControls json.RawMessage `json:"runtimeControls,omitempty"`
	Enabled         bool            `json:"enabled"`
	Revision        int64           `json:"revision"`
	CreatedAt       string          `json:"createdAt"`
	UpdatedAt       string          `json:"updatedAt"`
}

type AgentRoom struct {
	RoomID            string `json:"roomId"`
	Title             string `json:"title"`
	Description       string `json:"description,omitempty"`
	SharedBrief       string `json:"sharedBrief,omitempty"`
	OrchestrationMode string `json:"orchestrationMode"`
	Archived          bool   `json:"archived"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}

type AgentRoomMember struct {
	MemberID           string          `json:"memberId"`
	RoomID             string          `json:"roomId"`
	MemberKind         string          `json:"memberKind"`
	AgentID            string          `json:"agentId,omitempty"`
	DisplayName        string          `json:"displayName"`
	WorkspaceRoot      string          `json:"workspaceRoot,omitempty"`
	SessionPolicy      SessionPolicy   `json:"sessionPolicy"`
	FollowMode         string          `json:"followMode"`
	FollowedPaneID     string          `json:"followedPaneId,omitempty"`
	PinnedSessionID    string          `json:"pinnedSessionId,omitempty"`
	EffectiveSessionID string          `json:"effectiveSessionId,omitempty"`
	RolePromptSnapshot string          `json:"rolePromptSnapshot,omitempty"`
	RuntimeControls    json.RawMessage `json:"runtimeControls,omitempty"`
	AutoApprove        bool            `json:"autoApprove"`
	Status             string          `json:"status"`
	CreatedAt          string          `json:"createdAt"`
	UpdatedAt          string          `json:"updatedAt"`
}

type AgentRoomMessage struct {
	MessageID        string          `json:"messageId"`
	RoomID           string          `json:"roomId"`
	SenderKind       string          `json:"senderKind"`
	SenderID         string          `json:"senderId,omitempty"`
	Content          string          `json:"content"`
	ReplyToMessageID string          `json:"replyToMessageId,omitempty"`
	TargetMemberIDs  []string        `json:"targetMemberIds,omitempty"`
	Attachments      json.RawMessage `json:"attachments,omitempty"`
	Metadata         json.RawMessage `json:"metadata,omitempty"`
	CreatedAt        string          `json:"createdAt"`
}

type AgentRun struct {
	RunID           string          `json:"runId"`
	RoomID          string          `json:"roomId"`
	SourceMessageID string          `json:"sourceMessageId"`
	MemberID        string          `json:"memberId"`
	AgentID         string          `json:"agentId,omitempty"`
	SessionID       string          `json:"sessionId,omitempty"`
	WorkDir         string          `json:"workDir,omitempty"`
	TurnID          string          `json:"turnId,omitempty"`
	PromptID        string          `json:"promptId,omitempty"`
	OriginKind      string          `json:"originKind"`
	QueuePolicy     string          `json:"queuePolicy"`
	QueuePosition   *int            `json:"queuePosition,omitempty"`
	Status          string          `json:"status"`
	ErrorCode       string          `json:"errorCode,omitempty"`
	ErrorMessage    string          `json:"errorMessage,omitempty"`
	Controls        json.RawMessage `json:"controls,omitempty"`
	PromptAssembly  json.RawMessage `json:"promptAssembly,omitempty"`
	WorkflowStageID string          `json:"workflowStageId,omitempty"`
	CreatedAt       string          `json:"createdAt"`
	StartedAt       string          `json:"startedAt,omitempty"`
	CompletedAt     string          `json:"completedAt,omitempty"`
	UpdatedAt       string          `json:"updatedAt"`
}

type WorkflowDefinition struct {
	Version string          `json:"version"`
	Stages  []WorkflowStage `json:"stages"`
}

type WorkflowStage struct {
	StageID         string   `json:"stageId"`
	TargetMemberIDs []string `json:"targetMemberIds"`
	DependsOn       []string `json:"dependsOn,omitempty"`
	Aggregation     string   `json:"aggregation"`
	PromptTemplate  string   `json:"promptTemplate"`
	FailurePolicy   string   `json:"failurePolicy"`
}

type AgentConnectorBinding struct {
	ConnectorID string `json:"connectorId"`
	AgentID     string `json:"agentId"`
	SessionMode string `json:"sessionMode"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

type ConnectorAgentContext struct {
	ConnectorID     string          `json:"connectorId"`
	AgentID         string          `json:"agentId"`
	SessionMode     string          `json:"sessionMode"`
	RolePrompt      string          `json:"-"`
	DefaultWorkDir  string          `json:"-"`
	SessionPolicy   SessionPolicy   `json:"-"`
	PinnedSessionID string          `json:"-"`
	PinnedWorkDir   string          `json:"-"`
	RuntimeControls json.RawMessage `json:"-"`
}

type AgentRoomEvent struct {
	Seq         int64            `json:"seq"`
	EventID     string           `json:"eventId"`
	RoomID      string           `json:"roomId,omitempty"`
	MemberID    string           `json:"memberId,omitempty"`
	AgentID     string           `json:"agentId,omitempty"`
	RunID       string           `json:"runId,omitempty"`
	SessionID   string           `json:"sessionId,omitempty"`
	TurnID      string           `json:"turnId,omitempty"`
	PromptID    string           `json:"promptId,omitempty"`
	Kind        string           `json:"kind"`
	Status      string           `json:"status,omitempty"`
	TextDelta   string           `json:"textDelta,omitempty"`
	DisplayText string           `json:"displayText,omitempty"`
	Artifact    *RuntimeArtifact `json:"artifact,omitempty"`
	ApprovalID  string           `json:"approvalId,omitempty"`
	Payload     json.RawMessage  `json:"payload,omitempty"`
	CreatedAt   string           `json:"createdAt"`
}

type SessionObservation struct {
	SessionID        string `json:"sessionId"`
	Generation       int64  `json:"generation"`
	WorkDir          string `json:"workDir,omitempty"`
	LastSeq          int64  `json:"lastSeq"`
	Epoch            string `json:"epoch,omitempty"`
	LastEventAt      string `json:"lastEventAt,omitempty"`
	SessionState     string `json:"sessionState"`
	ControlOrigin    string `json:"controlOrigin"`
	CurrentTurnID    string `json:"currentTurnId,omitempty"`
	CurrentPromptID  string `json:"currentPromptId,omitempty"`
	LastReply        string `json:"lastReply,omitempty"`
	PendingApprovals int    `json:"pendingApprovals"`
	UpdatedAt        string `json:"updatedAt"`
}

type PaneSessionObservation struct {
	PaneID             string `json:"paneId"`
	PersistedSessionID string `json:"persistedSessionId,omitempty"`
	ActiveSessionID    string `json:"activeSessionId,omitempty"`
	EffectiveSessionID string `json:"effectiveSessionId,omitempty"`
	WorkDir            string `json:"workDir,omitempty"`
	Visible            bool   `json:"visible"`
	Active             bool   `json:"active"`
	Maximized          bool   `json:"maximized"`
	MountPolicy        string `json:"mountPolicy"`
	LoadState          string `json:"loadState"`
	Generation         int64  `json:"generation"`
	UpdatedAt          string `json:"updatedAt"`
}

type SessionPromptQueueItem struct {
	QueueID   string `json:"queueId"`
	SessionID string `json:"sessionId"`
	RunID     string `json:"runId"`
	Position  int    `json:"position"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type SessionLease struct {
	SessionID  string `json:"sessionId"`
	Owner      string `json:"owner"`
	ExpiresAt  string `json:"expiresAt"`
	AcquiredAt string `json:"acquiredAt"`
}

type AgentRoomTimeline struct {
	Messages []AgentRoomMessage `json:"messages"`
	Runs     []AgentRun         `json:"runs"`
	Events   []AgentRoomEvent   `json:"events"`
}
