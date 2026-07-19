package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type KimiCodeServerAdapterOptions struct {
	RuntimeLocatorPath string
	HTTPClient         *http.Client
	WSDialer           *websocket.Dialer
}

type KimiCodeServerAdapter struct {
	locatorPath string
	httpClient  *http.Client
	wsDialer    *websocket.Dialer
}

type SessionTranscriptQuery struct {
	BeforeID string
	AfterID  string
	Role     string
	PageSize int
}

type SessionTranscriptPage struct {
	Items   []json.RawMessage `json:"items"`
	HasMore bool              `json:"has_more"`
}

func (a *KimiCodeServerAdapter) CurrentGeneration() (int64, error) {
	locator, err := a.loadLocator()
	if err != nil {
		return 0, err
	}
	return locator.Generation, nil
}

func (a *KimiCodeServerAdapter) GetSessionTranscript(ctx context.Context, sessionID string, query SessionTranscriptQuery) (SessionTranscriptPage, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return SessionTranscriptPage{}, fmt.Errorf("session id is required")
	}
	values := url.Values{}
	if value := strings.TrimSpace(query.BeforeID); value != "" {
		values.Set("before_id", value)
	}
	if value := strings.TrimSpace(query.AfterID); value != "" {
		values.Set("after_id", value)
	}
	if value := strings.TrimSpace(query.Role); value != "" {
		values.Set("role", value)
	}
	if query.PageSize <= 0 || query.PageSize > 100 {
		query.PageSize = 100
	}
	values.Set("page_size", fmt.Sprintf("%d", query.PageSize))
	var page SessionTranscriptPage
	path := "/sessions/" + url.PathEscape(sessionID) + "/messages?" + values.Encode()
	if err := a.doJSON(ctx, http.MethodGet, path, nil, &page); err != nil {
		return SessionTranscriptPage{}, err
	}
	return page, nil
}

type runtimeLocatorSnapshot struct {
	Origin     string `json:"origin"`
	TokenPath  string `json:"tokenPath"`
	Health     string `json:"health"`
	Generation int64  `json:"generation,omitempty"`
}

type apiEnvelope struct {
	Code      int             `json:"code"`
	Msg       string          `json:"msg"`
	Data      json.RawMessage `json:"data"`
	RequestID string          `json:"request_id"`
}

type apiSessionPage struct {
	Items   []apiSession `json:"items"`
	HasMore bool         `json:"has_more"`
}

type apiSession struct {
	ID                 string         `json:"id"`
	WorkspaceID        string         `json:"workspace_id"`
	UpdatedAt          string         `json:"updated_at"`
	Status             string         `json:"status"`
	Busy               bool           `json:"busy"`
	MainTurnActive     bool           `json:"main_turn_active"`
	PendingInteraction string         `json:"pending_interaction"`
	Metadata           map[string]any `json:"metadata"`
	LastSeq            int            `json:"last_seq"`
}

type apiWorkspace struct {
	ID   string `json:"id"`
	Root string `json:"root"`
	Name string `json:"name"`
}

type apiPromptResult struct {
	PromptID      string `json:"prompt_id"`
	UserMessageID string `json:"user_message_id"`
	Status        string `json:"status"`
}

type apiRuntimeConfig struct {
	DefaultModel string `json:"default_model"`
}

type apiApprovalPage struct {
	Items []apiApproval `json:"items"`
}

type apiApproval struct {
	ApprovalID       string `json:"approval_id"`
	SessionID        string `json:"session_id"`
	ToolCallID       string `json:"tool_call_id"`
	ToolName         string `json:"tool_name"`
	Action           string `json:"action"`
	ToolInputDisplay any    `json:"tool_input_display"`
	CreatedAt        string `json:"created_at"`
	ExpiresAt        string `json:"expires_at"`
}

func NewKimiCodeServerAdapter(options KimiCodeServerAdapterOptions) (*KimiCodeServerAdapter, error) {
	locatorPath := strings.TrimSpace(options.RuntimeLocatorPath)
	if locatorPath == "" {
		return nil, fmt.Errorf("runtime locator path is required")
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &KimiCodeServerAdapter{
		locatorPath: locatorPath,
		httpClient:  client,
		wsDialer:    options.WSDialer,
	}, nil
}

func (a *KimiCodeServerAdapter) EnsureWorkspace(ctx context.Context, root string) (WorkspaceRef, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return WorkspaceRef{}, fmt.Errorf("workspace root is required")
	}
	var workspace apiWorkspace
	if err := a.doJSON(ctx, http.MethodPost, "/workspaces", map[string]any{"root": root}, &workspace); err != nil {
		return WorkspaceRef{}, err
	}
	return WorkspaceRef{
		WorkspaceID: workspace.ID,
		Root:        firstNonEmptyString(workspace.Root, root),
	}, nil
}

func (a *KimiCodeServerAdapter) EnsureSession(ctx context.Context, request EnsureSessionRequest) (SessionRef, error) {
	mode := request.CreateMode
	if mode == "" {
		mode = SessionCreateIfMissing
	}
	if mode != SessionCreateIfMissing && mode != SessionCreateAlways && mode != SessionResumeExact && mode != SessionReuseLatest {
		return SessionRef{}, fmt.Errorf("unsupported session create mode %q", mode)
	}

	sessionID := strings.TrimSpace(request.KimiCodeSessionID)
	if sessionID != "" {
		if mode == SessionCreateAlways || mode == SessionReuseLatest {
			return SessionRef{}, fmt.Errorf("session id cannot be used with create mode %q", mode)
		}
		session, err := a.getSession(ctx, sessionID)
		if err != nil {
			return SessionRef{}, err
		}
		if mode == SessionResumeExact {
			workspaceID := strings.TrimSpace(request.WorkspaceID)
			if workspaceID != "" && workspaceID != strings.TrimSpace(session.WorkspaceID) {
				return SessionRef{}, fmt.Errorf("workspace_mismatch: session %s is not in workspace %s", sessionID, workspaceID)
			}
			workspaceRoot := strings.TrimSpace(request.WorkspaceRoot)
			if workspaceRoot != "" && !samePath(session.workDir(), workspaceRoot) {
				return SessionRef{}, fmt.Errorf("workspace_mismatch: session %s is not in workspace root %s", sessionID, workspaceRoot)
			}
		}
		return sessionRefFromAPI(session, firstNonEmptyString(request.SessionSource, "imported"), WorkspaceRef{}), nil
	}
	if mode == SessionResumeExact {
		return SessionRef{}, fmt.Errorf("session id is required for create mode %q", mode)
	}

	workspaceRoot := strings.TrimSpace(request.WorkspaceRoot)
	workspaceID := strings.TrimSpace(request.WorkspaceID)
	if workspaceID == "" && workspaceRoot != "" {
		workspace, err := a.EnsureWorkspace(ctx, workspaceRoot)
		if err == nil {
			workspaceID = workspace.WorkspaceID
			workspaceRoot = firstNonEmptyString(workspaceRoot, workspace.Root)
		}
	}
	workspace := WorkspaceRef{WorkspaceID: workspaceID, Root: workspaceRoot}

	if workspaceID != "" {
		if mode == SessionCreateAlways {
			session, err := a.createSession(ctx, workspaceID, "")
			if err != nil {
				return SessionRef{}, err
			}
			return sessionRefFromAPI(session, firstNonEmptyString(request.SessionSource, "server_created"), workspace), nil
		}
		sessions, err := a.listSessions(ctx, workspaceID)
		if err != nil {
			return SessionRef{}, err
		}
		if len(sessions) > 0 {
			source := "server_reconciled"
			if mode == SessionReuseLatest {
				source = "server_reused_latest"
			}
			return sessionRefFromAPI(sessions[0], firstNonEmptyString(request.SessionSource, source), workspace), nil
		}
		session, err := a.createSession(ctx, workspaceID, "")
		if err != nil {
			return SessionRef{}, err
		}
		return sessionRefFromAPI(session, firstNonEmptyString(request.SessionSource, "auto"), workspace), nil
	}

	if workspaceRoot == "" {
		return SessionRef{}, fmt.Errorf("workspace root or workspace id is required")
	}
	if mode == SessionCreateAlways {
		session, err := a.createSession(ctx, "", workspaceRoot)
		if err != nil {
			return SessionRef{}, err
		}
		return sessionRefFromAPI(session, firstNonEmptyString(request.SessionSource, "server_created"), workspace), nil
	}

	sessions, err := a.listSessions(ctx, "")
	if err == nil {
		for _, session := range sessions {
			if samePath(session.workDir(), workspaceRoot) {
				source := "server_reconciled"
				if mode == SessionReuseLatest {
					source = "server_reused_latest"
				}
				return sessionRefFromAPI(session, firstNonEmptyString(request.SessionSource, source), workspace), nil
			}
		}
	}

	session, err := a.createSession(ctx, "", workspaceRoot)
	if err != nil {
		return SessionRef{}, err
	}
	return sessionRefFromAPI(session, firstNonEmptyString(request.SessionSource, "auto"), workspace), nil
}

func (a *KimiCodeServerAdapter) InspectSession(ctx context.Context, sessionID string) (RuntimeSessionState, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return RuntimeSessionState{}, fmt.Errorf("session id is required")
	}
	session, err := a.getSession(ctx, sessionID)
	if err != nil {
		return RuntimeSessionState{}, err
	}
	locator, err := a.loadLocator()
	if err != nil {
		return RuntimeSessionState{}, err
	}
	return RuntimeSessionState{
		SessionID:     session.ID,
		WorkspaceID:   session.WorkspaceID,
		WorkspaceRoot: session.workDir(),
		Status:        sessionRuntimeStatus(session),
		LastSeq:       int64(session.LastSeq),
		ObservedAt:    time.Now().UTC().Format(time.RFC3339),
		Generation:    locator.Generation,
	}, nil
}

func sessionRuntimeStatus(session apiSession) string {
	if status := strings.TrimSpace(session.Status); status != "" {
		return status
	}
	pending := strings.ToLower(strings.TrimSpace(session.PendingInteraction))
	if pending != "" && pending != "none" {
		return "waiting_approval"
	}
	if session.Busy || session.MainTurnActive {
		return "running"
	}
	return "idle"
}

func (a *KimiCodeServerAdapter) SubmitPrompt(ctx context.Context, request AdapterPromptRequest, sink AdapterEventSink) (AdapterPromptResult, error) {
	sessionID := strings.TrimSpace(request.SessionID)
	text := strings.TrimSpace(request.Text)
	if sessionID == "" {
		return AdapterPromptResult{}, fmt.Errorf("session id is required")
	}
	if text == "" {
		return AdapterPromptResult{}, fmt.Errorf("prompt text is required")
	}
	if len(request.Attachments) > 0 {
		return AdapterPromptResult{}, fmt.Errorf("attachments_unsupported: Kimi Code Server prompt attachment contract is unavailable")
	}
	cursor := 0
	if session, err := a.getSession(ctx, sessionID); err == nil {
		cursor = session.LastSeq
	}

	body := map[string]any{
		"content": []map[string]string{{"type": "text", "text": text}},
	}
	if len(request.Metadata) > 0 {
		body["metadata"] = request.Metadata
	}
	controls := request.Controls
	if strings.TrimSpace(controls.Model) == "" {
		var config apiRuntimeConfig
		if err := a.doJSON(ctx, http.MethodGet, "/config", nil, &config); err == nil {
			controls.Model = strings.TrimSpace(config.DefaultModel)
		}
	}
	applyPromptControls(body, controls)

	var result apiPromptResult
	path := fmt.Sprintf("/sessions/%s/prompts", url.PathEscape(sessionID))
	if err := a.doJSON(ctx, http.MethodPost, path, body, &result); err != nil {
		return AdapterPromptResult{}, err
	}
	mapped := AdapterPromptResult{
		PromptID:      result.PromptID,
		UserMessageID: result.UserMessageID,
		Status:        result.Status,
	}
	if sink != nil {
		if err := sink(AdapterEvent{Type: "prompt_submitted", PromptID: mapped.PromptID, Status: mapped.Status}); err != nil {
			return mapped, err
		}
		status, err := a.streamPromptEvents(ctx, sessionID, mapped.PromptID, cursor, sink)
		if err != nil {
			return mapped, err
		}
		if strings.TrimSpace(status) != "" {
			mapped.Status = status
		}
	}
	return mapped, nil
}

type wsFrame struct {
	Type      string          `json:"type"`
	ID        string          `json:"id,omitempty"`
	Code      int             `json:"code,omitempty"`
	Msg       string          `json:"msg,omitempty"`
	Seq       int             `json:"seq,omitempty"`
	SessionID string          `json:"session_id,omitempty"`
	Timestamp string          `json:"timestamp,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type wsCursor struct {
	Seq   int    `json:"seq"`
	Epoch string `json:"epoch,omitempty"`
}

const (
	wsBearerProtocolPrefix = "kimi-code.bearer."
	wsHelloTimeout         = 15 * time.Second
	wsReadIdleTimeout      = 2 * time.Minute
)

func (a *KimiCodeServerAdapter) streamPromptEvents(
	ctx context.Context,
	sessionID string,
	promptID string,
	cursor int,
	sink AdapterEventSink,
) (string, error) {
	locator, err := a.loadLocator()
	if err != nil {
		return "", err
	}
	token, err := readServerToken(locator.TokenPath)
	if err != nil {
		return "", err
	}
	wsURL, err := websocketURL(locator.Origin)
	if err != nil {
		return "", err
	}

	dialerCopy := *websocket.DefaultDialer
	if a.wsDialer != nil {
		dialerCopy = *a.wsDialer
	}
	dialer := &dialerCopy
	dialer.Subprotocols = append([]string{wsBearerProtocolPrefix + token}, dialer.Subprotocols...)
	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return "", fmt.Errorf("connect kimi-code websocket: %w", err)
	}
	defer conn.Close()

	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-done:
		}
	}()

	if err := a.waitForServerHelloAndSubscribe(conn, sessionID, cursor); err != nil {
		return "", err
	}

	for {
		if err := conn.SetReadDeadline(time.Now().Add(wsReadIdleTimeout)); err != nil {
			return "", fmt.Errorf("set kimi-code websocket read deadline: %w", err)
		}
		var frame wsFrame
		if err := conn.ReadJSON(&frame); err != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			return "", fmt.Errorf("read kimi-code websocket frame: %w", err)
		}
		status, done, err := handlePromptWSFrame(conn, frame, sessionID, promptID, sink)
		if err != nil {
			return "", err
		}
		if done {
			return status, nil
		}
	}
}

func (a *KimiCodeServerAdapter) waitForServerHelloAndSubscribe(conn *websocket.Conn, sessionID string, cursor int) error {
	for {
		if err := conn.SetReadDeadline(time.Now().Add(wsHelloTimeout)); err != nil {
			return fmt.Errorf("set kimi-code websocket hello deadline: %w", err)
		}
		var frame wsFrame
		if err := conn.ReadJSON(&frame); err != nil {
			return fmt.Errorf("read kimi-code websocket hello: %w", err)
		}
		switch frame.Type {
		case "server_hello":
			return conn.WriteJSON(map[string]any{
				"type": "client_hello",
				"id":   "bridge-client-hello",
				"payload": map[string]any{
					"subscriptions": []string{sessionID},
					"cursors": map[string]wsCursor{
						sessionID: {Seq: cursor},
					},
				},
			})
		case "ping":
			if err := writePong(conn, frame); err != nil {
				return err
			}
		case "error":
			return fmt.Errorf("kimi-code websocket error before hello: %s", string(frame.Payload))
		}
	}
}

func handlePromptWSFrame(
	conn *websocket.Conn,
	frame wsFrame,
	sessionID string,
	promptID string,
	sink AdapterEventSink,
) (string, bool, error) {
	switch frame.Type {
	case "ping":
		return "", false, writePong(conn, frame)
	case "ack", "server_hello", "resync_required":
		return "", false, nil
	case "error":
		message := firstNonEmptyString(payloadString(frame.Payload, "message"), payloadString(frame.Payload, "msg"), string(frame.Payload))
		return "failed", true, fmt.Errorf("kimi-code websocket error: %s", strings.TrimSpace(message))
	}
	if frame.SessionID != "" && frame.SessionID != sessionID {
		return "", false, nil
	}

	eventType := strings.TrimPrefix(frame.Type, "event.")
	if !promptEventMatches(frame.Payload, promptID) {
		return "", false, nil
	}

	switch eventType {
	case "turn.started":
		return "", false, sinkAdapterEvent(sink, AdapterEvent{Type: "turn_started", PromptID: promptID, Status: "running"})
	case "turn.step.started":
		return "", false, sinkAdapterEvent(sink, AdapterEvent{Type: "step_started", PromptID: promptID, Status: "running"})
	case "assistant.delta":
		text := payloadString(frame.Payload, "delta")
		if text == "" {
			return "", false, nil
		}
		return "", false, sinkAdapterEvent(sink, AdapterEvent{Type: "content_delta", PromptID: promptID, Text: text})
	case "thinking.delta":
		text := payloadString(frame.Payload, "delta")
		if text == "" {
			return "", false, nil
		}
		return "", false, sinkAdapterEvent(sink, AdapterEvent{Type: "thinking_delta", PromptID: promptID, Text: text})
	case "agent.status.updated":
		return "", false, sinkAdapterEvent(sink, AdapterEvent{Type: "status_update", PromptID: promptID, Status: "running"})
	case "approval.requested":
		approval := runtimeApprovalFromPayload(frame.Payload, sessionID)
		return "", false, sinkAdapterEvent(sink, AdapterEvent{Type: "approval_requested", PromptID: promptID, Approval: &approval})
	case "approval.resolved":
		approval := runtimeApprovalFromPayload(frame.Payload, sessionID)
		return "", false, sinkAdapterEvent(sink, AdapterEvent{Type: "approval_resolved", PromptID: promptID, Approval: &approval})
	case "turn.ended":
		reason := strings.TrimSpace(payloadString(frame.Payload, "reason"))
		status := statusFromTurnEndReason(reason)
		eventType := "turn_completed"
		code, message := promptFailureFromPayload(frame.Payload)
		if status == "failed" || status == "aborted" {
			eventType = "turn_failed"
		}
		if message == "" {
			message = errorFromReason(status, reason)
		}
		if sinkErr := sinkAdapterEvent(sink, AdapterEvent{Type: eventType, PromptID: promptID, Status: status, ErrorCode: code, Error: message}); sinkErr != nil {
			return status, true, sinkErr
		}
		if status == "failed" {
			return status, true, &PromptFailureError{Code: code, Message: message}
		}
		return status, true, nil
	case "prompt.completed":
		status := statusFromTurnEndReason(payloadString(frame.Payload, "reason"))
		if sinkErr := sinkAdapterEvent(sink, AdapterEvent{Type: "prompt_completed", PromptID: promptID, Status: status}); sinkErr != nil {
			return status, true, sinkErr
		}
		if status == "failed" {
			code, message := promptFailureFromPayload(frame.Payload)
			return status, true, &PromptFailureError{Code: code, Message: message}
		}
		return status, true, nil
	default:
		return "", false, nil
	}
}

func promptFailureFromPayload(payload json.RawMessage) (string, string) {
	var value struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Error   struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(payload, &value) != nil {
		return "", ""
	}
	return firstNonEmptyString(value.Code, value.Error.Code), firstNonEmptyString(value.Message, value.Error.Message)
}

func writePong(conn *websocket.Conn, frame wsFrame) error {
	var payload map[string]any
	if len(frame.Payload) > 0 {
		_ = json.Unmarshal(frame.Payload, &payload)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	return conn.WriteJSON(map[string]any{"type": "pong", "payload": payload})
}

func sinkAdapterEvent(sink AdapterEventSink, event AdapterEvent) error {
	if sink == nil || strings.TrimSpace(event.Type) == "" {
		return nil
	}
	return sink(event)
}

func websocketURL(origin string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(origin))
	if err != nil {
		return "", err
	}
	switch parsed.Scheme {
	case "http":
		parsed.Scheme = "ws"
	case "https":
		parsed.Scheme = "wss"
	case "ws", "wss":
	default:
		return "", fmt.Errorf("unsupported websocket origin scheme %q", parsed.Scheme)
	}
	parsed.Path = "/api/v1/ws"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func promptEventMatches(payload json.RawMessage, promptID string) bool {
	promptID = strings.TrimSpace(promptID)
	if promptID == "" {
		return true
	}
	for _, key := range []string{"promptId", "prompt_id"} {
		value := payloadString(payload, key)
		if value != "" {
			return value == promptID
		}
	}
	return true
}

func statusFromTurnEndReason(reason string) string {
	switch strings.TrimSpace(strings.ToLower(reason)) {
	case "failed", "filtered", "error":
		return "failed"
	case "cancelled", "canceled", "aborted":
		return "aborted"
	default:
		return "completed"
	}
}

func errorFromReason(status string, reason string) string {
	if status == "failed" || status == "aborted" {
		return strings.TrimSpace(reason)
	}
	return ""
}

func runtimeApprovalFromPayload(payload json.RawMessage, fallbackSessionID string) RuntimeApproval {
	return RuntimeApproval{
		ApprovalID:       firstNonEmptyString(payloadString(payload, "approval_id"), payloadString(payload, "approvalId")),
		SessionID:        firstNonEmptyString(payloadString(payload, "session_id"), payloadString(payload, "sessionId"), fallbackSessionID),
		ToolCallID:       firstNonEmptyString(payloadString(payload, "tool_call_id"), payloadString(payload, "toolCallId")),
		ToolName:         firstNonEmptyString(payloadString(payload, "tool_name"), payloadString(payload, "toolName")),
		Action:           payloadString(payload, "action"),
		ToolInputDisplay: payloadValue(payload, "tool_input_display", "toolInputDisplay", "display"),
		CreatedAt:        firstNonEmptyString(payloadString(payload, "created_at"), payloadString(payload, "createdAt")),
		ExpiresAt:        firstNonEmptyString(payloadString(payload, "expires_at"), payloadString(payload, "expiresAt")),
	}
}

func payloadString(payload json.RawMessage, key string) string {
	if len(payload) == 0 {
		return ""
	}
	var object map[string]any
	if err := json.Unmarshal(payload, &object); err != nil {
		return ""
	}
	value, ok := object[key]
	if !ok {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return text
}

func payloadValue(payload json.RawMessage, keys ...string) any {
	if len(payload) == 0 {
		return nil
	}
	var object map[string]any
	if err := json.Unmarshal(payload, &object); err != nil {
		return nil
	}
	for _, key := range keys {
		if value, ok := object[key]; ok {
			return value
		}
	}
	return nil
}

func (a *KimiCodeServerAdapter) ListApprovals(ctx context.Context, sessionID string) ([]RuntimeApproval, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil, fmt.Errorf("session id is required")
	}
	var page apiApprovalPage
	path := fmt.Sprintf("/sessions/%s/approvals?status=pending", url.PathEscape(sessionID))
	if err := a.doJSON(ctx, http.MethodGet, path, nil, &page); err != nil {
		return nil, err
	}
	items := make([]RuntimeApproval, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, RuntimeApproval{
			ApprovalID:       item.ApprovalID,
			SessionID:        item.SessionID,
			ToolCallID:       item.ToolCallID,
			ToolName:         item.ToolName,
			Action:           item.Action,
			ToolInputDisplay: item.ToolInputDisplay,
			CreatedAt:        item.CreatedAt,
			ExpiresAt:        item.ExpiresAt,
		})
	}
	return items, nil
}

func (a *KimiCodeServerAdapter) ResolveApproval(ctx context.Context, sessionID string, approvalID string, decision ApprovalDecision) error {
	sessionID = strings.TrimSpace(sessionID)
	approvalID = strings.TrimSpace(approvalID)
	if sessionID == "" || approvalID == "" {
		return fmt.Errorf("session id and approval id are required")
	}
	body := map[string]any{"decision": strings.TrimSpace(decision.Decision)}
	if scope := strings.TrimSpace(decision.Scope); scope != "" {
		body["scope"] = scope
	}
	if feedback := strings.TrimSpace(decision.Feedback); feedback != "" {
		body["feedback"] = feedback
	}
	if label := strings.TrimSpace(decision.SelectedLabel); label != "" {
		body["selected_label"] = label
	}
	path := fmt.Sprintf("/sessions/%s/approvals/%s", url.PathEscape(sessionID), url.PathEscape(approvalID))
	return a.doJSON(ctx, http.MethodPost, path, body, nil, 40902)
}

func (a *KimiCodeServerAdapter) AbortPrompt(ctx context.Context, sessionID string, promptID string) error {
	sessionID = strings.TrimSpace(sessionID)
	promptID = strings.TrimSpace(promptID)
	if sessionID == "" || promptID == "" {
		return fmt.Errorf("session id and prompt id are required")
	}
	path := fmt.Sprintf("/sessions/%s/prompts/%s:abort", url.PathEscape(sessionID), url.PathEscape(promptID))
	return a.doJSON(ctx, http.MethodPost, path, map[string]any{}, nil, 40903)
}

func (a *KimiCodeServerAdapter) Close() error {
	return nil
}

func (a *KimiCodeServerAdapter) getSession(ctx context.Context, sessionID string) (apiSession, error) {
	var session apiSession
	path := fmt.Sprintf("/sessions/%s", url.PathEscape(sessionID))
	if err := a.doJSON(ctx, http.MethodGet, path, nil, &session); err != nil {
		return apiSession{}, err
	}
	return session, nil
}

func (a *KimiCodeServerAdapter) listSessions(ctx context.Context, workspaceID string) ([]apiSession, error) {
	query := url.Values{}
	query.Set("page_size", "100")
	if strings.TrimSpace(workspaceID) != "" {
		query.Set("workspace_id", strings.TrimSpace(workspaceID))
	}
	var page apiSessionPage
	if err := a.doJSON(ctx, http.MethodGet, "/sessions?"+query.Encode(), nil, &page); err != nil {
		return nil, err
	}
	return page.Items, nil
}

func (a *KimiCodeServerAdapter) createSession(ctx context.Context, workspaceID string, workspaceRoot string) (apiSession, error) {
	body := map[string]any{}
	if workspaceID = strings.TrimSpace(workspaceID); workspaceID != "" {
		body["workspace_id"] = workspaceID
	} else if workspaceRoot = strings.TrimSpace(workspaceRoot); workspaceRoot != "" {
		body["metadata"] = map[string]any{"cwd": workspaceRoot}
	} else {
		return apiSession{}, fmt.Errorf("workspace id or root is required")
	}
	var session apiSession
	if err := a.doJSON(ctx, http.MethodPost, "/sessions", body, &session); err != nil {
		return apiSession{}, err
	}
	return session, nil
}

func (a *KimiCodeServerAdapter) doJSON(ctx context.Context, method string, apiPath string, body any, target any, allowedCodes ...int) error {
	locator, err := a.loadLocator()
	if err != nil {
		return err
	}
	token, err := readServerToken(locator.TokenPath)
	if err != nil {
		return err
	}

	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal kimi-code request body: %w", err)
		}
		reader = bytes.NewReader(raw)
	}

	requestURL := strings.TrimRight(locator.Origin, "/") + normalizeServerAPIPath(apiPath)
	req, err := http.NewRequestWithContext(ctx, method, requestURL, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	res, err := a.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("kimi-code %s %s failed: %w", method, normalizeServerAPIPath(apiPath), err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		return fmt.Errorf("read kimi-code response body: %w", err)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("kimi-code %s %s returned HTTP %d: %s", method, normalizeServerAPIPath(apiPath), res.StatusCode, truncateString(string(raw), 240))
	}

	var envelope apiEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("decode kimi-code envelope: %w", err)
	}
	if envelope.Code != 0 && !intIn(envelope.Code, allowedCodes) {
		requestID := ""
		if strings.TrimSpace(envelope.RequestID) != "" {
			requestID = " request_id=" + strings.TrimSpace(envelope.RequestID)
		}
		return fmt.Errorf("kimi-code API returned code=%d%s: %s", envelope.Code, requestID, strings.TrimSpace(envelope.Msg))
	}
	if target == nil || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil
	}
	if err := json.Unmarshal(envelope.Data, target); err != nil {
		return fmt.Errorf("decode kimi-code envelope data: %w", err)
	}
	return nil
}

func (a *KimiCodeServerAdapter) loadLocator() (runtimeLocatorSnapshot, error) {
	raw, err := os.ReadFile(a.locatorPath)
	if err != nil {
		return runtimeLocatorSnapshot{}, fmt.Errorf("read runtime locator: %w", err)
	}
	var locator runtimeLocatorSnapshot
	if err := json.Unmarshal(raw, &locator); err != nil {
		return runtimeLocatorSnapshot{}, fmt.Errorf("decode runtime locator: %w", err)
	}
	locator.Origin = strings.TrimSpace(locator.Origin)
	locator.TokenPath = strings.TrimSpace(locator.TokenPath)
	locator.Health = strings.TrimSpace(locator.Health)
	if locator.Health != "" && locator.Health != "ready" {
		return runtimeLocatorSnapshot{}, fmt.Errorf("kimi-code runtime is not ready: health=%s", locator.Health)
	}
	if locator.Origin == "" {
		return runtimeLocatorSnapshot{}, fmt.Errorf("runtime locator origin is empty")
	}
	if locator.TokenPath == "" {
		return runtimeLocatorSnapshot{}, fmt.Errorf("runtime locator tokenPath is empty")
	}
	return locator, nil
}

func readServerToken(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("server token path is empty")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read kimi-code server token: %w", err)
	}
	token := strings.TrimSpace(string(raw))
	if token == "" {
		return "", fmt.Errorf("kimi-code server token file is empty")
	}
	return token, nil
}

func normalizeServerAPIPath(apiPath string) string {
	apiPath = strings.TrimSpace(apiPath)
	if apiPath == "" {
		return "/api/v1"
	}
	if strings.HasPrefix(apiPath, "/api/v1") {
		return apiPath
	}
	if strings.HasPrefix(apiPath, "/") {
		return "/api/v1" + apiPath
	}
	return "/api/v1/" + apiPath
}

func sessionRefFromAPI(session apiSession, source string, fallback WorkspaceRef) SessionRef {
	return SessionRef{
		KimiCodeSessionID: session.ID,
		WorkspaceRoot:     firstNonEmptyString(session.workDir(), fallback.Root),
		WorkspaceID:       firstNonEmptyString(session.WorkspaceID, fallback.WorkspaceID),
		SessionSource:     source,
		RuntimeAdapter:    RuntimeAdapterServer,
	}
}

func (s apiSession) workDir() string {
	if s.Metadata == nil {
		return ""
	}
	for _, key := range []string{"cwd", "work_dir", "workDir", "workspace_root", "workspaceRoot", "root"} {
		value, ok := s.Metadata[key]
		if !ok {
			continue
		}
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func samePath(left string, right string) bool {
	left = strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(left), "\\", "/"), "/")
	right = strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(right), "\\", "/"), "/")
	if left == "" || right == "" {
		return false
	}
	return strings.EqualFold(left, right)
}

func applyPromptControls(body map[string]any, controls RuntimeControls) {
	if model := strings.TrimSpace(controls.Model); model != "" {
		body["model"] = model
	}
	if thinking := strings.TrimSpace(controls.Thinking); thinking != "" {
		body["thinking"] = thinking
	}
	if permission := strings.TrimSpace(controls.PermissionMode); permission != "" {
		body["permission_mode"] = permission
	}
	if controls.PlanMode {
		body["plan_mode"] = true
	}
	if controls.SwarmMode {
		body["swarm_mode"] = true
	}
	if objective := strings.TrimSpace(controls.GoalObjective); objective != "" {
		body["goal_objective"] = objective
	}
	if control := strings.TrimSpace(controls.GoalControl); control != "" {
		body["goal_control"] = control
	}
}

func intIn(value int, values []int) bool {
	for _, item := range values {
		if value == item {
			return true
		}
	}
	return false
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func truncateString(value string, maxChars int) string {
	if maxChars <= 0 {
		return ""
	}
	runes := []rune(value)
	if len(runes) <= maxChars {
		return value
	}
	return string(runes[:maxChars]) + "..."
}

var _ RuntimeAdapter = (*KimiCodeServerAdapter)(nil)
