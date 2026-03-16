ALTER TABLE delivery_events ADD COLUMN turn_id TEXT NULL;
ALTER TABLE delivery_events ADD COLUMN step_index INTEGER NULL;
ALTER TABLE delivery_events ADD COLUMN delivery_kind TEXT NULL;
ALTER TABLE delivery_events ADD COLUMN renderer TEXT NULL;
ALTER TABLE delivery_events ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_events ADD COLUMN target_message_id TEXT NULL;
ALTER TABLE delivery_events ADD COLUMN retry_after_at TEXT NULL;
ALTER TABLE delivery_events ADD COLUMN supersedes_event_id TEXT NULL;

ALTER TABLE approval_requests ADD COLUMN claimed_by_actor_id TEXT NULL;
ALTER TABLE approval_requests ADD COLUMN claimed_at TEXT NULL;
ALTER TABLE approval_requests ADD COLUMN platform_message_id TEXT NULL;
ALTER TABLE approval_requests ADD COLUMN resolution_by TEXT NULL;
ALTER TABLE approval_requests ADD COLUMN request_hash TEXT NULL;

ALTER TABLE channel_bindings ADD COLUMN binding_state TEXT NULL;
ALTER TABLE channel_bindings ADD COLUMN last_runtime_status TEXT NULL;
ALTER TABLE channel_bindings ADD COLUMN last_prompt_at TEXT NULL;
ALTER TABLE channel_bindings ADD COLUMN settings_json TEXT NULL;

ALTER TABLE bridge_channels ADD COLUMN adapter_version TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN last_ready_at TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN capabilities_json TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_events_turn
  ON delivery_events (turn_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_events_retry
  ON delivery_events (status, retry_after_at);

PRAGMA user_version = 6;
