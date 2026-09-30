-- New imports bind their ordered structured interpretation before delivery.
-- Existing replay receipts have no provable interpretation and are not backfilled.
CREATE TABLE IF NOT EXISTS statement_import_bindings (
  device_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  interpretation_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, source_key),
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS statement_bindings_by_expiry ON statement_import_bindings (expires_at);
