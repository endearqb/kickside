package agentroom

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/providers/runtimeadapter"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type dispatchRuntime struct {
	mu            sync.Mutex
	next          int
	requests      []bridgeruntime.EnsureSessionRequest
	prompts       []string
	attachments   []int
	status        string
	inspectStatus string
}

type queuedDispatchRuntime struct {
	dispatchRuntime
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func TestRuntimePublicErrorRedactsPromptFailure(t *testing.T) {
	code, message := runtimePublicError(&bridgeruntime.PromptFailureError{Code: "model.not_configured", Message: "private runtime detail"})
	if code != "model_not_configured" || message != "Runtime model is not configured" || strings.Contains(message, "private") {
		t.Fatalf("unexpected public error: code=%q message=%q", code, message)
	}
	code, message = runtimePublicError(&bridgeruntime.PromptFailureError{Code: "provider.secret", Message: "token-like detail"})
	if code != "runtime_error" || message != "Runtime execution failed" {
		t.Fatalf("unknown Runtime error was not redacted: code=%q message=%q", code, message)
	}
}

func (r *queuedDispatchRuntime) RunTurn(_ context.Context, _ bridgecore.RuntimeTarget, request bridgecore.TurnRequest, sink bridgecore.TurnEventSink) (bridgecore.TurnResult, error) {
	r.mu.Lock()
	r.prompts = append(r.prompts, request.Prompt)
	r.attachments = append(r.attachments, len(request.Attachments))
	position := len(r.prompts)
	r.mu.Unlock()
	if position == 1 {
		r.once.Do(func() { close(r.started) })
		<-r.release
	}
	_ = sink(bridgecore.TurnEvent{Kind: bridgecore.EventTurnStarted, KimiSessionID: request.KimiSessionID})
	return bridgecore.TurnResult{KimiSessionID: request.KimiSessionID, PromptID: fmt.Sprintf("prompt-%d", position), Status: "completed"}, nil
}

func (r *dispatchRuntime) EnsureSession(_ context.Context, request bridgeruntime.EnsureSessionRequest) (bridgeruntime.SessionRef, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.requests = append(r.requests, request)
	if request.CreateMode == bridgeruntime.SessionResumeExact {
		return bridgeruntime.SessionRef{KimiCodeSessionID: request.KimiCodeSessionID, WorkspaceRoot: request.WorkspaceRoot}, nil
	}
	r.next++
	return bridgeruntime.SessionRef{KimiCodeSessionID: fmt.Sprintf("created-%d", r.next), WorkspaceRoot: request.WorkspaceRoot}, nil
}

func (r *dispatchRuntime) InspectSession(_ context.Context, sessionID string) (bridgeruntime.RuntimeSessionState, error) {
	r.mu.Lock()
	status := r.inspectStatus
	r.mu.Unlock()
	if status == "" {
		status = "idle"
	}
	return bridgeruntime.RuntimeSessionState{SessionID: sessionID, Status: status, ObservedAt: time.Now().UTC().Format(time.RFC3339)}, nil
}

func (r *dispatchRuntime) RunTurn(_ context.Context, _ bridgecore.RuntimeTarget, request bridgecore.TurnRequest, sink bridgecore.TurnEventSink) (bridgecore.TurnResult, error) {
	r.mu.Lock()
	r.prompts = append(r.prompts, request.Prompt)
	r.attachments = append(r.attachments, len(request.Attachments))
	r.mu.Unlock()
	_ = sink(bridgecore.TurnEvent{Kind: bridgecore.EventTurnStarted, KimiSessionID: request.KimiSessionID})
	status := r.status
	if status == "" {
		status = "completed"
	}
	return bridgecore.TurnResult{KimiSessionID: request.KimiSessionID, PromptID: "prompt-" + request.KimiSessionID, Status: status}, nil
}

func TestDispatcherResumesOnlyExplicitPersistentAndSelectedSessions(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	for _, sessionID := range []string{"persistent-session", "selected-session"} {
		if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: sessionID, WorkDir: workspace, ProviderName: "server"}); err != nil {
			t.Fatal(err)
		}
	}
	profile, err := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Persistent", RolePrompt: "persist", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPersistent, PinnedSessionID: "persistent-session"})
	if err != nil {
		t.Fatal(err)
	}
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Exact room", OrchestrationMode: "direct"})
	persistent, err := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := core.AddPinnedSessionMember(ctx, room.RoomID, PinnedMemberInput{DisplayName: "Selected", PinnedSessionID: "selected-session", WorkspaceRoot: workspace})
	if err != nil {
		t.Fatal(err)
	}
	runtime := &dispatchRuntime{}
	result, err := NewDispatcher(core, dataStore, runtime, runtime).Dispatch(ctx, room.RoomID, MessageInput{
		Content: "exact", TargetMemberIDs: []string{persistent.MemberID, selected.MemberID}, QueuePolicy: "enqueue", Mode: "direct",
	})
	if err != nil || len(result.Runs) != 2 {
		t.Fatalf("dispatch failed: %+v err=%v", result, err)
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if len(runtime.requests) != 2 || runtime.requests[0].CreateMode != bridgeruntime.SessionResumeExact || runtime.requests[0].KimiCodeSessionID != "persistent-session" || runtime.requests[1].CreateMode != bridgeruntime.SessionResumeExact || runtime.requests[1].KimiCodeSessionID != "selected-session" {
		t.Fatalf("expected exact resume requests, got %+v", runtime.requests)
	}
}

func TestDispatcherRecordOnlyNeverCallsRuntime(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	profile, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Recorder", RolePrompt: "record", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Record room", OrchestrationMode: "direct"})
	member, _ := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	runtime := &dispatchRuntime{}
	result, err := NewDispatcher(core, dataStore, runtime, runtime).Dispatch(ctx, room.RoomID, MessageInput{Content: "remember", TargetMemberIDs: []string{member.MemberID}, QueuePolicy: "record_only", Mode: "direct"})
	if err != nil || len(result.Runs) != 1 || result.Runs[0].Status != "completed" {
		t.Fatalf("record-only dispatch failed: %+v err=%v", result, err)
	}
	time.Sleep(20 * time.Millisecond)
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if len(runtime.prompts) != 0 || len(runtime.requests) != 0 {
		t.Fatalf("record-only unexpectedly called Runtime: prompts=%+v sessions=%+v", runtime.prompts, runtime.requests)
	}
}

func TestDispatcherRecoverStartsPersistedQueuedRun(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	profile, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Recover", RolePrompt: "resume queued work", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Recovery", OrchestrationMode: "direct"})
	member, _ := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	runtime := &dispatchRuntime{inspectStatus: "running"}
	result, err := NewDispatcher(core, dataStore, runtime, runtime).Dispatch(ctx, room.RoomID, MessageInput{
		Content: "persist across restart", TargetMemberIDs: []string{member.MemberID}, QueuePolicy: "enqueue", Mode: "direct",
	})
	if err != nil || len(result.Runs) != 1 {
		t.Fatalf("queue initial Run: %+v %v", result, err)
	}
	queued, _ := dataStore.GetAgentRun(ctx, result.Runs[0].RunID)
	if queued == nil || queued.Status != "queued" || queued.QueuePosition == nil {
		t.Fatalf("Run was not durably queued: %+v", queued)
	}
	runtime.mu.Lock()
	runtime.inspectStatus = "idle"
	runtime.mu.Unlock()
	restarted := NewDispatcher(core, dataStore, runtime, runtime)
	if err := restarted.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	waitFor(t, 5*time.Second, func() bool {
		stored, _ := dataStore.GetAgentRun(ctx, result.Runs[0].RunID)
		return stored != nil && stored.Status == "completed" && stored.TurnID != ""
	})
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if len(runtime.prompts) != 1 || !strings.Contains(runtime.prompts[0], "persist across restart") {
		t.Fatalf("recovered prompt was not executed exactly once: %+v", runtime.prompts)
	}
}

func TestDispatcherPersistsRuntimeReportedFailureWithoutLeakingDetails(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	profile, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Failure", RolePrompt: "fail", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Failure room", OrchestrationMode: "direct"})
	member, _ := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	runtime := &dispatchRuntime{status: "failed"}
	result, err := NewDispatcher(core, dataStore, runtime, runtime).Dispatch(ctx, room.RoomID, MessageInput{Content: "fail", TargetMemberIDs: []string{member.MemberID}, QueuePolicy: "enqueue", Mode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		stored, _ := dataStore.GetAgentRun(ctx, result.Runs[0].RunID)
		if stored != nil && stored.Status == "failed" {
			if stored.ErrorCode != "runtime_failed" || stored.ErrorMessage != "Runtime reported a failed turn" {
				t.Fatalf("unexpected public Runtime failure: %+v", stored)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("Runtime failure was not persisted")
}

func TestDispatcherFIFOUsesEachQueuedRunsSourceMessage(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	profile, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Queue", RolePrompt: "queue", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Queue room", OrchestrationMode: "direct"})
	member, _ := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	runtime := &queuedDispatchRuntime{started: make(chan struct{}), release: make(chan struct{})}
	dispatcher := NewDispatcher(core, dataStore, runtime, runtime)
	first, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{Content: "first task", TargetMemberIDs: []string{member.MemberID}, QueuePolicy: "enqueue", Mode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-runtime.started:
	case <-time.After(2 * time.Second):
		t.Fatal("first Run did not reach Runtime")
	}
	second, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{Content: "second task", TargetMemberIDs: []string{member.MemberID}, QueuePolicy: "enqueue", Mode: "direct"})
	if err != nil || len(second.Runs) != 1 {
		t.Fatalf("second dispatch failed: %+v err=%v", second, err)
	}
	close(runtime.release)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		one, _ := dataStore.GetAgentRun(ctx, first.Runs[0].RunID)
		two, _ := dataStore.GetAgentRun(ctx, second.Runs[0].RunID)
		if one != nil && two != nil && one.Status == "completed" && two.Status == "completed" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if len(runtime.prompts) != 2 || !strings.Contains(runtime.prompts[0], "Task:\nfirst task") || !strings.Contains(runtime.prompts[1], "Task:\nsecond task") {
		t.Fatalf("queued prompts crossed message boundaries: %+v", runtime.prompts)
	}
}

func TestDispatcherInjectsOnlyTraceableSharedRunResults(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	profile, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Reviewer", RolePrompt: "review", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Shared room", OrchestrationMode: "direct"})
	member, _ := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	previous, err := core.CreateMessageWithRuns(ctx, room.RoomID, MessageInput{Content: "first", TargetMemberIDs: []string{member.MemberID}, QueuePolicy: "record_only", Mode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dataStore.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{EventID: "shared-reply", RoomID: room.RoomID, RunID: previous.Runs[0].RunID, SessionID: "old-session", Kind: "run.reply_delta", TextDelta: "validated finding"}); err != nil {
		t.Fatal(err)
	}
	runtime := &dispatchRuntime{}
	result, err := NewDispatcher(core, dataStore, runtime, runtime).Dispatch(ctx, room.RoomID, MessageInput{Content: "use result", TargetMemberIDs: []string{member.MemberID}, QueuePolicy: "enqueue", Mode: "direct", SharedRunIDs: []string{previous.Runs[0].RunID}})
	if err != nil || len(result.Runs) != 1 {
		t.Fatalf("shared-result dispatch failed: %+v err=%v", result, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		runtime.mu.Lock()
		ready := len(runtime.prompts) == 1
		runtime.mu.Unlock()
		if ready {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if len(runtime.prompts) != 1 || !strings.Contains(runtime.prompts[0], "validated finding") || !strings.Contains(runtime.prompts[0], previous.Runs[0].RunID) {
		t.Fatalf("shared result was not traceably assembled: %+v", runtime.prompts)
	}
	if !strings.Contains(string(result.Runs[0].PromptAssembly), previous.Runs[0].RunID) {
		t.Fatalf("prompt assembly omitted shared Run reference: %s", result.Runs[0].PromptAssembly)
	}
}
func (*dispatchRuntime) ResolveApproval(context.Context, string, string, string) error { return nil }
func (*dispatchRuntime) ReconcilePendingApprovals(context.Context, string) (int, error) {
	return 0, nil
}
func (*dispatchRuntime) Close() error { return nil }

func TestDispatcherCreatesDistinctExactSessionsAndExecutesAllTargets(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	first, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "A", RolePrompt: "role A", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	second, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "B", RolePrompt: "role B", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyNewPerTask})
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Room", SharedBrief: "review independently", OrchestrationMode: "parallel"})
	memberA, _ := core.AddAgentMember(ctx, room.RoomID, first.AgentID)
	memberB, _ := core.AddAgentMember(ctx, room.RoomID, second.AgentID)
	runtime := &dispatchRuntime{}
	dispatcher := NewDispatcher(core, dataStore, runtime, runtime)
	attachments, _ := json.Marshal([]domain.PromptAttachment{{Kind: domain.AttachmentKindFile, LocalPath: filepath.Join(workspace, "brief.txt")}})

	result, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{Content: "review", TargetMemberIDs: []string{memberA.MemberID, memberB.MemberID}, QueuePolicy: "enqueue", Mode: "parallel", Attachments: attachments})
	if err != nil || len(result.Runs) != 2 || result.Runs[0].SessionID == result.Runs[1].SessionID {
		t.Fatalf("expected two distinct dispatched Runs, got %+v err=%v", result, err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		one, _ := dataStore.GetAgentRun(ctx, result.Runs[0].RunID)
		two, _ := dataStore.GetAgentRun(ctx, result.Runs[1].RunID)
		if one != nil && two != nil && one.Status == "completed" && two.Status == "completed" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	for _, initial := range result.Runs {
		stored, _ := dataStore.GetAgentRun(ctx, initial.RunID)
		if stored == nil || stored.Status != "completed" || stored.PromptID == "" || stored.TurnID == "" {
			t.Fatalf("Run did not execute to completion: %+v", stored)
		}
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if len(runtime.requests) != 2 || runtime.requests[0].CreateMode != bridgeruntime.SessionCreateAlways || runtime.requests[1].CreateMode != bridgeruntime.SessionCreateAlways {
		t.Fatalf("dispatch did not use exact create policy: %+v", runtime.requests)
	}
	if len(runtime.attachments) != 2 || runtime.attachments[0] != 1 || runtime.attachments[1] != 1 {
		t.Fatalf("dispatch did not forward attachments to every target: %+v", runtime.attachments)
	}
}

func TestForwardMVPFakeRuntimeFourAgentIsolationAndContinuation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	_, runtimeServer, adapter := newCoordinatorRuntime(t)
	defer runtimeServer.Close()
	core, dataStore := openTestService(t)
	provider := runtimeadapter.NewProvider(adapter, dataStore, dataStore)
	observer := NewObserverCoordinator(dataStore, adapter, 20*time.Millisecond)
	observerDone := make(chan error, 1)
	go func() { observerDone <- observer.Run(ctx) }()
	waitFor(t, 2*time.Second, observer.Running)

	room, err := core.CreateRoom(ctx, RoomInput{Title: "Four agents", SharedBrief: "stay isolated", OrchestrationMode: "parallel"})
	if err != nil {
		t.Fatal(err)
	}
	members := make([]domain.AgentRoomMember, 0, 4)
	membersByID := map[string]domain.AgentRoomMember{}
	for index := 0; index < 4; index++ {
		workspace := filepath.Join(t.TempDir(), fmt.Sprintf("workspace-%d", index))
		if err := os.MkdirAll(workspace, 0o755); err != nil {
			t.Fatal(err)
		}
		profile, createErr := core.CreateAgentProfile(ctx, AgentProfileInput{Name: fmt.Sprintf("Agent %d", index+1), RolePrompt: fmt.Sprintf("Role %d", index+1), DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
		if createErr != nil {
			t.Fatal(createErr)
		}
		member, addErr := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
		if addErr != nil {
			t.Fatal(addErr)
		}
		members = append(members, member)
		membersByID[member.MemberID] = member
	}
	dispatcher := NewDispatcher(core, dataStore, adapter, provider)
	first, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{Content: "reply with your role", Mode: "parallel", QueuePolicy: "enqueue"})
	if err != nil || len(first.Runs) != 4 {
		t.Fatalf("@all dispatch failed: %+v err=%v", first, err)
	}
	completed := false
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		completed = true
		for _, run := range first.Runs {
			stored, _ := dataStore.GetAgentRun(ctx, run.RunID)
			if stored == nil || stored.Status != "completed" || stored.SessionID == "" || stored.TurnID == "" || stored.PromptID == "" {
				completed = false
				break
			}
		}
		if completed {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !completed {
		states := []string{}
		for _, run := range first.Runs {
			stored, _ := dataStore.GetAgentRun(ctx, run.RunID)
			if stored == nil {
				states = append(states, run.RunID+":missing")
			} else {
				states = append(states, fmt.Sprintf("%s:%s session=%s prompt=%s turn=%s error=%s", stored.RunID, stored.Status, stored.SessionID, stored.PromptID, stored.TurnID, stored.ErrorCode))
			}
		}
		t.Fatalf("four-Agent Runs did not complete before timeout: %+v", states)
	}
	sessions := map[string]string{}
	initialSessionByMember := map[string]string{}
	for _, run := range first.Runs {
		stored, _ := dataStore.GetAgentRun(ctx, run.RunID)
		if previousMember, exists := sessions[stored.SessionID]; exists {
			t.Fatalf("members %s and %s shared Session %s", previousMember, stored.MemberID, stored.SessionID)
		}
		sessions[stored.SessionID] = stored.MemberID
		initialSessionByMember[stored.MemberID] = stored.SessionID
		member := membersByID[stored.MemberID]
		if stored.WorkDir != member.WorkspaceRoot {
			t.Fatalf("Workspace crossed member boundary: run=%+v member=%+v", stored, member)
		}
	}

	continued, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{Content: "continue in the same context", TargetMemberIDs: []string{members[0].MemberID}, Mode: "direct", QueuePolicy: "enqueue"})
	if err != nil || len(continued.Runs) != 1 {
		t.Fatalf("continuation dispatch failed: %+v err=%v", continued, err)
	}
	waitFor(t, 5*time.Second, func() bool {
		stored, _ := dataStore.GetAgentRun(ctx, continued.Runs[0].RunID)
		return stored != nil && stored.Status == "completed"
	})
	continuedRun, _ := dataStore.GetAgentRun(ctx, continued.Runs[0].RunID)
	if continuedRun.SessionID != initialSessionByMember[members[0].MemberID] {
		t.Fatalf("per_room continuation changed Session: first=%s next=%s", initialSessionByMember[members[0].MemberID], continuedRun.SessionID)
	}
	waitFor(t, 5*time.Second, func() bool {
		events, eventErr := dataStore.ListAgentRoomEvents(ctx, store.AgentRoomEventQuery{RoomID: room.RoomID, Limit: 500})
		if eventErr != nil {
			return false
		}
		replied := map[string]bool{}
		for _, event := range events {
			if event.Kind == "run.reply_delta" && event.RunID != "" {
				replied[event.RunID] = true
			}
		}
		for _, run := range append(append([]domain.AgentRun{}, first.Runs...), continued.Runs...) {
			if !replied[run.RunID] {
				return false
			}
		}
		return true
	})
	cancel()
	select {
	case err := <-observerDone:
		if err != nil && err != context.Canceled {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Observer did not stop")
	}
}
