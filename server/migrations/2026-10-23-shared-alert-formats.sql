-- Opt-in shared bank-alert formats. Only a value-free SHAPE is stored (see
-- docs/shared-alert-formats.md). A shape publishes once >= 3 distinct vaults
-- submitted it identically. vault_hash is a keyed HMAC of the vault id, never
-- the vault id itself. bank_sender is the shape's sender short code (the
-- column is not called `sender`: no sender column exists anywhere else).
CREATE TABLE IF NOT EXISTS shared_format_shapes (
  shape_hash   TEXT PRIMARY KEY,
  shape_json   TEXT NOT NULL,
  bank_sender  TEXT NOT NULL,
  vault_count  INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'blocked')),
  first_seen   INTEGER NOT NULL,
  published_at INTEGER
);
CREATE TABLE IF NOT EXISTS shared_format_votes (
  shape_hash TEXT NOT NULL,
  vault_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- A vote counts only once its vault is a day old, so minting vaults on the
  -- spot cannot publish a shape.
  counts_after INTEGER NOT NULL,
  PRIMARY KEY (shape_hash, vault_hash)
);
CREATE INDEX IF NOT EXISTS shared_format_shapes_by_status ON shared_format_shapes (status, published_at);
CREATE INDEX IF NOT EXISTS shared_format_votes_by_vault ON shared_format_votes (vault_hash, created_at);
