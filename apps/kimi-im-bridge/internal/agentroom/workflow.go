package agentroom

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

const (
	maxWorkflowStages = 16
	maxWorkflowRuns   = 32
)

func normalizeWorkflowDefinition(input *domain.WorkflowDefinition, members map[string]domain.AgentRoomMember) (*domain.WorkflowDefinition, error) {
	if input == nil {
		return nil, validation("workflow_definition_required", "workflow mode requires a definition")
	}
	definition := &domain.WorkflowDefinition{Version: strings.TrimSpace(input.Version), Stages: make([]domain.WorkflowStage, len(input.Stages))}
	if definition.Version != "1" {
		return nil, validation("invalid_workflow_version", "workflow version must be 1")
	}
	if len(input.Stages) == 0 || len(input.Stages) > maxWorkflowStages {
		return nil, validation("invalid_workflow_stages", "workflow must contain 1 to 16 stages")
	}
	stageByID := make(map[string]domain.WorkflowStage, len(input.Stages))
	totalRuns := 0
	for index, raw := range input.Stages {
		stage := domain.WorkflowStage{
			StageID: strings.TrimSpace(raw.StageID), TargetMemberIDs: dedupeStrings(raw.TargetMemberIDs),
			DependsOn: dedupeStrings(raw.DependsOn), Aggregation: strings.TrimSpace(raw.Aggregation),
			PromptTemplate: strings.TrimSpace(raw.PromptTemplate), FailurePolicy: strings.TrimSpace(raw.FailurePolicy),
		}
		if stage.StageID == "" {
			return nil, validation("invalid_workflow_stage_id", "workflow stage id is required")
		}
		if _, duplicate := stageByID[stage.StageID]; duplicate {
			return nil, validation("duplicate_workflow_stage", "workflow stage ids must be unique")
		}
		if len(stage.TargetMemberIDs) == 0 {
			return nil, validation("workflow_stage_targets_required", "workflow stage requires explicit target members")
		}
		for _, memberID := range stage.TargetMemberIDs {
			if _, ok := members[memberID]; !ok {
				return nil, validation("member_not_found", "workflow target member was not found")
			}
		}
		if stage.Aggregation == "" {
			stage.Aggregation = "all"
		}
		if stage.Aggregation != "all" {
			return nil, validation("invalid_workflow_aggregation", "workflow aggregation must be all")
		}
		if stage.FailurePolicy == "" {
			stage.FailurePolicy = "stop"
		}
		if !oneOf(stage.FailurePolicy, "continue", "stop", "require_user") {
			return nil, validation("invalid_workflow_failure_policy", "unsupported workflow failure policy")
		}
		if len(stage.PromptTemplate) > 64*1024 {
			return nil, validation("workflow_prompt_too_large", "workflow stage prompt exceeds 64 KiB")
		}
		totalRuns += len(stage.TargetMemberIDs)
		definition.Stages[index] = stage
		stageByID[stage.StageID] = stage
	}
	if totalRuns == 0 || totalRuns > maxWorkflowRuns {
		return nil, validation("workflow_run_limit_reached", "workflow must create 1 to 32 runs")
	}
	for _, stage := range definition.Stages {
		for _, dependency := range stage.DependsOn {
			if dependency == stage.StageID {
				return nil, validation("workflow_cycle", "workflow stage cannot depend on itself")
			}
			if _, ok := stageByID[dependency]; !ok {
				return nil, validation("workflow_dependency_not_found", "workflow dependency was not found")
			}
		}
	}
	state := map[string]uint8{}
	var visit func(string) bool
	visit = func(stageID string) bool {
		if state[stageID] == 1 {
			return false
		}
		if state[stageID] == 2 {
			return true
		}
		state[stageID] = 1
		for _, dependency := range stageByID[stageID].DependsOn {
			if !visit(dependency) {
				return false
			}
		}
		state[stageID] = 2
		return true
	}
	for stageID := range stageByID {
		if !visit(stageID) {
			return nil, validation("workflow_cycle", "workflow dependencies must form a DAG")
		}
	}
	encoded, err := json.Marshal(definition)
	if err != nil {
		return nil, err
	}
	if len(encoded) > 256*1024 {
		return nil, validation("workflow_definition_too_large", "workflow definition exceeds 256 KiB")
	}
	return definition, nil
}

func workflowDefinitionFromMetadata(raw json.RawMessage) (*domain.WorkflowDefinition, error) {
	var payload struct {
		Definition *domain.WorkflowDefinition `json:"workflowDefinition"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || payload.Definition == nil {
		return nil, validation("workflow_definition_unavailable", "workflow definition is unavailable")
	}
	return payload.Definition, nil
}

func workflowPromptAssembly(stage domain.WorkflowStage, content string, sharedRunIDs []string) json.RawMessage {
	value, _ := json.Marshal(map[string]any{
		"version": 1, "workflowStageId": stage.StageID, "stagePrompt": stage.PromptTemplate,
		"sharedRunIds": dedupeStrings(sharedRunIDs), "task": strings.TrimSpace(content),
	})
	return value
}

func promptAssemblySharedRunIDs(raw json.RawMessage) []string {
	var value struct {
		SharedRunIDs []string `json:"sharedRunIds"`
	}
	_ = json.Unmarshal(raw, &value)
	return dedupeStrings(value.SharedRunIDs)
}

func promptAssemblyStagePrompt(raw json.RawMessage) string {
	var value struct {
		StagePrompt string `json:"stagePrompt"`
	}
	_ = json.Unmarshal(raw, &value)
	return strings.TrimSpace(value.StagePrompt)
}

func (d *Dispatcher) advanceWorkflow(ctx context.Context, messageID string) error {
	message, err := d.store.GetAgentRoomMessage(ctx, strings.TrimSpace(messageID))
	if err != nil || message == nil {
		return err
	}
	definition, err := workflowDefinitionFromMetadata(message.Metadata)
	if err != nil {
		return nil // Non-workflow Message.
	}
	runs, err := d.store.ListAgentRunsByMessage(ctx, message.MessageID)
	if err != nil {
		return err
	}
	stageByID := make(map[string]domain.WorkflowStage, len(definition.Stages))
	runsByStage := make(map[string][]domain.AgentRun, len(definition.Stages))
	for _, stage := range definition.Stages {
		stageByID[stage.StageID] = stage
	}
	for _, run := range runs {
		if run.WorkflowStageID != "" {
			runsByStage[run.WorkflowStageID] = append(runsByStage[run.WorkflowStageID], run)
		}
	}
	room, err := d.store.GetAgentRoom(ctx, message.RoomID)
	if err != nil || room == nil {
		return firstError(err, validation("room_not_found", "agent room not found"))
	}
	attachments, err := decodePromptAttachments(message.Attachments)
	if err != nil {
		return err
	}
	for _, stage := range definition.Stages {
		if len(stage.DependsOn) == 0 {
			continue
		}
		pending := runsByStage[stage.StageID]
		if len(pending) == 0 {
			continue
		}
		allDependenciesTerminal := true
		failureAction := "continue"
		sharedRunIDs := []string{}
		for _, dependencyID := range stage.DependsOn {
			dependencyRuns := runsByStage[dependencyID]
			dependencyFailed := false
			for _, run := range dependencyRuns {
				if !runTerminal(run.Status) {
					allDependenciesTerminal = false
				}
				if run.Status == "completed" {
					sharedRunIDs = append(sharedRunIDs, run.RunID)
				} else if runTerminal(run.Status) {
					dependencyFailed = true
				}
			}
			if dependencyFailed {
				switch stageByID[dependencyID].FailurePolicy {
				case "stop":
					failureAction = "stop"
				case "require_user":
					if failureAction != "stop" {
						failureAction = "require_user"
					}
				}
			}
		}
		if !allDependenciesTerminal {
			continue
		}
		if len(sharedRunIDs) > 0 {
			if _, sharedErr := d.resolveSharedRunResults(ctx, room.RoomID, sharedRunIDs); sharedErr != nil {
				if oneOf(ErrorCode(sharedErr), "shared_run_result_unavailable", "shared_run_unavailable") {
					continue // Reverse Mirror has not projected the terminal reply yet.
				}
				return sharedErr
			}
		}
		targetStatus, code, publicMessage, eventKind := "queued", "", "", "workflow.stage_ready"
		if failureAction == "stop" {
			targetStatus, code, publicMessage, eventKind = "blocked", "workflow_stopped", "Workflow stopped after a dependency failure", "workflow.stage_blocked"
		} else if failureAction == "require_user" {
			targetStatus, code, publicMessage, eventKind = "waiting_user", "workflow_requires_user", "Workflow requires a user decision", "workflow.stage_waiting_user"
		}
		transitioned := []domain.AgentRun{}
		for _, run := range pending {
			if run.Status != "waiting_dependency" {
				continue
			}
			assembly := workflowPromptAssembly(stage, message.Content, sharedRunIDs)
			changed, transitionErr := d.store.TransitionWorkflowRun(ctx, run.RunID, "waiting_dependency", targetStatus, assembly, code, publicMessage)
			if transitionErr != nil {
				return transitionErr
			}
			if changed {
				updated, getErr := d.store.GetAgentRun(ctx, run.RunID)
				if getErr != nil {
					return getErr
				}
				if updated != nil {
					transitioned = append(transitioned, *updated)
				}
			}
		}
		if len(transitioned) == 0 {
			continue
		}
		_ = d.appendWorkflowEvent(ctx, *room, message.MessageID, stage.StageID, eventKind, targetStatus)
		if targetStatus == "queued" {
			for _, run := range transitioned {
				if _, dispatchErr := d.prepareAndDispatch(ctx, *room, *message, run, attachments); dispatchErr != nil {
					// The Run itself records the stable failure and recursively advances the workflow.
					continue
				}
			}
		}
	}
	latest, err := d.store.ListAgentRunsByMessage(ctx, message.MessageID)
	if err != nil {
		return err
	}
	if len(latest) > 0 {
		complete := true
		for _, run := range latest {
			if !runTerminal(run.Status) {
				complete = false
				break
			}
		}
		if complete {
			_ = d.appendWorkflowEvent(ctx, *room, message.MessageID, "", "workflow.completed", "completed")
		}
	}
	return nil
}

func (d *Dispatcher) ResolveWorkflow(ctx context.Context, roomID, messageID, decision string) (MessageRunsResult, error) {
	decision = strings.TrimSpace(decision)
	if !oneOf(decision, "continue", "stop") {
		return MessageRunsResult{}, validation("invalid_workflow_decision", "workflow decision must be continue or stop")
	}
	message, err := d.store.GetAgentRoomMessage(ctx, strings.TrimSpace(messageID))
	if err != nil || message == nil || message.RoomID != strings.TrimSpace(roomID) {
		return MessageRunsResult{}, firstError(err, validation("workflow_not_found", "workflow was not found"))
	}
	if _, err := workflowDefinitionFromMetadata(message.Metadata); err != nil {
		return MessageRunsResult{}, validation("workflow_not_found", "workflow was not found")
	}
	room, err := d.store.GetAgentRoom(ctx, message.RoomID)
	if err != nil || room == nil {
		return MessageRunsResult{}, firstError(err, validation("room_not_found", "agent room not found"))
	}
	attachments, err := decodePromptAttachments(message.Attachments)
	if err != nil {
		return MessageRunsResult{}, err
	}
	runs, err := d.store.ListAgentRunsByMessage(ctx, message.MessageID)
	if err != nil {
		return MessageRunsResult{}, err
	}
	changed := false
	for index := range runs {
		if runs[index].Status != "waiting_user" {
			continue
		}
		target, code, publicMessage := "queued", "", ""
		if decision == "stop" {
			target, code, publicMessage = "blocked", "workflow_stopped_by_user", "Workflow stopped by user"
		}
		transitioned, transitionErr := d.store.TransitionWorkflowRun(ctx, runs[index].RunID, "waiting_user", target, runs[index].PromptAssembly, code, publicMessage)
		if transitionErr != nil {
			return MessageRunsResult{}, transitionErr
		}
		if !transitioned {
			continue
		}
		changed = true
		updated, getErr := d.store.GetAgentRun(ctx, runs[index].RunID)
		if getErr != nil {
			return MessageRunsResult{}, getErr
		}
		if updated != nil {
			runs[index] = *updated
			if decision == "continue" {
				_, _ = d.prepareAndDispatch(ctx, *room, *message, *updated, attachments)
			}
		}
	}
	if !changed {
		return MessageRunsResult{}, validation("workflow_decision_not_pending", "workflow has no pending user decision")
	}
	_ = d.appendWorkflowEvent(ctx, *room, message.MessageID, "", "workflow.resolved", decision)
	_ = d.advanceWorkflow(ctx, message.MessageID)
	runs, _ = d.store.ListAgentRunsByMessage(ctx, message.MessageID)
	return MessageRunsResult{Message: *message, Runs: runs}, nil
}

func (d *Dispatcher) appendWorkflowEvent(ctx context.Context, room domain.AgentRoom, messageID, stageID, kind, status string) error {
	payload, _ := json.Marshal(map[string]string{"messageId": messageID, "stageId": stageID})
	_, err := d.store.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{
		EventID: fmt.Sprintf("workflow:%s:%s:%s", messageID, firstNonEmptyString(stageID, "execution"), kind),
		RoomID:  room.RoomID, Kind: kind, Status: status, DisplayText: "Agent Room workflow state changed",
		Payload: payload, CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	return err
}
