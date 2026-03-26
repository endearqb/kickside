ALTER TABLE channel_bindings ADD COLUMN connector_id TEXT NULL;
UPDATE channel_bindings
SET connector_id = platform
WHERE ifnull(connector_id, '') = '';

DROP INDEX IF EXISTS idx_channel_bindings_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_bindings_key
  ON channel_bindings (connector_id, chat_id, ifnull(thread_id, ''));

ALTER TABLE approval_requests ADD COLUMN connector_id TEXT NULL;
UPDATE approval_requests
SET connector_id = platform
WHERE ifnull(connector_id, '') = '';

ALTER TABLE delivery_events ADD COLUMN connector_id TEXT NULL;
UPDATE delivery_events
SET connector_id = platform
WHERE ifnull(connector_id, '') = '';

ALTER TABLE bridge_turns ADD COLUMN connector_id TEXT NULL;
UPDATE bridge_turns
SET connector_id = platform
WHERE ifnull(connector_id, '') = '';

ALTER TABLE turn_events ADD COLUMN connector_id TEXT NULL;
UPDATE turn_events
SET connector_id = platform
WHERE ifnull(connector_id, '') = '';

ALTER TABLE pending_inbound_attachments ADD COLUMN connector_id TEXT NULL;
UPDATE pending_inbound_attachments
SET connector_id = platform
WHERE ifnull(connector_id, '') = '';

ALTER TABLE channel_checkpoints RENAME TO channel_checkpoints_legacy;

CREATE TABLE IF NOT EXISTS channel_checkpoints (
  channel_id TEXT NOT NULL,
  checkpoint_kind TEXT NOT NULL,
  fetched_value TEXT NULL,
  committed_value TEXT NULL,
  last_seen_at TEXT NULL,
  committed_at TEXT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, checkpoint_kind)
);

INSERT INTO channel_checkpoints (
  channel_id,
  checkpoint_kind,
  fetched_value,
  committed_value,
  last_seen_at,
  committed_at,
  updated_at
)
SELECT
  platform,
  checkpoint_kind,
  fetched_value,
  committed_value,
  last_seen_at,
  committed_at,
  updated_at
FROM channel_checkpoints_legacy;

DROP TABLE channel_checkpoints_legacy;

PRAGMA user_version = 11;
