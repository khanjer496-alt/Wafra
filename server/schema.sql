-- Wafra iOS relay schema.
--
-- There is no table for messages. That is the design, not an omission: the
-- Worker parses each message in memory and drops the text. What is stored is
-- the parsed row, already sealed to a device's public key, and only until that
-- device collects it.

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  -- X25519 public key, base64. The private half never leaves the phone, so the
  -- service cannot read what it stored even under compulsion.
  public_key  TEXT NOT NULL,
  -- SHA-256 of the bearer token. A database leak cannot be replayed as a token.
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  epk        TEXT NOT NULL,  -- ephemeral X25519 public key, base64
  iv         TEXT NOT NULL,  -- AES-GCM nonce, base64
  ct         TEXT NOT NULL,  -- sealed parsed row, base64
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS queue_by_device ON queue (device_id, created_at);
CREATE INDEX IF NOT EXISTS devices_by_token ON devices (token_hash);
