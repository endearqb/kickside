ALTER TABLE approval_requests ADD COLUMN turn_id TEXT NULL;
ALTER TABLE approval_requests ADD COLUMN step_id TEXT NULL;

PRAGMA user_version = 2;
