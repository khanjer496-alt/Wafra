-- Wafra iOS relay schema.
--
-- There is no table for messages. That is the design, not an omission: the
-- Worker parses each message in memory and drops the text. What is stored is
-- the parsed row, already sealed to a device's public key, and only until that
-- device collects it.

CREATE TABLE IF NOT EXISTS vaults (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  -- A vault groups trusted phones for future relay delivery. Each phone keeps
  -- independent credentials and an independent public/private key pair.
  vault_id    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  friendly_name TEXT,
  -- X25519 public key, base64. The private half never leaves the phone, so the
  -- service cannot read what it stored even under compulsion.
  public_key  TEXT NOT NULL,
  -- SHA-256 of the bearer token. A database leak cannot be replayed as a token.
  -- The Shortcut only receives ingest authority. The app keeps the separate
  -- Sync/ack has its own least-privilege token because it must be available
  -- to a locked-device background wake. Destructive management stays admin.
  ingest_token_hash TEXT NOT NULL UNIQUE,
  -- Forwarded email has its own inject-only credential because SMTP headers
  -- expose the destination address outside the app/relay TLS connection.
  email_token_hash  TEXT UNIQUE,
  sync_token_hash   TEXT NOT NULL UNIQUE,
  admin_token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- Admin-created, one-use, ten-minute invitations. Only the token digest is
-- stored, so a database leak cannot enroll a new phone into a user's vault.
CREATE TABLE IF NOT EXISTS device_invites (
  token_hash TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  epk        TEXT NOT NULL,  -- ephemeral X25519 public key, base64
  iv         TEXT NOT NULL,  -- AES-GCM nonce, base64
  ct         TEXT NOT NULL,  -- sealed parsed row, base64
  created_at INTEGER NOT NULL
);

-- Expo push tokens are bearer-like capabilities: knowing one is sufficient to
-- target the device unless enhanced push security is enabled. Store only an
-- AES-GCM ciphertext; PUSH_TOKEN_KEY lives in the Worker secret store. A wake
-- contains only `{kind: "wafra.sync"}` and never transaction data.
CREATE TABLE IF NOT EXISTS push_registrations (
  device_id  TEXT PRIMARY KEY,
  token_iv   TEXT NOT NULL,
  token_ct   TEXT NOT NULL,
  project_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Shortcuts and HTTP stacks may retry a completed request. A keyed HMAC keeps
-- those retries idempotent without keeping a body or a guessable body hash.
-- The key material is the raw ingest token, which is never stored in D1.
CREATE TABLE IF NOT EXISTS ingest_receipts (
  device_id  TEXT NOT NULL,
  replay_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, replay_key)
);

-- A fixed-window counter limits authenticated Shortcut traffic without storing
-- IP addresses, message hashes, sender IDs or any other user-derived value.
CREATE TABLE IF NOT EXISTS ingest_limits (
  device_id    TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

-- Global Worker-side pairing backstop. Production also applies an edge rule,
-- but the endpoint is never unbounded when that rule is misconfigured.
CREATE TABLE IF NOT EXISTS pair_limits (
  id            TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS queue_by_device ON queue (device_id, created_at);
CREATE INDEX IF NOT EXISTS devices_by_ingest_token ON devices (ingest_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_sync_token ON devices (sync_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_admin_token ON devices (admin_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_email_token ON devices (email_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_vault ON devices (vault_id);
CREATE INDEX IF NOT EXISTS invites_by_expiry ON device_invites (expires_at);
CREATE INDEX IF NOT EXISTS push_by_expiry ON push_registrations (expires_at);
CREATE INDEX IF NOT EXISTS receipts_by_expiry ON ingest_receipts (expires_at);
