package runtime

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type RuntimeCapability struct {
	Supported   bool   `json:"supported"`
	Evidence    string `json:"evidence"`
	Degradation string `json:"degradation,omitempty"`
}

type RuntimeSessionCapability struct {
	SessionID string `json:"sessionId"`
	Status    string `json:"status,omitempty"`
	LastSeq   int    `json:"lastSeq"`
}

type RuntimeCapabilities struct {
	Provider           RuntimeCapability            `json:"serverProvider"`
	MultiSession       map[string]RuntimeCapability `json:"multiSessionSubscriptions"`
	ObserverTransport  map[string]RuntimeCapability `json:"sessionObserverTransport,omitempty"`
	PerSessionCursors  RuntimeCapability            `json:"perSessionCursors"`
	Transcript         RuntimeCapability            `json:"transcript"`
	TranscriptEndpoint string                       `json:"transcriptEndpoint,omitempty"`
	SessionState       RuntimeCapability            `json:"sessionState"`
	Sessions           []RuntimeSessionCapability   `json:"sessions,omitempty"`
	Unknown            map[string]RuntimeCapability `json:"unknown"`
}

type RuntimeCapabilityProbeOptions struct {
	RuntimeLocatorPath string
	SessionIDs         []string
	HTTPClient         *http.Client
	WSDialer           *websocket.Dialer
	Timeout            time.Duration
	ObserverCounts     []int
}

func ProbeRuntimeCapabilities(ctx context.Context, options RuntimeCapabilityProbeOptions) RuntimeCapabilities {
	report := RuntimeCapabilities{
		MultiSession:      map[string]RuntimeCapability{},
		ObserverTransport: map[string]RuntimeCapability{},
		Unknown:           unknownRuntimeCapabilities(),
	}
	for _, count := range []int{2, 6, 12} {
		report.MultiSession[fmt.Sprint(count)] = unsupported("not probed", "use one WebSocket per Session")
	}
	adapter, err := NewKimiCodeServerAdapter(KimiCodeServerAdapterOptions{
		RuntimeLocatorPath: options.RuntimeLocatorPath,
		HTTPClient:         options.HTTPClient,
		WSDialer:           options.WSDialer,
	})
	if err != nil {
		report.Provider = unsupported(err.Error(), "Observer and Forward Dispatch unavailable; Room history remains readable")
		return report
	}
	locator, err := adapter.loadLocator()
	if err != nil {
		report.Provider = unsupported(err.Error(), "Observer and Forward Dispatch unavailable; Room history remains readable")
		return report
	}
	token, err := readServerToken(locator.TokenPath)
	if err != nil {
		report.Provider = unsupported(err.Error(), "Observer and Forward Dispatch unavailable; Room history remains readable")
		return report
	}
	timeout := options.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}

	var page apiSessionPage
	status, err := probeGET(ctx, client, locator.Origin, token, "/sessions?page_size=100", &page)
	if err != nil {
		report.Provider = unsupported(redactProbeText(err.Error(), token), "Observer and Forward Dispatch unavailable; Room history remains readable")
		return report
	}
	report.Provider = supported(fmt.Sprintf("GET /api/v1/sessions returned HTTP %d", status))

	sessions := selectProbeSessions(page.Items, options.SessionIDs)
	for _, id := range missingSessionIDs(sessions, options.SessionIDs) {
		var session apiSession
		_, err := probeGET(ctx, client, locator.Origin, token, "/sessions/"+url.PathEscape(id), &session)
		if err == nil {
			sessions = append(sessions, session)
		}
	}
	sort.Slice(sessions, func(i, j int) bool { return sessions[i].ID < sessions[j].ID })
	for _, session := range sessions {
		report.Sessions = append(report.Sessions, RuntimeSessionCapability{
			SessionID: session.ID,
			Status:    session.Status,
			LastSeq:   session.LastSeq,
		})
	}
	if len(sessions) == 0 {
		report.SessionState = unsupported("no existing Session was available for a read-only probe", "Session status and last_seq remain unknown")
	} else {
		report.SessionState = supported(fmt.Sprintf("read status and last_seq for %d Session(s)", len(sessions)))
	}

	if len(sessions) > 0 {
		report.Transcript, report.TranscriptEndpoint = probeTranscript(ctx, client, locator.Origin, token, sessions[0].ID)
	} else {
		report.Transcript = unsupported("no existing Session was available", "rely on real-time events and Room projection; Pane user prompts may be unknown")
	}

	for _, count := range []int{2, 6, 12} {
		key := fmt.Sprint(count)
		if len(sessions) < count {
			report.MultiSession[key] = unsupported(fmt.Sprintf("requires %d existing Sessions; found %d", count, len(sessions)), "rebuild subscriptions or use one WebSocket per Session")
			continue
		}
		selected := sessions[:count]
		capability, cursorCapability := probeWSSubscription(ctx, locator.Origin, token, selected, options.WSDialer, timeout)
		report.MultiSession[key] = capability
		if cursorCapability.Supported || report.PerSessionCursors.Evidence == "" {
			report.PerSessionCursors = cursorCapability
		}
	}
	if report.PerSessionCursors.Evidence == "" {
		report.PerSessionCursors = unsupported("no 2-Session WebSocket probe could run", "start each observation from GET Session last_seq and use one connection per Session")
	}
	for _, count := range options.ObserverCounts {
		key := fmt.Sprint(count)
		if count <= 0 || len(sessions) < count {
			report.ObserverTransport[key] = unsupported(fmt.Sprintf("requires %d existing Sessions; found %d", count, len(sessions)), "keep Observer disabled")
			continue
		}
		report.ObserverTransport[key] = probeSessionObserver(ctx, adapter, locator.Generation, sessions[:count], timeout)
	}
	return report
}

func probeSessionObserver(ctx context.Context, adapter *KimiCodeServerAdapter, generation int64, sessions []apiSession, timeout time.Duration) RuntimeCapability {
	connected := make(chan int, 1)
	cursors := make(map[string]ObserverCursor, len(sessions))
	ids := make([]string, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, session.ID)
		cursors[session.ID] = ObserverCursor{Seq: int64(session.LastSeq)}
	}
	observer, err := NewSessionObserver(SessionObserverOptions{
		Adapter: adapter,
		LoadCursor: func(_ context.Context, sessionID string) (ObserverCursor, bool, error) {
			cursor, ok := cursors[sessionID]
			return cursor, ok, nil
		},
		Sink:         func(context.Context, ObserverBatch) error { return nil },
		HelloTimeout: timeout, ReadTimeout: timeout,
		OnConnected: func(count int, _ int64) {
			select {
			case connected <- count:
			default:
			}
		},
	})
	if err != nil {
		return unsupported(err.Error(), "keep Observer disabled")
	}
	probeCtx, cancel := context.WithCancel(ctx)
	updates := make(chan ObserverSubscription, 1)
	done := make(chan error, 1)
	go func() { done <- observer.Run(probeCtx, updates) }()
	updates <- ObserverSubscription{Generation: generation, SessionIDs: ids}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case count := <-connected:
		cancel()
		<-done
		return supported(fmt.Sprintf("SessionObserver connected with %d subscriptions", count))
	case <-timer.C:
		cancel()
		<-done
		return unsupported("SessionObserver hello timed out", "keep Observer disabled")
	case <-ctx.Done():
		cancel()
		<-done
		return unsupported("SessionObserver probe canceled", "keep Observer disabled")
	}
}

func probeTranscript(ctx context.Context, client *http.Client, origin, token, sessionID string) (RuntimeCapability, string) {
	paths := []string{
		"/sessions/" + url.PathEscape(sessionID) + "/messages",
		"/sessions/" + url.PathEscape(sessionID) + "/transcript",
	}
	evidence := make([]string, 0, len(paths))
	for _, path := range paths {
		status, err := probeGET(ctx, client, origin, token, path, nil)
		if err == nil {
			return supported(fmt.Sprintf("GET %s returned HTTP %d", normalizeServerAPIPath(path), status)), normalizeServerAPIPath(path)
		}
		evidence = append(evidence, fmt.Sprintf("GET %s: %s", normalizeServerAPIPath(path), redactProbeText(err.Error(), token)))
	}
	return unsupported(strings.Join(evidence, "; "), "rely on real-time events and Room projection; Pane user prompts may be unknown"), ""
}

func probeWSSubscription(ctx context.Context, origin, token string, sessions []apiSession, configured *websocket.Dialer, timeout time.Duration) (RuntimeCapability, RuntimeCapability) {
	wsURL, err := websocketURL(origin)
	if err != nil {
		capability := unsupported(err.Error(), "use one WebSocket per Session")
		return capability, capability
	}
	dialer := *websocket.DefaultDialer
	if configured != nil {
		dialer = *configured
	}
	dialer.Subprotocols = append([]string{wsBearerProtocolPrefix + token}, dialer.Subprotocols...)
	conn, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		capability := unsupported(redactProbeText(err.Error(), token), "use one WebSocket per Session")
		return capability, capability
	}
	defer conn.Close()
	_ = conn.SetReadDeadline(time.Now().Add(timeout))
	for {
		var frame wsFrame
		if err := conn.ReadJSON(&frame); err != nil {
			capability := unsupported(redactProbeText(err.Error(), token), "use one WebSocket per Session")
			return capability, capability
		}
		switch frame.Type {
		case "ping":
			if err := writePong(conn, frame); err != nil {
				capability := unsupported(redactProbeText(err.Error(), token), "use one WebSocket per Session")
				return capability, capability
			}
		case "server_hello":
			subscriptions := make([]string, 0, len(sessions))
			cursors := make(map[string]wsCursor, len(sessions))
			for _, session := range sessions {
				subscriptions = append(subscriptions, session.ID)
				cursors[session.ID] = wsCursor{Seq: session.LastSeq}
			}
			if err := conn.WriteJSON(map[string]any{
				"type": "client_hello",
				"id":   "runtime-capability-probe",
				"payload": map[string]any{
					"subscriptions": subscriptions,
					"cursors":       cursors,
				},
			}); err != nil {
				capability := unsupported(redactProbeText(err.Error(), token), "use one WebSocket per Session")
				return capability, capability
			}
		case "ack":
			evidence := fmt.Sprintf("server acknowledged client_hello with %d subscriptions and %d per-Session cursors", len(sessions), len(sessions))
			return supported(evidence), supported(evidence)
		case "resync_required":
			capability := unsupported("server returned resync_required before ack", "refresh Session state and rebuild the subscription")
			return capability, capability
		case "error":
			capability := unsupported("server returned WebSocket error before ack", "use one WebSocket per Session")
			return capability, capability
		}
	}
}

func probeGET(ctx context.Context, client *http.Client, origin, token, path string, target any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(origin, "/")+normalizeServerAPIPath(path), nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return res.StatusCode, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return res.StatusCode, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return res.StatusCode, fmt.Errorf("invalid API envelope")
	}
	if envelope.Code != 0 {
		return res.StatusCode, fmt.Errorf("API code=%d", envelope.Code)
	}
	if target != nil && len(envelope.Data) > 0 && string(envelope.Data) != "null" {
		if err := json.Unmarshal(envelope.Data, target); err != nil {
			return res.StatusCode, fmt.Errorf("invalid API data")
		}
	}
	return res.StatusCode, nil
}

func selectProbeSessions(items []apiSession, requested []string) []apiSession {
	if len(requested) == 0 {
		if len(items) > 12 {
			items = items[:12]
		}
		return append([]apiSession(nil), items...)
	}
	wanted := make(map[string]struct{}, len(requested))
	for _, id := range requested {
		if id = strings.TrimSpace(id); id != "" {
			wanted[id] = struct{}{}
		}
	}
	selected := make([]apiSession, 0, len(wanted))
	for _, session := range items {
		if _, ok := wanted[session.ID]; ok {
			selected = append(selected, session)
		}
	}
	return selected
}

func missingSessionIDs(sessions []apiSession, requested []string) []string {
	found := make(map[string]struct{}, len(sessions))
	for _, session := range sessions {
		found[session.ID] = struct{}{}
	}
	var missing []string
	for _, id := range requested {
		id = strings.TrimSpace(id)
		if _, ok := found[id]; id != "" && !ok {
			missing = append(missing, id)
		}
	}
	return missing
}

func unknownRuntimeCapabilities() map[string]RuntimeCapability {
	unknown := func(evidence, degradation string) RuntimeCapability { return unsupported(evidence, degradation) }
	return map[string]RuntimeCapability{
		"abortConfirmation":  unknown("requires a mutating Abort probe", "do not replace a Run until Runtime confirms Abort"),
		"approvalScope":      unknown("requires approval lifecycle and restart probes", "treat approval as one decision only"),
		"artifactEvents":     unknown("requires observing a real artifact-producing Run", "derive artifacts from reply references or Transcript"),
		"cursorEpoch":        unknown("requires a Runtime restart probe", "on generation change refresh Session state before reconnecting"),
		"followUpQueue":      unknown("requires concurrent Prompt submission", "use local FIFO"),
		"promptAttachments":  unknown("request body contract is not discoverable with a read-only probe", "reject attachments explicitly instead of dropping them"),
		"promptMetadataEcho": unknown("requires submitting tagged Prompt metadata", "correlate by Session and observed prompt_id only"),
		"reconnectReplay":    unknown("requires disconnecting during a live Run", "persist per-Session cursor and resync on gaps"),
		"resyncRequired":     unknown("not observed during hello/ack probe", "refresh Session state and rebuild subscriptions"),
		"userPromptEvent":    unknown("requires observing a real Pane Prompt", "show Pane user Prompt as unknown"),
	}
}

func supported(evidence string) RuntimeCapability {
	return RuntimeCapability{Supported: true, Evidence: evidence}
}

func unsupported(evidence, degradation string) RuntimeCapability {
	return RuntimeCapability{Supported: false, Evidence: evidence, Degradation: degradation}
}

func redactProbeText(value, token string) string {
	if token != "" {
		value = strings.ReplaceAll(value, token, "[REDACTED]")
	}
	return value
}
