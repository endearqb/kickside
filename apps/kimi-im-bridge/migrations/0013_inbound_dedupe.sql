DELETE FROM bridge_turns
WHERE inbound_message_id IS NOT NULL
  AND inbound_message_id <> ''
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM bridge_turns
    WHERE inbound_message_id IS NOT NULL
      AND inbound_message_id <> ''
    GROUP BY connector_id, inbound_message_id
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_turns_inbound_dedupe
  ON bridge_turns(connector_id, inbound_message_id)
  WHERE inbound_message_id IS NOT NULL AND inbound_message_id <> '';

PRAGMA user_version = 13;
