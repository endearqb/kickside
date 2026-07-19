package agentroom

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/bridgecore"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/store"
)

type workflowRuntime struct {
	dispatchRuntime
	failFirst bool
}

func (r *workflowRuntime) RunTurn(_ context.Context, _ bridgecore.RuntimeTarget, request bridgecore.TurnRequest, sink bridgecore.TurnEventSink) (bridgecore.TurnResult, error) {
	r.mu.Lock()
	r.prompts = append(r.prompts, request.Prompt)
	position := len(r.prompts)
	r.mu.Unlock()
	_ = sink(bridgecore.TurnEvent{Kind: bridgecore.EventTurnStarted, KimiSessionID: request.KimiSessionID})
	_ = sink(bridgecore.TurnEvent{Kind: bridgecore.EventContentDelta, KimiSessionID: request.KimiSessionID, TextDelta: fmt.Sprintf("result-%d", position)})
	status := "completed"
	if r.failFirst && position == 1 {
		status = "failed"
	}
	return bridgecore.TurnResult{KimiSessionID: request.KimiSessionID, PromptID: fmt.Sprintf("prompt-%d", position), Status: status}, nil
}

func TestWorkflowDefinitionValidation(t *testing.T) {
	members := map[string]domain.AgentRoomMember{"member-a": {MemberID: "member-a"}}
	valid := &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{{StageID: "a", TargetMemberIDs: []string{"member-a"}, Aggregation: "all", FailurePolicy: "stop"}}}
	if _, err := normalizeWorkflowDefinition(valid, members); err != nil {
		t.Fatalf("valid definition was rejected: %v", err)
	}
	tests := []struct {
		name       string
		definition *domain.WorkflowDefinition
		code       string
	}{
		{"required", nil, "workflow_definition_required"},
		{"version", &domain.WorkflowDefinition{Version: "2", Stages: valid.Stages}, "invalid_workflow_version"},
		{"duplicate", &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{valid.Stages[0], valid.Stages[0]}}, "duplicate_workflow_stage"},
		{"missing dependency", &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{{StageID: "a", TargetMemberIDs: []string{"member-a"}, DependsOn: []string{"missing"}, Aggregation: "all", FailurePolicy: "stop"}}}, "workflow_dependency_not_found"},
		{"cycle", &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{{StageID: "a", TargetMemberIDs: []string{"member-a"}, DependsOn: []string{"b"}, Aggregation: "all", FailurePolicy: "stop"}, {StageID: "b", TargetMemberIDs: []string{"member-a"}, DependsOn: []string{"a"}, Aggregation: "all", FailurePolicy: "stop"}}}, "workflow_cycle"},
		{"unknown member", &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{{StageID: "a", TargetMemberIDs: []string{"missing"}, Aggregation: "all", FailurePolicy: "stop"}}}, "member_not_found"},
		{"aggregation", &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{{StageID: "a", TargetMemberIDs: []string{"member-a"}, Aggregation: "any", FailurePolicy: "stop"}}}, "invalid_workflow_aggregation"},
		{"policy", &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{{StageID: "a", TargetMemberIDs: []string{"member-a"}, Aggregation: "all", FailurePolicy: "retry"}}}, "invalid_workflow_failure_policy"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := normalizeWorkflowDefinition(test.definition, members); ErrorCode(err) != test.code {
				t.Fatalf("expected %s, got %v", test.code, err)
			}
		})
	}
	tooMany := make([]domain.WorkflowStage, 17)
	for index := range tooMany {
		tooMany[index] = domain.WorkflowStage{StageID: fmt.Sprintf("s-%d", index), TargetMemberIDs: []string{"member-a"}, Aggregation: "all", FailurePolicy: "stop"}
	}
	if _, err := normalizeWorkflowDefinition(&domain.WorkflowDefinition{Version: "1", Stages: tooMany}, members); ErrorCode(err) != "invalid_workflow_stages" {
		t.Fatalf("expected stage limit, got %v", err)
	}
	manyMembers := make(map[string]domain.AgentRoomMember, 6)
	manyMemberIDs := make([]string, 6)
	for index := range manyMemberIDs {
		memberID := fmt.Sprintf("member-%d", index)
		manyMemberIDs[index] = memberID
		manyMembers[memberID] = domain.AgentRoomMember{MemberID: memberID}
	}
	manyRuns := make([]domain.WorkflowStage, 6)
	for index := range manyRuns {
		manyRuns[index] = domain.WorkflowStage{StageID: fmt.Sprintf("s-%d", index), TargetMemberIDs: manyMemberIDs, Aggregation: "all", FailurePolicy: "stop"}
	}
	if _, err := normalizeWorkflowDefinition(&domain.WorkflowDefinition{Version: "1", Stages: manyRuns}, manyMembers); ErrorCode(err) != "workflow_run_limit_reached" {
		t.Fatalf("expected run limit, got %v", err)
	}
}

func TestWorkflowParallelReviewAdvancesWithExplicitResultRefs(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	room, err := core.CreateRoom(ctx, RoomInput{Title: "Parallel review", OrchestrationMode: "workflow"})
	if err != nil {
		t.Fatal(err)
	}
	members := []domain.AgentRoomMember{}
	for _, name := range []string{"Reviewer A", "Reviewer B"} {
		profile, createErr := core.CreateAgentProfile(ctx, AgentProfileInput{Name: name, RolePrompt: "review independently", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyNewPerTask})
		if createErr != nil {
			t.Fatal(createErr)
		}
		member, addErr := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
		if addErr != nil {
			t.Fatal(addErr)
		}
		members = append(members, member)
	}
	runtime := &workflowRuntime{}
	dispatcher := NewDispatcher(core, dataStore, runtime, runtime)
	result, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{
		Content: "review the patch", Mode: "workflow", QueuePolicy: "enqueue",
		WorkflowDefinition: &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{
			{StageID: "review", TargetMemberIDs: []string{members[0].MemberID, members[1].MemberID}, Aggregation: "all", PromptTemplate: "Find defects", FailurePolicy: "stop"},
			{StageID: "synthesize", TargetMemberIDs: []string{members[0].MemberID}, DependsOn: []string{"review"}, Aggregation: "all", PromptTemplate: "Synthesize findings", FailurePolicy: "stop"},
		}},
	})
	if err != nil || len(result.Runs) != 3 {
		t.Fatalf("workflow dispatch failed: runs=%d err=%v", len(result.Runs), err)
	}
	roots := waitWorkflowRuns(t, ctx, dataStore, result.Message.MessageID, func(runs []domain.AgentRun) bool {
		completed, waiting := 0, 0
		for _, run := range runs {
			if run.WorkflowStageID == "review" && run.Status == "completed" {
				completed++
			}
			if run.WorkflowStageID == "synthesize" && run.Status == "waiting_dependency" {
				waiting++
			}
		}
		return completed == 2 && waiting == 1
	})
	for _, run := range roots {
		if run.WorkflowStageID != "review" {
			continue
		}
		if _, err := dataStore.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{EventID: "reply:" + run.RunID, RoomID: room.RoomID, RunID: run.RunID, SessionID: run.SessionID, Kind: "run.reply_delta", TextDelta: "reviewed " + run.RunID}); err != nil {
			t.Fatal(err)
		}
		dispatcher.HandleTerminalRun(run.RunID)
	}
	waitWorkflowRuns(t, ctx, dataStore, result.Message.MessageID, func(runs []domain.AgentRun) bool {
		return len(runs) == 3 && allRunStatus(runs, "completed")
	})
	runtime.mu.Lock()
	prompts := append([]string(nil), runtime.prompts...)
	runtime.mu.Unlock()
	if len(prompts) != 3 || !strings.Contains(prompts[2], "Workflow stage instruction:\nSynthesize findings") || !strings.Contains(prompts[2], "Shared result") {
		t.Fatalf("downstream prompt did not receive explicit summaries: %+v", prompts)
	}
	events, err := dataStore.ListAgentRoomEvents(ctx, store.AgentRoomEventQuery{RoomID: room.RoomID, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	foundCompleted := false
	for _, event := range events {
		foundCompleted = foundCompleted || event.Kind == "workflow.completed"
	}
	if !foundCompleted {
		t.Fatalf("workflow completion event was not persisted: %+v", events)
	}
}

func TestWorkflowFailurePoliciesAndResolveAreBounded(t *testing.T) {
	for _, test := range []struct {
		name, policy, waiting string
		resolve               bool
	}{
		{"continue", "continue", "completed", false},
		{"stop", "stop", "blocked", false},
		{"require user", "require_user", "waiting_user", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			core, dataStore := openTestService(t)
			workspace := t.TempDir()
			profile, err := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Agent", RolePrompt: "act", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyNewPerTask})
			if err != nil {
				t.Fatal(err)
			}
			room, _ := core.CreateRoom(ctx, RoomInput{Title: "Policy", OrchestrationMode: "workflow"})
			member, err := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
			if err != nil {
				t.Fatal(err)
			}
			runtime := &workflowRuntime{failFirst: true}
			dispatcher := NewDispatcher(core, dataStore, runtime, runtime)
			result, err := dispatcher.Dispatch(ctx, room.RoomID, MessageInput{Content: "policy", Mode: "workflow", QueuePolicy: "enqueue", WorkflowDefinition: &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{
				{StageID: "first", TargetMemberIDs: []string{member.MemberID}, Aggregation: "all", PromptTemplate: "first", FailurePolicy: test.policy},
				{StageID: "second", TargetMemberIDs: []string{member.MemberID}, DependsOn: []string{"first"}, Aggregation: "all", PromptTemplate: "second", FailurePolicy: "stop"},
			}}})
			if err != nil {
				t.Fatal(err)
			}
			runs := waitWorkflowRuns(t, ctx, dataStore, result.Message.MessageID, func(runs []domain.AgentRun) bool {
				if len(runs) != 2 {
					return false
				}
				for _, run := range runs {
					if run.WorkflowStageID == "second" {
						return run.Status == test.waiting
					}
				}
				return false
			})
			if test.resolve {
				if _, err := dispatcher.ResolveWorkflow(ctx, room.RoomID, result.Message.MessageID, "continue"); err != nil {
					t.Fatal(err)
				}
				runs = waitWorkflowRuns(t, ctx, dataStore, result.Message.MessageID, func(runs []domain.AgentRun) bool {
					for _, run := range runs {
						if run.WorkflowStageID == "second" {
							return run.Status == "completed"
						}
					}
					return false
				})
			}
			if len(runs) != 2 {
				t.Fatalf("workflow created recursive runs: %+v", runs)
			}
			dispatcher.HandleTerminalRun(runs[0].RunID)
			dispatcher.HandleTerminalRun(runs[0].RunID)
			latest, _ := dataStore.ListAgentRunsByMessage(ctx, result.Message.MessageID)
			if len(latest) != 2 {
				t.Fatalf("duplicate terminal callback created runs: %+v", latest)
			}
		})
	}
}

func TestWorkflowRecoveryReconcilesWaitingDependency(t *testing.T) {
	ctx := context.Background()
	core, dataStore := openTestService(t)
	workspace := t.TempDir()
	profile, _ := core.CreateAgentProfile(ctx, AgentProfileInput{Name: "Agent", RolePrompt: "act", DefaultWorkDir: workspace, SessionPolicy: domain.SessionPolicyNewPerTask})
	room, _ := core.CreateRoom(ctx, RoomInput{Title: "Recovery", OrchestrationMode: "workflow"})
	member, _ := core.AddAgentMember(ctx, room.RoomID, profile.AgentID)
	result, err := core.CreateMessageWithRuns(ctx, room.RoomID, MessageInput{Content: "recover", Mode: "workflow", QueuePolicy: "enqueue", WorkflowDefinition: &domain.WorkflowDefinition{Version: "1", Stages: []domain.WorkflowStage{
		{StageID: "first", TargetMemberIDs: []string{member.MemberID}, Aggregation: "all", FailurePolicy: "stop"},
		{StageID: "second", TargetMemberIDs: []string{member.MemberID}, DependsOn: []string{"first"}, Aggregation: "all", FailurePolicy: "stop"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	root := result.Runs[0]
	changed, err := dataStore.TransitionWorkflowRun(ctx, root.RunID, root.Status, "failed", root.PromptAssembly, "runtime_failed", "Runtime failed")
	if err != nil || !changed {
		t.Fatalf("failed to seed terminal root: %v changed=%v", err, changed)
	}
	runtime := &workflowRuntime{}
	if err := NewDispatcher(core, dataStore, runtime, runtime).Recover(ctx); err != nil {
		t.Fatal(err)
	}
	waitWorkflowRuns(t, ctx, dataStore, result.Message.MessageID, func(runs []domain.AgentRun) bool {
		for _, run := range runs {
			if run.WorkflowStageID == "second" {
				return run.Status == "blocked"
			}
		}
		return false
	})
}

func waitWorkflowRuns(t *testing.T, ctx context.Context, dataStore interface {
	ListAgentRunsByMessage(context.Context, string) ([]domain.AgentRun, error)
}, messageID string, ready func([]domain.AgentRun) bool) []domain.AgentRun {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		runs, err := dataStore.ListAgentRunsByMessage(ctx, messageID)
		if err != nil {
			t.Fatal(err)
		}
		if ready(runs) {
			return runs
		}
		time.Sleep(20 * time.Millisecond)
	}
	runs, _ := dataStore.ListAgentRunsByMessage(ctx, messageID)
	t.Fatalf("workflow did not reach expected state: %+v", runs)
	return nil
}

func allRunStatus(runs []domain.AgentRun, status string) bool {
	for _, run := range runs {
		if run.Status != status {
			return false
		}
	}
	return true
}
