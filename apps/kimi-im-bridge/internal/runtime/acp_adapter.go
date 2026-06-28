package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
)

type ACPAdapterOptions struct {
	Command   string
	Args      []string
	Transport ACPTransport
}

type ACPTransport interface {
	Call(context.Context, string, any, ACPMessageHandler) (json.RawMessage, error)
	Notify(context.Context, string, any) error
	Close() error
}

type ACPMessageHandler func(context.Context, ACPMessage) (ACPResponse, error)

type ACPMessage struct {
	ID     string
	Method string
	Params json.RawMessage
}

type ACPResponse struct {
	Respond bool
	Result  any
}

type ACPAdapter struct {
	transport ACPTransport
	initOnce  sync.Once
	initErr   error
	mu        sync.Mutex
	pending   map[string]pendingACPApproval
}

type pendingACPApproval struct {
	approval RuntimeApproval
	params   json.RawMessage
	decision chan ApprovalDecision
}

func NewACPAdapter(options ACPAdapterOptions) (*ACPAdapter, error) {
	transport := options.Transport
	if transport == nil {
		command := strings.TrimSpace(options.Command)
		if command == "" {
			command = "kimi"
		}
		args := append([]string(nil), options.Args...)
		if len(args) == 0 {
			args = []string{"acp"}
		}
		stdio, err := NewStdioACPTransport(command, args...)
		if err != nil {
			return nil, err
		}
		transport = stdio
	}
	return &ACPAdapter{
		transport: transport,
		pending:   map[string]pendingACPApproval{},
	}, nil
}

func (a *ACPAdapter) EnsureWorkspace(_ context.Context, root string) (WorkspaceRef, error) {
	return WorkspaceRef{Root: strings.TrimSpace(root)}, nil
}

func (a *ACPAdapter) EnsureSession(ctx context.Context, request EnsureSessionRequest) (SessionRef, error) {
	if err := a.initialize(ctx); err != nil {
		return SessionRef{}, err
	}
	sessionID := strings.TrimSpace(request.KimiCodeSessionID)
	workspaceRoot := strings.TrimSpace(request.WorkspaceRoot)
	source := "acp_new"
	if sessionID != "" {
		if _, err := a.transport.Call(ctx, "session/resume", map[string]any{
			"sessionId": sessionID,
			"cwd":       workspaceRoot,
		}, nil); err != nil {
			if _, loadErr := a.transport.Call(ctx, "session/load", map[string]any{
				"sessionId": sessionID,
				"cwd":       workspaceRoot,
			}, nil); loadErr != nil {
				return SessionRef{}, err
			}
			source = "acp_loaded"
		} else {
			source = "acp_resumed"
		}
		return SessionRef{
			KimiCodeSessionID: sessionID,
			WorkspaceRoot:     workspaceRoot,
			SessionSource:     source,
			RuntimeAdapter:    RuntimeAdapterACP,
		}, nil
	}

	result, err := a.transport.Call(ctx, "session/new", map[string]any{
		"cwd": workspaceRoot,
	}, nil)
	if err != nil {
		return SessionRef{}, err
	}
	sessionID = firstNonEmptyString(jsonString(result, "sessionId"), jsonString(result, "session_id"), jsonString(result, "id"))
	if sessionID == "" {
		return SessionRef{}, fmt.Errorf("acp session/new returned no session id")
	}
	return SessionRef{
		KimiCodeSessionID: sessionID,
		WorkspaceRoot:     workspaceRoot,
		SessionSource:     source,
		RuntimeAdapter:    RuntimeAdapterACP,
	}, nil
}

func (a *ACPAdapter) SubmitPrompt(ctx context.Context, request AdapterPromptRequest, sink AdapterEventSink) (AdapterPromptResult, error) {
	if err := a.initialize(ctx); err != nil {
		return AdapterPromptResult{}, err
	}
	sessionID := strings.TrimSpace(request.SessionID)
	if sessionID == "" {
		return AdapterPromptResult{}, fmt.Errorf("session id is required")
	}
	result, err := a.transport.Call(ctx, "session/prompt", map[string]any{
		"sessionId": sessionID,
		"prompt": []map[string]any{
			{"type": "text", "text": strings.TrimSpace(request.Text)},
		},
	}, func(ctx context.Context, message ACPMessage) (ACPResponse, error) {
		return a.handleACPMessage(ctx, sessionID, request, sink, message)
	})
	status := "completed"
	stopReason := firstNonEmptyString(jsonString(result, "stopReason"), jsonString(result, "stop_reason"))
	if strings.Contains(strings.ToLower(stopReason), "cancel") {
		status = "aborted"
	}
	if err != nil {
		status = "failed"
	}
	return AdapterPromptResult{
		PromptID: firstNonEmptyString(jsonString(result, "promptId"), jsonString(result, "prompt_id")),
		Status:   status,
	}, err
}

func (a *ACPAdapter) ListApprovals(_ context.Context, sessionID string) ([]RuntimeApproval, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	approvals := make([]RuntimeApproval, 0, len(a.pending))
	for _, pending := range a.pending {
		if sessionID != "" && pending.approval.SessionID != sessionID {
			continue
		}
		approvals = append(approvals, pending.approval)
	}
	return approvals, nil
}

func (a *ACPAdapter) ResolveApproval(ctx context.Context, _ string, approvalID string, decision ApprovalDecision) error {
	approvalID = strings.TrimSpace(approvalID)
	if approvalID == "" {
		return fmt.Errorf("approval id is required")
	}
	a.mu.Lock()
	pending, ok := a.pending[approvalID]
	a.mu.Unlock()
	if !ok {
		return fmt.Errorf("acp approval %s is not pending", approvalID)
	}
	select {
	case pending.decision <- decision:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *ACPAdapter) AbortPrompt(ctx context.Context, sessionID string, promptID string) error {
	return a.transport.Notify(ctx, "session/cancel", map[string]any{
		"sessionId": strings.TrimSpace(sessionID),
		"promptId":  strings.TrimSpace(promptID),
	})
}

func (a *ACPAdapter) Close() error {
	if a == nil || a.transport == nil {
		return nil
	}
	return a.transport.Close()
}

func (a *ACPAdapter) initialize(ctx context.Context) error {
	a.initOnce.Do(func() {
		_, a.initErr = a.transport.Call(ctx, "initialize", map[string]any{
			"protocolVersion": 1,
			"clientInfo": map[string]any{
				"name":    "kimi-im-bridge",
				"version": "0",
			},
			"clientCapabilities": map[string]any{},
		}, nil)
	})
	return a.initErr
}

func (a *ACPAdapter) handleACPMessage(ctx context.Context, sessionID string, request AdapterPromptRequest, sink AdapterEventSink, message ACPMessage) (ACPResponse, error) {
	switch strings.TrimSpace(message.Method) {
	case "session/update":
		return ACPResponse{}, emitACPUpdate(sink, message.Params)
	case "session/request_permission":
		approval := runtimeApprovalFromACPRequest(sessionID, message)
		if !isManualPermissionMode(request.Controls.PermissionMode) {
			if err := sinkACPAdapterEvent(sink, AdapterEvent{Type: "approval_requested", Approval: approval}); err != nil {
				return ACPResponse{}, err
			}
			return ACPResponse{
				Respond: true,
				Result:  acpPermissionResult(request.Controls.PermissionMode, message.Params),
			}, nil
		}
		decision, err := a.waitForACPApprovalDecision(ctx, *approval, message.Params, func() error {
			return sinkACPAdapterEvent(sink, AdapterEvent{Type: "approval_requested", Approval: approval})
		})
		if err != nil {
			return ACPResponse{}, err
		}
		return ACPResponse{
			Respond: true,
			Result:  acpPermissionResultFromDecision(decision, message.Params),
		}, nil
	default:
		if message.ID != "" {
			return ACPResponse{Respond: true, Result: map[string]any{"error": "unsupported ACP request"}}, nil
		}
		_ = ctx
		return ACPResponse{}, nil
	}
}

func (a *ACPAdapter) waitForACPApprovalDecision(ctx context.Context, approval RuntimeApproval, params json.RawMessage, afterRegister func() error) (ApprovalDecision, error) {
	approvalID := strings.TrimSpace(approval.ApprovalID)
	if approvalID == "" {
		return ApprovalDecision{}, fmt.Errorf("acp approval id is required")
	}
	pending := pendingACPApproval{
		approval: approval,
		params:   append(json.RawMessage(nil), params...),
		decision: make(chan ApprovalDecision, 1),
	}
	a.mu.Lock()
	a.pending[approvalID] = pending
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.pending, approvalID)
		a.mu.Unlock()
	}()
	if afterRegister != nil {
		if err := afterRegister(); err != nil {
			return ApprovalDecision{}, err
		}
	}

	select {
	case decision := <-pending.decision:
		return decision, nil
	case <-ctx.Done():
		return ApprovalDecision{}, ctx.Err()
	}
}

func emitACPUpdate(sink AdapterEventSink, raw json.RawMessage) error {
	updateType := firstNonEmptyString(jsonString(raw, "sessionUpdate"), jsonString(raw, "type"))
	switch strings.TrimSpace(updateType) {
	case "agent_message_chunk":
		text := firstNonEmptyString(jsonString(raw, "content.text"), jsonString(raw, "text"), jsonString(raw, "chunk"))
		return sinkACPAdapterEvent(sink, AdapterEvent{Type: "content_delta", Text: text})
	case "agent_thought_chunk":
		text := firstNonEmptyString(jsonString(raw, "content.text"), jsonString(raw, "text"), jsonString(raw, "chunk"))
		return sinkACPAdapterEvent(sink, AdapterEvent{Type: "thinking_delta", Text: text})
	case "tool_call":
		return sinkACPAdapterEvent(sink, AdapterEvent{Type: "step_started", Status: firstNonEmptyString(jsonString(raw, "title"), jsonString(raw, "kind"))})
	case "tool_call_update", "plan", "usage_update":
		return sinkACPAdapterEvent(sink, AdapterEvent{Type: "status_update", Status: updateType})
	default:
		return nil
	}
}

func runtimeApprovalFromACPRequest(sessionID string, message ACPMessage) *RuntimeApproval {
	toolCallID := firstNonEmptyString(jsonString(message.Params, "toolCall.toolCallId"), jsonString(message.Params, "toolCall.id"), message.ID)
	return &RuntimeApproval{
		ApprovalID:       firstNonEmptyString(toolCallID, message.ID),
		SessionID:        sessionID,
		ToolCallID:       toolCallID,
		ToolName:         firstNonEmptyString(jsonString(message.Params, "toolCall.kind"), jsonString(message.Params, "toolCall.title")),
		Action:           firstNonEmptyString(jsonString(message.Params, "toolCall.title"), jsonString(message.Params, "description"), "ACP permission requested"),
		ToolInputDisplay: jsonRawObject(message.Params, "toolCall"),
	}
}

func acpPermissionResult(permissionMode string, params json.RawMessage) map[string]any {
	if permissionMode == "auto" || permissionMode == "yolo" {
		if optionID := acpAllowOptionID(params); optionID != "" {
			return map[string]any{
				"outcome": map[string]any{
					"outcome":  "selected",
					"optionId": optionID,
				},
			}
		}
	}
	return map[string]any{
		"outcome": map[string]any{
			"outcome": "cancelled",
		},
	}
}

func acpPermissionResultFromDecision(decision ApprovalDecision, params json.RawMessage) map[string]any {
	switch strings.TrimSpace(decision.Decision) {
	case "approved", "approved_for_session":
		if optionID := acpAllowOptionIDForDecision(params, decision); optionID != "" {
			return acpSelectedOutcome(optionID)
		}
	case "denied", "rejected":
		if optionID := acpOptionIDByKinds(params, "reject_once", "reject_always", "deny_once", "deny_always"); optionID != "" {
			return acpSelectedOutcome(optionID)
		}
	}
	return map[string]any{
		"outcome": map[string]any{
			"outcome": "cancelled",
		},
	}
}

func acpAllowOptionIDForDecision(params json.RawMessage, decision ApprovalDecision) string {
	if strings.TrimSpace(decision.Scope) == "session" || strings.TrimSpace(decision.Decision) == "approved_for_session" {
		if optionID := acpOptionIDByKinds(params, "allow_always", "allow_session"); optionID != "" {
			return optionID
		}
	}
	return acpOptionIDByKinds(params, "allow_once", "allow_always", "allow_session")
}

func acpAllowOptionID(params json.RawMessage) string {
	return acpOptionIDByKinds(params, "allow_once", "allow_always")
}

func acpOptionIDByKinds(params json.RawMessage, kinds ...string) string {
	var object map[string]any
	if len(params) == 0 || json.Unmarshal(params, &object) != nil {
		return ""
	}
	wanted := map[string]struct{}{}
	for _, kind := range kinds {
		wanted[kind] = struct{}{}
	}
	options, _ := object["options"].([]any)
	for _, option := range options {
		optionMap, _ := option.(map[string]any)
		kind, _ := optionMap["kind"].(string)
		if _, ok := wanted[kind]; ok {
			if optionID, _ := optionMap["optionId"].(string); optionID != "" {
				return optionID
			}
			if optionID, _ := optionMap["id"].(string); optionID != "" {
				return optionID
			}
		}
	}
	return ""
}

func acpSelectedOutcome(optionID string) map[string]any {
	return map[string]any{
		"outcome": map[string]any{
			"outcome":  "selected",
			"optionId": optionID,
		},
	}
}

func isManualPermissionMode(permissionMode string) bool {
	switch strings.TrimSpace(permissionMode) {
	case "manual", "ask", "approval":
		return true
	default:
		return false
	}
}

func sinkACPAdapterEvent(sink AdapterEventSink, event AdapterEvent) error {
	if sink == nil || event.Type == "" {
		return nil
	}
	return sink(event)
}

type StdioACPTransport struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser

	writeMu sync.Mutex
	callMu  sync.Mutex

	nextID  atomic.Int64
	mu      sync.Mutex
	active  ACPMessageHandler
	pending map[string]chan acpWireMessage
	closed  chan struct{}
}

func NewStdioACPTransport(command string, args ...string) (*StdioACPTransport, error) {
	cmd := exec.Command(command, args...)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	transport := &StdioACPTransport{
		cmd:     cmd,
		stdin:   stdin,
		stdout:  stdout,
		pending: map[string]chan acpWireMessage{},
		closed:  make(chan struct{}),
	}
	go transport.readLoop()
	return transport, nil
}

func (t *StdioACPTransport) Call(ctx context.Context, method string, params any, handler ACPMessageHandler) (json.RawMessage, error) {
	t.callMu.Lock()
	defer t.callMu.Unlock()

	id := fmt.Sprintf("%d", t.nextID.Add(1))
	responseCh := make(chan acpWireMessage, 1)
	t.mu.Lock()
	t.pending[id] = responseCh
	t.active = handler
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.pending, id)
		t.active = nil
		t.mu.Unlock()
	}()

	if err := t.write(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
		"params":  params,
	}); err != nil {
		return nil, err
	}

	select {
	case response := <-responseCh:
		if response.Error != nil {
			return nil, response.Error
		}
		return response.Result, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-t.closed:
		return nil, errors.New("acp transport closed")
	}
}

func (t *StdioACPTransport) Notify(_ context.Context, method string, params any) error {
	return t.write(map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
		"params":  params,
	})
}

func (t *StdioACPTransport) Close() error {
	_ = t.stdin.Close()
	if t.cmd != nil && t.cmd.Process != nil {
		_ = t.cmd.Process.Kill()
	}
	if t.cmd != nil {
		_ = t.cmd.Wait()
	}
	return nil
}

func (t *StdioACPTransport) readLoop() {
	defer close(t.closed)
	scanner := bufio.NewScanner(t.stdout)
	scanner.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		raw := bytes.TrimSpace(scanner.Bytes())
		if len(raw) == 0 {
			continue
		}
		var message acpWireMessage
		if err := json.Unmarshal(raw, &message); err != nil {
			continue
		}
		if message.isResponse() {
			t.dispatchResponse(message)
			continue
		}
		if message.Method != "" {
			t.dispatchRequest(message)
		}
	}
}

func (t *StdioACPTransport) dispatchResponse(message acpWireMessage) {
	id := message.idString()
	t.mu.Lock()
	ch := t.pending[id]
	t.mu.Unlock()
	if ch == nil {
		return
	}
	ch <- message
}

func (t *StdioACPTransport) dispatchRequest(message acpWireMessage) {
	t.mu.Lock()
	handler := t.active
	t.mu.Unlock()
	if handler == nil {
		if message.hasID() {
			_ = t.writeError(message.idString(), -32601, "method not handled")
		}
		return
	}
	response, err := handler(context.Background(), ACPMessage{
		ID:     message.idString(),
		Method: message.Method,
		Params: message.Params,
	})
	if !message.hasID() {
		return
	}
	if err != nil {
		_ = t.writeError(message.idString(), -32000, err.Error())
		return
	}
	if response.Respond {
		_ = t.write(map[string]any{
			"jsonrpc": "2.0",
			"id":      message.idString(),
			"result":  response.Result,
		})
	}
}

func (t *StdioACPTransport) write(value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	t.writeMu.Lock()
	defer t.writeMu.Unlock()
	if _, err := t.stdin.Write(append(raw, '\n')); err != nil {
		return err
	}
	return nil
}

func (t *StdioACPTransport) writeError(id string, code int, message string) error {
	return t.write(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error": map[string]any{
			"code":    code,
			"message": message,
		},
	})
}

type acpWireMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *acpWireError   `json:"error,omitempty"`
}

type acpWireError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *acpWireError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("acp error code=%d: %s", e.Code, e.Message)
}

func (m acpWireMessage) hasID() bool {
	return len(m.ID) > 0 && string(m.ID) != "null"
}

func (m acpWireMessage) idString() string {
	if !m.hasID() {
		return ""
	}
	var text string
	if json.Unmarshal(m.ID, &text) == nil {
		return text
	}
	return strings.TrimSpace(string(m.ID))
}

func (m acpWireMessage) isResponse() bool {
	return m.hasID() && (m.Error != nil || m.Result != nil) && strings.TrimSpace(m.Method) == ""
}

func jsonString(raw json.RawMessage, path string) string {
	value := jsonRawValue(raw, path)
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func jsonRawObject(raw json.RawMessage, path string) any {
	return jsonRawValue(raw, path)
}

func jsonRawValue(raw json.RawMessage, path string) any {
	if len(raw) == 0 || strings.TrimSpace(path) == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil
	}
	for _, part := range strings.Split(path, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		value = object[part]
	}
	return value
}
