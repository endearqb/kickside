ALTER TABLE bridge_sessions ADD COLUMN session_state TEXT NULL;
ALTER TABLE bridge_sessions ADD COLUMN lease_owner TEXT NULL;
ALTER TABLE bridge_sessions ADD COLUMN lease_expires_at TEXT NULL;
ALTER TABLE bridge_sessions ADD COLUMN auto_approve INTEGER NULL;
ALTER TABLE bridge_sessions ADD COLUMN provider_name TEXT NULL;
ALTER TABLE bridge_sessions ADD COLUMN runtime_metadata_json TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_bridge_sessions_lease
  ON bridge_sessions (lease_owner, lease_expires_at);

PRAGMA user_version = 5;
