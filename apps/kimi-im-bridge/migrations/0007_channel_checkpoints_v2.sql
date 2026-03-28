CREATE TABLE IF NOT EXISTS channel_checkpoints (
  platform TEXT NOT NULL,
  checkpoint_kind TEXT NOT NULL,
  fetched_value TEXT NULL,
  committed_value TEXT NULL,
  last_seen_at TEXT NULL,
  committed_at TEXT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (platform, checkpoint_kind)
);

PRAGMA user_version = 7;
