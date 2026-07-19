package agentroom

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/providers/runtimeadapter"
	bridgeruntime "github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/runtime"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

func TestForwardMVPRealRuntimeFourAgentIsolation(t *testing.T) {
	locatorPath := os.Getenv("KIMI_AGENT_ROOM_REAL_RUNTIME_LOCATOR")
	if locatorPath == "" {
		t.Skip("set KIMI_AGENT_ROOM_REAL_RUNTIME_LOCATOR to run the opt-in real Runtime Gate")
	}
	adapter, err := bridgeruntime.NewKimiCodeServerAdapter(bridgeruntime.KimiCodeServerAdapterOptions{RuntimeLocatorPath: locatorPath})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	core, dataStore := openTestService(t)
	provider := runtimeadapter.NewProvider(adapter, dataStore, dataStore)
	observer := NewObserverCoordinator(dataStore, adapter, 100*time.Millisecond)
	observerDone := make(chan error, 1)
	go func() { observerDone <- observer.Run(ctx) }()
	defer func() {
		cancel()
		select {
		case <-observerDone:
		case <-time.After(2 * time.Second):
		}
	}()
	waitFor(t, 5*time.Second, observer.Running)

	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	repository := filepath.Clean(filepath.Join(workingDirectory, "..", "..", "..", ".."))
	workspaces := []string{
		repository,
		filepath.Join(repository, "apps", "kimi-im-bridge"),
		filepath.Join(repository, "apps", "kimi-shell"),
		filepath.Join(repository, ".ai"),
	}
	room, err := core.CreateRoom(ctx, RoomInput{Title: "Real Runtime Gate", OrchestrationMode: "parallel"})
	if err != nil {
		t.Fatal(err)
	}
	members := make([]domain.AgentRoomMember, 0, len(workspaces))
	workspaceByMember := map[string]string{}
	existingSessionIDs := strings.Split(strings.TrimSpace(os.Getenv("KIMI_AGENT_ROOM_REAL_SESSION_IDS")), ",")
	if len(existingSessionIDs) != len(workspaces) {
		existingSessionIDs = nil
	}
	for index, workspace := range workspaces {
		policy := domain.SessionPolicyPerRoom
		pinnedSessionID := ""
		if existingSessionIDs != nil {
			policy = domain.SessionPolicyPersistent
			pinnedSessionID = strings.TrimSpace(existingSessionIDs[index])
			if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: pinnedSessionID, WorkDir: workspace, ProviderName: "server"}); err != nil {
				t.Fatal(err)
			}
		}
		profile, createErr := core.CreateAgentProfile(ctx, AgentProfileInput{
			Name: "Real Gate Agent " + string(rune('A'+index)), RolePrompt: "Reply concisely without using tools.",
			DefaultWorkDir: workspace, SessionPolicy: policy, PinnedSessionID: pinnedSessionID,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		member, addErr := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
		if addErr != nil {
			t.Fatal(addErr)
		}
		members = append(members, member)
		workspaceByMember[member.MemberID] = workspace
	}

	dispatcher := NewDispatcher(core, dataStore, adapter, provider)
	result, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{
		Content: "Reply with exactly: ready", Mode: "parallel", QueuePolicy: "enqueue",
	})
	if err != nil || len(result.Runs) != 4 {
		t.Fatalf("real @all dispatch failed: %+v err=%v", result, err)
	}
	t.Logf("initial real Runs: %+v", result.Runs)
	waitForRealRuns(t, ctx, dataStore, result.Runs, 3*time.Minute)
	sessions := map[string]bool{}
	firstSession := ""
	for _, run := range result.Runs {
		stored, _ := dataStore.GetAgentRun(ctx, run.RunID)
		if sessions[stored.SessionID] {
			t.Fatalf("real Runtime reused Session %s across members", stored.SessionID)
		}
		sessions[stored.SessionID] = true
		if stored.WorkDir != workspaceByMember[stored.MemberID] {
			t.Fatalf("real Runtime crossed Workspace boundary: got=%s want=%s", stored.WorkDir, workspaceByMember[stored.MemberID])
		}
		if stored.MemberID == members[0].MemberID {
			firstSession = stored.SessionID
		}
		if _, inspectErr := adapter.InspectSession(ctx, stored.SessionID); inspectErr != nil {
			t.Fatalf("created Session %s cannot be reopened/inspected: %v", stored.SessionID, inspectErr)
		}
	}

	continued, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{
		Content: "Reply with exactly: continued", TargetMemberIDs: []string{members[0].MemberID}, Mode: "direct", QueuePolicy: "enqueue",
	})
	if err != nil || len(continued.Runs) != 1 {
		t.Fatalf("real continuation failed: %+v err=%v", continued, err)
	}
	waitForRealRuns(t, ctx, dataStore, continued.Runs, 2*time.Minute)
	continuedRun, _ := dataStore.GetAgentRun(ctx, continued.Runs[0].RunID)
	if continuedRun.SessionID != firstSession {
		t.Fatalf("real per_room continuation changed Session: first=%s next=%s", firstSession, continuedRun.SessionID)
	}
	waitFor(t, 30*time.Second, func() bool {
		events, eventErr := dataStore.ListAgentRoomEvents(ctx, store.AgentRoomEventQuery{RoomID: room.RoomID, Limit: 500})
		if eventErr != nil {
			return false
		}
		replies := map[string]bool{}
		for _, event := range events {
			if event.Kind == "run.reply_delta" && event.RunID != "" && event.TextDelta != "" {
				replies[event.RunID] = true
			}
		}
		for _, run := range append(append([]domain.AgentRun{}, result.Runs...), continued.Runs...) {
			if !replies[run.RunID] {
				return false
			}
		}
		return true
	})
}

func waitForRealRuns(t *testing.T, ctx context.Context, dataStore *store.Store, runs []domain.AgentRun, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		allCompleted := true
		states := make([]domain.AgentRun, 0, len(runs))
		for _, run := range runs {
			stored, _ := dataStore.GetAgentRun(ctx, run.RunID)
			if stored == nil {
				allCompleted = false
				continue
			}
			states = append(states, *stored)
			if stored.Status != "completed" {
				allCompleted = false
			}
			if stored.Status == "failed" || stored.Status == "blocked" || stored.Status == "aborted" || stored.Status == "orphaned" {
				t.Fatalf("real Runtime Run reached terminal failure: %+v", states)
			}
		}
		if allCompleted {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	states := make([]domain.AgentRun, 0, len(runs))
	for _, run := range runs {
		if stored, _ := dataStore.GetAgentRun(ctx, run.RunID); stored != nil {
			states = append(states, *stored)
		}
	}
	t.Fatalf("real Runtime Runs did not complete before timeout: %+v", states)
}
