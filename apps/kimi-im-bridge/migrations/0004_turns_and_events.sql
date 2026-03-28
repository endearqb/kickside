CREATE TABLE IF NOT EXISTS bridge_turns (
  turn_id TEXT PRIMARY KEY,
  kimi_session_id TEXT NOT NULL,
  binding_id TEXT NULL,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NULL,
  inbound_message_id TEXT NULL,
  prompt_text TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bridge_turns_session
  ON bridge_turns (kimi_session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_turns_binding
  ON bridge_turns (platform, chat_id, ifnull(thread_id, ''), created_at DESC);

CREATE TABLE IF NOT EXISTS turn_events (
  event_id TEXT PRIMARY KEY,
  turn_id TEXT NOT NULL,
  kimi_session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NULL,
  kind TEXT NOT NULL,
  step_index INTEGER NULL,
  message_id TEXT NULL,
  approval_id TEXT NULL,
  request_kind TEXT NULL,
  text_delta TEXT NULL,
  thinking_delta TEXT NULL,
  status_text TEXT NULL,
  payload_json TEXT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,
  context_usage REAL NULL,
  token_usage_json TEXT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(turn_id) REFERENCES bridge_turns(turn_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turn_events_turn
  ON turn_events (turn_id, created_at);

CREATE INDEX IF NOT EXISTS idx_turn_events_approval
  ON turn_events (approval_id, created_at);

PRAGMA user_version = 4;
