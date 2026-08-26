-- One-time D1 migration for relay databases created before scoped Shortcut
-- retirement. SQLite has no ADD COLUMN IF NOT EXISTS; apply this file exactly
-- once after confirming PRAGMA table_info(devices) does not list the column.
ALTER TABLE devices
  ADD COLUMN shortcut_ingest_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (shortcut_ingest_enabled IN (0, 1));
