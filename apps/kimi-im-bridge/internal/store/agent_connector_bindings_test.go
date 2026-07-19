package store

import (
	"context"
	"testing"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
)

func TestAgentConnectorBindingCRUDAndIndependentDeletion(t *testing.T) {
	ctx := context.Background()
	dataStore := openAgentRoomTestStore(t)
	if err := dataStore.SyncConfiguredChannels(ctx, []config.ConnectorConfig{{ID: "feishu-one", Platform: "feishu", Enabled: true, Mode: "websocket"}}); err != nil {
		t.Fatal(err)
	}
	profile, err := dataStore.CreateAgentProfile(ctx, domain.AgentProfile{AgentID: "agent-one", Name: "Reviewer", RolePrompt: "review", DefaultWorkDir: "D:/repo", SessionPolicy: domain.SessionPolicyPerRoom, RuntimeControls: []byte(`{}`), Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	binding, err := dataStore.UpsertAgentConnectorBinding(ctx, domain.AgentConnectorBinding{ConnectorID: "feishu-one", AgentID: profile.AgentID, SessionMode: "independent_session"})
	if err != nil || binding.AgentID != profile.AgentID {
		t.Fatalf("binding upsert failed: %+v %v", binding, err)
	}
	items, err := dataStore.ListAgentConnectorBindings(ctx)
	if err != nil || len(items) != 1 {
		t.Fatalf("binding list failed: %+v %v", items, err)
	}
	if err := dataStore.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-one", WorkDir: "D:/repo"}); err != nil {
		t.Fatal(err)
	}
	if err := dataStore.CreateTurn(ctx, domain.BridgeTurn{TurnID: "turn-one", ConnectorID: "feishu-one", KimiSessionID: "session-one", Platform: "feishu", ChatID: "chat", PromptText: "prompt", Status: "accepted", ProviderName: "kimi", StartedAt: "2026-07-19T00:00:00Z", CreatedAt: "2026-07-19T00:00:00Z", UpdatedAt: "2026-07-19T00:00:00Z", OriginKind: "connector", AgentID: profile.AgentID}); err != nil {
		t.Fatal(err)
	}
	origin, err := dataStore.GetBridgeTurnOrigin(ctx, "turn-one")
	if err != nil || origin == nil || origin.OriginKind != "connector" || origin.AgentID != profile.AgentID {
		t.Fatalf("turn origin was not persisted: %+v %v", origin, err)
	}
	if _, err := dataStore.DeleteAgentProfile(ctx, profile.AgentID); err != nil {
		t.Fatal(err)
	}
	origin, err = dataStore.GetBridgeTurnOrigin(ctx, "turn-one")
	if err != nil || origin == nil || origin.AgentID != "" || origin.ConnectorID != "feishu-one" {
		t.Fatalf("agent deletion must preserve redacted turn origin: %+v %v", origin, err)
	}
	if item, err := dataStore.GetAgentConnectorBinding(ctx, "feishu-one"); err != nil || item != nil {
		t.Fatalf("agent deletion must remove only relation: %+v %v", item, err)
	}
	statuses, err := dataStore.ListChannelStatuses(ctx)
	if err != nil || len(statuses) != 1 || statuses[0].ConnectorID != "feishu-one" {
		t.Fatalf("agent deletion removed connector: %+v %v", statuses, err)
	}
	profile, err = dataStore.CreateAgentProfile(ctx, domain.AgentProfile{AgentID: "agent-two", Name: "Critic", RolePrompt: "criticize", DefaultWorkDir: "D:/repo", SessionPolicy: domain.SessionPolicyPerRoom, RuntimeControls: []byte(`{}`), Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dataStore.UpsertAgentConnectorBinding(ctx, domain.AgentConnectorBinding{ConnectorID: "feishu-one", AgentID: profile.AgentID, SessionMode: "independent_session"}); err != nil {
		t.Fatal(err)
	}
	if err := dataStore.SyncConfiguredChannels(ctx, []config.ConnectorConfig{}); err != nil {
		t.Fatal(err)
	}
	if item, err := dataStore.GetAgentConnectorBinding(ctx, "feishu-one"); err != nil || item != nil {
		t.Fatalf("connector prune must remove only relation: %+v %v", item, err)
	}
	if item, err := dataStore.GetAgentProfile(ctx, profile.AgentID); err != nil || item == nil {
		t.Fatalf("connector prune removed agent: %+v %v", item, err)
	}
}

func TestResolveConnectorAgentTreatsDisabledAgentAsUnbound(t *testing.T) {
	ctx := context.Background()
	dataStore := openAgentRoomTestStore(t)
	if err := dataStore.SyncConfiguredChannels(ctx, []config.ConnectorConfig{{ID: "telegram-one", Platform: "telegram", Enabled: true, Mode: "polling"}}); err != nil {
		t.Fatal(err)
	}
	profile, err := dataStore.CreateAgentProfile(ctx, domain.AgentProfile{AgentID: "agent-one", Name: "Dev", RolePrompt: "build", DefaultWorkDir: "D:/agent", SessionPolicy: domain.SessionPolicyPerRoom, RuntimeControls: []byte(`{"thinking":"low"}`), Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := dataStore.UpsertAgentConnectorBinding(ctx, domain.AgentConnectorBinding{ConnectorID: "telegram-one", AgentID: profile.AgentID, SessionMode: "independent_session"}); err != nil {
		t.Fatal(err)
	}
	resolved, err := dataStore.ResolveConnectorAgent(ctx, "telegram-one")
	if err != nil || resolved == nil || resolved.RolePrompt != "build" {
		t.Fatalf("enabled binding did not resolve: %+v %v", resolved, err)
	}
	profile.Enabled = false
	if _, err := dataStore.UpdateAgentProfile(ctx, profile, profile.Revision); err != nil {
		t.Fatal(err)
	}
	resolved, err = dataStore.ResolveConnectorAgent(ctx, "telegram-one")
	if err != nil || resolved != nil {
		t.Fatalf("disabled agent must degrade to unbound: %+v %v", resolved, err)
	}
}
