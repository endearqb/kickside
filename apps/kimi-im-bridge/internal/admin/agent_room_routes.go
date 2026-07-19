package admin

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/agentroom"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type AgentRoomCapabilitySnapshot struct {
	RuntimeProvider         string   `json:"runtimeProvider"`
	Core                    bool     `json:"core"`
	Observer                bool     `json:"observer"`
	MultiSessionObservation bool     `json:"multiSessionObservation"`
	SessionTranscript       bool     `json:"sessionTranscript"`
	UserPromptEvents        bool     `json:"userPromptEvents"`
	Abort                   bool     `json:"abort"`
	Approval                bool     `json:"approval"`
	NativeFollowUp          bool     `json:"nativeFollowUp"`
	Degradations            []string `json:"degradations,omitempty"`
}

type AgentRoomRoutes struct {
	core         *agentroom.Service
	store        *store.Store
	capabilities func(context.Context) AgentRoomCapabilitySnapshot
	dispatcher   interface {
		Dispatch(context.Context, string, agentroom.MessageInput) (agentroom.MessageRunsResult, error)
	}
}

func NewAgentRoomRoutes(core *agentroom.Service, storeHandle *store.Store, capabilities func(context.Context) AgentRoomCapabilitySnapshot, dispatchers ...interface {
	Dispatch(context.Context, string, agentroom.MessageInput) (agentroom.MessageRunsResult, error)
}) *AgentRoomRoutes {
	routes := &AgentRoomRoutes{core: core, store: storeHandle, capabilities: capabilities}
	if len(dispatchers) > 0 {
		routes.dispatcher = dispatchers[0]
	}
	return routes
}

func (r *AgentRoomRoutes) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	parts := splitAgentRoomPath(request.URL.Path)
	if len(parts) == 0 {
		writeAdminError(writer, request, http.StatusNotFound, "not_found", "agent room endpoint not found", nil)
		return
	}
	switch parts[0] {
	case "agents":
		r.serveAgents(writer, request, parts[1:])
	case "rooms":
		r.serveRooms(writer, request, parts[1:])
	case "runs":
		r.serveRuns(writer, request, parts[1:])
	case "pane-sessions":
		r.servePaneSessions(writer, request, parts[1:])
	case "observations":
		r.serveObservations(writer, request, parts[1:])
	case "events":
		r.serveEvents(writer, request, parts[1:])
	case "capabilities":
		if len(parts) != 1 || request.Method != http.MethodGet {
			r.methodOrNotFound(writer, request, len(parts) == 1)
			return
		}
		snapshot := AgentRoomCapabilitySnapshot{Core: true, Degradations: []string{"server_provider_required", "observer_not_running", "abort_unconfirmed"}}
		if r.capabilities != nil {
			snapshot = r.capabilities(request.Context())
		}
		writeAdminData(writer, request, http.StatusOK, snapshot)
	case "connector-bindings":
		r.serveConnectorBindings(writer, request, parts[1:])
	default:
		writeAdminError(writer, request, http.StatusNotFound, "not_found", "agent room endpoint not found", nil)
	}
}

func (r *AgentRoomRoutes) serveConnectorBindings(w http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) == 0 {
		if req.Method != http.MethodGet {
			r.methodOrNotFound(w, req, true)
			return
		}
		items, err := r.store.ListAgentConnectorBindings(req.Context())
		r.writeResult(w, req, map[string]any{"items": items}, err, http.StatusOK)
		return
	}
	if len(parts) != 1 || strings.TrimSpace(parts[0]) == "" {
		r.methodOrNotFound(w, req, false)
		return
	}
	switch req.Method {
	case http.MethodPut:
		var body struct {
			AgentID     string `json:"agentId"`
			SessionMode string `json:"sessionMode"`
		}
		if !decodeAgentRoomJSON(w, req, &body) {
			return
		}
		item, err := r.core.PutConnectorBinding(req.Context(), parts[0], body.AgentID, body.SessionMode)
		r.writeResult(w, req, item, err, http.StatusOK)
	case http.MethodDelete:
		err := r.core.DeleteConnectorBinding(req.Context(), parts[0])
		r.writeResult(w, req, map[string]string{"status": "deleted"}, err, http.StatusOK)
	default:
		r.methodOrNotFound(w, req, true)
	}
}

func (r *AgentRoomRoutes) serveAgents(w http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) == 0 {
		switch req.Method {
		case http.MethodGet:
			items, err := r.store.ListAgentProfiles(req.Context())
			if !r.writeResult(w, req, map[string]any{"items": items}, err, http.StatusOK) {
				return
			}
		case http.MethodPost:
			var body agentProfileBody
			if !decodeAgentRoomJSON(w, req, &body) {
				return
			}
			item, err := r.core.CreateAgentProfile(req.Context(), body.input())
			r.writeResult(w, req, item, err, http.StatusCreated)
		default:
			r.methodOrNotFound(w, req, true)
		}
		return
	}
	if len(parts) != 1 || strings.TrimSpace(parts[0]) == "" {
		r.methodOrNotFound(w, req, false)
		return
	}
	agentID := parts[0]
	switch req.Method {
	case http.MethodPatch:
		current, err := r.store.GetAgentProfile(req.Context(), agentID)
		if err != nil || current == nil {
			if current == nil && err == nil {
				err = &agentroom.Error{Code: "agent_not_found", Message: "agent profile not found"}
			}
			r.writeResult(w, req, nil, err, http.StatusOK)
			return
		}
		var body agentProfilePatchBody
		if !decodeAgentRoomJSON(w, req, &body) {
			return
		}
		input := mergeAgentProfile(*current, body)
		item, err := r.core.UpdateAgentProfile(req.Context(), agentID, body.Revision, input)
		r.writeResult(w, req, item, err, http.StatusOK)
	case http.MethodDelete:
		err := r.core.DeleteAgentProfile(req.Context(), agentID)
		r.writeResult(w, req, map[string]string{"status": "deleted"}, err, http.StatusOK)
	default:
		r.methodOrNotFound(w, req, true)
	}
}

func (r *AgentRoomRoutes) serveRooms(w http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) == 0 {
		switch req.Method {
		case http.MethodGet:
			archived, ok := optionalBoolQuery(w, req, "archived")
			if !ok {
				return
			}
			limit, ok := boundedIntQuery(w, req, "limit", 50, 1, 100)
			if !ok {
				return
			}
			cursorTime, cursorID, err := decodeRoomCursor(req.URL.Query().Get("cursor"))
			if err != nil {
				writeAdminError(w, req, http.StatusBadRequest, "invalid_cursor", "room cursor is invalid", nil)
				return
			}
			items, err := r.store.ListAgentRoomsPage(req.Context(), archived, limit+1, cursorTime, cursorID)
			if err != nil {
				r.writeResult(w, req, nil, err, http.StatusOK)
				return
			}
			nextCursor := ""
			if len(items) > limit {
				items = items[:limit]
				last := items[len(items)-1]
				nextCursor = encodeRoomCursor(last.UpdatedAt, last.RoomID)
			}
			writeAdminData(w, req, http.StatusOK, map[string]any{"items": items, "cursor": nextCursor})
		case http.MethodPost:
			var body roomBody
			if !decodeAgentRoomJSON(w, req, &body) {
				return
			}
			item, err := r.core.CreateRoom(req.Context(), body.input())
			r.writeResult(w, req, item, err, http.StatusCreated)
		default:
			r.methodOrNotFound(w, req, true)
		}
		return
	}
	roomID := parts[0]
	if len(parts) == 1 {
		switch req.Method {
		case http.MethodGet:
			room, err := r.store.GetAgentRoom(req.Context(), roomID)
			if err == nil && room == nil {
				err = &agentroom.Error{Code: "room_not_found", Message: "agent room not found"}
			}
			if err != nil {
				r.writeResult(w, req, nil, err, http.StatusOK)
				return
			}
			members, err := r.store.ListAgentRoomMembers(req.Context(), roomID)
			r.writeResult(w, req, map[string]any{"room": room, "members": members}, err, http.StatusOK)
		case http.MethodPatch:
			current, err := r.store.GetAgentRoom(req.Context(), roomID)
			if err != nil || current == nil {
				if err == nil {
					err = &agentroom.Error{Code: "room_not_found", Message: "agent room not found"}
				}
				r.writeResult(w, req, nil, err, http.StatusOK)
				return
			}
			var body roomPatchBody
			if !decodeAgentRoomJSON(w, req, &body) {
				return
			}
			item, err := r.core.UpdateRoom(req.Context(), roomID, mergeRoom(*current, body))
			r.writeResult(w, req, item, err, http.StatusOK)
		case http.MethodDelete:
			var body struct {
				Confirm bool `json:"confirm"`
			}
			if !decodeAgentRoomJSON(w, req, &body) {
				return
			}
			if !body.Confirm {
				writeAdminError(w, req, http.StatusBadRequest, "confirmation_required", "room deletion requires confirm=true", nil)
				return
			}
			err := r.core.DeleteRoom(req.Context(), roomID)
			r.writeResult(w, req, map[string]string{"status": "deleted"}, err, http.StatusOK)
		default:
			r.methodOrNotFound(w, req, true)
		}
		return
	}
	switch parts[1] {
	case "members":
		r.serveMembers(w, req, roomID, parts[2:])
	case "timeline":
		if len(parts) != 2 || req.Method != http.MethodGet {
			r.methodOrNotFound(w, req, len(parts) == 2)
			return
		}
		after, ok := boundedInt64Query(w, req, "afterSeq", 0, 0)
		if !ok {
			return
		}
		before, ok := boundedInt64Query(w, req, "beforeSeq", 0, 0)
		if !ok {
			return
		}
		limit, ok := boundedIntQuery(w, req, "limit", 100, 1, 500)
		if !ok {
			return
		}
		item, err := r.store.GetAgentRoomTimelinePage(req.Context(), roomID, after, before, limit)
		r.writeResult(w, req, item, err, http.StatusOK)
	case "messages":
		if len(parts) != 2 || req.Method != http.MethodPost {
			r.methodOrNotFound(w, req, len(parts) == 2)
			return
		}
		var body messageBody
		if !decodeAgentRoomJSON(w, req, &body) {
			return
		}
		var result agentroom.MessageRunsResult
		var err error
		if r.dispatcher != nil {
			result, err = r.dispatcher.Dispatch(req.Context(), roomID, body.input())
		} else {
			result, err = r.core.CreateMessageWithRuns(req.Context(), roomID, body.input())
		}
		r.writeResult(w, req, result, err, http.StatusCreated)
	case "workflows":
		if len(parts) != 4 || parts[3] != "resolve" || req.Method != http.MethodPost {
			r.methodOrNotFound(w, req, len(parts) == 4 && parts[3] == "resolve")
			return
		}
		resolver, ok := r.dispatcher.(interface {
			ResolveWorkflow(context.Context, string, string, string) (agentroom.MessageRunsResult, error)
		})
		if !ok {
			writeAdminError(w, req, http.StatusServiceUnavailable, "workflow_unavailable", "workflow engine is unavailable", nil)
			return
		}
		var body struct {
			Decision string `json:"decision"`
		}
		if !decodeAgentRoomJSON(w, req, &body) {
			return
		}
		result, err := resolver.ResolveWorkflow(req.Context(), roomID, parts[2], body.Decision)
		r.writeResult(w, req, result, err, http.StatusOK)
	default:
		r.methodOrNotFound(w, req, false)
	}
}

func (r *AgentRoomRoutes) serveMembers(w http.ResponseWriter, req *http.Request, roomID string, parts []string) {
	if len(parts) == 0 {
		if req.Method == http.MethodGet {
			items, err := r.store.ListAgentRoomMembers(req.Context(), roomID)
			r.writeResult(w, req, map[string]any{"items": items}, err, http.StatusOK)
			return
		}
		if req.Method != http.MethodPost {
			r.methodOrNotFound(w, req, true)
			return
		}
		var body memberBody
		if !decodeAgentRoomJSON(w, req, &body) {
			return
		}
		var item domain.AgentRoomMember
		var err error
		switch strings.TrimSpace(body.MemberKind) {
		case "agent":
			item, err = r.core.AddAgentMember(req.Context(), roomID, body.AgentID)
		case "pinned_session":
			item, err = r.core.AddPinnedSessionMember(req.Context(), roomID, agentroom.PinnedMemberInput{DisplayName: body.DisplayName, PinnedSessionID: body.PinnedSessionID, WorkspaceRoot: body.WorkspaceRoot, AutoApprove: body.AutoApprove, RuntimeControls: body.RuntimeControls})
		case "followed_pane":
			item, err = r.core.AddFollowedPaneMember(req.Context(), roomID, body.FollowedPaneID, body.DisplayName)
		default:
			err = &agentroom.Error{Code: "invalid_member_kind", Message: "unsupported member kind"}
		}
		r.writeResult(w, req, item, err, http.StatusCreated)
		return
	}
	if len(parts) != 1 {
		r.methodOrNotFound(w, req, false)
		return
	}
	switch req.Method {
	case http.MethodPatch:
		var body memberPatchBody
		if !decodeAgentRoomJSON(w, req, &body) {
			return
		}
		item, err := r.core.UpdateMember(req.Context(), roomID, parts[0], agentroom.MemberUpdateInput{
			DisplayName: body.DisplayName, AutoApprove: body.AutoApprove, RuntimeControls: body.RuntimeControls,
			Binding: body.bindingInput(),
		})
		r.writeResult(w, req, item, err, http.StatusOK)
	case http.MethodDelete:
		err := r.core.DeleteMember(req.Context(), roomID, parts[0])
		r.writeResult(w, req, map[string]string{"status": "deleted"}, err, http.StatusOK)
	default:
		r.methodOrNotFound(w, req, true)
	}
}

func (r *AgentRoomRoutes) serveRuns(w http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) < 1 || len(parts) > 2 {
		r.methodOrNotFound(w, req, false)
		return
	}
	runID := parts[0]
	if len(parts) == 1 {
		if req.Method != http.MethodGet {
			r.methodOrNotFound(w, req, true)
			return
		}
		item, err := r.store.GetAgentRun(req.Context(), runID)
		if err == nil && item == nil {
			err = &agentroom.Error{Code: "run_not_found", Message: "agent run not found"}
		}
		r.writeResult(w, req, item, err, http.StatusOK)
		return
	}
	if req.Method != http.MethodPost {
		r.methodOrNotFound(w, req, true)
		return
	}
	switch parts[1] {
	case "abort":
		var body struct {
			Reason string `json:"reason,omitempty"`
		}
		if !decodeOptionalAdminJSON(w, req, &body, maxAdminBodyBytes) {
			return
		}
		item, err := r.core.MarkAbortRequested(req.Context(), runID)
		if err == nil && item.Status == "abort_requested" {
			writeAdminError(w, req, http.StatusConflict, "abort_unconfirmed", "Runtime abort has not been confirmed; no replacement Run was submitted", map[string]any{"runId": item.RunID, "status": item.Status})
			return
		}
		r.writeResult(w, req, item, err, http.StatusOK)
	case "retry":
		var body struct {
			SessionMode string `json:"sessionMode,omitempty"`
		}
		if !decodeOptionalAdminJSON(w, req, &body, maxAdminBodyBytes) {
			return
		}
		if body.SessionMode != "" && body.SessionMode != "same_session" {
			writeAdminError(w, req, http.StatusBadRequest, "session_mode_unsupported", "only same_session retry is available before Forward Dispatch", nil)
			return
		}
		item, err := r.core.RetryRun(req.Context(), runID)
		r.writeResult(w, req, item, err, http.StatusCreated)
	default:
		r.methodOrNotFound(w, req, false)
	}
}

func (r *AgentRoomRoutes) servePaneSessions(w http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) != 1 || parts[0] != "sync" || req.Method != http.MethodPost {
		r.methodOrNotFound(w, req, len(parts) == 1 && parts[0] == "sync")
		return
	}
	var body struct {
		Generation int64                           `json:"generation"`
		Panes      []domain.PaneSessionObservation `json:"panes"`
	}
	if !decodeAgentRoomJSON(w, req, &body) {
		return
	}
	ids, err := r.store.SyncPaneSessionObservations(req.Context(), body.Generation, body.Panes)
	if errors.Is(err, store.ErrPaneGenerationStale) || errors.Is(err, store.ErrPaneGenerationConflict) {
		accepted, generationErr := r.store.GetPaneObservationGeneration(req.Context())
		if generationErr != nil {
			r.writeResult(w, req, nil, generationErr, http.StatusOK)
			return
		}
		code, status, message := mapAgentRoomError(err)
		writeAdminError(w, req, status, code, message, map[string]any{"acceptedGeneration": accepted})
		return
	}
	r.writeResult(w, req, map[string]any{"acceptedGeneration": body.Generation, "observedSessionIds": ids}, err, http.StatusOK)
}

func (r *AgentRoomRoutes) serveObservations(w http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) == 0 {
		if req.Method != http.MethodGet {
			r.methodOrNotFound(w, req, true)
			return
		}
		items, err := r.store.ListSessionObservations(req.Context())
		if err != nil {
			r.writeResult(w, req, nil, err, http.StatusOK)
			return
		}
		pins, err := r.store.ListPinnedSessionObservations(req.Context())
		r.writeResult(w, req, map[string]any{"items": items, "pinnedSessionIds": pins, "observerRunning": r.observerRunning(req.Context())}, err, http.StatusOK)
		return
	}
	if len(parts) == 2 && parts[1] == "pin" && (req.Method == http.MethodPost || req.Method == http.MethodDelete) {
		if req.Method == http.MethodPost {
			_, err := r.store.PinSessionObservation(req.Context(), parts[0])
			r.writeResult(w, req, map[string]any{"sessionId": parts[0], "pinned": true, "observerRunning": r.observerRunning(req.Context())}, err, http.StatusOK)
			return
		}
		_, err := r.store.UnpinSessionObservation(req.Context(), parts[0])
		r.writeResult(w, req, map[string]any{"sessionId": parts[0], "pinned": false, "observerRunning": r.observerRunning(req.Context())}, err, http.StatusOK)
		return
	}
	r.methodOrNotFound(w, req, false)
}

func (r *AgentRoomRoutes) observerRunning(ctx context.Context) bool {
	return r.capabilities != nil && r.capabilities(ctx).Observer
}

func (r *AgentRoomRoutes) serveEvents(w http.ResponseWriter, req *http.Request, parts []string) {
	if len(parts) != 0 || req.Method != http.MethodGet {
		r.methodOrNotFound(w, req, len(parts) == 0)
		return
	}
	after, ok := boundedInt64Query(w, req, "afterSeq", 0, 0)
	if !ok {
		return
	}
	limit, ok := boundedIntQuery(w, req, "limit", 100, 1, 500)
	if !ok {
		return
	}
	waitMS, ok := boundedIntQuery(w, req, "waitMs", 0, 0, 30000)
	if !ok {
		return
	}
	query := store.AgentRoomEventQuery{AfterSeq: after, RoomID: strings.TrimSpace(req.URL.Query().Get("roomId")), Limit: limit + 1}
	items, err := r.store.WaitAgentRoomEvents(req.Context(), query, time.Duration(waitMS)*time.Millisecond)
	if err != nil {
		r.writeResult(w, req, nil, err, http.StatusOK)
		return
	}
	hasMore := len(items) > limit
	if hasMore {
		items = items[:limit]
	}
	next := after
	if len(items) > 0 {
		next = items[len(items)-1].Seq
	}
	writeAdminData(w, req, http.StatusOK, map[string]any{"items": items, "nextSeq": next, "hasMore": hasMore, "serverTime": time.Now().UTC().Format(time.RFC3339)})
}

func (r *AgentRoomRoutes) writeResult(w http.ResponseWriter, req *http.Request, data any, err error, status int) bool {
	if err == nil {
		writeAdminData(w, req, status, data)
		return true
	}
	code, httpStatus, message := mapAgentRoomError(err)
	writeAdminError(w, req, httpStatus, code, message, nil)
	return false
}

func (r *AgentRoomRoutes) methodOrNotFound(w http.ResponseWriter, req *http.Request, pathExists bool) {
	if pathExists {
		writeAdminError(w, req, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed", nil)
		return
	}
	writeAdminError(w, req, http.StatusNotFound, "not_found", "agent room endpoint not found", nil)
}

func mapAgentRoomError(err error) (string, int, string) {
	if code := agentroom.ErrorCode(err); code != "" {
		switch {
		case strings.HasSuffix(code, "_not_found"):
			return code, http.StatusNotFound, err.Error()
		case code == "revision_conflict", code == "session_busy", code == "lease_conflict", code == "queue_full", code == "abort_unconfirmed":
			return code, http.StatusConflict, err.Error()
		case code == "server_provider_required", code == "observer_not_running":
			return code, http.StatusServiceUnavailable, err.Error()
		default:
			return code, http.StatusBadRequest, err.Error()
		}
	}
	switch {
	case errors.Is(err, store.ErrAgentRoomCursorTooOld):
		return "cursor_too_old", http.StatusGone, "event cursor is no longer available"
	case errors.Is(err, store.ErrAgentRoomCursorInvalid):
		return "invalid_cursor", http.StatusBadRequest, "event cursor is invalid"
	case errors.Is(err, store.ErrAgentRoomPageTooLarge):
		return "page_too_large", http.StatusBadRequest, "event page limit exceeded"
	case errors.Is(err, store.ErrSessionQueueFull):
		return "queue_full", http.StatusConflict, "session queue is full"
	case errors.Is(err, store.ErrPaneGenerationStale):
		return "stale_generation", http.StatusConflict, "pane snapshot generation is stale"
	case errors.Is(err, store.ErrPaneGenerationConflict):
		return "generation_conflict", http.StatusConflict, "pane snapshot conflicts with the accepted generation"
	case errors.Is(err, store.ErrPaneObservationInvalid):
		return "invalid_pane_session", http.StatusBadRequest, "pane session snapshot is invalid"
	case errors.Is(err, store.ErrAgentRoomNotFound):
		return "not_found", http.StatusNotFound, "agent room record not found"
	case errors.Is(err, store.ErrAgentRoomConflict), errors.Is(err, store.ErrAgentRoomRevisionConflict):
		return "conflict", http.StatusConflict, "agent room record conflict"
	default:
		return "internal_error", http.StatusInternalServerError, "agent room request failed"
	}
}

func splitAgentRoomPath(path string) []string {
	trimmed := strings.Trim(strings.TrimPrefix(path, "/api/v1/agent-room/"), "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

func decodeOptionalAdminJSON(w http.ResponseWriter, req *http.Request, target any, maxBytes int64) bool {
	if req.Body == nil || req.ContentLength == 0 {
		return true
	}
	return decodeAgentRoomJSON(w, req, target)
}

func decodeAgentRoomJSON(w http.ResponseWriter, req *http.Request, target any) bool {
	req.Body = http.MaxBytesReader(w, req.Body, maxAdminBodyBytes)
	decoder := json.NewDecoder(req.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(target)
	if err == nil {
		err = decoder.Decode(&struct{}{})
		if errors.Is(err, io.EOF) {
			return true
		}
	}
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeAdminError(w, req, http.StatusRequestEntityTooLarge, "body_too_large", "request body too large", nil)
		return false
	}
	writeAdminError(w, req, http.StatusBadRequest, "invalid_json", "invalid JSON request body", nil)
	return false
}

func boundedIntQuery(w http.ResponseWriter, req *http.Request, key string, fallback, min, max int) (int, bool) {
	raw := strings.TrimSpace(req.URL.Query().Get(key))
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < min || value > max {
		writeAdminError(w, req, http.StatusBadRequest, "invalid_"+key, key+" is outside the allowed range", nil)
		return 0, false
	}
	return value, true
}

func boundedInt64Query(w http.ResponseWriter, req *http.Request, key string, fallback, min int64) (int64, bool) {
	raw := strings.TrimSpace(req.URL.Query().Get(key))
	if raw == "" {
		return fallback, true
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value < min {
		writeAdminError(w, req, http.StatusBadRequest, "invalid_"+key, key+" is invalid", nil)
		return 0, false
	}
	return value, true
}

func optionalBoolQuery(w http.ResponseWriter, req *http.Request, key string) (*bool, bool) {
	raw := strings.TrimSpace(req.URL.Query().Get(key))
	if raw == "" {
		return nil, true
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		writeAdminError(w, req, http.StatusBadRequest, "invalid_"+key, key+" must be true or false", nil)
		return nil, false
	}
	return &value, true
}

func encodeRoomCursor(updatedAt, roomID string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(updatedAt + "\x00" + roomID))
}

func decodeRoomCursor(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return "", "", err
	}
	parts := strings.Split(string(decoded), "\x00")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", "", errors.New("invalid room cursor")
	}
	return parts[0], parts[1], nil
}

type agentProfileBody struct {
	Name            string               `json:"name"`
	Avatar          string               `json:"avatar,omitempty"`
	Description     string               `json:"description,omitempty"`
	RolePrompt      string               `json:"rolePrompt"`
	DefaultWorkDir  string               `json:"defaultWorkDir"`
	SessionPolicy   domain.SessionPolicy `json:"sessionPolicy"`
	PinnedSessionID string               `json:"pinnedSessionId,omitempty"`
	AutoApprove     bool                 `json:"autoApprove"`
	RuntimeControls json.RawMessage      `json:"runtimeControls,omitempty"`
	Enabled         bool                 `json:"enabled"`
}

func (b agentProfileBody) input() agentroom.AgentProfileInput {
	return agentroom.AgentProfileInput{Name: b.Name, Avatar: b.Avatar, Description: b.Description, RolePrompt: b.RolePrompt, DefaultWorkDir: b.DefaultWorkDir, SessionPolicy: b.SessionPolicy, PinnedSessionID: b.PinnedSessionID, AutoApprove: b.AutoApprove, RuntimeControls: b.RuntimeControls, Enabled: b.Enabled}
}

type agentProfilePatchBody struct {
	Revision        int64                 `json:"revision"`
	Name            *string               `json:"name,omitempty"`
	Avatar          *string               `json:"avatar,omitempty"`
	Description     *string               `json:"description,omitempty"`
	RolePrompt      *string               `json:"rolePrompt,omitempty"`
	DefaultWorkDir  *string               `json:"defaultWorkDir,omitempty"`
	SessionPolicy   *domain.SessionPolicy `json:"sessionPolicy,omitempty"`
	PinnedSessionID *string               `json:"pinnedSessionId,omitempty"`
	AutoApprove     *bool                 `json:"autoApprove,omitempty"`
	RuntimeControls *json.RawMessage      `json:"runtimeControls,omitempty"`
	Enabled         *bool                 `json:"enabled,omitempty"`
}

func mergeAgentProfile(current domain.AgentProfile, p agentProfilePatchBody) agentroom.AgentProfileInput {
	b := agentProfileBody{Name: current.Name, Avatar: current.Avatar, Description: current.Description, RolePrompt: current.RolePrompt, DefaultWorkDir: current.DefaultWorkDir, SessionPolicy: current.SessionPolicy, PinnedSessionID: current.PinnedSessionID, AutoApprove: current.AutoApprove, RuntimeControls: current.RuntimeControls, Enabled: current.Enabled}
	if p.Name != nil {
		b.Name = *p.Name
	}
	if p.Avatar != nil {
		b.Avatar = *p.Avatar
	}
	if p.Description != nil {
		b.Description = *p.Description
	}
	if p.RolePrompt != nil {
		b.RolePrompt = *p.RolePrompt
	}
	if p.DefaultWorkDir != nil {
		b.DefaultWorkDir = *p.DefaultWorkDir
	}
	if p.SessionPolicy != nil {
		b.SessionPolicy = *p.SessionPolicy
	}
	if p.PinnedSessionID != nil {
		b.PinnedSessionID = *p.PinnedSessionID
	}
	if p.AutoApprove != nil {
		b.AutoApprove = *p.AutoApprove
	}
	if p.RuntimeControls != nil {
		b.RuntimeControls = *p.RuntimeControls
	}
	if p.Enabled != nil {
		b.Enabled = *p.Enabled
	}
	return b.input()
}

type roomBody struct {
	Title             string `json:"title"`
	Description       string `json:"description,omitempty"`
	SharedBrief       string `json:"sharedBrief,omitempty"`
	OrchestrationMode string `json:"orchestrationMode"`
	Archived          bool   `json:"archived"`
}

func (b roomBody) input() agentroom.RoomInput {
	return agentroom.RoomInput{Title: b.Title, Description: b.Description, SharedBrief: b.SharedBrief, OrchestrationMode: b.OrchestrationMode, Archived: b.Archived}
}

type roomPatchBody struct {
	Title             *string `json:"title,omitempty"`
	Description       *string `json:"description,omitempty"`
	SharedBrief       *string `json:"sharedBrief,omitempty"`
	OrchestrationMode *string `json:"orchestrationMode,omitempty"`
	Archived          *bool   `json:"archived,omitempty"`
}

func mergeRoom(current domain.AgentRoom, p roomPatchBody) agentroom.RoomInput {
	b := roomBody{Title: current.Title, Description: current.Description, SharedBrief: current.SharedBrief, OrchestrationMode: current.OrchestrationMode, Archived: current.Archived}
	if p.Title != nil {
		b.Title = *p.Title
	}
	if p.Description != nil {
		b.Description = *p.Description
	}
	if p.SharedBrief != nil {
		b.SharedBrief = *p.SharedBrief
	}
	if p.OrchestrationMode != nil {
		b.OrchestrationMode = *p.OrchestrationMode
	}
	if p.Archived != nil {
		b.Archived = *p.Archived
	}
	return b.input()
}

type memberBody struct {
	MemberKind      string          `json:"memberKind"`
	AgentID         string          `json:"agentId,omitempty"`
	DisplayName     string          `json:"displayName,omitempty"`
	PinnedSessionID string          `json:"pinnedSessionId,omitempty"`
	WorkspaceRoot   string          `json:"workspaceRoot,omitempty"`
	FollowedPaneID  string          `json:"followedPaneId,omitempty"`
	AutoApprove     bool            `json:"autoApprove,omitempty"`
	RuntimeControls json.RawMessage `json:"runtimeControls,omitempty"`
}
type memberPatchBody struct {
	DisplayName     *string            `json:"displayName,omitempty"`
	AutoApprove     *bool              `json:"autoApprove,omitempty"`
	RuntimeControls *json.RawMessage   `json:"runtimeControls,omitempty"`
	Binding         *memberBindingBody `json:"binding,omitempty"`
}

type memberBindingBody struct {
	FollowMode      string `json:"followMode"`
	FollowedPaneID  string `json:"followedPaneId,omitempty"`
	PinnedSessionID string `json:"pinnedSessionId,omitempty"`
	WorkspaceRoot   string `json:"workspaceRoot,omitempty"`
}

func (b memberPatchBody) bindingInput() *agentroom.MemberBindingInput {
	if b.Binding == nil {
		return nil
	}
	return &agentroom.MemberBindingInput{
		FollowMode: b.Binding.FollowMode, FollowedPaneID: b.Binding.FollowedPaneID,
		PinnedSessionID: b.Binding.PinnedSessionID, WorkspaceRoot: b.Binding.WorkspaceRoot,
	}
}

type messageBody struct {
	Content            string                     `json:"content"`
	TargetMemberIDs    []string                   `json:"targetMemberIds,omitempty"`
	Mode               string                     `json:"mode,omitempty"`
	QueuePolicy        string                     `json:"queuePolicy,omitempty"`
	ReplyToMessageID   string                     `json:"replyToMessageId,omitempty"`
	Attachments        json.RawMessage            `json:"attachments,omitempty"`
	Metadata           json.RawMessage            `json:"metadata,omitempty"`
	SharedRunIDs       []string                   `json:"sharedRunIds,omitempty"`
	WorkflowDefinition *domain.WorkflowDefinition `json:"workflowDefinition,omitempty"`
}

func (b messageBody) input() agentroom.MessageInput {
	return agentroom.MessageInput{Content: b.Content, TargetMemberIDs: b.TargetMemberIDs, Mode: b.Mode, QueuePolicy: b.QueuePolicy, ReplyToMessageID: b.ReplyToMessageID, Attachments: b.Attachments, Metadata: b.Metadata, SharedRunIDs: b.SharedRunIDs, WorkflowDefinition: b.WorkflowDefinition}
}
