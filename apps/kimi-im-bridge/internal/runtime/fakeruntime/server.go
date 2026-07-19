package fakeruntime

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Config struct {
	TokenPath  string
	Transcript bool
}

type Event struct {
	Type      string `json:"type"`
	Seq       int    `json:"seq,omitempty"`
	SessionID string `json:"session_id"`
	Timestamp string `json:"timestamp,omitempty"`
	Payload   any    `json:"payload,omitempty"`
}

type workspace struct {
	ID, Root, Name string
}

type session struct {
	ID, WorkspaceID, Status, UpdatedAt string
	Metadata                           map[string]any
	LastSeq                            int
	Messages                           []any
}

type approval struct {
	ApprovalID, SessionID, ToolCallID, ToolName, Action, CreatedAt, ExpiresAt string
	ToolInputDisplay                                                          any
}

type Server struct {
	mu          sync.Mutex
	token       string
	epoch       string
	transcript  bool
	next        int
	workspaces  map[string]*workspace
	sessions    map[string]*session
	events      map[string][]Event
	approvals   map[string]map[string]*approval
	subs        map[chan Event]map[string]bool
	connections int
	pongs       int
	upgrader    websocket.Upgrader
}

func New(config Config) (*Server, error) {
	raw, err := os.ReadFile(strings.TrimSpace(config.TokenPath))
	if err != nil {
		return nil, fmt.Errorf("read fake runtime token: %w", err)
	}
	token := strings.TrimSpace(string(raw))
	if token == "" {
		return nil, fmt.Errorf("fake runtime token file is empty")
	}
	s := &Server{
		token: token, epoch: id("epoch"), transcript: config.Transcript,
		workspaces: map[string]*workspace{}, sessions: map[string]*session{},
		events: map[string][]Event{}, approvals: map[string]map[string]*approval{},
		subs: map[chan Event]map[string]bool{},
	}
	s.upgrader = websocket.Upgrader{Subprotocols: []string{"kimi-code.bearer." + token}, CheckOrigin: func(*http.Request) bool { return true }}
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/v1/ws" {
		s.serveWS(w, r)
		return
	}
	if r.Header.Get("Authorization") != "Bearer "+s.token {
		write(w, http.StatusUnauthorized, 401, "unauthorized", nil)
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1"), "/"), "/")
	switch {
	case len(parts) == 1 && parts[0] == "workspaces" && r.Method == http.MethodGet:
		s.listWorkspaces(w)
	case len(parts) == 1 && parts[0] == "workspaces" && r.Method == http.MethodPost:
		s.createWorkspace(w, r)
	case len(parts) == 1 && parts[0] == "sessions" && r.Method == http.MethodGet:
		s.listSessions(w, r)
	case len(parts) == 1 && parts[0] == "sessions" && r.Method == http.MethodPost:
		s.createSession(w, r)
	case len(parts) == 2 && parts[0] == "sessions" && r.Method == http.MethodGet:
		s.getSession(w, parts[1])
	case len(parts) == 3 && parts[0] == "sessions" && parts[2] == "messages" && r.Method == http.MethodGet:
		s.getMessages(w, parts[1])
	case len(parts) == 3 && parts[0] == "sessions" && parts[2] == "prompts" && r.Method == http.MethodPost:
		s.submitPrompt(w, r, parts[1])
	case len(parts) == 3 && parts[0] == "sessions" && parts[2] == "approvals" && r.Method == http.MethodGet:
		s.listApprovals(w, parts[1])
	case len(parts) == 4 && parts[0] == "sessions" && parts[2] == "approvals" && r.Method == http.MethodPost:
		s.resolveApproval(w, r, parts[1], parts[3])
	case len(parts) == 4 && parts[0] == "sessions" && parts[2] == "prompts" && strings.HasSuffix(parts[3], ":abort") && r.Method == http.MethodPost:
		s.abort(w, parts[1], strings.TrimSuffix(parts[3], ":abort"))
	case len(parts) == 2 && parts[0] == "_fake" && parts[1] == "events" && r.Method == http.MethodPost:
		var event Event
		if decode(w, r, &event) {
			write(w, http.StatusOK, 0, "ok", s.Inject(event))
		}
	case len(parts) == 2 && parts[0] == "_fake" && parts[1] == "restart" && r.Method == http.MethodPost:
		s.Restart()
		write(w, http.StatusOK, 0, "ok", map[string]any{"epoch": s.Epoch()})
	case len(parts) == 2 && parts[0] == "_fake" && parts[1] == "transcript" && r.Method == http.MethodPost:
		var body struct {
			Enabled bool `json:"enabled"`
		}
		if decode(w, r, &body) {
			s.mu.Lock()
			s.transcript = body.Enabled
			s.mu.Unlock()
			write(w, http.StatusOK, 0, "ok", body)
		}
	default:
		write(w, http.StatusNotFound, 40400, "not found", nil)
	}
}

func (s *Server) Inject(event Event) Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	if event.Timestamp == "" {
		event.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if event.Seq == 0 {
		if item := s.sessions[event.SessionID]; item != nil {
			item.LastSeq++
			event.Seq = item.LastSeq
		}
	} else if item := s.sessions[event.SessionID]; item != nil && event.Seq > item.LastSeq {
		item.LastSeq = event.Seq
	}
	s.events[event.SessionID] = append(s.events[event.SessionID], event)
	for ch, sessions := range s.subs {
		if sessions[event.SessionID] {
			select {
			case ch <- event:
			default:
			}
		}
	}
	return event
}

func (s *Server) AddApproval(sessionID, approvalID string) {
	s.mu.Lock()
	if s.approvals[sessionID] == nil {
		s.approvals[sessionID] = map[string]*approval{}
	}
	item := &approval{ApprovalID: approvalID, SessionID: sessionID, ToolCallID: id("tool"), ToolName: "bash", Action: "run", ToolInputDisplay: "echo fake", CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	s.approvals[sessionID][approvalID] = item
	s.mu.Unlock()
	s.Inject(Event{Type: "approval.requested", SessionID: sessionID, Payload: approvalJSON(item)})
}

func (s *Server) Restart() {
	s.mu.Lock()
	s.epoch = id("epoch")
	for id, item := range s.sessions {
		item.LastSeq = 0
		item.Status = "idle"
		s.events[id] = nil
	}
	for ch := range s.subs {
		select {
		case ch <- Event{Type: "resync_required", Payload: map[string]any{"epoch": s.epoch}}:
		default:
		}
	}
	s.mu.Unlock()
}

func (s *Server) Epoch() string { s.mu.Lock(); defer s.mu.Unlock(); return s.epoch }

func (s *Server) Ping() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.subs {
		select {
		case ch <- Event{Type: "ping", Payload: map[string]any{"sent_at": time.Now().UTC().Format(time.RFC3339Nano)}}:
		default:
		}
	}
}

func (s *Server) PongCount() int         { s.mu.Lock(); defer s.mu.Unlock(); return s.pongs }
func (s *Server) ConnectionCount() int   { s.mu.Lock(); defer s.mu.Unlock(); return s.connections }
func (s *Server) SubscriptionCount() int { s.mu.Lock(); defer s.mu.Unlock(); return len(s.subs) }

func (s *Server) SubscribedSessionIDs() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	seen := map[string]struct{}{}
	for _, sessions := range s.subs {
		for sessionID := range sessions {
			seen[sessionID] = struct{}{}
		}
	}
	items := make([]string, 0, len(seen))
	for sessionID := range seen {
		items = append(items, sessionID)
	}
	sort.Strings(items)
	return items
}

func (s *Server) createWorkspace(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Root string `json:"root"`
	}
	if !decode(w, r, &body) || strings.TrimSpace(body.Root) == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, item := range s.workspaces {
		if strings.EqualFold(item.Root, body.Root) {
			write(w, http.StatusOK, 0, "ok", workspaceJSON(item))
			return
		}
	}
	item := &workspace{ID: id("ws"), Root: body.Root, Name: path.Base(strings.ReplaceAll(body.Root, "\\", "/"))}
	s.workspaces[item.ID] = item
	write(w, http.StatusOK, 0, "ok", workspaceJSON(item))
}

func (s *Server) listWorkspaces(w http.ResponseWriter) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]any, 0, len(s.workspaces))
	for _, item := range s.workspaces {
		items = append(items, workspaceJSON(item))
	}
	write(w, http.StatusOK, 0, "ok", map[string]any{"items": items, "has_more": false})
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WorkspaceID string         `json:"workspace_id"`
		Metadata    map[string]any `json:"metadata"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if body.Metadata == nil {
		body.Metadata = map[string]any{}
	}
	if ws := s.workspaces[body.WorkspaceID]; ws != nil {
		body.Metadata["cwd"] = ws.Root
	}
	s.next++
	item := &session{ID: "sess_" + strconv.Itoa(s.next), WorkspaceID: body.WorkspaceID, Status: "idle", UpdatedAt: time.Now().UTC().Format(time.RFC3339), Metadata: body.Metadata}
	s.sessions[item.ID] = item
	write(w, http.StatusOK, 0, "ok", sessionJSON(item))
}

func (s *Server) listSessions(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := []any{}
	for _, item := range s.sessions {
		if ws := r.URL.Query().Get("workspace_id"); ws == "" || ws == item.WorkspaceID {
			items = append(items, sessionJSON(item))
		}
	}
	write(w, http.StatusOK, 0, "ok", map[string]any{"items": items, "has_more": false})
}

func (s *Server) getSession(w http.ResponseWriter, sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item := s.sessions[sessionID]
	if item == nil {
		write(w, http.StatusNotFound, 40401, "session not found", nil)
		return
	}
	write(w, http.StatusOK, 0, "ok", sessionJSON(item))
}

func (s *Server) getMessages(w http.ResponseWriter, sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.transcript {
		write(w, http.StatusNotFound, 40404, "transcript unsupported", nil)
		return
	}
	item := s.sessions[sessionID]
	if item == nil {
		write(w, http.StatusNotFound, 40401, "session not found", nil)
		return
	}
	write(w, http.StatusOK, 0, "ok", map[string]any{"items": item.Messages, "has_more": false})
}

func (s *Server) submitPrompt(w http.ResponseWriter, r *http.Request, sessionID string) {
	var body struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.mu.Lock()
	item := s.sessions[sessionID]
	if item == nil {
		s.mu.Unlock()
		write(w, http.StatusNotFound, 40401, "session not found", nil)
		return
	}
	promptID, messageID := id("prompt"), id("msg")
	text := ""
	if len(body.Content) > 0 {
		text = body.Content[0].Text
	}
	item.Status = "running"
	item.Messages = append(item.Messages, map[string]any{"id": messageID, "role": "user", "text": text, "prompt_id": promptID})
	s.mu.Unlock()
	write(w, http.StatusOK, 0, "ok", map[string]any{"prompt_id": promptID, "user_message_id": messageID, "status": "running"})
	s.Inject(Event{Type: "turn.started", SessionID: sessionID, Payload: map[string]any{"prompt_id": promptID}})
	s.Inject(Event{Type: "assistant.delta", SessionID: sessionID, Payload: map[string]any{"prompt_id": promptID, "delta": "fake reply"}})
	s.Inject(Event{Type: "turn.ended", SessionID: sessionID, Payload: map[string]any{"prompt_id": promptID, "reason": "completed"}})
	s.mu.Lock()
	item.Status = "idle"
	item.Messages = append(item.Messages, map[string]any{"id": id("msg"), "role": "assistant", "text": "fake reply", "prompt_id": promptID})
	s.mu.Unlock()
}

func (s *Server) listApprovals(w http.ResponseWriter, sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := []any{}
	for _, item := range s.approvals[sessionID] {
		items = append(items, approvalJSON(item))
	}
	write(w, http.StatusOK, 0, "ok", map[string]any{"items": items})
}

func (s *Server) resolveApproval(w http.ResponseWriter, r *http.Request, sessionID, approvalID string) {
	var body map[string]any
	if !decode(w, r, &body) {
		return
	}
	s.mu.Lock()
	item := s.approvals[sessionID][approvalID]
	if item != nil {
		delete(s.approvals[sessionID], approvalID)
	}
	s.mu.Unlock()
	if item == nil {
		write(w, http.StatusConflict, 40902, "approval already resolved", nil)
		return
	}
	s.Inject(Event{Type: "approval.resolved", SessionID: sessionID, Payload: map[string]any{"approval_id": approvalID, "decision": body["decision"]}})
	write(w, http.StatusOK, 0, "ok", map[string]any{"resolved": true})
}

func (s *Server) abort(w http.ResponseWriter, sessionID, promptID string) {
	s.mu.Lock()
	item := s.sessions[sessionID]
	s.mu.Unlock()
	if item == nil {
		write(w, http.StatusNotFound, 40401, "session not found", nil)
		return
	}
	e := s.Inject(Event{Type: "turn.ended", SessionID: sessionID, Payload: map[string]any{"prompt_id": promptID, "reason": "aborted"}})
	write(w, http.StatusOK, 0, "ok", map[string]any{"aborted": true, "at_seq": e.Seq})
}

func (s *Server) serveWS(w http.ResponseWriter, r *http.Request) {
	wanted := "kimi-code.bearer." + s.token
	found := false
	for _, protocol := range websocket.Subprotocols(r) {
		if protocol == wanted {
			found = true
		}
	}
	if !found {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	s.mu.Lock()
	s.connections++
	s.mu.Unlock()
	if err := conn.WriteJSON(map[string]any{"type": "server_hello", "payload": map[string]any{"epoch": s.Epoch(), "protocol_version": 1}}); err != nil {
		return
	}
	var hello struct {
		ID      string `json:"id"`
		Payload struct {
			Subscriptions []string `json:"subscriptions"`
			Cursors       map[string]struct {
				Seq   int    `json:"seq"`
				Epoch string `json:"epoch"`
			} `json:"cursors"`
		} `json:"payload"`
	}
	if conn.ReadJSON(&hello) != nil {
		return
	}
	// ponytail: bounded harness buffer; increase it if a stress test exceeds 1024 unconsumed events.
	ch := make(chan Event, 1024)
	selected := map[string]bool{}
	for _, id := range hello.Payload.Subscriptions {
		selected[id] = true
	}
	s.mu.Lock()
	epoch := s.epoch
	replay := []Event{}
	stale := false
	for id := range selected {
		cursor := hello.Payload.Cursors[id]
		if cursor.Epoch != "" && cursor.Epoch != epoch {
			stale = true
			continue
		}
		for _, event := range s.events[id] {
			if event.Seq > cursor.Seq {
				replay = append(replay, event)
			}
		}
	}
	s.subs[ch] = selected
	s.mu.Unlock()
	defer func() { s.mu.Lock(); delete(s.subs, ch); s.mu.Unlock() }()
	_ = conn.WriteJSON(map[string]any{"type": "ack", "id": hello.ID, "code": 0, "payload": map[string]any{"accepted_subscriptions": hello.Payload.Subscriptions, "epoch": epoch}})
	if stale {
		_ = conn.WriteJSON(map[string]any{"type": "resync_required", "payload": map[string]any{"epoch": epoch}})
	}
	for _, event := range replay {
		if conn.WriteJSON(event) != nil {
			return
		}
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, raw, err := conn.ReadMessage()
			if err != nil {
				return
			}
			var frame struct {
				Type string `json:"type"`
			}
			if json.Unmarshal(raw, &frame) == nil && frame.Type == "pong" {
				s.mu.Lock()
				s.pongs++
				s.mu.Unlock()
			}
		}
	}()
	for {
		select {
		case event := <-ch:
			if conn.WriteJSON(event) != nil {
				return
			}
		case <-done:
			return
		}
	}
}

func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		write(w, http.StatusBadRequest, 40000, "invalid json", nil)
		return false
	}
	return true
}

func write(w http.ResponseWriter, status, code int, message string, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "msg": message, "data": data, "request_id": "fake"})
}

func workspaceJSON(v *workspace) map[string]any {
	return map[string]any{"id": v.ID, "root": v.Root, "name": v.Name}
}
func sessionJSON(v *session) map[string]any {
	return map[string]any{"id": v.ID, "workspace_id": v.WorkspaceID, "status": v.Status, "updated_at": v.UpdatedAt, "metadata": v.Metadata, "last_seq": v.LastSeq}
}
func approvalJSON(v *approval) map[string]any {
	return map[string]any{"approval_id": v.ApprovalID, "session_id": v.SessionID, "tool_call_id": v.ToolCallID, "tool_name": v.ToolName, "action": v.Action, "tool_input_display": v.ToolInputDisplay, "created_at": v.CreatedAt, "expires_at": v.ExpiresAt}
}
func id(prefix string) string {
	var raw [8]byte
	_, _ = rand.Read(raw[:])
	return prefix + "_" + hex.EncodeToString(raw[:])
}
