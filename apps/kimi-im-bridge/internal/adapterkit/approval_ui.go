package adapterkit

type ApprovalView struct {
	ApprovalID  string
	RequestKind string
	Prompt      string
	ChatID      string
	ThreadID    string
}

type ApprovalDecision struct {
	ApprovalID string
	Status     string
	ActorID    string
	ActorName  string
	ChatID     string
	ThreadID   string
	MessageID  string
	RawJSON    string
}
