ALTER TABLE channel_bindings ADD COLUMN context_token TEXT NULL;

PRAGMA user_version = 12;
