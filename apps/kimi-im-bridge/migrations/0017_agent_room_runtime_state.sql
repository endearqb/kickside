CREATE TABLE IF NOT EXISTS agent_room_runtime_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  pane_generation INTEGER NOT NULL DEFAULT -1,
  pane_snapshot_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO agent_room_runtime_state (
  singleton, pane_generation, pane_snapshot_hash, updated_at
) VALUES (1, -1, '', '1970-01-01T00:00:00Z');

CREATE TABLE IF NOT EXISTS agent_room_observation_pins (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES bridge_sessions(kimi_session_id) ON DELETE CASCADE
);

PRAGMA user_version = 17;
