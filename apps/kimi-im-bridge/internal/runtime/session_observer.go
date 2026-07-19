package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type ObserverSubscription struct {
	Generation int64
	SessionIDs []string
}

type ObserverCursor struct {
	Seq   int64
	Epoch string
}

type ObservedRuntimeEvent struct {
	EventID    string
	Seq        int64
	Generation int64
	Epoch      string
	SessionID  string
	PromptID   string
	TurnID     string
	RunID      string
	Type       string
	Status     string
	ErrorCode  string
	Error      string
	TextDelta  string
	ApprovalID string
	Approval   *RuntimeApproval
	Decision   string
	Timestamp  string
	Payload    json.RawMessage
	Known      bool
	Thinking   bool
}

type ObserverBatch struct {
	Generation     int64
	Epoch          string
	Events         []ObservedRuntimeEvent
	Cursors        map[string]ObserverCursor
	ResyncRequired bool
}

type SessionObserverOptions struct {
	Adapter        *KimiCodeServerAdapter
	LoadCursor     func(context.Context, string) (ObserverCursor, bool, error)
	Sink           func(context.Context, ObserverBatch) error
	HelloTimeout   time.Duration
	ReadTimeout    time.Duration
	RetryMinDelay  time.Duration
	RetryMaxDelay  time.Duration
	OnConnected    func(sessionCount int, generation int64)
	OnDisconnected func()
}

type SessionObserver struct {
	options SessionObserverOptions
}

func NewSessionObserver(options SessionObserverOptions) (*SessionObserver, error) {
	if options.Adapter == nil || options.Sink == nil {
		return nil, errors.New("session observer adapter and sink are required")
	}
	if options.HelloTimeout <= 0 {
		options.HelloTimeout = wsHelloTimeout
	}
	if options.ReadTimeout <= 0 {
		options.ReadTimeout = wsReadIdleTimeout
	}
	if options.RetryMinDelay <= 0 {
		options.RetryMinDelay = 100 * time.Millisecond
	}
	if options.RetryMaxDelay <= 0 {
		options.RetryMaxDelay = 5 * time.Second
	}
	return &SessionObserver{options: options}, nil
}

// Run owns at most one WebSocket. Sending a new subscription cancels the old
// generation/set before connecting the replacement; an empty set stays idle.
func (o *SessionObserver) Run(ctx context.Context, updates <-chan ObserverSubscription) error {
	var current ObserverSubscription
	for {
		if len(current.SessionIDs) == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case update, ok := <-updates:
				if !ok {
					return nil
				}
				current = normalizeObserverSubscription(update)
				continue
			}
		}
		delay := o.options.RetryMinDelay
		for len(current.SessionIDs) > 0 {
			connectionCtx, cancel := context.WithCancel(ctx)
			result := make(chan error, 1)
			go func(subscription ObserverSubscription) {
				result <- o.observeOnce(connectionCtx, subscription)
			}(current)
			select {
			case <-ctx.Done():
				cancel()
				<-result
				return ctx.Err()
			case update, ok := <-updates:
				cancel()
				<-result
				if !ok {
					return nil
				}
				current = normalizeObserverSubscription(update)
				delay = o.options.RetryMinDelay
			case <-result:
				cancel()
				timer := time.NewTimer(delay)
				select {
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				case update, ok := <-updates:
					timer.Stop()
					if !ok {
						return nil
					}
					current = normalizeObserverSubscription(update)
					delay = o.options.RetryMinDelay
				case <-timer.C:
					delay *= 2
					if delay > o.options.RetryMaxDelay {
						delay = o.options.RetryMaxDelay
					}
				}
			}
		}
	}
}

func (o *SessionObserver) observeOnce(ctx context.Context, subscription ObserverSubscription) error {
	locator, err := o.options.Adapter.loadLocator()
	if err != nil {
		return err
	}
	if subscription.Generation != 0 && locator.Generation != subscription.Generation {
		return fmt.Errorf("runtime generation changed")
	}
	token, err := readServerToken(locator.TokenPath)
	if err != nil {
		return err
	}
	wsURL, err := websocketURL(locator.Origin)
	if err != nil {
		return err
	}
	dialer := *websocket.DefaultDialer
	if o.options.Adapter.wsDialer != nil {
		dialer = *o.options.Adapter.wsDialer
	}
	dialer.Subprotocols = append([]string{wsBearerProtocolPrefix + token}, dialer.Subprotocols...)
	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("connect observer websocket: %w", err)
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

	cursors := make(map[string]ObserverCursor, len(subscription.SessionIDs))
	for _, sessionID := range subscription.SessionIDs {
		if o.options.LoadCursor != nil {
			cursor, ok, err := o.options.LoadCursor(ctx, sessionID)
			if err != nil {
				return err
			}
			if ok {
				cursors[sessionID] = cursor
			}
		}
	}
	epoch, err := o.observerHello(conn, subscription, cursors)
	if err != nil {
		return err
	}
	if o.options.OnConnected != nil {
		o.options.OnConnected(len(subscription.SessionIDs), locator.Generation)
	}
	if o.options.OnDisconnected != nil {
		defer o.options.OnDisconnected()
	}
	for sessionID, cursor := range cursors {
		if cursor.Epoch == "" {
			cursor.Epoch = epoch
			cursors[sessionID] = cursor
		}
	}
	buffers := map[string]map[int64]wsFrame{}
	subscribed := make(map[string]struct{}, len(subscription.SessionIDs))
	for _, sessionID := range subscription.SessionIDs {
		subscribed[sessionID] = struct{}{}
	}
	for {
		if err := conn.SetReadDeadline(time.Now().Add(o.options.ReadTimeout)); err != nil {
			return err
		}
		var frame wsFrame
		if err := conn.ReadJSON(&frame); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return fmt.Errorf("read observer websocket: %w", err)
		}
		switch frame.Type {
		case "ping":
			if err := writePong(conn, frame); err != nil {
				return err
			}
			continue
		case "server_hello", "ack", "pong":
			continue
		case "resync_required":
			newEpoch := firstNonEmptyString(payloadString(frame.Payload, "epoch"), epoch)
			return o.options.Sink(ctx, ObserverBatch{Generation: locator.Generation, Epoch: newEpoch, ResyncRequired: true, Cursors: cursors})
		case "error":
			return errors.New("runtime observer websocket error")
		}
		sessionID := firstNonEmptyString(frame.SessionID, payloadString(frame.Payload, "session_id"), payloadString(frame.Payload, "sessionId"))
		if _, ok := subscribed[sessionID]; !ok || frame.Seq <= 0 {
			continue
		}
		cursor := cursors[sessionID]
		seq := int64(frame.Seq)
		if seq <= cursor.Seq {
			continue
		}
		if buffers[sessionID] == nil {
			buffers[sessionID] = map[int64]wsFrame{}
		}
		if _, duplicate := buffers[sessionID][seq]; duplicate {
			continue
		}
		buffers[sessionID][seq] = frame
		batch := ObserverBatch{Generation: locator.Generation, Epoch: epoch, Cursors: map[string]ObserverCursor{}}
		for {
			next, ok := buffers[sessionID][cursor.Seq+1]
			if !ok {
				break
			}
			delete(buffers[sessionID], cursor.Seq+1)
			cursor.Seq++
			cursor.Epoch = epoch
			batch.Events = append(batch.Events, decodeObservedRuntimeEvent(next, locator.Generation, epoch))
		}
		if len(batch.Events) == 0 {
			continue
		}
		batch.Cursors[sessionID] = cursor
		if err := o.options.Sink(ctx, batch); err != nil {
			return err
		}
		cursors[sessionID] = cursor
	}
}

func (o *SessionObserver) observerHello(conn *websocket.Conn, subscription ObserverSubscription, cursors map[string]ObserverCursor) (string, error) {
	for {
		if err := conn.SetReadDeadline(time.Now().Add(o.options.HelloTimeout)); err != nil {
			return "", err
		}
		var frame wsFrame
		if err := conn.ReadJSON(&frame); err != nil {
			return "", fmt.Errorf("read observer hello: %w", err)
		}
		switch frame.Type {
		case "ping":
			if err := writePong(conn, frame); err != nil {
				return "", err
			}
		case "server_hello":
			epoch := payloadString(frame.Payload, "epoch")
			wireCursors := make(map[string]wsCursor, len(subscription.SessionIDs))
			for _, sessionID := range subscription.SessionIDs {
				cursor := cursors[sessionID]
				wireCursors[sessionID] = wsCursor{Seq: int(cursor.Seq), Epoch: cursor.Epoch}
			}
			err := conn.WriteJSON(map[string]any{"type": "client_hello", "id": fmt.Sprintf("agent-room-observer-%d", subscription.Generation), "payload": map[string]any{"subscriptions": subscription.SessionIDs, "cursors": wireCursors}})
			return epoch, err
		case "error":
			return "", errors.New("runtime observer hello failed")
		}
	}
}

func normalizeObserverSubscription(value ObserverSubscription) ObserverSubscription {
	seen := map[string]struct{}{}
	original := append([]string(nil), value.SessionIDs...)
	value.SessionIDs = value.SessionIDs[:0]
	for _, sessionID := range original {
		sessionID = strings.TrimSpace(sessionID)
		if sessionID == "" {
			continue
		}
		if _, ok := seen[sessionID]; ok {
			continue
		}
		seen[sessionID] = struct{}{}
		value.SessionIDs = append(value.SessionIDs, sessionID)
	}
	sort.Strings(value.SessionIDs)
	return value
}

func decodeObservedRuntimeEvent(frame wsFrame, generation int64, epoch string) ObservedRuntimeEvent {
	eventType := strings.TrimPrefix(strings.TrimSpace(frame.Type), "event.")
	sessionID := firstNonEmptyString(frame.SessionID, payloadString(frame.Payload, "session_id"), payloadString(frame.Payload, "sessionId"))
	promptID := firstNonEmptyString(payloadScalarString(frame.Payload, "prompt_id"), payloadScalarString(frame.Payload, "promptId"))
	turnID := firstNonEmptyString(payloadScalarString(frame.Payload, "turn_id"), payloadScalarString(frame.Payload, "turnId"))
	runID := firstNonEmptyString(
		payloadNestedString(frame.Payload, "agent_room", "run_id"),
		payloadNestedString(frame.Payload, "agentRoom", "runId"),
		payloadDoubleNestedString(frame.Payload, "metadata", "agent_room", "run_id"),
		payloadDoubleNestedString(frame.Payload, "metadata", "agentRoom", "runId"),
	)
	status := firstNonEmptyString(payloadString(frame.Payload, "status"), payloadString(frame.Payload, "reason"))
	errorCode, errorMessage := promptFailureFromPayload(frame.Payload)
	known := observedEventKnown(eventType)
	eventID := strings.TrimSpace(frame.ID)
	if eventID == "" {
		eventID = fmt.Sprintf("runtime:%d:%s:%s:%d:%s", generation, epoch, sessionID, frame.Seq, eventType)
	}
	item := ObservedRuntimeEvent{
		EventID: eventID, Seq: int64(frame.Seq), Generation: generation, Epoch: epoch,
		SessionID: sessionID, PromptID: promptID, TurnID: turnID, RunID: runID, Type: eventType,
		Status: status, ErrorCode: errorCode, Error: errorMessage, TextDelta: payloadString(frame.Payload, "delta"),
		ApprovalID: firstNonEmptyString(payloadString(frame.Payload, "approval_id"), payloadString(frame.Payload, "approvalId")),
		Decision:   firstNonEmptyString(payloadString(frame.Payload, "decision"), payloadString(frame.Payload, "status")),
		Timestamp:  frame.Timestamp, Payload: append(json.RawMessage(nil), frame.Payload...), Known: known,
		Thinking: eventType == "thinking.delta",
	}
	if eventType == "approval.requested" || eventType == "approval.resolved" {
		approval := runtimeApprovalFromPayload(frame.Payload, sessionID)
		item.Approval, item.ApprovalID = &approval, firstNonEmptyString(item.ApprovalID, approval.ApprovalID)
	}
	return item
}

func payloadScalarString(payload json.RawMessage, key string) string {
	var object map[string]json.RawMessage
	if json.Unmarshal(payload, &object) != nil {
		return ""
	}
	var value string
	if json.Unmarshal(object[key], &value) == nil {
		return strings.TrimSpace(value)
	}
	var number json.Number
	if json.Unmarshal(object[key], &number) == nil {
		if _, err := strconv.ParseFloat(number.String(), 64); err == nil {
			return number.String()
		}
	}
	return ""
}

func observedEventKnown(eventType string) bool {
	switch eventType {
	case "prompt.submitted", "turn.started", "turn.step.started", "turn.step.interrupted", "assistant.delta", "thinking.delta", "error",
		"agent.status.updated", "approval.requested", "approval.resolved", "turn.ended", "prompt.completed":
		return true
	default:
		return false
	}
}

func payloadNestedString(payload json.RawMessage, objectKey, valueKey string) string {
	var object map[string]json.RawMessage
	if json.Unmarshal(payload, &object) != nil {
		return ""
	}
	var nested map[string]any
	if json.Unmarshal(object[objectKey], &nested) != nil {
		return ""
	}
	value, _ := nested[valueKey].(string)
	return strings.TrimSpace(value)
}

func payloadDoubleNestedString(payload json.RawMessage, outerKey, objectKey, valueKey string) string {
	var outer map[string]json.RawMessage
	if json.Unmarshal(payload, &outer) != nil {
		return ""
	}
	return payloadNestedString(outer[outerKey], objectKey, valueKey)
}
