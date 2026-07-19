package bridgecore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/adapterkit"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func (o *Orchestrator) HandleInbound(
	ctx context.Context,
	inbound adapterkit.NormalizedInbound,
	options HandleOptions,
	sink TurnEventSink,
) (HandleResult, error) {
	if o == nil || o.bindings == nil || o.runtime == nil || o.execution == nil {
		return HandleResult{}, fmt.Errorf("bridge orchestrator dependencies are incomplete")
	}

	target := RuntimeTarget{
		Platform: inbound.Platform,
		ChatID:   inbound.ChatID,
		ThreadID: inbound.ThreadID,
	}
	agent, err := o.resolveConnectorAgent(ctx, inbound.ConnectorID)
	if err != nil {
		return HandleResult{}, err
	}
	effectiveWorkDir := strings.TrimSpace(options.DefaultWorkDir)
	if effectiveWorkDir == "" && agent != nil {
		effectiveWorkDir = strings.TrimSpace(agent.DefaultWorkDir)
	}
	if effectiveWorkDir == "" {
		effectiveWorkDir = strings.TrimSpace(o.defaultWorkDir)
	}
	binding, err := o.resolveAgentBinding(ctx, inbound.BindingKey, target, effectiveWorkDir, agent)
	if err != nil {
		return HandleResult{}, err
	}
	prompt := inbound.Text
	agentID := ""
	if agent != nil {
		agentID = agent.AgentID
		if role := strings.TrimSpace(agent.RolePrompt); role != "" {
			prompt = "Role:\n" + role + "\n\nTask:\n" + strings.TrimSpace(prompt)
		}
		options.MetadataJSON = mergeConnectorAgentMetadata(options.MetadataJSON, *agent)
	}

	turnID := uuid.NewString()
	result, runErr := o.execution.Run(ctx, ExecutionTarget{
		OriginKind:  "connector",
		ConnectorID: inbound.ConnectorID,
		Platform:    inbound.Platform,
		ChatID:      inbound.ChatID,
		ThreadID:    inbound.ThreadID,
		AgentID:     agentID,
	}, ExecutionRequest{
		TurnID:           turnID,
		BindingID:        binding.BindingID,
		InboundMessageID: inbound.MessageID,
		Prompt:           prompt,
		WorkDir:          binding.WorkDir,
		KimiSessionID:    binding.KimiSessionID,
		AutoApprove:      options.AutoApprove,
		MetadataJSON:     options.MetadataJSON,
		Attachments:      append([]domain.PromptAttachment(nil), options.Attachments...),
	}, func(event ExecutionEvent) error {
		if sink != nil {
			return sink(event.Event)
		}
		return nil
	})
	if runErr != nil && errors.Is(runErr, domain.ErrDuplicateInbound) {
		return HandleResult{
			Binding:   *binding,
			SessionID: binding.KimiSessionID,
			Duplicate: true,
		}, nil
	}

	effectiveSessionID := firstNonEmpty(result.KimiSessionID, binding.KimiSessionID)
	if effectiveSessionID != binding.KimiSessionID {
		if err := o.bindings.Rebind(ctx, binding.BindingID, effectiveSessionID); err != nil {
			return HandleResult{}, err
		}
		binding.KimiSessionID = effectiveSessionID
	}
	if runErr != nil {
		return HandleResult{}, runErr
	}

	return HandleResult{
		Binding:   *binding,
		TurnID:    turnID,
		SessionID: effectiveSessionID,
		ReplyText: result.ReplyText,
		Artifacts: result.Artifacts,
		Renderer:  "interactive",
		Result:    result.RuntimeResult,
	}, nil
}

func (o *Orchestrator) resolveConnectorAgent(ctx context.Context, connectorID string) (*domain.ConnectorAgentContext, error) {
	if o.agentBindings == nil || strings.TrimSpace(connectorID) == "" {
		return nil, nil
	}
	return o.agentBindings.ResolveConnectorAgent(ctx, connectorID)
}

func (o *Orchestrator) resolveAgentBinding(ctx context.Context, key domain.BindingKey, target RuntimeTarget, workDir string, agent *domain.ConnectorAgentContext) (*domain.SessionBinding, error) {
	if agent == nil || agent.SessionMode != "same_session" {
		return o.resolveOrCreateBinding(ctx, key, target, workDir)
	}
	if strings.TrimSpace(agent.PinnedSessionID) == "" || strings.TrimSpace(agent.PinnedWorkDir) == "" {
		return nil, fmt.Errorf("agent_session_unresolved")
	}
	if strings.TrimSpace(workDir) != "" && !sameWorkDir(workDir, agent.PinnedWorkDir) {
		return nil, fmt.Errorf("workspace_mismatch")
	}
	binding, err := o.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, err
	}
	if binding != nil {
		if strings.TrimSpace(binding.KimiSessionID) != strings.TrimSpace(agent.PinnedSessionID) {
			return nil, fmt.Errorf("agent_session_conflict")
		}
		return binding, nil
	}
	return o.bindings.CreateBinding(ctx, key, agent.PinnedSessionID, agent.PinnedWorkDir, "agent_binding")
}

func mergeConnectorAgentMetadata(raw string, agent domain.ConnectorAgentContext) string {
	payload := map[string]any{}
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &payload)
	}
	if len(agent.RuntimeControls) > 0 && json.Valid(agent.RuntimeControls) {
		payload["runtime_controls"] = json.RawMessage(agent.RuntimeControls)
	}
	payload["connector_agent"] = map[string]string{"agent_id": agent.AgentID, "session_mode": agent.SessionMode}
	encoded, _ := json.Marshal(payload)
	return string(encoded)
}

func sameWorkDir(left, right string) bool {
	left = strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(left), "\\", "/"), "/")
	right = strings.TrimRight(strings.ReplaceAll(strings.TrimSpace(right), "\\", "/"), "/")
	return strings.EqualFold(left, right)
}

func (o *Orchestrator) ResolveApproval(ctx context.Context, approvalID string, status string, payload string) error {
	if o == nil || o.runtime == nil {
		return fmt.Errorf("bridge orchestrator runtime is not configured")
	}
	return o.runtime.ResolveApproval(ctx, approvalID, status, payload)
}

func (o *Orchestrator) resolveOrCreateBinding(ctx context.Context, key domain.BindingKey, target RuntimeTarget, defaultWorkDir string) (*domain.SessionBinding, error) {
	binding, err := o.bindings.ResolveBinding(ctx, key)
	if err != nil {
		return nil, err
	}
	if binding != nil {
		if binding.WorkDir == "" {
			binding.WorkDir = strings.TrimSpace(defaultWorkDir)
		}
		return binding, nil
	}

	sessionID := uuid.NewString()
	workDir := strings.TrimSpace(defaultWorkDir)
	source := "auto"
	if ensurer, ok := o.runtime.(RuntimeSessionEnsurer); ok {
		session, err := ensurer.EnsureSession(ctx, target, RuntimeSessionRequest{WorkDir: workDir})
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(session.KimiSessionID) != "" {
			sessionID = strings.TrimSpace(session.KimiSessionID)
		}
		if strings.TrimSpace(session.WorkDir) != "" {
			workDir = strings.TrimSpace(session.WorkDir)
		}
		source = defaultString(session.Source, source)
	}
	return o.bindings.CreateBinding(ctx, key, sessionID, workDir, source)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func defaultString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}
