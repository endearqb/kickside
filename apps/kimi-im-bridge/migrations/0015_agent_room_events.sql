CREATE TABLE IF NOT EXISTS agent_runs (
  run_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  agent_id TEXT NULL,
  session_id TEXT NULL,
  work_dir TEXT NULL,
  turn_id TEXT NULL,
  prompt_id TEXT NULL,
  origin_kind TEXT NOT NULL,
  queue_policy TEXT NOT NULL,
  status TEXT NOT NULL,
  queue_position INTEGER NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  controls_json TEXT NOT NULL DEFAULT '{}',
  prompt_assembly_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  started_at TEXT NULL,
  completed_at TEXT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(room_id) REFERENCES agent_rooms(room_id) ON DELETE CASCADE,
  FOREIGN KEY(source_message_id) REFERENCES agent_room_messages(message_id) ON DELETE CASCADE,
  FOREIGN KEY(member_id) REFERENCES agent_room_members(member_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_room_created
  ON agent_runs(room_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_runs_session_status
  ON agent_runs(session_id, status);

CREATE TABLE IF NOT EXISTS agent_room_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  room_id TEXT NULL,
  member_id TEXT NULL,
  agent_id TEXT NULL,
  run_id TEXT NULL,
  session_id TEXT NULL,
  turn_id TEXT NULL,
  prompt_id TEXT NULL,
  kind TEXT NOT NULL,
  status TEXT NULL,
  text_delta TEXT NULL,
  display_text TEXT NULL,
  approval_id TEXT NULL,
  artifact_json TEXT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_room_events_room_seq
  ON agent_room_events(room_id, seq);

CREATE INDEX IF NOT EXISTS idx_agent_room_events_session_seq
  ON agent_room_events(session_id, seq);

CREATE TABLE IF NOT EXISTS agent_room_event_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  compacted_through_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO agent_room_event_state (singleton, compacted_through_seq, updated_at)
VALUES (1, 0, '1970-01-01T00:00:00Z');

CREATE TABLE IF NOT EXISTS agent_room_approval_links (
  approval_id TEXT PRIMARY KEY,
  origin_kind TEXT NOT NULL,
  room_id TEXT NULL,
  member_id TEXT NULL,
  agent_id TEXT NULL,
  run_id TEXT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(room_id) REFERENCES agent_rooms(room_id) ON DELETE CASCADE,
  FOREIGN KEY(member_id) REFERENCES agent_room_members(member_id) ON DELETE CASCADE,
  FOREIGN KEY(agent_id) REFERENCES agent_profiles(agent_id) ON DELETE SET NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_room_approval_links_run
  ON agent_room_approval_links(run_id);

CREATE INDEX IF NOT EXISTS idx_agent_room_approval_links_room
  ON agent_room_approval_links(room_id);

PRAGMA user_version = 15;
