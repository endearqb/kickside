CREATE TABLE IF NOT EXISTS agent_workflow_runs (
  run_id TEXT PRIMARY KEY,
  source_message_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY(source_message_id) REFERENCES agent_room_messages(message_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_workflow_runs_message_stage
  ON agent_workflow_runs(source_message_id, stage_id);

CREATE TABLE IF NOT EXISTS agent_connector_bindings (
  connector_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  session_mode TEXT NOT NULL DEFAULT 'independent_session'
    CHECK(session_mode IN ('same_session', 'independent_session')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(connector_id) REFERENCES bridge_channels(channel_id) ON DELETE CASCADE,
  FOREIGN KEY(agent_id) REFERENCES agent_profiles(agent_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_connector_bindings_agent
  ON agent_connector_bindings(agent_id);

CREATE TABLE IF NOT EXISTS bridge_turn_origins (
  turn_id TEXT PRIMARY KEY,
  origin_kind TEXT NOT NULL,
  connector_id TEXT,
  agent_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(turn_id) REFERENCES bridge_turns(turn_id) ON DELETE CASCADE,
  FOREIGN KEY(connector_id) REFERENCES bridge_channels(channel_id) ON DELETE SET NULL,
  FOREIGN KEY(agent_id) REFERENCES agent_profiles(agent_id) ON DELETE SET NULL
);

PRAGMA user_version = 19;
