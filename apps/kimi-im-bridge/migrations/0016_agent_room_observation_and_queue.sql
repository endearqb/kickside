CREATE TABLE IF NOT EXISTS session_watch_cursors (
  session_id TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0,
  epoch TEXT NULL,
  last_event_at TEXT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_observations (
  session_id TEXT PRIMARY KEY,
  work_dir TEXT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  epoch TEXT NULL,
  last_event_at TEXT NULL,
  session_state TEXT NOT NULL DEFAULT 'unknown',
  control_origin TEXT NOT NULL DEFAULT 'unknown',
  current_turn_id TEXT NULL,
  current_prompt_id TEXT NULL,
  last_reply TEXT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pane_session_observations (
  pane_id TEXT PRIMARY KEY,
  persisted_session_id TEXT NULL,
  active_session_id TEXT NULL,
  effective_session_id TEXT NULL,
  work_dir TEXT NULL,
  visible INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  maximized INTEGER NOT NULL DEFAULT 0,
  mount_policy TEXT NOT NULL,
  load_state TEXT NOT NULL,
  generation INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pane_session_observations_session
  ON pane_session_observations(effective_session_id);

CREATE TABLE IF NOT EXISTS session_prompt_queue (
  queue_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(run_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_prompt_queue_position
  ON session_prompt_queue(session_id, position);

PRAGMA user_version = 16;
