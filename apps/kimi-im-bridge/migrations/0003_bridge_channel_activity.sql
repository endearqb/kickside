ALTER TABLE bridge_channels ADD COLUMN last_inbound_at TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN last_outbound_at TEXT NULL;

PRAGMA user_version = 3;
