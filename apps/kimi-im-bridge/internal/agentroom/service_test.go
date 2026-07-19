package agentroom

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

func TestAgentProfileValidationRevisionAndMemberSnapshot(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	workspace := t.TempDir()
	profile, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "  架构师  ", RolePrompt: "  审查边界  ", DefaultWorkDir: workspace,
		SessionPolicy: domain.SessionPolicyPerRoom, RuntimeControls: json.RawMessage(`{"thinking":"low","planMode":true}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if profile.Name != "架构师" || profile.RolePrompt != "审查边界" || !profile.Enabled || profile.Revision != 1 || !filepath.IsAbs(profile.DefaultWorkDir) {
		t.Fatalf("unexpected normalized profile: %+v", profile)
	}
	if _, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "bad", RolePrompt: "role", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom,
		RuntimeControls: json.RawMessage(`{"token":"secret"}`),
	}); ErrorCode(err) != "invalid_runtime_controls" {
		t.Fatalf("expected runtime controls whitelist rejection, got %v", err)
	}
	if _, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "bad", RolePrompt: "role", DefaultWorkDir: filepath.Join(workspace, "missing"), SessionPolicy: domain.SessionPolicyPerRoom,
	}); ErrorCode(err) != "workspace_not_found" {
		t.Fatalf("expected workspace validation, got %v", err)
	}
	if _, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "bad", RolePrompt: "  ", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom,
	}); ErrorCode(err) != "role_prompt_required" {
		t.Fatalf("expected required role prompt rejection, got %v", err)
	}

	profile, err = service.UpdateAgentProfile(ctx, profile.AgentID, profile.Revision, AgentProfileInput{
		Name: "首席架构师", RolePrompt: profile.RolePrompt, DefaultWorkDir: workspace,
		SessionPolicy: profile.SessionPolicy, RuntimeControls: profile.RuntimeControls, Enabled: true,
	})
	if err != nil || profile.Revision != 2 {
		t.Fatalf("expected profile revision update, got %+v, %v", profile, err)
	}
	if _, err := service.UpdateAgentProfile(ctx, profile.AgentID, 1, AgentProfileInput{
		Name: profile.Name, RolePrompt: profile.RolePrompt, DefaultWorkDir: workspace,
		SessionPolicy: profile.SessionPolicy, RuntimeControls: profile.RuntimeControls, Enabled: true,
	}); ErrorCode(err) != "revision_conflict" {
		t.Fatalf("expected stable revision conflict, got %v", err)
	}

	room, err := service.CreateRoom(ctx, RoomInput{Title: " Review ", OrchestrationMode: "parallel"})
	if err != nil {
		t.Fatal(err)
	}
	member, err := service.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	if err != nil {
		t.Fatal(err)
	}
	if member.RolePromptSnapshot != profile.RolePrompt || member.DisplayName != profile.Name || member.WorkspaceRoot != profile.DefaultWorkDir {
		t.Fatalf("agent member did not snapshot profile: %+v", member)
	}
	if _, err := service.AddAgentMember(ctx, room.RoomID, profile.AgentID); err == nil {
		t.Fatal("expected one agent profile to be unique within a room")
	}
	room, err = service.UpdateRoom(ctx, room.RoomID, RoomInput{Title: room.Title, OrchestrationMode: room.OrchestrationMode, Archived: true})
	if err != nil || !room.Archived {
		t.Fatalf("expected room archive update, got %+v, %v", room, err)
	}
	if _, err := service.AddAgentMember(ctx, room.RoomID, profile.AgentID); ErrorCode(err) != "room_archived" {
		t.Fatalf("expected archived room member rejection, got %v", err)
	}
	if _, err := service.UpdateMember(ctx, room.RoomID, member.MemberID, MemberUpdateInput{}); ErrorCode(err) != "room_archived" {
		t.Fatalf("expected archived room update rejection, got %v", err)
	}
	if err := service.DeleteMember(ctx, room.RoomID, member.MemberID); ErrorCode(err) != "room_archived" {
		t.Fatalf("expected archived room delete rejection, got %v", err)
	}
	if _, err := service.CreateMessageWithRuns(ctx, room.RoomID, MessageInput{Content: "blocked"}); ErrorCode(err) != "room_archived" {
		t.Fatalf("expected archived room dispatch rejection, got %v", err)
	}
	if _, err := service.UpdateRoom(ctx, room.RoomID, RoomInput{Title: "renamed", OrchestrationMode: room.OrchestrationMode, Archived: true}); ErrorCode(err) != "room_archived" {
		t.Fatalf("expected archived room edit rejection, got %v", err)
	}
	room, err = service.UpdateRoom(ctx, room.RoomID, RoomInput{Title: room.Title, OrchestrationMode: room.OrchestrationMode})
	if err != nil || room.Archived {
		t.Fatalf("expected explicit room restore, got %+v, %v", room, err)
	}
	if err := service.DeleteAgentProfile(ctx, profile.AgentID); err != nil {
		t.Fatal(err)
	}
	preserved, err := dataStore.GetAgentRoomMember(ctx, member.MemberID)
	if err != nil || preserved == nil || preserved.AgentID != "" || preserved.DisplayName != profile.Name || preserved.RolePromptSnapshot != profile.RolePrompt {
		t.Fatalf("profile deletion did not preserve member snapshot: %+v, %v", preserved, err)
	}
}

func TestRoomSharedBriefLimit(t *testing.T) {
	service, _ := openTestService(t)
	if _, err := service.CreateRoom(context.Background(), RoomInput{
		Title: "boundary", SharedBrief: strings.Repeat("a", 64*1024), OrchestrationMode: "direct",
	}); err != nil {
		t.Fatalf("expected 64 KiB shared brief, got %v", err)
	}
	if _, err := service.CreateRoom(context.Background(), RoomInput{
		Title: "too large", SharedBrief: strings.Repeat("a", 64*1024+1), OrchestrationMode: "direct",
	}); ErrorCode(err) != "shared_brief_too_large" {
		t.Fatalf("expected shared brief limit rejection, got %v", err)
	}
}

func TestPinnedAndFollowedPaneMembersRequireExactWorkspaceSession(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	workspaceA := t.TempDir()
	workspaceB := t.TempDir()
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-a", WorkDir: workspaceA}); err != nil {
		t.Fatal(err)
	}
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-b", WorkDir: workspaceB}); err != nil {
		t.Fatal(err)
	}
	room, err := service.CreateRoom(ctx, RoomInput{Title: "Room", OrchestrationMode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.AddPinnedSessionMember(ctx, room.RoomID, PinnedMemberInput{
		DisplayName: "wrong", PinnedSessionID: "session-a", WorkspaceRoot: workspaceB,
	}); ErrorCode(err) != "workspace_mismatch" {
		t.Fatalf("expected pinned workspace mismatch, got %v", err)
	}
	pinned, err := service.AddPinnedSessionMember(ctx, room.RoomID, PinnedMemberInput{
		DisplayName: "Backend", PinnedSessionID: "session-a", WorkspaceRoot: workspaceA,
	})
	if err != nil || pinned.EffectiveSessionID != "session-a" || pinned.MemberKind != "pinned_session" {
		t.Fatalf("unexpected pinned member: %+v, %v", pinned, err)
	}
	if _, err := dataStore.UpsertPaneSessionObservation(ctx, domain.PaneSessionObservation{
		PaneID: "pane-a", EffectiveSessionID: "session-a", WorkDir: workspaceA,
		MountPolicy: "eager", LoadState: "ready", Generation: 1,
	}); err != nil {
		t.Fatal(err)
	}
	followed, err := service.AddFollowedPaneMember(ctx, room.RoomID, "pane-a", "Pane A")
	if err != nil || followed.FollowMode != "follow_pane" || followed.FollowedPaneID != "pane-a" || followed.EffectiveSessionID != "session-a" {
		t.Fatalf("unexpected followed pane member: %+v, %v", followed, err)
	}
	if _, err := service.AddFollowedPaneMember(ctx, room.RoomID, "pane-missing", ""); ErrorCode(err) != "pane_session_unresolved" {
		t.Fatalf("expected unresolved pane rejection, got %v", err)
	}
	updatedName := "Rebound"
	rebound, err := service.UpdateMember(ctx, room.RoomID, pinned.MemberID, MemberUpdateInput{
		DisplayName: &updatedName,
		Binding:     &MemberBindingInput{FollowMode: "pin_session", PinnedSessionID: "session-b", WorkspaceRoot: workspaceB},
	})
	if err != nil || rebound.DisplayName != updatedName || rebound.EffectiveSessionID != "session-b" || rebound.WorkspaceRoot != workspaceB {
		t.Fatalf("expected atomic pinned rebind, got %+v, %v", rebound, err)
	}
	rejectedName := "must-not-persist"
	if _, err := service.UpdateMember(ctx, room.RoomID, pinned.MemberID, MemberUpdateInput{
		DisplayName: &rejectedName,
		Binding:     &MemberBindingInput{FollowMode: "pin_session", PinnedSessionID: "session-a", WorkspaceRoot: workspaceB},
	}); ErrorCode(err) != "workspace_mismatch" {
		t.Fatalf("expected atomic rebind rejection, got %v", err)
	}
	unchanged, err := dataStore.GetAgentRoomMember(ctx, pinned.MemberID)
	if err != nil || unchanged == nil || unchanged.DisplayName != updatedName || unchanged.EffectiveSessionID != "session-b" {
		t.Fatalf("failed rebind changed stored member: %+v, %v", unchanged, err)
	}
	if _, err := dataStore.SyncPaneSessionObservations(ctx, 2, []domain.PaneSessionObservation{{
		PaneID: "pane-a", ActiveSessionID: "session-b", EffectiveSessionID: "session-b", WorkDir: workspaceB, MountPolicy: "eager", LoadState: "ready",
	}}); err != nil {
		t.Fatal(err)
	}
	followedStored, err := dataStore.GetAgentRoomMember(ctx, followed.MemberID)
	if err != nil || followedStored == nil || followedStored.EffectiveSessionID != "session-b" || followedStored.WorkspaceRoot != workspaceB || followedStored.Status != "idle" {
		t.Fatalf("followed member did not track pane session switch: %+v, %v", followedStored, err)
	}
	if _, err := dataStore.SyncPaneSessionObservations(ctx, 3, nil); err != nil {
		t.Fatal(err)
	}
	followedStored, err = dataStore.GetAgentRoomMember(ctx, followed.MemberID)
	if err != nil || followedStored == nil || followedStored.EffectiveSessionID != "" || followedStored.Status != "pane_unavailable" {
		t.Fatalf("followed member did not expose missing pane: %+v, %v", followedStored, err)
	}
	if _, err := dataStore.SyncPaneSessionObservations(ctx, 4, []domain.PaneSessionObservation{{
		PaneID: "pane-a", ActiveSessionID: "session-missing", EffectiveSessionID: "session-missing", WorkDir: workspaceA,
	}}); err != nil {
		t.Fatal(err)
	}
	followedStored, err = dataStore.GetAgentRoomMember(ctx, followed.MemberID)
	if err != nil || followedStored == nil || followedStored.EffectiveSessionID != "" || followedStored.Status != "session_unresolved" {
		t.Fatalf("followed member did not reject unknown session: %+v, %v", followedStored, err)
	}
	if _, err := dataStore.SyncPaneSessionObservations(ctx, 5, []domain.PaneSessionObservation{{
		PaneID: "pane-a", ActiveSessionID: "session-a", EffectiveSessionID: "session-a", WorkDir: workspaceB,
	}}); err != nil {
		t.Fatal(err)
	}
	followedStored, err = dataStore.GetAgentRoomMember(ctx, followed.MemberID)
	if err != nil || followedStored == nil || followedStored.EffectiveSessionID != "" || followedStored.Status != "workspace_mismatch" {
		t.Fatalf("followed member did not reject pane/session workspace mismatch: %+v, %v", followedStored, err)
	}
}

func TestAgentProfilePinnedPolicyValidation(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	workspace := t.TempDir()
	if _, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "resume", RolePrompt: "role", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyResumeSelected,
	}); ErrorCode(err) != "session_required" {
		t.Fatalf("expected missing resume session rejection, got %v", err)
	}
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1", WorkDir: workspace}); err != nil {
		t.Fatal(err)
	}
	profile, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "resume", RolePrompt: "role", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyResumeSelected,
		PinnedSessionID: "session-1",
	})
	if err != nil || profile.PinnedSessionID != "session-1" {
		t.Fatalf("expected exact pinned profile, got %+v, %v", profile, err)
	}
	if _, err := service.CreateAgentProfile(ctx, AgentProfileInput{
		Name: "invalid", RolePrompt: "role", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyNewPerTask,
		PinnedSessionID: "session-1",
	}); ErrorCode(err) != "invalid_pinned_session" {
		t.Fatalf("expected policy/pinned rejection, got %v", err)
	}
}

func TestMessageRunsPartialSuccessStatusAbortRetryAndTimeline(t *testing.T) {
	ctx := context.Background()
	service, dataStore := openTestService(t)
	workspace := t.TempDir()
	profileA, err := service.CreateAgentProfile(ctx, AgentProfileInput{Name: "A", RolePrompt: "role A", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyPerRoom})
	if err != nil {
		t.Fatal(err)
	}
	profileB, err := service.CreateAgentProfile(ctx, AgentProfileInput{Name: "B", RolePrompt: "role B", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyNewPerTask})
	if err != nil {
		t.Fatal(err)
	}
	room, err := service.CreateRoom(ctx, RoomInput{Title: "Room", OrchestrationMode: "parallel"})
	if err != nil {
		t.Fatal(err)
	}
	memberA, err := service.AddAgentMember(ctx, room.RoomID, profileA.AgentID)
	if err != nil {
		t.Fatal(err)
	}
	memberB, err := service.AddAgentMember(ctx, room.RoomID, profileB.AgentID)
	if err != nil {
		t.Fatal(err)
	}
	result, err := service.CreateMessageWithRuns(ctx, room.RoomID, MessageInput{
		Content: "review", TargetMemberIDs: []string{memberA.MemberID, "missing", memberB.MemberID, memberA.MemberID},
		QueuePolicy: "enqueue",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Runs) != 2 || len(result.Failures) != 1 || result.Failures[0].Code != "member_not_found" {
		t.Fatalf("expected two runs and isolated target failure, got %+v", result)
	}
	if result.Runs[0].SourceMessageID != result.Message.MessageID || result.Runs[1].SourceMessageID != result.Message.MessageID {
		t.Fatalf("runs were not atomically associated with message: %+v", result)
	}
	running, err := service.UpdateRun(ctx, result.Runs[0].RunID, RunUpdate{
		Status: "running", SessionID: "session-a", TurnID: "turn-a", PromptID: "prompt-a",
	})
	if err != nil || running.SessionID != "session-a" || running.PromptID != "prompt-a" {
		t.Fatalf("expected run association update, got %+v, %v", running, err)
	}
	abortRequested, err := service.MarkAbortRequested(ctx, running.RunID)
	if err != nil || abortRequested.Status != "abort_requested" {
		t.Fatalf("active abort must remain unconfirmed, got %+v, %v", abortRequested, err)
	}
	if _, err := service.RetryRun(ctx, abortRequested.RunID); ErrorCode(err) != "run_not_retryable" {
		t.Fatalf("unconfirmed abort must forbid replacement run, got %v", err)
	}
	aborted, err := service.MarkAbortRequested(ctx, result.Runs[1].RunID)
	if err != nil || aborted.Status != "aborted" || aborted.CompletedAt == "" {
		t.Fatalf("queued run should abort locally, got %+v, %v", aborted, err)
	}
	retry, err := service.RetryRun(ctx, aborted.RunID)
	if err != nil || retry.RunID == aborted.RunID || retry.Status != "queued" || retry.SourceMessageID != aborted.SourceMessageID {
		t.Fatalf("expected new retry run, got %+v, %v", retry, err)
	}
	if _, err := dataStore.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{EventID: "event-run", RoomID: room.RoomID, RunID: running.RunID, Kind: "run.started"}); err != nil {
		t.Fatal(err)
	}
	timeline, err := dataStore.GetAgentRoomTimeline(ctx, room.RoomID, 0, 20)
	if err != nil || len(timeline.Messages) != 1 || len(timeline.Runs) != 3 || len(timeline.Events) != 3 {
		t.Fatalf("unexpected room timeline: %+v, %v", timeline, err)
	}
}

func openTestService(t *testing.T) (*Service, *store.Store) {
	t.Helper()
	dataStore, err := store.Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dataStore.Close() })
	return NewService(dataStore), dataStore
}
