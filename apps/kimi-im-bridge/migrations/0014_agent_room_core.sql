CREATE TABLE IF NOT EXISTS agent_profiles (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NULL,
  description TEXT NULL,
  role_prompt TEXT NOT NULL,
  default_work_dir TEXT NOT NULL,
  session_policy TEXT NOT NULL,
  pinned_session_id TEXT NULL,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  runtime_controls_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_rooms (
  room_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NULL,
  shared_brief TEXT NULL,
  orchestration_mode TEXT NOT NULL DEFAULT 'direct',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_room_members (
  member_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  member_kind TEXT NOT NULL,
  agent_id TEXT NULL,
  display_name TEXT NOT NULL,
  workspace_root TEXT NULL,
  session_policy TEXT NOT NULL,
  follow_mode TEXT NOT NULL,
  followed_pane_id TEXT NULL,
  pinned_session_id TEXT NULL,
  effective_session_id TEXT NULL,
  role_prompt_snapshot TEXT NULL,
  runtime_controls_json TEXT NOT NULL DEFAULT '{}',
  auto_approve INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(room_id) REFERENCES agent_rooms(room_id) ON DELETE CASCADE,
  FOREIGN KEY(agent_id) REFERENCES agent_profiles(agent_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_room_member_agent
  ON agent_room_members(room_id, agent_id)
  WHERE agent_id IS NOT NULL AND trim(agent_id) <> '';

CREATE INDEX IF NOT EXISTS idx_agent_room_member_session
  ON agent_room_members(effective_session_id);

CREATE TABLE IF NOT EXISTS agent_room_messages (
  message_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL,
  sender_id TEXT NULL,
  content TEXT NOT NULL,
  reply_to_message_id TEXT NULL,
  target_member_ids_json TEXT NOT NULL DEFAULT '[]',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(room_id) REFERENCES agent_rooms(room_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_room_messages_room_created
  ON agent_room_messages(room_id, created_at);

PRAGMA user_version = 14;
