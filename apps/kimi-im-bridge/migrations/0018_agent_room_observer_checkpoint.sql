CREATE TABLE IF NOT EXISTS session_observer_runtime_state (
  session_id TEXT PRIMARY KEY,
  runtime_generation INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(session_id) REFERENCES bridge_sessions(kimi_session_id) ON DELETE CASCADE
);

PRAGMA user_version = 18;
