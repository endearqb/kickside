package store

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/config"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/internal/domain"
	"github.com/endearqb/kimi-app/apps/kimi-im-bridge/migrations"

	_ "modernc.org/sqlite"
)

func TestAgentRoomFreshSchemaAndMigrationRollback(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)

	version, err := store.UserVersion(ctx)
	if err != nil || version != 19 {
		t.Fatalf("expected fresh user_version 19, got %d, %v", version, err)
	}
	if got := store.db.Stats().MaxOpenConnections; got != 1 {
		t.Fatalf("expected single sqlite connection, got %d", got)
	}
	for _, table := range []string{
		"agent_profiles", "agent_rooms", "agent_room_members", "agent_room_messages", "agent_runs",
		"agent_room_events", "agent_room_event_state", "agent_room_approval_links", "session_watch_cursors",
		"session_observations", "pane_session_observations", "session_prompt_queue",
		"agent_room_runtime_state", "agent_room_observation_pins", "session_observer_runtime_state",
		"agent_workflow_runs", "agent_connector_bindings",
		"bridge_turn_origins",
	} {
		var name string
		if err := store.db.QueryRowContext(ctx, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table).Scan(&name); err != nil {
			t.Fatalf("expected table %s: %v", table, err)
		}
	}
	assertSQLiteHealthy(t, store.db)
	var epochColumn string
	if err := store.db.QueryRowContext(ctx, `SELECT name FROM pragma_table_info('session_watch_cursors') WHERE name = 'epoch'`).Scan(&epochColumn); err != nil {
		t.Fatalf("expected cursor epoch column: %v", err)
	}

	raw, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "rollback.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if _, err := raw.Exec(`PRAGMA user_version = 13`); err != nil {
		t.Fatal(err)
	}
	err = applyMigration(raw, migrations.Migration{Version: 14, Name: "0014_broken.sql", SQL: `
		CREATE TABLE must_rollback (id TEXT PRIMARY KEY);
		INSERT INTO table_that_does_not_exist VALUES ('fail');
		PRAGMA user_version = 14;`})
	if err == nil {
		t.Fatal("expected broken migration to fail")
	}
	var rollbackVersion int
	if err := raw.QueryRow(`PRAGMA user_version`).Scan(&rollbackVersion); err != nil || rollbackVersion != 13 {
		t.Fatalf("expected migration version rollback to 13, got %d, %v", rollbackVersion, err)
	}
	var count int
	if err := raw.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'must_rollback'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("expected partial schema rollback, count=%d err=%v", count, err)
	}
}

func TestAgentRoomMigratesV13FixtureAndMigrationsAreIdempotent(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "upgrade.db")
	raw, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	ordered, err := migrations.Ordered()
	if err != nil {
		t.Fatal(err)
	}
	for _, migration := range ordered {
		if migration.Version > 13 {
			break
		}
		if _, err := raw.Exec(migration.SQL); err != nil {
			t.Fatalf("apply fixture migration %s: %v", migration.Name, err)
		}
	}
	statements := []string{
		`INSERT INTO bridge_channels (channel_id, platform, enabled, state, created_at, updated_at) VALUES ('connector-1', 'telegram', 1, 'ready', '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
		`INSERT INTO bridge_sessions (kimi_session_id, work_dir, created_at, updated_at) VALUES ('session-1', 'D:/repo', '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
		`INSERT INTO channel_bindings (binding_id, connector_id, platform, chat_id, kimi_session_id, source, created_at, updated_at) VALUES ('binding-1', 'connector-1', 'telegram', 'chat-1', 'session-1', 'auto', '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
		`INSERT INTO approval_requests (approval_id, connector_id, kimi_session_id, platform, chat_id, request_kind, prompt, status, request_payload_json, dedupe_key, created_at, updated_at) VALUES ('approval-1', 'connector-1', 'session-1', 'telegram', 'chat-1', 'tool', 'approve', 'pending', '{}', 'dedupe-1', '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
		`INSERT INTO bridge_turns (turn_id, connector_id, kimi_session_id, binding_id, platform, chat_id, prompt_text, status, provider_name, started_at, created_at, updated_at) VALUES ('turn-1', 'connector-1', 'session-1', 'binding-1', 'telegram', 'chat-1', 'hello', 'running', 'runtime', '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z', '2026-07-18T00:00:00Z')`,
	}
	for _, statement := range statements {
		if _, err := raw.Exec(statement); err != nil {
			t.Fatalf("seed v13 fixture: %v", err)
		}
	}
	if err := raw.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for _, table := range []string{"bridge_channels", "bridge_sessions", "channel_bindings", "approval_requests", "bridge_turns"} {
		var count int
		if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM `+table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("expected preserved fixture row in %s, count=%d err=%v", table, count, err)
		}
	}
	for _, migration := range ordered {
		if migration.Version >= 14 {
			if _, err := store.db.ExecContext(ctx, migration.SQL); err != nil {
				t.Fatalf("expected migration %s to be idempotent: %v", migration.Name, err)
			}
		}
	}
	assertSQLiteHealthy(t, store.db)
}

func TestAgentRoomCRUDDeletionApprovalAndSessionPreservation(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	if err := store.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: "session-room", WorkDir: "D:/repo", SessionState: "running", LeaseOwner: "run-owner",
		LeaseExpiresAt: "2026-07-18T00:01:00Z", ProviderName: "server", RuntimeMetadataJSON: `{"workspaceId":"workspace-1"}`,
	}); err != nil {
		t.Fatal(err)
	}
	profile, err := store.CreateAgentProfile(ctx, domain.AgentProfile{
		AgentID: "agent-1", Name: "Architect", RolePrompt: "Review boundaries", DefaultWorkDir: "D:/repo",
		SessionPolicy: domain.SessionPolicyPerRoom, RuntimeControls: []byte(`{"thinking":"low"}`), Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	profile.Name = "Principal Architect"
	profile, err = store.UpdateAgentProfile(ctx, profile, profile.Revision)
	if err != nil || profile.Revision != 2 {
		t.Fatalf("expected profile revision 2, got %+v, %v", profile, err)
	}
	if _, err := store.UpdateAgentProfile(ctx, profile, 1); !errors.Is(err, ErrAgentRoomRevisionConflict) {
		t.Fatalf("expected revision conflict, got %v", err)
	}
	room, err := store.CreateAgentRoom(ctx, domain.AgentRoom{RoomID: "room-1", Title: "Room", OrchestrationMode: "direct"})
	if err != nil {
		t.Fatal(err)
	}
	member, err := store.CreateAgentRoomMember(ctx, domain.AgentRoomMember{
		MemberID: "member-1", RoomID: room.RoomID, MemberKind: "agent", AgentID: profile.AgentID,
		DisplayName: profile.Name, WorkspaceRoot: profile.DefaultWorkDir, SessionPolicy: profile.SessionPolicy,
		FollowMode: "pin_session", EffectiveSessionID: "session-room", RolePromptSnapshot: profile.RolePrompt,
		RuntimeControls: profile.RuntimeControls, Status: "idle",
	})
	if err != nil {
		t.Fatal(err)
	}
	message, err := store.CreateAgentRoomMessage(ctx, domain.AgentRoomMessage{
		MessageID: "message-1", RoomID: room.RoomID, SenderKind: "user", Content: "Review", TargetMemberIDs: []string{member.MemberID},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.CreateAgentRun(ctx, domain.AgentRun{
		RunID: "run-1", RoomID: room.RoomID, SourceMessageID: message.MessageID, MemberID: member.MemberID,
		AgentID: profile.AgentID, SessionID: "session-room", OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "running",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID: "approval-room", KimiSessionID: "session-room", Platform: "agent_room", ChatID: room.RoomID,
		RequestKind: "tool", Prompt: "approve", Status: "pending", RequestPayloadJSON: `{}`, DedupeKey: "approval-room",
		OriginKind: "agent_room", RoomID: room.RoomID, MemberID: member.MemberID, AgentID: profile.AgentID, RunID: run.RunID,
	}); err != nil {
		t.Fatal(err)
	}
	approval, err := store.GetApprovalByID(ctx, "approval-room")
	if err != nil || approval == nil || approval.RunID != run.RunID || approval.RoomID != room.RoomID {
		t.Fatalf("expected persisted approval association, got %+v, %v", approval, err)
	}
	if _, err := store.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{EventID: "event-1", RoomID: room.RoomID, RunID: run.RunID, SessionID: "session-room", Kind: "run.started"}); err != nil {
		t.Fatal(err)
	}
	if deleted, err := store.DeleteAgentProfile(ctx, profile.AgentID); err != nil || !deleted {
		t.Fatalf("delete profile: deleted=%v err=%v", deleted, err)
	}
	preservedMember, err := store.GetAgentRoomMember(ctx, member.MemberID)
	if err != nil || preservedMember == nil || preservedMember.AgentID != "" || preservedMember.RolePromptSnapshot != profile.RolePrompt {
		t.Fatalf("expected member snapshot after profile deletion, got %+v, %v", preservedMember, err)
	}
	if deleted, err := store.DeleteAgentRoom(ctx, room.RoomID); err != nil || !deleted {
		t.Fatalf("delete room: deleted=%v err=%v", deleted, err)
	}
	if session, err := store.GetSessionByID(ctx, "session-room"); err != nil || session == nil {
		t.Fatalf("room deletion must preserve session, got %+v, %v", session, err)
	}
	events, err := store.ListAgentRoomEvents(ctx, AgentRoomEventQuery{RoomID: room.RoomID, Limit: 10})
	if err != nil || len(events) != 1 {
		t.Fatalf("room deletion must preserve event audit, got %+v, %v", events, err)
	}
}

func TestAgentRoomEventsDedupeCursorBatchAndLongPoll(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	events, err := store.AppendAgentRoomEvents(ctx, []domain.AgentRoomEvent{
		{EventID: "event-a", RoomID: "room-a", SessionID: "session-a", Kind: "run.reply_delta", TextDelta: "a"},
		{EventID: "event-b", RoomID: "room-a", SessionID: "session-a", Kind: "run.reply_delta", TextDelta: "b"},
	})
	if err != nil || len(events) != 2 || events[0].Seq >= events[1].Seq {
		t.Fatalf("expected ordered event batch, got %+v, %v", events, err)
	}
	duplicate, err := store.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{EventID: "event-a", RoomID: "room-a", SessionID: "session-a", Kind: "run.reply_delta", TextDelta: "a"})
	if err != nil || duplicate.Seq != events[0].Seq {
		t.Fatalf("expected idempotent duplicate, got %+v, %v", duplicate, err)
	}
	if _, err := store.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{EventID: "event-a", Kind: "run.failed"}); !errors.Is(err, ErrAgentRoomConflict) {
		t.Fatalf("expected semantic duplicate conflict, got %v", err)
	}
	if _, err := store.ListAgentRoomEvents(ctx, AgentRoomEventQuery{AfterSeq: -1}); !errors.Is(err, ErrAgentRoomCursorInvalid) {
		t.Fatalf("expected invalid negative cursor, got %v", err)
	}
	if _, err := store.ListAgentRoomEvents(ctx, AgentRoomEventQuery{AfterSeq: events[1].Seq + 1}); !errors.Is(err, ErrAgentRoomCursorInvalid) {
		t.Fatalf("expected invalid future cursor, got %v", err)
	}
	if _, err := store.ListAgentRoomEvents(ctx, AgentRoomEventQuery{Limit: maxAgentRoomEventPage + 1}); !errors.Is(err, ErrAgentRoomPageTooLarge) {
		t.Fatalf("expected page limit error, got %v", err)
	}
	sessionEvents, err := store.ListAgentRoomEvents(ctx, AgentRoomEventQuery{SessionID: "session-a", Limit: 10})
	if err != nil || len(sessionEvents) != 2 {
		t.Fatalf("expected session event query, got %+v, %v", sessionEvents, err)
	}
	if _, err := store.db.ExecContext(ctx, `UPDATE agent_room_event_state SET compacted_through_seq = ? WHERE singleton = 1`, events[0].Seq); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ListAgentRoomEvents(ctx, AgentRoomEventQuery{AfterSeq: 0}); !errors.Is(err, ErrAgentRoomCursorTooOld) {
		t.Fatalf("expected cursor too old, got %v", err)
	}

	result := make(chan []domain.AgentRoomEvent, 1)
	errResult := make(chan error, 1)
	go func() {
		items, err := store.WaitAgentRoomEvents(ctx, AgentRoomEventQuery{RoomID: "room-wait", AfterSeq: events[1].Seq, Limit: 10}, time.Second)
		result <- items
		errResult <- err
	}()
	time.Sleep(20 * time.Millisecond)
	if _, err := store.AppendAgentRoomEvent(ctx, domain.AgentRoomEvent{EventID: "event-wait", RoomID: "room-wait", Kind: "run.started"}); err != nil {
		t.Fatal(err)
	}
	if err := <-errResult; err != nil {
		t.Fatal(err)
	}
	if items := <-result; len(items) != 1 || items[0].EventID != "event-wait" {
		t.Fatalf("expected long poll wake, got %+v", items)
	}
}

func TestPartialSessionUpsertPreservesRuntimeStateLeaseAndMetadata(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	if err := store.UpsertSession(ctx, domain.BridgeSession{
		KimiSessionID: "session-1", WorkDir: "D:/repo", Summary: "summary", SessionState: "running",
		LeaseOwner: "run-1", LeaseExpiresAt: "2026-07-18T00:01:00Z", ProviderName: "server",
		RuntimeMetadataJSON: `{"workspaceId":"workspace-1"}`,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertSession(ctx, domain.BridgeSession{KimiSessionID: "session-1", LastTurnID: "turn-2"}); err != nil {
		t.Fatal(err)
	}
	session, err := store.GetSessionByID(ctx, "session-1")
	if err != nil {
		t.Fatal(err)
	}
	if session == nil || session.WorkDir != "D:/repo" || session.Summary != "summary" || session.SessionState != "running" ||
		session.LeaseOwner != "run-1" || session.LeaseExpiresAt == "" || session.ProviderName != "server" || session.RuntimeMetadataJSON == "" {
		t.Fatalf("partial upsert erased session ownership or metadata: %+v", session)
	}
}

func TestSessionCursorObservationAndPaneProjectionPersistEpoch(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	if err := store.PutSessionWatchCursor(ctx, "session-1", 42, "epoch-a", "2026-07-18T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	seq, epoch, _, ok, err := store.GetSessionWatchCursor(ctx, "session-1")
	if err != nil || !ok || seq != 42 || epoch != "epoch-a" {
		t.Fatalf("unexpected durable cursor: seq=%d epoch=%q ok=%v err=%v", seq, epoch, ok, err)
	}
	observation, err := store.UpsertSessionObservation(ctx, domain.SessionObservation{
		SessionID: "session-1", WorkDir: "D:/repo", LastSeq: 42, Epoch: "epoch-a",
		SessionState: "running", ControlOrigin: "runtime_external", CurrentPromptID: "prompt-1",
	})
	if err != nil || observation.Epoch != "epoch-a" {
		t.Fatalf("unexpected session observation: %+v, %v", observation, err)
	}
	loaded, err := store.GetSessionObservation(ctx, "session-1")
	if err != nil || loaded == nil || loaded.Epoch != "epoch-a" || loaded.CurrentPromptID != "prompt-1" {
		t.Fatalf("session observation did not persist: %+v, %v", loaded, err)
	}
	if _, err := store.UpsertPaneSessionObservation(ctx, domain.PaneSessionObservation{
		PaneID: "pane-1", PersistedSessionID: "session-old", ActiveSessionID: "session-1",
		EffectiveSessionID: "session-1", WorkDir: "D:/repo", Visible: true, Active: true,
		MountPolicy: "eager", LoadState: "ready", Generation: 3,
	}); err != nil {
		t.Fatal(err)
	}
	panes, err := store.ListPaneSessionObservations(ctx)
	if err != nil || len(panes) != 1 || panes[0].EffectiveSessionID != "session-1" || panes[0].Generation != 3 {
		t.Fatalf("unexpected pane observations: %+v, %v", panes, err)
	}
}

func TestConnectorPruneDoesNotTouchAgentRoomTables(t *testing.T) {
	ctx := context.Background()
	store := openAgentRoomTestStore(t)
	connectors := []config.ConnectorConfig{{ID: "connector-1", Platform: "telegram", Enabled: true}}
	if err := store.SyncConfiguredChannels(ctx, connectors); err != nil {
		t.Fatal(err)
	}
	profile, _ := store.CreateAgentProfile(ctx, domain.AgentProfile{AgentID: "agent-1", Name: "A", RolePrompt: "R", DefaultWorkDir: "D:/repo", SessionPolicy: domain.SessionPolicyPerRoom, Enabled: true})
	room, _ := store.CreateAgentRoom(ctx, domain.AgentRoom{RoomID: "room-1", Title: "R", OrchestrationMode: "direct"})
	member, _ := store.CreateAgentRoomMember(ctx, domain.AgentRoomMember{MemberID: "member-1", RoomID: room.RoomID, MemberKind: "agent", AgentID: profile.AgentID, DisplayName: "A", SessionPolicy: domain.SessionPolicyPerRoom, FollowMode: "pin_session", Status: "idle"})
	message, _ := store.CreateAgentRoomMessage(ctx, domain.AgentRoomMessage{MessageID: "message-1", RoomID: room.RoomID, SenderKind: "user", Content: "x"})
	run, _ := store.CreateAgentRun(ctx, domain.AgentRun{RunID: "run-1", RoomID: room.RoomID, SourceMessageID: message.MessageID, MemberID: member.MemberID, OriginKind: "agent_room", QueuePolicy: "enqueue", Status: "queued"})
	if err := store.CreateApprovalTicket(ctx, domain.ApprovalTicket{
		ApprovalID: "approval-connector", ConnectorID: "connector-1", KimiSessionID: "session-1", Platform: "telegram",
		ChatID: "chat-1", RequestKind: "tool", Prompt: "approve", Status: "pending", RequestPayloadJSON: `{}`,
		DedupeKey: "dedupe-connector", OriginKind: "feishu", RoomID: room.RoomID, MemberID: member.MemberID, AgentID: profile.AgentID, RunID: run.RunID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.SyncConfiguredChannels(ctx, nil); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"agent_profiles", "agent_rooms", "agent_room_members", "agent_room_messages", "agent_runs", "agent_room_approval_links"} {
		var count int
		if err := store.db.QueryRowContext(ctx, `SELECT count(*) FROM `+table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("connector prune touched %s, count=%d err=%v", table, count, err)
		}
	}
}

func openAgentRoomTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "bridge.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func assertSQLiteHealthy(t *testing.T, db *sql.DB) {
	t.Helper()
	rows, err := db.Query(`PRAGMA foreign_key_check`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Fatal("foreign_key_check returned a violation")
	}
	var integrity string
	if err := db.QueryRow(`PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		t.Fatalf("integrity_check=%q err=%v", integrity, err)
	}
}
