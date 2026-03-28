ALTER TABLE channel_bindings ADD COLUMN onboarded_at TEXT NULL;
ALTER TABLE channel_bindings ADD COLUMN onboarding_version TEXT NULL;

PRAGMA user_version = 8;
