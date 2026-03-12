CREATE TABLE IF NOT EXISTS bridge_channels (
  channel_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  account_id TEXT NULL,
  state TEXT NOT NULL,
  last_offset TEXT NULL,
  last_error TEXT NULL,
  last_heartbeat_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channel_bindings (
  binding_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  account_id TEXT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NULL,
  kimi_session_id TEXT NOT NULL,
  work_dir TEXT NULL,
  source TEXT NOT NULL,
  last_inbound_message_id TEXT NULL,
  last_outbound_message_id TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_bindings_key
  ON channel_bindings (platform, ifnull(account_id, ''), chat_id, ifnull(thread_id, ''));

CREATE TABLE IF NOT EXISTS channel_offsets (
  channel_id TEXT NOT NULL,
  offset_kind TEXT NOT NULL,
  offset_value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(channel_id, offset_kind),
  FOREIGN KEY(channel_id) REFERENCES bridge_channels(channel_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bridge_sessions (
  kimi_session_id TEXT PRIMARY KEY,
  work_dir TEXT NULL,
  last_turn_id TEXT NULL,
  last_message_at TEXT NULL,
  summary TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_requests (
  approval_id TEXT PRIMARY KEY,
  kimi_session_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NULL,
  request_kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  request_payload_json TEXT NOT NULL,
  resolution_payload_json TEXT NULL,
  dedupe_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_requests_dedupe_key
  ON approval_requests (dedupe_key);

CREATE TABLE IF NOT EXISTS delivery_events (
  event_id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  thread_id TEXT NULL,
  direction TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  source_message_id TEXT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_events_delivery_key
  ON delivery_events (delivery_key);

PRAGMA user_version = 1;
