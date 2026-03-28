CREATE TABLE IF NOT EXISTS pending_inbound_attachments (
    attachment_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    thread_id TEXT,
    kind TEXT NOT NULL,
    file_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    platform_key TEXT,
    local_path TEXT,
    source_message_id TEXT,
    download_state TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_inbound_attachments_dedupe
    ON pending_inbound_attachments(platform, chat_id, ifnull(thread_id, ''), ifnull(platform_key, ''), ifnull(source_message_id, ''));

CREATE INDEX IF NOT EXISTS idx_pending_inbound_attachments_context
    ON pending_inbound_attachments(platform, chat_id, ifnull(thread_id, ''), created_at);

PRAGMA user_version = 9;
