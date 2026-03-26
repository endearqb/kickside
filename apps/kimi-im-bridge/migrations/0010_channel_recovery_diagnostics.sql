ALTER TABLE bridge_channels ADD COLUMN last_failure_at TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN last_failure_operation TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN last_failure_retryable INTEGER NULL;
ALTER TABLE bridge_channels ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bridge_channels ADD COLUMN next_retry_at TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN last_recovery_at TEXT NULL;
ALTER TABLE bridge_channels ADD COLUMN recovery_hint TEXT NULL;

PRAGMA user_version = 10;
